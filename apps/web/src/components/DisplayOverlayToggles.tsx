import { useCallback, useEffect, useState } from "react";

interface Props {
  apiBase: string;
}

/**
 * Liga/desliga overlays no servidor: rastro dos pés, seta (PCA), sexo (F/M) e mapa de calor.
 */
export function DisplayOverlayToggles({ apiBase }: Props) {
  const [trail, setTrail] = useState(true);
  const [heading, setHeading] = useState(true);
  const [heatmap, setHeatmap] = useState(true);
  const [heatmapOk, setHeatmapOk] = useState(false);
  const [sexOk, setSexOk] = useState(false);
  const [sexOn, setSexOn] = useState(true);
  const [showRoi, setShowRoi] = useState(true);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${apiBase}/api/config`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setTrail(Boolean(j.show_trail ?? true));
      setHeading(Boolean(j.show_heading ?? true));
      const hmAvail = Boolean(j.heatmap_available);
      setHeatmapOk(hmAvail);
      setHeatmap(hmAvail ? Boolean(j.show_heatmap ?? true) : false);
      const sxAvail = Boolean(j.sex_overlay_available);
      setSexOk(sxAvail);
      setSexOn(sxAvail ? Boolean(j.show_sex_overlay ?? true) : false);
      setShowRoi(Boolean(j.show_roi ?? true));
      setReady(true);
    } catch {
      const base = apiBase.trim() || window.location.origin;
      setErr(
        `Sem ligação a ${base}/api/config. Em desenvolvimento: na pasta apps/web execute pnpm dev (proxy /api → Flask). ` +
          `Se abrir o build estático, defina VITE_API_BASE=http://127.0.0.1:PORT ao construir (PORT = WEB_PORT do .env, ex. 8081).`,
      );
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const push = async (next: {
    show_trail?: boolean;
    show_heading?: boolean;
    show_heatmap?: boolean;
    show_sex_overlay?: boolean;
    show_roi?: boolean;
  }) => {
    setPending(true);
    setErr(null);
    try {
      const r = await fetch(`${apiBase}/api/overlay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (typeof j.show_trail === "boolean") setTrail(j.show_trail);
      if (typeof j.show_heading === "boolean") setHeading(j.show_heading);
      if (typeof j.heatmap_available === "boolean") setHeatmapOk(j.heatmap_available);
      if (typeof j.show_heatmap === "boolean") setHeatmap(j.show_heatmap);
      if (typeof j.sex_overlay_available === "boolean") setSexOk(j.sex_overlay_available);
      if (typeof j.show_sex_overlay === "boolean") setSexOn(j.show_sex_overlay);
      if (typeof j.show_roi === "boolean") setShowRoi(j.show_roi);
    } catch {
      setErr("Não foi possível atualizar");
    } finally {
      setPending(false);
    }
  };

  if (!ready && !err) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 0" }}>
        Carregando opções de visualização…
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
        padding: "10px 12px",
        background: "var(--bg-elevated)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", width: "100%" }}>
        Visualização no vídeo
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Rastro dos pés</span>
        <button
          type="button"
          disabled={pending || !!err}
          aria-pressed={trail}
          onClick={() => {
            if (pending || err) return;
            void push({ show_trail: !trail });
          }}
          style={{
            padding: "6px 16px",
            minWidth: 96,
            borderRadius: 999,
            border: `1px solid ${trail ? "rgba(34, 197, 94, 0.45)" : "var(--border)"}`,
            background: trail ? "rgba(34, 197, 94, 0.12)" : "var(--bg-hover)",
            color: trail ? "rgb(34, 197, 94)" : "var(--text-muted)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            cursor: pending || !!err ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {trail ? "Ligado" : "Desligado"}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Seta de direção (PCA)</span>
        <button
          type="button"
          disabled={pending || !!err}
          aria-pressed={heading}
          onClick={() => {
            if (pending || err) return;
            void push({ show_heading: !heading });
          }}
          style={{
            padding: "6px 16px",
            minWidth: 96,
            borderRadius: 999,
            border: `1px solid ${heading ? "rgba(59, 130, 246, 0.45)" : "var(--border)"}`,
            background: heading ? "rgba(59, 130, 246, 0.12)" : "var(--bg-hover)",
            color: heading ? "rgb(96, 165, 250)" : "var(--text-muted)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            cursor: pending || !!err ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {heading ? "Ligado" : "Desligado"}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          opacity: sexOk ? 1 : 0.55,
        }}
        title={
          sexOk
            ? "Classificar sexo (F/M) no vídeo e nas entradas; desligar poupa CPU/GPU."
            : "Indisponível: sem YOLO_SEX_MODEL válido no arranque. Defina no .env e reinicie."
        }
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Sexo (F/M)</span>
        <button
          type="button"
          disabled={pending || !!err || !sexOk}
          aria-pressed={sexOk ? sexOn : false}
          onClick={() => {
            if (!sexOk || pending || err) return;
            void push({ show_sex_overlay: !sexOn });
          }}
          style={{
            padding: "6px 16px",
            minWidth: 96,
            borderRadius: 999,
            border: `1px solid ${
              sexOk && sexOn ? "rgba(236, 72, 153, 0.45)" : "var(--border)"
            }`,
            background:
              sexOk && sexOn ? "rgba(236, 72, 153, 0.12)" : "var(--bg-hover)",
            color: sexOk && sexOn ? "#f472b6" : "var(--text-muted)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            cursor: pending || !!err || !sexOk ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {!sexOk ? "Indisponível" : sexOn ? "Ligado" : "Desligado"}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          opacity: heatmapOk ? 1 : 0.55,
        }}
        title={
          heatmapOk
            ? "Sobrepor mapa de calor agregado (pés) no vídeo"
            : "Indisponível: o servidor foi iniciado com WEB_HEATMAP=0 (--no-heatmap). Reinicie com WEB_HEATMAP=1."
        }
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Mapa de calor</span>
        <button
          type="button"
          disabled={pending || !!err || !heatmapOk}
          aria-pressed={heatmapOk ? heatmap : false}
          onClick={() => {
            if (!heatmapOk || pending || err) return;
            void push({ show_heatmap: !heatmap });
          }}
          style={{
            padding: "6px 16px",
            minWidth: 96,
            borderRadius: 999,
            border: `1px solid ${
              heatmapOk && heatmap ? "rgba(245, 158, 11, 0.45)" : "var(--border)"
            }`,
            background:
              heatmapOk && heatmap ? "var(--amber-dim)" : "var(--bg-hover)",
            color: heatmapOk && heatmap ? "var(--amber)" : "var(--text-muted)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            cursor:
              pending || !!err || !heatmapOk ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {!heatmapOk ? "Indisponível" : heatmap ? "Ligado" : "Desligado"}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Marcações ROI</span>
        <button
          type="button"
          disabled={pending || !!err}
          aria-pressed={showRoi}
          onClick={() => {
            if (pending || err) return;
            void push({ show_roi: !showRoi });
          }}
          style={{
            padding: "6px 16px",
            minWidth: 96,
            borderRadius: 999,
            border: `1px solid ${showRoi ? "rgba(0, 212, 255, 0.45)" : "var(--border)"}`,
            background: showRoi ? "rgba(0, 212, 255, 0.10)" : "var(--bg-hover)",
            color: showRoi ? "var(--cyan)" : "var(--text-muted)",
            fontWeight: 700,
            fontSize: 12,
            letterSpacing: "0.04em",
            cursor: pending || !!err ? "not-allowed" : "pointer",
            transition: "background 0.15s, border-color 0.15s, color 0.15s",
          }}
        >
          {showRoi ? "Visível" : "Oculto"}
        </button>
      </div>
      {err && (
        <span style={{ fontSize: 11, color: "var(--red)" }}>{err}</span>
      )}
    </div>
  );
}
