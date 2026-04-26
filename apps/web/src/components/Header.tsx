import React from "react";
import type { ConnectionStatus } from "../types/api";
import { CameraDriftBadge } from "./CameraDriftBadge";
import { IconTarget, IconVideo, IconPolygon } from "./Icons";

export type AppView =
  | "pessoas"
  | "veiculos"
  | "zonas"
  | "configuracoes";

interface Props {
  status: ConnectionStatus;
  apiBase: string;
  view: AppView;
  onChangeView: (v: AppView) => void;
  onOpenRoi: () => void;
  onOpenSource: () => void;
  onOpenZones: () => void;
  confidence?: "high" | "medium" | "low";
  confidenceReasons?: string[];
  camDriftLevel?: "ok" | "illumination" | "focus" | "position";
  camDriftScore?: number;
  camDriftReason?: string;
  camDriftBaselineReady?: boolean;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected:  "Online",
  connecting: "Conectando",
  error:      "Offline",
};

const NAV_ITEMS: { key: AppView; label: string; icon: React.ReactNode }[] = [
  {
    key: "pessoas",
    label: "Pessoas",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: "veiculos",
    label: "Veículos",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 17H5a2 2 0 0 1-2-2V9l2-4h10l2 4" />
        <path d="M5 13h14" />
        <circle cx="7.5" cy="17" r="1.5" />
        <circle cx="16.5" cy="17" r="1.5" />
      </svg>
    ),
  },
  {
    key: "zonas",
    label: "Zonas",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </svg>
    ),
  },
  {
    key: "configuracoes",
    label: "Configurações",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export function Header({
  status,
  apiBase,
  view,
  onChangeView,
  onOpenRoi,
  onOpenSource,
  onOpenZones,
  confidence,
  confidenceReasons,
  camDriftLevel = "ok",
  camDriftScore = 0,
  camDriftReason = "",
  camDriftBaselineReady = false,
}: Props) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 100, flexShrink: 0 }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.bottomAccent} />

        {/* Left: Logo */}
        <div style={styles.leftGroup}>
          <div style={styles.logoMark}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="3.5" stroke="var(--amber)" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="7" stroke="var(--amber)" strokeWidth="0.75" strokeOpacity="0.35" />
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

        {/* Right: Status badges */}
        <div style={styles.rightGroup}>
          <div style={styles.apiChip}>
            {apiBase
              ? apiBase.replace(/^https?:\/\//, "")
              : import.meta.env.VITE_FLASK_DISPLAY_HOST}
          </div>

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

      {/* ── Nav tab bar + ações comuns (ROI, fonte, zonas) ─────── */}
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          <div style={styles.navTabs}>
            {NAV_ITEMS.map((item) => {
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => onChangeView(item.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 14px",
                    height: "100%",
                    background: "none",
                    border: "none",
                    borderBottom: `2px solid ${active ? "var(--amber)" : "transparent"}`,
                    color: active ? "var(--amber)" : "var(--text-muted)",
                    fontFamily: "var(--font-display)",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.10em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    transition: "color 0.15s, border-color 0.15s",
                    position: "relative",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.6 }}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
          <div style={styles.navQuickActions} aria-label="Ações comuns">
            <button type="button" className="action-btn action-btn-nav" onClick={onOpenRoi} title="Linha e polígono de contagem">
              <IconTarget size={13} />
              Configurar ROI
            </button>
            <button type="button" className="action-btn action-btn-nav" onClick={onOpenSource} title="URL ou preset de câmara">
              <IconVideo size={13} />
              Fonte de Vídeo
            </button>
            <button type="button" className="action-btn action-btn-nav" onClick={onOpenZones} title="Zonas semânticas e mapa de calor">
              <IconPolygon size={13} />
              Zonas e hotspots
            </button>
          </div>
        </div>
      </nav>
    </div>
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
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    flexShrink: 0,
    position: "relative" as const,
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
  nav: {
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    minHeight: 36,
  },
  navInner: {
    display: "flex",
    alignItems: "stretch",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: 6,
    columnGap: 8,
    minHeight: 36,
    padding: "4px 12px",
    boxSizing: "border-box" as const,
  },
  navTabs: {
    display: "flex",
    alignItems: "stretch",
    flex: "1 1 auto",
    minWidth: 0,
    overflowX: "auto" as const,
  },
  navQuickActions: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    paddingLeft: 4,
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
  logoText: { lineHeight: 1 },
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

function ConfidenceBadge({ level, reasons }: { level: "high" | "medium" | "low"; reasons: string[] }) {
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
