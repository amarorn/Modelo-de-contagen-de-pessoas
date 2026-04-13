import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import type { Stats } from "../types/api";

interface Props {
  stats: Stats;
}

function DonutCard({
  title,
  labels,
  series,
  colors,
  enabled,
}: {
  title: string;
  labels: string[];
  series: number[];
  colors: string[];
  enabled: boolean;
}) {
  const total = series.reduce((a, b) => a + b, 0);

  const options: ApexOptions = {
    chart: {
      type: "donut",
      background: "transparent",
      animations: { enabled: true, easing: "easeinout", speed: 400 },
    },
    theme: { mode: "dark" },
    colors,
    labels,
    dataLabels: {
      enabled: true,
      formatter: (val: number) => `${val.toFixed(0)}%`,
      style: { fontSize: "11px", fontWeight: 600 },
      dropShadow: { enabled: false },
    },
    plotOptions: {
      pie: {
        donut: {
          size: "68%",
          labels: {
            show: true,
            total: {
              show: true,
              label: "Total",
              color: "#9CA3AF",
              fontSize: "12px",
              fontWeight: 500,
              formatter: () => String(total),
            },
            value: {
              color: "#F9FAFB",
              fontSize: "22px",
              fontWeight: 700,
              fontFamily: "JetBrains Mono",
            },
          },
        },
      },
    },
    legend: {
      position: "bottom",
      labels: { colors: "#9CA3AF" },
      fontSize: "12px",
      itemMargin: { horizontal: 8, vertical: 4 },
      markers: { shape: "circle" },
    },
    stroke: { width: 2, colors: ["#111827"] },
    tooltip: { theme: "dark" },
  };

  return (
    <div className="card" style={{ flex: 1, minWidth: 0 }}>
      <p className="section-label" style={{ marginBottom: 4 }}>
        {title}
      </p>
      {!enabled ? (
        <div
          style={{
            height: 200,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 32 }}>🔒</span>
          <span style={{ fontSize: 13 }}>Classificador não ativo</span>
        </div>
      ) : total === 0 ? (
        <div
          style={{
            height: 200,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 32 }}>📊</span>
          <span style={{ fontSize: 13 }}>Aguardando dados…</span>
        </div>
      ) : (
        <ReactApexChart
          options={options}
          series={series}
          type="donut"
          height={220}
        />
      )}
    </div>
  );
}

export function DemographicsChart({ stats }: Props) {
  return (
    <div style={{ display: "flex", gap: 16 }}>
      <DonutCard
        title="Distribuição por Sexo"
        labels={["Feminino", "Masculino", "Indefinido"]}
        series={[stats.sex_female_agg, stats.sex_male_agg, stats.sex_unknown_agg]}
        colors={["#EC4899", "#6366F1", "#6B7280"]}
        enabled={stats.sex_classifier_enabled}
      />
      <DonutCard
        title="Faixa Etária"
        labels={["Criança", "Adolescente", "Jovem", "Adulto", "Idoso", "Indef."]}
        series={[
          stats.age_child_agg,
          stats.age_adolescent_agg,
          stats.age_young_agg,
          stats.age_adult_agg,
          stats.age_elderly_agg,
          stats.age_unknown_agg,
        ]}
        colors={["#00D4FF", "#6366F1", "#10B981", "#F59E0B", "#EF4444", "#6B7280"]}
        enabled={stats.age_classifier_enabled}
      />
    </div>
  );
}
