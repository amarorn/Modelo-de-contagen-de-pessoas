import { useStats } from "./hooks/useStats";
import { Header } from "./components/Header";
import { StatCard } from "./components/StatCard";
import { LiveFeed } from "./components/LiveFeed";
import { HourlyFlowChart } from "./components/HourlyFlowChart";
import { DemographicsChart } from "./components/DemographicsChart";
import { OccupancyGauge } from "./components/OccupancyGauge";
import { FlowSummaryCard } from "./components/FlowSummaryCard";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function App() {
  const { stats, status } = useStats();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header status={status} apiBase={API_BASE} />

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
          <StatCard
            label="Entradas"
            value={stats.entries}
            icon="↑"
            color="var(--green)"
            colorDim="var(--green-dim)"
            subtitle="Total acumulado"
          />
          <StatCard
            label="Saídas"
            value={stats.exits}
            icon="↓"
            color="var(--red)"
            colorDim="var(--red-dim)"
            subtitle="Total acumulado"
          />
          <StatCard
            label="Ocupação"
            value={stats.occupancy_now}
            icon="👤"
            color="var(--cyan)"
            colorDim="var(--cyan-dim)"
            subtitle="Pessoas em cena"
          />
          <StatCard
            label="Total de Passagens"
            value={stats.total_passages}
            icon="⇅"
            color="var(--indigo)"
            colorDim="var(--indigo-dim)"
            subtitle={`Pico: ${stats.peak_flow} na hora ${String(stats.peak_hour).padStart(2, "0")}h`}
          />
        </div>

        {/* ── Main grid ───────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 320px",
            gridTemplateRows: "auto auto",
            gap: 16,
          }}
        >
          {/* Video feed — full left column, 2 rows */}
          <div style={{ gridColumn: "1", gridRow: "1 / 3" }}>
            <LiveFeed apiBase={API_BASE} />
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
            />
          </div>

          {/* Demographics — middle column, row 2 */}
          <div style={{ gridColumn: "2", gridRow: "2" }}>
            <DemographicsChart stats={stats} />
          </div>

          {/* Flow summary — right column, row 2 */}
          <div style={{ gridColumn: "3", gridRow: "2" }}>
            <FlowSummaryCard
              entries={stats.entries}
              exits={stats.exits}
              total={stats.total_passages}
              peakFlow={stats.peak_flow}
              peakHour={stats.peak_hour}
            />
          </div>
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
