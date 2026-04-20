import { useEffect, useRef } from "react";
import type { HeatmapPayload } from "../types/api";

// Paleta Inferno (8 stops, preto→roxo→laranja→amarelo)
const INFERNO: [number, number, number][] = [
  [0,   0,   4  ],
  [40,  11,  84 ],
  [101, 21,  110],
  [159, 42,  99 ],
  [212, 72,  66 ],
  [245, 125, 21 ],
  [250, 193, 39 ],
  [252, 255, 164],
];

function infernoRgb(t: number): [number, number, number] {
  const scaled = Math.max(0, Math.min(1, t)) * (INFERNO.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  if (i >= INFERNO.length - 1) return INFERNO[INFERNO.length - 1];
  const [r1, g1, b1] = INFERNO[i];
  const [r2, g2, b2] = INFERNO[i + 1];
  return [
    Math.round(r1 + f * (r2 - r1)),
    Math.round(g1 + f * (g2 - g1)),
    Math.round(b1 + f * (b2 - b1)),
  ];
}

interface Props {
  payload: HeatmapPayload | null;
  opacity: number;
}

export function HeatmapCanvas({ payload, opacity }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!payload || payload.cells.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const { grid_w, grid_h, cells } = payload;
    // canvas interno: 2 px por célula → 64×36 para grid 32×18
    const cw = canvas.width;
    const ch = canvas.height;
    const cellW = cw / grid_w;
    const cellH = ch / grid_h;

    ctx.clearRect(0, 0, cw, ch);

    for (let row = 0; row < grid_h; row++) {
      const rowData = cells[row];
      if (!rowData) continue;
      for (let col = 0; col < grid_w; col++) {
        const val = rowData[col] ?? 0;
        if (val < 0.005) continue;
        const [r, g, b] = infernoRgb(val);
        ctx.fillStyle = `rgba(${r},${g},${b},${val.toFixed(3)})`;
        ctx.fillRect(
          Math.floor(col * cellW),
          Math.floor(row * cellH),
          Math.ceil(cellW) + 1,
          Math.ceil(cellH) + 1,
        );
      }
    }
  }, [payload]);

  if (!payload || payload.cells.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      // Resolução interna: 2× o grid → blur CSS suaviza as bordas
      width={64}
      height={36}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity,
        filter: "blur(18px)",
        pointerEvents: "none",
        zIndex: 3,
        mixBlendMode: "screen",
        imageRendering: "pixelated",
      }}
    />
  );
}
