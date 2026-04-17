/**
 * RoiEditor v3 — linha/polígono com pontos arrastáveis, modal maior, linha mais transparente.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ApiConfig } from "../types/api";
import {
  IconRuler, IconPolygon, IconX, IconCheck,
  IconRotateCcw, IconTrash, IconAlertTriangle,
} from "./Icons";

interface Props {
  apiBase: string;
  config: ApiConfig | null;
  onClose: () => void;
  onApplied: () => void;
}

type DrawMode = "line" | "polygon";
type Point = { x: number; y: number };

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
    point: Point;
    didMove: boolean;
  } | null>(null);

  // Ponto hovado (índice) — ref para feedback visual imediato
  const hoveredPtRef = useRef<number | null>(null);

  const [mode, setMode]             = useState<DrawMode>(config?.mode ?? "line");
  const [linePoints, setLinePoints] = useState<Point[]>([]);
  const [polyPoints, setPolyPoints] = useState<Point[]>([]);
  const [imgSize, setImgSize]       = useState({ w: 1, h: 1 });
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null);
  const [coords, setCoords]         = useState<Point | null>(null);

  const snapSrc = `${apiBase}/video_feed`;

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  /* ── Coordinate conversion ──────────────────────────── */
  const toFrameCoords = useCallback(
    (cx: number, cy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: cx, y: cy };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round((cx / rect.width)  * imgSize.w),
        y: Math.round((cy / rect.height) * imgSize.h),
      };
    },
    [imgSize],
  );

  const toCanvasCoords = useCallback(
    (fx: number, fy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: fx, y: fy };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (fx / imgSize.w) * rect.width,
        y: (fy / imgSize.h) * rect.height,
      };
    },
    [imgSize],
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

    // Pontos efectivos (incluindo override de drag)
    const effLine = drag?.active && drag.mode === "line"
      ? linePoints.map((p, i) => i === drag.index ? drag.point : p)
      : linePoints;
    const effPoly = drag?.active && drag.mode === "polygon"
      ? polyPoints.map((p, i) => i === drag.index ? drag.point : p)
      : polyPoints;

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

    /* -- POLYGON MODE -- */
    if (mode === "polygon" && effPoly.length > 0) {
      const pts = effPoly.map((p) => toCanvasCoords(p.x, p.y));

      // Ghost segment to cursor
      if (cursor && !drag?.active) {
        const last = pts[pts.length - 1];
        ctx.save();
        ctx.strokeStyle = "rgba(245,158,11,0.28)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(cursor.cx, cursor.cy);
        ctx.stroke();
        if (pts.length >= 3) {
          ctx.strokeStyle = "rgba(245,158,11,0.12)";
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(cursor.cx, cursor.cy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (effPoly.length >= 3) ctx.closePath();

      ctx.strokeStyle = "rgba(245,158,11,0.18)";
      ctx.lineWidth = 7;
      ctx.lineJoin = "round";
      ctx.setLineDash(effPoly.length < 3 ? [6, 4] : []);
      ctx.stroke();
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      if (effPoly.length >= 3) {
        ctx.fillStyle = "rgba(245,158,11,0.07)";
        ctx.fill();
      }

      // Vertex markers
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const isFirst = i === 0;
        const isHovered = hovered === i;
        const isDragging = drag?.active && drag.mode === "polygon" && drag.index === i;
        const color = isFirst ? GREEN : AMBER;

        // Outer ring
        ctx.beginPath();
        ctx.arc(p.x, p.y, isHovered || isDragging ? 14 : 10, 0, Math.PI * 2);
        ctx.strokeStyle = isDragging
          ? (isFirst ? "rgba(16,185,129,0.55)" : "rgba(245,158,11,0.55)")
          : isHovered
          ? (isFirst ? "rgba(16,185,129,0.40)" : "rgba(245,158,11,0.40)")
          : isFirst
          ? "rgba(16,185,129,0.2)"
          : "rgba(245,158,11,0.2)";
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
        ctx.fillText(String(i + 1), p.x + 10, p.y - 8);

        // Ícone de arrastar quando hovado
        if (isHovered && !drag?.active) {
          ctx.save();
          ctx.strokeStyle = isFirst ? "rgba(16,185,129,0.55)" : "rgba(245,158,11,0.55)";
          ctx.lineWidth = 1;
          const r = 5;
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
  }, [mode, linePoints, polyPoints, toCanvasCoords]);

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
      const pts = mode === "line" ? linePoints : polyPoints;
      for (let i = pts.length - 1; i >= 0; i--) {
        const cp = toCanvasCoords(pts[i].x, pts[i].y);
        if (Math.hypot(cx - cp.x, cy - cp.y) <= HIT_RADIUS) return i;
      }
      return null;
    },
    [mode, linePoints, polyPoints, toCanvasCoords],
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
        const pts = mode === "line" ? linePoints : polyPoints;
        dragRef.current = {
          active: true,
          mode,
          index: idx,
          point: { ...pts[idx] },
          didMove: false,
        };
      } else {
        dragRef.current = null;
      }
    },
    [findNearestPoint, mode, linePoints, polyPoints],
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
          setPolyPoints((prev) => {
            const copy = [...prev];
            copy[drag.index] = drag.point;
            return copy;
          });
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
        setPolyPoints((prev) => [...prev, frame]);
      }
    },
    [mode, toFrameCoords, findNearestPoint],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === "polygon") {
        e.preventDefault();
        setPolyPoints((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      }
    },
    [mode],
  );

  /* ── Actions ────────────────────────────────────────── */
  const resetPoints = useCallback(() => {
    setLinePoints([]);
    setPolyPoints([]);
    setMsg(null);
  }, []);

  const undoLast = useCallback(() => {
    if (mode === "line") setLinePoints((p) => p.slice(0, -1));
    else setPolyPoints((p) => p.slice(0, -1));
    setMsg(null);
  }, [mode]);

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
        if (polyPoints.length < 3) {
          setMsg({ text: "Clique em pelo menos 3 pontos para o polígono.", ok: false });
          return;
        }
        const res = await fetch(`${apiBase}/api/polygon`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: polyPoints, reset_counters: true }),
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
  }, [mode, linePoints, polyPoints, apiBase, onApplied]);

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
  const points   = mode === "line" ? linePoints : polyPoints;
  const canApply = mode === "line" ? linePoints.length === 2 : polyPoints.length >= 3;

  const accent    = mode === "line" ? "var(--cyan)"        : "var(--amber)";
  const accentDim = mode === "line" ? "var(--cyan-dim)"    : "var(--amber-dim)";
  const accentBdr = mode === "line" ? "var(--border-glow)" : "var(--border-accent)";

  const instruction = (() => {
    if (mode === "line") {
      if (linePoints.length === 0) return "Clique no frame para definir o ponto inicial (A)";
      if (linePoints.length === 1) return "Clique para definir o ponto final (B)";
      return "Linha pronta · arraste os pontos para reposicionar · pressione Aplicar";
    }
    if (polyPoints.length === 0) return "Clique para adicionar o primeiro vértice";
    if (polyPoints.length < 3)   return `Mais ${3 - polyPoints.length} vértice${3 - polyPoints.length !== 1 ? "s" : ""} para fechar`;
    return "Arraste vértices para ajustar · duplo-clique para remover o último · pressione Aplicar";
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
          maxHeight: "94vh",
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
              {points.length > 0 && (
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
                    : `${polyPoints.length} vértice${polyPoints.length !== 1 ? "s" : ""}`}
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
                {points.length > 0 && (
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
                {points.length === 0 && (
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
                    color: points.length > 0 ? accent : "var(--text-muted)",
                    transition: "color 0.2s",
                  }}>
                    {points.length}{mode === "line" ? " / 2" : ""}
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

                {/* POLYGON: dynamic vertex list */}
                {mode === "polygon" && (
                  <>
                    {polyPoints.length === 0 ? (
                      <div style={{
                        padding: "14px 10px", textAlign: "center",
                        border: "1px dashed var(--border)", borderRadius: 6,
                        fontFamily: "var(--font-mono)", fontSize: 10,
                        color: "var(--text-muted)", opacity: 0.45,
                      }}>
                        Nenhum vértice
                      </div>
                    ) : (
                      polyPoints.map((p, i) => (
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
                            onClick={() => setPolyPoints((ps) => ps.filter((_, idx) => idx !== i))}
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
                disabled={points.length === 0}
                title="Desfazer (Z)"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 12px",
                  background: "var(--bg-surface)",
                  color: points.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6, cursor: points.length === 0 ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  opacity: points.length === 0 ? 0.38 : 1,
                  transition: "all 0.15s",
                }}
              >
                <IconRotateCcw size={11}/> Desfazer
              </button>
              <button
                onClick={resetPoints}
                disabled={points.length === 0}
                title="Limpar (C)"
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 12px",
                  background: "var(--bg-surface)",
                  color: points.length === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 6, cursor: points.length === 0 ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-display)", fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  opacity: points.length === 0 ? 0.38 : 1,
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
