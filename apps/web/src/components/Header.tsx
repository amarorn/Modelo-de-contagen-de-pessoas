import React from "react";
import type { ConnectionStatus } from "../types/api";
import { CameraDriftBadge } from "./CameraDriftBadge";

interface Props {
  status: ConnectionStatus;
  apiBase: string;
  confidence?: "high" | "medium" | "low";
  confidenceReasons?: string[];
  camDriftLevel?: "ok" | "illumination" | "focus" | "position";
  camDriftScore?: number;
  camDriftReason?: string;
  camDriftBaselineReady?: boolean;
  onOpenSettings?: () => void;
  onBackToLive?: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected:  "Online",
  connecting: "Conectando",
  error:      "Offline",
};

export function Header({
  status,
  apiBase,
  confidence,
  confidenceReasons,
  camDriftLevel = "ok",
  camDriftScore = 0,
  camDriftReason = "",
  camDriftBaselineReady = false,
  onOpenSettings,
  onBackToLive,
}: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 54,
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        flexShrink: 0,
      }}
    >
      {/* ── Left: Logo ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Icon mark */}
        <div
          style={{
            width: 32,
            height: 32,
            background: "var(--amber-dim)",
            border: "1px solid var(--border-accent)",
            borderRadius: "var(--radius-sm)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="7" r="3" stroke="var(--amber)" strokeWidth="1.5" />
            <path d="M3 16c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="var(--amber)" strokeWidth="1.5" strokeLinecap="round" />
            {/* Corner brackets */}
            <path d="M1 4V1h3" stroke="var(--amber)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
            <path d="M17 4V1h-3" stroke="var(--amber)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
          </svg>
        </div>

        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: "0.04em",
              lineHeight: 1,
              textTransform: "uppercase",
              color: "var(--text-primary)",
            }}
          >
            Vision<span style={{ color: "var(--amber)" }}>Count</span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              color: "var(--text-muted)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              marginTop: 1,
            }}
          >
            Monitoramento em Tempo Real
          </div>
        </div>

        {/* Decorative pipe separator */}
        <div
          style={{
            width: 1,
            height: 28,
            background: "var(--border)",
            marginLeft: 4,
          }}
        />

        {/* System clock */}
        <SystemClock />
      </div>

      {/* ── Right: Status + Actions ─────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onBackToLive && (
          <HeaderButton
            onClick={onBackToLive}
            accent
          >
            ← Dashboard ao vivo
          </HeaderButton>
        )}

        {onOpenSettings && !onBackToLive && (
          <HeaderButton onClick={onOpenSettings}>
            Configurações
          </HeaderButton>
        )}

        {/* API endpoint */}
        <div
          style={{
            padding: "4px 10px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            letterSpacing: "0.03em",
          }}
        >
          {apiBase
            ? apiBase.replace(/^https?:\/\//, "")
            : import.meta.env.VITE_FLASK_DISPLAY_HOST}
        </div>

        {/* Camera confidence badge */}
        {confidence && (
          <ConfidenceBadge level={confidence} reasons={confidenceReasons ?? []} />
        )}

        <CameraDriftBadge
          apiBase={apiBase}
          level={camDriftLevel}
          score={camDriftScore}
          reason={camDriftReason}
          baselineReady={camDriftBaselineReady}
        />

        {/* Connection badge */}
        <div
          className={`badge badge-${
            status === "connected" ? "green" : status === "error" ? "red" : "amber"
          }`}
          style={{ gap: 5 }}
        >
          <span
            className={`pulse-dot ${
              status === "connected" ? "active" : status === "error" ? "error" : "connecting"
            }`}
          />
          {STATUS_LABEL[status]}
        </div>
      </div>
    </header>
  );
}

function SystemClock() {
  const [time, setTime] = React.useState(() =>
    new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  );

  React.useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        color: "var(--text-secondary)",
        letterSpacing: "0.05em",
        minWidth: 72,
      }}
    >
      {time}
    </div>
  );
}

function HeaderButton({
  children,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        background: accent ? "var(--amber-dim)" : "var(--bg-elevated)",
        border: `1px solid ${accent ? "var(--border-accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        color: accent ? "var(--amber)" : "var(--text-secondary)",
        fontFamily: "var(--font-display)",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.borderColor = "var(--border-bright)";
        b.style.color = "var(--amber)";
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.borderColor = accent ? "var(--border-accent)" : "var(--border)";
        b.style.color = accent ? "var(--amber)" : "var(--text-secondary)";
      }}
    >
      {children}
    </button>
  );
}

const CONFIDENCE_CONFIG = {
  high:   { label: "Alta confiança",  color: "var(--green)",  dim: "rgba(52,211,153,0.12)", dot: "#34d399" },
  medium: { label: "Média confiança", color: "var(--amber)",  dim: "var(--amber-dim)",      dot: "var(--amber)" },
  low:    { label: "Baixa confiança", color: "var(--red)",    dim: "var(--red-dim)",         dot: "var(--red)" },
};

const REASON_LABELS: Record<string, string> = {
  fps_critical:       "FPS crítico",
  fps_low:            "FPS baixo",
  blur:               "Imagem desfocada",
  bbox_small:         "Pessoas muito pequenas",
  tracking_unstable:  "Tracking instável",
};

function ConfidenceBadge({
  level,
  reasons,
}: { level: "high" | "medium" | "low"; reasons: string[] }) {
  const cfg = CONFIDENCE_CONFIG[level];
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          background: cfg.dim,
          border: `1px solid ${cfg.color}`,
          borderRadius: "var(--radius-sm)",
          color: cfg.color,
          fontFamily: "var(--font-display)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          cursor: "default",
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: cfg.dot,
            flexShrink: 0,
            ...(level !== "high" ? { animation: "pulse 2.5s infinite" } : {}),
          }}
        />
        {cfg.label}
      </div>

      {hovered && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 7px)",
            right: 0,
            minWidth: 200,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "10px 12px",
            zIndex: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            Sinais de qualidade
          </div>

          {reasons.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
              Todos os sinais OK
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {reasons.map((r) => (
                <div
                  key={r}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <span style={{ color: "var(--red)", fontSize: 10 }}>▲</span>
                  {REASON_LABELS[r] ?? r}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

