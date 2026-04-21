import { useEffect, useRef, useState } from "react";
import type { PolygonStat } from "../types/api";

interface Props {
  polygonStats: PolygonStat[];
  orientation?: "horizontal" | "vertical";
}

const POLY_COLORS: Array<"amber" | "cyan"> = ["amber", "cyan"];

const COLOR_MAP = {
  amber: {
    accent:     "#FF9500",
    accentVar:  "var(--amber)",
    dimBg:      "rgba(255,149,0,0.06)",
    glow:       "rgba(255,149,0,0.22)",
    glowSoft:   "rgba(255,149,0,0.10)",
    shadow:     "rgba(255,149,0,0.15)",
    topLine:    "rgba(255,180,60,0.22)",
  },
  cyan: {
    accent:     "#00B4D8",
    accentVar:  "var(--cyan)",
    dimBg:      "rgba(0,180,216,0.06)",
    glow:       "rgba(0,180,216,0.22)",
    glowSoft:   "rgba(0,180,216,0.10)",
    shadow:     "rgba(0,180,216,0.15)",
    topLine:    "rgba(60,210,255,0.22)",
  },
};

function formatDwell(seconds: number): string {
  if (seconds < 1) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function AnimatedNumber({ value, color }: { value: number; color: string }) {
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
    <span
      ref={ref}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 1,
        color,
        textShadow: `0 0 14px ${color}66`,
        letterSpacing: "-0.02em",
      }}
    >
      {value.toLocaleString("pt-BR")}
    </span>
  );
}

function MetricCell({
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
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 52 }}>
      {/* Label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span style={{ color, opacity: 0.8, display: "flex", flexShrink: 0 }}>{icon}</span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 7.5,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.32)",
          }}
        >
          {label}
        </span>
      </div>
      {/* Value */}
      {isText ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1,
            color,
            textShadow: `0 0 10px ${color}55`,
          }}
        >
          {value}
        </span>
      ) : (
        <AnimatedNumber value={value as number} color={color} />
      )}
    </div>
  );
}

function ElevatedCard({
  stat,
  colorKey,
}: {
  stat: PolygonStat;
  colorKey: "amber" | "cyan";
}) {
  const c = COLOR_MAP[colorKey];
  const [hovered, setHovered] = useState(false);

  // Elevation effect: simulates a panel raised ~6px above the surface
  const elevation = hovered
    ? [
        `inset 0 1px 0 rgba(255,255,255,0.10)`,
        `inset 0 -1px 0 rgba(0,0,0,0.5)`,
        `0 1px 2px rgba(0,0,0,0.7)`,
        `0 4px 12px rgba(0,0,0,0.6)`,
        `0 12px 32px rgba(0,0,0,0.45)`,
        `0 24px 60px rgba(0,0,0,0.30)`,
        `0 0 24px ${c.shadow}`,
      ].join(", ")
    : [
        `inset 0 1px 0 rgba(255,255,255,0.06)`,
        `inset 0 -1px 0 rgba(0,0,0,0.40)`,
        `0 1px 2px rgba(0,0,0,0.6)`,
        `0 4px 14px rgba(0,0,0,0.5)`,
        `0 14px 40px rgba(0,0,0,0.38)`,
        `0 0 16px ${c.shadow}`,
      ].join(", ");

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px 12px 15px",

        // Lighting simulation: panel face catches light from top-left
        background: `linear-gradient(
          160deg,
          rgba(26,26,40,0.98) 0%,
          rgba(15,15,24,0.98) 55%,
          rgba(9,9,15,0.98) 100%
        )`,

        // Border: each edge tells a story about where the light hits
        borderTop:    `1px solid ${c.topLine}`,
        borderRight:  "1px solid rgba(255,255,255,0.025)",
        borderBottom: "1px solid rgba(0,0,0,0.55)",
        borderLeft:   `3px solid ${c.accent}`,
        borderRadius: "0 7px 7px 0",

        // Multi-layer shadow = height illusion
        boxShadow: elevation,
        transform: hovered ? "translateY(-2px)" : "translateY(-1px)",
        transition: "transform 0.18s ease, box-shadow 0.18s ease",

        overflow: "hidden",
        cursor: "default",
        flex: "1 1 auto",
        width: "100%",
      }}
    >
      {/* Left face: radial glow column from the accent border */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: 80, height: "100%",
          background: `radial-gradient(ellipse at 0% 50%, ${c.glowSoft} 0%, transparent 75%)`,
          pointerEvents: "none",
        }}
      />

      {/* Top face: subtle horizontal gleam across top edge */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: "100%", height: 1,
          background: `linear-gradient(90deg, ${c.topLine} 0%, rgba(255,255,255,0.04) 40%, transparent 100%)`,
          pointerEvents: "none",
        }}
      />

      {/* Header: zone name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          position: "relative",
        }}
      >
        {/* Hexagon/zone icon with color fill */}
        <svg width={10} height={10} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <polygon
            points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"
            fill={c.accent}
            opacity={0.9}
          />
        </svg>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 9.5,
            fontWeight: 800,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: c.accent,
            textShadow: `0 0 8px ${c.accent}44`,
          }}
        >
          {stat.title}
        </span>

        {/* Live pulse dot when people are inside */}
        {stat.occupancy_now > 0 && (
          <span
            style={{
              marginLeft: "auto",
              width: 5, height: 5,
              borderRadius: "50%",
              background: c.accent,
              boxShadow: `0 0 6px ${c.accent}`,
              animation: "pulse 2.2s infinite",
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {/* Separator */}
      <div
        style={{
          height: 1,
          background: `linear-gradient(90deg, ${c.glow} 0%, rgba(255,255,255,0.04) 50%, transparent 100%)`,
          margin: "-2px 0",
          position: "relative",
        }}
      />

      {/* Metrics grid: 2×2 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "10px 14px",
          position: "relative",
        }}
      >
        <MetricCell
          icon={
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          }
          label="Entradas"
          value={stat.entries}
          color="var(--green)"
        />
        <MetricCell
          icon={
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <polyline points="19 12 12 19 5 12" />
            </svg>
          }
          label="Saídas"
          value={stat.exits}
          color="var(--red)"
        />
        <MetricCell
          icon={
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
          label="Dentro"
          value={stat.occupancy_now}
          color={c.accentVar}
        />
        <MetricCell
          icon={
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
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
}

export function PolygonMetricsStrip({ polygonStats, orientation = "horizontal" }: Props) {
  if (!polygonStats || polygonStats.length === 0) return null;

  const isVertical = orientation === "vertical";

  return (
    <div
      style={{
        padding: isVertical ? "12px 10px" : "10px 16px",
        borderTop: isVertical ? "none" : "1px solid var(--border)",
        background: isVertical ? "transparent" : "linear-gradient(180deg, rgba(14,14,22,0.98) 0%, var(--bg-surface) 100%)",
        display: "flex",
        flexDirection: isVertical ? "column" : "row",
        gap: isVertical ? 4 : 10,
        flexWrap: isVertical ? "nowrap" : "wrap",
        alignItems: "stretch",
        flex: isVertical ? 1 : undefined,
        minHeight: 0,
        overflowY: isVertical ? "auto" : undefined,
      }}
    >
      {/* Section label */}
      {isVertical && (
        <div
          style={{
            paddingBottom: 8,
            borderBottom: "1px solid var(--border)",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth={2}>
            <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
          </svg>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            Polígonos ativos
          </span>
        </div>
      )}

      {/* Cards */}
      <div
        style={{
          display: "flex",
          flexDirection: isVertical ? "column" : "row",
          gap: isVertical ? 8 : 10,
          flex: 1,
          flexWrap: isVertical ? "nowrap" : "wrap",
          minHeight: 0,
          // Push cards slightly away from the container walls (floating effect)
          padding: isVertical ? "2px 2px 4px" : undefined,
        }}
      >
        {polygonStats.map((stat, i) => (
          <ElevatedCard
            key={stat.title}
            stat={stat}
            colorKey={POLY_COLORS[i % POLY_COLORS.length]}
          />
        ))}
      </div>
    </div>
  );
}
