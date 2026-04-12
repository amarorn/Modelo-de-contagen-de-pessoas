import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  apiUrl,
  type ConfigPayload,
  type StatsPayload,
} from "../lib/api";
import { Link } from "react-router-dom";
import {
  VideoLineOverlay,
  type LineSeg,
} from "../components/VideoLineOverlay";

const HISTORY_MAX = 360;
const POLL_MS = 1000;

type HistoryPoint = {
  t: number;
  entries: number;
  exits: number;
  total: number;
};

export function Dashboard() {
  const feedRef = useRef<HTMLImageElement>(null);
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  /** modo linha: mostra alças arrastáveis sobre o vídeo */
  const [lineEditMode, setLineEditMode] = useState(false);
  const [lineSaving, setLineSaving] = useState(false);
  const [calibStatus, setCalibStatus] = useState("");
  const [resetOnCalib, setResetOnCalib] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceMsg, setSourceMsg] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  /** 0–100 durante envio; null quando não há upload */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  /** Após 100% dos bytes, enquanto o servidor responde */
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [heatmapBusy, setHeatmapBusy] = useState(false);
  /** Tamanho do frame de inferencia (coordenadas da linha); necessario se o MJPEG for redimensionado. */
  const [inferenceSize, setInferenceSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  /** Força novo pedido ao MJPEG (evita imagem em branco/cache após mudar fonte). */
  const [feedRev, setFeedRev] = useState(0);
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const videoFeedSrc = useMemo(
    () => `${apiUrl("/video_feed")}?v=${feedRev}`,
    [feedRev]
  );

  const bumpVideoFeed = useCallback(() => {
    setFeedLoaded(false);
    setFeedRev((r) => r + 1);
  }, []);

  const refreshConfig = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/config"));
      if (!r.ok) return;
      const j = (await r.json()) as ConfigPayload;
      setConfig(j);
      if (j.inference_size?.w && j.inference_size.h) {
        setInferenceSize({ w: j.inference_size.w, h: j.inference_size.h });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  useEffect(() => {
    if (config?.mode === "polygon") {
      setLineEditMode(false);
    }
  }, [config?.mode]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(apiUrl("/api/stats"));
        if (!r.ok || cancelled) return;
        const j = (await r.json()) as StatsPayload;
        setStats(j);
        if (j.inference_size?.w && j.inference_size.h) {
          setInferenceSize({ w: j.inference_size.w, h: j.inference_size.h });
        }
        const now = Date.now();
        setHistory((prev) => {
          const next = [
            ...prev,
            {
              t: now,
              entries: j.entries,
              exits: j.exits,
              total: j.total_passages,
            },
          ];
          return next.length > HISTORY_MAX ? next.slice(-HISTORY_MAX) : next;
        });
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const modeInfo = useMemo(() => {
    if (!config) return "—";
    const L = config.line;
    const t =
      config.mode === "polygon"
        ? `polígono ${config.polygon?.length ?? 0} pontos`
        : `linha (${L.x1},${L.y1})→(${L.x2},${L.y2})`;
    return `${config.mode} | ${t}`;
  }, [config]);

  const commitLine = useCallback(
    async (l: LineSeg) => {
      const dx = l.x1 - l.x2;
      const dy = l.y1 - l.y2;
      if (dx * dx + dy * dy < 64) {
        setCalibStatus("Linha muito curta: afaste mais as duas pontas.");
        return;
      }
      setLineSaving(true);
      try {
        const r = await fetch(apiUrl("/api/line"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            x1: l.x1,
            y1: l.y1,
            x2: l.x2,
            y2: l.y2,
            reset_counters: resetOnCalib,
          }),
        });
        const j = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(j.error || String(r.status));
        setCalibStatus("Linha atualizada.");
        await refreshConfig();
      } catch (e) {
        setCalibStatus(`Erro: ${e}`);
      } finally {
        setLineSaving(false);
      }
    },
    [resetOnCalib, refreshConfig]
  );

  const commitLineFullWidth = useCallback(() => {
    const iw = inferenceSize?.w ?? config?.inference_size?.w;
    const ih = inferenceSize?.h ?? config?.inference_size?.h;
    const L = config?.line;
    if (!iw || !ih || !L) {
      setCalibStatus(
        "Aguarde o primeiro frame do vídeo para calcular a largura em pixels."
      );
      return;
    }
    const ym = Math.round((L.y1 + L.y2) / 2);
    void commitLine({ x1: 0, y1: ym, x2: iw - 1, y2: ym });
  }, [inferenceSize, config?.inference_size, config?.line, commitLine]);

  async function applySource() {
    const s = sourceUrl.trim();
    if (!s) {
      setSourceMsg("Indique uma URL ou caminho.");
      return;
    }
    setSourceBusy(true);
    setSourceMsg("");
    setFeedError(null);
    setFeedLoaded(false);
    const ac = new AbortController();
    const to = window.setTimeout(() => ac.abort(), 120_000);
    try {
      const r = await fetch(apiUrl("/api/source"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: s }),
        signal: ac.signal,
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; source?: string };
      if (!r.ok) throw new Error(j.error || "Falha ao mudar fonte");
      setSourceMsg(`Fonte atual: ${j.source ?? s}`);
      await refreshConfig();
      bumpVideoFeed();
    } catch (e) {
      const aborted =
        (e instanceof DOMException || e instanceof Error) &&
        e.name === "AbortError";
      if (aborted) {
        setSourceMsg(
          "Tempo esgotado (120s). O servidor pode estar a bloquear na troca de fonte ou a fonte não responde."
        );
      } else {
        setSourceMsg(String(e));
      }
    } finally {
      window.clearTimeout(to);
      setSourceBusy(false);
    }
  }

  function onUploadFile(f: File | null) {
    if (!f) return;
    setUploadBusy(true);
    setUploadProcessing(false);
    setUploadProgress(0);
    setSourceMsg("");
    const fd = new FormData();
    fd.append("file", f);
    const url = apiUrl("/api/upload");
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        setUploadProgress(Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
      }
    });
    xhr.upload.addEventListener("load", () => {
      setUploadProgress(100);
      setUploadProcessing(true);
    });
    xhr.addEventListener("load", () => {
      setUploadProcessing(false);
      try {
        const j = JSON.parse(xhr.responseText || "{}") as {
          ok?: boolean;
          error?: string;
          path?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300) {
          setSourceMsg(`Ficheiro: ${j.path ?? "ok"}`);
          void refreshConfig().then(() => {
            setFeedError(null);
            bumpVideoFeed();
          });
        } else {
          setSourceMsg(j.error || `Upload falhou (${xhr.status})`);
        }
      } catch {
        setSourceMsg("Resposta inválida do servidor");
      } finally {
        setUploadBusy(false);
        setUploadProgress(null);
      }
    });
    xhr.addEventListener("error", () => {
      setUploadProcessing(false);
      setSourceMsg("Erro de rede ao enviar o ficheiro");
      setUploadBusy(false);
      setUploadProgress(null);
    });
    xhr.addEventListener("abort", () => {
      setUploadProcessing(false);
      setUploadBusy(false);
      setUploadProgress(null);
    });
    xhr.send(fd);
  }

  async function toggleHeatmap(next: boolean) {
    setHeatmapBusy(true);
    try {
      const r = await fetch(apiUrl("/api/heatmap"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok) throw new Error(j.error || "Falha");
      refreshConfig();
    } catch (e) {
      setSourceMsg(String(e));
    } finally {
      setHeatmapBusy(false);
    }
  }

  async function togglePlayback(next: boolean) {
    try {
      const r = await fetch(apiUrl("/api/playback"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playing: next }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error || "Falha ao mudar reprodução");
      setStats((s) =>
        s ? { ...s, inference_playing: next } : s
      );
    } catch (e) {
      setSourceMsg(String(e));
    }
  }

  async function exportCsv() {
    setExportMsg("");
    try {
      const r = await fetch(apiUrl("/api/export"), { method: "POST" });
      const j = (await r.json()) as { csv_path?: string };
      if (!r.ok) throw new Error("Falha ao exportar");
      setExportMsg(`CSV: ${j.csv_path ?? ""}`);
    } catch (e) {
      setExportMsg(String(e));
    }
  }

  const chartData = useMemo(() => {
    if (history.length === 0) return [];
    const t0 = history[0].t;
    return history.map((h) => ({
      label: new Date(h.t).toLocaleTimeString(),
      rel: (h.t - t0) / 1000,
      entries: h.entries,
      exits: h.exits,
      total: h.total,
    }));
  }, [history]);

  const heatAvailable = config?.heatmap_available !== false;
  const heatOn = config?.heatmap_overlay_enabled ?? false;

  const inferencePlaying = stats?.inference_playing !== false;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 pb-16">
      <header className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Contagem de pessoas
          </h1>
          <p className="mt-1 text-sm text-slate-400 max-w-xl">
            Detecção em tempo real: entradas, saídas e métricas opcionais por
            género (agregado). Mapa de calor no solo: agregado, sem identidade.
          </p>
        </div>
        <Link
          to="/roi"
          className="inline-flex items-center justify-center rounded-lg bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-300 ring-1 ring-cyan-500/40 hover:bg-cyan-500/25"
        >
          Modo ROI poligonal
        </Link>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Entradas"
          value={stats?.entries ?? "—"}
          accent="from-emerald-500/20 to-emerald-600/5"
        />
        <MetricCard
          label="Saídas"
          value={stats?.exits ?? "—"}
          accent="from-amber-500/20 to-amber-600/5"
        />
        <MetricCard
          label="Total passagens"
          value={stats?.total_passages ?? "—"}
          accent="from-violet-500/20 to-violet-600/5"
        />
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Estado
          </p>
          <p className="mt-2 text-lg font-semibold text-emerald-400/90">
            {stats?.error ? `Erro: ${stats.error}` : "Online"}
          </p>
        </div>
      </section>

      {stats?.sex_classifier_enabled ? (
        <section className="mb-8 rounded-2xl border border-indigo-500/20 bg-indigo-950/30 p-6">
          <p className="text-xs text-indigo-300/80 mb-4">
            Entradas por género (abstenção se confiança baixa). Totais agregados;
            ver documentação de privacidade no repositório.
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-slate-500 text-xs uppercase">Mulheres</p>
              <p className="text-2xl font-semibold text-white">
                {stats.sex_female_agg}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase">Homens</p>
              <p className="text-2xl font-semibold text-white">
                {stats.sex_male_agg}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs uppercase">Não classif.</p>
              <p className="text-2xl font-semibold text-white">
                {stats.sex_unknown_agg}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-semibold text-slate-300 mb-4">
          Fonte de vídeo
        </h2>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">
              URL ou caminho (ex. RTSP, ficheiro .mp4, ou URL YouTube)
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://... ou /caminho/video.mp4"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            />
          </div>
          <button
            type="button"
            disabled={sourceBusy}
            onClick={() => void applySource()}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {sourceBusy ? "A aplicar…" : "Aplicar fonte"}
          </button>
          <label className="cursor-pointer rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10">
            {uploadBusy
              ? uploadProcessing
                ? "A processar…"
                : "A enviar…"
              : "Enviar vídeo"}
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              className="hidden"
              disabled={uploadBusy}
              onChange={(e) => {
                onUploadFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {uploadBusy && uploadProgress !== null ? (
          <div className="mt-4 space-y-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>
                {uploadProcessing
                  ? "A guardar e aplicar no servidor…"
                  : `A enviar ficheiro… ${uploadProgress}%`}
              </span>
              {!uploadProcessing ? (
                <span className="tabular-nums">{uploadProgress}%</span>
              ) : null}
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-white/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress}
              aria-label="Progresso do upload de vídeo"
            >
              <div
                className={`h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-[width] duration-150 ease-out ${
                  uploadProcessing ? "animate-pulse" : ""
                }`}
                style={{
                  width: uploadProcessing ? "100%" : `${uploadProgress}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        {config?.current_source != null && config.current_source !== "" ? (
          <p className="mt-2 text-xs text-slate-500">
            Fonte atual (servidor): {String(config.current_source)}
          </p>
        ) : null}
        {sourceMsg ? (
          <p className="mt-3 text-sm text-slate-400">{sourceMsg}</p>
        ) : null}
      </section>

      <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-slate-300">
            Mapa de calor (overlay no vídeo)
          </h2>
          <div className="flex items-center gap-3">
            {!heatAvailable ? (
              <span className="text-xs text-slate-500">
                Indisponível (servidor iniciou com heatmap desligado)
              </span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={heatmapBusy}
                  onClick={() => void toggleHeatmap(!heatOn)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${
                    heatOn
                      ? "bg-orange-500/20 text-orange-200 ring-1 ring-orange-400/40"
                      : "bg-slate-700/50 text-slate-300"
                  }`}
                >
                  {heatmapBusy ? "…" : heatOn ? "Desligar overlay" : "Ligar overlay"}
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-slate-500 mb-2">
              Modo / geometria:{" "}
              <span className="text-slate-300">{modeInfo}</span>
            </p>
            <div className="relative inline-block max-w-full min-h-[240px] min-w-[min(100%,320px)] rounded-xl bg-black/50">
              {!feedLoaded && !feedError ? (
                <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center rounded-xl px-4 text-center text-sm text-slate-400">
                  À espera do primeiro frame do stream… Se estiver em pausa, prima
                  «Reproduzir».
                </div>
              ) : null}
              {feedError ? (
                <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center rounded-xl px-4 text-center text-sm text-amber-200/95">
                  {feedError}
                </div>
              ) : null}
              <img
                key={feedRev}
                ref={feedRef}
                src={videoFeedSrc}
                alt="Stream"
                draggable={false}
                onLoad={() => {
                  setFeedLoaded(true);
                  setFeedError(null);
                }}
                onError={() => {
                  setFeedLoaded(false);
                  setFeedError(
                    "Falha ao carregar /video_feed. Confirme que o servidor está a correr e que a fonte devolve vídeo."
                  );
                }}
                className={`relative z-[1] max-h-[min(85vh,900px)] w-auto max-w-full rounded-xl border border-white/10 ${
                  lineEditMode && config?.mode === "line"
                    ? "ring-2 ring-cyan-500/40"
                    : ""
                } ${!feedLoaded || feedError ? "opacity-0" : ""} ${
                  !inferencePlaying && feedLoaded ? "opacity-90" : ""
                }`}
              />
              <div className="pointer-events-none absolute right-2 top-2 z-[15]">
                {!inferencePlaying ? (
                  <span className="rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-500/40">
                    Pausa
                  </span>
                ) : null}
              </div>
              {config?.mode === "line" && lineEditMode && config.line ? (
                <VideoLineOverlay
                  active
                  line={{
                    x1: config.line.x1,
                    y1: config.line.y1,
                    x2: config.line.x2,
                    y2: config.line.y2,
                  }}
                  imgRef={feedRef}
                  onCommit={(seg) => void commitLine(seg)}
                  disabled={lineSaving}
                  inferenceSize={
                    inferenceSize ?? config.inference_size ?? null
                  }
                />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void togglePlayback(!inferencePlaying)}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600/90 px-5 py-2 text-sm font-medium text-white shadow hover:bg-emerald-500"
              >
                {inferencePlaying ? (
                  <>
                    <span className="inline-flex h-3.5 w-3 items-center justify-center gap-1">
                      <span className="h-3.5 w-1 rounded-sm bg-white" />
                      <span className="h-3.5 w-1 rounded-sm bg-white" />
                    </span>
                    Pausar vídeo e inferência
                  </>
                ) : (
                  <>
                    <span className="ml-0.5 inline-block border-y-8 border-l-[14px] border-y-transparent border-l-white" />
                    Reproduzir (modelo ativo)
                  </>
                )}
              </button>
              <p className="max-w-md text-center text-xs text-slate-500">
                Em pausa o vídeo local não avança e o modelo não corre. Em
                reprodução, o YOLO processa cada frame. Streams ao vivo seguem em
                tempo real quando a reproduzir está ligada.
              </p>
            </div>
            {config?.mode === "polygon" ? (
              <p className="mt-3 text-sm text-slate-500">
                Modo polígono ativo: desenhe a zona em{" "}
                <Link to="/roi" className="text-cyan-400 underline">
                  Modo ROI poligonal
                </Link>
                .
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const next = !lineEditMode;
                  setLineEditMode(next);
                  setCalibStatus(
                    next
                      ? "Arraste as bolas amarelas nas pontas da linha. Ao soltar, a linha é guardada no servidor."
                      : ""
                  );
                }}
                disabled={config?.mode !== "line"}
                className="rounded-lg bg-cyan-600/90 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-40"
              >
                {lineEditMode ? "Concluir ajuste" : "Ajustar linha (arrastar)"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLineEditMode(false);
                  setCalibStatus("");
                }}
                disabled={!lineEditMode}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
              >
                Sair do ajuste
              </button>
              <button
                type="button"
                onClick={() => {
                  setCalibStatus("");
                  commitLineFullWidth();
                }}
                disabled={config?.mode !== "line" || lineSaving}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/20 disabled:opacity-40"
                title="Segmento horizontal de borda a borda na altura média atual"
              >
                Linha em toda a largura
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await fetch(apiUrl("/api/line/reset"), {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reset_counters: resetOnCalib }),
                    });
                    const j = (await r.json()) as { error?: string };
                    if (!r.ok) throw new Error(j.error || "Erro");
                    setCalibStatus("Linha reposta ao valor inicial.");
                    refreshConfig();
                  } catch (e) {
                    setCalibStatus(String(e));
                  }
                }}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              >
                Repor linha inicial
              </button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={resetOnCalib}
                onChange={(e) => setResetOnCalib(e.target.checked)}
              />
              Zerar contadores ao aplicar nova linha
            </label>
            {calibStatus ? (
              <p className="mt-2 text-sm text-amber-200/90">{calibStatus}</p>
            ) : null}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h3 className="text-sm font-medium text-slate-300 mb-4">
              Histórico (sessão atual)
            </h3>
            <div className="h-64 w-full" style={{ minHeight: 256 }}>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={256}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gX" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="rel"
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      tickFormatter={(v) => `${Math.round(v)}s`}
                    />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{
                        background: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                      }}
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.label ?? ""
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="entries"
                      stroke="#34d399"
                      fill="url(#gE)"
                      strokeWidth={2}
                      name="Entradas"
                    />
                    <Area
                      type="monotone"
                      dataKey="exits"
                      stroke="#fbbf24"
                      fill="url(#gX)"
                      strokeWidth={2}
                      name="Saídas"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-500 text-sm py-12 text-center">
                  A aguardar dados…
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void exportCsv()}
            className="w-full rounded-xl border border-white/15 bg-gradient-to-r from-cyan-500/20 to-cyan-600/10 px-4 py-3 text-sm font-medium text-cyan-100 hover:from-cyan-500/30"
          >
            Exportar CSV
          </button>
          {exportMsg ? (
            <p className="text-xs text-slate-400">{exportMsg}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-gradient-to-br ${accent} p-5 backdrop-blur-sm`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{value}</p>
    </div>
  );
}
