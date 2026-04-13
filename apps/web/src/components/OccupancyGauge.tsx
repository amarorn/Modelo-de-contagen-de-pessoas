import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

interface Props {
  occupancy: number;
  moving: number;
  stationary: number;
  loitering: number;
  avgDwell: number;
  maxDwell: number;
}

export function OccupancyGauge({
  occupancy,
  moving,
  stationary,
  loitering,
  avgDwell,
  maxDwell,
}: Props) {
  const maxDisplay = Math.max(occupancy + 5, 20);
  const pct = Math.min((occupancy / maxDisplay) * 100, 100);

  const color =
    pct > 80 ? "#EF4444" : pct > 50 ? "#F59E0B" : "#10B981";

  const options: ApexOptions = {
    chart: {
      type: "radialBar",
      background: "transparent",
      animations: { enabled: true, easing: "easeinout", speed: 600 },
    },
    theme: { mode: "dark" },
    colors: [color],
    plotOptions: {
      radialBar: {
        startAngle: -135,
        endAngle: 135,
        hollow: {
          margin: 0,
          size: "60%",
          background: "var(--bg-elevated)",
        },
        track: {
          background: "rgba(255,255,255,0.06)",
          strokeWidth: "100%",
        },
        dataLabels: {
          name: {
            show: true,
            fontSize: "12px",
            color: "#9CA3AF",
            offsetY: -8,
          },
          value: {
            show: true,
            fontSize: "32px",
            fontWeight: 800,
            fontFamily: "JetBrains Mono",
            color: color,
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
    s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2,"0")}s` : `${s.toFixed(0)}s`;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="section-label">Ocupação em Tempo Real</p>

      <ReactApexChart
        options={options}
        series={[Math.round(pct)]}
        type="radialBar"
        height={220}
      />

      <hr className="divider" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <MetricRow
          icon="🏃"
          label="Em movimento"
          value={moving}
          color="var(--cyan)"
        />
        <MetricRow
          icon="🧍"
          label="Parado"
          value={stationary}
          color="var(--indigo)"
        />
        <MetricRow
          icon="⏱️"
          label="Permanência média"
          value={fmt(avgDwell)}
          color="var(--amber)"
        />
        <MetricRow
          icon="🔴"
          label="Loitering"
          value={loitering}
          color="var(--red)"
        />
      </div>

      {maxDwell > 0 && (
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            textAlign: "center",
            marginTop: 4,
          }}
        >
          Máx. permanência: <span style={{ color: "var(--amber)", fontFamily: "var(--font-mono)" }}>{fmt(maxDwell)}</span>
        </div>
      )}
    </div>
  );
}

function MetricRow({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        background: "var(--bg-elevated)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            color,
            fontFamily: "var(--font-mono)",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
