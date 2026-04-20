import { useEffect, useRef } from "react";

interface Props {
  cells: number[][];    // valores em [-1, +1] (diff) ou [0, +1] (anomalia)
  grid_w: number;
  grid_h: number;
  mode: "diff" | "anomaly";
  opacity?: number;
}

/** Converte valor diff [-1,+1] → RGBA string.
 *  Negativo = azul (menos que baseline), positivo = âmbar/vermelho (mais). */
function diffRgba(t: number): string {
  const abs = Math.abs(t);
  if (abs < 0.06) return "rgba(0,0,0,0)";
  if (t < 0) {
    const s = Math.min(1, abs);
    return `rgba(${Math.round(40 + 60 * (1 - s))},${Math.round(80 + 80 * (1 - s))},${Math.round(200 + 55 * (1 - s))},${(0.25 + 0.75 * s).toFixed(2)})`;
  }
  const s = Math.min(1, t);
  return `rgba(${Math.round(200 + 55 * s)},${Math.round(160 - 160 * s)},${Math.round(20 - 20 * s)},${(0.25 + 0.75 * s).toFixed(2)})`;
}

/** Converte z-score normalizado [0,+1] → RGBA string. */
function anomalyRgba(t: number): string {
  if (t < 0.15) return "rgba(0,0,0,0)";
  const s = Math.min(1, t);
  const r = Math.round(220 + 35 * s);
  const g = Math.round(100 - 100 * s);
  return `rgba(${r},${g},0,${(0.3 + 0.7 * s).toFixed(2)})`;
}

export function HeatmapDiffCanvas({ cells, grid_w, grid_h, mode, opacity = 0.9 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const cellW = cw / grid_w;
    const cellH = ch / grid_h;

    ctx.clearRect(0, 0, cw, ch);

    const colorFn = mode === "diff" ? diffRgba : anomalyRgba;

    for (let row = 0; row < grid_h; row++) {
      const rowData = cells[row];
      if (!rowData) continue;
      for (let col = 0; col < grid_w; col++) {
        const val = rowData[col] ?? 0;
        ctx.fillStyle = colorFn(val);
        ctx.fillRect(
          Math.floor(col * cellW),
          Math.floor(row * cellH),
          Math.ceil(cellW) + 1,
          Math.ceil(cellH) + 1,
        );
      }
    }
  }, [cells, grid_w, grid_h, mode]);

  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={36}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity,
        filter: "blur(14px)",
        pointerEvents: "none",
        zIndex: 3,
        mixBlendMode: "screen",
        imageRendering: "pixelated",
      }}
    />
  );
}
