import { useState } from "react";
import type { HeatmapPeriod, HeatmapPayload } from "../types/api";
import { useHeatmap } from "../hooks/useHeatmap";
import { useHeatmapHistory } from "../hooks/useHeatmapHistory";
import { HeatmapCanvas } from "./HeatmapCanvas";
import { Tooltip, InfoIcon } from "./Tooltip";

interface Props {
  apiBase: string;
}

type PeriodOption = { key: "live" | HeatmapPeriod; label: string; sublabel: string };

const PERIODS: PeriodOption[] = [
  { key: "live",    label: "Ao Vivo",  sublabel: "snapshot ~2s"    },
  { key: "session", label: "Sessão",   sublabel: "desde o início"  },
  { key: "1h",      label: "1h",       sublabel: "última hora"     },
  { key: "today",   label: "Hoje",     sublabel: "desde meia-noite"},
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
  const [period, setPeriod] = useState<"live" | HeatmapPeriod>("session");

  const livePayload  = useHeatmap(apiBase, period === "live");
  const histPayload  = useHeatmapHistory(apiBase, period !== "live" ? period : null);

  const payload: HeatmapPayload | null = period === "live" ? livePayload : histPayload;
  const hasData = payload !== null && payload.cells.length > 0;
  const totalEvents = payload?.total_events ?? 0;
  const slotsInfo =
    period !== "live" && (payload as any)?.slots_merged != null
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
        {hasData ? (
          <HeatmapCanvas payload={payload} opacity={0.92} />
        ) : (
          <EmptyState period={period} />
        )}

        {/* Inferno gradient legend */}
        {hasData && (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 10,
              display: "flex",
              alignItems: "center",
              gap: 5,
              pointerEvents: "none",
            }}
          >
            <span
              style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}
            >
              baixo
            </span>
            <div
              style={{
                width: 64,
                height: 5,
                borderRadius: 2,
                background:
                  "linear-gradient(to right, #000004, #280b54, #65156e, #9f2a63, #d44842, #f57d15, #fac228, #fcffa4)",
              }}
            />
            <span
              style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}
            >
              alto
            </span>
          </div>
        )}

        {/* Period label overlay */}
        {hasData && (
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
    </div>
  );
}
