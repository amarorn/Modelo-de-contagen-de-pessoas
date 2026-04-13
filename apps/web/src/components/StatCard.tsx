import { useEffect, useRef } from "react";

interface Props {
  label: string;
  value: number;
  icon: string;
  color: string;
  colorDim: string;
  suffix?: string;
  decimals?: number;
  subtitle?: string;
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
}: Props) {
  const prevRef = useRef(value);
  const numRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (prevRef.current !== value && numRef.current) {
      numRef.current.classList.remove("count-anim");
      void numRef.current.offsetWidth; // reflow
      numRef.current.classList.add("count-anim");
    }
    prevRef.current = value;
  }, [value]);

  const display =
    decimals > 0 ? value.toFixed(decimals) : value.toLocaleString("pt-BR");

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        borderLeft: `3px solid ${color}`,
        background: `linear-gradient(135deg, var(--bg-surface) 60%, ${colorDim})`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 500 }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 22,
            background: colorDim,
            borderRadius: 8,
            width: 40,
            height: 40,
            display: "grid",
            placeItems: "center",
          }}
        >
          {icon}
        </span>
      </div>
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 4,
          }}
        >
          <span
            ref={numRef}
            className="mono count-anim"
            style={{
              fontSize: 36,
              fontWeight: 800,
              color,
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {display}
          </span>
          {suffix && (
            <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
              {suffix}
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
