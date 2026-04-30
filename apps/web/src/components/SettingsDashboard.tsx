/**
 * Dashboard de parametros do .env (via /api/settings) e metricas do treino (results.csv).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

interface Props {
  apiBase: string;
  onBack: () => void;
}

interface TrainingMetrics {
  run_dir: string;
  results_csv: string;
  last_epoch?: string;
  last_map50?: string;
  last_map50_95?: string;
  last_precision?: string;
  last_recall?: string;
  best_epoch?: string | null;
  best_map50?: string | null;
  best_map50_95?: string | null;
}

interface SettingsPayload {
  env: Record<string, string>;
  metrics: TrainingMetrics | null;
  editable_keys: string[];
  env_file: string;
}

type Section = { title: string; description?: string; keys: string[] };

const SECTIONS: Section[] = [
  {
    title: "Modelo e dispositivo",
    description: "Pesos YOLO e execução na GPU/CPU.",
    keys: [
      "YOLO_DEVICE",
      "YOLO_NO_HALF",
      "YOLO_INFER_MODEL",
      "PERSON_CLASS_ID",
    ],
  },
  {
    title: "Deteção (inferência)",
    keys: [
      "YOLO_INFER_CONF",
      "YOLO_MIN_DET_CONF",
      "YOLO_INFER_IMGSZ",
      "YOLO_INFER_IOU",
      "YOLO_MAX_DET",
      "YOLO_AUGMENT",
      "YOLO_AGNOSTIC_NMS",
      "YOLO_VID_STRIDE",
      "YOLO_STREAM_BUFFER",
      "INFER_NO_SHOW",
    ],
  },
  {
    title: "Linha de contagem e streams",
    keys: [
      "COUNT_LINE",
      "URL_HLS_OU_RTSP_OU_FICHEIRO",
      "YOLO_WEB_SOURCE",
      "YOLO_WEB_SOURCE_PRESETS",
    ],
  },
  {
    title: "Confiança de contagem",
    description: "Controla quando um cruzamento é registado. Valores mais altos = menos falsos; mais baixos = conta mais.",
    keys: [
      "TRACK_CONF_SUPPRESS_THRESHOLD",
      "TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD",
      "TRACK_CONF_MIN_AGE_FRAMES",
    ],
  },
  {
    title: "Reconexão de stream",
    description: "Watchdog que detecta stream parado (HLS expirado, RTSP silencioso) e reinicia automaticamente.",
    keys: [
      "YOLO_WATCHDOG_SOFT_S",
      "YOLO_WATCHDOG_HARD_S",
      "YOLO_FEED_STALE_S",
    ],
  },
  {
    title: "Persistência e analytics",
    description: "Destino dos dados de contagem. Reiniciar o servidor após alterar.",
    keys: [
      "ANALYTICS_KAFKA_PUBLISH",
      "DATABASE_URL",
      "KAFKA_BOOTSTRAP_SERVERS",
    ],
  },
  {
    title: "Alertas",
    description: "Notificações sonoras ao detectar boné/chapéu ou cor de veículo. Reiniciar após alterar.",
    keys: [
      "ALERT_CAP_ENABLED",
      "ALERT_CAP_THRESHOLD",
      "ALERT_CAR_COLOR",
      "ALERT_COOLDOWN",
    ],
  },
  {
    title: "ByteTrack / overlay",
    keys: [
      "YOLO_TRACKER",
      "YOLO_TRACK_EMA",
      "YOLO_TRACK_HOLD_FRAMES",
      "YOLO_HIDE_STALE_BOXES",
      "YOLO_OVERLAY_MIN_DET_CONF",
      "YOLO_OVERLAY_MIN_DET_CONF_VEHICLE",
      "YOLO_OVERLAY_VEHICLE_MIN_WIDTH_FRAC",
      "YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC",
      "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC",
      "YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC",
      "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC",
      "YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC",
      "YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC",
      "YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF",
      "YOLO_WEB_HEADING",
    ],
  },
  {
    title: "Filtros geométricos (bbox)",
    keys: [
      "YOLO_NO_SHAPE_FILTER",
      "YOLO_MIN_PERSON_AR",
      "YOLO_MAX_PERSON_AR",
      "YOLO_MAX_BOX_AREA_FRAC",
      "YOLO_MIN_PERSON_HEIGHT_PX",
    ],
  },
  {
    title: "Classificadores opcionais",
    keys: ["YOLO_SEX_MODEL", "YOLO_SEX_ABSTAIN", "YOLO_AGE_MODEL", "YOLO_AGE_ABSTAIN"],
  },
  {
    title: "FFmpeg / OpenCV",
    keys: ["OPENCV_FFMPEG_CAPTURE_OPTIONS", "FFMPEG_RELAY", "FFMPEG_STATIC_DIR", "CAP_PROP_BUFFERSIZE"],
  },
  {
    title: "Pré-visualização web (MJPEG)",
    keys: [
      "YOLO_WEB_PREVIEW_MAX_WIDTH",
      "YOLO_WEB_JPEG_QUALITY",
      "YOLO_WEB_TRAIL_LEN",
    ],
  },
  {
    title: "Mapa de calor",
    keys: ["WEB_HEATMAP", "HEAT_SCALE", "HEAT_DECAY", "HEAT_RADIUS", "HEAT_ALPHA", "HEAT_GAIN"],
  },
  {
    title: "Servidor HTTP",
    keys: ["WEB_HOST", "WEB_PORT"],
  },
];

const KEY_HINTS: Partial<Record<string, string>> = {
  YOLO_DEVICE: "0 = primeira GPU; cpu; auto",
  YOLO_NO_HALF: "1 = FP32 (mais lento na GPU)",
  YOLO_STREAM_BUFFER: '1 = fila Ultralytics (menos "Waiting for stream", mais latência)',
  YOLO_HIDE_STALE_BOXES: "1 = não desenhar caixas sem deteção neste frame",
  YOLO_OVERLAY_MIN_DET_CONF:
    "Conf. mínima da deteção (frame actual) para desenhar qualquer caixa; 0 = sem filtro extra no overlay.",
  YOLO_OVERLAY_MIN_DET_CONF_VEHICLE:
    "Igual, só para classes que não são pessoa (ex. veículos). Ajuda a cortar FP à noite.",
  YOLO_OVERLAY_VEHICLE_MIN_WIDTH_FRAC:
    "Largura mínima da bbox em fracção do frame (só não-pessoa no overlay). Corta fiapos na borda.",
  YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC:
    "Fracção da largura em cada lado: faixas laterais para o filtro de overlay de veículos. 0 = off.",
  YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC:
    "0 = só centro na margem; 0.3–0.7 = esconde se essa fracção da largura da bbox intersectar as margens (pilhas na borda). Vazio no .env = 0.5.",
  YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC:
    "Igual para classe pessoa no overlay (FP colados às bordas). 0 = off.",
  YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC:
    "Altura mínima da bbox / altura do frame para desenhar pessoa; corta reflexos miúdos. 0 = off.",
  YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC:
    "0 = só centro na margem; 0.3–0.7 = esconde se essa fracção da largura intersectar margens. Vazio no .env ≈ 0.5.",
  YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC:
    "0 = off. z>0: centro da bbox dentro de [z,1-z]×[z,1-z] exige conf >= GLARE_ZONE_MIN_CONF.",
  YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF:
    "Limiar extra de confiança na zona central (reflexo). Usar com GLARE_ZONE_FRAC > 0.",
  YOLO_WEB_SOURCE_PRESETS:
    'JSON: [{"label":"...","url":"..."}, ...]; em url pode ser m3u8 ou página .html skylinewebcams.com/webcam/...',
  WEB_HEATMAP: "0 = desliga heatmap",
  INFER_NO_SHOW: "Uso interno / flags de visualização",
  // Confiança de contagem
  TRACK_CONF_SUPPRESS_THRESHOLD:
    "Score mínimo [0-1] para contar o cruzamento de uma pessoa. Suba (ex. 0.45) se houver contagens falsas; desça (ex. 0.25) se pessoas reais forem ignoradas. Aplica-se no próximo stream (sem reiniciar).",
  TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD:
    "Mesmo limiar, mas para veículos. Carros têm bbox mais instável, por isso o padrão é mais baixo que o de pessoas.",
  TRACK_CONF_MIN_AGE_FRAMES:
    "Frames mínimos que uma pessoa precisa aparecer antes de poder cruzar a linha. 1 = mais sensível; 5+ = evita flashes mas pode perder passagens muito rápidas.",
  // Reconexão
  YOLO_WATCHDOG_SOFT_S:
    "Segundos sem frame novo antes de tentar reabrir o stream (soft reset). Aumente se o CDN for lento; reduza para reconectar mais rápido.",
  YOLO_WATCHDOG_HARD_S:
    "Segundos sem frame antes de matar e reiniciar o processo completo (hard reset via run_web.sh). Deve ser maior que SOFT.",
  YOLO_FEED_STALE_S:
    'Segundos sem frame novo antes de mostrar "FONTE OFFLINE" na tela. Não afeta a reconexão, só o aviso visual.',
  // Persistência
  ANALYTICS_KAFKA_PUBLISH:
    "0 = dados ficam só em memória (zero no banco). 1 = grava no banco via Kafka/Redpanda (requer run_analytics_kafka_consumer.sh ativo).",
  DATABASE_URL:
    "SQLAlchemy URL. Postgres: postgresql+psycopg2://user:pass@host:5433/db. SQLite local: sqlite:///data/contagem.db",
  KAFKA_BOOTSTRAP_SERVERS:
    "Endereço do broker Kafka/Redpanda. Ex.: 127.0.0.1:19092 (host) ou redpanda:9092 (Docker).",
  // Alertas
  ALERT_CAP_ENABLED:
    "1 = ativa deteção de boné/chapéu com CLIP (requer pip install open-clip-torch, ~350 MB).",
  ALERT_CAP_THRESHOLD:
    "Probabilidade mínima CLIP para confirmar boné [0-1]. Baixe se perder alertas; suba se tiver falsos positivos.",
  ALERT_CAR_COLOR:
    "Cores-alvo separadas por vírgula. Ex.: vermelho,amarelo. Deixe vazio para desativar. Valores: vermelho, laranja, amarelo, verde, azul, preto, branco, cinza.",
  ALERT_COOLDOWN:
    "Segundos mínimos entre alertas do mesmo tipo para o mesmo veículo/pessoa (evita beeps contínuos).",
};

function allSectionKeys(): Set<string> {
  const s = new Set<string>();
  SECTIONS.forEach((sec) => sec.keys.forEach((k) => s.add(k)));
  return s;
}

export function SettingsDashboard({ apiBase, onBack }: Props) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [, setActionTick] = useState(0);
  const postSaveTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const [postSave, setPostSave] = useState<
    | null
    | {
        kind: "stream_reload";
        startedAt: number;
        maxMs: number;
      }
    | { kind: "restart_required" }
  >(null);

  useEffect(() => {
    return () => {
      Object.values(postSaveTimers.current).forEach((t) => clearInterval(t));
      postSaveTimers.current = {};
    };
  }, []);

  const clearPostSaveTimer = (id: string) => {
    const t = postSaveTimers.current[id];
    if (t) clearInterval(t);
    delete postSaveTimers.current[id];
  };

  const beginPostSaveUx = (restartRequired: boolean, streamReload: boolean) => {
    Object.keys(postSaveTimers.current).forEach((k) => clearPostSaveTimer(k));
    setPostSave(null);

    if (restartRequired) {
      setPostSave({ kind: "restart_required" });
      return;
    }

    if (streamReload) {
      const id = "stream";
      const maxMs = 15000;
      setPostSave({ kind: "stream_reload", startedAt: Date.now(), maxMs });
      postSaveTimers.current[id] = setInterval(() => {
        setActionTick((t) => t + 1);
        setPostSave((cur) => {
          if (!cur || cur.kind !== "stream_reload") return cur;
          if (Date.now() - cur.startedAt >= cur.maxMs) {
            clearPostSaveTimer(id);
            return null;
          }
          return cur;
        });
      }, 350);
    }
  };

  const load = useCallback(async () => {
    setMsg(null);
    const url = `${apiBase}/api/settings`;
    let r: Response;
    try {
      r = await fetch(url);
    } catch {
      throw new Error(
        "Sem ligação ao backend. Inicie o Flask (bash scripts/run_web.sh; porta em WEB_PORT, omissão 8081). " +
          "Com pnpm dev, deixe VITE_API_BASE vazio para o proxy do Vite encaminhar /api."
      );
    }
    if (r.status === 404) {
      throw new Error(
        "404 em /api/settings: o processo Flask em execução é antigo. Pare (Ctrl+C) e reinicie bash scripts/run_web.sh para carregar a rota nova."
      );
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ao pedir ${url}`);
    const j: SettingsPayload = await r.json();
    setData(j);
    setForm({ ...j.env });
  }, [apiBase]);

  useEffect(() => {
    load()
      .catch((e) =>
        setMsg({
          text: e instanceof Error ? e.message : "Não foi possível carregar /api/settings.",
          ok: false,
        })
      )
      .finally(() => setLoading(false));
  }, [load]);

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setMsg(null);
    try {
      const changed: Record<string, string> = {};
      for (const k of data.editable_keys) {
        const a = (data.env[k] ?? "").trim();
        const b = (form[k] ?? "").trim();
        if (a !== b) changed[k] = form[k] ?? "";
      }
      if (Object.keys(changed).length === 0) {
        setMsg({ text: "Nenhuma alteração.", ok: true });
        setSaving(false);
        return;
      }
      const r = await fetch(`${apiBase}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const parts: string[] = [];
      if (j.restart_required) {
        parts.push(
          "Algumas chaves exigem reinicio do backend (modelo, GPU, porta HTTP, heatmap, filtros geometricos, fonte inicial).",
        );
      }
      if (j.stream_reload_requested) {
        parts.push(
          "Deteccao/track/FFmpeg: o stream de inferencia reabre sozinho em segundos — volte ao live ou actualize o /video_feed.",
        );
      }
      if (!j.restart_required && !j.stream_reload_requested) {
        parts.push("Valores guardados no .env.");
      }
      const hint = typeof j.hint === "string" ? j.hint : "";
      setMsg({
        text: `${parts.join(" ")} ${hint} Chaves: ${(j.updated as string[]).join(", ")}`.trim(),
        ok: true,
      });
      beginPostSaveUx(Boolean(j.restart_required), Boolean(j.stream_reload_requested));
      await load();
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const covered = allSectionKeys();
  const extraKeys =
    data?.editable_keys.filter((k) => !covered.has(k)) ?? [];

  const streamPct =
    postSave && postSave.kind === "stream_reload"
      ? Math.min(100, ((Date.now() - postSave.startedAt) / postSave.maxMs) * 100)
      : 0;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 20px 48px", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Configuração e métricas</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 0" }}>
            Valores efectivos do processo atual; ao guardar, o ficheiro <code style={{ fontSize: 12 }}>.env</code> é atualizado.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onBack} style={btnSecondary}>
            Voltar ao live
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            style={{
              ...btnPrimary,
              position: "relative",
              overflow: "hidden",
              minWidth: 170,
            }}
          >
            {postSave?.kind === "stream_reload" && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${streamPct}%`,
                  background: "rgba(255,255,255,0.16)",
                  transition: "width 0.2s linear",
                }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1 }}>
              {saving
                ? "A guardar…"
                : postSave?.kind === "stream_reload"
                  ? "A reabrir stream…"
                  : postSave?.kind === "restart_required"
                    ? "Reinício necessário"
                    : "Guardar alterações"}
            </span>
          </button>
        </div>
      </div>

      {postSave?.kind === "stream_reload" && (
        <div style={{ marginTop: -8, marginBottom: 16 }}>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${streamPct}%`,
                background: "linear-gradient(90deg, rgba(56,189,248,0.95), rgba(255,255,255,0.35))",
                transition: "width 0.2s linear",
              }}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
            Estimativa:{" "}
            <strong style={{ color: "var(--text-primary)" }}>
              {Math.max(0, Math.ceil(((postSave.startedAt + postSave.maxMs - Date.now()) / 1000) * 10) / 10)}s
            </strong>{" "}
            para concluir a reabertura do pipeline (ou até estabilizar).
          </div>
        </div>
      )}

      {postSave?.kind === "restart_required" && (
        <div style={{ marginTop: -8, marginBottom: 16 }}>
          <SettingsRestartButton
            apiBase={apiBase}
            onDone={() => setPostSave(null)}
          />
        </div>
      )}

      {data?.env_file && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          Ficheiro: <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{data.env_file}</span>
        </p>
      )}

      {msg && (
        <div
          style={{
            padding: "12px 14px",
            marginBottom: 16,
            borderRadius: "var(--radius-md)",
            background: msg.ok ? "var(--green-dim)" : "var(--red-dim)",
            color: msg.ok ? "var(--green)" : "var(--red)",
            fontSize: 13,
            border: `1px solid ${msg.ok ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
          }}
        >
          {msg.text}
        </div>
      )}

      {data?.metrics && (
        <div className="card" style={{ marginBottom: 20, padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>Métricas do treino (último run com results.csv)</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            Derivado de <code style={{ fontSize: 11 }}>YOLO_INFER_MODEL</code> → pasta do run.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, fontSize: 13 }}>
            <Metric label="Última época" value={data.metrics.last_epoch} />
            <Metric label="mAP50 (última)" value={data.metrics.last_map50} />
            <Metric label="mAP50-95 (última)" value={data.metrics.last_map50_95} />
            <Metric label="Precisão (última)" value={data.metrics.last_precision} />
            <Metric label="Recall (última)" value={data.metrics.last_recall} />
            <Metric label="Melhor época (mAP50)" value={data.metrics.best_epoch} />
            <Metric label="Melhor mAP50" value={data.metrics.best_map50} />
            <Metric label="Melhor mAP50-95" value={data.metrics.best_map50_95} />
          </div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, wordBreak: "break-all" }}>
            {data.metrics.run_dir}
          </p>
        </div>
      )}

      {data && !data.metrics && (data.env.YOLO_INFER_MODEL || "").length > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: 14, fontSize: 13, color: "var(--text-muted)" }}>
          Não foi encontrado <code>results.csv</code> na pasta do run do modelo actual. Métricas aparecem após treino Ultralytics.
        </div>
      )}

      {loading && <p style={{ color: "var(--text-muted)" }}>A carregar…</p>}

      {!loading && data && (
        <>
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="card" style={{ marginBottom: 16, padding: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>{sec.title}</h2>
              {sec.description && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px" }}>{sec.description}</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sec.keys.map((key) => (
                  <FieldRow
                    key={key}
                    k={key}
                    value={form[key] ?? ""}
                    hint={KEY_HINTS[key]}
                    onChange={(v) => setField(key, v)}
                  />
                ))}
              </div>
            </section>
          ))}

          {extraKeys.length > 0 && (
            <section className="card" style={{ marginBottom: 16, padding: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>Outros parâmetros</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {extraKeys.map((key) => (
                  <FieldRow
                    key={key}
                    k={key}
                    value={form[key] ?? ""}
                    hint={KEY_HINTS[key]}
                    onChange={(v) => setField(key, v)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
        <button type="button" onClick={onBack} style={btnSecondary}>
          Voltar ao live
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || loading} style={btnPrimary}>
          {saving ? "A guardar…" : "Guardar alterações"}
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--cyan)" }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function FieldRow({
  k,
  value,
  hint,
  onChange,
}: {
  k: string;
  value: string;
  hint?: string;
  onChange: (v: string) => void;
}) {
  const long = k.includes("PRESETS") || k.includes("OPTIONS") || k === "YOLO_INFER_MODEL";
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{k}</div>
      {long ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={k.includes("PRESETS") ? 4 : 3}
          style={inputStyle}
        />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {hint && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

function SettingsRestartButton({
  apiBase,
  onDone,
}: {
  apiBase: string;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "restarting" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleRestart = async () => {
    if (phase !== "idle") return;
    setPhase("restarting");
    setProgress(0);
    try { await fetch(`${apiBase}/api/restart`, { method: "POST" }); } catch { /* ok */ }
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      setProgress(Math.min(92, ((Date.now() - startedAt) / 28000) * 100));
    }, 200);
    await new Promise<void>((r) => setTimeout(r, 4000));
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/api/settings`, { cache: "no-store" });
        if (r.ok) {
          clear();
          setProgress(100);
          setPhase("done");
          setTimeout(() => { onDone?.(); }, 1800);
        }
      } catch { /* not ready */ }
    }, 900);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => clear(), []);

  const label =
    phase === "done" ? "Servidor pronto ✓"
    : phase === "restarting" ? (progress < 30 ? "A reiniciar…" : "A aguardar servidor…")
    : "Reiniciar servidor";

  return (
    <button
      type="button"
      disabled={phase !== "idle"}
      onClick={handleRestart}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        padding: "11px 16px",
        borderRadius: "var(--radius-md)",
        border: `1px solid rgba(239,68,68,${phase === "idle" ? "0.35" : "0.18"})`,
        background: phase === "idle" ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.06)",
        cursor: phase === "idle" ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {phase !== "idle" && (
        <span aria-hidden style={{
          position: "absolute", inset: 0,
          width: `${progress}%`,
          background: phase === "done" ? "rgba(34,197,94,0.20)" : "rgba(239,68,68,0.16)",
          transition: phase === "done" ? "width 0.4s ease" : "width 0.2s linear",
          pointerEvents: "none",
        }} />
      )}
      <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}>
        {phase === "done" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : phase === "restarting" ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.22-8.56" /></svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        )}
      </span>
      <span style={{
        position: "relative", zIndex: 1,
        color: phase === "done" ? "var(--green)" : "var(--red)",
        transition: "color 0.2s",
      }}>
        {label}
      </span>
      {phase !== "idle" && (
        <span style={{
          position: "relative", zIndex: 1,
          fontFamily: "var(--font-mono)", fontSize: 12,
          color: phase === "done" ? "var(--green)" : "rgba(239,68,68,0.7)",
          marginLeft: "auto",
        }}>
          {Math.round(progress)}%
        </span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </button>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  outline: "none",
};

const btnSecondary: CSSProperties = {
  padding: "10px 18px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-secondary)",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 13,
};

const btnPrimary: CSSProperties = {
  padding: "10px 18px",
  background: "var(--cyan-dim)",
  border: "1px solid var(--border-glow)",
  borderRadius: 8,
  color: "var(--cyan)",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13,
};
