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
    <header style={styles.header}>
      {/* Amber accent line at the very bottom */}
      <div style={styles.bottomAccent} />

      {/* ── Left: Logo ──────────────────────────────────────────── */}
      <div style={styles.leftGroup}>
        {/* Icon mark */}
        <div style={styles.logoMark}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {/* Targeting reticle */}
            <circle cx="10" cy="10" r="3.5" stroke="var(--amber)" strokeWidth="1.5" />
            <circle cx="10" cy="10" r="7" stroke="var(--amber)" strokeWidth="0.75" strokeOpacity="0.35" />
            {/* Cross hairs */}
            <line x1="10" y1="1" x2="10" y2="5.5" stroke="var(--amber)" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="10" y1="14.5" x2="10" y2="19" stroke="var(--amber)" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="1" y1="10" x2="5.5" y2="10" stroke="var(--amber)" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="14.5" y1="10" x2="19" y2="10" stroke="var(--amber)" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>

        <div style={styles.logoText}>
          <div style={styles.logoTitle}>
            Vision<span style={{ color: "var(--amber)" }}>Count</span>
          </div>
          <div style={styles.logoSub}>Monitoramento em Tempo Real</div>
        </div>

        <div style={styles.pipe} />
        <SystemClock />
      </div>

      {/* ── Right: Status + Actions ─────────────────────────────── */}
      <div style={styles.rightGroup}>
        {onBackToLive && (
          <HeaderButton onClick={onBackToLive} accent>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M7 5H3M5 2L2 5l3 3" />
            </svg>
            Dashboard ao vivo
          </HeaderButton>
        )}

        {onOpenSettings && !onBackToLive && (
          <HeaderButton onClick={onOpenSettings}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Config.
          </HeaderButton>
        )}

        {/* API endpoint chip */}
        <div style={styles.apiChip}>
          {apiBase
            ? apiBase.replace(/^https?:\/\//, "")
            : import.meta.env.VITE_FLASK_DISPLAY_HOST}
        </div>

        {/* Camera confidence */}
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

        {/* Connection status */}
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

/* ── Styles ─────────────────────────────────────────────────── */
const styles = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    height: 52,
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    position: "sticky" as const,
    top: 0,
    zIndex: 100,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    flexShrink: 0,
    boxShadow: "0 1px 0 rgba(255,149,0,0.10)",
  },
  bottomAccent: {
    position: "absolute" as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    background: "linear-gradient(90deg, transparent 0%, rgba(255,149,0,0.45) 30%, rgba(255,149,0,0.45) 70%, transparent 100%)",
    pointerEvents: "none" as const,
  },
  leftGroup: {
    display: "flex",
    alignItems: "center",
    gap: 11,
  },
  logoMark: {
    width: 34,
    height: 34,
    background: "var(--amber-dim)",
    border: "1px solid var(--border-accent)",
    borderRadius: "var(--radius-md)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    boxShadow: "0 0 16px rgba(255,149,0,0.12)",
  },
  logoText: {
    lineHeight: 1,
  },
  logoTitle: {
    fontFamily: "var(--font-display)",
    fontWeight: 800,
    fontSize: 18,
    letterSpacing: "0.02em",
    lineHeight: 1,
    textTransform: "uppercase" as const,
    color: "var(--text-primary)",
  },
  logoSub: {
    fontFamily: "var(--font-display)",
    fontSize: 9,
    color: "var(--text-muted)",
    letterSpacing: "0.22em",
    textTransform: "uppercase" as const,
    marginTop: 3,
  },
  pipe: {
    width: 1,
    height: 24,
    background: "var(--border)",
    flexShrink: 0,
  },
  rightGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  apiChip: {
    padding: "4px 10px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    fontSize: 10,
    fontFamily: "var(--font-mono)",
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  },
} as const;

/* ── SystemClock ────────────────────────────────────────────── */
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
    <div style={{
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      fontWeight: 500,
      color: "var(--text-secondary)",
      letterSpacing: "0.06em",
      minWidth: 72,
    }}>
      {time}
    </div>
  );
}

/* ── HeaderButton ───────────────────────────────────────────── */
function HeaderButton({
  children,
  onClick,
  accent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
}) {
  const [hov, setHov] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 13px",
        background: accent
          ? hov ? "rgba(255,149,0,0.15)" : "var(--amber-dim)"
          : hov ? "var(--bg-hover)" : "var(--bg-elevated)",
        border: `1px solid ${accent ? (hov ? "var(--border-bright)" : "var(--border-accent)") : (hov ? "var(--border-accent)" : "var(--border)")}`,
        borderRadius: "var(--radius-sm)",
        color: accent ? "var(--amber)" : (hov ? "var(--amber)" : "var(--text-secondary)"),
        fontFamily: "var(--font-display)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* ── ConfidenceBadge ────────────────────────────────────────── */
const CONFIDENCE_CONFIG = {
  high:   { label: "Alta confiança",  color: "var(--green)",  dim: "var(--green-dim)",  dot: "var(--green)" },
  medium: { label: "Média confiança", color: "var(--amber)",  dim: "var(--amber-dim)",  dot: "var(--amber)" },
  low:    { label: "Baixa confiança", color: "var(--red)",    dim: "var(--red-dim)",    dot: "var(--red)" },
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
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px",
        background: cfg.dim,
        border: `1px solid ${cfg.color}33`,
        borderRadius: "var(--radius-sm)",
        color: cfg.color,
        fontFamily: "var(--font-display)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        cursor: "default",
        whiteSpace: "nowrap",
      }}>
        <span style={{
          width: 5, height: 5, borderRadius: "50%", background: cfg.dot, flexShrink: 0,
          ...(level !== "high" ? { animation: "pulse 2.5s infinite" } : {}),
        }} />
        {cfg.label}
      </div>

      {hovered && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0,
          minWidth: 210,
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-accent)",
          borderRadius: "var(--radius-md)",
          padding: "10px 12px",
          zIndex: 200,
          boxShadow: "0 10px 32px rgba(0,0,0,0.5)",
          pointerEvents: "none",
        }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 9, fontWeight: 700,
            letterSpacing: "0.16em", textTransform: "uppercase",
            color: "var(--text-muted)", marginBottom: 8,
          }}>
            Sinais de qualidade
          </div>
          {reasons.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
              ✓ Todos os sinais OK
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {reasons.map((r) => (
                <div key={r} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)",
                }}>
                  <span style={{ color: "var(--red)", fontSize: 9 }}>▲</span>
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
