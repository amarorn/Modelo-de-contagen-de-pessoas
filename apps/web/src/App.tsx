import { useState } from "react";
import { useStats } from "./hooks/useStats";
import { useConfig } from "./hooks/useConfig";
import {
  IconArrowUp, IconArrowDown, IconUsers, IconArrowsUpDown,
  IconArrowsLeftRight,
  IconCar, IconQueue, IconPerson, IconRotateCcw,
} from "./components/Icons";
import { Header, type AppView } from "./components/Header";
import { StatCard } from "./components/StatCard";
import { LiveFeed } from "./components/LiveFeed";
import { HourlyFlowChart } from "./components/HourlyFlowChart";
import { DemographicsChart } from "./components/DemographicsChart";
import { OccupancyGauge } from "./components/OccupancyGauge";
import { FlowSummaryCard } from "./components/FlowSummaryCard";
import { RoiEditor } from "./components/RoiEditor";
import { SourceEditor } from "./components/SourceEditor";
import { DisplayOverlayToggles } from "./components/DisplayOverlayToggles";
import { SettingsDashboard } from "./components/SettingsDashboard";
import { AlertsLayer } from "./components/AlertToast";
import { HeatmapCard } from "./components/HeatmapCard";
import { ZonesPage } from "./pages/Zones";
import { VehiclesDashboard } from "./pages/VehiclesDashboard";
import { ReportsDashboard } from "./pages/ReportsDashboard";
import { LivePage } from "./pages/LivePage";
import { ProfileSelector } from "./components/ProfileSelector";
import { AuditLogPanel } from "./components/AuditLogPanel";
import { FlowInsightsCard } from "./components/FlowInsightsCard";
import { TrackingModeToggle } from "./components/TrackingModeToggle";
import { useFlowInsights } from "./hooks/useFlowInsights";
import { PolygonMetricsStrip } from "./components/PolygonMetricsStrip";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export default function App() {
  const [roiOpen, setRoiOpen]       = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [view, setView]             = useState<AppView>("pessoas");
  const [resetting, setResetting]   = useState(false);
  const [restoringDefaults, setRestoringDefaults] = useState(false);
  const liveEnabled = view !== "relatorios";
  const { stats, status } = useStats(liveEnabled);
  const { data: flowInsights, error: flowInsightsErr } = useFlowInsights(
    API_BASE,
    liveEnabled && status === "connected",
  );
  const { config, refetchConfig } = useConfig();

  const handleResetCounters = async () => {
    if (resetting) return;
    const ok = window.confirm(
      "Zerar todos os contadores (entradas, saídas, fluxo horário e agregados)?\nEssa ação não pode ser desfeita.",
    );
    if (!ok) return;
    setResetting(true);
    try {
      const res = await fetch(`${API_BASE}/api/counters/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      window.alert(`Falha ao zerar contadores: ${err}`);
    } finally {
      setResetting(false);
    }
  };

  const handleRestoreDefaults = async () => {
    if (restoringDefaults) return;
    const ok = window.confirm(
      "Restaurar preset padrão de detecção/tracking/fluidez?\nIsso aplica valores equilibrados e recarrega o stream.",
    );
    if (!ok) return;
    setRestoringDefaults(true);
    try {
      const preset: Record<string, string> = {
        YOLO_INFER_CONF: "0.16",
        YOLO_MIN_DET_CONF: "0.16",
        YOLO_INFER_IMGSZ: "960",
        YOLO_INFER_IOU: "0.45",
        YOLO_MAX_DET: "150",
        YOLO_VID_STRIDE: "2",
        YOLO_STREAM_BUFFER: "1",
        TRACK_CONF_SUPPRESS_THRESHOLD: "0.06",
        TRACK_CONF_MIN_AGE_FRAMES: "1",
        YOLO_MIN_PERSON_AR: "0.75",
        YOLO_MAX_PERSON_AR: "3.6",
        YOLO_MIN_PERSON_HEIGHT_PX: "20",
        YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC: "0.02",
        YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF: "0.30",
        YOLO_WATCHDOG_SOFT_S: "600",
        YOLO_WATCHDOG_HARD_S: "900",
        YOLO_FEED_STALE_S: "10",
        YOLO_MJPEG_MAX_FPS: "25",
        YOLO_MJPEG_ADAPTIVE_FPS: "1",
        YOLO_MJPEG_ADAPTIVE_HEADROOM: "1.28",
        YOLO_MJPEG_ADAPTIVE_MIN_FPS: "12",
        YOLO_MJPEG_BURST_NEW: "1",
        YOLO_MJPEG_BURST_CAP_FPS: "20",
      };
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preset),
      });
      if (!res.ok) throw new Error(await res.text());
      await refetchConfig();
      window.alert("Preset padrão aplicado com sucesso.");
    } catch (err) {
      window.alert(`Falha ao restaurar padrão: ${err}`);
    } finally {
      setRestoringDefaults(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header
        status={status}
        apiBase={API_BASE}
        view={view}
        onChangeView={setView}
        onOpenRoi={() => setRoiOpen(true)}
        onOpenSource={() => setSourceOpen(true)}
        onOpenZones={() => setView("zonas")}
        onRestoreDefaults={handleRestoreDefaults}
        restoringDefaults={restoringDefaults}
        confidence={stats.cam_confidence}
        confidenceReasons={stats.cam_confidence_reasons}
        camDriftLevel={stats.cam_drift_level ?? "ok"}
        camDriftScore={stats.cam_drift_score ?? 0}
        camDriftReason={stats.cam_drift_reason ?? ""}
        camDriftBaselineReady={stats.cam_drift_baseline_ready ?? false}
      />

      {view === "zonas" ? (
        <ZonesPage apiBase={API_BASE} onBack={() => setView("pessoas")} />
      ) : view === "aovivo" ? (
        <LivePage
          apiBase={API_BASE}
          stats={stats}
          config={config}
          refetchConfig={refetchConfig}
          onOpenSource={() => setSourceOpen(true)}
          onOpenRoi={() => setRoiOpen(true)}
        />
      ) : view === "configuracoes" ? (
        <SettingsDashboard apiBase={API_BASE} onBack={() => setView("pessoas")} />
      ) : view === "veiculos" ? (
        <VehiclesDashboard apiBase={API_BASE} />
      ) : view === "relatorios" ? (
        <ReportsDashboard apiBase={API_BASE} />
      ) : (
        <main
          style={{
            flex: 1,
            padding: "14px clamp(14px, 2.5vw, 28px) 24px",
            width: "100%",
            maxWidth: "min(1920px, 100%)",
            margin: "0 auto",
          }}
        >
          {/* ── Ops layout: Zones left + Video center + KPI column right ── */}
          <div className={`ops-layout${(stats.polygon_stats?.length ?? 0) > 0 ? " has-zones" : ""}`}>

            {/* Left column: zone cards (only visible in polygon mode) */}
            {(stats.polygon_stats?.length ?? 0) > 0 && (
              <div className="ops-zones-col">
                <PolygonMetricsStrip
                  polygonStats={stats.polygon_stats ?? []}
                  orientation="vertical"
                />
              </div>
            )}

            {/* Center column: video + action bar */}
            <div className="ops-video-col">
              <LiveFeed apiBase={API_BASE} hero inferFpsEma={stats.infer_fps_ema} />

              {/* Action bar */}
              <div
                style={{
                  padding: "9px 16px",
                  borderTop: "1px solid var(--border)",
                  background: "linear-gradient(180deg, var(--bg-elevated) 0%, var(--bg-surface) 100%)",
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    minWidth: 0,
                    maxWidth: "100%",
                    flex: "0 1 auto",
                  }}
                >
                  <TrackingModeToggle
                    apiBase={API_BASE}
                    vehicleTrackingAvailable={stats.vehicle_tracking_available ?? false}
                    yoloCountClassIds={stats.yolo_count_class_ids ?? []}
                    yoloClassLabels={stats.yolo_class_labels ?? {}}
                    trackActiveClassIds={stats.track_active_class_ids ?? []}
                  />
                </div>
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <DisplayOverlayToggles apiBase={API_BASE} />
                </div>
                <ProfileSelector
                  apiBase={API_BASE}
                  activeProfile={stats.active_env_profile}
                />
              </div>

            </div>

            {/* Right column: KPI counters */}
            <div className="ops-kpi-col">
              {/* Column header */}
              <div
                style={{
                  padding: "9px 18px 8px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                  background: "rgba(255,149,0,0.025)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}
                >
                  Contadores
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleResetCounters}
                    disabled={resetting}
                    title="Zerar contadores (entradas, saidas, fluxo horario)"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: resetting ? "var(--text-muted)" : "var(--text-secondary)",
                      fontFamily: "var(--font-display)",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      cursor: resetting ? "wait" : "pointer",
                      opacity: resetting ? 0.55 : 1,
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (resetting) return;
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "rgba(239,68,68,0.5)";
                      b.style.color = "var(--red)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = resetting ? "var(--text-muted)" : "var(--text-secondary)";
                    }}
                  >
                    <IconRotateCcw size={10} />
                    {resetting ? "zerando..." : "zerar"}
                  </button>
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--amber)",
                      animation: "pulse 2.5s infinite",
                      display: "inline-block",
                      boxShadow: "0 0 6px var(--amber)",
                    }}
                  />
                </div>
              </div>

              {/* Counters */}
              <StatCard
                variant="counter"
                label="Entradas"
                value={stats.entries}
                icon={<IconArrowUp size={14} />}
                color="var(--green)"
                colorDim="var(--green-dim)"
                subtitle="sessão atual"
              />
              <StatCard
                variant="counter"
                label="Saídas"
                value={stats.exits}
                icon={<IconArrowDown size={14} />}
                color="var(--red)"
                colorDim="var(--red-dim)"
                subtitle="sessão atual"
              />
              {stats.entries === 0 &&
                stats.exits === 0 &&
                (stats.moving_now ?? 0) + (stats.stationary_now ?? 0) >= 8 && (
                  <div
                    style={{
                      margin: "0 12px 8px",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid rgba(245,158,11,0.35)",
                      background: "rgba(245,158,11,0.08)",
                      fontSize: 11,
                      lineHeight: 1.45,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <strong style={{ color: "var(--amber)" }}>Contagem a zero com movimento.</strong>{" "}
                    Entradas/saídas só sobem quando alguém{" "}
                    <strong>cruza</strong> a linha ou a fronteira do polígono. Use{" "}
                    <strong>Configurar ROI</strong> para alinhar ao passeio e, em Visualização,{" "}
                    <strong>Marcações ROI</strong> para ver no vídeo.
                    {(stats.suppressed_events ?? 0) > 5 && (
                      <>
                        {" "}
                        Muitos «cruzamentos suprimidos» no painel Inferência: afinar{" "}
                        <span style={{ fontFamily: "var(--font-mono)" }}>TRACK_CONF_SUPPRESS_THRESHOLD</span> ou{" "}
                        <span style={{ fontFamily: "var(--font-mono)" }}>YOLO_VID_STRIDE</span> no{" "}
                        <span style={{ fontFamily: "var(--font-mono)" }}>.env</span> e reiniciar o servidor.
                      </>
                    )}
                  </div>
                )}
              <StatCard
                variant="counter"
                label="Presentes agora"
                value={stats.occupancy_now}
                icon={<IconUsers size={14} />}
                color="var(--cyan)"
                colorDim="var(--cyan-dim)"
                subtitle="snapshot · ~2s"
                tooltip="Contagem de IDs ativos no tracking no momento atual. Pode subcontar em casos de oclusão prolongada ou perda de ID. Para uma estimativa mais estável, use o Resumo de Fluxo (entradas − saídas)."
              />
              <StatCard
                variant="counter"
                label="Passagens"
                value={stats.total_passages}
                icon={<IconArrowsUpDown size={14} />}
                color="var(--amber)"
                colorDim="var(--amber-dim)"
                subtitle={`pico: ${stats.peak_flow} às ${String(stats.peak_hour).padStart(2, "0")}h`}
              />
              {(stats.polygon_migrations ?? 0) > 0 && (
                <StatCard
                  variant="counter"
                  label="Migrações entre zonas"
                  value={stats.polygon_migrations ?? 0}
                  icon={<IconArrowsLeftRight size={14} />}
                  color="#A78BFA"
                  colorDim="rgba(167,139,250,0.12)"
                  subtitle="transições zona → zona (não contam no global)"
                  tooltip="Número de vezes em que alguém saiu de uma zona e entrou em outra sem deixar a união dos polígonos. Por isso o contador global (passagens pela borda externa) pode ser menor que a soma das entradas das zonas individuais."
                />
              )}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setView("veiculos")}
                onKeyDown={e => e.key === "Enter" && setView("veiculos")}
                style={{ cursor: "pointer" }}
                title="Abrir dashboard de veículos"
              >
                <StatCard
                  variant="counter"
                  label="Veículos"
                  value={stats.vehicle_total ?? 0}
                  icon={<IconCar size={14} />}
                  color="#F97316"
                  colorDim="rgba(249,115,22,0.12)"
                  subtitle={`↑${stats.vehicle_entries ?? 0} ↓${stats.vehicle_exits ?? 0} · clique para detalhes`}
                />
              </div>
              {stats.reid_unique_persons > 0 && (
                <StatCard
                  variant="counter"
                  label="Visitantes únicos"
                  value={stats.reid_unique_persons}
                  icon={<IconPerson size={14} />}
                  color="var(--cyan)"
                  colorDim="var(--cyan-dim)"
                  subtitle={
                    stats.reid_revisited > 0
                      ? `${stats.reid_revisited} revisita${stats.reid_revisited !== 1 ? "s" : ""} · ${stats.reid_avg_dwell_s.toFixed(0)}s médios`
                      : `${stats.reid_avg_dwell_s.toFixed(0)}s tempo médio`
                  }
                  tooltip="Estimativa de indivíduos distintos na sessão, via re-identificação espaço-temporal leve (sem biometria). Tracks que reaparecem a menos de 18% da largura do frame em até 20s são re-linkados ao mesmo visitante."
                />
              )}
              {stats.queue_size > 0 && (
                <StatCard
                  variant="counter"
                  label="Fila detectada"
                  value={stats.queue_size}
                  icon={<IconQueue size={14} />}
                  color={stats.queue_saturated ? "var(--red)" : "var(--amber)"}
                  colorDim={stats.queue_saturated ? "var(--red-dim)" : "var(--amber-dim)"}
                  subtitle={`espera média: ${stats.queue_avg_wait_s.toFixed(0)}s${stats.queue_saturated ? " · saturada" : ""}`}
                  tooltip="Fila detectada automaticamente: tracks lentos com alinhamento espacial (PCA). Saturada quando ≥ 8 pessoas."
                />
              )}

              {/* Spacer + fps readout */}
              <div
                style={{
                  flex: 1,
                  padding: "14px 20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  Inferência
                </div>
                <DataRow label="FPS inferência" value={stats.infer_fps_ema?.toFixed(1) ?? "—"} />
                <DataRow label="Em movimento" value={String(stats.moving_now)} />
                <DataRow label="Parados" value={String(stats.stationary_now)} />
                <DataRow label="Loitering" value={String(stats.loitering_now)} />
                {(stats.low_conf_tracks ?? 0) > 0 && (
                  <DataRow label="Tracks baixa conf." value={String(stats.low_conf_tracks)} />
                )}
                {(stats.suppressed_events ?? 0) > 0 && (
                  <DataRow
                    label="Cruzamentos suprimidos"
                    value={String(stats.suppressed_events)}
                    hint="Contagem bloqueada por confiança do track (6.1)"
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Analytics row ───────────────────────────────────── */}
          <div className="analytics-grid">
            <div style={{ minWidth: 0 }}>
              <HourlyFlowChart
                hourlyEntries={stats.hourly_entries}
                hourlyExits={stats.hourly_exits}
                peakHour={stats.peak_hour}
              />
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
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
              <FlowSummaryCard
                entries={stats.entries}
                exits={stats.exits}
                total={stats.total_passages}
                peakFlow={stats.peak_flow}
                peakHour={stats.peak_hour}
                vehicleEntries={stats.vehicle_entries ?? 0}
                vehicleExits={stats.vehicle_exits ?? 0}
                vehicleTotal={stats.vehicle_total ?? 0}
              />
            </div>
          </div>

          {/* ── Flow intelligence (7.x) ───────────────────────── */}
          <div style={{ marginTop: 14 }}>
            <FlowInsightsCard
              payload={flowInsightsErr ? null : flowInsights}
              loading={status === "connected" && !flowInsights && !flowInsightsErr}
              fetchError={flowInsightsErr}
            />
          </div>

          {/* ── Demographics ────────────────────────────────────── */}
          <div style={{ marginTop: 0 }}>
            <DemographicsChart stats={stats} />
          </div>

          {/* ── Heatmap analítico ───────────────────────────────── */}
          <HeatmapCard apiBase={API_BASE} />

          {/* ── Audit log (6.2) ─────────────────────────────────── */}
          <div style={{ marginTop: 14 }}>
            <AuditLogPanel apiBase={API_BASE} />
          </div>

          {/* ── Error banner ──────────────────────────────────── */}
          {stats.error && (
            <div
              style={{
                marginTop: 14,
                padding: "11px 16px",
                background: "var(--red-dim)",
                border: "1px solid rgba(224,78,78,0.25)",
                borderLeft: "2px solid var(--red)",
                borderRadius: "var(--radius-md)",
                color: "var(--red)",
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span>{stats.error}</span>
            </div>
          )}
        </main>
      )}

      {/* ── Modals ──────────────────────────────────────────────── */}
      {(view === "pessoas" || view === "veiculos" || view === "aovivo") && sourceOpen && (
        <SourceEditor apiBase={API_BASE} onClose={() => setSourceOpen(false)} />
      )}
      {(view === "pessoas" || view === "veiculos" || view === "aovivo") && roiOpen && (
        <RoiEditor
          apiBase={API_BASE}
          config={config}
          onClose={() => setRoiOpen(false)}
          onApplied={() => {
            refetchConfig();
            setRoiOpen(false);
          }}
        />
      )}

      {liveEnabled && <AlertsLayer />}

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "8px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          background: "var(--bg-surface)",
          flexShrink: 0,
          boxShadow: "0 -1px 0 rgba(255,149,0,0.07)",
        }}
      >
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          flexShrink: 0,
        }}>
          VisionCount · Atualização a cada 2s
        </span>
        <span
          title={
            (stats.model_nc ?? 0) > 0
              ? `YOLO nc=${stats.model_nc} · COUNT_CLASS_IDS [${(stats.yolo_count_class_ids ?? []).join(", ")}] · deteção ativa [${(stats.track_active_class_ids ?? []).join(", ")}]`
              : ""
          }
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-muted)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {(stats.model_nc ?? 0) > 0
            ? `YOLO nc=${stats.model_nc} · contagem [${(stats.yolo_count_class_ids ?? []).join(", ")}] · deteção ativa [${(stats.track_active_class_ids ?? []).join(", ")}]`
            : "—"}
        </span>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}>
          {new Date().toLocaleTimeString("pt-BR")}
        </span>
      </footer>
    </div>
  );
}

/* ── Helper components ────────────────────────────────────────── */

function DataRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      title={hint}
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 11,
      }}
    >
      <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-display)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
        {value}
      </span>
    </div>
  );
}
