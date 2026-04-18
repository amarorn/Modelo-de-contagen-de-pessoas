import { useEffect, useState } from "react";
import { primeAudio } from "../audio/beep";
import { useAlerts } from "../hooks/useAlerts";
import { AlertSettingsPanel } from "./AlertSettingsPanel";

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
function IconSpeakerOn({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}
function IconSpeakerOff({ size = 14 }: { size?: number }) {
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

export function AlertsLayer() {
  const { recent, enabled, soundOn, setSoundOn, dismiss } = useAlerts();
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

  return (
    <>
      {/* Toast stack (bottom-right) */}
      <div
        style={{
          position: "fixed",
          bottom: 14,
          right: 14,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 9999,
          maxWidth: 360,
        }}
      >
        {recent.map(ev => {
          const isCap = ev.kind === "cap";
          const color = isCap ? "#00D4FF" : "#F59E0B";
          const bg = isCap ? "rgba(0,212,255,0.10)" : "rgba(245,158,11,0.10)";
          return (
            <div
              key={ev.seq}
              onClick={() => dismiss(ev.seq)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "var(--bg-elevated)",
                border: `1px solid ${color}`,
                borderLeft: `3px solid ${color}`,
                borderRadius: "var(--radius-md)",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                cursor: "pointer",
                boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
                animation: "slideInFromRight 0.25s ease-out",
              }}
            >
              <span style={{ color, display: "flex", alignItems: "center", padding: 4, background: bg, borderRadius: 6 }}>
                {isCap ? <IconCap size={16} /> : <IconCar size={16} />}
              </span>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {isCap ? "Alerta: Bone" : "Alerta: Carro"}
                </span>
                <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {ev.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Config panel */}
      {panelOpen && <AlertSettingsPanel onClose={() => setPanelOpen(false)} />}

      {/* Bottom-left controls */}
      <div style={{
        position: "fixed",
        bottom: 14,
        left: 14,
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}>
        {/* Sound toggle */}
        <button
          onClick={() => setSoundOn(!soundOn)}
          title={soundOn ? "Alertas sonoros ativos (clique para silenciar)" : "Alertas sonoros silenciados"}
          style={{
            padding: "8px 12px",
            background: "var(--bg-elevated)",
            border: `1px solid ${soundOn ? "var(--amber)" : "var(--border)"}`,
            borderRadius: "var(--radius-sm)",
            color: soundOn ? "var(--amber)" : "var(--text-muted)",
            fontFamily: "var(--font-display)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {soundOn ? <IconSpeakerOn size={14} /> : <IconSpeakerOff size={14} />}
          Alertas {soundOn ? "ON" : "OFF"}
          {anyEnabled && (
            <span style={{ marginLeft: 4, fontSize: 10, color: "var(--text-muted)" }}>
              {[enabled.cap && "bone", ...enabled.carColors].filter(Boolean).join(",")}
            </span>
          )}
        </button>

        {/* Config gear button */}
        <button
          onClick={() => setPanelOpen(p => !p)}
          title="Configurar alertas"
          style={{
            padding: "8px 9px",
            background: panelOpen ? "rgba(240,165,0,0.12)" : "var(--bg-elevated)",
            border: `1px solid ${panelOpen ? "var(--amber)" : "var(--border)"}`,
            borderRadius: "var(--radius-sm)",
            color: panelOpen ? "var(--amber)" : "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            transition: "border-color 0.15s, background 0.15s, color 0.15s",
          }}
        >
          <IconGear size={13} />
        </button>
      </div>
    </>
  );
}
