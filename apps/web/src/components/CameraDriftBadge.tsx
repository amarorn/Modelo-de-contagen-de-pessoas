import { useState, useCallback } from "react";

type DriftLevel = "ok" | "illumination" | "focus" | "position";

interface Props {
  apiBase: string;
  level: DriftLevel;
  score: number;
  reason: string;
  baselineReady: boolean;
}

const DRIFT_CONFIG: Record<DriftLevel, { label: string; color: string; icon: string }> = {
  ok:           { label: "Câmera OK",          color: "var(--green)",    icon: "●" },
  illumination: { label: "Iluminação alterada", color: "var(--amber)",   icon: "◐" },
  focus:        { label: "Perda de foco",       color: "var(--amber)",   icon: "◎" },
  position:     { label: "Câmera deslocada",    color: "var(--red)",     icon: "⚠" },
};

export function CameraDriftBadge({ apiBase, level, score, reason, baselineReady }: Props) {
  const [resetting, setResetting] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const cfg = DRIFT_CONFIG[level] ?? DRIFT_CONFIG.ok;
  const isAlert = level !== "ok";

  const resetBaseline = useCallback(async () => {
    setResetting(true);
    try {
      await fetch(`${apiBase}/api/camera/drift/reset`, { method: "POST" });
    } finally {
      setResetting(false);
      setShowTooltip(false);
    }
  }, [apiBase]);

  if (!baselineReady && !isAlert) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          opacity: 0.6,
        }}
      >
        <span>câmera calibrando…</span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: isAlert ? `color-mix(in srgb, ${cfg.color} 12%, transparent)` : "transparent",
          border: `1px solid ${isAlert ? cfg.color : "var(--border)"}`,
          borderRadius: "var(--radius-sm)",
          color: cfg.color,
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          padding: "3px 8px",
          cursor: "default",
          animation: isAlert && score > 0.7 ? "pulse 2s infinite" : "none",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: cfg.color,
            flexShrink: 0,
            animation: isAlert ? "pulse 2s infinite" : "none",
          }}
        />
        {cfg.icon} {cfg.label}
        {isAlert && score > 0 && (
          <span style={{ opacity: 0.7, marginLeft: 2 }}>{Math.round(score * 100)}%</span>
        )}
      </button>

      {showTooltip && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 300,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: "10px 12px",
            minWidth: 220,
            maxWidth: 300,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: cfg.color,
              marginBottom: 6,
            }}
          >
            {cfg.label}
          </div>
          {reason && (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-secondary)",
                margin: "0 0 8px",
                lineHeight: 1.5,
              }}
            >
              {reason}
            </p>
          )}
          {!reason && level === "ok" && (
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", margin: "0 0 8px" }}>
              Sem desvio detectado.
            </p>
          )}
          {isAlert && (
            <button
              onClick={resetBaseline}
              disabled={resetting}
              style={{
                display: "block",
                width: "100%",
                padding: "5px 0",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text-secondary)",
                fontFamily: "var(--font-display)",
                fontSize: 9,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: resetting ? "wait" : "pointer",
              }}
            >
              {resetting ? "Resetando…" : "↺ Redefinir baseline"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
