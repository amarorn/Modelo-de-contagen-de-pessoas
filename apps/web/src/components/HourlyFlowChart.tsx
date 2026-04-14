import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";

interface Props {
  hourlyEntries: number[];
  hourlyExits: number[];
  peakHour: number;
}

const HOURS = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}h`
);

export function HourlyFlowChart({ hourlyEntries, hourlyExits, peakHour }: Props) {
  const options: ApexOptions = {
    chart: {
      type: "bar",
      background: "transparent",
      toolbar: { show: false },
      animations: { enabled: true, speed: 400 },
    },
    theme: { mode: "dark" },
    colors: ["#2EB87A", "#E04E4E"],
    plotOptions: {
      bar: {
        columnWidth: "60%",
        borderRadius: 4,
        borderRadiusApplication: "end",
      },
    },
    dataLabels: { enabled: false },
    stroke: { show: false },
    grid: {
      borderColor: "rgba(255,255,255,0.06)",
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
    },
    xaxis: {
      categories: HOURS,
      labels: {
        style: { colors: "#484858", fontSize: "10px", fontFamily: "IBM Plex Mono, monospace" },
        rotate: 0,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        style: { colors: "#484858", fontSize: "10px", fontFamily: "IBM Plex Mono, monospace" },
        formatter: (v) => String(Math.round(v)),
      },
    },
    legend: {
      labels: { colors: "#888898" },
      fontFamily: "Barlow Condensed, system-ui, sans-serif",
      markers: { shape: "circle" },
    },
    tooltip: {
      theme: "dark",
    },
    annotations: {
      xaxis:
        peakHour !== undefined
          ? [
              {
                x: HOURS[peakHour],
                borderColor: "#F59E0B",
                borderWidth: 2,
                strokeDashArray: 0,
                label: {
                  text: "Pico",
                  style: {
                    color: "#F59E0B",
                    background: "rgba(245,158,11,0.15)",
                    fontSize: "11px",
                  },
                },
              },
            ]
          : [],
    },
    series: [
      { name: "Entradas", data: hourlyEntries },
      { name: "Saídas", data: hourlyExits },
    ],
  };

  return (
    <div className="card" style={{ height: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div>
          <p className="section-label">Fluxo por Hora</p>
          <p style={{ fontSize: 15, fontWeight: 600 }}>
            Entradas e Saídas nas Últimas 24h
          </p>
        </div>
        <span className="badge badge-amber" style={{ alignSelf: "center" }}>
          Pico: {HOURS[peakHour]}
        </span>
      </div>
      <ReactApexChart
        options={options}
        series={options.series}
        type="bar"
        height={220}
      />
    </div>
  );
}
