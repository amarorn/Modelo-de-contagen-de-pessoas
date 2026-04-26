import { useState } from "react";
import { useStats } from "../hooks/useStats";
import { HourlyFlowChart } from "../components/HourlyFlowChart";
import { DemographicsChart } from "../components/DemographicsChart";
import { OccupancyGauge } from "../components/OccupancyGauge";
import { FlowInsightsCard } from "../components/FlowInsightsCard";
import { HeatmapCard } from "../components/HeatmapCard";
import { useFlowInsights } from "../hooks/useFlowInsights";

interface Props {
  apiBase: string;
}

export function ReportsDashboard({ apiBase }: Props) {
  const { stats, status } = useStats();
  const { data: flowInsights, error: flowInsightsErr } = useFlowInsights(
    apiBase,
    status === "connected",
  );
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`${apiBase}/api/export`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      window.alert(`Relatório exportado: ${data.csv_path}`);
    } catch (err) {
      window.alert(`Erro ao exportar: ${err}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        padding: "14px clamp(14px, 2.5vw, 28px) 24px",
        width: "100%",
        maxWidth: "min(1920px, 100%)",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        className="card"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Relatórios</p>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
            Sessão atual · status {status}
          </span>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || status !== "connected"}
          className="action-btn"
        >
          {exporting ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      <HourlyFlowChart
        hourlyEntries={stats.hourly_entries}
        hourlyExits={stats.hourly_exits}
        peakHour={stats.peak_hour}
      />

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
        <DemographicsChart stats={stats} />
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

      <FlowInsightsCard payload={flowInsights} fetchError={flowInsightsErr} />
      <HeatmapCard apiBase={apiBase} />
    </div>
  );
}
