import type { ConnectionStatus } from "../types/api";

interface Props {
  status: ConnectionStatus;
  apiBase: string;
  onOpenSettings?: () => void;
  onBackToLive?: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Conectado",
  connecting: "Conectando…",
  error: "Sem conexão",
};

export function Header({ status, apiBase, onOpenSettings, onBackToLive }: Props) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 20px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="16" fill="rgba(0,212,255,0.1)" />
          <circle cx="16" cy="12" r="4" fill="var(--cyan)" />
          <path
            d="M8 26c0-4.418 3.582-8 8-8s8 3.582 8 8"
            stroke="var(--cyan)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 18,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Vision<span style={{ color: "var(--cyan)" }}>Count</span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Contagem de Pessoas em Tempo Real
          </div>
        </div>
      </div>

      {/* Right section */}
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {onBackToLive && (
          <button
            type="button"
            onClick={onBackToLive}
            style={{
              padding: "8px 14px",
              background: "var(--cyan-dim)",
              border: "1px solid var(--border-glow)",
              borderRadius: 8,
              color: "var(--cyan)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dashboard ao vivo
          </button>
        )}
        {onOpenSettings && !onBackToLive && (
          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              padding: "8px 14px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Configuração e métricas
          </button>
        )}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>API</div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {apiBase || "localhost:8080"}
          </div>
        </div>
        <div
          className={`badge badge-${
            status === "connected"
              ? "green"
              : status === "error"
              ? "red"
              : "amber"
          }`}
        >
          <span
            className={`pulse-dot ${
              status === "connected"
                ? "active"
                : status === "error"
                ? "error"
                : "connecting"
            }`}
          />
          {STATUS_LABEL[status]}
        </div>
      </div>
    </header>
  );
}
