import { useState } from "react";
import { useStats } from "./hooks/useStats";
import { useConfig } from "./hooks/useConfig";
import {
  IconArrowUp, IconArrowDown, IconUsers, IconArrowsUpDown,
  IconTarget, IconVideo, IconCar, IconQueue, IconPerson,
} from "./components/Icons";
import { Header } from "./components/Header";
import { StatCard } from "./components/StatCard";
import { LiveFeed } from "./components/LiveFeed";
import { HourlyFlowChart } from "./components/HourlyFlowChart";
import { DemographicsChart } from "./components/DemographicsChart";
import { OccupancyGauge } from "./components/OccupancyGauge";
import { FlowSummaryCard } from "./components/FlowSummaryCard";
import { RoiEditor } from "./components/RoiEditor";
import { SourceEditor } from "./components/SourceEditor";
import { DisplayOverlayToggles } from "./components/DisplayOverlayToggles";
import { SettingsDashboard } from "./components/SettingsDashboard";
import { AlertsLayer } from "./components/AlertToast";
import { HeatmapCard } from "./components/HeatmapCard";
import { ZonesPage } from "./pages/Zones";
import { VehiclesDashboard } from "./pages/VehiclesDashboard";
import { ProfileSelector } from "./components/ProfileSelector";
import { AuditLogPanel } from "./components/AuditLogPanel";
import { FlowInsightsCard } from "./components/FlowInsightsCard";
import { TrackingModeToggle } from "./components/TrackingModeToggle";
import { useFlowInsights } from "./hooks/useFlowInsights";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function App() {
  const { stats, status } = useStats();
  const { data: flowInsights, error: flowInsightsErr } = useFlowInsights(
    API_BASE,
    status === "connected",
  );
  const config = useConfig();
  const [roiOpen, setRoiOpen]       = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [view, setView]             = useState<"live" | "settings" | "zones" | "vehicles">("live");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        status={status}
        apiBase={API_BASE}
        confidence={stats.cam_confidence}
        confidenceReasons={stats.cam_confidence_reasons}
        camDriftLevel={stats.cam_drift_level ?? "ok"}
        camDriftScore={stats.cam_drift_score ?? 0}
        camDriftReason={stats.cam_drift_reason ?? ""}
        camDriftBaselineReady={stats.cam_drift_baseline_ready ?? false}
        onOpenSettings={view === "live" ? () => setView("settings") : undefined}
        onBackToLive={view === "settings" || view === "zones" || view === "vehicles" ? () => setView("live") : undefined}
      />

      {view === "zones" ? (
        <ZonesPage apiBase={API_BASE} onBack={() => setView("live")} />
      ) : view === "settings" ? (
        <SettingsDashboard apiBase={API_BASE} onBack={() => setView("live")} />
      ) : view === "vehicles" ? (
        <VehiclesDashboard apiBase={API_BASE} onBack={() => setView("live")} />
      ) : (
        <main
          style={{
            flex: 1,
            padding: "14px clamp(14px, 2.5vw, 28px) 24px",
            width: "100%",
            maxWidth: "min(1920px, 100%)",
            margin: "0 auto",
          }}
        >
          {/* ── Ops layout: Video left + KPI column right ─────────── */}
          <div className="ops-layout">

            {/* Left column: video + action bar */}
            <div className="ops-video-col">
              <LiveFeed apiBase={API_BASE} hero />

              {/* Action bar */}
              <div
                style={{
                  padding: "10px 16px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <TrackingModeToggle
                    apiBase={API_BASE}
                    vehicleTrackingAvailable={stats.vehicle_tracking_available ?? false}
                    yoloCountClassIds={stats.yolo_count_class_ids ?? []}
                    yoloClassLabels={stats.yolo_class_labels ?? {}}
                    trackActiveClassIds={stats.track_active_class_ids ?? []}
                  />
                  <ActionButton
                    icon={<IconTarget size={13} />}
                    label="Configurar ROI"
                    onClick={() => setRoiOpen(true)}
                  />
                  <ActionButton
                    icon={<IconVideo size={13} />}
                    label="Fonte de Vídeo"
                    onClick={() => setSourceOpen(true)}
                  />
                  <ActionButton
                    icon={<IconTarget size={13} />}
                    label="Zonas e hotspots"
                    onClick={() => setView("zones")}
                  />
                </div>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <DisplayOverlayToggles apiBase={API_BASE} />
                </div>
                <ProfileSelector
                  apiBase={API_BASE}
                  activeProfile={stats.active_env_profile}
                />
              </div>
            </div>

            {/* Right column: KPI counters */}
            <div className="ops-kpi-col">
              {/* Column header */}
              <div
                style={{
                  padding: "10px 20px 9px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Contadores
                </span>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--amber)",
                    animation: "pulse 2.5s infinite",
                    display: "inline-block",
                  }}
                />
              </div>

              {/* Counters */}
              <StatCard
                variant="counter"
                label="Entradas"
                value={stats.entries}
                icon={<IconArrowUp size={14} />}
                color="var(--green)"
                colorDim="var(--green-dim)"
                subtitle="sessão atual"
              />
              <StatCard
                variant="counter"
                label="Saídas"
                value={stats.exits}
                icon={<IconArrowDown size={14} />}
                color="var(--red)"
                colorDim="var(--red-dim)"
                subtitle="sessão atual"
              />
              <StatCard
                variant="counter"
                label="Presentes agora"
                value={stats.occupancy_now}
                icon={<IconUsers size={14} />}
                color="var(--cyan)"
                colorDim="var(--cyan-dim)"
                subtitle="snapshot · ~2s"
                tooltip="Contagem de IDs ativos no tracking no momento atual. Pode subcontar em casos de oclusão prolongada ou perda de ID. Para uma estimativa mais estável, use o Resumo de Fluxo (entradas − saídas)."
              />
              <StatCard
                variant="counter"
                label="Passagens"
                value={stats.total_passages}
                icon={<IconArrowsUpDown size={14} />}
                color="var(--amber)"
                colorDim="var(--amber-dim)"
                subtitle={`pico: ${stats.peak_flow} às ${String(stats.peak_hour).padStart(2, "0")}h`}
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => setView("vehicles")}
                onKeyDown={e => e.key === "Enter" && setView("vehicles")}
                style={{ cursor: "pointer" }}
                title="Abrir dashboard de veículos"
              >
                <StatCard
                  variant="counter"
                  label="Veículos"
                  value={stats.vehicle_total ?? 0}
                  icon={<IconCar size={14} />}
                  color="#F97316"
                  colorDim="rgba(249,115,22,0.12)"
                  subtitle={`↑${stats.vehicle_entries ?? 0} ↓${stats.vehicle_exits ?? 0} · clique para detalhes`}
                />
              </div>
              {stats.reid_unique_persons > 0 && (
                <StatCard
                  variant="counter"
                  label="Visitantes únicos"
                  value={stats.reid_unique_persons}
                  icon={<IconPerson size={14} />}
                  color="var(--cyan)"
                  colorDim="var(--cyan-dim)"
                  subtitle={
                    stats.reid_revisited > 0
                      ? `${stats.reid_revisited} revisita${stats.reid_revisited !== 1 ? "s" : ""} · ${stats.reid_avg_dwell_s.toFixed(0)}s médios`
                      : `${stats.reid_avg_dwell_s.toFixed(0)}s tempo médio`
                  }
                  tooltip="Estimativa de indivíduos distintos na sessão, via re-identificação espaço-temporal leve (sem biometria). Tracks que reaparecem a menos de 18% da largura do frame em até 20s são re-linkados ao mesmo visitante."
                />
              )}
              {stats.queue_size > 0 && (
                <StatCard
                  variant="counter"
                  label="Fila detectada"
                  value={stats.queue_size}
                  icon={<IconQueue size={14} />}
                  color={stats.queue_saturated ? "var(--red)" : "var(--amber)"}
                  colorDim={stats.queue_saturated ? "var(--red-dim)" : "var(--amber-dim)"}
                  subtitle={`espera média: ${stats.queue_avg_wait_s.toFixed(0)}s${stats.queue_saturated ? " · saturada" : ""}`}
                  tooltip="Fila detectada automaticamente: tracks lentos com alinhamento espacial (PCA). Saturada quando ≥ 8 pessoas."
                />
              )}

              {/* Spacer + fps readout */}
              <div
                style={{
                  flex: 1,
                  padding: "14px 20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  Inferência
                </div>
                <DataRow label="FPS (EMA)" value={stats.infer_fps_ema?.toFixed(1) ?? "—"} />
                <DataRow label="Em movimento" value={String(stats.moving_now)} />
                <DataRow label="Parados" value={String(stats.stationary_now)} />
                <DataRow label="Loitering" value={String(stats.loitering_now)} />
                {(stats.low_conf_tracks ?? 0) > 0 && (
                  <DataRow label="Tracks baixa conf." value={String(stats.low_conf_tracks)} />
                )}
                {(stats.suppressed_events ?? 0) > 0 && (
                  <DataRow
                    label="Cruzamentos suprimidos"
                    value={String(stats.suppressed_events)}
                    hint="Contagem bloqueada por confiança do track (6.1)"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Analytics row ───────────────────────────────────── */}
          <div className="analytics-grid">
            <div style={{ minWidth: 0 }}>
              <HourlyFlowChart
                hourlyEntries={stats.hourly_entries}
                hourlyExits={stats.hourly_exits}
                peakHour={stats.peak_hour}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <OccupancyGauge
                occupancy={stats.occupancy_now}
                moving={stats.moving_now}
                stationary={stats.stationary_now}
                loitering={stats.loitering_now}
                avgDwell={stats.avg_dwell_sec}
                maxDwell={stats.max_dwell_sec}
                avgMovePxPerSec={stats.avg_move_speed_px_per_sec}
                avgMovePxPerFrame={stats.avg_move_speed_px_per_frame}
              />
            </div>
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <FlowSummaryCard
                entries={stats.entries}
                exits={stats.exits}
                total={stats.total_passages}
                peakFlow={stats.peak_flow}
                peakHour={stats.peak_hour}
                vehicleEntries={stats.vehicle_entries ?? 0}
                vehicleExits={stats.vehicle_exits ?? 0}
                vehicleTotal={stats.vehicle_total ?? 0}
              />
            </div>
          </div>

          {/* ── Flow intelligence (7.x) ───────────────────────── */}
          <div style={{ marginTop: 14 }}>
            <FlowInsightsCard
              payload={flowInsightsErr ? null : flowInsights}
              loading={status === "connected" && !flowInsights && !flowInsightsErr}
              fetchError={flowInsightsErr}
            />
          </div>

          {/* ── Demographics ────────────────────────────────────── */}
          <div style={{ marginTop: 0 }}>
            <DemographicsChart stats={stats} />
          </div>

          {/* ── Heatmap analítico ───────────────────────────────── */}
          <div style={{ marginTop: 0 }}>
            <HeatmapCard apiBase={API_BASE} />
          </div>

          {/* ── Audit log (6.2) ─────────────────────────────────── */}
          <div style={{ marginTop: 14 }}>
            <AuditLogPanel apiBase={API_BASE} />
          </div>

          {/* ── Error banner ──────────────────────────────────── */}
          {stats.error && (
            <div
              style={{
                marginTop: 14,
                padding: "11px 16px",
                background: "var(--red-dim)",
                border: "1px solid rgba(224,78,78,0.25)",
                borderLeft: "2px solid var(--red)",
                borderRadius: "var(--radius-md)",
                color: "var(--red)",
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>{stats.error}</span>
            </div>
          )}
        </main>
      )}

      {/* ── Modals ──────────────────────────────────────────────── */}
      {view === "live" && sourceOpen && (
        <SourceEditor apiBase={API_BASE} onClose={() => setSourceOpen(false)} />
      )}
      {view === "live" && roiOpen && (
        <RoiEditor
          apiBase={API_BASE}
          config={config}
          onClose={() => setRoiOpen(false)}
          onApplied={() => setRoiOpen(false)}
        />
      )}

      <AlertsLayer />

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "10px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--bg-surface)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          VisionCount — Atualização a cada 2s
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          {new Date().toLocaleTimeString("pt-BR")}
        </span>
      </footer>
    </div>
  );
}

/* ── Helper components ────────────────────────────────────────── */

function ActionButton({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-display)",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        transition: "border-color 0.15s, color 0.15s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.borderColor = "var(--border-accent)";
        b.style.color = "var(--amber)";
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.borderColor = "var(--border)";
        b.style.color = "var(--text-secondary)";
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function DataRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      title={hint}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 11,
      }}
    >
      <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
        {value}
      </span>
    </div>
  );
}
