import { memo, useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { HeatmapCanvas } from "./HeatmapCanvas";
import { useHeatmap } from "../hooks/useHeatmap";
import { useVehicleHeatmap } from "../hooks/useVehicleHeatmap";

interface SourcePreset {
  id: string;
  label: string;
  url: string;
}

interface HlsSourcePayload {
  ok?: boolean;
  url?: string;
  error?: string;
}

type StreamMode = "hls" | "mjpeg";

/** Skyline/CDN: pedidos XHR sem Referer costumam falhar (403 ou segmentos vazios); o backend FFmpeg já envia isto. */
const SKYLINE_HLS_REFERER = "https://www.skylinewebcams.com/";

function urlLooksLikeSkylineHls(u: string): boolean {
  return u.toLowerCase().includes("skylinewebcams");
}

/** v2: migração única — quem tinha só «hls» no v1 passa a MJPEG (overlay visível). */
const LIVE_FEED_STREAM_MODE_KEY = "livefeed.streamMode.v2";
const LIVE_FEED_STREAM_MODE_KEY_LEGACY = "livefeed.streamMode";

function readStoredStreamMode(): StreamMode {
  try {
    const v2 = localStorage.getItem(LIVE_FEED_STREAM_MODE_KEY);
    if (v2 === "hls" || v2 === "mjpeg") {
      return v2;
    }
    const leg = localStorage.getItem(LIVE_FEED_STREAM_MODE_KEY_LEGACY);
    if (leg === "hls" || leg === "mjpeg") {
      const migrated: StreamMode = leg === "hls" ? "mjpeg" : leg;
      localStorage.setItem(LIVE_FEED_STREAM_MODE_KEY, migrated);
      localStorage.removeItem(LIVE_FEED_STREAM_MODE_KEY_LEGACY);
      return migrated;
    }
  } catch {
    /* ignore */
  }
  return "mjpeg";
}

interface Props {
  apiBase: string;
  hero?: boolean;
  /** FPS do loop de inferência (/api/stats); opcional, mostrado no canto do vídeo. */
  inferFpsEma?: number;
}

function normalizeApiBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function LiveFeedComponent({ apiBase, hero = false, inferFpsEma }: Props) {
  const [error, setError]           = useState(false);
  const [loading, setLoading]       = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadKey, setReloadKey]   = useState(() => Date.now());
  const [streamMode, setStreamMode] = useState<StreamMode>(readStoredStreamMode);

  /* ── Camera presets ────────────────────────────────────────── */
  const [presets, setPresets]           = useState<SourcePreset[]>([]);
  const [currentSource, setCurrentSource] = useState<string>("");
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [switching, setSwitching]       = useState(false);
  const [presetsReady, setPresetsReady] = useState(false);
  /** Com lista de presets: não pedir /video_feed até o utilizador escolher uma câmera. */
  const [feedEngaged, setFeedEngaged]   = useState(false);
  const [sourceBootstrapErr, setSourceBootstrapErr] = useState<string | null>(null);

  const [showHeatmap, setShowHeatmap]             = useState(false);
  const [heatmapOpacity, setHeatmapOpacity]       = useState(0.6);
  const [showVehicleHeatmap, setShowVehicleHeatmap] = useState(false);
  const [vehicleHeatmapOpacity, setVehicleHeatmapOpacity] = useState(0.6);

  const heatmapPayload = useHeatmap(apiBase, showHeatmap);
  const vehicleHeatmapPayload = useVehicleHeatmap(apiBase, showVehicleHeatmap);

  const [isRecording, setIsRecording]       = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef   = useRef<MediaRecorder | null>(null);
  const recordedChunksRef  = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<number>(0);

  const imgRef       = useRef<HTMLImageElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);
  const hlsRef       = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* MJPEG multipart: o proxy do Vite (5173) pode bufferizar e o <img> nunca dispara onLoad.
     Em desenvolvimento, usar o Flask directamente (mesmo define que WEB_PORT). */
  const feedOrigin = (() => {
    const o = import.meta.env.VITE_VIDEO_FEED_ORIGIN?.trim();
    if (o) return o.replace(/\/$/, "");
    if (import.meta.env.DEV && import.meta.env.VITE_DEV_FLASK_ORIGIN) {
      return String(import.meta.env.VITE_DEV_FLASK_ORIGIN).replace(/\/$/, "");
    }
    return normalizeApiBase(apiBase);
  })();
  const hlsMetaUrl = `${feedOrigin}/api/source/hls?t=${reloadKey}`;
  const mjpegUrl = `${feedOrigin}/video_feed?t=${reloadKey}`;
  const src = streamMode === "hls" ? hlsMetaUrl : mjpegUrl;
  const resolvedApiBase = normalizeApiBase(apiBase);
  const apiSourceDisplayUrl = resolvedApiBase ? `${resolvedApiBase}/api/source` : "/api/source";

  /* ── Load presets on mount (timeout evita ficar preso se a API nao responder) ─ */
  useEffect(() => {
    const base = normalizeApiBase(apiBase);
    const url = base ? `${base}/api/source` : "/api/source";
    const rawMs = import.meta.env.VITE_API_SOURCE_TIMEOUT_MS;
    const timeoutMs =
      Number.isFinite(Number(rawMs)) && Number(rawMs) > 2000 ? Number(rawMs) : 15000;
    const ctrl = new AbortController();
    const tid = window.setTimeout(() => ctrl.abort(), timeoutMs);
    let discarded = false;

    (async () => {
      setSourceBootstrapErr(null);
      try {
        const r = await fetch(url, { signal: ctrl.signal, credentials: "omit" });
        window.clearTimeout(tid);
        if (discarded) return;
        if (!r.ok) {
          throw new Error(`HTTP ${r.status} em /api/source`);
        }
        const d = (await r.json()) as Record<string, unknown>;
        setCurrentSource(typeof d.source === "string" ? d.source : "");
        setActivePresetId(typeof d.active_preset_id === "string" ? d.active_preset_id : "");
        const list = Array.isArray(d.presets) ? (d.presets as SourcePreset[]) : [];
        setPresets(list);
        const multi = list.length > 0;
        setFeedEngaged(!multi);
      } catch (e) {
        window.clearTimeout(tid);
        if (discarded) return;
        const aborted =
          (e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");
        if (aborted) {
          setSourceBootstrapErr(
            `Sem resposta de ${url} em ${Math.round(timeoutMs / 1000)}s. ` +
              "Confirme `bash scripts/run_web.sh`, a porta WEB_PORT no .env da raiz e " +
              "`VITE_API_BASE` em apps/web/.env (ou deixe vazio para usar o proxy do Vite na porta 5173).",
          );
        } else {
          setSourceBootstrapErr(
            e instanceof Error ? e.message : "Falha ao obter /api/source",
          );
        }
        setPresets([]);
        setFeedEngaged(true);
      } finally {
        if (!discarded) setPresetsReady(true);
      }
    })();

    return () => {
      discarded = true;
      window.clearTimeout(tid);
      ctrl.abort();
    };
  }, [apiBase]);

  useEffect(() => {
    if (!feedEngaged) return;
    setError(false);
    setLoading(true);
  }, [src, feedEngaged]);

  useEffect(() => {
    if (streamMode !== "hls") return;
    if (!feedEngaged) return;
    const video = videoRef.current;
    if (!video) return;
    const ctrl = new AbortController();
    let cancelled = false;

    const cleanupPlayer = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    (async () => {
      try {
        const res = await fetch(hlsMetaUrl, {
          signal: ctrl.signal,
          credentials: "omit",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} em /api/source/hls`);
        const body = (await res.json()) as HlsSourcePayload;
        const hlsUrl = typeof body.url === "string" ? body.url.trim() : "";
        if (!hlsUrl) throw new Error(body.error || "URL HLS indisponível");

        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            xhrSetup(xhr, reqUrl) {
              try {
                if (
                  urlLooksLikeSkylineHls(String(reqUrl)) ||
                  urlLooksLikeSkylineHls(hlsUrl)
                ) {
                  xhr.setRequestHeader("Referer", SKYLINE_HLS_REFERER);
                }
              } catch {
                /* ignore */
              }
            },
          });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (cancelled) return;
            void video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (cancelled || !data.fatal) return;
            setError(true);
            setLoading(false);
          });
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          return;
        }

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = hlsUrl;
          void video.play().catch(() => {});
          return;
        }

        throw new Error("Este navegador não suporta HLS.");
      } catch {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
      cleanupPlayer();
    };
  }, [hlsMetaUrl, feedEngaged, streamMode]);

  /* Se o player HLS nao arrancar, nao ficar eternamente a carregar. */
  useEffect(() => {
    if (!feedEngaged || error || !loading) return;
    const raw = import.meta.env.VITE_VIDEO_FEED_LOAD_TIMEOUT_MS;
    const ms = raw ? Number(raw) : 120000;
    const t = window.setTimeout(() => {
      setError(true);
      setLoading(false);
    }, Number.isFinite(ms) && ms > 0 ? ms : 120000);
    return () => window.clearTimeout(t);
  }, [src, loading, error, feedEngaged]);

  /* ── Active preset index ───────────────────────────────────── */
  const activeIdx = (() => {
    if (activePresetId) {
      const i = presets.findIndex((p) => p.id === activePresetId);
      if (i >= 0) return i;
    }
    return presets.findIndex((p) => p.url.trim() === currentSource.trim());
  })();

  /* ── Switch camera by preset index ────────────────────────── */
  const switchCamera = async (idx: number) => {
    if (idx < 0 || idx >= presets.length || switching) return;
    setSwitching(true);
    try {
      const res = await fetch(`${apiBase}/api/source/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: presets[idx].id }),
      });
      if (res.ok) {
        const j = await res.json();
        setCurrentSource(j.source ?? presets[idx].url);
        if (typeof j.active_preset_id === "string") {
          setActivePresetId(j.active_preset_id);
        } else {
          setActivePresetId(presets[idx].id);
        }
        setFeedEngaged(true);
        setReloadKey(Date.now());
      }
    } catch { /* ignore */ } finally {
      setSwitching(false);
    }
  };

  const prevCamera = () => {
    const next = activeIdx <= 0 ? presets.length - 1 : activeIdx - 1;
    void switchCamera(next);
  };

  const nextCamera = () => {
    const next = activeIdx < 0 || activeIdx >= presets.length - 1 ? 0 : activeIdx + 1;
    void switchCamera(next);
  };

  /* ── Reload ────────────────────────────────────────────────── */
  const handleReload = useCallback(() => {
    if (!feedEngaged) return;
    setError(false);
    setLoading(true);
    setReloadKey(Date.now());
  }, [feedEngaged]);

  /* ── Fullscreen ────────────────────────────────────────────── */
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen(); } catch { /* blocked */ }
    } else {
      await document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  /* ── Recording ────────────────────────────────────────────── */
  const startRecording = useCallback(() => {
    if (streamMode !== "hls") return;
    const video = videoRef.current;
    if (!video || isRecording) return;
    const mediaEl = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const stream =
      typeof mediaEl.captureStream === "function"
        ? mediaEl.captureStream()
        : typeof mediaEl.mozCaptureStream === "function"
          ? mediaEl.mozCaptureStream()
          : null;
    if (!stream) return;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "video/mp4";

    const recorder = new MediaRecorder(stream, { mimeType });
    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      window.clearInterval(recordingIntervalRef.current);
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `gravacao_${new Date().toISOString().replace(/[:.]/g, "-")}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
      a.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
      setRecordingSeconds(0);
    };

    mediaRecorderRef.current = recorder;
    recorder.start(1000);
    setIsRecording(true);
    setRecordingSeconds(0);
    recordingIntervalRef.current = window.setInterval(
      () => setRecordingSeconds((s) => s + 1),
      1000,
    );
  }, [isRecording, streamMode]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
      window.clearInterval(recordingIntervalRef.current);
    };
  }, [stopRecording]);

  useEffect(() => {
    if (streamMode !== "hls" && isRecording) {
      stopRecording();
    }
  }, [streamMode, isRecording, stopRecording]);

  const canRecord = streamMode === "hls";

  return (
    <div
      ref={containerRef}
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "#050507",
        height: "100%",
        position: "relative",
        ...(isFullscreen ? { borderRadius: 0, border: "none" } : {}),
      }}
    >
      {/* ── Titlebar ────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          background: isFullscreen ? "rgba(0,0,0,0.8)" : "var(--bg-elevated)",
          borderBottom: "1px solid var(--border)",
          position: isFullscreen ? "absolute" : "relative",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          flexShrink: 0,
          gap: 8,
        }}
      >
        {/* Left: title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span className="pulse-dot active" />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
            }}
          >
            Feed ao Vivo
          </span>
        </div>

        {/* Right: controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>

          {/* ── Camera picker (only when presets exist) ── */}
          {presets.length > 0 && (
            <CameraPicker
              presets={presets}
              activeIdx={activeIdx}
              switching={switching}
              onSwitch={switchCamera}
              onPrev={prevCamera}
              onNext={nextCamera}
            />
          )}

          {/* ── Reload button ── */}
          <button
            onClick={handleReload}
            title={feedEngaged ? "Recarregar stream" : "Seleccione uma câmera para iniciar o vídeo"}
            disabled={!feedEngaged}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: feedEngaged ? "pointer" : "not-allowed",
              padding: "4px 8px",
              color: feedEngaged ? "var(--text-muted)" : "var(--text-muted)",
              opacity: feedEngaged ? 1 : 0.4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.borderColor = "var(--border-accent)";
              b.style.color = "var(--amber)";
            }}
            onMouseLeave={(e) => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.borderColor = "var(--border)";
              b.style.color = "var(--text-muted)";
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 4v6h-6"/>
              <path d="M1 20v-6h6"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/>
              <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>

          {/* ── Stream mode toggle ── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              background: "var(--bg-surface)",
            }}
          >
            <button
              onClick={() => {
                if (streamMode === "hls") return;
                setError(false);
                setLoading(true);
                setStreamMode("hls");
                try {
                  localStorage.setItem(LIVE_FEED_STREAM_MODE_KEY, "hls");
                } catch {
                  /* ignore */
                }
                setReloadKey(Date.now());
              }}
              title="HLS: vídeo mais fluido no browser, sem caixas de deteção. Para ver as caixas YOLO, use MJPEG."
              style={{
                padding: "4px 8px",
                border: "none",
                background: streamMode === "hls" ? "var(--amber-dim)" : "transparent",
                color: streamMode === "hls" ? "var(--amber)" : "var(--text-muted)",
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              HLS
            </button>
            <button
              onClick={() => {
                if (streamMode === "mjpeg") return;
                setError(false);
                setLoading(true);
                setStreamMode("mjpeg");
                try {
                  localStorage.setItem(LIVE_FEED_STREAM_MODE_KEY, "mjpeg");
                } catch {
                  /* ignore */
                }
                setReloadKey(Date.now());
              }}
              title="MJPEG: feed do servidor com caixas de deteção e etiquetas (recomendado para validar contagem)"
              style={{
                padding: "4px 8px",
                border: "none",
                borderLeft: "1px solid var(--border)",
                background: streamMode === "mjpeg" ? "var(--amber-dim)" : "transparent",
                color: streamMode === "mjpeg" ? "var(--amber)" : "var(--text-muted)",
                fontFamily: "var(--font-display)",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              MJPEG
            </button>
          </div>

          {/* ── Record button ── */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!feedEngaged || loading || error || !canRecord}
            title={
              isRecording
                ? `Parar gravação (${formatDuration(recordingSeconds)})`
                : canRecord
                  ? "Gravar vídeo do stream"
                  : "Gravação disponível apenas no modo HLS"
            }
            style={{
              background: isRecording ? "rgba(239,68,68,0.15)" : "var(--bg-surface)",
              border: `1px solid ${isRecording ? "var(--red)" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)",
              cursor: feedEngaged && !loading && !error && canRecord ? "pointer" : "not-allowed",
              padding: "4px 8px",
              color: isRecording ? "var(--red)" : "var(--text-muted)",
              opacity: feedEngaged && !loading && !error && canRecord ? 1 : 0.4,
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "background 0.15s, border-color 0.15s, color 0.15s",
            }}
          >
            {isRecording ? (
              <>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: "var(--red)",
                    animation: "pulse 0.9s infinite",
                    flexShrink: 0,
                  }}
                />
                {formatDuration(recordingSeconds)}
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="9" />
                </svg>
                REC
              </>
            )}
          </button>

          {/* ── Heatmap toggle ── */}
          <button
            onClick={() => setShowHeatmap((v) => !v)}
            title={showHeatmap ? "Ocultar heatmap de sessão" : "Mostrar heatmap de sessão"}
            style={{
              background: showHeatmap ? "rgba(61,170,200,0.15)" : "var(--bg-surface)",
              border: `1px solid ${showHeatmap ? "var(--cyan)" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              padding: "4px 8px",
              color: showHeatmap ? "var(--cyan)" : "var(--text-muted)",
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "background 0.15s, border-color 0.15s, color 0.15s",
            }}
          >
            {/* flame icon */}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2c0 0-4 4-4 9a4 4 0 0 0 8 0c0-5-4-9-4-9z"/>
              <path d="M12 12c0 0-2 2-2 4a2 2 0 0 0 4 0c0-2-2-4-2-4z"/>
            </svg>
            Heat
          </button>

          {/* ── Opacity slider (only when heatmap is on) ── */}
          {showHeatmap && (
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={heatmapOpacity}
              onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
              title={`Opacidade: ${Math.round(heatmapOpacity * 100)}%`}
              style={{
                width: 56,
                accentColor: "var(--cyan)",
                cursor: "pointer",
              }}
            />
          )}

          {/* ── Vehicle heatmap toggle ── */}
          <button
            onClick={() => setShowVehicleHeatmap((v) => !v)}
            title={showVehicleHeatmap ? "Ocultar heatmap de veículos" : "Mostrar heatmap de veículos"}
            style={{
              background: showVehicleHeatmap ? "rgba(249,115,22,0.15)" : "var(--bg-surface)",
              border: `1px solid ${showVehicleHeatmap ? "#F97316" : "var(--border)"}`,
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              padding: "4px 8px",
              color: showVehicleHeatmap ? "#F97316" : "var(--text-muted)",
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "background 0.15s, border-color 0.15s, color 0.15s",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17H5a2 2 0 0 1-2-2V9l2-4h10l2 4"/>
              <path d="M5 13h14"/>
              <circle cx="7.5" cy="17" r="1.5"/>
              <circle cx="16.5" cy="17" r="1.5"/>
            </svg>
            Veíc
          </button>

          {/* ── Vehicle opacity slider ── */}
          {showVehicleHeatmap && (
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={vehicleHeatmapOpacity}
              onChange={(e) => setVehicleHeatmapOpacity(Number(e.target.value))}
              title={`Opacidade veículos: ${Math.round(vehicleHeatmapOpacity * 100)}%`}
              style={{
                width: 56,
                accentColor: "#F97316",
                cursor: "pointer",
              }}
            />
          )}

          {/* ── LIVE / STANDBY badge ── */}
          <div
            className={feedEngaged ? "badge badge-red" : "badge"}
            style={{
              fontSize: 10,
              padding: "2px 7px",
              ...(feedEngaged
                ? {}
                : {
                    border: "1px solid var(--border)",
                    background: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                  }),
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: feedEngaged ? "var(--red)" : "var(--text-muted)",
                display: "inline-block",
                animation: feedEngaged ? "pulse 0.9s infinite" : "none",
              }}
            />
            {feedEngaged ? "LIVE" : "STANDBY"}
          </div>

          {/* ── Fullscreen toggle ── */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}
            style={{
              background: "var(--amber-dim)",
              border: "1px solid var(--border-accent)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              padding: "4px 9px",
              color: "var(--amber)",
              fontFamily: "var(--font-display)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              display: "flex",
              alignItems: "center",
              gap: 5,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--amber-glow)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--amber-dim)";
            }}
          >
            {isFullscreen ? (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
                  <path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
                </svg>
                Sair
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 7V3h4"/><path d="M21 7V3h-4"/>
                  <path d="M3 17v4h4"/><path d="M21 17v4h-4"/>
                </svg>
                Expand
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Video area ──────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          flex: 1,
          minHeight: isFullscreen
            ? "100vh"
            : hero
              ? "clamp(380px, min(68vh, 85vw), 920px)"
              : 320,
          background: "#050507",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        {(!presetsReady || sourceBootstrapErr) && (
          <PresetsBootstrapPlaceholder
            error={sourceBootstrapErr}
            apiUrl={apiSourceDisplayUrl}
            onDismiss={sourceBootstrapErr ? () => setSourceBootstrapErr(null) : undefined}
          />
        )}

        {presetsReady && !feedEngaged && presets.length > 0 && (
          <IdleStandbyPlaceholder presetCount={presets.length} />
        )}

        {/* Loading state (só após escolha de câmera ou fonte única) */}
        {feedEngaged && loading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
              color: "var(--text-muted)",
              zIndex: 2,
            }}
          >
            <LoadingSpinner />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 12,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Aguardando stream…
            </span>
          </div>
        )}

        {feedEngaged && error ? (
          <ErrorState onRetry={handleReload} />
        ) : feedEngaged ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {streamMode === "hls" ? (
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                controls={false}
                onLoadedData={() => setLoading(false)}
                onError={() => {
                  setError(true);
                  setLoading(false);
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: isFullscreen || hero ? "contain" : "cover",
                  display: loading ? "none" : "block",
                  transform: "translate3d(0, 0, 0)",
                  backfaceVisibility: "hidden",
                  ...(isFullscreen ? { maxHeight: "100vh" } : {}),
                }}
              />
            ) : (
              <img
                ref={imgRef}
                src={mjpegUrl}
                alt="Feed de vídeo"
                decoding="async"
                onLoad={() => setLoading(false)}
                onError={() => {
                  setError(true);
                  setLoading(false);
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: isFullscreen || hero ? "contain" : "cover",
                  display: loading ? "none" : "block",
                  transform: "translate3d(0, 0, 0)",
                  backfaceVisibility: "hidden",
                  ...(isFullscreen ? { maxHeight: "100vh" } : {}),
                }}
              />
            )}
            {streamMode === "hls" && feedEngaged && !loading && !error && (
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  right: 10,
                  bottom: 10,
                  zIndex: 6,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.78)",
                  border: "1px solid rgba(245,158,11,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    lineHeight: 1.45,
                  }}
                >
                  Modo <strong style={{ color: "var(--amber)" }}>HLS</strong>: este{" "}
                  <code style={{ fontSize: 10 }}>&lt;video&gt;</code> mostra só o stream no browser,{" "}
                  <strong>sem</strong> caixas YOLO. Use MJPEG para ver deteções desenhadas pelo servidor.
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setError(false);
                    setLoading(true);
                    setStreamMode("mjpeg");
                    try {
                      localStorage.setItem(LIVE_FEED_STREAM_MODE_KEY, "mjpeg");
                    } catch {
                      /* ignore */
                    }
                    setReloadKey(Date.now());
                  }}
                  style={{
                    flexShrink: 0,
                    padding: "7px 14px",
                    borderRadius: 6,
                    border: "1px solid var(--amber)",
                    background: "rgba(245,158,11,0.14)",
                    color: "var(--amber)",
                    fontWeight: 700,
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Ver com deteção (MJPEG)
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* Heatmap canvas overlay — pessoas */}
        {feedEngaged && showHeatmap && !loading && !error && (
          <HeatmapCanvas payload={heatmapPayload} opacity={heatmapOpacity} />
        )}

        {/* Heatmap canvas overlay — veículos */}
        {feedEngaged && showVehicleHeatmap && !loading && !error && (
          <HeatmapCanvas payload={vehicleHeatmapPayload} opacity={vehicleHeatmapOpacity} />
        )}

        {feedEngaged && !loading && !error && typeof inferFpsEma === "number" && (
          <div
            title="FPS médio do processamento YOLO (não é o FPS do ficheiro/stream)"
            style={{
              position: "absolute",
              top: isFullscreen ? 52 : 12,
              right: 12,
              zIndex: 4,
              padding: "5px 10px",
              borderRadius: 6,
              background: "rgba(0,0,0,0.62)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: inferFpsEma > 0.05 ? "var(--cyan)" : "var(--text-muted)",
              pointerEvents: "none",
            }}
          >
            {inferFpsEma > 0.05 ? `${inferFpsEma.toFixed(1)} FPS` : "— FPS"}
          </div>
        )}

        {/* Corner bracket decorations */}
        {feedEngaged && !isFullscreen && !loading && !error && (
          <>
            <div className="corner-bracket" />
            <div className="corner-bracket-br" />
            <div
              style={{
                position: "absolute",
                bottom: 10,
                right: 36,
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "rgba(255,255,255,0.22)",
                pointerEvents: "none",
                letterSpacing: "0.06em",
              }}
            >
              PRESS F
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── CameraPicker ─────────────────────────────────────────────── */
interface CameraPickerProps {
  presets: SourcePreset[];
  activeIdx: number;
  switching: boolean;
  onSwitch: (idx: number) => void;
  onPrev: () => void;
  onNext: () => void;
}

function CameraPicker({ presets, activeIdx, switching, onSwitch, onPrev, onNext }: CameraPickerProps) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const activePreset = activeIdx >= 0 ? presets[activeIdx] : null;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = activeIdx < presets.length - 1 ? activeIdx + 1 : 0;
        onSwitch(next);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = activeIdx > 0 ? activeIdx - 1 : presets.length - 1;
        onSwitch(prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, activeIdx, presets.length, onSwitch]);

  return (
    <div ref={pickerRef} style={{ position: "relative", flexShrink: 0 }}>
      <style>{`
        @keyframes cam-picker-in {
          from { opacity: 0; transform: translateY(-5px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes cam-active-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>

      {/* ── Control row: prev · trigger · next ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>

        {/* Prev */}
        <button
          onClick={onPrev}
          disabled={switching || presets.length < 2}
          title="Câmera anterior  (←)"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            cursor: switching || presets.length < 2 ? "not-allowed" : "pointer",
            padding: "4px 6px",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: presets.length < 2 ? 0.35 : 1,
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            if (presets.length >= 2 && !switching) {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-accent)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
          }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Trigger */}
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={switching}
          title="Selecionar câmera"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 9px 4px 7px",
            background: open ? "var(--amber-dim)" : "var(--bg-surface)",
            border: `1px solid ${open ? "var(--border-accent)" : "var(--border)"}`,
            borderRadius: "var(--radius-sm)",
            cursor: switching ? "wait" : "pointer",
            color: switching ? "var(--amber)" : open ? "var(--amber)" : "var(--text-secondary)",
            fontFamily: "var(--font-display)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
            minWidth: 90,
          }}
          onMouseEnter={(e) => {
            if (!open && !switching) {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-accent)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)";
            }
          }}
          onMouseLeave={(e) => {
            if (!open && !switching) {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
            }
          }}
        >
          {/* Camera icon */}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 7l-7 5 7 5V7z"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>

          {/* Label */}
          <span style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 80,
          }}>
            {switching ? "…" : (activePreset?.label ?? "—")}
          </span>

          {/* Chevron */}
          <svg
            width="8" height="8"
            viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round"
            style={{
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.18s ease",
              flexShrink: 0,
              opacity: 0.7,
            }}
          >
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {/* Next */}
        <button
          onClick={onNext}
          disabled={switching || presets.length < 2}
          title="Próxima câmera  (→)"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            cursor: switching || presets.length < 2 ? "not-allowed" : "pointer",
            padding: "4px 6px",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: presets.length < 2 ? 0.35 : 1,
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            if (presets.length >= 2 && !switching) {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-accent)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
          }}
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 210,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)",
            overflow: "hidden",
            zIndex: 200,
            animation: "cam-picker-in 0.15s ease both",
          }}
        >
          {/* Header */}
          <div style={{
            padding: "7px 10px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{
              fontFamily: "var(--font-display)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}>
              Câmeras · {presets.length}
            </span>
            <span style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--text-muted)",
              opacity: 0.5,
            }}>
              ↑↓ navegar · ESC fechar
            </span>
          </div>

          {/* List */}
          <div style={{ padding: 4 }}>
            {presets.map((p, i) => {
              const isActive = i === activeIdx;
              const isHov = hovered === i;
              return (
                <button
                  key={p.id}
                  onClick={() => { onSwitch(i); setOpen(false); }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  title={p.url}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    background: isActive
                      ? "var(--amber-dim)"
                      : isHov
                        ? "var(--bg-elevated)"
                        : "transparent",
                    border: "none",
                    borderLeft: `2px solid ${isActive ? "var(--amber)" : "transparent"}`,
                    borderRadius: 4,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.1s, border-left-color 0.1s",
                    boxSizing: "border-box",
                  }}
                >
                  {/* Index badge */}
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: 3,
                    background: isActive ? "var(--amber)" : "var(--bg-elevated)",
                    color: isActive ? "#0a0a0b" : "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    transition: "background 0.1s, color 0.1s",
                    letterSpacing: "0.02em",
                  }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  {/* Label */}
                  <span style={{
                    flex: 1,
                    fontFamily: "var(--font-display)",
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: isActive ? "var(--amber)" : isHov ? "var(--text-primary)" : "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    transition: "color 0.1s",
                  }}>
                    {p.label}
                  </span>

                  {/* Active indicator */}
                  {isActive && (
                    <span style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--amber)",
                      flexShrink: 0,
                      animation: "cam-active-pulse 1.8s ease-in-out infinite",
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export const LiveFeed = memo(LiveFeedComponent);
LiveFeed.displayName = "LiveFeed";

function PresetsBootstrapPlaceholder({
  error,
  apiUrl,
  onDismiss,
}: {
  error: string | null;
  apiUrl: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 12,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        background:
          "radial-gradient(ellipse 85% 70% at 50% 42%, rgba(255,149,0,0.07) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 50% 100%, rgba(0,180,216,0.05) 0%, transparent 45%), #050507",
      }}
    >
      {!error && (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.06)",
            borderTopColor: "var(--amber)",
            animation: "spin 0.85s linear infinite",
          }}
        />
      )}
      <div style={{ textAlign: "center", maxWidth: 420, padding: "0 24px" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            marginBottom: 8,
          }}
        >
          VisionCount
        </div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55 }}>
          {error ? (
            <>
              <span style={{ color: "var(--red)", fontWeight: 600 }}>API inacessível</span>
              <div
                style={{
                  marginTop: 12,
                  padding: "12px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  background: "var(--red-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  textAlign: "left",
                  wordBreak: "break-word",
                }}
              >
                {error}
              </div>
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-secondary)" }}>
                Pedido: <span style={{ color: "var(--amber)" }}>{apiUrl}</span>
              </div>
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  style={{
                    marginTop: 18,
                    padding: "10px 22px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-accent)",
                    background: "var(--amber-dim)",
                    color: "var(--amber)",
                    fontFamily: "var(--font-display)",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Fechar e tentar o vídeo
                </button>
              )}
            </>
          ) : (
            "A preparar o painel de fontes…"
          )}
        </div>
      </div>
    </div>
  );
}

function IdleStandbyPlaceholder({ presetCount }: { presetCount: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        textAlign: "center",
        overflow: "hidden",
        background: `
          radial-gradient(ellipse 100% 80% at 50% -10%, rgba(255,149,0,0.12) 0%, transparent 50%),
          radial-gradient(ellipse 70% 55% at 80% 60%, rgba(0,180,216,0.06) 0%, transparent 42%),
          radial-gradient(ellipse 55% 45% at 15% 75%, rgba(129,140,248,0.05) 0%, transparent 40%),
          linear-gradient(165deg, #0a0a0f 0%, #050507 48%, #08080e 100%)
        `,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: "12% 8%",
          border: "1px solid rgba(255,149,0,0.12)",
          borderRadius: 12,
          pointerEvents: "none",
          boxShadow: "inset 0 0 80px rgba(0,0,0,0.35)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 220,
          height: 220,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.04)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -52%)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: 140,
          height: 140,
          borderRadius: "50%",
          border: "1px solid rgba(255,149,0,0.08)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -52%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          width: 72,
          height: 72,
          marginBottom: 26,
          borderRadius: 18,
          background: "linear-gradient(145deg, rgba(255,149,0,0.18) 0%, rgba(255,149,0,0.04) 100%)",
          border: "1px solid rgba(255,149,0,0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 20px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      >
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
          <path d="M5 12h6" opacity="0.45" />
        </svg>
      </div>

      <h2
        style={{
          position: "relative",
          fontFamily: "var(--font-display)",
          fontSize: "clamp(1.05rem, 2.2vw, 1.35rem)",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-primary)",
          marginBottom: 12,
          lineHeight: 1.35,
        }}
      >
        Monitor em espera
      </h2>
      <p
        style={{
          position: "relative",
          fontFamily: "var(--font-sans)",
          fontSize: 14,
          color: "var(--text-secondary)",
          maxWidth: 400,
          lineHeight: 1.65,
          marginBottom: 22,
        }}
      >
        O vídeo só liga depois de escolher uma câmera. Use o menu <strong style={{ color: "var(--amber)" }}>acima</strong>{" "}
        (ícone de câmera) e seleccione uma das {presetCount} fonte{presetCount !== 1 ? "s" : ""} disponíve{presetCount !== 1 ? "is" : "l"}.
      </p>
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px",
          borderRadius: "var(--radius-md)",
          background: "rgba(255,149,0,0.06)",
          border: "1px solid rgba(255,149,0,0.2)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--cyan)",
            opacity: 0.85,
          }}
        />
        Nenhum pedido ao servidor de vídeo até confirmar a fonte
      </div>
    </div>
  );
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function LoadingSpinner() {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        border: "2px solid rgba(255,255,255,0.06)",
        borderTop: "2px solid var(--amber)",
        borderRadius: "50%",
        animation: "spin 0.75s linear infinite",
      }}
    />
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        color: "var(--text-muted)",
        padding: 24,
      }}
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
            marginBottom: 4,
          }}
        >
          Stream indisponível
        </div>
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", maxWidth: 360, textAlign: "center", lineHeight: 1.45 }}>
          Confirme run_web.sh / WEB_PORT, stream HLS no .env e GPU. Em dev o feed usa o Flask directamente
          (evita proxy); se abrir de outro PC, defina VITE_VIDEO_FEED_ORIGIN no apps/web.
        </div>
      </div>
      <button
        onClick={onRetry}
        style={{
          padding: "7px 20px",
          background: "var(--amber-dim)",
          color: "var(--amber)",
          border: "1px solid var(--border-accent)",
          borderRadius: "var(--radius-sm)",
          cursor: "pointer",
          fontFamily: "var(--font-display)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--amber-glow)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--amber-dim)";
        }}
      >
        Reconectar
      </button>
    </div>
  );
}
