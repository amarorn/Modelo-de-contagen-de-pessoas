import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import type { ReactNode } from "react";
import {
  IconPersonWalk,
  IconPersonStand,
  IconClock,
  IconAlertTriangle,
} from "./Icons";

interface Props {
  occupancy: number;
  moving: number;
  stationary: number;
  loitering: number;
  avgDwell: number;
  maxDwell: number;
  avgMovePxPerSec: number;
  avgMovePxPerFrame: number;
}

export function OccupancyGauge({
  occupancy,
  moving,
  stationary,
  loitering,
  avgDwell,
  maxDwell,
  avgMovePxPerSec,
  avgMovePxPerFrame,
}: Props) {
  const maxDisplay = Math.max(occupancy + 5, 20);
  const pct   = Math.min((occupancy / maxDisplay) * 100, 100);
  const color = pct > 80 ? "#EF4444" : pct > 50 ? "#F59E0B" : "#10B981";

  const options: ApexOptions = {
    chart: { type: "radialBar", background: "transparent", animations: { enabled: true, speed: 600 } },
    theme: { mode: "dark" },
    colors: [color],
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        hollow: { margin: 0, size: "60%", background: "var(--bg-elevated)" },
        track: { background: "rgba(255,255,255,0.06)", strokeWidth: "100%" },
        dataLabels: {
          name: { show: true, fontSize: "12px", color: "#9CA3AF", offsetY: -8 },
          value: {
            show: true,
            fontSize: "32px",
            fontWeight: 600,
            fontFamily: "IBM Plex Mono",
            color,
            offsetY: 8,
            formatter: () => String(occupancy),
          },
        },
      },
    },
    stroke: { lineCap: "round" },
    labels: ["Em Cena"],
  };

  const fmt = (s: number) =>
    s >= 60
      ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`
      : `${s.toFixed(0)}s`;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="section-label">Ocupação em Tempo Real</p>
      <ReactApexChart options={options} series={[Math.round(pct)]} type="radialBar" height={220} />
      <hr className="divider" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <MetricRow icon={<IconPersonWalk size={15} />} label="Em movimento" value={moving}      color="var(--cyan)"  />
        <MetricRow icon={<IconPersonStand size={15}/>} label="Parado"       value={stationary}  color="var(--indigo)"/>
        <MetricRow icon={<IconClock size={15} />}      label="Permanência"  value={fmt(avgDwell)} color="var(--amber)" />
        <MetricRow icon={<IconAlertTriangle size={15}/>} label="Loitering"  value={loitering}   color="var(--red)"   />
      </div>
      {maxDwell > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 4 }}>
          Máx. permanência:{" "}
          <span style={{ color: "var(--amber)", fontFamily: "var(--font-mono)" }}>{fmt(maxDwell)}</span>
        </div>
      )}
      {(avgMovePxPerSec > 0 || avgMovePxPerFrame > 0) && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            textAlign: "center",
            marginTop: 8,
            lineHeight: 1.45,
          }}
        >
          Vel. média (em movimento):{" "}
          <span style={{ color: "var(--cyan)", fontFamily: "var(--font-mono)" }}>
            {avgMovePxPerSec >= 0.1 ? avgMovePxPerSec.toFixed(1) : avgMovePxPerSec.toFixed(2)} px/s
          </span>
          <span style={{ opacity: 0.85 }}> · </span>
          <span style={{ fontFamily: "var(--font-mono)", color: "#9CA3AF" }}>
            {avgMovePxPerFrame.toFixed(2)} px/frame
          </span>
        </div>
      )}
    </div>
  );
}

function MetricRow({ icon, label, value, color }: { icon: ReactNode; label: string; value: number | string; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
      background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)" }}>
      <span style={{ color }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{value}</div>
      </div>
    </div>
  );
}
