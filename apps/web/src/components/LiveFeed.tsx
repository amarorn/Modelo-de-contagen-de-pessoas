import { useEffect, useRef, useState } from "react";

interface Props {
  apiBase: string;
}

export function LiveFeed({ apiBase }: Props) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);

  const src = `${apiBase}/video_feed`;

  useEffect(() => {
    setError(false);
    setLoading(true);
  }, [src]);

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "#000",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pulse-dot active" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Feed ao Vivo</span>
        </div>
        <span className="badge badge-red" style={{ fontSize: 11 }}>
          ● LIVE
        </span>
      </div>

      {/* Video frame */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
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
            <div className="spinner" />
            <span style={{ fontSize: 13 }}>Aguardando stream…</span>
          </div>
        )}
        {error ? (
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
              onClick={() => {
                setError(false);
                setLoading(true);
                if (imgRef.current) imgRef.current.src = src + "?" + Date.now();
              }}
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
        ) : (
          <img
            ref={imgRef}
            src={src}
            alt="Feed de vídeo"
            onLoad={() => setLoading(false)}
            onError={() => {
              setError(true);
              setLoading(false);
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: loading ? "none" : "block",
            }}
          />
        )}
      </div>
    </div>
  );
}
