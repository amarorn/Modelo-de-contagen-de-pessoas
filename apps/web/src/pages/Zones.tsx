import { useCallback, useState } from "react";
import { useConfig } from "../hooks/useConfig";
import { useZones } from "../hooks/useZones";
import { useZoneTemplates } from "../hooks/useZoneTemplates";
import { useHotspots } from "../hooks/useHotspots";
import { TemplatePicker } from "../components/TemplatePicker";
import { ZoneEditor } from "../components/ZoneEditor";
import { HotspotOverlay } from "../components/HotspotOverlay";
import { HotspotModeSwitch } from "../components/HotspotModeSwitch";
import { ZoneMetricsPanel } from "../components/ZoneMetricsPanel";
import type { ZoneRow } from "../types/api";

interface Props {
  apiBase: string;
  onBack: () => void;
}

export function ZonesPage({ apiBase, onBack }: Props) {
  const config = useConfig(apiBase);
  const cameraId = config?.active_preset_id?.trim() || "default";
  const { zones, refresh } = useZones(apiBase, cameraId);
  const { templates } = useZoneTemplates(apiBase);
  const [hotspotMode, setHotspotMode] = useState<"composite" | "recent" | "hist">("composite");
  const hotspotPayload = useHotspots(apiBase, true, hotspotMode);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<ZoneRow | null>(null);
  const [busyTpl, setBusyTpl] = useState(false);
  const [tplSlug, setTplSlug] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplJson, setTplJson] = useState("[]");
  const [tplMsg, setTplMsg] = useState<string | null>(null);

  const applyTemplate = useCallback(
    async (slug: string) => {
      setBusyTpl(true);
      try {
        const res = await fetch(`${apiBase}/api/zones/from-template`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template_slug: slug, camera_id: cameraId }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || res.statusText);
        await refresh();
      } catch (e) {
        console.error(e);
      } finally {
        setBusyTpl(false);
      }
    },
    [apiBase, cameraId, refresh],
  );

  const deleteZone = async (id: number) => {
    const q = new URLSearchParams({ camera_id: cameraId });
    const res = await fetch(`${apiBase}/api/zones/${id}?${q}`, { method: "DELETE" });
    if (res.ok) await refresh();
  };

  const saveTemplateFromJson = async () => {
    setTplMsg(null);
    let zones: unknown;
    try {
      zones = JSON.parse(tplJson);
    } catch {
      setTplMsg("JSON invalido");
      return;
    }
    if (!tplSlug.trim() || !tplName.trim()) {
      setTplMsg("slug e name obrigatorios");
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/zone-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: tplSlug.trim(),
          name: tplName.trim(),
          description: "Importado da UI",
          zones,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setTplMsg("Template guardado.");
    } catch (e) {
      setTplMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const exportZonesJson = () => {
    const zdefs = zones.map((z) => ({
      name: z.name,
      zone_type: z.zone_type,
      polygon: z.polygon,
    }));
    setTplJson(JSON.stringify(zdefs, null, 2));
  };

  return (
    <div style={{ padding: "14px clamp(14px, 2.5vw, 28px) 32px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: "var(--text-secondary)" }}>Zonas semanticas e hotspots</h1>
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: "8px 16px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            cursor: "pointer",
          }}
        >
          Voltar ao live
        </button>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
        Camera (preset): <code>{cameraId}</code>. Use templates para onboarding rapido; desenhe zonas adicionais ou
        guarde o layout como template JSON.
      </p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontFamily: "var(--font-display)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
          Templates
        </h2>
        <TemplatePicker templates={templates} busy={busyTpl} onSelect={applyTemplate} />
      </section>

      <section style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button type="button" onClick={() => setEditorOpen(true)}>
            Nova zona (desenhar poligono)
          </button>
          <button type="button" onClick={() => void exportZonesJson()}>
            Exportar zonas para JSON
          </button>
        </div>
        <h2 style={{ fontSize: 13, fontFamily: "var(--font-display)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
          Zonas ativas
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {zones.map((z) => (
            <li
              key={z.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderBottom: "1px solid var(--border)",
                cursor: "pointer",
                background: selected?.id === z.id ? "rgba(245,158,11,0.08)" : undefined,
              }}
              onClick={() => setSelected(z)}
            >
              <span>
                <strong>{z.name}</strong>{" "}
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>({z.zone_type}) id={z.id}</span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteZone(z.id);
                }}
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontFamily: "var(--font-display)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
          Hotspot (overlay 32x18)
        </h2>
        <HotspotModeSwitch mode={hotspotMode} onChange={setHotspotMode} />
        <div style={{ marginTop: 12, maxWidth: 400, position: "relative", aspectRatio: "32/18", background: "#111", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.85 }}>
            <HotspotOverlay payload={hotspotPayload} opacity={1} />
          </div>
        </div>
        {hotspotPayload?.zones && hotspotPayload.zones.length > 0 && (
          <ul style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            {hotspotPayload.zones.map((z) => (
              <li key={z.id}>
                Zona {z.id}: score={z.score.toFixed(3)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 13, fontFamily: "var(--font-display)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
          Metricas por zona
        </h2>
        <ZoneMetricsPanel apiBase={apiBase} zone={selected} />
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontFamily: "var(--font-display)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12 }}>
          Guardar template custom (JSON)
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}>
          <input placeholder="slug (ex: minha_loja)" value={tplSlug} onChange={(e) => setTplSlug(e.target.value)} />
          <input placeholder="Nome amigavel" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <textarea
            rows={8}
            value={tplJson}
            onChange={(e) => setTplJson(e.target.value)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
          />
          <button type="button" onClick={() => void saveTemplateFromJson()}>
            POST /api/zone-templates
          </button>
          {tplMsg && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{tplMsg}</span>}
        </div>
      </section>

      {editorOpen && (
        <ZoneEditor
          apiBase={apiBase}
          cameraId={cameraId}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            void refresh();
            setEditorOpen(false);
          }}
        />
      )}
    </div>
  );
}
