import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { LiveFeed } from "../components/LiveFeed";
import { ProfileSelector } from "../components/ProfileSelector";
import { TrackingModeToggle } from "../components/TrackingModeToggle";
import { DisplayOverlayToggles } from "../components/DisplayOverlayToggles";
interface SourcePreset {
  id: string;
  label: string;
  url: string;
}

interface LiveStats {
  infer_fps_ema?: number;
  moving_now?: number;
  stationary_now?: number;
  loitering_now?: number;
  low_conf_tracks?: number;
  suppressed_events?: number;
  vehicle_tracking_available?: boolean;
  yolo_count_class_ids?: number[];
  yolo_class_labels?: Record<string, string>;
  track_active_class_ids?: number[];
  active_env_profile?: string;
}

interface Props {
  apiBase: string;
  stats: LiveStats;
  config: unknown;
  refetchConfig: () => void;
  onOpenSource: () => void;
  onOpenRoi: () => void;
}

export function LivePage({ apiBase, stats, onOpenSource, onOpenRoi }: Props) {
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["camera", "visuals"]),
  );

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* ── Left: Video panel ── */}
      <div
        style={{
          flex: "1 1 0",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <LiveFeed apiBase={apiBase} hero inferFpsEma={stats.infer_fps_ema} />

        {/* Action bar */}
        <div
          style={{
            padding: "9px 16px",
            borderTop: "1px solid var(--border)",
            background:
              "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <TrackingModeToggle
            apiBase={apiBase}
            vehicleTrackingAvailable={stats.vehicle_tracking_available ?? false}
            yoloCountClassIds={stats.yolo_count_class_ids ?? []}
            yoloClassLabels={stats.yolo_class_labels ?? {}}
            trackActiveClassIds={stats.track_active_class_ids ?? []}
          />
          <div
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            {typeof stats.infer_fps_ema === "number" && (
              <span
                style={{
                  color:
                    stats.infer_fps_ema > 1 ? "var(--cyan)" : "var(--text-muted)",
                }}
              >
                {stats.infer_fps_ema.toFixed(1)} FPS
              </span>
            )}
            {typeof stats.moving_now === "number" && (
              <span>
                <span style={{ color: "var(--green)" }}>
                  {stats.moving_now}
                </span>{" "}
                em mov.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Right: Config panel ── */}
      <div
        style={{
          width: 370,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg-surface)",
          overflow: "hidden",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.2)",
        }}
      >
        {/* Panel header */}
        <div
          style={{
            padding: "11px 16px",
            borderBottom: "1px solid var(--border)",
            background:
              "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--amber)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Controlo ao vivo
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 999,
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.25)",
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--red)",
                animation: "pulse 0.9s infinite",
                display: "inline-block",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.16em",
                color: "var(--red)",
              }}
            >
              AO VIVO
            </span>
          </div>
        </div>

        {/* Scrollable panel content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* Camera section */}
          <PanelSection
            title="Câmera"
            color="var(--amber)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            }
            open={openSections.has("camera")}
            onToggle={() => toggleSection("camera")}
          >
            <CameraSection
              apiBase={apiBase}
              onOpenSource={onOpenSource}
              onOpenRoi={onOpenRoi}
            />
          </PanelSection>

          {/* Visuals section */}
          <PanelSection
            title="Visualização"
            color="var(--cyan)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            }
            open={openSections.has("visuals")}
            onToggle={() => toggleSection("visuals")}
          >
            <div style={{ padding: "4px 0" }}>
              <DisplayOverlayToggles apiBase={apiBase} />
            </div>
          </PanelSection>

          <PanelSection
            title="Stream ao vivo (MJPEG)"
            color="#22d3ee"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="10" rx="2" />
                <circle cx="8" cy="12" r="1.5" fill="currentColor" />
                <path d="M14 10v4l3-2-3-2z" />
              </svg>
            }
            open={openSections.has("mjpeg")}
            onToggle={() => toggleSection("mjpeg")}
          >
            <div style={{ padding: "0 0 10px" }}>
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(34,211,238,0.08)",
                  border: "1px solid rgba(34,211,238,0.22)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                  fontFamily: "var(--font-sans)",
                }}
              >
                <strong style={{ color: "var(--text-secondary)" }} >
                  Mais fluidez:
                </strong>{" "}
                o teto{" "}
                <strong style={{ color: "var(--cyan)" }} >
                  FPS máximo
                </strong>{" "}
                deve ser{" "}
                <strong>≥</strong> o ritmo a que o servidor gera JPEGs. Veja o FPS de inferência na barra
                abaixo do vídeo
                {typeof stats.infer_fps_ema === "number" && stats.infer_fps_ema > 0.05
                  ? ` (~${stats.infer_fps_ema.toFixed(1)} FPS no indicador)`
                  : ""}
                . Valores típicos <strong>12–18</strong> (máquina forte: até <strong>24</strong>). Com máximo em{" "}
                <strong>1</strong> o stream fica limitado a 1 img/s. O{" "}
                <strong>piso adaptativo</strong> não pode ser maior que o máximo (o servidor limita, mas
                confunde o ajuste). Ligue <strong>Rajada em frame novo</strong> para suavizar saltos entre
                frames.
              </div>
            </div>
            <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={MJPEG_FIELDS} />
          </PanelSection>

          {/* Detection section */}
          <PanelSection
            title="Ajustes de Detecção"
            color="#818cf8"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            }
            open={openSections.has("detection")}
            onToggle={() => toggleSection("detection")}
          >
            <DetectionSection apiBase={apiBase} stats={stats} />
          </PanelSection>

          {/* Confidence section */}
          <PanelSection
            title="Confiança de Contagem"
            color="var(--green)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            }
            open={openSections.has("confidence")}
            onToggle={() => toggleSection("confidence")}
          >
            <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={CONFIDENCE_FIELDS} />
          </PanelSection>

          {/* Watchdog section */}
          <PanelSection
            title="Reconexão de Stream"
            color="var(--amber)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            }
            open={openSections.has("watchdog")}
            onToggle={() => toggleSection("watchdog")}
          >
            <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={WATCHDOG_FIELDS} />
          </PanelSection>

          {/* Analytics section */}
          <PanelSection
            title="Banco de Dados"
            color="#a78bfa"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            }
            open={openSections.has("analytics")}
            onToggle={() => toggleSection("analytics")}
          >
            <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={ANALYTICS_FIELDS} />
          </PanelSection>

          {/* Alerts section */}
          <PanelSection
            title="Alertas"
            color="var(--red)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            }
            open={openSections.has("alerts")}
            onToggle={() => toggleSection("alerts")}
          >
            <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={ALERTS_FIELDS} />
          </PanelSection>

          {/* Profile section */}
          <PanelSection
            title="Perfil da Câmera"
            color="var(--green)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            }
            open={openSections.has("profile")}
            onToggle={() => toggleSection("profile")}
          >
            <div style={{ padding: "4px 0" }}>
              <ProfileSelector
                apiBase={apiBase}
                activeProfile={stats.active_env_profile}
              />
            </div>
          </PanelSection>

          {/* Stats section */}
          <PanelSection
            title="Desempenho em Tempo Real"
            color="var(--text-muted)"
            icon={
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            }
            open={openSections.has("stats")}
            onToggle={() => toggleSection("stats")}
          >
            <StatsSection stats={stats} />
          </PanelSection>
        </div>
      </div>

    </div>
  );
}

/* ── PanelSection ─────────────────────────────────────────────── */

interface PanelSectionProps {
  title: string;
  color: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function PanelSection({ title, color, icon, open, onToggle, children }: PanelSectionProps) {
  return (
    <div
      style={{
        borderBottom: "1px solid var(--border)",
        borderLeft: `2px solid ${open ? color : "transparent"}`,
        transition: "border-left-color 0.2s",
      }}
    >
      {/* Section header */}
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: open ? `${color}08` : "transparent",
          border: "none",
          cursor: "pointer",
          transition: "background 0.15s",
          gap: 8,
        }}
        onMouseEnter={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.background =
              "var(--bg-elevated)";
        }}
        onMouseLeave={(e) => {
          if (!open)
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: open ? color : "var(--text-muted)",
            transition: "color 0.15s",
          }}
        >
          {icon}
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke={open ? color : "var(--text-muted)"}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease, stroke 0.15s",
            flexShrink: 0,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Section content */}
      {open && (
        <div
          style={{
            padding: "4px 16px 14px",
            animation: "fadeIn 0.15s ease",
          }}
        >
          <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }`}</style>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── CameraSection ────────────────────────────────────────────── */

function CameraSection({
  apiBase,
  onOpenSource,
  onOpenRoi,
}: {
  apiBase: string;
  onOpenSource: () => void;
  onOpenRoi: () => void;
}) {
  const [presets, setPresets] = useState<SourcePreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>("");
  const [currentSource, setCurrentSource] = useState<string>("");
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/api/source`, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setCurrentSource(typeof d.source === "string" ? d.source : "");
      setActivePresetId(typeof d.active_preset_id === "string" ? d.active_preset_id : "");
      setPresets(Array.isArray(d.presets) ? d.presets : []);
    } catch { /* silent */ }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  const switchTo = async (preset: SourcePreset) => {
    if (switching) return;
    setSwitching(true);
    try {
      const r = await fetch(`${apiBase}/api/source/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset_id: preset.id }),
      });
      if (r.ok) {
        const j = await r.json();
        setCurrentSource(j.source ?? preset.url);
        setActivePresetId(j.active_preset_id ?? preset.id);
      }
    } catch { /* silent */ } finally {
      setSwitching(false);
    }
  };

  const sourceKind = (() => {
    const s = currentSource.toLowerCase();
    if (!s) return null;
    if (s.startsWith("rtsp://")) return { label: "RTSP", color: "#f97316" };
    if (s.includes(".m3u8") || s.startsWith("hls://")) return { label: "HLS", color: "#a78bfa" };
    if (s === "0" || s === "1" || s === "2") return { label: "Câmera local", color: "var(--green)" };
    if (s.includes("mjpeg") || s.includes("mjpg")) return { label: "MJPEG", color: "var(--cyan)" };
    if (s.includes("youtube.com") || s.includes("youtu.be")) return { label: "YouTube", color: "#ef4444" };
    if (s.startsWith("http")) return { label: "HTTP/URL", color: "var(--amber)" };
    return { label: "Ficheiro", color: "var(--text-muted)" };
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Current source display */}
      {currentSource && (
        <div
          style={{
            padding: "8px 10px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            {sourceKind && (
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: sourceKind.color,
                  padding: "1px 6px",
                  borderRadius: 3,
                  background: `${sourceKind.color}18`,
                  border: `1px solid ${sourceKind.color}30`,
                }}
              >
                {sourceKind.label}
              </span>
            )}
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              Fonte activa
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={currentSource}
          >
            {currentSource}
          </div>
        </div>
      )}

      {/* Preset list */}
      {presets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 2,
            }}
          >
            Câmeras salvas · {presets.length}
          </div>
          {presets.map((p, i) => {
            const isActive = p.id === activePresetId;
            return (
              <button
                key={p.id}
                type="button"
                disabled={switching}
                onClick={() => switchTo(p)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 10px",
                  background: isActive ? "var(--amber-dim)" : "var(--bg-elevated)",
                  border: `1px solid ${isActive ? "var(--border-accent)" : "var(--border)"}`,
                  borderLeft: `3px solid ${isActive ? "var(--amber)" : "transparent"}`,
                  borderRadius: "var(--radius-sm)",
                  cursor: switching ? "wait" : "pointer",
                  textAlign: "left",
                  transition: "background 0.12s, border-color 0.12s",
                  opacity: switching && !isActive ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: isActive ? "var(--amber)" : "rgba(255,255,255,0.06)",
                    color: isActive ? "#0a0a0b" : "var(--text-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontFamily: "var(--font-display)",
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 500,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: isActive ? "var(--amber)" : "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.label}
                </span>
                {isActive && (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--amber)",
                      flexShrink: 0,
                      animation: "pulse 1.8s ease-in-out infinite",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
        <PanelBtn
          onClick={onOpenSource}
          icon={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          }
        >
          Fonte de Vídeo
        </PanelBtn>
        <PanelBtn
          onClick={onOpenRoi}
          accent
          icon={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="22" y1="12" x2="18" y2="12" />
              <line x1="6" y1="12" x2="2" y2="12" />
              <line x1="12" y1="6" x2="12" y2="2" />
              <line x1="12" y1="22" x2="12" y2="18" />
            </svg>
          }
        >
          Configurar ROI
        </PanelBtn>
      </div>
    </div>
  );
}

/* ── LiveSettingsGroup (genérico) ─────────────────────────────── */

interface LiveField {
  key: string;
  label: string;
  description: string;
  type: "slider" | "number" | "text" | "toggle";
  min?: number;
  max?: number;
  step?: number;
  color: string;
  wide?: boolean;
}

// ─── campo por campo ────────────────────────────────────────────
const OVERLAY_PERSON_FIELDS: LiveField[] = [
  {
    key: "YOLO_OVERLAY_MIN_DET_CONF",
    label: "Confiança mínima — overlay",
    description:
      "Só desenha caixa se a confiança da deteção neste frame for ≥ este valor (todas as classes). Subir reduz fantasmas em reflexos e linhas do passeio; desça se pessoas reais deixarem de aparecer.",
    type: "slider",
    min: 0.1,
    max: 0.55,
    step: 0.01,
    color: "#22d3ee",
  },
  {
    key: "YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC",
    label: "Margem lateral — pessoas",
    description:
      "Fracção da largura em cada lado (faixa onde o filtro de borda actua). 0 = desligado.",
    type: "slider",
    min: 0,
    max: 0.2,
    step: 0.005,
    color: "#38bdf8",
  },
  {
    key: "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC",
    label: "Cobertura na margem — pessoas",
    description:
      "Fracção mínima da largura da bbox nas margens laterais para esconder o overlay (pilhas na borda). 0 = só centro na margem. Omisso no servidor ≈ 0,5.",
    type: "slider",
    min: 0,
    max: 1,
    step: 0.05,
    color: "#67e8f9",
  },
  {
    key: "YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC",
    label: "Zona de reflexo (fracção)",
    description:
      "Define um rectângulo central em coords normalizadas: se o centro da bbox cair lá dentro, exige a confiança mínima abaixo. 0 = desliga este filtro. Ex.: 0,20 → região central ~60% do frame.",
    type: "slider",
    min: 0,
    max: 0.45,
    step: 0.01,
    color: "#a5f3fc",
  },
  {
    key: "YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF",
    label: "Conf. mínima na zona de reflexo",
    description:
      "Só actua com «Zona de reflexo» > 0. Na zona central, não desenha pessoa se a confiança da deteção for inferior a este valor (corta P… no chão brilhante).",
    type: "slider",
    min: 0.2,
    max: 0.55,
    step: 0.01,
    color: "#bae6fd",
  },
  {
    key: "YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC",
    label: "Altura mínima — pessoas (overlay)",
    description:
      "Altura mínima da bbox em fracção da altura do frame. Corta caixas muito baixas (reflexos no chão). 0 = desligado; valores altos escondem pessoas ao longe.",
    type: "slider",
    min: 0,
    max: 0.12,
    step: 0.001,
    color: "#7dd3fc",
  },
];

const OVERLAY_VEHICLE_FIELDS: LiveField[] = [
  {
    key: "YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC",
    label: "Margem lateral (overlay veículos)",
    description:
      "Fracção da largura do frame em cada lado. Define a faixa onde o filtro de borda actua. 0 = desligado.",
    type: "slider",
    min: 0,
    max: 0.2,
    step: 0.005,
    color: "#fb923c",
  },
  {
    key: "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC",
    label: "Cobertura na margem — veículos",
    description:
      "Fracção mínima da largura da bbox que intersecta as margens laterais para esconder o overlay (corta pilhas na borda). 0 = apenas «centro na margem» (mais permissivo). 0,5 = metade ou mais da largura na margem.",
    type: "slider",
    min: 0,
    max: 1,
    step: 0.05,
    color: "#fdba74",
  },
];

const DETECTION_FIELDS: LiveField[] = [
  {
    key: "YOLO_INFER_CONF",
    label: "Sensibilidade de detecção",
    description: "O quão certo o sistema precisa estar para considerar que viu uma pessoa. Valor baixo → detecta mais pessoas, mas pode confundir objetos com pessoas. Valor alto → só conta quando tem certeza, mas pode deixar passar pessoas de costas ou parcialmente visíveis.",
    type: "slider",
    min: 0.1,
    max: 0.95,
    step: 0.01,
    color: "var(--amber)",
  },
  {
    key: "YOLO_MIN_DET_CONF",
    label: "Certeza mínima para rastrear",
    description: "Nível mínimo de certeza para o sistema começar a seguir uma pessoa na tela. Abaixo desse valor a pessoa é vista mas não rastreada (sem ID, sem contagem). Aumente se houver muitas \"sombras\" sendo rastreadas; reduza se pessoas reais estiverem sendo ignoradas.",
    type: "slider",
    min: 0.05,
    max: 0.9,
    step: 0.01,
    color: "var(--cyan)",
  },
  {
    key: "YOLO_VID_STRIDE",
    label: "Frequência de análise",
    description: "A cada quantos quadros de vídeo o sistema faz uma análise completa. Valor 1 = analisa todos os quadros (mais preciso, mais lento). Valor 3 = analisa 1 em cada 3 quadros (mais rápido, pode perder travessias muito rápidas). Recomendado: 2 ou 3 para câmeras ao vivo.",
    type: "number",
    min: 1,
    max: 10,
    step: 1,
    color: "#818cf8",
  },
];

const CONFIDENCE_FIELDS: LiveField[] = [
  {
    key: "TRACK_CONF_SUPPRESS_THRESHOLD",
    label: "Score mínimo para contar",
    description: "Confiança mínima do rastreamento para registar um cruzamento. Suba se houver contagens falsas; desça se pessoas reais forem ignoradas.",
    type: "slider", min: 0.05, max: 0.95, step: 0.01,
    color: "var(--green)",
  },
  {
    key: "TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD",
    label: "Score mínimo — veículos",
    description: "Mesmo limiar, mas para veículos. O padrão é mais baixo porque carros têm bbox mais instável.",
    type: "slider", min: 0.05, max: 0.95, step: 0.01,
    color: "var(--cyan)",
  },
  {
    key: "TRACK_CONF_MIN_AGE_FRAMES",
    label: "Frames mínimos antes de contar",
    description: "Quantos frames uma pessoa precisa aparecer antes de poder cruzar a linha. 1 = mais sensível; 5+ = evita flashes mas pode perder passagens rápidas.",
    type: "number", min: 1, max: 20, step: 1,
    color: "#34d399",
  },
];

const WATCHDOG_FIELDS: LiveField[] = [
  {
    key: "YOLO_WATCHDOG_SOFT_S",
    label: "Reconexão suave (s)",
    description: "Segundos sem frame antes de tentar reabrir o stream. Aumente em CDNs lentos.",
    type: "number", min: 10, max: 3600, step: 10,
    color: "var(--amber)",
  },
  {
    key: "YOLO_WATCHDOG_HARD_S",
    label: "Reinício completo (s)",
    description: "Segundos sem frame antes de matar e reiniciar o processo inteiro. Deve ser maior que o suave.",
    type: "number", min: 30, max: 7200, step: 30,
    color: "#fb923c",
  },
  {
    key: "YOLO_FEED_STALE_S",
    label: "Aviso visual de offline (s)",
    description: "Segundos sem frame antes de mostrar \"FONTE OFFLINE\" na tela. Não afeta a reconexão.",
    type: "number", min: 3, max: 120, step: 1,
    color: "var(--text-muted)",
  },
];

const MJPEG_FIELDS: LiveField[] = [
  {
    key: "YOLO_MJPEG_MAX_FPS",
    label: "FPS máximo no browser",
    description:
      "Teto de imagens/s no MJPEG. Para mais fluidez, suba até ficar perto do FPS de inferência (barra do vídeo); baixe só se a rede ou o PC não aguentarem.",
    type: "slider",
    min: 1,
    max: 30,
    step: 1,
    color: "var(--cyan)",
  },
  {
    key: "YOLO_MJPEG_ADAPTIVE_FPS",
    label: "FPS adaptativo ao infer",
    description:
      "Ligado: o limite segue o infer_fps (× margem). Com infer ~8–12 FPS e «smooth display», desligar costuma dar MJPEG mais regular (menos solavanco). Reinicie o servidor se editou só o .env.",
    type: "toggle",
    color: "#22d3ee",
  },
  {
    key: "YOLO_MJPEG_ADAPTIVE_HEADROOM",
    label: "Margem adaptativa",
    description:
      "Ex.: 1,12–1,22 em cima do infer_fps. Valores altos (ex. 1,4) puxam mais FPS e mais carga; 1,15 é um bom ponto de partida.",
    type: "slider",
    min: 1.0,
    max: 1.8,
    step: 0.01,
    color: "var(--cyan)",
  },
  {
    key: "YOLO_MJPEG_ADAPTIVE_MIN_FPS",
    label: "FPS mínimo adaptativo",
    description:
      "Piso quando o adaptativo está ligado. Deve ser ≤ ao FPS máximo (senão o servidor corta ao máximo). Ex.: máx. 16 → mín. 8–12.",
    type: "slider",
    min: 1,
    max: 30,
    step: 1,
    color: "#67e8f9",
  },
  {
    key: "YOLO_MJPEG_BURST_NEW",
    label: "Rajada em frame novo",
    description:
      "Recomendado ligado: com frame novo, pode emitir mais rápido até ao teto «Rajada FPS» (menos atraso visível). «Inativo» aqui sobrepõe o .env até guardar de novo.",
    type: "toggle",
    color: "#a5f3fc",
  },
  {
    key: "YOLO_MJPEG_BURST_CAP_FPS",
    label: "Rajada FPS (teto)",
    description: "Limite superior de emissões por segundo durante rajada com frame novo.",
    type: "slider",
    min: 10,
    max: 60,
    step: 1,
    color: "#7dd3fc",
  },
];

const ANALYTICS_FIELDS: LiveField[] = [
  {
    key: "ANALYTICS_KAFKA_PUBLISH",
    label: "Gravar no banco de dados",
    description: "0 = dados ficam só em memória (zero nos relatórios). 1 = grava via Kafka/Redpanda — requer run_analytics_kafka_consumer.sh ativo.",
    type: "toggle",
    color: "#a78bfa",
  },
  {
    key: "DATABASE_URL",
    label: "URL do banco de dados",
    description: "SQLAlchemy URL. Postgres: postgresql+psycopg2://user:pass@host:5433/db. SQLite: sqlite:///data/contagem.db",
    type: "text", wide: true,
    color: "#a78bfa",
  },
  {
    key: "KAFKA_BOOTSTRAP_SERVERS",
    label: "Servidor Kafka/Redpanda",
    description: "Endereço do broker. Ex.: 127.0.0.1:19092 (host) ou redpanda:9092 (Docker).",
    type: "text",
    color: "#c4b5fd",
  },
];

const ALERTS_FIELDS: LiveField[] = [
  {
    key: "ALERT_CAP_ENABLED",
    label: "Detectar boné / chapéu",
    description: "Activa alerta sonoro ao detectar boné/chapéu com IA (CLIP). Requer pip install open-clip-torch (~350 MB).",
    type: "toggle",
    color: "var(--red)",
  },
  {
    key: "ALERT_CAP_THRESHOLD",
    label: "Sensibilidade do alerta de boné",
    description: "Probabilidade mínima para confirmar boné. Baixe se perder alertas; suba se tiver falsos positivos.",
    type: "slider", min: 0.1, max: 0.95, step: 0.01,
    color: "#f87171",
  },
  {
    key: "ALERT_CAR_COLOR",
    label: "Cores de veículo para alertar",
    description: "Lista separada por vírgula. Ex.: vermelho,amarelo. Deixe vazio para desativar.",
    type: "text",
    color: "#fca5a5",
  },
  {
    key: "ALERT_COOLDOWN",
    label: "Intervalo entre alertas (s)",
    description: "Segundos mínimos entre alertas do mesmo tipo para o mesmo veículo ou pessoa.",
    type: "number", min: 0.5, max: 60, step: 0.5,
    color: "#fda4af",
  },
];

// ─── componente genérico ────────────────────────────────────────
function LiveSettingsGroup({ apiBase, stats, fields }: { apiBase: string; stats: LiveStats; fields: LiveField[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const reloadTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const statsRef = useRef<LiveStats>(stats);

  type ReloadUi =
    | {
        kind: "stream_reload";
        startedAt: number;
        maxMs: number;
      }
    | {
        kind: "restart_required";
      };

  const [reloadUi, setReloadUi] = useState<Record<string, ReloadUi | null>>({});
  const [, setReloadTick] = useState(0);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  useEffect(() => {
    return () => {
      Object.values(reloadTimers.current).forEach((t) => clearInterval(t));
      reloadTimers.current = {};
    };
  }, []);

  const clearReloadTimer = (key: string) => {
    const t = reloadTimers.current[key];
    if (t) clearInterval(t);
    delete reloadTimers.current[key];
  };

  const startStreamReloadUi = (key: string) => {
    clearReloadTimer(key);
    const maxMs = 15000;
    setReloadUi((m) => ({ ...m, [key]: { kind: "stream_reload", startedAt: Date.now(), maxMs } }));
    reloadTimers.current[key] = setInterval(() => {
      setReloadTick((t) => t + 1);
      setReloadUi((m) => {
        const cur = m[key];
        if (!cur || cur.kind !== "stream_reload") return m;
        if (Date.now() - cur.startedAt >= cur.maxMs) {
          clearReloadTimer(key);
          const next = { ...m, [key]: null };
          return next;
        }
        const fps = Number(statsRef.current.infer_fps_ema ?? 0);
        if (fps > 0.25) {
          clearReloadTimer(key);
          return { ...m, [key]: null };
        }
        return { ...m };
      });
    }, 350);
  };

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${apiBase}/api/settings`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((d: { env?: Record<string, string> }) => {
        const env = d.env ?? {};
        const initial: Record<string, string> = {};
        for (const f of fields) {
          if (env[f.key] !== undefined) initial[f.key] = env[f.key];
        }
        setValues(initial);
        setLoaded(true);
      })
      .catch((e) => {
        if ((e as DOMException).name !== "AbortError") setLoadErr("Falha ao carregar");
      });
    return () => ctrl.abort();
  }, [apiBase]);

  const saveField = async (key: string, value: string) => {
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const r = await fetch(`${apiBase}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        restart_required?: boolean;
        stream_reload_requested?: boolean;
      };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setDirty((d) => ({ ...d, [key]: false }));
      setSaved((s) => ({ ...s, [key]: true }));
      clearTimeout(savedTimers.current[key]);
      savedTimers.current[key] = setTimeout(() => {
        setSaved((s) => ({ ...s, [key]: false }));
      }, 2000);

      clearReloadTimer(key);
      setReloadUi((m) => ({ ...m, [key]: null }));
      if (j.restart_required) {
        setReloadUi((m) => ({ ...m, [key]: { kind: "restart_required" } }));
      } else if (j.stream_reload_requested) {
        startStreamReloadUi(key);
      }
    } catch { /* silent */ } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  if (!loaded && !loadErr) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
          padding: "8px 0",
          fontFamily: "var(--font-display)",
          letterSpacing: "0.08em",
        }}
      >
        Carregando…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div style={{ fontSize: 11, color: "var(--red)", padding: "8px 0" }}>
        {loadErr}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          padding: "7px 10px",
          borderRadius: "var(--radius-sm)",
          background: "rgba(129,140,248,0.06)",
          border: "1px solid rgba(129,140,248,0.18)",
          fontSize: 11,
          color: "var(--text-muted)",
          lineHeight: 1.45,
          fontFamily: "var(--font-sans)",
        }}
      >
        Ajustes abaixo entram em vigor imediatamente, sem precisar reiniciar. Em casos extremos (ex.: troca de modelo) pode ser necessário reiniciar o servidor.
      </div>

      {fields.map((f) => {
        const raw = values[f.key];
        if (raw === undefined) return null;
        const numVal = parseFloat(raw);
        const isSlider = f.type === "slider";
        const isToggle = f.type === "toggle";
        const isText = f.type === "text";
        const isSaving = saving[f.key];
        const isSaved = saved[f.key];
        const isDirty = dirty[f.key];
        const ru = reloadUi[f.key];
        const streamPct =
          ru && ru.kind === "stream_reload"
            ? Math.min(100, ((Date.now() - ru.startedAt) / ru.maxMs) * 100)
            : 0;

        return (
          <div key={f.key}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: f.color,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginTop: 1,
                    lineHeight: 1.35,
                    maxWidth: 220,
                  }}
                >
                  {f.description}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexShrink: 0,
                }}
              >
                {isSaved && (
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: "var(--green)",
                    }}
                  >
                    Salvo ✓
                  </span>
                )}
                {!isText && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      fontWeight: 700,
                      color: f.color,
                      minWidth: 36,
                      textAlign: "right",
                    }}
                  >
                    {isToggle
                      ? (raw === "1" ? "Ativo" : "Inativo")
                      : isSlider
                        ? numVal.toFixed(2)
                        : raw}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: isText ? "flex-start" : "center", gap: 8, flexDirection: isText ? "column" : "row" }}>
              {isSlider ? (
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={numVal}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.key]: e.target.value }));
                    setDirty((d) => ({ ...d, [f.key]: true }));
                  }}
                  onMouseUp={(e) => {
                    const val = (e.target as HTMLInputElement).value;
                    void saveField(f.key, val);
                  }}
                  style={{ flex: 1, accentColor: f.color, cursor: "pointer", height: 4 }}
                />
              ) : isToggle ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = raw === "1" ? "0" : "1";
                    setValues((v) => ({ ...v, [f.key]: next }));
                    void saveField(f.key, next);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: `1px solid ${raw === "1" ? f.color + "60" : "var(--border)"}`,
                    background: raw === "1" ? f.color + "18" : "var(--bg-elevated)",
                    cursor: "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    width: 28, height: 14, borderRadius: 999,
                    background: raw === "1" ? f.color : "var(--border)",
                    position: "relative", transition: "background 0.2s", flexShrink: 0,
                  }}>
                    <span style={{
                      position: "absolute", top: 2, left: raw === "1" ? 16 : 2,
                      width: 10, height: 10, borderRadius: "50%",
                      background: "#fff", transition: "left 0.15s",
                    }} />
                  </span>
                  <span style={{
                    fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    color: raw === "1" ? f.color : "var(--text-muted)",
                    transition: "color 0.15s",
                  }}>
                    {raw === "1" ? "Ativo" : "Inativo"}
                  </span>
                </button>
              ) : isText ? (
                <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
                  {f.wide ? (
                    <textarea
                      value={raw}
                      rows={2}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [f.key]: e.target.value }));
                        setDirty((d) => ({ ...d, [f.key]: true }));
                      }}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "var(--bg-elevated)",
                        border: `1px solid ${isDirty ? f.color : "var(--border)"}`,
                        borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)", fontSize: 11,
                        padding: "6px 8px", outline: "none", resize: "vertical",
                        transition: "border-color 0.15s",
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={raw}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [f.key]: e.target.value }));
                        setDirty((d) => ({ ...d, [f.key]: true }));
                      }}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        background: "var(--bg-elevated)",
                        border: `1px solid ${isDirty ? f.color : "var(--border)"}`,
                        borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)", fontSize: 11,
                        padding: "5px 8px", outline: "none",
                        transition: "border-color 0.15s",
                      }}
                    />
                  )}
                  {isDirty && (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => saveField(f.key, values[f.key])}
                      style={{
                        alignSelf: "flex-end",
                        padding: "5px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: `1px solid ${f.color}50`,
                        background: `${f.color}14`,
                        color: f.color,
                        fontFamily: "var(--font-display)",
                        fontSize: 10, fontWeight: 700,
                        letterSpacing: "0.1em", textTransform: "uppercase",
                        cursor: isSaving ? "wait" : "pointer",
                      }}
                    >
                      {isSaving ? "A guardar…" : "Salvar"}
                    </button>
                  )}
                </div>
              ) : (
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={raw}
                  onChange={(e) => {
                    setValues((v) => ({ ...v, [f.key]: e.target.value }));
                    setDirty((d) => ({ ...d, [f.key]: true }));
                  }}
                  onBlur={(e) => {
                    if (dirty[f.key]) void saveField(f.key, e.target.value);
                  }}
                  style={{
                    flex: 1,
                    background: "var(--bg-elevated)",
                    border: `1px solid ${isDirty ? f.color : "var(--border)"}`,
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    padding: "5px 8px",
                    outline: "none",
                    transition: "border-color 0.15s",
                  }}
                />
              )}

              {isDirty && !isSlider && !isToggle && !isText && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => saveField(f.key, values[f.key])}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    padding: "5px 10px",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${f.color}40`,
                    background: `${f.color}12`,
                    color: f.color,
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    cursor: isSaving ? "wait" : "pointer",
                    flexShrink: 0,
                    minWidth: 92,
                  }}
                >
                  {ru?.kind === "stream_reload" && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: `${streamPct}%`,
                        background: "rgba(255,255,255,0.14)",
                        transition: "width 0.2s linear",
                      }}
                    />
                  )}
                  <span style={{ position: "relative", zIndex: 1 }}>
                    {isSaving
                      ? "A guardar…"
                      : ru?.kind === "stream_reload"
                        ? "A reabrir…"
                        : ru?.kind === "restart_required"
                          ? "Reinício"
                          : "Salvar"}
                  </span>
                </button>
              )}
            </div>

            {ru?.kind === "stream_reload" && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${streamPct}%`,
                      background: `linear-gradient(90deg, ${f.color}, rgba(255,255,255,0.35))`,
                      transition: "width 0.2s linear",
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    color: "var(--text-muted)",
                    fontFamily: "var(--font-sans)",
                    lineHeight: 1.35,
                  }}
                >
                  A reabrir o stream de inferência (estimativa até{" "}
                  {Math.max(0, Math.ceil(((ru.startedAt + ru.maxMs - Date.now()) / 1000) * 10) / 10)}s, ou até o FPS
                  voltar).
                </div>
              </div>
            )}

            {ru?.kind === "restart_required" && (
              <div style={{ marginTop: 8 }}>
                <RestartProgressButton
                  apiBase={apiBase}
                  onDone={() => setReloadUi((m) => ({ ...m, [f.key]: null }))}
                />
              </div>
            )}

            {/* Range labels */}
            {isSlider && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 3,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-muted)",
                  }}
                >
                  {f.min}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: "var(--text-muted)",
                  }}
                >
                  {f.max}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetectionSection({ apiBase, stats }: { apiBase: string; stats: LiveStats }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={DETECTION_FIELDS} />
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginTop: 2,
        }}
      >
        Overlay — pessoas / geral
      </div>
      <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={OVERLAY_PERSON_FIELDS} />
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginTop: 2,
        }}
      >
        Overlay — veículos
      </div>
      <LiveSettingsGroup apiBase={apiBase} stats={stats} fields={OVERLAY_VEHICLE_FIELDS} />
    </div>
  );
}

/* ── RestartProgressButton ────────────────────────────────────── */

type RestartState = "idle" | "restarting" | "done";

function RestartProgressButton({
  apiBase,
  onDone,
}: {
  apiBase: string;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<RestartState>("idle");
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const handleRestart = async () => {
    if (phase !== "idle") return;
    setPhase("restarting");
    setProgress(0);

    try {
      await fetch(`${apiBase}/api/restart`, { method: "POST" });
    } catch { /* backend may close socket before responding */ }

    const startedAt = Date.now();
    const ESTIMATED_MS = 28_000;

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min(92, (elapsed / ESTIMATED_MS) * 100);
      setProgress(pct);
    }, 200);

    await new Promise<void>((r) => setTimeout(r, 4000));

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${apiBase}/api/settings`, { cache: "no-store" });
        if (r.ok) {
          clear();
          setProgress(100);
          setPhase("done");
          setTimeout(() => { onDone?.(); }, 1800);
        }
      } catch { /* not ready yet */ }
    }, 900);
  };

  useEffect(() => () => clear(), []);

  const COLOR = "var(--red)";
  const BG_IDLE = "rgba(239,68,68,0.10)";
  const BG_ACTIVE = "rgba(239,68,68,0.06)";

  const label =
    phase === "done"
      ? "Servidor pronto ✓"
      : phase === "restarting"
        ? progress < 30
          ? "A reiniciar…"
          : "A aguardar servidor…"
        : "Reiniciar servidor";

  return (
    <button
      type="button"
      disabled={phase !== "idle"}
      onClick={handleRestart}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        padding: "8px 12px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid rgba(239,68,68,${phase === "idle" ? "0.30" : "0.18"})`,
        background: phase === "idle" ? BG_IDLE : BG_ACTIVE,
        cursor: phase === "idle" ? "pointer" : "default",
        transition: "background 0.15s, border-color 0.15s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
      }}
    >
      {/* progress fill */}
      {phase !== "idle" && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: `${progress}%`,
            background:
              phase === "done"
                ? "rgba(34,197,94,0.22)"
                : "rgba(239,68,68,0.18)",
            transition: phase === "done" ? "width 0.4s ease" : "width 0.2s linear",
            pointerEvents: "none",
          }}
        />
      )}

      {/* icon */}
      <span style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center" }}>
        {phase === "done" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : phase === "restarting" ? (
          <svg
            width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke={COLOR} strokeWidth="2.5" strokeLinecap="round"
            style={{ animation: "spin 1s linear infinite" }}
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={COLOR} strokeWidth="2.5" strokeLinecap="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        )}
      </span>

      <span
        style={{
          position: "relative",
          zIndex: 1,
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: phase === "done" ? "var(--green)" : COLOR,
          transition: "color 0.2s",
        }}
      >
        {label}
      </span>

      {phase !== "idle" && (
        <span
          style={{
            position: "relative",
            zIndex: 1,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: phase === "done" ? "var(--green)" : "rgba(239,68,68,0.7)",
            marginLeft: "auto",
          }}
        >
          {Math.round(progress)}%
        </span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </button>
  );
}

/* ── StatsSection ─────────────────────────────────────────────── */

function StatsSection({ stats }: { stats: LiveStats }) {
  const rows: { label: string; value: string; color?: string; pulse?: boolean }[] = [
    {
      label: "Análises por segundo",
      value: typeof stats.infer_fps_ema === "number"
        ? `${stats.infer_fps_ema.toFixed(1)} fps`
        : "—",
      color: (stats.infer_fps_ema ?? 0) > 0.5 ? "var(--cyan)" : "var(--text-muted)",
    },
    {
      label: "Em movimento agora",
      value: String(stats.moving_now ?? "—"),
      color: "var(--green)",
    },
    {
      label: "Parados agora",
      value: String(stats.stationary_now ?? "—"),
    },
    {
      label: "Permanência prolongada",
      value: String(stats.loitering_now ?? "—"),
      color: (stats.loitering_now ?? 0) > 0 ? "var(--amber)" : undefined,
    },
  ];

  if ((stats.low_conf_tracks ?? 0) > 0)
    rows.push({
      label: "Pessoas com detecção incerta",
      value: String(stats.low_conf_tracks),
    });

  if ((stats.suppressed_events ?? 0) > 0)
    rows.push({
      label: "Travessias ignoradas (baixa certeza)",
      value: String(stats.suppressed_events),
      color: "var(--amber)",
      pulse: true,
    });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 10px",
            background: "var(--bg-elevated)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            {row.label}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {row.pulse && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "var(--amber)",
                  animation: "pulse 2s infinite",
                  display: "inline-block",
                }}
              />
            )}
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 700,
                color: row.color ?? "var(--text-secondary)",
              }}
            >
              {row.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── PanelBtn ─────────────────────────────────────────────────── */

function PanelBtn({
  children,
  onClick,
  icon,
  accent = false,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  accent?: boolean;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "7px 10px",
        borderRadius: "var(--radius-sm)",
        border: `1px solid ${accent
          ? hov ? "var(--amber)" : "var(--border-accent)"
          : hov ? "var(--border-accent)" : "var(--border)"
        }`,
        background: accent
          ? hov ? "var(--amber-glow)" : "var(--amber-dim)"
          : hov ? "var(--bg-elevated)" : "var(--bg-surface)",
        color: accent
          ? "var(--amber)"
          : hov ? "var(--text-primary)" : "var(--text-secondary)",
        fontFamily: "var(--font-display)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "all 0.12s",
      }}
    >
      {icon}
      {children}
    </button>
  );
}
