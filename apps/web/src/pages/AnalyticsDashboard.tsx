import { useEffect, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { useStats } from "../hooks/useStats";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/* ── types ─────────────────────────────────────────────────── */
interface FlowPoint {
  minute_bucket: string;
  roi_id: string;
  entries: number;
  exits: number;
  occupancy: number;
  avg_speed: number | null;
  unique_tracks: number;
}
interface Trajectory {
  track_id: string;
  camera_id: string;
  class: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  path: { timestamp: string; x: number; y: number }[];
  zones_crossed: string[];
  entry_count: number;
  exit_count: number;
  status: string;
}
interface AnalyticsMetrics {
  vision_events_ingested_total: number;
  vision_events_ingestion_errors_total: number;
  vision_aggregated_rows_updated_total: number;
  vision_closed_trajectories_total: number;
  vision_aggregator_lag_seconds: number;
  vision_event_processing_duration_ms: number;
  vision_active_trajectories: number;
  vision_queue_size: number;
}

/* ── time-range helpers ─────────────────────────────────────── */
type Preset = "1h" | "4h" | "24h";
function rangeFor(preset: Preset): { from: Date; to: Date } {
  const to = new Date();
  const h = preset === "1h" ? 1 : preset === "4h" ? 4 : 24;
  return { from: new Date(to.getTime() - h * 3_600_000), to };
}
function toISO(d: Date) { return d.toISOString(); }
function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDuration(secs: number | null) {
  if (secs === null) return "—";
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/* ── hooks ──────────────────────────────────────────────────── */
interface SourcePreset { id: string; label: string; url: string }

function useSourcePresets() {
  const [presets, setPresets] = useState<SourcePreset[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  useEffect(() => {
    fetch(`${API_BASE}/api/source`)
      .then(r => r.json())
      .then(d => {
        setPresets(Array.isArray(d.presets) ? d.presets : []);
        setActiveId(d.active_preset_id ?? "");
      })
      .catch(() => {});
  }, []);
  return { presets, activeId };
}

function useAnalyticsFlow(cameraId: string, from: Date, to: Date, tick: number) {
  const [series, setSeries] = useState<FlowPoint[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!cameraId) return;
    setLoading(true);
    fetch(
      `${API_BASE}/api/analytics/flow?camera_id=${encodeURIComponent(cameraId)}&from=${toISO(from)}&to=${toISO(to)}`,
    )
      .then(r => r.json())
      .then(d => setSeries(Array.isArray(d.series) ? d.series : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cameraId, from.getTime(), to.getTime(), tick]); // eslint-disable-line
  return { series, loading };
}

function useActiveTrajectories(cameraId: string, tick: number) {
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  useEffect(() => {
    if (!cameraId) return;
    fetch(`${API_BASE}/api/trajectories/active?camera_id=${encodeURIComponent(cameraId)}`)
      .then(r => r.json())
      .then(d => setTrajectories(Array.isArray(d.trajectories) ? d.trajectories : []))
      .catch(() => {});
  }, [cameraId, tick]);
  return trajectories;
}

function useAnalyticsMetrics(tick: number) {
  const [m, setM] = useState<Partial<AnalyticsMetrics>>({});
  useEffect(() => {
    fetch(`${API_BASE}/api/analytics/metrics`)
      .then(r => r.json())
      .then(d => setM(d))
      .catch(() => {});
  }, [tick]);
  return m;
}

/* ── sub-components ─────────────────────────────────────────── */
function KpiChip({
  label, value, color, unit,
}: { label: string; value: string | number; color: string; unit?: string }) {
  return (
    <div style={{
      flex: "1 1 140px",
      background: "var(--bg-elevated)",
      border: `1px solid ${color}28`,
      borderRadius: 8,
      padding: "12px 16px",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse at 80% 50%, ${color}0D, transparent 65%)`, pointerEvents: "none" }} />
      <div style={{ fontSize: 8, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontFamily: "var(--font-mono)", fontWeight: 700, color, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

function TrajectoryCard({ t }: { t: Trajectory }) {
  const classColors: Record<string, string> = {
    car: "#F97316", person: "#3DAAC8", motorcycle: "#A855F7",
    truck: "#F59E0B", bus: "#10B981", bicycle: "#EC4899",
    unknown: "var(--text-muted)",
  };
  const color = classColors[t.class] ?? classColors.unknown;
  const elapsed = t.duration_seconds ?? Math.round((Date.now() - new Date(t.started_at).getTime()) / 1000);

  return (
    <div style={{
      background: "var(--bg-elevated)",
      border: `1px solid ${color}22`,
      borderLeft: `3px solid ${color}`,
      borderRadius: "0 8px 8px 0",
      padding: "10px 14px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      minWidth: 0,
    }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 9, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color }}>
          {t.class}
        </span>
        <span style={{
          fontSize: 8, fontFamily: "var(--font-mono)", color: "var(--text-muted)",
          background: "rgba(255,255,255,0.04)", borderRadius: 3, padding: "1px 5px",
        }}>
          {t.status === "active"
            ? <><span style={{ color: "#2EB87A" }}>● </span>ativo</>
            : "fechado"}
        </span>
      </div>

      {/* track id */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        #{t.track_id}
      </div>

      {/* stats row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { label: "⏱", val: fmtDuration(elapsed) },
          { label: "↑", val: `${t.entry_count} ent`, color: "#2EB87A" },
          { label: "↓", val: `${t.exit_count} saí`, color: "#E04E4E" },
          { label: "pts", val: t.path.length },
        ].map(({ label, val, color: c }) => (
          <span key={label} style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: c ?? "var(--text-muted)" }}>
            {label} {val}
          </span>
        ))}
      </div>

      {/* zones */}
      {t.zones_crossed.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {t.zones_crossed.map(z => (
            <span key={z} style={{
              fontSize: 8, fontFamily: "var(--font-mono)", color,
              background: `${color}14`, border: `1px solid ${color}30`,
              borderRadius: 3, padding: "1px 5px",
            }}>{z}</span>
          ))}
        </div>
      )}

      {/* started at */}
      <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        início {new Date(t.started_at).toLocaleTimeString("pt-BR")}
      </div>
    </div>
  );
}

/* ── main page ──────────────────────────────────────────────── */
interface Props { onBack: () => void }

export function AnalyticsDashboard({ onBack }: Props) {
  const { stats } = useStats();
  const { presets, activeId } = useSourcePresets();
  const [cameraId, setCameraId] = useState<string>("");
  const [preset, setPreset] = useState<Preset>("1h");
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // seed camera_id: prefer presets activeId, fallback to stats
  useEffect(() => {
    if (!cameraId && activeId) setCameraId(activeId);
  }, [activeId]); // eslint-disable-line
  useEffect(() => {
    if (!cameraId && stats.active_preset_id) setCameraId(stats.active_preset_id);
  }, [stats.active_preset_id]); // eslint-disable-line

  // auto-refresh every 30s
  useEffect(() => {
    intervalRef.current = setInterval(() => setTick(t => t + 1), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const { from, to } = rangeFor(preset);
  const { series, loading } = useAnalyticsFlow(cameraId, from, to, tick);
  const trajectories = useActiveTrajectories(cameraId, tick);
  const sysMetrics = useAnalyticsMetrics(tick);

  /* ── chart config ─────────────────────────────────────────── */
  const chartSeries = [
    { name: "Entradas",  data: series.map(p => ({ x: new Date(p.minute_bucket).getTime(), y: p.entries })) },
    { name: "Saídas",    data: series.map(p => ({ x: new Date(p.minute_bucket).getTime(), y: p.exits })) },
    { name: "Ocupação",  data: series.map(p => ({ x: new Date(p.minute_bucket).getTime(), y: p.occupancy })) },
  ];
  const chartOptions: ApexCharts.ApexOptions = {
    chart: {
      type: "area",
      background: "transparent",
      toolbar: { show: false },
      animations: { enabled: false },
      zoom: { enabled: true },
    },
    colors: ["#00D4AA", "#FF3B5C", "#FF9500"],
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.02,
        stops: [0, 100],
      },
    },
    stroke: { curve: "smooth", width: 2 },
    xaxis: {
      type: "datetime",
      labels: {
        style: { colors: "var(--text-muted)", fontFamily: "JetBrains Mono", fontSize: "10px" },
        datetimeFormatter: { minute: "HH:mm", hour: "HH:mm" },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: "var(--text-muted)", fontFamily: "JetBrains Mono", fontSize: "10px" },
      },
      min: 0,
    },
    grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4 },
    legend: {
      labels: { colors: "var(--text-secondary)" },
      fontFamily: "JetBrains Mono",
      fontSize: "11px",
    },
    tooltip: {
      theme: "dark",
      x: { format: "HH:mm dd/MM" },
    },
    dataLabels: { enabled: false },
    noData: {
      text: "Sem dados para este período.",
      style: { color: "var(--text-muted)", fontFamily: "JetBrains Mono", fontSize: "13px" },
    },
  };

  const totalIngested = sysMetrics.vision_events_ingested_total ?? 0;
  const lag = sysMetrics.vision_aggregator_lag_seconds ?? 0;
  const errors = sysMetrics.vision_events_ingestion_errors_total ?? 0;
  const queueSz = sysMetrics.vision_queue_size ?? 0;
  const activeTrajCount = trajectories.length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "auto" }}>
      <div style={{
        flex: 1,
        padding: "16px clamp(14px, 2.5vw, 28px) 32px",
        width: "100%", maxWidth: "min(1920px, 100%)", margin: "0 auto",
        display: "flex", flexDirection: "column", gap: 18,
      }}>

        {/* ── Header row ───────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            onClick={onBack}
            style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >← Voltar</button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 6, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", display: "grid", placeItems: "center" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-primary)" }}>Analytics</div>
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>histórico · trajetórias · métricas</div>
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* camera selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              {presets.length > 0 ? (
                <select
                  value={cameraId}
                  onChange={e => setCameraId(e.target.value)}
                  style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: 5, color: "var(--text-primary)", fontFamily: "var(--font-mono)",
                    fontSize: 11, padding: "4px 10px", outline: "none", cursor: "pointer",
                    appearance: "none", WebkitAppearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2372728A'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
                    paddingRight: 26, minWidth: 160,
                  }}
                >
                  {presets.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label || p.id}{p.id === activeId ? " ●" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={cameraId}
                  onChange={e => setCameraId(e.target.value.trim())}
                  placeholder="camera_id"
                  style={{
                    background: "var(--bg-elevated)", border: "1px solid var(--border)",
                    borderRadius: 5, color: "var(--text-primary)", fontFamily: "var(--font-mono)",
                    fontSize: 11, padding: "4px 10px", width: 160, outline: "none",
                  }}
                />
              )}
            </div>

            {/* time range presets */}
            <div style={{ display: "flex", gap: 2 }}>
              {(["1h", "4h", "24h"] as Preset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  style={{
                    background: preset === p ? "rgba(129,140,248,0.15)" : "transparent",
                    border: `1px solid ${preset === p ? "rgba(129,140,248,0.5)" : "var(--border)"}`,
                    borderRadius: 5, color: preset === p ? "#818CF8" : "var(--text-muted)",
                    cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11,
                    padding: "4px 10px", transition: "all 0.15s",
                  }}
                >{p}</button>
              ))}
            </div>

            {/* refresh */}
            <button
              onClick={() => setTick(t => t + 1)}
              title="Atualizar agora"
              style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", padding: "4px 8px", display: "flex", alignItems: "center" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── KPI strip ─────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <KpiChip label="Eventos ingeridos" value={totalIngested.toLocaleString("pt-BR")} color="#818CF8" />
          <KpiChip label="Trajetórias ativas" value={activeTrajCount} color="#FF9500" />
          <KpiChip label="Lag agregador" value={lag.toFixed(2)} color={lag > 5 ? "#FF3B5C" : "#00D4AA"} unit="s" />
          <KpiChip label="Erros de ingest" value={errors} color={errors > 0 ? "#FF3B5C" : "var(--text-muted)"} />
          <KpiChip label="Fila worker" value={queueSz} color={queueSz > 500 ? "#FF9500" : "var(--text-muted)"} />
        </div>

        {/* ── Flow chart ────────────────────────────────────────── */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <p className="section-label" style={{ marginBottom: 2 }}>Fluxo por Minuto</p>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                {fmt(from.toISOString())} → {fmt(to.toISOString())} · {series.length} buckets
                {loading && " · carregando…"}
              </span>
            </div>
            {totalIngested === 0 && !loading && (
              <div style={{
                fontSize: 10, fontFamily: "var(--font-mono)", color: "#FF9500",
                background: "rgba(255,149,0,0.08)", border: "1px solid rgba(255,149,0,0.25)",
                borderRadius: 5, padding: "4px 10px",
              }}>
                ⚠ Nenhum evento ingerido ainda — use <code>POST /api/events</code>
              </div>
            )}
          </div>

          <ReactApexChart
            type="area"
            height={260}
            series={chartSeries}
            options={chartOptions}
          />
        </div>

        {/* ── Trajectories ──────────────────────────────────────── */}
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Trajetórias Ativas</p>
            <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {activeTrajCount} ativas · atualiza a cada 30s
            </span>
          </div>

          {activeTrajCount === 0 ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              Nenhuma trajetória ativa para <strong style={{ color: "var(--text-secondary)" }}>{cameraId || "—"}</strong>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {trajectories.map(t => <TrajectoryCard key={`${t.track_id}-${t.camera_id}`} t={t} />)}
            </div>
          )}
        </div>

        {/* ── System metrics ────────────────────────────────────── */}
        <div className="card" style={{ padding: "14px 20px" }}>
          <p className="section-label" style={{ marginBottom: 12 }}>Métricas do Sistema</p>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            {[
              { key: "vision_events_ingested_total",         label: "ingeridos" },
              { key: "vision_events_ingestion_errors_total", label: "erros" },
              { key: "vision_aggregated_rows_updated_total", label: "agg atualizadas" },
              { key: "vision_closed_trajectories_total",     label: "trajetórias fechadas" },
              { key: "vision_event_processing_duration_ms",  label: "proc. ms" },
              { key: "vision_queue_size",                    label: "fila" },
            ].map(({ key, label }) => {
              const raw = (sysMetrics as Record<string, number>)[key] ?? 0;
              const display = typeof raw === "number" && !Number.isInteger(raw) ? raw.toFixed(1) : String(raw);
              return (
                <div key={key}>
                  <div style={{ fontSize: 8, fontFamily: "var(--font-display)", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 3 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 18, fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text-primary)" }}>
                    {display}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
