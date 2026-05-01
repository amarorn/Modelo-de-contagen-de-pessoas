import { useEffect, useState } from "react";
import { primeAudio } from "../audio/beep";
import { useAlerts } from "../hooks/useAlerts";
import { AlertSettingsPanel } from "./AlertSettingsPanel";

// ── Icons ────────────────────────────────────────────────────────────────────

function IconCap({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      <line x1="4" y1="14" x2="22" y2="14" />
      <path d="M12 6v-2" />
    </svg>
  );
}
function IconCar({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17h14M3 13h18l-2-6H5L3 13z" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}
function IconSpeakerOn({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}
function IconSpeakerOff({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}
function IconGear({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function AlertsLayer() {
  const { recent, enabled, soundOn, setSoundOn, dismiss, counts, resetCounts } = useAlerts();
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const handler = () => primeAudio();
    window.addEventListener("pointerdown", handler, { once: true });
    window.addEventListener("keydown", handler, { once: true });
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const anyEnabled = enabled.cap || enabled.carColors.length > 0;
  const hasAlerts = anyEnabled || recent.length > 0 || counts.cap > 0 || counts.car > 0;

  return (
    <>
      <style>{`
        @keyframes _at_slideIn {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes _at_flash {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
        ._at_toast { animation: _at_slideIn 0.2s ease-out; }
        ._at_toast:hover { opacity: 0.82; }
        ._at_count-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 0 7px; height: 20px;
          border-radius: 3px;
          font-family: var(--font-mono); font-size: 11px; font-weight: 600;
          cursor: pointer; transition: opacity 0.15s;
          border: 1px solid transparent;
          white-space: nowrap;
        }
        ._at_count-badge:hover { opacity: 0.72; }
        ._at_hud-seg {
          display: flex; align-items: center;
          padding: 0 10px; height: 100%;
          cursor: pointer;
          transition: background 0.14s, color 0.14s;
        }
        ._at_hud-seg:hover { background: rgba(255,255,255,0.04); }
        ._at_divider {
          width: 1px; background: var(--border);
          align-self: stretch; flex-shrink: 0;
        }
      `}</style>

      {/* ── Toast stack (bottom-right) ─────────────────────────── */}
      <div style={{
        position: "fixed", bottom: 14, right: 14,
        display: "flex", flexDirection: "column", gap: 6,
        zIndex: 9999, maxWidth: 340,
      }}>
        {recent.map(ev => {
          const isCap = ev.kind === "cap";
          const accent = isCap ? "#00D4FF" : "#F59E0B";
          const bg = isCap ? "rgba(0,212,255,0.07)" : "rgba(245,158,11,0.07)";
          return (
            <div
              key={`${ev.kind}:${ev.track_id}`}
              className="_at_toast"
              onClick={() => dismiss(ev.seq)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px",
                background: "var(--bg-elevated)",
                border: `1px solid ${accent}44`,
                borderLeft: `3px solid ${accent}`,
                borderRadius: "var(--radius-md)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                cursor: "pointer",
                boxShadow: `0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px ${accent}11`,
              }}
            >
              {/* Icon */}
              <span style={{
                color: accent, display: "flex", alignItems: "center",
                padding: 4, background: bg, borderRadius: 4, flexShrink: 0,
              }}>
                {isCap ? <IconCap size={14} /> : <IconCar size={14} />}
              </span>

              {/* Label */}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                <span style={{
                  color: "var(--text-muted)", fontSize: 9,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  marginBottom: 1,
                }}>
                  {isCap ? "Alerta · Bone" : "Alerta · Carro"}
                </span>
                <span style={{
                  fontWeight: 600, whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                  color: "var(--text-primary)",
                }}>
                  {ev.label}
                </span>
              </div>

              {/* Hit count badge — shown only when same track fired multiple times */}
              {ev.hitCount > 1 && (
                <span style={{
                  flexShrink: 0,
                  padding: "1px 6px",
                  background: bg,
                  border: `1px solid ${accent}55`,
                  borderRadius: 3,
                  color: accent,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}>
                  ×{ev.hitCount}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Config panel ──────────────────────────────────────────── */}
      {panelOpen && <AlertSettingsPanel onClose={() => setPanelOpen(false)} />}

      {/* ── Bottom-left HUD bar ───────────────────────────────────── */}
      {hasAlerts && (
        <div style={{
          position: "fixed", bottom: 14, left: 14,
          zIndex: 9998,
          display: "flex", alignItems: "stretch",
          height: 30,
          background: "var(--bg-elevated)",
          border: `1px solid ${anyEnabled ? "var(--border-accent)" : "var(--border)"}`,
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
          boxShadow: anyEnabled
            ? "0 0 16px rgba(240,165,0,0.08), 0 4px 12px rgba(0,0,0,0.4)"
            : "0 4px 12px rgba(0,0,0,0.3)",
        }}>

          {/* Sound toggle segment */}
          <button
            className="_at_hud-seg"
            onClick={() => setSoundOn(!soundOn)}
            title={soundOn ? "Silenciar alertas" : "Ativar sons de alerta"}
            style={{
              background: "none", border: "none",
              color: soundOn ? "var(--amber)" : "var(--text-muted)",
              fontFamily: "var(--font-display)",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
              gap: 6, cursor: "pointer",
            }}
          >
            {soundOn ? <IconSpeakerOn size={13} /> : <IconSpeakerOff size={13} />}
            <span style={{ textTransform: "uppercase" }}>
              Alertas {soundOn ? "on" : "off"}
            </span>
          </button>

          {/* Counts section — only when there's something to show */}
          {(counts.cap > 0 || counts.car > 0 || anyEnabled) && (
            <>
              <div className="_at_divider" />
              <div style={{
                display: "flex", alignItems: "center",
                gap: 5, padding: "0 10px",
              }}>

                {/* Cap badge */}
                {(enabled.cap || counts.cap > 0) && (
                  <span
                    className="_at_count-badge"
                    onClick={resetCounts}
                    title="Alertas de boné (clique para zerar)"
                    style={{
                      background: counts.cap > 0 ? "rgba(0,212,255,0.08)" : "transparent",
                      borderColor: counts.cap > 0 ? "rgba(0,212,255,0.25)" : "var(--border)",
                      color: counts.cap > 0 ? "#00D4FF" : "var(--text-muted)",
                    }}
                  >
                    <IconCap size={10} />
                    <span>{counts.cap}</span>
                  </span>
                )}

                {/* Car badge — one per active color */}
                {(enabled.carColors.length > 0 || counts.car > 0) && (
                  <span
                    className="_at_count-badge"
                    onClick={resetCounts}
                    title="Alertas de carro (clique para zerar)"
                    style={{
                      background: counts.car > 0 ? "rgba(245,158,11,0.08)" : "transparent",
                      borderColor: counts.car > 0 ? "rgba(245,158,11,0.25)" : "var(--border)",
                      color: counts.car > 0 ? "#F59E0B" : "var(--text-muted)",
                    }}
                  >
                    <IconCar size={10} />
                    <span>{counts.car}</span>
                    {enabled.carColors.length > 0 && (
                      <span style={{
                        fontSize: 9, opacity: 0.7,
                        letterSpacing: "0.04em",
                      }}>
                        {enabled.carColors.join("·")}
                      </span>
                    )}
                  </span>
                )}

              </div>
            </>
          )}

          {/* Gear button */}
          <div className="_at_divider" />
          <button
            className="_at_hud-seg"
            onClick={() => setPanelOpen(p => !p)}
            title="Configurar alertas"
            style={{
              background: panelOpen ? "rgba(240,165,0,0.10)" : "none",
              border: "none",
              color: panelOpen ? "var(--amber)" : "var(--text-muted)",
              cursor: "pointer",
              padding: "0 10px",
            }}
          >
            <IconGear size={13} />
          </button>
        </div>
      )}

      {/* Gear-only button when no alerts active and no counts — still allows config */}
      {!hasAlerts && (
        <button
          onClick={() => setPanelOpen(p => !p)}
          title="Configurar alertas"
          style={{
            position: "fixed", bottom: 14, left: 14, zIndex: 9998,
            display: "flex", alignItems: "center",
            padding: "7px 9px", height: 30,
            background: panelOpen ? "rgba(240,165,0,0.10)" : "var(--bg-elevated)",
            border: `1px solid ${panelOpen ? "var(--border-accent)" : "var(--border)"}`,
            borderRadius: "var(--radius-sm)",
            color: panelOpen ? "var(--amber)" : "var(--text-muted)",
            cursor: "pointer",
            transition: "all 0.14s",
          }}
        >
          <IconGear size={13} />
        </button>
      )}
    </>
  );
}
