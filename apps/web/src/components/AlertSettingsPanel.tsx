import { useState, useEffect, type CSSProperties } from "react";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const CAR_COLORS = [
  { key: "vermelho", hex: "#DC2626" },
  { key: "laranja",  hex: "#EA580C" },
  { key: "amarelo",  hex: "#D97706" },
  { key: "verde",    hex: "#16A34A" },
  { key: "ciano",    hex: "#0891B2" },
  { key: "azul",     hex: "#2563EB" },
  { key: "roxo",     hex: "#7C3AED" },
  { key: "rosa",     hex: "#DB2777" },
  { key: "preto",    hex: "#27272A" },
  { key: "branco",   hex: "#E4E4E7" },
  { key: "cinza",    hex: "#71717A" },
  { key: "marrom",   hex: "#92400E" },
] as const;

interface AlertConfig {
  cap_enabled: boolean;
  cap_available: boolean;
  cap_threshold: number;
  car_colors: string[];
  car_min_score: number;
  cooldown_seconds: number;
  server_beep: boolean;
}

export function AlertSettingsPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<AlertConfig>({
    cap_enabled: false,
    cap_available: false,
    cap_threshold: 0.55,
    car_colors: [],
    car_min_score: 0.08,
    cooldown_seconds: 3.0,
    server_beep: false,
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/alerts?since=0`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setConfig({
          cap_enabled: data.cap_enabled ?? false,
          cap_available: data.cap_available ?? false,
          cap_threshold: data.cap_threshold ?? 0.55,
          car_colors: data.car_colors ?? [],
          car_min_score: data.car_min_score ?? 0.08,
          cooldown_seconds: data.cooldown_seconds ?? 3.0,
          server_beep: data.server_beep ?? false,
        });
      })
      .catch(() => {});
  }, []);

  const toggleColor = (key: string) =>
    setConfig(p => ({
      ...p,
      car_colors: p.car_colors.includes(key)
        ? p.car_colors.filter(c => c !== key)
        : [...p.car_colors, key],
    }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch(`${API_BASE}/api/alerts/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      setMsg({ text: "Configuração aplicada com sucesso.", ok: true });
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes _ap_slideUp {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
        ._ap_toggle {
          position: relative; width: 34px; height: 18px;
          background: var(--bg-hover);
          border: 1px solid var(--border);
          border-radius: 9px;
          cursor: pointer;
          flex-shrink: 0;
          transition: background 0.18s, border-color 0.18s;
        }
        ._ap_toggle.on  { background: rgba(240,165,0,0.18); border-color: var(--amber); }
        ._ap_toggle.off-disabled { opacity: 0.38; cursor: not-allowed; }
        ._ap_toggle::after {
          content: '';
          position: absolute; top: 2px; left: 2px;
          width: 12px; height: 12px; border-radius: 50%;
          background: var(--text-muted);
          transition: transform 0.18s, background 0.18s;
        }
        ._ap_toggle.on::after { transform: translateX(16px); background: var(--amber); }
        ._ap_range {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 3px;
          border-radius: 2px;
          background: var(--bg-hover);
          outline: none; cursor: pointer;
        }
        ._ap_range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 13px; height: 13px; border-radius: 50%;
          background: var(--amber); cursor: pointer;
          border: 2px solid var(--bg-base);
          box-shadow: 0 0 4px rgba(240,165,0,0.5);
        }
        ._ap_range::-moz-range-thumb {
          width: 13px; height: 13px; border-radius: 50%;
          background: var(--amber); cursor: pointer;
          border: 2px solid var(--bg-base);
        }
        ._ap_swatch:hover { opacity: 0.85; }
        ._ap_numfield:focus { border-color: rgba(240,165,0,0.4) !important; outline: none; }
      `}</style>

      <div style={{
        position: "fixed",
        bottom: 52,
        left: 14,
        zIndex: 10001,
        width: 304,
        background: "var(--bg-panel)",
        border: "1px solid var(--border-accent)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 24px 72px rgba(0,0,0,0.75), 0 0 0 1px rgba(240,165,0,0.04)",
        animation: "_ap_slideUp 0.18s ease-out",
        overflow: "hidden",
      }}>
        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "9px 13px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(240,165,0,0.035)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: "var(--amber)", boxShadow: "0 0 5px var(--amber)",
            }} />
            <span style={{
              fontFamily: "var(--font-display)", fontSize: 12,
              fontWeight: 700, letterSpacing: "0.14em", color: "var(--amber)",
            }}>
              ALERTAS — CONFIG
            </span>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer",
            fontSize: 11, padding: "2px 5px",
            borderRadius: "var(--radius-sm)",
            lineHeight: 1,
          }}>✕</button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "11px 13px 13px", display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Section: CAP */}
          <section style={SEC}>
            <SectionLabel color="#00D4FF" label="BONE / CHAPÉU" />
            <ToggleRow
              label="Detector CLIP ativo"
              value={config.cap_enabled}
              disabled={!config.cap_available}
              hint={!config.cap_available ? "Reinicie com --cap-alert para habilitar" : undefined}
              onChange={v => setConfig(p => ({ ...p, cap_enabled: v }))}
            />
            <SliderRow
              label="Confiança mínima"
              value={config.cap_threshold}
              min={0.3} max={0.9} step={0.01}
              onChange={v => setConfig(p => ({ ...p, cap_threshold: v }))}
            />
          </section>

          {/* Section: CAR COLOR */}
          <section style={SEC}>
            <SectionLabel color="#F59E0B" label="COR DE CARRO" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
              {CAR_COLORS.map(c => {
                const active = config.car_colors.includes(c.key);
                return (
                  <button
                    key={c.key}
                    className="_ap_swatch"
                    onClick={() => toggleColor(c.key)}
                    title={c.key}
                    style={{
                      display: "flex", flexDirection: "column",
                      alignItems: "center", gap: 3,
                      padding: "5px 2px",
                      background: active ? "rgba(240,165,0,0.10)" : "transparent",
                      border: `1px solid ${active ? "var(--amber)" : "var(--border)"}`,
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                      transition: "border-color 0.14s, background 0.14s",
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: c.hex,
                      border: c.key === "branco" ? "1px solid rgba(255,255,255,0.2)" : "none",
                      boxShadow: active ? `0 0 6px ${c.hex}99` : "none",
                      transition: "box-shadow 0.14s",
                    }} />
                    <span style={{
                      fontSize: 7, fontFamily: "var(--font-mono)", lineHeight: 1,
                      color: active ? "var(--amber)" : "var(--text-muted)",
                      letterSpacing: "0.02em", textTransform: "uppercase",
                    }}>
                      {c.key.slice(0, 4)}
                    </span>
                  </button>
                );
              })}
            </div>
            <SliderRow
              label="Score mínimo"
              value={config.car_min_score}
              min={0.02} max={0.4} step={0.01}
              onChange={v => setConfig(p => ({ ...p, car_min_score: v }))}
            />
          </section>

          {/* Section: GERAL */}
          <section style={SEC}>
            <SectionLabel color="var(--text-muted)" label="GERAL" />
            <div>
              <div style={FIELD_LABEL}>Cooldown (segundos)</div>
              <input
                type="number" min={0} max={60} step={0.5}
                className="_ap_numfield"
                value={config.cooldown_seconds}
                onChange={e =>
                  setConfig(p => ({
                    ...p,
                    cooldown_seconds: Math.max(0, parseFloat(e.target.value) || 0),
                  }))
                }
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "5px 8px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-mono)", fontSize: 12,
                  outline: "none",
                }}
              />
            </div>
            <ToggleRow
              label="Beep no terminal do servidor"
              value={config.server_beep}
              onChange={v => setConfig(p => ({ ...p, server_beep: v }))}
            />
          </section>

          {msg && (
            <div style={{
              padding: "7px 10px",
              borderRadius: "var(--radius-sm)",
              background: msg.ok ? "var(--green-dim)" : "var(--red-dim)",
              color: msg.ok ? "var(--green)" : "var(--red)",
              fontFamily: "var(--font-mono)", fontSize: 11,
              border: `1px solid ${msg.ok ? "rgba(46,184,122,0.3)" : "rgba(224,78,78,0.3)"}`,
            }}>
              {msg.text}
            </div>
          )}

          <button
            onClick={() => void save()}
            disabled={saving}
            style={{
              padding: "8px 0", width: "100%",
              background: saving ? "var(--bg-hover)" : "rgba(240,165,0,0.10)",
              border: `1px solid ${saving ? "var(--border)" : "var(--border-bright)"}`,
              borderRadius: "var(--radius-sm)",
              color: saving ? "var(--text-muted)" : "var(--amber)",
              fontFamily: "var(--font-display)", fontSize: 12, fontWeight: 700,
              letterSpacing: "0.12em",
              cursor: saving ? "not-allowed" : "pointer",
              transition: "all 0.18s",
            }}
          >
            {saving ? "APLICANDO…" : "APLICAR"}
          </button>
        </div>
      </div>
    </>
  );
}

const SEC: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8,
  padding: "9px 10px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
};

const FIELD_LABEL: CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 10,
  color: "var(--text-muted)", marginBottom: 4,
  letterSpacing: "0.04em",
};

function SectionLabel({ color, label }: { color: string; label: string }) {
  return (
    <div style={{
      fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
      letterSpacing: "0.12em", color: "var(--text-muted)",
      display: "flex", alignItems: "center", gap: 5,
      textTransform: "uppercase",
    }}>
      <span style={{ color, fontSize: 8 }}>▶</span>
      {label}
    </div>
  );
}

function ToggleRow({
  label, value, onChange, disabled, hint,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
          {label}
        </span>
        <button
          className={`_ap_toggle${value ? " on" : ""}${disabled ? " off-disabled" : ""}`}
          onClick={() => { if (!disabled) onChange(!value); }}
          aria-label={label}
        />
      </div>
      {hint && (
        <div style={{
          fontSize: 9, color: "var(--text-muted)",
          marginTop: 4, fontFamily: "var(--font-mono)",
          lineHeight: 1.4,
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
          {label}
        </span>
        <span style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: "var(--amber)", minWidth: 32, textAlign: "right",
        }}>
          {value.toFixed(step < 0.1 ? 2 : 1)}
        </span>
      </div>
      <input
        type="range"
        className="_ap_range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
