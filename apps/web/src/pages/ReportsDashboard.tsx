import { useState } from "react";
import { useConfig } from "../hooks/useConfig";
import { HourlyFlowChart } from "../components/HourlyFlowChart";
import { DemographicsChart } from "../components/DemographicsChart";
import { OccupancyGauge } from "../components/OccupancyGauge";
import { FlowInsightsCard } from "../components/FlowInsightsCard";
import { HeatmapCard } from "../components/HeatmapCard";
import { useFlowInsights } from "../hooks/useFlowInsights";
import { useReportsHourly } from "../hooks/useReportsHourly";
import { useReportsSessionStats } from "../hooks/useReportsSessionStats";

interface Props {
  apiBase: string;
}

export function ReportsDashboard({ apiBase }: Props) {
  const config = useConfig(apiBase);
  const cameraId = config?.active_preset_id?.trim() || "default";
  const hourly = useReportsHourly(apiBase, cameraId);
  const { stats, status } = useReportsSessionStats(apiBase);
  const { data: flowInsights, error: flowInsightsErr } = useFlowInsights(
    apiBase,
    status === "connected",
    45_000,
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
            BD + sessão (polling lento) · {cameraId} · status {status}
            {hourly.status === "error" ? " · fluxo horário: erro" : ""}
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
        hourlyEntries={hourly.hourlyEntries}
        hourlyExits={hourly.hourlyExits}
        peakHour={hourly.peakHour}
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
