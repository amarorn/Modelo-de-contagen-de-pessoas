import { useState } from "react";
import { useStats } from "./hooks/useStats";
import { useConfig } from "./hooks/useConfig";
import {
  IconArrowUp, IconArrowDown, IconUsers, IconArrowsUpDown,
  IconTarget, IconSliders, IconVideo,
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

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function App() {
  const { stats, status } = useStats();
  const config = useConfig();
  const [roiOpen, setRoiOpen]       = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [view, setView]             = useState<"live" | "settings">("live");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        status={status}
        apiBase={API_BASE}
        onOpenSettings={view === "live" ? () => setView("settings") : undefined}
        onBackToLive={view === "settings" ? () => setView("live") : undefined}
      />

      {view === "settings" ? (
        <SettingsDashboard apiBase={API_BASE} onBack={() => setView("live")} />
      ) : (
      <main
        style={{
          flex: 1,
          padding: "20px 20px 32px",
          maxWidth: 1600,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {/* ── Top KPI row ─────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <StatCard label="Entradas"        value={stats.entries}       icon={<IconArrowUp size={18}/>}       color="var(--green)"  colorDim="var(--green-dim)"  subtitle="Total acumulado" />
          <StatCard label="Saídas"          value={stats.exits}         icon={<IconArrowDown size={18}/>}     color="var(--red)"    colorDim="var(--red-dim)"    subtitle="Total acumulado" />
          <StatCard label="Ocupação"        value={stats.occupancy_now} icon={<IconUsers size={18}/>}         color="var(--cyan)"   colorDim="var(--cyan-dim)"   subtitle="Pessoas em cena" />
          <StatCard label="Total Passagens" value={stats.total_passages} icon={<IconArrowsUpDown size={18}/>} color="var(--indigo)" colorDim="var(--indigo-dim)" subtitle={`Pico: ${stats.peak_flow} às ${String(stats.peak_hour).padStart(2,"0")}h`} />
        </div>

        {/* ── Main grid ───────────────────────────────────────── */}
        {/*
          Layout:
          Col 1 (55%)   | Col 2 (25%)    | Col 3 (20%)
          ─────────────────────────────────────────────
          Video (r1-r2) | HourlyChart    | OccupancyGauge
          Video (r1-r2) | FlowSummary   | FlowSummary
          ─────────────────────────────────────────────
          Demographics (span 3 cols)
        */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "55fr 27fr 18fr",
            gridTemplateRows: "auto auto",
            gap: 16,
          }}
        >
          {/* Video feed — large left column, spans both rows */}
          <div style={{ gridColumn: "1", gridRow: "1 / 3", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <LiveFeed apiBase={API_BASE} />
            {/* Action buttons below feed */}
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ActionButton icon={<IconTarget size={14}/>} label="Configurar ROI" onClick={() => setRoiOpen(true)} />
              <ActionButton icon={<IconVideo size={14}/>}  label="Fonte de Vídeo"  onClick={() => setSourceOpen(true)} />
            </div>
            <div style={{ marginTop: 10 }}>
              <DisplayOverlayToggles apiBase={API_BASE} />
            </div>
          </div>

          {/* Hourly chart — middle column, row 1 */}
          <div style={{ gridColumn: "2", gridRow: "1" }}>
            <HourlyFlowChart
              hourlyEntries={stats.hourly_entries}
              hourlyExits={stats.hourly_exits}
              peakHour={stats.peak_hour}
            />
          </div>

          {/* Occupancy gauge — right column, row 1 */}
          <div style={{ gridColumn: "3", gridRow: "1" }}>
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

          {/* Flow summary — middle+right columns, row 2 */}
          <div style={{ gridColumn: "2 / 4", gridRow: "2" }}>
            <FlowSummaryCard
              entries={stats.entries}
              exits={stats.exits}
              total={stats.total_passages}
              peakFlow={stats.peak_flow}
              peakHour={stats.peak_hour}
            />
          </div>
        </div>

        {/* ── Demographics — full width below ─────────────────── */}
        <div style={{ marginTop: 16 }}>
          <DemographicsChart stats={stats} />
        </div>

        {/* ── Error banner ────────────────────────────────────── */}
        {stats.error && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              background: "var(--red-dim)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "var(--radius-md)",
              color: "var(--red)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>⚠️</span>
            <span>{stats.error}</span>
          </div>
        )}
      </main>
      )}

      {/* Source Editor Modal */}
      {view === "live" && sourceOpen && (
        <SourceEditor apiBase={API_BASE} onClose={() => setSourceOpen(false)} />
      )}

      {/* ROI Editor Modal */}
      {view === "live" && roiOpen && (
        <RoiEditor
          apiBase={API_BASE}
          config={config}
          onClose={() => setRoiOpen(false)}
          onApplied={() => {
            setRoiOpen(false);
          }}
        />
      )}

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--bg-surface)",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        <span>VisionCount Dashboard — atualização a cada 2s</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {new Date().toLocaleTimeString("pt-BR")}
        </span>
      </footer>
    </div>
  );
}

function ActionButton({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "9px 0",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        color: "var(--text-secondary)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        transition: "border-color 0.15s, color 0.15s",
      }}
      onMouseEnter={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.borderColor = "var(--border-glow)";
        b.style.color = "var(--cyan)";
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.style.borderColor = "var(--border)";
        b.style.color = "var(--text-secondary)";
      }}
    >
      {icon} {label}
    </button>
  );
}
