import { memo, useCallback, useEffect, useRef, useState } from "react";
import { HeatmapCanvas } from "./HeatmapCanvas";
import { useHeatmap } from "../hooks/useHeatmap";
import { useVehicleHeatmap } from "../hooks/useVehicleHeatmap";

interface SourcePreset {
  id: string;
  label: string;
  url: string;
}

interface Props {
  apiBase: string;
  hero?: boolean;
}

function LiveFeedComponent({ apiBase, hero = false }: Props) {
  const [error, setError]           = useState(false);
  const [loading, setLoading]       = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadKey, setReloadKey]   = useState(() => Date.now());

  /* ── Camera presets ────────────────────────────────────────── */
  const [presets, setPresets]           = useState<SourcePreset[]>([]);
  const [currentSource, setCurrentSource] = useState<string>("");
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [switching, setSwitching]       = useState(false);

  const [showHeatmap, setShowHeatmap]             = useState(false);
  const [heatmapOpacity, setHeatmapOpacity]       = useState(0.6);
  const [showVehicleHeatmap, setShowVehicleHeatmap] = useState(false);
  const [vehicleHeatmapOpacity, setVehicleHeatmapOpacity] = useState(0.6);

  const heatmapPayload = useHeatmap(apiBase, showHeatmap);
  const vehicleHeatmapPayload = useVehicleHeatmap(apiBase, showVehicleHeatmap);

  const imgRef       = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* MJPEG multipart: o proxy do Vite (5173) pode bufferizar e o <img> nunca dispara onLoad.
     Em desenvolvimento, usar o Flask directamente (mesmo define que WEB_PORT). */
  const feedOrigin = (() => {
    const o = import.meta.env.VITE_VIDEO_FEED_ORIGIN?.trim();
    if (o) return o.replace(/\/$/, "");
    if (import.meta.env.DEV && import.meta.env.VITE_DEV_FLASK_ORIGIN) {
      return String(import.meta.env.VITE_DEV_FLASK_ORIGIN).replace(/\/$/, "");
    }
    return apiBase.replace(/\/$/, "");
  })();
  const src = `${feedOrigin}/video_feed?t=${reloadKey}`;

  /* ── Load presets on mount ─────────────────────────────────── */
  useEffect(() => {
    fetch(`${apiBase}/api/source`)
      .then((r) => r.json())
      .then((d) => {
        setCurrentSource(d.source ?? "");
        setActivePresetId(typeof d.active_preset_id === "string" ? d.active_preset_id : "");
        if (Array.isArray(d.presets)) setPresets(d.presets);
      })
      .catch(() => {});
  }, [apiBase]);

  useEffect(() => {
    setError(false);
    setLoading(true);
  }, [src]);

  /* Se a inferencia nunca enviar JPEG (stream HLS preso) ou onLoad falhar, nao ficar eternamente a carregar. */
  useEffect(() => {
    if (error || !loading) return;
    const raw = import.meta.env.VITE_VIDEO_FEED_LOAD_TIMEOUT_MS;
    const ms = raw ? Number(raw) : 120000;
    const t = window.setTimeout(() => {
      setError(true);
      setLoading(false);
    }, Number.isFinite(ms) && ms > 0 ? ms : 120000);
    return () => window.clearTimeout(t);
  }, [src, loading, error]);

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
    setError(false);
    setLoading(true);
    setReloadKey(Date.now());
  }, []);

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

  const activeLabel = activeIdx >= 0 ? presets[activeIdx].label : null;

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
            title="Recarregar stream"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              padding: "4px 8px",
              color: "var(--text-muted)",
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

          {/* ── LIVE badge ── */}
          <div className="badge badge-red" style={{ fontSize: 10, padding: "2px 7px" }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--red)",
                display: "inline-block",
                animation: "pulse 0.9s infinite",
              }}
            />
            LIVE
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
        className="scanlines"
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
        }}
      >
        {/* Loading state */}
        {loading && !error && (
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

        {error ? (
          <ErrorState onRetry={handleReload} />
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt="Feed de vídeo"
            onLoad={() => setLoading(false)}
            onError={() => { setError(true); setLoading(false); }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: isFullscreen || hero ? "contain" : "cover",
              display: loading ? "none" : "block",
              ...(isFullscreen ? { maxHeight: "100vh" } : {}),
            }}
          />
        )}

        {/* Heatmap canvas overlay — pessoas */}
        {showHeatmap && !loading && !error && (
          <HeatmapCanvas payload={heatmapPayload} opacity={heatmapOpacity} />
        )}

        {/* Heatmap canvas overlay — veículos */}
        {showVehicleHeatmap && !loading && !error && (
          <HeatmapCanvas payload={vehicleHeatmapPayload} opacity={vehicleHeatmapOpacity} />
        )}

        {/* Corner bracket decorations */}
        {!isFullscreen && !loading && !error && (
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
