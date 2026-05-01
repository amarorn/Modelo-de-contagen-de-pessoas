import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import type { Stats } from "../types/api";
import { IconLock, IconBarChart } from "./Icons";
import { Tooltip, WarnIcon } from "./Tooltip";

interface Props { stats: Stats }

const ESTIMATE_TOOLTIP = "Inferência probabilística por modelo de visão computacional. Acurácia reduzida em casos de oclusão, ângulo desfavorável, baixa iluminação ou distância. Não use para decisões operacionais críticas.";

function DonutCard({
  title, labels, series, colors, enabled,
}: { title: string; labels: string[]; series: number[]; colors: string[]; enabled: boolean }) {
  const total = series.reduce((a, b) => a + b, 0);

  const options: ApexOptions = {
    chart: { type: "donut", background: "transparent", animations: { enabled: true, speed: 400 } },
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
              show: true, label: "Total", color: "#9CA3AF", fontSize: "12px",
              fontWeight: 500, formatter: () => String(total),
            },
            value: { color: "#F9FAFB", fontSize: "22px", fontWeight: 700, fontFamily: "JetBrains Mono" },
          },
        },
      },
    },
    legend: {
      position: "bottom", labels: { colors: "#9CA3AF" }, fontSize: "12px",
      itemMargin: { horizontal: 8, vertical: 4 }, markers: { shape: "circle" },
    },
    stroke: { width: 2, colors: ["#111827"] },
    tooltip: { theme: "dark" },
  };

  const Placeholder = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
    <div style={{ height: 200, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: 10 }}>
      <span style={{ color: "var(--text-muted)", opacity: 0.5 }}>{icon}</span>
      <span style={{ fontSize: 13 }}>{text}</span>
    </div>
  );

  return (
    <div className="card" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className="section-label" style={{ marginBottom: 0 }}>{title}</p>
        {enabled && total > 0 && (
          <Tooltip text={ESTIMATE_TOOLTIP} align="right" width={240}>
            <span className="badge badge-warn" style={{ gap: 4, cursor: "help" }}>
              <WarnIcon size={10} color="var(--amber)" />
              estimativa
            </span>
          </Tooltip>
        )}
      </div>
      {!enabled ? (
        <Placeholder icon={<IconLock size={32} />} text="Classificador não ativo" />
      ) : total === 0 ? (
        <Placeholder icon={<IconBarChart size={32} />} text="Aguardando dados…" />
      ) : (
        <ReactApexChart options={options} series={series} type="donut" height={220} />
      )}
    </div>
  );
}

export function DemographicsChart({ stats }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <DonutCard
        title="Perfil estimado — Gênero"
        labels={["Feminino", "Masculino", "Indefinido"]}
        series={[stats.sex_female_agg, stats.sex_male_agg, stats.sex_unknown_agg]}
        colors={["#EC4899", "#6366F1", "#6B7280"]}
        enabled={
          stats.sex_classifier_enabled &&
          Boolean(stats.sex_overlay_available) &&
          Boolean(stats.show_sex_overlay)
        }
      />
      <DonutCard
        title="Perfil estimado — Idade"
        labels={["Criança", "Adolescente", "Jovem", "Adulto", "Idoso", "Indef."]}
        series={[stats.age_child_agg, stats.age_adolescent_agg, stats.age_young_agg,
                 stats.age_adult_agg, stats.age_elderly_agg, stats.age_unknown_agg]}
        colors={["#00D4FF", "#6366F1", "#10B981", "#F59E0B", "#EF4444", "#6B7280"]}
        enabled={stats.age_classifier_enabled}
      />
    </div>
  );
}
