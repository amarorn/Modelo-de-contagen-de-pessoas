import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  apiBase: string;
}

export function LiveFeed({ apiBase }: Props) {
  const [error, setError]       = useState(false);
  const [loading, setLoading]   = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imgRef      = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const src = `${apiBase}/video_feed`;

  useEffect(() => {
    setError(false);
    setLoading(true);
  }, [src]);

  /* ── Fullscreen API ──────────────────────────────────────── */
  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try {
        await el.requestFullscreen();
      } catch {
        /* browser may block */
      }
    } else {
      await document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* keyboard shortcut: F key */
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
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "#000",
        height: "100%",
        /* fullscreen styles applied via CSS class below */
        ...(isFullscreen
          ? { borderRadius: 0, border: "none", background: "#000" }
          : {}),
      }}
    >
      {/* ── Title bar ───────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: isFullscreen ? "rgba(0,0,0,0.85)" : "var(--bg-surface)",
          borderBottom: "1px solid var(--border)",
          position: isFullscreen ? "absolute" : "relative",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          transition: "opacity 0.2s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pulse-dot active" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Feed ao Vivo</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="badge badge-red" style={{ fontSize: 11 }}>
            ● LIVE
          </span>

          {/* Fullscreen button */}
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}
            style={{
              background: "var(--cyan-dim)",
              border: "1px solid var(--border-glow)",
              borderRadius: 6,
              cursor: "pointer",
              padding: "4px 8px",
              color: "var(--cyan)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontWeight: 600,
              transition: "background 0.15s",
            }}
          >
            {isFullscreen ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3"/>
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3"/>
                  <path d="M3 16h3a2 2 0 0 1 2 2v3"/>
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3"/>
                </svg>
                Sair
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 7V3h4"/>
                  <path d="M21 7V3h-4"/>
                  <path d="M3 17v4h4"/>
                  <path d="M21 17v4h-4"/>
                </svg>
                Tela Cheia
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Video area ──────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          flex: 1,
          minHeight: isFullscreen ? "100vh" : 340,
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {loading && !error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "var(--text-muted)",
              zIndex: 2,
            }}
          >
            <LoadingSpinner />
            <span style={{ fontSize: 13 }}>Aguardando stream…</span>
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
              objectFit: isFullscreen ? "contain" : "cover",
              display: loading ? "none" : "block",
              ...(isFullscreen ? { maxHeight: "100vh" } : {}),
            }}
          />
        )}

        {/* Fullscreen hint overlay */}
        {!isFullscreen && !loading && !error && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 10,
              fontSize: 11,
              color: "rgba(255,255,255,0.35)",
              pointerEvents: "none",
            }}
          >
            Pressione F para tela cheia
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        border: "3px solid rgba(255,255,255,0.08)",
        borderTop: "3px solid var(--cyan)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
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
        gap: 12,
        color: "var(--text-muted)",
      }}
    >
      <span style={{ fontSize: 40 }}>📷</span>
      <span style={{ fontSize: 14 }}>Stream indisponível</span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Verifique se o servidor Flask está rodando
      </span>
      <button
        onClick={onRetry}
        style={{
          marginTop: 8,
          padding: "8px 20px",
          background: "var(--cyan-dim)",
          color: "var(--cyan)",
          border: "1px solid var(--border-glow)",
          borderRadius: 8,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        Reconectar
      </button>
    </div>
  );
}
