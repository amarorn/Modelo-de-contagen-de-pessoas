/**
 * Editor de uma zona: poligono sobre o feed; coordenadas guardadas normalizadas [0,1].
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IconX, IconCheck, IconTrash } from "./Icons";

interface Props {
  apiBase: string;
  cameraId: string;
  onClose: () => void;
  onSaved: () => void;
}

type Point = { x: number; y: number };

const AMBER = "#F59E0B";

export function ZoneEditor({ apiBase, cameraId, onClose, onSaved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [imgSize, setImgSize] = useState({ w: 1280, h: 720 });
  const [name, setName] = useState("Nova zona");
  const [zoneType, setZoneType] = useState("generic");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const snapSrc = `${apiBase}/video_feed`;

  const toFrameCoords = useCallback(
    (cx: number, cy: number): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: cx, y: cy };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round((cx / rect.width) * imgSize.w),
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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length === 0) return;
    const pts = points.map((p) => toCanvasCoords(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (points.length >= 3) ctx.closePath();
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (points.length >= 3) {
      ctx.fillStyle = "rgba(245,158,11,0.08)";
      ctx.fill();
    }
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = AMBER;
      ctx.fill();
    }
  }, [points, toCanvasCoords]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const obs = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      draw();
    });
    obs.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => obs.disconnect();
  }, [draw]);

  const onImgLoad = useCallback(() => {
    const img = imgRef.current;
    if (img) setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
  }, []);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = toFrameCoords(e.clientX - rect.left, e.clientY - rect.top);
    setPoints((prev) => [...prev, p]);
  };

  const clear = () => {
    setPoints([]);
    setMsg(null);
  };

  const save = async () => {
    if (points.length < 3) {
      setMsg({ text: "Minimo 3 pontos.", ok: false });
      return;
    }
    setSaving(true);
    setMsg(null);
    const poly = points.map((p) => ({
      x: p.x / imgSize.w,
      y: p.y / imgSize.h,
    }));
    try {
      const res = await fetch(`${apiBase}/api/zones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          camera_id: cameraId || "default",
          name: name.trim() || "Zona",
          zone_type: zoneType.trim() || "generic",
          polygon: poly,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      setMsg({ text: "Guardado.", ok: true });
      onSaved();
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : String(err), ok: false });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(960px, 100%)",
          maxHeight: "96vh",
          overflow: "auto",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-secondary)" }}>Nova zona semantica</h2>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
            <IconX size={18} />
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Cliques no video adicionam vertices (min. 3). Coordenadas normalizadas [0,1].
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Nome
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ marginLeft: 8, padding: "6px 10px", width: 200 }}
            />
          </label>
          <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Tipo
            <input
              value={zoneType}
              onChange={(e) => setZoneType(e.target.value)}
              style={{ marginLeft: 8, padding: "6px 10px", width: 140 }}
            />
          </label>
        </div>
        <div ref={containerRef} style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#000" }}>
          <img
            ref={imgRef}
            src={snapSrc}
            alt="feed"
            onLoad={onImgLoad}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", cursor: "crosshair" }}
          />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={clear} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <IconTrash size={14} /> Limpar
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <IconCheck size={14} /> {saving ? "A guardar..." : "Guardar zona"}
          </button>
          {msg && (
            <span style={{ color: msg.ok ? "var(--green)" : "var(--red)", fontSize: 13 }}>{msg.text}</span>
          )}
        </div>
      </div>
    </div>
  );
}
