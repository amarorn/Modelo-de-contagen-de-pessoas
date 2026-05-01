import { useState, useCallback } from "react";
import type { SuggestedLine, SuggestedZone } from "../types/api";

interface SuggestLineButtonProps {
  apiBase: string;
  frameW: number;
  frameH: number;
  onSuggested: (line: { x1: number; y1: number; x2: number; y2: number }) => void;
}

/** Fetches a line suggestion and calls onSuggested with pixel coordinates. */
export function SuggestLineButton({ apiBase, frameW, frameH, onSuggested }: SuggestLineButtonProps) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const suggest = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/suggest/line`);
      const data: SuggestedLine = await r.json();
      if (!data.available || !data.line) {
        setMsg(data.reason ?? "Sem dados suficientes");
        return;
      }
      onSuggested({
        x1: Math.round(data.line.x1 * frameW),
        y1: Math.round(data.line.y1 * frameH),
        x2: Math.round(data.line.x2 * frameW),
        y2: Math.round(data.line.y2 * frameH),
      });
      const pct = Math.round((data.confidence ?? 0) * 100);
      setMsg(`Confiança: ${pct}%`);
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg("Erro ao buscar sugestão");
    } finally {
      setLoading(false);
    }
  }, [apiBase, frameW, frameH, onSuggested]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={suggest}
        disabled={loading}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "rgba(99,102,241,0.12)",
          border: "1px solid rgba(99,102,241,0.4)",
          borderRadius: "var(--radius-sm)",
          color: "var(--indigo, #6366f1)",
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "4px 10px",
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.7 : 1,
          transition: "opacity 0.15s",
        }}
        title="Sugerir posição de linha com base no fluxo acumulado"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 2" strokeLinecap="round" />
        </svg>
        {loading ? "Calculando…" : "Sugerir Linha"}
      </button>
      {msg && (
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
          }}
        >
          {msg}
        </span>
      )}
    </div>
  );
}


interface SuggestZonesButtonProps {
  apiBase: string;
  frameW: number;
  frameH: number;
  onSuggested: (zones: { label: string; polygon: [number, number][] }[]) => void;
}

/** Fetches zone suggestions and converts normalised rects to pixel polygons. */
export function SuggestZonesButton({ apiBase, frameW, frameH, onSuggested }: SuggestZonesButtonProps) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const suggest = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/suggest/zones?max_zones=4`);
      const data: { zones: SuggestedZone[] } = await r.json();
      if (!data.zones || data.zones.length === 0) {
        setMsg("Sem dados suficientes de heatmap");
        return;
      }
      const polys = data.zones.map((z) => ({
        label: z.label,
        polygon: [
          [Math.round(z.x * frameW),       Math.round(z.y * frameH)],
          [Math.round((z.x + z.w) * frameW), Math.round(z.y * frameH)],
          [Math.round((z.x + z.w) * frameW), Math.round((z.y + z.h) * frameH)],
          [Math.round(z.x * frameW),       Math.round((z.y + z.h) * frameH)],
        ] as [number, number][],
      }));
      onSuggested(polys);
      setMsg(`${polys.length} zona${polys.length !== 1 ? "s" : ""} sugerida${polys.length !== 1 ? "s" : ""}`);
      setTimeout(() => setMsg(null), 3000);
    } catch {
      setMsg("Erro ao buscar sugestão");
    } finally {
      setLoading(false);
    }
  }, [apiBase, frameW, frameH, onSuggested]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button
        onClick={suggest}
        disabled={loading}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "rgba(99,102,241,0.12)",
          border: "1px solid rgba(99,102,241,0.4)",
          borderRadius: "var(--radius-sm)",
          color: "var(--indigo, #6366f1)",
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "4px 10px",
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.7 : 1,
          transition: "opacity 0.15s",
        }}
        title="Sugerir zonas a partir do heatmap acumulado"
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
        {loading ? "Calculando…" : "Sugerir Zonas"}
      </button>
      {msg && (
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
          }}
        >
          {msg}
        </span>
      )}
    </div>
  );
}
