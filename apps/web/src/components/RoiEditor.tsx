/**
 * RoiEditor — permite desenhar a linha de contagem ou o polígono ROI
 * diretamente sobre o frame do vídeo e enviar para a API Flask.
 *
 * Como funciona:
 *  - Mostra o último frame como imagem de fundo (snapshot via <img>)
 *  - Canvas transparente por cima captura cliques
 *  - Modo "line": 2 cliques definem os dois extremos
 *  - Modo "polygon": N cliques definem os vértices (duplo-clique fecha)
 *  - Botão "Aplicar" envia via POST /api/line ou /api/polygon
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

const CYAN   = "#00D4FF";
const AMBER  = "#F59E0B";
const GREEN  = "#10B981";

export function RoiEditor({ apiBase, config, onClose, onApplied }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef      = useRef<HTMLImageElement>(null);

  const [mode, setMode]         = useState<DrawMode>(config?.mode ?? "line");
  const [linePoints, setLinePoints] = useState<Point[]>([]);
  const [polyPoints, setPolyPoints] = useState<Point[]>([]);
  const [imgSize, setImgSize]   = useState({ w: 1, h: 1 });   // natural frame size
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null);

  /* ── Load snapshot from video_feed (single frame) ─── */
  const snapSrc = `${apiBase}/video_feed`;

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  /* ── Coordinate conversion: canvas px → frame px ─── */
  const toFrameCoords = useCallback(
    (cx: number, cy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: cx, y: cy };
      const rect = canvas.getBoundingClientRect();
      const scaleX = imgSize.w / rect.width;
      const scaleY = imgSize.h / rect.height;
      return {
        x: Math.round(cx * scaleX),
        y: Math.round(cy * scaleY),
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

  /* ── Draw canvas overlay ──────────────────────────── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (mode === "line" && linePoints.length > 0) {
      const pts = linePoints.map((p) => toCanvasCoords(p.x, p.y));
      ctx.save();
      // Glow shadow
      ctx.strokeStyle = "rgba(0,212,255,0.25)";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      if (pts[0] && pts[1]) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
      }
      // Bright line
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      if (pts[0] && pts[1]) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
      }
      // Endpoint circles
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = CYAN;
        ctx.fill();
      }
      ctx.restore();
    }

    if (mode === "polygon" && polyPoints.length > 0) {
      const pts = polyPoints.map((p) => toCanvasCoords(p.x, p.y));
      ctx.save();
      // Glow fill
      ctx.strokeStyle = AMBER;
      ctx.fillStyle   = "rgba(245,158,11,0.08)";
      ctx.lineWidth   = 2;
      ctx.setLineDash(polyPoints.length < 3 ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (polyPoints.length >= 3) ctx.closePath();
      ctx.stroke();
      if (polyPoints.length >= 3) ctx.fill();
      // Vertex dots
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#000";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? GREEN : AMBER;
        ctx.fill();
        // Index label
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.fillText(String(i + 1), p.x + 8, p.y - 6);
      }
      ctx.restore();
    }
  }, [mode, linePoints, polyPoints, toCanvasCoords]);

  useEffect(() => {
    draw();
  }, [draw]);

  /* ── Resize canvas to match container ────────────── */
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

  /* ── Click handler ───────────────────────────────── */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect  = canvas.getBoundingClientRect();
      const cx    = e.clientX - rect.left;
      const cy    = e.clientY - rect.top;
      const frame = toFrameCoords(cx, cy);

      if (mode === "line") {
        setLinePoints((prev) => {
          if (prev.length === 0) return [frame];
          if (prev.length === 1) return [prev[0], frame];
          return [frame]; // reset
        });
      } else {
        setPolyPoints((prev) => [...prev, frame]);
      }
    },
    [mode, toFrameCoords],
  );

  const handleDblClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === "polygon") {
        e.preventDefault();
        // Remove the last point added by the second click of dblclick
        setPolyPoints((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      }
    },
    [mode],
  );

  /* ── Apply / reset ───────────────────────────────── */
  const apply = async () => {
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
          body: JSON.stringify({
            x1: p1.x, y1: p1.y,
            x2: p2.x, y2: p2.y,
            reset_counters: true,
          }),
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
          body: JSON.stringify({
            points: polyPoints,
            reset_counters: true,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        // Also switch mode on API
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
  };

  const resetPoints = () => {
    setLinePoints([]);
    setPolyPoints([]);
    setMsg(null);
  };

  const undoLast = () => {
    if (mode === "line") setLinePoints((p) => p.slice(0, -1));
    else setPolyPoints((p) => p.slice(0, -1));
  };

  /* ── Render ──────────────────────────────────────── */
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        backdropFilter: "blur(4px)",
      }}
    >
      {/* Modal */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          width: "100%",
          maxWidth: 900,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Editor de ROI</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {mode === "line"
                ? "Clique em 2 pontos para definir a linha de contagem"
                : "Clique para adicionar vértices · Duplo-clique para fechar"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", color: "var(--text-muted)",
              cursor: "pointer", padding: 6, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <IconX size={16} />
          </button>
        </div>

        {/* Mode tabs */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          {(["line", "polygon"] as DrawMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); resetPoints(); }}
              style={{
                padding: "6px 16px",
                borderRadius: 8,
                border: "1px solid",
                borderColor: mode === m ? (m === "line" ? "var(--cyan)" : "var(--amber)") : "var(--border)",
                background: mode === m
                  ? m === "line" ? "var(--cyan-dim)" : "var(--amber-dim)"
                  : "transparent",
                color: mode === m
                  ? m === "line" ? "var(--cyan)" : "var(--amber)"
                  : "var(--text-secondary)",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {m === "line"
                ? <><IconRuler size={13}/> Linha</>
                : <><IconPolygon size={13}/> Polígono</>
              }
            </button>
          ))}
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16/9",
            background: "#000",
            cursor: "crosshair",
            overflow: "hidden",
          }}
        >
          {/* Background: live snapshot */}
          <img
            ref={imgRef}
            src={snapSrc}
            alt="frame"
            onLoad={onImgLoad}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
              opacity: 0.75,
            }}
          />
          {/* Drawing canvas */}
          <canvas
            ref={canvasRef}
            onClick={handleClick}
            onDoubleClick={handleDblClick}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          />
          {/* Instructions overlay */}
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              pointerEvents: "none",
            }}
          >
            {mode === "line"
              ? `${linePoints.length}/2 pontos`
              : `${polyPoints.length} vértice${polyPoints.length !== 1 ? "s" : ""}`}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {/* Left: status message */}
          <div style={{ fontSize: 13, minHeight: 20 }}>
            {msg && (
              <span style={{ color: msg.ok ? "var(--green)" : "var(--red)", display: "flex", alignItems: "center", gap: 6 }}>
                {msg.ok ? <IconCheck size={13}/> : <IconAlertTriangle size={13}/>} {msg.text}
              </span>
            )}
          </div>

          {/* Right: actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={undoLast} style={{ ...btnStyle("secondary"), display:"flex", alignItems:"center", gap:6 }}>
              <IconRotateCcw size={13}/> Desfazer
            </button>
            <button onClick={resetPoints} style={{ ...btnStyle("secondary"), display:"flex", alignItems:"center", gap:6 }}>
              <IconTrash size={13}/> Limpar
            </button>
            <button onClick={apply} disabled={saving}
              style={{ ...btnStyle("primary"), display:"flex", alignItems:"center", gap:6 }}>
              <IconCheck size={13}/> {saving ? "Enviando…" : "Aplicar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function btnStyle(variant: "primary" | "secondary"): React.CSSProperties {
  if (variant === "primary") {
    return {
      padding: "8px 20px",
      background: "var(--cyan-dim)",
      color: "var(--cyan)",
      border: "1px solid var(--border-glow)",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 13,
      fontWeight: 700,
    };
  }
  return {
    padding: "8px 14px",
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  };
}
