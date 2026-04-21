/**
 * RoiEditor v3 — linha/polígono com pontos arrastáveis, modal maior, linha mais transparente.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ApiConfig, CountPolygonSpec, FlowVectorsPayload } from "../types/api";
import {
  IconRuler, IconPolygon, IconX, IconCheck,
  IconRotateCcw, IconTrash, IconAlertTriangle, IconPencil, IconArrowsUpDown,
} from "./Icons";
import { SuggestLineButton, SuggestZonesButton } from "./SuggestButton";

interface Props {
  apiBase: string;
  config: ApiConfig | null;
  onClose: () => void;
  onApplied: () => void;
}

type DrawMode = "line" | "polygon";
type Point = { x: number; y: number };
type PolygonRing = { title: string; points: Point[]; inverted?: boolean };

function polygonRingsFromConfig(config: ApiConfig): PolygonRing[] {
  const polys = config.polygons;
  if (polys && polys.length > 0) {
    const p0 = polys[0] as unknown;
    if (
      p0 &&
      typeof p0 === "object" &&
      "points" in p0 &&
      Array.isArray((p0 as { points: unknown }).points)
    ) {
      return (polys as CountPolygonSpec[]).map((spec, i) => ({
        title:
          (typeof spec.title === "string" && spec.title.trim()) || `Área ${i + 1}`,
        points: spec.points.map((p) => ({ x: p.x, y: p.y })),
        inverted: spec.inverted ?? false,
      }));
    }
    return (polys as unknown as { x: number; y: number }[][]).map((ring, i) => ({
      title: `Área ${i + 1}`,
      points: ring.map((p) => ({ x: p.x, y: p.y })),
    }));
  }
  if (config.polygon && config.polygon.length >= 3) {
    return [
      {
        title: "Área 1",
        points: config.polygon.map((p) => ({ x: p.x, y: p.y })),
      },
    ];
  }
  return [];
}

const CYAN  = "#00D4FF";
const AMBER = "#F59E0B";
const GREEN = "#10B981";
const HIT_RADIUS = 14; // px — raio de detecção de ponto para arrastar

export function RoiEditor({ apiBase, config, onClose, onApplied }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);
  const cursorRef    = useRef<{ cx: number; cy: number } | null>(null);

  // Drag state — ref para não causar re-renders durante drag
  const dragRef = useRef<{
    active: boolean;
    mode: DrawMode;
    index: number;
    /** Poligono: -1 = rascunho (polyDraft), >=0 indice em polyRings */
    ring: number;
    point: Point;
    didMove: boolean;
  } | null>(null);

  // Ponto hovado (índice) — ref para feedback visual imediato
  const hoveredPtRef = useRef<number | null>(null);

  const [mode, setMode]             = useState<DrawMode>(config?.mode ?? "line");
  const [linePoints, setLinePoints] = useState<Point[]>([]);
  /** Poligonos fechados em edicao; o rascunho actual e polyDraft (pontos do proximo poligono). */
  const [polyRings, setPolyRings]   = useState<PolygonRing[]>([]);
  const [polyDraft, setPolyDraft]   = useState<Point[]>([]);
  const [imgSize, setImgSize]       = useState({ w: 1, h: 1 });
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null);
  const [coords, setCoords]         = useState<Point | null>(null);
  // Guia de chao: rastro dos pes das pessoas detectadas (ajuda a desenhar
  // poligonos exatamente onde as pessoas pisam).
  const [showFeetGuide, setShowFeetGuide] = useState(false);
  const [feetNow, setFeetNow]       = useState<Point[]>([]);
  const [feetTrail, setFeetTrail]   = useState<Point[]>([]);
  const [optimizingRingIdx, setOptimizingRingIdx] = useState<number | null>(null);

  const snapSrc = `${apiBase}/video_feed`;

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  useEffect(() => {
    if (!config) return;
    setMode(config.mode ?? "line");
    if (config.line) {
      setLinePoints([
        { x: config.line.x1, y: config.line.y1 },
        { x: config.line.x2, y: config.line.y2 },
      ]);
    }
    setPolyRings(polygonRingsFromConfig(config));
    setPolyDraft([]);
  }, [config]);

  useEffect(() => {
    if (!showFeetGuide) {
      setFeetNow([]);
      setFeetTrail([]);
      return;
    }
    let cancelled = false;
    const fetchFeet = async () => {
      try {
        const r = await fetch(`${apiBase}/api/live/feet`, { cache: "no-store" });
        if (!r.ok) return;
        const js = (await r.json()) as {
          feet: Point[];
          trail: Point[];
        };
        if (cancelled) return;
        setFeetNow(Array.isArray(js.feet) ? js.feet : []);
        setFeetTrail(Array.isArray(js.trail) ? js.trail : []);
      } catch { /* silencioso */ }
    };
    fetchFeet();
    const id = window.setInterval(fetchFeet, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [showFeetGuide, apiBase]);

  /* ── Coordinate conversion ──────────────────────────── */
  // Retângulo real da imagem dentro do canvas, considerando object-fit: contain
  // (a imagem é letterboxed, não preenche o container inteiro).
  const getImageRect = useCallback(
    (rectW: number, rectH: number) => {
      const iw = Math.max(1, imgSize.w);
      const ih = Math.max(1, imgSize.h);
      const containerAspect = rectW / rectH;
      const imageAspect = iw / ih;
      let dispW: number, dispH: number, offX: number, offY: number;
      if (imageAspect > containerAspect) {
        dispW = rectW;
        dispH = rectW / imageAspect;
        offX = 0;
        offY = (rectH - dispH) / 2;
      } else {
        dispH = rectH;
        dispW = rectH * imageAspect;
        offX = (rectW - dispW) / 2;
        offY = 0;
      }
      return { dispW, dispH, offX, offY };
    },
    [imgSize],
  );

  const toFrameCoords = useCallback(
    (cx: number, cy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: cx, y: cy };
      const rect = canvas.getBoundingClientRect();
      const { dispW, dispH, offX, offY } = getImageRect(rect.width, rect.height);
      const nx = (cx - offX) / Math.max(1, dispW);
      const ny = (cy - offY) / Math.max(1, dispH);
      const clampedX = Math.min(1, Math.max(0, nx));
      const clampedY = Math.min(1, Math.max(0, ny));
      return {
        x: Math.round(clampedX * imgSize.w),
        y: Math.round(clampedY * imgSize.h),
      };
    },
    [imgSize, getImageRect],
  );

  const toCanvasCoords = useCallback(
    (fx: number, fy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: fx, y: fy };
      const rect = canvas.getBoundingClientRect();
      const { dispW, dispH, offX, offY } = getImageRect(rect.width, rect.height);
      return {
        x: (fx / Math.max(1, imgSize.w)) * dispW + offX,
        y: (fy / Math.max(1, imgSize.h)) * dispH + offY,
      };
    },
    [imgSize, getImageRect],
  );

  /* ── Draw canvas ────────────────────────────────────── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cursor  = cursorRef.current;
    const drag    = dragRef.current;
    const hovered = hoveredPtRef.current;

    // Guia de chao: rastro e pes atuais (desenhado por baixo das formas).
    if (showFeetGuide && (feetTrail.length > 0 || feetNow.length > 0)) {
      ctx.save();
      for (const p of feetTrail) {
        const c = toCanvasCoords(p.x, p.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(16,185,129,0.28)";
        ctx.fill();
      }
      for (const p of feetNow) {
        const c = toCanvasCoords(p.x, p.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = GREEN;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 9, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(16,185,129,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Pontos efectivos (incluindo override de drag)
    const effLine = drag?.active && drag.mode === "line"
      ? linePoints.map((p, i) => i === drag.index ? drag.point : p)
      : linePoints;
    const effDraft = drag?.active && drag.mode === "polygon" && drag.ring === -1
      ? polyDraft.map((p, i) => (i === drag.index ? drag.point : p))
      : polyDraft;
    const effRings = polyRings.map((pr, ri) => ({
      title: pr.title,
      points:
        drag?.active && drag.mode === "polygon" && drag.ring === ri
          ? pr.points.map((p, i) => (i === drag.index ? drag.point : p))
          : pr.points,
    }));

    /* -- LINE MODE -- */
    if (mode === "line") {
      const pts = effLine.map((p) => toCanvasCoords(p.x, p.y));

      // Ghost preview from last point to cursor
      if (pts.length === 1 && cursor && !drag?.active) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,212,255,0.14)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(cursor.cx, cursor.cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      if (pts.length >= 1) {
        ctx.save();
        if (pts[0] && pts[1]) {
          // Outer glow — mais transparente
          ctx.strokeStyle = "rgba(0,212,255,0.08)";
          ctx.lineWidth = 10;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();
          // Inner glow
          ctx.strokeStyle = "rgba(0,212,255,0.20)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();
          // Bright line semi-transparent
          ctx.strokeStyle = "rgba(0,212,255,0.60)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[1].x, pts[1].y);
          ctx.stroke();

          // Comprimento e ângulo
          const dx = pts[1].x - pts[0].x;
          const dy = pts[1].y - pts[0].y;
          const angleRad = Math.atan2(dy, dx);
          const angleDeg = ((angleRad * 180) / Math.PI + 360) % 360;
          const mx = (pts[0].x + pts[1].x) / 2;
          const my = (pts[0].y + pts[1].y) / 2;
          ctx.save();
          ctx.fillStyle = "rgba(0,212,255,0.70)";
          ctx.font = "bold 9px monospace";
          ctx.fillText(`${Math.round(angleDeg)}°`, mx + 6, my - 6);
          ctx.restore();
        }
        // Endpoint markers
        const labels = ["A", "B"];
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const isHovered = hovered === i;
          const isDragging = drag?.active && drag.mode === "line" && drag.index === i;

          // Outer ring — maior e mais brilhante se hovado/arrastando
          ctx.beginPath();
          ctx.arc(p.x, p.y, isHovered || isDragging ? 16 : 11, 0, Math.PI * 2);
          ctx.strokeStyle = isDragging
            ? "rgba(0,212,255,0.55)"
            : isHovered
            ? "rgba(0,212,255,0.40)"
            : "rgba(0,212,255,0.14)";
          ctx.lineWidth = isDragging ? 1.5 : 1;
          ctx.stroke();

          // Ponto central
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = isHovered || isDragging ? CYAN : "rgba(0,212,255,0.70)";
          ctx.fill();
          ctx.fillStyle = isHovered || isDragging ? CYAN : "rgba(0,212,255,0.70)";
          ctx.font = "bold 9px monospace";
          ctx.fillText(labels[i] ?? "", p.x + 10, p.y - 8);

          // Ícone de arrastar quando hovado
          if (isHovered && !drag?.active) {
            ctx.save();
            ctx.strokeStyle = "rgba(0,212,255,0.55)";
            ctx.lineWidth = 1;
            const r = 5;
            // Cruz de movimento
            for (const [ax, ay, bx, by] of [
              [p.x, p.y - r - 3, p.x, p.y + r + 3],
              [p.x - r - 3, p.y, p.x + r + 3, p.y],
            ] as [number, number, number, number][]) {
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
            }
            ctx.restore();
          }
        }
        ctx.restore();
      }
    }

    /* -- POLYGON MODE (varios poligonos + rascunho) -- */
    if (mode === "polygon") {
      const drawRing = (
        ring: Point[],
        colorIdx: number,
        closed: boolean,
        hoverBase: number,
        dragRing: number,
        ringTitle?: string,
      ) => {
        if (ring.length === 0) return;
        const pts = ring.map((p) => toCanvasCoords(p.x, p.y));
        const stroke = colorIdx % 2 === 0 ? AMBER : CYAN;
        const glow = colorIdx % 2 === 0 ? "rgba(245,158,11,0.18)" : "rgba(0,212,255,0.16)";
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        if (closed && ring.length >= 3) ctx.closePath();
        ctx.strokeStyle = glow;
        ctx.lineWidth = 7;
        ctx.lineJoin = "round";
        ctx.setLineDash(!closed && ring.length < 3 ? [6, 4] : []);
        ctx.stroke();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        if (closed && ring.length >= 3) {
          ctx.fillStyle = colorIdx % 2 === 0 ? "rgba(245,158,11,0.07)" : "rgba(0,212,255,0.06)";
          ctx.fill();
        }
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const hid = hoverBase + i;
          const isHovered = hovered === hid;
          const isDragging =
            drag?.active && drag.mode === "polygon" && drag.ring === dragRing && drag.index === i;
          const isFirst = i === 0;
          const color = isFirst ? GREEN : stroke;
          ctx.beginPath();
          ctx.arc(p.x, p.y, isHovered || isDragging ? 14 : 10, 0, Math.PI * 2);
          ctx.strokeStyle = isDragging || isHovered ? stroke : `${stroke}33`;
          ctx.lineWidth = isDragging ? 1.5 : 1;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.fillStyle = "#fff";
          ctx.font = "bold 9px monospace";
          ctx.fillText(`${colorIdx + 1}.${i + 1}`, p.x + 10, p.y - 8);
        }
        if (closed && ring.length >= 3 && ringTitle) {
          const cfx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
          const cfy = ring.reduce((s, p) => s + p.y, 0) / ring.length;
          const c = toCanvasCoords(cfx, cfy);
          const label = ringTitle.slice(0, 28);
          ctx.save();
          ctx.font = "bold 11px var(--font-display), ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.strokeStyle = "rgba(0,0,0,0.82)";
          ctx.lineWidth = 4;
          ctx.strokeText(label, c.x, c.y);
          ctx.fillStyle = stroke;
          ctx.fillText(label, c.x, c.y);
          ctx.restore();
        }
        ctx.restore();
      };

      effRings.forEach((pr, ri) =>
        drawRing(pr.points, ri, true, ri * 10_000, ri, pr.title),
      );

      if (effDraft.length > 0) {
        if (cursor && !drag?.active) {
          const pts = effDraft.map((p) => toCanvasCoords(p.x, p.y));
          const last = pts[pts.length - 1];
          ctx.save();
          // Glow externo para destaque sobre fundo claro/escuro
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = 4;
          ctx.setLineDash([7, 5]);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(cursor.cx, cursor.cy);
          ctx.stroke();
          // Linha tracejada brilhante do último ponto ao cursor
          ctx.strokeStyle = "rgba(245,158,11,0.95)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(cursor.cx, cursor.cy);
          ctx.stroke();
          // Linha tracejada do cursor ao primeiro ponto (preview de fechamento)
          if (effDraft.length >= 3) {
            ctx.strokeStyle = "rgba(0,0,0,0.45)";
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 6]);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(cursor.cx, cursor.cy);
            ctx.stroke();
            ctx.strokeStyle = "rgba(245,158,11,0.60)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(cursor.cx, cursor.cy);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.restore();
        }
        drawRing(effDraft, effRings.length, false, 900_000, -1);
      }
    }

    /* -- CURSOR CROSSHAIR -- */
    if (cursor) {
      const isOverPt = hovered !== null;
      ctx.save();
      if (!isOverPt) {
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(0, cursor.cy);
        ctx.lineTo(canvas.width, cursor.cy);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cursor.cx, 0);
        ctx.lineTo(cursor.cx, canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(cursor.cx, cursor.cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
      } else {
        // Cursor especial sobre ponto arrastável
        ctx.strokeStyle = "rgba(255,255,255,0.45)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cursor.cx, cursor.cy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [mode, linePoints, polyRings, polyDraft, toCanvasCoords, showFeetGuide, feetNow, feetTrail]);

  useEffect(() => { draw(); }, [draw]);

  /* ── Resize canvas ──────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const obs = new ResizeObserver(() => {
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    });
    obs.observe(container);
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => obs.disconnect();
  }, [draw]);

  /* ── Helpers ────────────────────────────────────────── */
  const findNearestPoint = useCallback(
    (cx: number, cy: number): number | null => {
      if (mode === "line") {
        for (let i = linePoints.length - 1; i >= 0; i--) {
          const cp = toCanvasCoords(linePoints[i].x, linePoints[i].y);
          if (Math.hypot(cx - cp.x, cy - cp.y) <= HIT_RADIUS) return i;
        }
        return null;
      }
      for (let i = polyDraft.length - 1; i >= 0; i--) {
        const cp = toCanvasCoords(polyDraft[i].x, polyDraft[i].y);
        if (Math.hypot(cx - cp.x, cy - cp.y) <= HIT_RADIUS) return 900_000 + i;
      }
      for (let ri = polyRings.length - 1; ri >= 0; ri--) {
        const ring = polyRings[ri].points;
        for (let i = ring.length - 1; i >= 0; i--) {
          const cp = toCanvasCoords(ring[i].x, ring[i].y);
          if (Math.hypot(cx - cp.x, cy - cp.y) <= HIT_RADIUS) return ri * 10_000 + i;
        }
      }
      return null;
    },
    [mode, linePoints, polyRings, polyDraft, toCanvasCoords],
  );

  /* ── Mouse handlers ─────────────────────────────────── */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const idx = findNearestPoint(cx, cy);
      if (idx !== null) {
        if (mode === "line") {
          dragRef.current = {
            active: true,
            mode: "line",
            ring: 0,
            index: idx,
            point: { ...linePoints[idx] },
            didMove: false,
          };
        } else {
          let ring = -1;
          let ptIndex = 0;
          if (idx >= 900_000) {
            ring = -1;
            ptIndex = idx - 900_000;
          } else {
            ring = Math.floor(idx / 10_000);
            ptIndex = idx % 10_000;
          }
          const pts = ring === -1 ? polyDraft : polyRings[ring].points;
          dragRef.current = {
            active: true,
            mode: "polygon",
            ring,
            index: ptIndex,
            point: { ...pts[ptIndex] },
            didMove: false,
          };
        }
      } else {
        dragRef.current = null;
      }
    },
    [findNearestPoint, mode, linePoints, polyRings, polyDraft],
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag?.active && drag.didMove) {
        // Commit drag para state
        if (drag.mode === "line") {
          setLinePoints((prev) => {
            const copy = [...prev];
            copy[drag.index] = drag.point;
            return copy;
          });
        } else {
          if (drag.ring === -1) {
            setPolyDraft((prev) => {
              const copy = [...prev];
              copy[drag.index] = drag.point;
              return copy;
            });
          } else {
            setPolyRings((prev) =>
              prev.map((pr, i) =>
                i === drag.ring
                  ? {
                      ...pr,
                      points: pr.points.map((p, j) =>
                        j === drag.index ? drag.point : p,
                      ),
                    }
                  : pr,
              ),
            );
          }
        }
        setMsg(null);
      }
      if (drag?.active) {
        dragRef.current = { ...drag, active: false };
      }
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      cursorRef.current = { cx, cy };

      const drag = dragRef.current;
      if (drag?.active) {
        // Arrastar ponto
        drag.point = toFrameCoords(cx, cy);
        drag.didMove = true;
        canvas.style.cursor = "grabbing";
        draw();
        return;
      }

      // Detectar ponto hovado para feedback visual
      const idx = findNearestPoint(cx, cy);
      hoveredPtRef.current = idx;
      canvas.style.cursor = idx !== null ? "grab" : "none";

      setCoords(toFrameCoords(cx, cy));
      draw();
    },
    [toFrameCoords, draw, findNearestPoint],
  );

  const handleMouseLeave = useCallback(() => {
    cursorRef.current = null;
    hoveredPtRef.current = null;
    if (dragRef.current?.active) {
      // Cancelar drag se sair do canvas
      dragRef.current = { ...dragRef.current, active: false };
    }
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = "none";
    setCoords(null);
    draw();
  }, [draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Se acabámos de arrastar, não adicionar ponto
      if (dragRef.current?.didMove) {
        dragRef.current = null;
        return;
      }
      dragRef.current = null;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect  = canvas.getBoundingClientRect();
      const frame = toFrameCoords(e.clientX - rect.left, e.clientY - rect.top);

      // Não adicionar se clicamos perto de um ponto existente (era para arrastar)
      const idx = findNearestPoint(e.clientX - rect.left, e.clientY - rect.top);
      if (idx !== null) return;

      if (mode === "line") {
        setLinePoints((prev) => {
          if (prev.length === 0) return [frame];
          if (prev.length === 1) return [prev[0], frame];
          return [frame];
        });
      } else {
        setPolyDraft((prev) => [...prev, frame]);
      }
    },
    [mode, toFrameCoords, findNearestPoint],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === "polygon") {
        e.preventDefault();
        setPolyDraft((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      }
    },
    [mode],
  );

  /* ── Actions ────────────────────────────────────────── */
  const resetPoints = useCallback(() => {
    setLinePoints([]);
    setPolyRings([]);
    setPolyDraft([]);
    setMsg(null);
  }, []);

  const undoLast = useCallback(() => {
    if (mode === "line") setLinePoints((p) => p.slice(0, -1));
    else setPolyDraft((d) => (d.length > 0 ? d.slice(0, -1) : d));
    setMsg(null);
  }, [mode]);

  const commitNewRing = useCallback(() => {
    if (polyDraft.length < 3) {
      setMsg({ text: "Rascunho: mínimo 3 vértices para fechar este polígono.", ok: false });
      return;
    }
    setPolyRings((rings) => [
      ...rings,
      {
        title: `Área ${rings.length + 1}`,
        points: polyDraft.map((p) => ({ ...p })),
      },
    ]);
    setPolyDraft([]);
    setMsg(null);
  }, [polyDraft]);

  const deleteRing = useCallback((ringIdx: number) => {
    setPolyRings((rings) => rings.filter((_, i) => i !== ringIdx));
    setMsg(null);
  }, []);

  // Reabre um polígono fechado para edição: move seus vértices para o rascunho.
  // Se já houver um rascunho: fecha-o antes se valido (>=3 pts) ou descarta se incompleto.
  const editRing = useCallback((ringIdx: number) => {
    setPolyRings((rings) => {
      const target = rings[ringIdx];
      if (!target) return rings;
      const draftSnapshot = polyDraft;
      const next = rings.filter((_, i) => i !== ringIdx);
      if (draftSnapshot.length >= 3) {
        next.push({
          title: `Área ${next.length + 1}`,
          points: draftSnapshot.map((p) => ({ ...p })),
        });
      }
      setPolyDraft(target.points.map((p) => ({ ...p })));
      return next;
    });
    setMsg({ text: "Polígono movido para o rascunho · edite os vértices no canvas.", ok: true });
  }, [polyDraft]);

  const optimizeRingForPassage = useCallback(async (ringIdx: number) => {
    const ring = polyRings[ringIdx];
    if (!ring || ring.points.length < 3) return;
    setOptimizingRingIdx(ringIdx);
    try {
      const cx = ring.points.reduce((s, p) => s + p.x, 0) / ring.points.length;
      const cy = ring.points.reduce((s, p) => s + p.y, 0) / ring.points.length;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of ring.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      const bboxW = Math.max(1, maxX - minX);
      const bboxH = Math.max(1, maxY - minY);
      let flowVx = 0, flowVy = 0, hasFlow = false;
      try {
        const res = await fetch(`${apiBase}/api/flow/vectors`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as FlowVectorsPayload;
          if (data.vectors && data.vectors.length > 0 && data.max_mag > 0) {
            const cellW = imgSize.w / data.grid_w;
            const cellH = imgSize.h / data.grid_h;
            let totalW = 0, sumVx = 0, sumVy = 0;
            for (const v of data.vectors) {
              if (v.mag <= 0) continue;
              const dist = Math.hypot((v.c + 0.5) * cellW - cx, (v.r + 0.5) * cellH - cy);
              const w = v.mag / (1 + dist / Math.max(bboxW, bboxH));
              sumVx += v.vx * w; sumVy += v.vy * w; totalW += w;
            }
            if (totalW > 0) {
              flowVx = sumVx / totalW; flowVy = sumVy / totalW;
              const m = Math.hypot(flowVx, flowVy);
              if (m > 0.01) { flowVx /= m; flowVy /= m; hasFlow = true; }
            }
          }
        }
      } catch { /* silencioso */ }
      if (!hasFlow) {
        // Fallback: bbox orientation — longer axis = flow direction
        if (bboxW >= bboxH) { flowVx = 1; flowVy = 0; } else { flowVx = 0; flowVy = 1; }
      }
      // Strip: long perpendicular to flow, thin along flow
      const perpVx = -flowVy, perpVy = flowVx;
      const halfLen   = Math.max(bboxW, bboxH) * 0.55;
      const halfThick = Math.max(8, Math.min(30, Math.min(bboxW, bboxH) * 0.15));
      const clamp = (v: number, max: number) => Math.min(max - 1, Math.max(0, Math.round(v)));
      const W = imgSize.w, H = imgSize.h;
      const newPoints: Point[] = [
        { x: clamp(cx + perpVx * halfLen - flowVx * halfThick, W), y: clamp(cy + perpVy * halfLen - flowVy * halfThick, H) },
        { x: clamp(cx + perpVx * halfLen + flowVx * halfThick, W), y: clamp(cy + perpVy * halfLen + flowVy * halfThick, H) },
        { x: clamp(cx - perpVx * halfLen + flowVx * halfThick, W), y: clamp(cy - perpVy * halfLen + flowVy * halfThick, H) },
        { x: clamp(cx - perpVx * halfLen - flowVx * halfThick, W), y: clamp(cy - perpVy * halfLen - flowVy * halfThick, H) },
      ];
      setPolyRings((prev) => prev.map((r, i) => i === ringIdx ? { ...r, points: newPoints } : r));
      setMsg({ text: `"${ring.title}" ajustado para faixa de cruzamento${hasFlow ? " (fluxo detectado)" : " (fallback)"}`, ok: true });
    } catch (err) {
      setMsg({ text: `Erro ao otimizar: ${err}`, ok: false });
    } finally {
      setOptimizingRingIdx(null);
    }
  }, [polyRings, apiBase, imgSize]);

  const apply = useCallback(async () => {
    setSaving(true);
    setMsg(null);
    try {
      if (mode === "line") {
        if (linePoints.length < 2) {
          setMsg({ text: "Clique em 2 pontos para definir a linha.", ok: false });
          return;
        }
        const [p1, p2] = linePoints;
        const res = await fetch(`${apiBase}/api/line`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, reset_counters: true }),
        });
        if (!res.ok) throw new Error(await res.text());
        setMsg({ text: "Linha aplicada com sucesso!", ok: true });
      } else {
        const specs: CountPolygonSpec[] = polyRings.map((r, i) => ({
          title: (r.title.trim() || `Área ${i + 1}`).slice(0, 64),
          points: r.points.map((p) => ({ ...p })),
          inverted: r.inverted ?? false,
        }));
        if (polyDraft.length >= 3) {
          specs.push({
            title: `Área ${specs.length + 1}`,
            points: polyDraft.map((p) => ({ ...p })),
          });
        }
        if (!specs.some((s) => s.points.length >= 3)) {
          setMsg({
            text: "Defina pelo menos um polígono fechado (3+ vértices) no rascunho ou feche um e abra outro.",
            ok: false,
          });
          return;
        }
        const res = await fetch(`${apiBase}/api/polygon`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygons: specs, reset_counters: true }),
        });
        if (!res.ok) throw new Error(await res.text());
        await fetch(`${apiBase}/api/mode`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "polygon", reset_counters: false }),
        });
        setMsg({ text: "Polígono aplicado com sucesso!", ok: true });
      }
      onApplied();
    } catch (err) {
      setMsg({ text: `Erro: ${err}`, ok: false });
    } finally {
      setSaving(false);
    }
  }, [mode, linePoints, polyRings, polyDraft, apiBase, onApplied]);

  /* ── Keyboard shortcuts ─────────────────────────────── */
  const applyRef  = useRef(apply);
  const undoRef   = useRef(undoLast);
  const resetRef  = useRef(resetPoints);
  useEffect(() => { applyRef.current  = apply;       });
  useEffect(() => { undoRef.current   = undoLast;    });
  useEffect(() => { resetRef.current  = resetPoints; });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "z" || e.key === "Z") { undoRef.current(); return; }
      if (e.key === "c" || e.key === "C") { resetRef.current(); return; }
      if (e.key === "Enter") { void applyRef.current(); return; }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  /* ── Derived state ──────────────────────────────────── */
  const polyVertCount =
    polyRings.reduce((n, r) => n + r.points.length, 0) + polyDraft.length;
  const hasGeometry =
    mode === "line" ? linePoints.length > 0 : polyVertCount > 0;
  const canApply =
    mode === "line"
      ? linePoints.length === 2
      : polyRings.some((r) => r.points.length >= 3) || polyDraft.length >= 3;

  const accent    = mode === "line" ? "var(--cyan)"        : "var(--amber)";
  const accentDim = mode === "line" ? "var(--cyan-dim)"    : "var(--amber-dim)";
  const accentBdr = mode === "line" ? "var(--border-glow)" : "var(--border-accent)";

  const instruction = (() => {
    if (mode === "line") {
      if (linePoints.length === 0) return "Clique no frame para definir o ponto inicial (A)";
      if (linePoints.length === 1) return "Clique para definir o ponto final (B)";
      return "Linha pronta · arraste os pontos para reposicionar · pressione Aplicar";
    }
    if (polyRings.length === 0 && polyDraft.length === 0) return "Clique para o 1.º vértice do 1.º polígono";
    if (polyDraft.length > 0 && polyDraft.length < 3) {
      return `Rascunho: mais ${3 - polyDraft.length} vértice${3 - polyDraft.length !== 1 ? "s" : ""} · «Novo polígono» fecha o actual`;
    }
    return "«Novo polígono» fecha o rascunho (≥3 pts) e inicia outro · arraste vértices · duplo-clique remove último no rascunho · Aplicar";
  })();

  /* ── Render ─────────────────────────────────────────── */
  return (
    <>
      <style>{`
        @keyframes roi-in {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        @keyframes roi-row-in {
          from { opacity: 0; transform: translateX(-5px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes roi-msg-in {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes roi-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .roi-row { animation: roi-row-in 0.18s ease both; }
      `}</style>

      {/* ── Backdrop ── */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "rgba(0,0,0,0.87)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 12,
        backdropFilter: "blur(6px)",
      }}>
        {/* ── Modal — maior ── */}
        <div style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          width: "min(1320px, 96vw)",
          height: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04)",
          animation: "roi-in 0.22s ease both",
        }}>

          {/* ── Header ── */}
          <div style={{
            padding: "11px 16px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 7,
                background: accentDim,
                border: `1px solid ${accentBdr}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: accent, flexShrink: 0,
                transition: "all 0.2s",
              }}>
                {mode === "line" ? <IconRuler size={14} /> : <IconPolygon size={14} />}
              </div>
              <div>
                <div style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 13, fontWeight: 700,
                  letterSpacing: "0.07em", textTransform: "uppercase",
                  color: "var(--text-primary)", lineHeight: 1.2,
                }}>
                  Editor de ROI
                </div>
                <div style={{
                  fontSize: 11, color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)", marginTop: 2,
                }}>
                  {instruction}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {hasGeometry && (
                <div style={{
                  padding: "2px 10px",
                  background: accentDim,
                  border: `1px solid ${accentBdr}`,
                  borderRadius: 20,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10, fontWeight: 700,
                  color: accent,
                  transition: "all 0.2s",
                }}>
                  {mode === "line"
                    ? `${linePoints.length} / 2`
                    : `${polyRings.length} políg. · ${polyVertCount} vért.`}
                </div>
              )}
              <button
                onClick={onClose}
                title="Fechar (Esc)"
                style={{
                  background: "none", border: "1px solid var(--border)",
                  borderRadius: 6, color: "var(--text-muted)",
                  cursor: "pointer", padding: 5,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.borderColor = "rgba(239,68,68,0.4)";
                  b.style.color = "var(--red)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.borderColor = "var(--border)";
                  b.style.color = "var(--text-muted)";
                }}
              >
                <IconX size={14} />
              </button>
            </div>
          </div>

          {/* ── Body ── */}
          <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

            {/* ── Canvas column ── */}
            <div style={{
              flex: 1, minWidth: 0,
              display: "flex", flexDirection: "column",
              borderRight: "1px solid var(--border)",
            }}>
              {/* Mode tabs */}
              <div style={{
                display: "flex", gap: 6,
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elevated)",
                flexShrink: 0,
              }}>
                {(["line", "polygon"] as DrawMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setMode(m); resetPoints(); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 13px",
                      borderRadius: 6,
                      border: "1px solid",
                      borderColor: mode === m
                        ? (m === "line" ? "var(--border-glow)" : "var(--border-accent)")
                        : "var(--border)",
                      background: mode === m
                        ? (m === "line" ? "var(--cyan-dim)" : "var(--amber-dim)")
                        : "transparent",
                      color: mode === m
                        ? (m === "line" ? "var(--cyan)" : "var(--amber)")
                        : "var(--text-muted)",
                      fontFamily: "var(--font-display)",
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {m === "line" ? <IconRuler size={11}/> : <IconPolygon size={11}/>}
                    {m === "line" ? "Linha" : "Polígono"}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => setShowFeetGuide((v) => !v)}
                  title="Mostra onde os pes das pessoas pisam (guia para desenhar poligonos no chao)"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 11px",
                    borderRadius: 6,
                    border: "1px solid",
                    borderColor: showFeetGuide ? "#10B981" : "var(--border)",
                    background: showFeetGuide ? "rgba(16,185,129,0.18)" : "transparent",
                    color: showFeetGuide ? "#10B981" : "var(--text-muted)",
                    fontFamily: "var(--font-display)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  {showFeetGuide ? "Pés: on" : "Mostrar pés"}
                </button>
                {mode === "line" && (
                  <SuggestLineButton
                    apiBase={apiBase}
                    frameW={imgSize.w}
                    frameH={imgSize.h}
                    onSuggested={(l) => {
                      setLinePoints([{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }]);
                    }}
                  />
                )}
                {mode === "polygon" && (
                  <>
                    <button
                      type="button"
                      onClick={() => commitNewRing()}
                      title="Fecha o rascunho actual (≥3 pontos) e inicia outro polígono"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "5px 11px",
                        borderRadius: 6,
                        border: "1px solid var(--border-accent)",
                        background: "var(--amber-dim)",
                        color: "var(--amber)",
                        fontFamily: "var(--font-display)",
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        cursor: "pointer",
                      }}
                    >
                      Novo polígono
                    </button>
                    <SuggestZonesButton
                      apiBase={apiBase}
                      frameW={imgSize.w}
                      frameH={imgSize.h}
                      onSuggested={(zones) => {
                        if (zones.length > 0) {
                          setPolyRings(
                            zones.map((z, zi) => ({
                              title:
                                (z.label && z.label.trim()) || `Zona ${zi + 1}`,
                              points: z.polygon.map(([x, y]) => ({ x, y })),
                            })),
                          );
                          setPolyDraft([]);
                        }
                      }}
                    />
                  </>
                )}
              </div>

              {/* Canvas */}
              <div
                ref={containerRef}
                style={{
                  position: "relative",
                  flex: 1,
                  background: "#000",
                  cursor: "none",
                  overflow: "hidden",
                }}
              >
                <img
                  ref={imgRef}
                  src={snapSrc}
                  alt="frame"
                  onLoad={onImgLoad}
                  style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%",
                    objectFit: "contain",
                    opacity: 0.82,
                  }}
                />
                <canvas
                  ref={canvasRef}
                  onClick={handleClick}
                  onDoubleClick={handleDblClick}
                  onMouseMove={handleMouseMove}
                  onMouseLeave={handleMouseLeave}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />

                {/* Coordinate readout */}
                {coords && (
                  <div style={{
                    position: "absolute", bottom: 10, left: 10,
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: "rgba(255,255,255,0.55)",
                    background: "rgba(0,0,0,0.52)",
                    padding: "3px 9px", borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.07)",
                    pointerEvents: "none", letterSpacing: "0.06em",
                  }}>
                    X {String(coords.x).padStart(4, "\u2007")} · Y {String(coords.y).padStart(4, "\u2007")}
                  </div>
                )}

                {/* Drag hint */}
                {hasGeometry && (
                  <div style={{
                    position: "absolute", bottom: 10, right: 10,
                    fontFamily: "var(--font-mono)", fontSize: 9,
                    color: "rgba(255,255,255,0.30)",
                    pointerEvents: "none", letterSpacing: "0.05em",
                  }}>
                    arraste pontos para reposicionar
                  </div>
                )}

                {/* Empty state hint */}
                {(mode === "line" ? linePoints.length === 0
                  : polyDraft.length === 0 && polyRings.length === 0) && (
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    pointerEvents: "none",
                  }}>
                    <div style={{
                      padding: "9px 18px",
                      background: "rgba(0,0,0,0.55)",
                      border: `1px solid ${accentBdr}`,
                      borderRadius: 7,
                      fontFamily: "var(--font-display)",
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: "0.14em", textTransform: "uppercase",
                      color: accent, opacity: 0.7,
                    }}>
                      {mode === "line" ? "Clique para iniciar a linha" : "Clique para adicionar vértices"}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Sidebar ── */}
            <div style={{
              width: 236, flexShrink: 0,
              display: "flex", flexDirection: "column",
              background: "var(--bg-elevated)",
              overflow: "hidden",
            }}>
              {/* Points list */}
              <div style={{
                flex: 1, overflowY: "auto",
                padding: "12px 10px",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                {/* Section header */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                  <span style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 9, fontWeight: 700,
                    letterSpacing: "0.18em", textTransform: "uppercase",
                    color: "var(--text-muted)",
                  }}>
                    Pontos
                  </span>
                  <span style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9, fontWeight: 700,
                    color: hasGeometry ? accent : "var(--text-muted)",
                    transition: "color 0.2s",
                  }}>
                    {mode === "line" ? linePoints.length : polyVertCount}
                    {mode === "line" ? " / 2" : ""}
                  </span>
                </div>

                {/* LINE: slots A & B */}
                {mode === "line" && (
                  <>
                    {(["A", "B"] as const).map((label, i) => {
                      const p = linePoints[i];
                      return (
                        <div
                          key={label}
                          className={p ? "roi-row" : ""}
                          style={{
                            padding: "8px 9px",
                            background: p ? "var(--bg-surface)" : "transparent",
                            border: `1px solid ${p ? "var(--border-glow)" : "var(--border)"}`,
                            borderRadius: 6,
                            display: "flex", alignItems: "center", gap: 7,
                            opacity: p ? 1 : 0.38,
                            transition: "opacity 0.2s, border-color 0.2s, background 0.2s",
                          }}
                        >
                          <span style={{
                            width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                            background: p ? "var(--cyan-dim)" : "var(--bg-elevated)",
                            border: `1px solid ${p ? "var(--border-glow)" : "var(--border)"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
                            color: p ? "var(--cyan)" : "var(--text-muted)",
                            transition: "all 0.2s",
                          }}>
                            {label}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {p ? (
                              <div style={{
                                fontFamily: "var(--font-mono)", fontSize: 10,
                                color: "var(--text-secondary)", lineHeight: 1.6,
                              }}>
                                <div>X <span style={{ color: "var(--cyan)" }}>{p.x}</span></div>
                                <div>Y <span style={{ color: "var(--cyan)" }}>{p.y}</span></div>
                              </div>
                            ) : (
                              <div style={{
                                fontFamily: "var(--font-mono)", fontSize: 10,
                                color: "var(--text-muted)",
                              }}>
                                aguardando…
                              </div>
                            )}
                          </div>
                          {p && (
                            <button
                              onClick={() => setLinePoints((ps) => ps.filter((_, idx) => idx !== i))}
                              title="Remover ponto"
                              style={{
                                background: "none", border: "none",
                                color: "var(--text-muted)", cursor: "pointer",
                                padding: 2, borderRadius: 3, flexShrink: 0,
                                display: "flex", alignItems: "center",
                                transition: "color 0.15s",
                              }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--red)"; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                            >
                              <IconX size={10} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {/* POLYGON: rascunho actual (lista); poligonos fechados no canvas */}
                {mode === "polygon" && (
                  <>
                    <div style={{
                      fontFamily: "var(--font-mono)", fontSize: 10,
                      color: "var(--text-muted)", marginBottom: 8, lineHeight: 1.5,
                    }}>
                      {polyRings.length > 0
                        ? `${polyRings.length} área(s) fechada(s). `
                        : ""}
                      Edite o rascunho abaixo; «Novo polígono» fecha o rascunho (mín. 3 pontos).
                    </div>
                    {polyRings.map((pr, ri) => (
                      <div
                        key={`ring-title-${ri}`}
                        className="roi-row"
                        style={{
                          marginBottom: 8,
                          padding: "8px 9px",
                          background: "var(--bg-surface)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}>
                          <span style={{
                            fontFamily: "var(--font-display)",
                            fontSize: 8,
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: "var(--text-muted)",
                          }}>
                            Título · polígono {ri + 1}
                          </span>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              type="button"
                              onClick={() => editRing(ri)}
                              title="Editar vértices (move para o rascunho)"
                              style={{
                                background: "none",
                                border: "1px solid var(--border)",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                padding: 3,
                                borderRadius: 3,
                                display: "flex",
                                alignItems: "center",
                                transition: "color 0.15s, border-color 0.15s",
                              }}
                              onMouseEnter={(e) => {
                                const b = e.currentTarget as HTMLButtonElement;
                                b.style.color = "var(--amber)";
                                b.style.borderColor = "var(--border-accent)";
                              }}
                              onMouseLeave={(e) => {
                                const b = e.currentTarget as HTMLButtonElement;
                                b.style.color = "var(--text-muted)";
                                b.style.borderColor = "var(--border)";
                              }}
                            >
                              <IconPencil size={10} />
                            </button>
                            {/* Invert direction toggle */}
                            <button
                              type="button"
                              title={pr.inverted ? "Direção invertida — clique para restaurar" : "Inverter sentido de entrada/saída"}
                              onClick={() =>
                                setPolyRings((prev) =>
                                  prev.map((p, i) =>
                                    i === ri ? { ...p, inverted: !p.inverted } : p,
                                  ),
                                )
                              }
                              style={{
                                background: pr.inverted ? "rgba(0,180,216,0.15)" : "none",
                                border: `1px solid ${pr.inverted ? "var(--cyan)" : "var(--border)"}`,
                                color: pr.inverted ? "var(--cyan)" : "var(--text-muted)",
                                cursor: "pointer",
                                padding: 3,
                                borderRadius: 3,
                                display: "flex",
                                alignItems: "center",
                                transition: "color 0.15s, border-color 0.15s, background 0.15s",
                                position: "relative",
                              }}
                              onMouseEnter={(e) => {
                                if (!pr.inverted) {
                                  const b = e.currentTarget as HTMLButtonElement;
                                  b.style.color = "var(--cyan)";
                                  b.style.borderColor = "var(--cyan)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (!pr.inverted) {
                                  const b = e.currentTarget as HTMLButtonElement;
                                  b.style.color = "var(--text-muted)";
                                  b.style.borderColor = "var(--border)";
                                }
                              }}
                            >
                              <IconArrowsUpDown size={10} />
                            </button>
                            {/* Optimize for passage — reshapes to crossing strip */}
                            <button
                              type="button"
                              onClick={() => void optimizeRingForPassage(ri)}
                              disabled={optimizingRingIdx !== null}
                              title="Ajustar para faixa de cruzamento — cria uma faixa fina perpendicular ao fluxo para registrar toda passagem"
                              style={{
                                background: "none",
                                border: `1px solid ${optimizingRingIdx === ri ? "rgba(16,185,129,0.4)" : "var(--border)"}`,
                                color: optimizingRingIdx === ri ? "var(--green)" : "var(--text-muted)",
                                cursor: optimizingRingIdx !== null ? "not-allowed" : "pointer",
                                padding: 3,
                                borderRadius: 3,
                                display: "flex",
                                alignItems: "center",
                                transition: "color 0.15s, border-color 0.15s",
                                opacity: optimizingRingIdx !== null && optimizingRingIdx !== ri ? 0.4 : 1,
                              }}
                              onMouseEnter={(e) => {
                                if (optimizingRingIdx === null) {
                                  const b = e.currentTarget as HTMLButtonElement;
                                  b.style.color = "var(--green)";
                                  b.style.borderColor = "rgba(16,185,129,0.4)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (optimizingRingIdx !== ri) {
                                  const b = e.currentTarget as HTMLButtonElement;
                                  b.style.color = "var(--text-muted)";
                                  b.style.borderColor = "var(--border)";
                                }
                              }}
                            >
                              {optimizingRingIdx === ri ? (
                                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" style={{ animation: "roi-spin 0.9s linear infinite", transformOrigin: "center" }}>
                                  <path d="M12 2a10 10 0 0 1 10 10"/>
                                </svg>
                              ) : (
                                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="5 9 2 12 5 15"/>
                                  <polyline points="19 9 22 12 19 15"/>
                                  <line x1="2" y1="12" x2="22" y2="12"/>
                                  <line x1="12" y1="2" x2="12" y2="6"/>
                                  <line x1="12" y1="18" x2="12" y2="22"/>
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteRing(ri)}
                              title="Excluir polígono"
                              style={{
                                background: "none",
                                border: "1px solid var(--border)",
                                color: "var(--text-muted)",
                                cursor: "pointer",
                                padding: 3,
                                borderRadius: 3,
                                display: "flex",
                                alignItems: "center",
                                transition: "color 0.15s, border-color 0.15s",
                              }}
                              onMouseEnter={(e) => {
                                const b = e.currentTarget as HTMLButtonElement;
                                b.style.color = "var(--red)";
                                b.style.borderColor = "rgba(239,68,68,0.4)";
                              }}
                              onMouseLeave={(e) => {
                                const b = e.currentTarget as HTMLButtonElement;
                                b.style.color = "var(--text-muted)";
                                b.style.borderColor = "var(--border)";
                              }}
                            >
                              <IconTrash size={10} />
                            </button>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={pr.title}
                          maxLength={64}
                          onChange={(e) =>
                            setPolyRings((prev) =>
                              prev.map((p, i) =>
                                i === ri ? { ...p, title: e.target.value } : p,
                              ),
                            )
                          }
                          placeholder={`Área ${ri + 1}`}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid var(--border-accent)",
                            background: "var(--bg-elevated)",
                            color: "var(--text-primary)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                          }}
                        />
                        <span style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          color: "var(--text-muted)",
                        }}>
                          {pr.points.length} vértice{pr.points.length !== 1 ? "s" : ""}
                        </span>
                        {/* Invert direction indicator */}
                        {pr.inverted && (
                          <div style={{
                            marginTop: 2,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "3px 6px",
                            borderRadius: 3,
                            background: "rgba(0,180,216,0.10)",
                            border: "1px solid rgba(0,180,216,0.25)",
                          }}>
                            <IconArrowsUpDown size={9} color="var(--cyan)" />
                            <span style={{
                              fontFamily: "var(--font-display)",
                              fontSize: 7.5,
                              fontWeight: 700,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                              color: "var(--cyan)",
                            }}>
                              Direção invertida — saída conta como entrada
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                    {polyDraft.length === 0 ? (
                      <div style={{
                        padding: "14px 10px", textAlign: "center",
                        border: "1px dashed var(--border)", borderRadius: 6,
                        fontFamily: "var(--font-mono)", fontSize: 10,
                        color: "var(--text-muted)", opacity: 0.45,
                      }}>
                        Rascunho sem vértices — clique no vídeo
                      </div>
                    ) : (
                      polyDraft.map((p, i) => (
                        <div
                          key={i}
                          className="roi-row"
                          style={{
                            padding: "7px 9px",
                            background: "var(--bg-surface)",
                            border: `1px solid ${i === 0 ? "rgba(16,185,129,0.28)" : "var(--border)"}`,
                            borderRadius: 6,
                            display: "flex", alignItems: "center", gap: 7,
                            animationDelay: `${Math.min(i * 0.03, 0.15)}s`,
                          }}
                        >
                          <span style={{
                            width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                            background: i === 0 ? "rgba(16,185,129,0.12)" : "var(--amber-dim)",
                            border: `1px solid ${i === 0 ? "rgba(16,185,129,0.28)" : "var(--border-accent)"}`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
                            color: i === 0 ? "var(--green)" : "var(--amber)",
                          }}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontFamily: "var(--font-mono)", fontSize: 10,
                              color: "var(--text-secondary)",
                              display: "flex", gap: 8,
                            }}>
                              <span>X <span style={{ color: "var(--amber)" }}>{p.x}</span></span>
                              <span>Y <span style={{ color: "var(--amber)" }}>{p.y}</span></span>
                            </div>
                          </div>
                          <button
                            onClick={() => setPolyDraft((ps) => ps.filter((_, idx) => idx !== i))}
                            title="Remover vértice"
                            style={{
                              background: "none", border: "none",
                              color: "var(--text-muted)", cursor: "pointer",
                              padding: 2, borderRadius: 3, flexShrink: 0,
                              display: "flex", alignItems: "center",
                              transition: "color 0.15s",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--red)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
                          >
                            <IconX size={10} />
                          </button>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>

              {/* Keyboard shortcuts */}
              <div style={{
                padding: "10px 12px",
                borderTop: "1px solid var(--border)",
              }}>
                <div style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 9, fontWeight: 700,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: "var(--text-muted)", marginBottom: 8,
                }}>
                  Atalhos
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {[
                    ["Z", "Desfazer"],
                    ["C", "Limpar"],
                    ["↵", "Aplicar"],
                    ["Esc", "Fechar"],
                  ].map(([key, label]) => (
                    <div key={key} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                    }}>
                      <span style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10, color: "var(--text-muted)",
                      }}>
                        {label}
                      </span>
                      <kbd style={{
                        padding: "1px 6px",
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 3,
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        color: "var(--text-secondary)",
                      }}>
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexShrink: 0,
          }}>
            {/* Status message */}
            <div style={{ fontSize: 12, minHeight: 20, flex: 1 }}>
              {msg && (
                <span
                  style={{
                    color: msg.ok ? "var(--green)" : "var(--red)",
                    display: "flex", alignItems: "center", gap: 6,
                    fontFamily: "var(--font-mono)", fontSize: 11,
                    animation: "roi-msg-in 0.18s ease",
                  }}
                >
                  {msg.ok ? <IconCheck size={12}/> : <IconAlertTriangle size={12}/>}
                  {msg.text}
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={undoLast}
                disabled={!hasGeometry}
                title="Desfazer (Z)"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 12px",
                  background: "var(--bg-surface)",
                  color: !hasGeometry ? "var(--text-muted)" : "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6, cursor: !hasGeometry ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  opacity: !hasGeometry ? 0.38 : 1,
                  transition: "all 0.15s",
                }}
              >
                <IconRotateCcw size={11}/> Desfazer
              </button>
              <button
                onClick={resetPoints}
                disabled={!hasGeometry}
                title="Limpar (C)"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 12px",
                  background: "var(--bg-surface)",
                  color: !hasGeometry ? "var(--text-muted)" : "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6, cursor: !hasGeometry ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  opacity: !hasGeometry ? 0.38 : 1,
                  transition: "all 0.15s",
                }}
              >
                <IconTrash size={11}/> Limpar
              </button>
              <button
                onClick={() => void apply()}
                disabled={saving || !canApply}
                title="Aplicar (Enter)"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 20px",
                  background: canApply && !saving ? accentDim : "var(--bg-surface)",
                  color: canApply && !saving ? accent : "var(--text-muted)",
                  border: `1px solid ${canApply && !saving ? accentBdr : "var(--border)"}`,
                  borderRadius: 6,
                  cursor: saving || !canApply ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  opacity: saving || !canApply ? 0.45 : 1,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (canApply && !saving) {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.opacity = "0.85";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = canApply && !saving ? "1" : "0.45";
                }}
              >
                <IconCheck size={11}/>
                {saving ? "Enviando…" : "Aplicar"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
