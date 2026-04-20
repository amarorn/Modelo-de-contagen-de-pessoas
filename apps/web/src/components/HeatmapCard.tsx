import React, { useState } from "react";
import type { HeatmapPeriod, HeatmapPayload } from "../types/api";
import { useHeatmap } from "../hooks/useHeatmap";
import { useHeatmapHistory } from "../hooks/useHeatmapHistory";
import { useHeatmapDiff } from "../hooks/useHeatmapDiff";
import { useHeatmapReplay } from "../hooks/useHeatmapReplay";
import { useFlowVectors } from "../hooks/useFlowVectors";
import { HeatmapCanvas } from "./HeatmapCanvas";
import { HeatmapDiffCanvas } from "./HeatmapDiffCanvas";
import { FlowVectorCanvas } from "./FlowVectorCanvas";
import { ReplayControls, useReplayAnimation } from "./ReplayControls";
import { Tooltip, InfoIcon } from "./Tooltip";

interface Props {
  apiBase: string;
}

type PeriodKey = "live" | HeatmapPeriod | "vectors" | "diff" | "anomaly" | "replay";
type PeriodOption = { key: PeriodKey; label: string; sublabel: string };

const PERIODS: PeriodOption[] = [
  { key: "live",    label: "Ao Vivo",   sublabel: "snapshot ~2s"       },
  { key: "session", label: "Sessão",    sublabel: "desde o início"     },
  { key: "1h",      label: "1h",        sublabel: "última hora"        },
  { key: "today",   label: "Hoje",      sublabel: "desde meia-noite"   },
  { key: "vectors", label: "Vetores",   sublabel: "fluxo direcional"   },
  { key: "diff",    label: "Δ Comp.",   sublabel: "1h vs hoje"         },
  { key: "anomaly", label: "Anomalia",  sublabel: "desvio do padrão"   },
  { key: "replay",  label: "Replay",    sublabel: "animação temporal"  },
];

const TOOLTIP_TEXT =
  "Heatmap de fluxo — mostra a distribuição acumulada de centroides (pés) " +
  "por célula da grade 32×18. Cores mais quentes indicam maior densidade de passagens.";

function formatEvents(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function PeriodPill({
  option, active, onClick,
}: { option: PeriodOption; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={option.sublabel}
      style={{
        background: active ? "rgba(61,170,200,0.15)" : "transparent",
        border: `1px solid ${active ? "var(--cyan)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        color: active ? "var(--cyan)" : "var(--text-muted)",
        fontFamily: "var(--font-display)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "3px 9px",
        cursor: "pointer",
        transition: "background 0.15s, border-color 0.15s, color 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {option.label}
    </button>
  );
}

function EmptyState({ period }: { period: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        color: "var(--text-muted)",
      }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity={0.3}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-display)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        {period === "live" ? "Aguardando dados…" : "Sem dados para este período"}
      </span>
    </div>
  );
}

export function HeatmapCard({ apiBase }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("session");
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  const isVectors = period === "vectors";
  const isDiff    = period === "diff";
  const isAnomaly = period === "anomaly";
  const isReplay  = period === "replay";
  const isHeatPeriod = !isVectors && !isDiff && !isAnomaly && !isReplay && period !== "live";

  const livePayload    = useHeatmap(apiBase, period === "live");
  const histPayload    = useHeatmapHistory(apiBase, isHeatPeriod ? (period as HeatmapPeriod) : null);
  const vectorsPayload = useFlowVectors(apiBase, isVectors);
  const diffPayload    = useHeatmapDiff(apiBase, "1h", "today", isDiff || isAnomaly);
  const { payload: replayPayload, loading: replayLoading } = useHeatmapReplay(apiBase, "today", isReplay);

  useReplayAnimation(replayPlaying, replayPayload?.slots.length ?? 0, setReplayIdx);

  const payload: HeatmapPayload | null =
    period === "live" ? livePayload : (isHeatPeriod ? histPayload : null);

  const hasData    = payload !== null && payload.cells.length > 0;
  const hasVectors = isVectors && vectorsPayload !== null && vectorsPayload.vectors.length > 0;
  const hasDiff    = (isDiff || isAnomaly) && diffPayload !== null &&
                     (isDiff ? diffPayload.delta.length > 0 : diffPayload.anomaly.length > 0);
  const hasReplay  = isReplay && (replayPayload?.slots.length ?? 0) > 0;
  const currentSlot = replayPayload?.slots[replayIdx] ?? null;

  const totalEvents = payload?.total_events ?? 0;
  const slotsInfo =
    isHeatPeriod && (payload as any)?.slots_merged != null
      ? ` · ${(payload as any).slots_merged as number} slot${(payload as any).slots_merged !== 1 ? "s" : ""}`
      : "";

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Mapa de Calor — Fluxo</p>
            <Tooltip text={TOOLTIP_TEXT} align="left" width={260}>
              <span style={{ color: "var(--text-muted)", opacity: 0.5, display: "flex" }}>
                <InfoIcon size={11} />
              </span>
            </Tooltip>
          </div>
          {totalEvents > 0 && (
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                marginTop: 2,
                display: "block",
              }}
            >
              {formatEvents(totalEvents)} eventos{slotsInfo}
            </span>
          )}
        </div>

        {/* Period pills */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {PERIODS.map((p) => (
            <PeriodPill
              key={p.key}
              option={p}
              active={period === p.key}
              onClick={() => setPeriod(p.key)}
            />
          ))}
        </div>
      </div>

      {/* ── Canvas area ─────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          background: "#06060f",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          overflow: "hidden",
        }}
      >
        {/* Canvas content */}
        {isVectors && (hasVectors
          ? <FlowVectorCanvas payload={vectorsPayload!} opacity={0.9} />
          : <EmptyState period={period} />
        )}
        {(isDiff || isAnomaly) && (hasDiff
          ? <HeatmapDiffCanvas
              cells={isDiff ? diffPayload!.delta : diffPayload!.anomaly}
              grid_w={diffPayload!.grid_w}
              grid_h={diffPayload!.grid_h}
              mode={isDiff ? "diff" : "anomaly"}
            />
          : <EmptyState period={period} />
        )}
        {isReplay && (replayLoading
          ? <LoadingState />
          : hasReplay && currentSlot
            ? <HeatmapCanvas
                payload={{ grid_w: replayPayload!.grid_w, grid_h: replayPayload!.grid_h, max_val: 1, total_events: currentSlot.total_events, cells: currentSlot.cells }}
                opacity={0.92}
              />
            : <EmptyState period={period} />
        )}
        {!isVectors && !isDiff && !isAnomaly && !isReplay && (hasData
          ? <HeatmapCanvas payload={payload!} opacity={0.92} />
          : <EmptyState period={period} />
        )}

        {/* Legends */}
        {hasData && !isVectors && !isDiff && !isAnomaly && !isReplay && (
          <InfernoLegend />
        )}
        {hasDiff && isDiff && <DivergingLegend />}
        {hasDiff && isAnomaly && (
          <OverlayLabel right>z-score · min 3 slots baseline</OverlayLabel>
        )}
        {hasVectors && (
          <OverlayLabel right>{vectorsPayload!.vectors.length} vetores</OverlayLabel>
        )}
        {hasReplay && currentSlot && (
          <OverlayLabel right>{currentSlot.total_events.toLocaleString("pt-BR")} ev</OverlayLabel>
        )}

        {/* Period label overlay */}
        {(hasData || hasVectors || hasDiff || (hasReplay && currentSlot)) && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 10,
              fontFamily: "var(--font-display)",
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.3)",
              pointerEvents: "none",
            }}
          >
            {PERIODS.find((p) => p.key === period)?.sublabel}
          </div>
        )}
      </div>

      {/* ── Replay controls ─────────────────────────────────────────── */}
      {isReplay && hasReplay && (
        <ReplayControls
          slots={replayPayload!.slots}
          currentIndex={replayIdx}
          playing={replayPlaying}
          onIndexChange={(i) => { setReplayIdx(i); setReplayPlaying(false); }}
          onPlayPause={() => setReplayPlaying((p) => !p)}
        />
      )}

      {/* Diff meta */}
      {(isDiff || isAnomaly) && diffPayload && (
        <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", display: "flex", gap: 12 }}>
          <span>período: {formatEvents(diffPayload.period_events)} ev</span>
          <span>baseline: {formatEvents(diffPayload.baseline_events)} ev</span>
          {!diffPayload.has_anomaly_data && isAnomaly && (
            <span style={{ color: "var(--amber)" }}>precisa ≥ 3 slots de histórico</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Helper subcomponents ──────────────────────────────────────────── */

function LoadingState() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
      <span style={{ fontSize: 11, fontFamily: "var(--font-display)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Carregando…
      </span>
    </div>
  );
}

function InfernoLegend() {
  return (
    <div style={{ position: "absolute", bottom: 8, right: 10, display: "flex", alignItems: "center", gap: 5, pointerEvents: "none" }}>
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>baixo</span>
      <div style={{ width: 64, height: 5, borderRadius: 2, background: "linear-gradient(to right, #000004, #280b54, #65156e, #9f2a63, #d44842, #f57d15, #fac228, #fcffa4)" }} />
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>alto</span>
    </div>
  );
}

function DivergingLegend() {
  return (
    <div style={{ position: "absolute", bottom: 8, right: 10, display: "flex", alignItems: "center", gap: 5, pointerEvents: "none" }}>
      <span style={{ fontSize: 9, color: "rgba(100,160,230,0.7)", fontFamily: "var(--font-mono)" }}>− menos</span>
      <div style={{ width: 56, height: 5, borderRadius: 2, background: "linear-gradient(to right, #1e50c8, transparent, #c84010)" }} />
      <span style={{ fontSize: 9, color: "rgba(200,100,10,0.7)", fontFamily: "var(--font-mono)" }}>+ mais</span>
    </div>
  );
}

function OverlayLabel({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <div style={{ position: "absolute", bottom: 8, [right ? "right" : "left"]: 10, fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)", pointerEvents: "none" }}>
      {children}
    </div>
  );
}
