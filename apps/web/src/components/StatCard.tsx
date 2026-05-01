import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Tooltip, InfoIcon } from "./Tooltip";

interface Props {
  label: string;
  value: number;
  icon: ReactNode;
  color: string;
  colorDim: string;
  suffix?: string;
  decimals?: number;
  subtitle?: string;
  /** "card" = analytics grid card (default), "counter" = ops sidebar counter */
  variant?: "card" | "counter";
  /** Tooltip text shown on ⓘ hover next to the label */
  tooltip?: string;
}

export function StatCard({
  label,
  value,
  icon,
  color,
  colorDim,
  suffix = "",
  decimals = 0,
  subtitle,
  variant = "card",
  tooltip,
}: Props) {
  const prevRef = useRef(value);
  const numRef  = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (prevRef.current !== value && numRef.current) {
      numRef.current.classList.remove("count-anim");
      void numRef.current.offsetWidth;
      numRef.current.classList.add("count-anim");
    }
    prevRef.current = value;
  }, [value]);

  const display =
    decimals > 0 ? value.toFixed(decimals) : value.toLocaleString("pt-BR");

  /* ── Counter variant (KPI sidebar) ───────────────────────────── */
  if (variant === "counter") {
    return (
      <div
        style={{
          flex: 1,
          padding: "14px 18px 14px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          position: "relative",
          overflow: "hidden",
          transition: "background 0.18s",
          minHeight: 86,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
        }}
      >
        {/* Left accent bar — full height, sharp */}
        <div style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: `linear-gradient(180deg, ${color}00 0%, ${color} 25%, ${color} 75%, ${color}00 100%)`,
        }} />

        {/* Label row */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginLeft: 8 }}>
          <span style={{ color, opacity: 0.80, display: "flex", alignItems: "center" }}>
            {icon}
          </span>
          <span style={{
            fontFamily: "var(--font-display)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}>
            {label}
          </span>
          {tooltip && (
            <Tooltip text={tooltip} align="left">
              <span style={{ color: "var(--text-muted)", opacity: 0.45, display: "flex", alignItems: "center" }}>
                <InfoIcon size={10} />
              </span>
            </Tooltip>
          )}
        </div>

        {/* Value */}
        <div style={{ marginLeft: 8, display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            ref={numRef}
            className="mono count-anim"
            style={{
              fontSize: 36,
              fontWeight: 600,
              color,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              textShadow: `0 0 24px ${color}3A`,
            }}
          >
            {display}
          </span>
          {suffix && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {suffix}
            </span>
          )}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div style={{
            marginLeft: 8,
            fontSize: 10,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.02em",
          }}>
            {subtitle}
          </div>
        )}

        {/* Background radial glow (right side) */}
        <div style={{
          position: "absolute",
          right: -16,
          top: "50%",
          transform: "translateY(-50%)",
          width: 88,
          height: 88,
          background: `radial-gradient(circle, ${color}10 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />
      </div>
    );
  }

  /* ── Card variant (analytics grid) ─────────────────────────── */
  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        borderLeft: `2px solid ${color}`,
        background: `linear-gradient(135deg, var(--bg-surface) 55%, ${colorDim})`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Label + icon row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{
          fontFamily: "var(--font-display)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}>
          {label}
        </span>
        <span style={{
          background: colorDim,
          border: `1px solid ${color}20`,
          borderRadius: "var(--radius)",
          width: 32,
          height: 32,
          display: "grid",
          placeItems: "center",
          color,
        }}>
          {icon}
        </span>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span
            ref={numRef}
            className="mono count-anim"
            style={{
              fontSize: 32,
              fontWeight: 600,
              color,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              textShadow: `0 0 20px ${color}30`,
            }}
          >
            {display}
          </span>
          {suffix && (
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              {suffix}
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{
            fontSize: 10,
            color: "var(--text-muted)",
            marginTop: 4,
            fontFamily: "var(--font-mono)",
          }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
