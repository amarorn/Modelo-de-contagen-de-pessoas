import { useEffect, useRef } from "react";
import type { PolygonStat } from "../types/api";

interface Props {
  polygonStats: PolygonStat[];
}

const POLY_COLORS: Array<"amber" | "cyan"> = ["amber", "cyan"];

const COLOR_MAP = {
  amber: {
    accent:    "var(--amber)",
    accentDim: "rgba(255,149,0,0.08)",
    glow:      "rgba(255,149,0,0.18)",
    badge:     "rgba(255,149,0,0.14)",
  },
  cyan: {
    accent:    "var(--cyan)",
    accentDim: "rgba(0,180,216,0.08)",
    glow:      "rgba(0,180,216,0.18)",
    badge:     "rgba(0,180,216,0.14)",
  },
};

function formatDwell(seconds: number): string {
  if (seconds < 1) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value && ref.current) {
      ref.current.classList.remove("count-anim");
      void ref.current.offsetWidth;
      ref.current.classList.add("count-anim");
    }
    prev.current = value;
  }, [value]);
  return (
    <span ref={ref} style={{ fontFamily: "var(--font-mono)" }}>
      {value.toLocaleString("pt-BR")}
    </span>
  );
}

function MetricChip({
  icon,
  label,
  value,
  color,
  isText = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
  isText?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        minWidth: 60,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          color: "var(--text-muted)",
        }}
      >
        <span style={{ color, display: "flex", opacity: 0.85 }}>{icon}</span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1,
          color,
          textShadow: `0 0 12px ${color}55`,
        }}
      >
        {isText ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 15 }}>{value}</span>
        ) : (
          <AnimatedNumber value={value as number} />
        )}
      </div>
    </div>
  );
}

export function PolygonMetricsStrip({ polygonStats }: Props) {
  if (!polygonStats || polygonStats.length === 0) return null;

  return (
    <div
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--border)",
        background:
          "linear-gradient(180deg, rgba(17,17,26,0.95) 0%, var(--bg-surface) 100%)",
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "stretch",
      }}
    >
      {/* Section label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          alignSelf: "center",
          paddingRight: 10,
          borderRight: "1px solid var(--border)",
          marginRight: 2,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            lineHeight: 1,
          }}
        >
          Zonas
        </span>
      </div>

      {/* Polygon cards */}
      <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap" }}>
        {polygonStats.map((stat, i) => {
          const colorKey = POLY_COLORS[i % POLY_COLORS.length];
          const c = COLOR_MAP[colorKey];

          return (
            <div
              key={stat.title}
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "10px 14px 10px 16px",
                background: c.accentDim,
                border: `1px solid ${c.glow}`,
                borderLeft: `3px solid ${c.accent}`,
                borderRadius: "0 6px 6px 0",
                minWidth: 220,
                flex: "1 1 220px",
                maxWidth: 320,
                overflow: "hidden",
              }}
            >
              {/* Subtle radial glow from left */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: 120,
                  height: "100%",
                  background: `radial-gradient(ellipse at 0% 50%, ${c.glow} 0%, transparent 70%)`,
                  pointerEvents: "none",
                }}
              />

              {/* Card header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  position: "relative",
                }}
              >
                {/* Polygon shape icon */}
                <svg
                  width={11}
                  height={11}
                  viewBox="0 0 24 24"
                  fill={c.accent}
                  style={{ flexShrink: 0, opacity: 0.9 }}
                >
                  <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
                </svg>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: c.accent,
                  }}
                >
                  {stat.title}
                </span>
              </div>

              {/* Metrics row */}
              <div
                style={{
                  display: "flex",
                  gap: 18,
                  alignItems: "flex-end",
                  position: "relative",
                  flexWrap: "wrap",
                }}
              >
                <MetricChip
                  icon={
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                    </svg>
                  }
                  label="Entradas"
                  value={stat.entries}
                  color="var(--green)"
                />
                <MetricChip
                  icon={
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
                    </svg>
                  }
                  label="Saídas"
                  value={stat.exits}
                  color="var(--red)"
                />
                <MetricChip
                  icon={
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                  }
                  label="Dentro"
                  value={stat.occupancy_now}
                  color={c.accent}
                />
                <MetricChip
                  icon={
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  }
                  label="Permanência"
                  value={formatDwell(stat.avg_dwell_s)}
                  color="rgba(255,149,0,0.85)"
                  isText
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
