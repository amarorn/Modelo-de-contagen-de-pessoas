import type { ReactNode } from "react";

interface Props {
  text: string;
  children: ReactNode;
  width?: number;
  /** Align tooltip relative to trigger: "center" (default) | "left" | "right" */
  align?: "center" | "left" | "right";
}

export function Tooltip({ text, children, width = 220, align = "center" }: Props) {
  const alignStyle =
    align === "left"
      ? { left: 0, transform: "none" }
      : align === "right"
      ? { right: 0, left: "auto", transform: "none" }
      : { left: "50%", transform: "translateX(-50%)" };

  return (
    <span className="tooltip-wrap">
      {children}
      <span className="tooltip-box" style={{ width, ...alignStyle }}>
        {text}
      </span>
    </span>
  );
}

export function InfoIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="7" stroke={color} strokeWidth="1.5" />
      <path d="M8 7.5v4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.8" fill={color} />
    </svg>
  );
}

export function WarnIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
    >
      <path
        d="M8 2L14.5 13H1.5L8 2Z"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.7" fill={color} />
    </svg>
  );
}
