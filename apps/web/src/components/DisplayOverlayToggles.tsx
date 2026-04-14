import { useCallback, useEffect, useState } from "react";

interface Props {
  apiBase: string;
}

/**
 * Liga/desliga overlays desenhados no servidor: rastro dos pés e seta de direção (PCA).
 */
export function DisplayOverlayToggles({ apiBase }: Props) {
  const [trail, setTrail] = useState(true);
  const [heading, setHeading] = useState(true);
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
      setReady(true);
    } catch {
      setErr("Config indisponível");
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  const push = async (next: { show_trail?: boolean; show_heading?: boolean }) => {
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
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: pending ? "wait" : "pointer", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={trail}
          disabled={pending || !!err}
          onChange={(e) => void push({ show_trail: e.target.checked })}
        />
        Rastro dos pés
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: pending ? "wait" : "pointer", fontSize: 13 }}>
        <input
          type="checkbox"
          checked={heading}
          disabled={pending || !!err}
          onChange={(e) => void push({ show_heading: e.target.checked })}
        />
        Seta de direção (PCA)
      </label>
      {err && (
        <span style={{ fontSize: 11, color: "var(--red)" }}>{err}</span>
      )}
    </div>
  );
}
