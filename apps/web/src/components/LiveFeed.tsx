import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  apiBase: string;
  hero?: boolean;
}

export function LiveFeed({ apiBase, hero = false }: Props) {
  const [error, setError]           = useState(false);
  const [loading, setLoading]       = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imgRef       = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const src = `${apiBase}/video_feed`;

  useEffect(() => {
    setError(false);
    setLoading(true);
  }, [src]);

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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* LIVE badge */}
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

          {/* Fullscreen toggle */}
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
          <ErrorState
            onRetry={() => {
              setError(false);
              setLoading(true);
              if (imgRef.current) imgRef.current.src = src + "?" + Date.now();
            }}
          />
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
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
          Verifique se o servidor Flask está ativo
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
