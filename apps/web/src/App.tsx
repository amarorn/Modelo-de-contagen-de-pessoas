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
          padding: "16px clamp(16px, 3vw, 32px) 28px",
          width: "100%",
          maxWidth: "min(1920px, 100%)",
          margin: "0 auto",
        }}
      >
        {/* ── Hero: vídeo em largura total ───────────────────── */}
        <section
          style={{
            marginBottom: 20,
            borderRadius: "var(--radius-lg)",
            overflow: "hidden",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-card), 0 0 0 1px rgba(0,212,255,0.04)",
            background: "var(--bg-surface)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <LiveFeed apiBase={API_BASE} hero />
            <div
              style={{
                padding: "12px clamp(12px, 2vw, 20px)",
                borderTop: "1px solid var(--border)",
                background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 160px))",
                  gap: 8,
                }}
              >
                <ActionButton icon={<IconTarget size={14} />} label="Configurar ROI" onClick={() => setRoiOpen(true)} />
                <ActionButton icon={<IconVideo size={14} />} label="Fonte de Vídeo" onClick={() => setSourceOpen(true)} />
              </div>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <DisplayOverlayToggles apiBase={API_BASE} />
              </div>
            </div>
          </div>
        </section>

        {/* ── KPIs (faixa compacta sob o vídeo) ──────────────── */}
        <div
          className="kpi-strip"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "clamp(10px, 1.5vw, 16px)",
            marginBottom: 20,
          }}
        >
          <StatCard label="Entradas" value={stats.entries} icon={<IconArrowUp size={18} />} color="var(--green)" colorDim="var(--green-dim)" subtitle="Total acumulado" />
          <StatCard label="Saídas" value={stats.exits} icon={<IconArrowDown size={18} />} color="var(--red)" colorDim="var(--red-dim)" subtitle="Total acumulado" />
          <StatCard label="Ocupação" value={stats.occupancy_now} icon={<IconUsers size={18} />} color="var(--cyan)" colorDim="var(--cyan-dim)" subtitle="Pessoas em cena" />
          <StatCard label="Total Passagens" value={stats.total_passages} icon={<IconArrowsUpDown size={18} />} color="var(--indigo)" colorDim="var(--indigo-dim)" subtitle={`Pico: ${stats.peak_flow} às ${String(stats.peak_hour).padStart(2, "0")}h`} />
        </div>

        {/* ── Gráficos e resumo (3 colunas fluidas) ──────────── */}
        <div className="analytics-grid">
          <div style={{ minWidth: 0 }}>
            <HourlyFlowChart hourlyEntries={stats.hourly_entries} hourlyExits={stats.hourly_exits} peakHour={stats.peak_hour} />
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
            />
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
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
