import { useState, useEffect, useCallback } from "react";
import type { EnvProfile } from "../types/api";

interface Props {
  apiBase: string;
  activeProfile?: string;
  onApplied?: (profileId: string) => void;
}

export function ProfileSelector({ apiBase, activeProfile, onApplied }: Props) {
  const [profiles, setProfiles] = useState<EnvProfile[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/api/profiles`)
      .then((r) => r.json())
      .then((data) => setProfiles(data.profiles ?? []))
      .catch(() => {});
  }, [apiBase]);

  const applyProfile = useCallback(
    async (id: string) => {
      setApplying(id);
      setError(null);
      try {
        const r = await fetch(`${apiBase}/api/profiles/${id}/apply`, { method: "POST" });
        if (!r.ok) throw new Error(await r.text());
        onApplied?.(id);
        setOpen(false);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Erro desconhecido");
      } finally {
        setApplying(null);
      }
    },
    [apiBase, onApplied],
  );

  const reset = useCallback(async () => {
    setApplying("reset");
    try {
      await fetch(`${apiBase}/api/profiles/reset`, { method: "POST" });
      onApplied?.("");
      setOpen(false);
    } finally {
      setApplying(null);
    }
  }, [apiBase, onApplied]);

  const activeInfo = profiles.find((p) => p.id === activeProfile);

  return (
    <div style={{ position: "relative" }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: open ? "rgba(61,170,200,0.12)" : "var(--bg-elevated)",
          border: `1px solid ${open ? "var(--cyan)" : "var(--border)"}`,
          borderRadius: "var(--radius-sm)",
          color: activeProfile ? "var(--cyan)" : "var(--text-muted)",
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "4px 10px",
          cursor: "pointer",
          transition: "border-color 0.15s, color 0.15s",
          whiteSpace: "nowrap",
        }}
        title="Selecionar perfil de ambiente"
      >
        <span style={{ fontSize: 13 }}>{activeInfo?.icon ?? "⚙️"}</span>
        <span>{activeInfo?.label ?? "Perfil"}</span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: 0.5 }}>
          <path d="M0 0 L4 5 L8 0Z" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 200,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            minWidth: 260,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px 6px",
              borderBottom: "1px solid var(--border)",
              fontSize: 9,
              fontFamily: "var(--font-display)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Perfil de Ambiente
          </div>

          {profiles.map((p) => {
            const isActive = p.id === activeProfile;
            const isLoading = applying === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyProfile(p.id)}
                disabled={isLoading}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  background: isActive ? "rgba(61,170,200,0.08)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  color: isActive ? "var(--cyan)" : "var(--text-secondary)",
                  cursor: isLoading ? "wait" : "pointer",
                  textAlign: "left",
                  transition: "background 0.12s",
                }}
              >
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{p.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      marginBottom: 2,
                    }}
                  >
                    {p.label}
                    {isActive && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 9,
                          background: "rgba(61,170,200,0.2)",
                          color: "var(--cyan)",
                          borderRadius: 3,
                          padding: "1px 4px",
                          letterSpacing: "0.08em",
                        }}
                      >
                        ATIVO
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-muted)",
                      lineHeight: 1.4,
                      whiteSpace: "normal",
                    }}
                  >
                    {p.description}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <ThresholdPill label="Loitering" value={`${p.loitering_seconds}s`} />
                    <ThresholdPill label="Fila" value={`≥${p.queue_saturation}`} />
                  </div>
                </div>
              </button>
            );
          })}

          {/* Reset */}
          {activeProfile && (
            <button
              onClick={reset}
              disabled={applying === "reset"}
              style={{
                width: "100%",
                padding: "8px 12px",
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontFamily: "var(--font-display)",
                fontSize: 10,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 12 }}>↺</span> Resetar para padrão
            </button>
          )}

          {error && (
            <div
              style={{
                padding: "6px 12px",
                fontSize: 10,
                color: "var(--red)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {/* Click-outside dismiss */}
      {open && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 199 }}
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ThresholdPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        color: "var(--text-muted)",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 3,
        padding: "1px 5px",
      }}
    >
      {label}: {value}
    </span>
  );
}
