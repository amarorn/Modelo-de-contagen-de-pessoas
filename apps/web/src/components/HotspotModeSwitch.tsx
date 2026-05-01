interface Props {
  mode: "composite" | "recent" | "hist";
  onChange: (m: "composite" | "recent" | "hist") => void;
}

export function HotspotModeSwitch({ mode, onChange }: Props) {
  const btn = (m: "composite" | "recent" | "hist", label: string) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      style={{
        padding: "6px 12px",
        fontSize: 11,
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${mode === m ? "var(--amber)" : "var(--border)"}`,
        background: mode === m ? "rgba(245,158,11,0.12)" : "var(--bg-surface)",
        color: mode === m ? "var(--amber)" : "var(--text-muted)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {btn("composite", "Composite")}
      {btn("recent", "Recente")}
      {btn("hist", "Historico")}
    </div>
  );
}
