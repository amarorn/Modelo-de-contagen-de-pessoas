#!/usr/bin/env python3
"""Dashboard web com camera do proprio aparelho (getUserMedia).

Com --source, o servidor le o video no proprio processo (OpenCV), util para RTSP,
arquivo local, ou URL HLS obtida de um live (ex.: YouTube) com ferramentas externas.

Exemplo (Fremont Street Skyline = player YouTube na pagina; obter URL HLS):
  yt-dlp -g -f "best[height<=720]" "https://www.youtube.com/watch?v=ZvYvZLfPatQ"
  python src/web_mobile_camera.py --model best.pt --source "<url_m3u8_impressa>"
"""

from __future__ import annotations

import argparse
import base64
import csv
import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request
from ultralytics import YOLO

from device_utils import resolve_device
from sex_classifier_agg import OptionalSexClassifier, PerTrackSexSmoother, SexAggregateStats
from yolo_class_utils import resolve_yolo_classes_and_person_id, short_class_tag

# BGR para OpenCV (alinhado as cores hex do browser: F rosa, M azul, ? cinza)
_SEX_BOX_COLOR_BGR: dict[str, tuple[int, int, int]] = {
    "female": (140, 29, 225),
    "male": (235, 99, 37),
    "unknown": (148, 163, 184),
}


@dataclass
class TrackState:
    cx: float
    cy: float
    side: float
    last_seen_ts: float


@dataclass
class SessionState:
    created_at: datetime = field(default_factory=datetime.now)
    entries: int = 0
    exits: int = 0
    next_track_id: int = 1
    tracks: dict[int, TrackState] = field(default_factory=dict)
    updated_at_ts: float = field(default_factory=time.time)
    sex_agg: SexAggregateStats = field(default_factory=SexAggregateStats)
    sex_smoother: PerTrackSexSmoother | None = None

    @property
    def total(self) -> int:
        return self.entries + self.exits


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="People Counter com camera do celular")
    p.add_argument("--model", required=True)
    p.add_argument(
        "--source",
        default="",
        help="Se definido, modo stream no servidor: indice de camera, ficheiro, RTSP ou URL "
        "(ex. m3u8). Sem isto, usa a camera do browser (getUserMedia).",
    )
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8081)
    p.add_argument(
        "--conf",
        type=float,
        default=0.02,
        help="Limiar de confianca YOLO (webcam costuma precisar mais baixo que RTSP; ex. 0.02-0.1).",
    )
    p.add_argument(
        "--imgsz",
        type=int,
        default=1280,
        help="lado maximo na inferencia (maior = melhor para alvos pequenos, mais CPU)",
    )
    p.add_argument("--person-class-id", type=int, default=None)
    p.add_argument(
        "--count-class-ids",
        default=None,
        help="IDs separados por virgula (ex. 0,1). Em .env: COUNT_CLASS_IDS=0,1",
    )
    p.add_argument("--line", default="0.5,0.3,0.5,0.9", help="linha normalizada x1,y1,x2,y2")
    p.add_argument(
        "--sex-model",
        default=None,
        help="YOLO classify .pt (ex.: .env YOLO_SEX_MODEL); estatistica agregada em entradas.",
    )
    p.add_argument("--sex-abstain", type=float, default=0.65, help="Confianca minima top-1; abaixo conta como incerto.")
    p.add_argument("--device", default="auto", help="Device para o classificador de sexo (auto, cpu, 0, ...)")
    return p.parse_args()


def side_of_line(x: float, y: float, x1: float, y1: float, x2: float, y2: float) -> float:
    return (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)


def decode_data_url_to_bgr(data_url: str) -> np.ndarray:
    payload = data_url.split(",", 1)[-1]
    raw = base64.b64decode(payload)
    arr = np.frombuffer(raw, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Falha ao decodificar frame")
    return frame


def write_summary_csv(path: Path, session_id: str, session: SessionState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "session_id",
        "started_at",
        "finished_at",
        "entries",
        "exits",
        "total_passages",
        "sex_female",
        "sex_male",
        "sex_unknown",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerow(
            {
                "session_id": session_id,
                "started_at": session.created_at.isoformat(),
                "finished_at": datetime.now().isoformat(),
                "entries": session.entries,
                "exits": session.exits,
                "total_passages": session.total,
                "sex_female": session.sex_agg.female,
                "sex_male": session.sex_agg.male,
                "sex_unknown": session.sex_agg.unknown,
            }
        )


@dataclass
class StreamSharedState:
    session: SessionState
    lock: threading.Lock = field(default_factory=threading.Lock)
    last_frame_jpeg: bytes | None = None
    last_error: str | None = None
    started_at: datetime = field(default_factory=datetime.now)
    sex_overlay_available: bool = False
    show_sex_overlay: bool = True


def process_bgr_frame(
    frame: np.ndarray,
    sess: SessionState,
    model: YOLO,
    count_class_ids: list[int],
    person_class_id: int,
    conf: float,
    imgsz: int,
    lx1: float,
    ly1: float,
    lx2: float,
    ly2: float,
    draw: bool,
    sex_clf: OptionalSexClassifier | None = None,
    show_sex_overlay: bool = True,
) -> tuple[list[dict], np.ndarray]:
    h, w = frame.shape[:2]
    px1, py1, px2, py2 = lx1 * w, ly1 * h, lx2 * w, ly2 * h
    names = getattr(model, "names", {})
    result = model.predict(
        frame,
        conf=conf,
        imgsz=imgsz,
        classes=count_class_ids,
        verbose=False,
    )[0]

    sess.updated_at_ts = time.time()

    detections = []
    if result.boxes is not None:
        for i, b in enumerate(result.boxes.xyxy.tolist()):
            x1, y1, x2, y2 = b
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            cid = person_class_id
            if result.boxes.cls is not None and len(result.boxes.cls) > i:
                cid = int(result.boxes.cls[i].item())
            detections.append((x1, y1, x2, y2, cx, cy, cid))

    max_dist = max(45.0, min(w, h) * 0.12)
    assigned_tracks: set[int] = set()
    boxes_out: list[dict] = []

    out_frame = frame if not draw else frame.copy()
    sex_run = bool(
        sex_clf is not None and sex_clf.enabled and show_sex_overlay
    )

    for x1, y1, x2, y2, cx, cy, det_cls in detections:
        best_id = None
        best_dist = float("inf")
        for tid, tr in sess.tracks.items():
            if tid in assigned_tracks:
                continue
            d = math.hypot(cx - tr.cx, cy - tr.cy)
            if d < best_dist and d <= max_dist:
                best_dist = d
                best_id = tid

        side = side_of_line(cx, cy, px1, py1, px2, py2)
        now_ts = time.time()

        tid_smooth = best_id if best_id is not None else sess.next_track_id
        bucket_live: str | None = None
        if sex_run and det_cls == person_class_id:
            raw_sx = sex_clf.classify_crop(
                frame, (float(x1), float(y1), float(x2), float(y2))
            )
            if sess.sex_smoother is None:
                sess.sex_smoother = PerTrackSexSmoother.from_env()
            bucket_live = sess.sex_smoother.update(tid_smooth, raw_sx)

        if best_id is None:
            best_id = sess.next_track_id
            sess.next_track_id += 1
            sess.tracks[best_id] = TrackState(cx=cx, cy=cy, side=side, last_seen_ts=now_ts)
        else:
            tr = sess.tracks[best_id]
            if tr.side < 0 <= side:
                sess.entries += 1
                if sex_run and det_cls == person_class_id and bucket_live is not None:
                    if bucket_live == "female":
                        sess.sex_agg.female += 1
                    elif bucket_live == "male":
                        sess.sex_agg.male += 1
                    else:
                        sess.sex_agg.unknown += 1
            elif tr.side > 0 >= side:
                sess.exits += 1
            tr.cx, tr.cy, tr.side, tr.last_seen_ts = cx, cy, side, now_ts

        assigned_tracks.add(best_id)
        box_item: dict = {
            "id": best_id,
            "x1": int(x1),
            "y1": int(y1),
            "w": int(x2 - x1),
            "h": int(y2 - y1),
            "cls": short_class_tag(names, det_cls) if isinstance(names, dict) else str(det_cls),
        }
        if sex_run and det_cls == person_class_id and bucket_live is not None:
            box_item["sex"] = bucket_live
        boxes_out.append(box_item)

        if draw:
            ct = short_class_tag(names, det_cls) if isinstance(names, dict) else str(det_cls)
            color = (
                _SEX_BOX_COLOR_BGR.get(bucket_live, (0, 255, 0))
                if (sex_run and det_cls == person_class_id and bucket_live)
                else ((0, 165, 255) if det_cls != person_class_id else (0, 255, 0))
            )
            cv2.rectangle(out_frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            tag = f"{ct} id={best_id}"
            if sex_run and det_cls == person_class_id and bucket_live == "female":
                tag += " F"
            elif sex_run and det_cls == person_class_id and bucket_live == "male":
                tag += " M"
            elif sex_run and det_cls == person_class_id and bucket_live == "unknown":
                tag += " ?"
            cv2.putText(
                out_frame,
                tag,
                (int(x1), int(y1) - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                color,
                1,
            )

    cutoff = time.time() - 2.0
    sess.tracks = {tid: tr for tid, tr in sess.tracks.items() if tr.last_seen_ts >= cutoff}
    if sess.sex_smoother is not None:
        sess.sex_smoother.forget_stale(set(sess.tracks.keys()))

    if draw:
        cv2.line(out_frame, (int(px1), int(py1)), (int(px2), int(py2)), (0, 0, 255), 2)
        cv2.putText(
            out_frame,
            f"in={sess.entries} out={sess.exits} total={sess.total}",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (255, 255, 255),
            2,
        )
        if sex_run:
            cv2.putText(
                out_frame,
                f"F={sess.sex_agg.female} M={sess.sex_agg.male} ?={sess.sex_agg.unknown}",
                (20, 78),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (200, 220, 255),
                2,
            )

    return boxes_out, out_frame


def stream_inference_loop(
    args: argparse.Namespace,
    model: YOLO,
    count_class_ids: list[int],
    person_class_id: int,
    lx1: float,
    ly1: float,
    lx2: float,
    ly2: float,
    shared: StreamSharedState,
    stop_event: threading.Event,
    sex_clf: OptionalSexClassifier | None,
) -> None:
    raw = args.source.strip()
    source: str | int = int(raw) if raw.isdigit() else raw
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        with shared.lock:
            shared.last_error = f"Nao foi possivel abrir --source: {source!r}"
        return

    try:
        while not stop_event.is_set():
            ok, frame = cap.read()
            if not ok or frame is None:
                time.sleep(0.05)
                continue

            with shared.lock:
                sess = shared.session
                show_sx = shared.show_sex_overlay and shared.sex_overlay_available

            _, drawn = process_bgr_frame(
                frame,
                sess,
                model,
                count_class_ids,
                person_class_id,
                args.conf,
                args.imgsz,
                lx1,
                ly1,
                lx2,
                ly2,
                draw=True,
                sex_clf=sex_clf,
                show_sex_overlay=show_sx,
            )

            enc_ok, encoded = cv2.imencode(".jpg", drawn)
            if enc_ok:
                with shared.lock:
                    shared.last_frame_jpeg = encoded.tobytes()
    except Exception as exc:
        with shared.lock:
            shared.last_error = str(exc)
    finally:
        cap.release()


def create_stream_app(
    args: argparse.Namespace, shared: StreamSharedState, sex_clf: OptionalSexClassifier | None
) -> Flask:
    app = Flask(__name__)
    stream_session_id = "_stream"

    @app.get("/")
    def index() -> str:
        return """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>People Counter (stream)</title>
    <style>
      body { margin: 0; background: #0d1117; color: #fff; font-family: Arial, sans-serif; padding: 16px; }
      .cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; }
      .card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 10px; text-align: center; }
      img { max-width: 100%; border-radius: 12px; border: 1px solid #30363d; }
      button { border: 0; border-radius: 8px; padding: 10px 12px; cursor: pointer; background: #1f6feb; color: #fff; }
    </style>
  </head>
  <body>
    <h3>Contagem (fonte no servidor)</h3>
    <p style="color:#8b949e;font-size:14px;">Modo --source: mesmo algoritmo que a camera do celular, com video lido no backend.</p>
    <div class="cards">
      <div class="card">Entradas<br/><b id="entries">0</b></div>
      <div class="card">Saidas<br/><b id="exits">0</b></div>
      <div class="card">Total<br/><b id="total">0</b></div>
    </div>
    <div id="sex-row" class="cards" style="display:none;margin-top:8px;">
      <div class="card">Feminino<br/><b id="sex_f">0</b></div>
      <div class="card">Masculino<br/><b id="sex_m">0</b></div>
      <div class="card">Incerto<br/><b id="sex_u">0</b></div>
    </div>
    <img src="/video_feed" alt="feed"/>
    <p style="margin-top:12px"><button onclick="exportCsv()">Exportar CSV</button></p>
    <p id="msg"><small></small></p>
    <script>
      async function refresh() {
        const r = await fetch('/api/stats');
        const j = await r.json();
        document.getElementById('entries').textContent = j.entries;
        document.getElementById('exits').textContent = j.exits;
        document.getElementById('total').textContent = j.total_passages;
        var sr = document.getElementById('sex-row');
        if (j.sex_overlay_available && j.show_sex_overlay) { sr.style.display = 'grid'; document.getElementById('sex_f').textContent = j.sex_female; document.getElementById('sex_m').textContent = j.sex_male; document.getElementById('sex_u').textContent = j.sex_unknown; }
        else { sr.style.display = 'none'; }
        document.getElementById('msg').innerHTML = '<small>' + (j.error ? ('Erro: ' + j.error) : 'Online') + '</small>';
      }
      async function exportCsv() {
        const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        document.getElementById('msg').innerHTML = '<small>' + (j.csv_path || j.error || '') + '</small>';
      }
      setInterval(refresh, 1000);
      refresh();
    </script>
  </body>
</html>
"""

    @app.get("/api/stats")
    def stats() -> Response:
        with shared.lock:
            sess = shared.session
            sa = shared.sex_overlay_available
            ss = shared.show_sex_overlay
            payload = {
                "entries": sess.entries,
                "exits": sess.exits,
                "total_passages": sess.total,
                "error": shared.last_error,
                "sex_classifier_enabled": sex_clf is not None and sex_clf.enabled,
                "sex_overlay_available": sa,
                "show_sex_overlay": ss if sa else False,
                "sex_female": sess.sex_agg.female,
                "sex_male": sess.sex_agg.male,
                "sex_unknown": sess.sex_agg.unknown,
            }
        return jsonify(payload)

    @app.get("/api/config")
    def api_config_stream() -> Response:
        with shared.lock:
            sa = shared.sex_overlay_available
            ss = shared.show_sex_overlay
        return jsonify(
            {
                "sex_overlay_available": sa,
                "show_sex_overlay": ss if sa else False,
            }
        )

    @app.post("/api/overlay")
    def api_overlay_stream() -> Response:
        data = request.get_json(silent=True) or {}
        with shared.lock:
            if "show_sex_overlay" in data and shared.sex_overlay_available:
                shared.show_sex_overlay = bool(data["show_sex_overlay"])
            sa = shared.sex_overlay_available
            ss = shared.show_sex_overlay
        return jsonify(
            {
                "ok": True,
                "sex_overlay_available": sa,
                "show_sex_overlay": ss if sa else False,
            }
        )

    @app.post("/api/export")
    def export_csv() -> Response:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = Path("outputs") / f"count_mobile_stream_{ts}.csv"
        with shared.lock:
            write_summary_csv(path, stream_session_id, shared.session)
        return jsonify({"csv_path": str(path)})

    @app.get("/video_feed")
    def video_feed() -> Response:
        def gen() -> bytes:
            while True:
                with shared.lock:
                    blob = shared.last_frame_jpeg
                if blob is None:
                    time.sleep(0.05)
                    continue
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + blob + b"\r\n"

        return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")

    return app


def create_app(args: argparse.Namespace) -> Flask:
    app = Flask(__name__)
    sex_ui = {"show": True}
    model = YOLO(args.model)
    count_class_ids, person_class_id = resolve_yolo_classes_and_person_id(
        model, args.person_class_id, args.count_class_ids
    )
    line_vals = [float(v) for v in args.line.split(",")]
    if len(line_vals) != 4:
        raise ValueError("Linha deve ter 4 valores: x1,y1,x2,y2")
    lx1, ly1, lx2, ly2 = line_vals
    sessions: dict[str, SessionState] = {}
    device = resolve_device(args.device)
    sex_clf = OptionalSexClassifier(args.sex_model, device, args.sex_abstain)
    if args.sex_model and not sex_clf.enabled:
        print("[mobile] AVISO: --sex-model invalido ou ficheiro inexistente; classificador de sexo desativado.")
    elif sex_clf.enabled:
        print(f"[mobile] sex_model={args.sex_model} sex_abstain={args.sex_abstain} device={device}")
    sex_avail = sex_clf.enabled

    print(
        f"[mobile] model={args.model} classes={count_class_ids} person_class_id={person_class_id} "
        f"line={args.line} conf={args.conf}"
    )

    @app.get("/")
    def index() -> str:
        return f"""
<!doctype html>
<html>
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>People Counter Mobile</title>
    <style>
      body {{ margin: 0; background: #0d1117; color: #fff; font-family: Arial, sans-serif; }}
      .wrap {{ max-width: 960px; margin: 0 auto; padding: 16px; }}
      .cards {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; }}
      .card {{ background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 10px; text-align: center; }}
      canvas {{ width: 100%; background: #000; border-radius: 12px; border: 1px solid #30363d; }}
      .actions {{ display: flex; gap: 8px; margin-top: 10px; }}
      button {{ border: 0; border-radius: 8px; padding: 10px 12px; cursor: pointer; }}
      #start {{ background: #238636; color: #fff; }}
      #stop {{ background: #da3633; color: #fff; }}
      #csv {{ background: #1f6feb; color: #fff; }}
      small {{ color: #8b949e; }}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h3>Contagem de Pessoas (Camera do Celular)</h3>
      <div class="cards">
        <div class="card">Entradas<br/><b id="entries">0</b></div>
        <div class="card">Saidas<br/><b id="exits">0</b></div>
        <div class="card">Total<br/><b id="total">0</b></div>
      </div>
      <div id="sex-row" class="cards" style="display:none;margin-top:8px;">
        <div class="card">Feminino<br/><b id="sex_f">0</b></div>
        <div class="card">Masculino<br/><b id="sex_m">0</b></div>
        <div class="card">Incerto<br/><b id="sex_u">0</b></div>
      </div>
      <video id="video" autoplay playsinline style="display:none"></video>
      <canvas id="canvas"></canvas>
      <div class="actions">
        <button id="start">Iniciar Camera</button>
        <button id="stop">Parar</button>
        <button id="csv">Exportar CSV</button>
      </div>
      <div id="sex-toggle-wrap" style="display:none;margin-top:10px;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:13px;color:#8b949e;">Reconhecimento de sexo (F/M)</span>
        <button type="button" id="sexToggle" style="padding:6px 16px;border-radius:999px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;font-weight:700;font-size:12px;cursor:pointer;">Ligado</button>
      </div>
      <p id="msg"><small>Use HTTPS para camera em celular fora de localhost.</small></p>
    </div>
    <script>
      const sessionId = localStorage.getItem('pc_session_id') || crypto.randomUUID();
      localStorage.setItem('pc_session_id', sessionId);
      const video = document.getElementById('video');
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
      let stream = null;
      let running = false;
      let timer = null;
      const line = [{lx1}, {ly1}, {lx2}, {ly2}];

      function setMsg(t) {{ document.getElementById('msg').innerHTML = '<small>' + t + '</small>'; }}
      let showSexOverlay = true;
      function updateSexToggleBtn() {{
        const b = document.getElementById('sexToggle');
        if (!b) return;
        b.textContent = showSexOverlay ? 'Ligado' : 'Desligado';
        b.style.borderColor = showSexOverlay ? 'rgba(236,72,153,0.45)' : '#30363d';
        b.style.background = showSexOverlay ? 'rgba(236,72,153,0.12)' : '#21262d';
      }}
      async function loadSexConfig() {{
        try {{
          const r = await fetch('/api/config');
          if (!r.ok) return;
          const c = await r.json();
          if (c.sex_overlay_available) {{
            const tw = document.getElementById('sex-toggle-wrap');
            if (tw) {{ tw.style.display = 'flex'; }}
            if (typeof c.show_sex_overlay === 'boolean') showSexOverlay = c.show_sex_overlay;
            updateSexToggleBtn();
          }}
        }} catch (e) {{}}
      }}
      function setCounts(j) {{
        document.getElementById('entries').textContent = j.entries;
        document.getElementById('exits').textContent = j.exits;
        document.getElementById('total').textContent = j.total_passages;
        const sr = document.getElementById('sex-row');
        if (typeof j.show_sex_overlay === 'boolean') showSexOverlay = j.show_sex_overlay;
        if (j.sex_overlay_available && j.show_sex_overlay) {{
          sr.style.display = 'grid';
          document.getElementById('sex_f').textContent = j.sex_female;
          document.getElementById('sex_m').textContent = j.sex_male;
          document.getElementById('sex_u').textContent = j.sex_unknown;
        }} else {{
          sr.style.display = 'none';
        }}
        updateSexToggleBtn();
      }}

      function drawLine() {{
        const x1 = line[0] * canvas.width, y1 = line[1] * canvas.height;
        const x2 = line[2] * canvas.width, y2 = line[3] * canvas.height;
        ctx.strokeStyle = '#ff4d4f';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }}

      async function sendFrame() {{
        if (!running) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawLine();
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        const r = await fetch('/api/process_frame', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ session_id: sessionId, image: dataUrl }})
        }});
        const j = await r.json();
        if (!r.ok) {{ setMsg(j.error || 'erro'); return; }}
        setCounts(j);
        if (j.boxes) {{
          for (const b of j.boxes) {{
            let col = '#22c55e';
            let tag = (b.cls ? (b.cls + ' ') : '') + 'id=' + b.id;
            if (j.sex_overlay_available && j.show_sex_overlay && b.sex) {{
              if (b.sex === 'female') {{ col = '#e11d8c'; tag += ' F'; }}
              else if (b.sex === 'male') {{ col = '#2563eb'; tag += ' M'; }}
              else {{ col = '#94a3b8'; tag += ' ?'; }}
            }}
            ctx.strokeStyle = col;
            ctx.lineWidth = 2;
            ctx.strokeRect(b.x1, b.y1, b.w, b.h);
            ctx.fillStyle = col;
            ctx.fillText(tag, b.x1 + 2, Math.max(12, b.y1 - 4));
          }}
        }}
      }}

      async function startCam() {{
        if (running) return;
        try {{
          const modernApi = navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
          if (modernApi) {{
            stream = await navigator.mediaDevices.getUserMedia({{ video: {{ facingMode: 'environment' }}, audio: false }});
          }} else {{
            const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
            if (!legacy) {{
              throw new Error('Navegador sem suporte a getUserMedia. Use Safari/Chrome atualizado e HTTPS.');
            }}
            stream = await new Promise((resolve, reject) =>
              legacy.call(navigator, {{ video: {{ facingMode: 'environment' }}, audio: false }}, resolve, reject)
            );
          }}
          video.srcObject = stream;
          await video.play();
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          running = true;
          timer = setInterval(sendFrame, 250);
          setMsg('Camera ativa');
        }} catch (e) {{
          const protocol = location.protocol;
          if (protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {{
            setMsg('Falha camera: requer HTTPS no celular. Abra via link https do tunnel.');
          }} else {{
            setMsg('Falha camera: ' + e.message);
          }}
        }}
      }}

      function stopCam() {{
        running = false;
        if (timer) clearInterval(timer);
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        setMsg('Parado');
      }}

      async function exportCsv() {{
        const r = await fetch('/api/export', {{
          method: 'POST',
          headers: {{ 'Content-Type': 'application/json' }},
          body: JSON.stringify({{ session_id: sessionId }})
        }});
        const j = await r.json();
        setMsg(r.ok ? ('CSV salvo em ' + j.csv_path) : (j.error || 'erro'));
      }}

      document.getElementById('start').onclick = startCam;
      document.getElementById('stop').onclick = stopCam;
      document.getElementById('csv').onclick = exportCsv;
      const sexBtn = document.getElementById('sexToggle');
      if (sexBtn) sexBtn.onclick = async () => {{
        showSexOverlay = !showSexOverlay;
        updateSexToggleBtn();
        try {{
          await fetch('/api/overlay', {{
            method: 'POST',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{ show_sex_overlay: showSexOverlay }})
          }});
        }} catch (e) {{}}
      }};
      loadSexConfig();
    </script>
  </body>
</html>
"""

    @app.post("/api/process_frame")
    def process_frame() -> Response:
        body = request.get_json(silent=True) or {}
        session_id = str(body.get("session_id", "")).strip()
        image = body.get("image", "")
        if not session_id:
            return jsonify({"error": "session_id ausente"}), 400
        if not image:
            return jsonify({"error": "image ausente"}), 400

        try:
            frame = decode_data_url_to_bgr(image)
            sess = sessions.get(session_id)
            if sess is None:
                sess = SessionState()
                sessions[session_id] = sess

            show_sx = sex_ui["show"] and sex_avail
            boxes_out, _ = process_bgr_frame(
                frame,
                sess,
                model,
                count_class_ids,
                person_class_id,
                args.conf,
                args.imgsz,
                lx1,
                ly1,
                lx2,
                ly2,
                draw=False,
                sex_clf=sex_clf,
                show_sex_overlay=show_sx,
            )

            stale = time.time() - 900
            for sid in list(sessions.keys()):
                if sessions[sid].updated_at_ts < stale:
                    del sessions[sid]

            return jsonify(
                {
                    "entries": sess.entries,
                    "exits": sess.exits,
                    "total_passages": sess.total,
                    "boxes": boxes_out,
                    "sex_classifier_enabled": sex_avail,
                    "sex_overlay_available": sex_avail,
                    "show_sex_overlay": sex_ui["show"] if sex_avail else False,
                    "sex_female": sess.sex_agg.female,
                    "sex_male": sess.sex_agg.male,
                    "sex_unknown": sess.sex_agg.unknown,
                }
            )
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.get("/api/config")
    def api_config_mobile() -> Response:
        return jsonify(
            {
                "sex_overlay_available": sex_avail,
                "show_sex_overlay": sex_ui["show"] if sex_avail else False,
            }
        )

    @app.post("/api/overlay")
    def api_overlay_mobile() -> Response:
        data = request.get_json(silent=True) or {}
        if "show_sex_overlay" in data and sex_avail:
            sex_ui["show"] = bool(data["show_sex_overlay"])
        return jsonify(
            {
                "ok": True,
                "sex_overlay_available": sex_avail,
                "show_sex_overlay": sex_ui["show"] if sex_avail else False,
            }
        )

    @app.post("/api/export")
    def export_csv() -> Response:
        body = request.get_json(silent=True) or {}
        session_id = str(body.get("session_id", "")).strip()
        if not session_id:
            return jsonify({"error": "session_id ausente"}), 400
        sess = sessions.get(session_id)
        if sess is None:
            return jsonify({"error": "sessao nao encontrada"}), 404
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = Path("outputs") / f"count_mobile_{session_id[:8]}_{ts}.csv"
        write_summary_csv(path, session_id, sess)
        return jsonify({"csv_path": str(path)})

    return app


def main() -> None:
    args = parse_args()
    if args.source.strip():
        model = YOLO(args.model)
        count_class_ids, person_class_id = resolve_yolo_classes_and_person_id(
            model, args.person_class_id, args.count_class_ids
        )
        line_vals = [float(v) for v in args.line.split(",")]
        if len(line_vals) != 4:
            raise ValueError("Linha deve ter 4 valores: x1,y1,x2,y2")
        lx1, ly1, lx2, ly2 = line_vals
        shared = StreamSharedState(session=SessionState())
        stop_event = threading.Event()
        device = resolve_device(args.device)
        sex_clf = OptionalSexClassifier(args.sex_model, device, args.sex_abstain)
        shared.sex_overlay_available = bool(sex_clf and sex_clf.enabled)
        if args.sex_model and not sex_clf.enabled:
            print("[mobile] AVISO: --sex-model invalido ou ficheiro inexistente; classificador de sexo desativado.")
        elif sex_clf.enabled:
            print(f"[mobile] sex_model={args.sex_model} sex_abstain={args.sex_abstain} device={device}")
        t = threading.Thread(
            target=stream_inference_loop,
            args=(
                args,
                model,
                count_class_ids,
                person_class_id,
                lx1,
                ly1,
                lx2,
                ly2,
                shared,
                stop_event,
                sex_clf,
            ),
            daemon=True,
        )
        t.start()
        print(
            f"[mobile] Modo stream: source={args.source!r} model={args.model} "
            f"classes={count_class_ids} person_class_id={person_class_id} line={args.line} conf={args.conf}"
        )
        app = create_stream_app(args, shared, sex_clf)
        try:
            app.run(host=args.host, port=args.port, debug=False, use_reloader=False)
        finally:
            stop_event.set()
    else:
        app = create_app(args)
        app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
