import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfig } from "../hooks/useConfig";
import { HourlyFlowChart } from "../components/HourlyFlowChart";
import { FlowInsightsCard } from "../components/FlowInsightsCard";
import { HeatmapCard } from "../components/HeatmapCard";
import { useReportsHourly } from "../hooks/useReportsHourly";
import { useReportsDbSummary } from "../hooks/useReportsDbSummary";
import type { ReportsSummaryPayload } from "../types/api";
import {
  formatReportsRangePt,
  rangeFromPreset,
  type ReportsApiQuery,
  type ReportsRangePreset,
} from "../lib/reportsQuery";

interface Props {
  apiBase: string;
}

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const filterLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 4,
};

const filterControl: CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontSize: 13,
  padding: "6px 10px",
  minWidth: 0,
  width: "100%",
};

const presetBtn = (active: boolean): CSSProperties => ({
  background: active ? "rgba(61,170,200,0.15)" : "transparent",
  border: `1px solid ${active ? "var(--cyan)" : "var(--border)"}`,
  borderRadius: "var(--radius-sm)",
  color: active ? "var(--cyan)" : "var(--text-muted)",
  fontFamily: "var(--font-display)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "6px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

export function ReportsDashboard({ apiBase }: Props) {
  const { config } = useConfig(apiBase);
  /** Só consultamos analytics depois de /api/config: evita camera_id=default sem dados no BD. */
  const cameraId = useMemo(() => {
    if (!config) return null;
    return config.active_preset_id?.trim() || "default";
  }, [config]);

  const [preset, setPreset] = useState<ReportsRangePreset>("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [roiId, setRoiId] = useState("");
  const [clsFilter, setClsFilter] = useState("");

  const activateCustom = useCallback(() => {
    setPreset("custom");
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 3600_000);
    setCustomFrom(toLocalDatetimeValue(from));
    setCustomTo(toLocalDatetimeValue(to));
  }, []);

  const apiQuery: ReportsApiQuery = useMemo(() => {
    const { fromIso, toIso } = rangeFromPreset(preset, customFrom, customTo);
    return {
      fromIso,
      toIso,
      roiId: roiId.trim() || undefined,
      cls: clsFilter.trim() ? clsFilter : undefined,
    };
  }, [preset, customFrom, customTo, roiId, clsFilter]);

  const hourly = useReportsHourly(apiBase, cameraId, apiQuery);
  const { data: summary, status } = useReportsDbSummary(apiBase, cameraId, apiQuery);
  const [exporting, setExporting] = useState(false);

  const zoneOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [{ value: "", label: "Todas as zonas (soma)" }];
    opts.push({ value: "line", label: "Linha de contagem" });
    const polys = config?.polygons ?? [];
    for (let i = 0; i < polys.length; i++) {
      const t = (polys[i]?.title || "").trim() || `Polígono ${i + 1}`;
      opts.push({ value: t, label: t });
    }
    return opts;
  }, [config?.polygons]);

  const periodHint = useMemo(() => {
    if (status === "connected" && summary?.from && summary?.to) {
      return formatReportsRangePt(summary.from, summary.to);
    }
    return formatReportsRangePt(apiQuery.fromIso, apiQuery.toIso);
  }, [status, summary?.from, summary?.to, apiQuery.fromIso, apiQuery.toIso]);

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
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
      >
        <div>
          <p className="section-label" style={{ marginBottom: 4 }}>Relatórios</p>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
            BD persistido · {cameraId ?? "…"} ·{" "}
            {!config
              ? "a aguardar preset ativo (/api/config)"
              : `status ${status}${hourly.status === "error" ? " · fluxo horário: erro" : ""}`}
          </span>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || status !== "connected" || !cameraId}
          className="action-btn"
        >
          {exporting ? "Exportando..." : "Exportar CSV"}
        </button>
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="section-label" style={{ marginBottom: 0 }}>Filtros</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ ...filterLabel, marginBottom: 0, marginRight: 4 }}>Período</span>
          {(
            [
              ["24h", "24h" as const, "Últimas 24h"],
              ["48h", "48h" as const, "Últimas 48h"],
              ["7d", "168h" as const, "Últimos 7 dias"],
            ] as const
          ).map(([key, p, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(p)}
              style={presetBtn(preset === p)}
            >
              {label}
            </button>
          ))}
          <button type="button" onClick={activateCustom} style={presetBtn(preset === "custom")}>
            Personalizado
          </button>
        </div>
        {preset === "custom" && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            <div>
              <div style={filterLabel}>De (local)</div>
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                style={filterControl}
              />
            </div>
            <div>
              <div style={filterLabel}>Até (local)</div>
              <input
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                style={filterControl}
              />
            </div>
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <div>
            <div style={filterLabel}>Zona / ROI</div>
            <select value={roiId} onChange={(e) => setRoiId(e.target.value)} style={filterControl}>
              {zoneOptions.map((z) => (
                <option key={z.value || "all"} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={filterLabel}>Classe YOLO (opcional)</div>
            <input
              type="text"
              value={clsFilter}
              onChange={(e) => setClsFilter(e.target.value)}
              placeholder="ex.: person"
              list="reports-cls-suggestions"
              style={filterControl}
            />
            <datalist id="reports-cls-suggestions">
              <option value="person" />
              <option value="car" />
              <option value="bicycle" />
              <option value="motorcycle" />
              <option value="bus" />
              <option value="truck" />
            </datalist>
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, lineHeight: 1.45 }}>
          Os bins horários usam a hora em UTC. Com filtro de classe (ex. <span style={{ fontFamily: "var(--font-mono)" }}>car</span>)
          só contam eventos gravados com essa etiqueta YOLO; se estiver vazio, apague o campo ou use{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>person</span> para pessoas. Trajetórias no resumo
          filtram por zona só quando o track tem essa zona em{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>zones_crossed</span>. O CSV exportado ignora estes filtros.
        </p>
      </div>

      <HourlyFlowChart
        hourlyEntries={hourly.hourlyEntries}
        hourlyExits={hourly.hourlyExits}
        peakHour={hourly.peakHour}
        periodHint={periodHint}
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
        <ReportsDbSummaryCard summary={summary} status={status} configReady={!!config} />
      </div>

      <FlowInsightsCard
        payload={summary?.flow_insights ?? null}
        loading={status === "loading"}
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
  configReady,
}: {
  summary: ReportsSummaryPayload | null;
  status: "idle" | "loading" | "connected" | "error";
  configReady: boolean;
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
        {!configReady
          ? "Aguardando /api/config para alinhar o camera_id com os agregados."
          : status === "connected"
            ? "Resumo derivado de agregados persistidos no banco."
            : status === "error"
              ? "Falha ao carregar resumo do banco."
              : status === "loading"
                ? "A carregar resumo do banco..."
                : "Pronto para carregar."}
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
