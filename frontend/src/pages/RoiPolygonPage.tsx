import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl, type ConfigPayload } from "../lib/api";

type Point = { x: number; y: number };

export function RoiPolygonPage() {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [status, setStatus] = useState("");
  const [resetOnRoi, setResetOnRoi] = useState(false);
  const [serverMode, setServerMode] = useState<string>("—");
  const [busy, setBusy] = useState(false);

  const videoSrc = `${apiUrl("/video_feed")}`;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    const sx = w / nw;
    const sy = h / nh;
    if (points.length === 0) return;
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = p.x * sx;
      const y = p.y * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (points.length >= 3) ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "#34d399";
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [points]);

  const syncCanvasSize = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const cw = img.clientWidth;
    const ch = img.clientHeight;
    if (cw && ch) {
      canvas.width = cw;
      canvas.height = ch;
      draw();
    }
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw, points]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => syncCanvasSize());
    ro.observe(img);
    return () => ro.disconnect();
  }, [syncCanvasSize]);

  const loadCfg = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/config"));
      if (!r.ok) return;
      const j = (await r.json()) as ConfigPayload;
      setServerMode(j.mode);
      const poly = j.polygon ?? [];
      setPoints(poly.map((p) => ({ x: p.x, y: p.y })));
      setStatus(
        `Modo atual: ${j.mode} (${poly.length} vértices no servidor).`
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadCfg();
  }, [loadCfg]);

  function evToFrame(ev: React.MouseEvent<HTMLCanvasElement>): Point {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth || 1;
    const nh = img.naturalHeight || 1;
    return {
      x: Math.round(((ev.clientX - r.left) / r.width) * nw),
      y: Math.round(((ev.clientY - r.top) / r.height) * nh),
    };
  }

  async function applyPolygon() {
    if (points.length < 3) {
      setStatus("Precisa de pelo menos 3 pontos.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(apiUrl("/api/polygon"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: points.map((p) => ({ x: p.x, y: p.y })),
          reset_counters: resetOnRoi,
        }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error || String(r.status));
      setStatus("Polígono aplicado. Modo ROI ativo.");
      await loadCfg();
    } catch (e) {
      setStatus(`Erro: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function switchToLineMode() {
    setBusy(true);
    try {
      const r = await fetch(apiUrl("/api/mode"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "line", reset_counters: resetOnRoi }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error || String(r.status));
      setStatus(
        "Modo linha ativo. Calibre o segmento na página principal."
      );
      await loadCfg();
    } catch (e) {
      setStatus(`Erro: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-cyan-400/90 hover:text-cyan-300"
      >
        Voltar ao dashboard
      </Link>

      <h1 className="text-2xl font-semibold tracking-tight text-white">
        Modo ROI poligonal (porta)
      </h1>

      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">
        Clique na imagem para marcar vértices no sentido horário ou
        anti-horário (mínimo 3). A contagem considera{" "}
        <strong className="text-slate-300">entrada</strong> quando os pés
        passam de fora para dentro do polígono, e{" "}
        <strong className="text-slate-300">saída</strong> no sentido inverso.
        Multidão fora da zona não entra no mapa de calor nem na lógica.
      </p>

      <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-slate-500">
        <li>
          <strong className="text-slate-400">Aplicar</strong>: envia o
          polígono e ativa este modo.
        </li>
        <li>
          <strong className="text-slate-400">Modo linha</strong>: volta ao
          cruzamento de segmento (calibração na página principal).
        </li>
      </ul>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPoints([]);
            setStatus("");
          }}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50"
        >
          Limpar pontos
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setPoints((p) => {
              const n = p.slice(0, -1);
              setStatus(`${n.length} ponto(s).`);
              return n;
            });
          }}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50"
        >
          Desfazer último
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void applyPolygon()}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          Aplicar polígono e ativar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void switchToLineMode()}
          className="rounded-lg bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/15 disabled:opacity-50"
        >
          Usar modo linha
        </button>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={resetOnRoi}
          onChange={(e) => setResetOnRoi(e.target.checked)}
        />
        Zerar contadores ao aplicar / mudar modo
      </label>

      {status ? (
        <p className="mt-3 min-h-[1.25rem] text-sm text-amber-200/90">
          {status}
        </p>
      ) : null}

      <div className="relative mt-6 inline-block max-w-full text-center">
        <img
          ref={imgRef}
          src={videoSrc}
          alt="Vídeo"
          draggable={false}
          onLoad={syncCanvasSize}
          className="max-h-[min(85vh,900px)] w-auto max-w-full rounded-xl border border-white/10"
        />
        <canvas
          ref={canvasRef}
          className="absolute left-0 top-0 cursor-crosshair rounded-xl"
          onClick={(ev) => {
            const p = evToFrame(ev);
            setPoints((prev) => {
              const next = [...prev, p];
              setStatus(
                `${next.length} ponto(s). Mínimo 3 para aplicar.`
              );
              return next;
            });
          }}
        />
      </div>

      <p className="mt-4 text-xs text-slate-600">
        Servidor: modo {serverMode}
      </p>
    </div>
  );
}
