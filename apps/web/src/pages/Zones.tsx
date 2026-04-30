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
import {
  IconX, IconPlus, IconTrash, IconArrowDown, IconPolygon,
  IconCheck, IconAlertTriangle,
} from "../components/Icons";
import type { ZoneRow } from "../types/api";

// IconChevronDown may not exist — fallback inline if needed
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width={12} height={12} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 0.22s ease", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

interface Props {
  apiBase: string;
  onBack: () => void;
}

const ZONE_TYPE_COLORS: Record<string, string> = {
  approach:    "var(--cyan)",
  line_band:   "var(--cyan)",
  passage:     "var(--cyan)",
  display:     "var(--amber)",
  aisle:       "var(--amber)",
  exit_area:   "#f87171",
  queue:       "#a78bfa",
  counter:     "#a78bfa",
  generic:     "var(--text-muted)",
};

function zoneTypeColor(type: string) {
  return ZONE_TYPE_COLORS[type] ?? "var(--text-muted)";
}

export function ZonesPage({ apiBase, onBack }: Props) {
  const { config } = useConfig(apiBase);
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
  const [tplMsg, setTplMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);

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
    if (res.ok) {
      if (selected?.id === id) setSelected(null);
      await refresh();
    }
  };

  const saveTemplateFromJson = async () => {
    setTplMsg(null);
    let parsedZones: unknown;
    try {
      parsedZones = JSON.parse(tplJson);
    } catch {
      setTplMsg({ text: "JSON invalido", ok: false });
      return;
    }
    if (!tplSlug.trim() || !tplName.trim()) {
      setTplMsg({ text: "slug e name obrigatorios", ok: false });
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
          zones: parsedZones,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setTplMsg({ text: "Template guardado com sucesso.", ok: true });
    } catch (e) {
      setTplMsg({ text: e instanceof Error ? e.message : String(e), ok: false });
    }
  };

  const exportZonesJson = () => {
    const zdefs = zones.map((z) => ({
      name: z.name,
      zone_type: z.zone_type,
      polygon: z.polygon,
    }));
    setTplJson(JSON.stringify(zdefs, null, 2));
    setJsonOpen(true);
  };

  return (
    <>
      <style>{`
        @keyframes zones-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes zone-card-in {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .zones-page { animation: zones-in 0.2s ease both; }
        .zone-card  { animation: zone-card-in 0.18s ease both; }

        .zone-item {
          transition: background 0.15s, border-color 0.15s;
        }
        .zone-item:hover {
          background: rgba(245,158,11,0.05) !important;
        }
        .tpl-card {
          transition: background 0.15s, border-color 0.15s, transform 0.12s;
        }
        .tpl-card:hover:not(:disabled) {
          border-color: var(--border-accent) !important;
          background: rgba(245,158,11,0.06) !important;
          transform: translateY(-1px);
        }
        .tpl-card:active:not(:disabled) {
          transform: translateY(0);
        }
        .delete-btn {
          transition: color 0.12s, opacity 0.12s;
          opacity: 0.38;
        }
        .delete-btn:hover {
          opacity: 1;
          color: #f87171 !important;
        }
        .icon-btn {
          transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        .icon-btn:hover {
          border-color: rgba(239,68,68,0.4) !important;
          color: #f87171 !important;
        }
        .export-btn {
          transition: border-color 0.15s, color 0.15s;
        }
        .export-btn:hover {
          border-color: var(--border-accent) !important;
          color: var(--amber) !important;
        }
        .json-textarea {
          resize: vertical;
          outline: none;
          transition: border-color 0.15s;
        }
        .json-textarea:focus {
          border-color: var(--border-accent) !important;
        }
        .json-input {
          outline: none;
          transition: border-color 0.15s;
        }
        .json-input:focus {
          border-color: var(--border-accent) !important;
        }
        .save-tpl-btn {
          transition: background 0.15s, color 0.15s, border-color 0.15s, opacity 0.15s;
        }
        .save-tpl-btn:hover {
          background: rgba(245,158,11,0.12) !important;
          border-color: var(--border-accent) !important;
          color: var(--amber) !important;
        }
      `}</style>

      <div
        className="zones-page"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
          background: "var(--bg-surface)",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: "11px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: "var(--amber-dim)",
              border: "1px solid var(--border-accent)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--amber)", flexShrink: 0,
            }}>
              <IconPolygon size={14} />
            </div>
            <div>
              <div style={{
                fontFamily: "var(--font-display)",
                fontSize: 13, fontWeight: 700,
                letterSpacing: "0.07em", textTransform: "uppercase",
                color: "var(--text-primary)", lineHeight: 1.2,
              }}>
                Zonas semanticas e hotspots
              </div>
              <div style={{
                fontSize: 11, color: "var(--text-muted)",
                fontFamily: "var(--font-mono)", marginTop: 2,
              }}>
                Camera:{" "}
                <span style={{ color: "var(--amber)" }}>{cameraId}</span>
                {" · "}{zones.length} zona{zones.length !== 1 ? "s" : ""} ativa{zones.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>

          <button
            onClick={onBack}
            title="Voltar ao live"
            className="icon-btn"
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "5px 10px",
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: "var(--font-display)",
              fontSize: 10, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}
          >
            <IconX size={12} />
            Fechar
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}>
          {/* ── LEFT COLUMN: Templates + Zones ── */}
          <div style={{
            width: "clamp(300px, 45%, 480px)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid var(--border)",
            overflow: "hidden",
          }}>
            {/* Templates */}
            <div style={{
              padding: "14px 14px 0",
              flexShrink: 0,
            }}>
              <SectionLabel>Templates</SectionLabel>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 8,
                marginTop: 8,
              }}>
                {templates.map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    disabled={busyTpl}
                    onClick={() => void applyTemplate(t.slug)}
                    className="tpl-card"
                    style={{
                      textAlign: "left",
                      padding: "11px 12px",
                      borderRadius: "var(--radius-md, 8px)",
                      border: "1px solid var(--border)",
                      background: "var(--bg-elevated)",
                      cursor: busyTpl ? "wait" : "pointer",
                    }}
                  >
                    <div style={{ marginBottom: 6 }}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "1px 7px",
                        borderRadius: 20,
                        fontFamily: "var(--font-display)",
                        fontSize: 9, fontWeight: 700,
                        letterSpacing: "0.14em", textTransform: "uppercase",
                        background: t.builtin ? "var(--amber-dim)" : "rgba(16,185,129,0.1)",
                        border: `1px solid ${t.builtin ? "var(--border-accent)" : "rgba(16,185,129,0.28)"}`,
                        color: t.builtin ? "var(--amber)" : "#10b981",
                      }}>
                        {t.builtin ? "Builtin" : "Custom"}
                      </span>
                    </div>
                    <div style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 11, fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: "var(--text-secondary)",
                      marginBottom: 3,
                    }}>
                      {t.name}
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      lineHeight: 1.45,
                      fontFamily: "var(--font-mono)",
                    }}>
                      {t.description || t.slug}
                    </div>
                  </button>
                ))}
                {templates.length === 0 && (
                  <div style={{
                    gridColumn: "1/-1",
                    padding: "14px 10px",
                    textAlign: "center",
                    border: "1px dashed var(--border)",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10, color: "var(--text-muted)", opacity: 0.5,
                  }}>
                    Nenhum template disponivel
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div style={{ margin: "14px 0 0", borderTop: "1px solid var(--border)" }} />

            {/* Zones list header */}
            <div style={{
              padding: "10px 14px 8px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <SectionLabel style={{ marginBottom: 0 }}>
                Zonas ativas
                <span style={{
                  marginLeft: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9, fontWeight: 700,
                  color: zones.length > 0 ? "var(--amber)" : "var(--text-muted)",
                  transition: "color 0.2s",
                }}>
                  {zones.length}
                </span>
              </SectionLabel>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => void exportZonesJson()}
                  className="export-btn"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 9px",
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                    fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                  }}
                >
                  <IconArrowDown size={10} />
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 9px",
                    borderRadius: 5,
                    border: "1px solid var(--border-accent)",
                    background: "var(--amber-dim)",
                    color: "var(--amber)",
                    cursor: "pointer",
                    fontFamily: "var(--font-display)",
                    fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.8"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                >
                  <IconPlus size={10} />
                  Nova zona
                </button>
              </div>
            </div>

            {/* Zones list */}
            <div style={{
              flex: 1,
              overflowY: "auto",
              padding: "0 14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}>
              {zones.length === 0 ? (
                <div style={{
                  padding: "20px 12px",
                  textAlign: "center",
                  border: "1px dashed var(--border)",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10, color: "var(--text-muted)", opacity: 0.5,
                }}>
                  Nenhuma zona activa · aplique um template ou desenhe manualmente
                </div>
              ) : (
                zones.map((z, i) => {
                  const isSelected = selected?.id === z.id;
                  const typeColor = zoneTypeColor(z.zone_type);
                  return (
                    <div
                      key={z.id}
                      className="zone-card zone-item"
                      onClick={() => setSelected(isSelected ? null : z)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "9px 11px",
                        borderRadius: 8,
                        border: `1px solid ${isSelected ? "var(--border-accent)" : "var(--border)"}`,
                        background: isSelected ? "rgba(245,158,11,0.07)" : "var(--bg-elevated)",
                        cursor: "pointer",
                        animationDelay: `${Math.min(i * 0.04, 0.2)}s`,
                      }}
                    >
                      {/* Color dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%",
                        background: typeColor,
                        flexShrink: 0,
                        boxShadow: isSelected ? `0 0 6px ${typeColor}` : "none",
                        transition: "box-shadow 0.2s",
                      }} />

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 11, fontWeight: 700,
                          letterSpacing: "0.04em",
                          color: isSelected ? "var(--amber)" : "var(--text-secondary)",
                          transition: "color 0.15s",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {z.name}
                        </div>
                        <div style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9, color: "var(--text-muted)",
                          marginTop: 2,
                        }}>
                          {z.zone_type} · id={z.id} · {z.polygon.length} pts
                        </div>
                      </div>

                      {/* Delete */}
                      <button
                        type="button"
                        className="delete-btn"
                        onClick={(e) => { e.stopPropagation(); void deleteZone(z.id); }}
                        title="Remover zona"
                        style={{
                          background: "none", border: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          padding: 3, borderRadius: 4,
                          display: "flex", alignItems: "center",
                          flexShrink: 0,
                        }}
                      >
                        <IconTrash size={11} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: Hotspot + Metrics + JSON ── */}
          <div style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}>
            {/* Hotspot section */}
            <div style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <SectionLabel style={{ marginBottom: 0 }}>Hotspot · overlay 32×18</SectionLabel>
                <HotspotModeSwitch mode={hotspotMode} onChange={setHotspotMode} />
              </div>

              {/* Heatmap */}
              <div style={{
                position: "relative",
                aspectRatio: "32/18",
                maxWidth: 480,
                background: "#0a0a0a",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--border)",
              }}>
                <div style={{ position: "absolute", inset: 0, opacity: 0.9 }}>
                  <HotspotOverlay payload={hotspotPayload} opacity={1} />
                </div>
                {!hotspotPayload && (
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: "var(--text-muted)", opacity: 0.4,
                    letterSpacing: "0.12em", textTransform: "uppercase",
                  }}>
                    aguardando dados…
                  </div>
                )}
              </div>

              {/* Zone scores */}
              {hotspotPayload?.zones && hotspotPayload.zones.length > 0 && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8,
                }}>
                  {hotspotPayload.zones.map((z) => (
                    <span
                      key={z.id}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "2px 8px",
                        borderRadius: 20,
                        background: "var(--amber-dim)",
                        border: "1px solid var(--border-accent)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 9, fontWeight: 700,
                        color: "var(--amber)",
                      }}
                    >
                      <span style={{ color: "var(--text-muted)" }}>z{z.id}</span>
                      {z.score.toFixed(3)}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Metrics section */}
            <div style={{
              flex: 1,
              minHeight: 0,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <SectionLabel style={{ marginBottom: 0 }}>Metricas por zona</SectionLabel>
                {selected && (
                  <span style={{
                    display: "inline-flex", alignItems: "center",
                    padding: "1px 8px",
                    borderRadius: 20,
                    background: "var(--amber-dim)",
                    border: "1px solid var(--border-accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 9, fontWeight: 700,
                    color: "var(--amber)",
                  }}>
                    {selected.name}
                  </span>
                )}
              </div>
              {!selected && (
                <div style={{
                  flex: 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "1px dashed var(--border)",
                  borderRadius: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10, color: "var(--text-muted)", opacity: 0.45,
                  textAlign: "center", padding: 16,
                }}>
                  Seleccione uma zona na lista para ver as metricas
                </div>
              )}
              {selected && (
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <ZoneMetricsPanel apiBase={apiBase} zone={selected} />
                </div>
              )}
            </div>

            {/* JSON Template accordion */}
            <div style={{
              borderTop: "1px solid var(--border)",
              flexShrink: 0,
            }}>
              {/* Accordion header */}
              <button
                type="button"
                onClick={() => setJsonOpen((v) => !v)}
                style={{
                  width: "100%",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 16px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.02)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >
                <span style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9, fontWeight: 700,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: "var(--text-muted)",
                }}>
                  Guardar template custom (JSON)
                </span>
                <ChevronIcon open={jsonOpen} />
              </button>

              {/* Accordion body */}
              {jsonOpen && (
                <div style={{
                  padding: "0 16px 14px",
                  display: "flex", flexDirection: "column", gap: 7,
                  borderTop: "1px solid var(--border)",
                  paddingTop: 12,
                }}>
                  <input
                    className="json-input"
                    placeholder="slug (ex: minha_loja)"
                    value={tplSlug}
                    onChange={(e) => setTplSlug(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)", fontSize: 11,
                    }}
                  />
                  <input
                    className="json-input"
                    placeholder="Nome amigavel"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)", fontSize: 11,
                    }}
                  />
                  <textarea
                    className="json-textarea"
                    rows={6}
                    value={tplJson}
                    onChange={(e) => setTplJson(e.target.value)}
                    style={{
                      padding: "7px 10px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font-mono)", fontSize: 10,
                      lineHeight: 1.55,
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 11, flex: 1 }}>
                      {tplMsg && (
                        <span style={{
                          display: "flex", alignItems: "center", gap: 6,
                          color: tplMsg.ok ? "#10b981" : "#f87171",
                          fontFamily: "var(--font-mono)", fontSize: 10,
                        }}>
                          {tplMsg.ok ? <IconCheck size={11} /> : <IconAlertTriangle size={11} />}
                          {tplMsg.text}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveTemplateFromJson()}
                      className="save-tpl-btn"
                      style={{
                        display: "flex", alignItems: "center", gap: 5,
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elevated)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        fontFamily: "var(--font-display)",
                        fontSize: 10, fontWeight: 700,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                        flexShrink: 0,
                      }}
                    >
                      <IconCheck size={11} />
                      POST /api/zone-templates
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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
    </>
  );
}

/* ── Helpers ── */
function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      fontFamily: "var(--font-display)",
      fontSize: 9, fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase",
      color: "var(--text-muted)",
      marginBottom: 0,
      ...style,
    }}>
      {children}
    </div>
  );
}
