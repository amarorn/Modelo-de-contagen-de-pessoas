import { useState } from "react";
import { useConfig } from "../hooks/useConfig";
import { HourlyFlowChart } from "../components/HourlyFlowChart";
import { FlowInsightsCard } from "../components/FlowInsightsCard";
import { HeatmapCard } from "../components/HeatmapCard";
import { useReportsHourly } from "../hooks/useReportsHourly";
import { useReportsDbSummary } from "../hooks/useReportsDbSummary";
import type { ReportsSummaryPayload } from "../types/api";

interface Props {
  apiBase: string;
}

export function ReportsDashboard({ apiBase }: Props) {
  const config = useConfig(apiBase);
  const cameraId = config?.active_preset_id?.trim() || "default";
  const hourly = useReportsHourly(apiBase, cameraId);
  const { data: summary, status } = useReportsDbSummary(apiBase, cameraId);
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
            BD persistido · {cameraId} · status {status}
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <ReportsUnavailableCard
            title="Perfil estimado — Gênero"
            text="Este histórico ainda não é persistido no banco."
          />
          <ReportsUnavailableCard
            title="Perfil estimado — Idade"
            text="Este histórico ainda não é persistido no banco."
          />
        </div>
        <ReportsDbSummaryCard summary={summary} status={status} />
      </div>

      <FlowInsightsCard
        payload={summary?.flow_insights ?? null}
        loading={status === "loading" || status === "idle"}
        fetchError={status === "error"}
      />
      <HeatmapCard apiBase={apiBase} />
    </div>
  );
}

function ReportsUnavailableCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="card" style={{ minHeight: 280, display: "flex", flexDirection: "column" }}>
      <p className="section-label">{title}</p>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13,
          padding: 24,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ReportsDbSummaryCard({
  summary,
  status,
}: {
  summary: ReportsSummaryPayload | null;
  status: "idle" | "loading" | "connected" | "error";
}) {
  const fmt = (s: number) =>
    s >= 60
      ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`
      : `${s.toFixed(0)}s`;
  const asOf = summary?.latest_minute_bucket
    ? new Date(summary.latest_minute_bucket).toLocaleString("pt-BR")
    : "sem amostra";

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="section-label">Última ocupação (BD)</p>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 42,
          lineHeight: 1,
          color: "var(--red)",
          textAlign: "center",
          marginTop: 8,
        }}
      >
        {summary?.latest_occupancy ?? 0}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
        última amostra: {asOf}
      </div>
      <hr className="divider" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ReportsMetric label="Entradas" value={summary?.entries ?? 0} color="var(--green)" />
        <ReportsMetric label="Saídas" value={summary?.exits ?? 0} color="var(--red)" />
        <ReportsMetric label="Pico ocupação" value={summary?.peak_occupancy ?? 0} color="var(--amber)" />
        <ReportsMetric label="Trajetórias fechadas" value={summary?.closed_trajectories ?? 0} color="var(--cyan)" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", marginTop: 6 }}>
        Permanência média:{" "}
        <span style={{ color: "var(--amber)", fontFamily: "var(--font-mono)" }}>
          {fmt(summary?.avg_dwell_s ?? 0)}
        </span>
      </div>
      {(summary?.max_dwell_s ?? 0) > 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
          Máx. permanência:{" "}
          <span style={{ color: "var(--amber)", fontFamily: "var(--font-mono)" }}>
            {fmt(summary?.max_dwell_s ?? 0)}
          </span>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 8 }}>
        {status === "connected"
          ? "Resumo derivado de agregados persistidos no banco."
          : status === "error"
            ? "Falha ao carregar resumo do banco."
            : "A carregar resumo do banco..."}
      </div>
    </div>
  );
}

function ReportsMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--bg-elevated)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{value}</div>
    </div>
  );
}
