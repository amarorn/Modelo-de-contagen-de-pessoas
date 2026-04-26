import { useState } from "react";
import { useStats } from "../hooks/useStats";
import { useFlowInsights } from "../hooks/useFlowInsights";
import { HourlyFlowChart } from "../components/HourlyFlowChart";
import { DemographicsChart } from "../components/DemographicsChart";
import { OccupancyGauge } from "../components/OccupancyGauge";
import { FlowInsightsCard } from "../components/FlowInsightsCard";
import { HeatmapCard } from "../components/HeatmapCard";

interface Props {
  apiBase: string;
}

function fmtDwell(sec: number): string {
  if (sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function KpiCard({
  label, value, sub, color,
}: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <p className="section-label" style={{ marginBottom: 0 }}>{label}</p>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontFamily: "var(--font-display)", fontSize: 10, color: "var(--text-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{
        fontFamily: "var(--font-display)", fontSize: 9, fontWeight: 700,
        letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)",
      }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

export function ReportsDashboard({ apiBase }: Props) {
  const { stats, status } = useStats();
  const { data: flowInsights, error: flowInsightsErr } = useFlowInsights(
    apiBase,
    status === "connected",
  );
  const [exporting, setExporting] = useState(false);
  const [exportingZones, setExportingZones] = useState(false);

  const netFlow = stats.entries - stats.exits;
  const hasZones = (stats.polygon_stats?.length ?? 0) > 0;
  const hasQueue = stats.queue_size > 0 || stats.queue_avg_wait_s > 0;

  const maxFlowIdx = hasZones
    ? stats.polygon_stats!.reduce(
        (best, z, i, arr) =>
          (z.entries + z.exits) > (arr[best].entries + arr[best].exits) ? i : best,
        0,
      )
    : -1;

  const statusColor =
    status === "connected" ? "var(--green)"
    : status === "error" ? "var(--red)"
    : "var(--amber)";

  const statusDim =
    status === "connected" ? "var(--green-dim)"
    : status === "error" ? "var(--red-dim)"
    : "var(--amber-dim)";

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

  const handleExportZones = async () => {
    if (exportingZones || !hasZones) return;
    setExportingZones(true);
    try {
      const res = await fetch(`${apiBase}/api/export/zones`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      window.alert(`CSV de zonas exportado: ${data.csv_path}`);
    } catch (err) {
      window.alert(`Erro ao exportar zonas: ${err}`);
    } finally {
      setExportingZones(false);
    }
  };

  const reidReturnRate =
    stats.reid_unique_persons > 0
      ? Math.round((stats.reid_revisited / stats.reid_unique_persons) * 100)
      : 0;

  return (
    <div style={{
      flex: 1,
      padding: "14px clamp(14px, 2.5vw, 28px) 32px",
      width: "100%",
      maxWidth: "min(1920px, 100%)",
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: 20,
    }}>

      {/* ── Page Header ─────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40,
            background: "rgba(0,180,216,0.12)",
            border: "1px solid rgba(0,180,216,0.25)",
            borderRadius: "var(--radius-md)",
            display: "grid", placeItems: "center", flexShrink: 0,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              stroke="var(--cyan)" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
          </div>
          <div>
            <h1 style={{
              fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800,
              color: "var(--text-primary)", letterSpacing: "0.04em",
              textTransform: "uppercase", margin: 0, lineHeight: 1.1,
            }}>
              Relatórios
            </h1>
            <p style={{
              color: "var(--text-muted)", fontSize: 10,
              fontFamily: "var(--font-display)", letterSpacing: "0.14em",
              textTransform: "uppercase", margin: 0, marginTop: 3,
            }}>
              Dados da sessão atual
            </p>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 10px",
            background: statusDim,
            border: `1px solid ${statusColor}33`,
            borderRadius: "var(--radius-sm)",
            color: statusColor,
            fontFamily: "var(--font-display)",
            fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase",
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
            {status === "connected" ? "Ao vivo" : status === "error" ? "Offline" : "Conectando"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={handleExport}
            disabled={exporting || status !== "connected"}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 14px",
              background: "rgba(0,180,216,0.08)",
              border: "1px solid var(--cyan)",
              borderRadius: "var(--radius-sm)",
              color: "var(--cyan)",
              fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: exporting || status !== "connected" ? "default" : "pointer",
              opacity: exporting || status !== "connected" ? 0.5 : 1,
              transition: "opacity 0.15s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>

          <button
            onClick={handleExportZones}
            disabled={exportingZones || !hasZones || status !== "connected"}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 14px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: hasZones ? "var(--text-secondary)" : "var(--text-muted)",
              fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              cursor: exportingZones || !hasZones || status !== "connected" ? "default" : "pointer",
              opacity: !hasZones || status !== "connected" ? 0.4 : 1,
              transition: "opacity 0.15s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
              <line x1="9" y1="3" x2="9" y2="18" />
              <line x1="15" y1="6" x2="15" y2="21" />
            </svg>
            {exportingZones ? "Exportando…" : "Zonas CSV"}
          </button>
        </div>
      </div>

      {/* ── KPI Summary Bar ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        <KpiCard label="Entradas" value={fmtNum(stats.entries)} color="var(--green)" />
        <KpiCard label="Saídas" value={fmtNum(stats.exits)} color="var(--red)" />
        <KpiCard
          label="Fluxo Líquido"
          value={(netFlow >= 0 ? "+" : "") + fmtNum(netFlow)}
          color={netFlow >= 0 ? "var(--green)" : "var(--red)"}
        />
        <KpiCard
          label="Visitantes Únicos"
          value={fmtNum(stats.reid_unique_persons)}
          color="var(--cyan)"
        />
        <KpiCard
          label="Hora de Pico"
          value={`${String(stats.peak_hour).padStart(2, "0")}h`}
          sub={`${stats.peak_flow} passagens`}
          color="var(--amber)"
        />
        <KpiCard
          label="Tempo Médio"
          value={fmtDwell(stats.avg_dwell_sec)}
          color="var(--text-secondary)"
        />
      </div>

      {/* ── Hourly Flow Chart (full width) ───────────────────── */}
      <HourlyFlowChart
        hourlyEntries={stats.hourly_entries}
        hourlyExits={stats.hourly_exits}
        peakHour={stats.peak_hour}
      />

      {/* ── Analytics Row: Demographics | Occupancy ─────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <DemographicsChart stats={stats} />
        </div>
        <div style={{ minWidth: 0 }}>
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
      </div>

      {/* ── Queue + ReID Row ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Queue Analysis */}
        <div className="card">
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: 16,
          }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Análise de Fila</p>
            {stats.queue_saturated && (
              <span className="badge badge-red">Saturada</span>
            )}
          </div>
          {hasQueue ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              <StatRow
                label="Tamanho"
                value={String(stats.queue_size)}
                color={stats.queue_saturated ? "var(--red)" : "var(--amber)"}
              />
              <StatRow
                label="Espera Média"
                value={fmtDwell(stats.queue_avg_wait_s)}
                color="var(--text-primary)"
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{
                  fontFamily: "var(--font-display)", fontSize: 9, fontWeight: 700,
                  letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)",
                }}>
                  Status
                </div>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 700,
                  color: stats.queue_saturated ? "var(--red)" : "var(--green)",
                  lineHeight: 1, marginTop: 4,
                }}>
                  {stats.queue_saturated ? "Saturada" : "Normal"}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              height: 80, display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-muted)", fontFamily: "var(--font-display)", fontSize: 12,
            }}>
              Nenhuma fila detectada na sessão atual
            </div>
          )}
        </div>

        {/* ReID / Visitor Analytics */}
        <div className="card">
          <p className="section-label">Identificação de Visitantes</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 4 }}>
            <StatRow
              label="Únicos"
              value={fmtNum(stats.reid_unique_persons)}
              color="var(--cyan)"
            />
            <StatRow
              label="Retornos"
              value={fmtNum(stats.reid_revisited)}
              color="var(--amber)"
            />
            <StatRow
              label="Dwell Médio"
              value={fmtDwell(stats.reid_avg_dwell_s)}
              color="var(--text-secondary)"
            />
          </div>
          {stats.reid_unique_persons > 0 && (
            <div style={{
              marginTop: 16, padding: "10px 12px",
              background: "var(--bg-base)",
              borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
            }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 11, color: "var(--text-muted)" }}>
                Taxa de retorno:{" "}
                <span style={{
                  color: reidReturnRate > 0 ? "var(--amber)" : "var(--text-secondary)",
                  fontWeight: 700, fontFamily: "var(--font-mono)",
                }}>
                  {reidReturnRate}%
                </span>
                {" "}dos visitantes retornaram à área
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Zone Table (only when polygon_stats present) ──────── */}
      {hasZones && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Estatísticas por Zona</p>
            <span className="badge badge-amber">{stats.polygon_stats!.length} zonas</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Zona", "Entradas", "Saídas", "Fluxo Líq.", "Presentes", "Dwell Médio"].map((h) => (
                    <th key={h} style={{
                      padding: "10px 20px",
                      textAlign: h === "Zona" ? "left" : "right",
                      fontFamily: "var(--font-display)", fontSize: 9, fontWeight: 700,
                      letterSpacing: "0.14em", textTransform: "uppercase",
                      color: "var(--text-muted)", whiteSpace: "nowrap",
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.polygon_stats!.map((zone, idx) => {
                  const net = zone.entries - zone.exits;
                  const isMax = idx === maxFlowIdx;
                  return (
                    <tr
                      key={zone.title}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: isMax ? "rgba(255,149,0,0.04)" : "transparent",
                      }}
                    >
                      <td style={{
                        padding: "11px 20px",
                        color: isMax ? "var(--amber)" : "var(--text-primary)",
                        fontFamily: "var(--font-display)", fontWeight: isMax ? 700 : 400,
                        fontSize: 13,
                      }}>
                        {isMax && (
                          <span style={{ color: "var(--amber)", marginRight: 6, fontSize: 9 }}>▶</span>
                        )}
                        {zone.title}
                      </td>
                      <td style={{ padding: "11px 20px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--green)" }}>
                        {zone.entries}
                      </td>
                      <td style={{ padding: "11px 20px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--red)" }}>
                        {zone.exits}
                      </td>
                      <td style={{ padding: "11px 20px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: net >= 0 ? "var(--green)" : "var(--red)" }}>
                        {net >= 0 ? "+" : ""}{net}
                      </td>
                      <td style={{ padding: "11px 20px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-secondary)" }}>
                        {zone.occupancy_now}
                      </td>
                      <td style={{ padding: "11px 20px", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)" }}>
                        {fmtDwell(zone.avg_dwell_s)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Flow Insights ─────────────────────────────────────── */}
      <FlowInsightsCard payload={flowInsights} fetchError={flowInsightsErr} />

      {/* ── Heatmap Histórico ─────────────────────────────────── */}
      <HeatmapCard apiBase={apiBase} />
    </div>
  );
}
