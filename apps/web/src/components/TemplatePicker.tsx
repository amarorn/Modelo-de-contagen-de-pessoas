import type { ZoneTemplateRow } from "../types/api";

interface Props {
  templates: ZoneTemplateRow[];
  busy: boolean;
  onSelect: (slug: string) => void;
}

export function TemplatePicker({ templates, busy, onSelect }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 12,
      }}
    >
      {templates.map((t) => (
        <button
          key={t.slug}
          type="button"
          disabled={busy}
          onClick={() => onSelect(t.slug)}
          style={{
            textAlign: "left",
            padding: "14px 16px",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 6,
            }}
          >
            {t.builtin ? "Builtin" : "Custom"}
          </div>
          <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
            {t.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
            {t.description || t.slug}
          </div>
        </button>
      ))}
    </div>
  );
}
