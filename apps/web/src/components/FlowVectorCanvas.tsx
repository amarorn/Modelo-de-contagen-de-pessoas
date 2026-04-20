import { useEffect, useRef } from "react";
import type { FlowVectorsPayload } from "../types/api";

interface Props {
  payload: FlowVectorsPayload;
  opacity?: number;
}

export function FlowVectorCanvas({ payload, opacity = 0.85 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { grid_w, grid_h, vectors } = payload;
    const W = canvas.width;
    const H = canvas.height;
    const cellW = W / grid_w;
    const cellH = H / grid_h;

    ctx.clearRect(0, 0, W, H);

    for (const v of vectors) {
      const cx = (v.c + 0.5) * cellW;
      const cy = (v.r + 0.5) * cellH;
      const len = Math.min(cellW, cellH) * 0.42 * v.mag;

      const ex = cx + v.vx * len;
      const ey = cy + v.vy * len;

      // Color: cyan → amber based on magnitude
      const r = Math.round(61 + (245 - 61) * v.mag);
      const g = Math.round(170 + (158 - 170) * v.mag);
      const b = Math.round(200 + (11 - 200) * v.mag);
      const alpha = 0.4 + 0.6 * v.mag;
      ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.lineWidth = 1 + v.mag * 1.5;
      ctx.lineCap = "round";

      // Shaft
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // Arrowhead
      if (len > 3) {
        const angle = Math.atan2(v.vy, v.vx);
        const headLen = Math.max(3, len * 0.35);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle - 0.45),
          ey - headLen * Math.sin(angle - 0.45),
        );
        ctx.moveTo(ex, ey);
        ctx.lineTo(
          ex - headLen * Math.cos(angle + 0.45),
          ey - headLen * Math.sin(angle + 0.45),
        );
        ctx.stroke();
      }
    }
  }, [payload]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={180}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity,
        mixBlendMode: "screen",
      }}
    />
  );
}
