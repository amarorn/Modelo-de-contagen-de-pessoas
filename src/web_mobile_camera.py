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
    p.add_argument("--conf", type=float, default=0.22)
    p.add_argument(
        "--imgsz",
        type=int,
        default=1280,
        help="lado maximo na inferencia (maior = melhor para alvos pequenos, mais CPU)",
    )
    p.add_argument("--person-class-id", type=int, default=None)
    p.add_argument("--line", default="0.5,0.3,0.5,0.9", help="linha normalizada x1,y1,x2,y2")
    return p.parse_args()


def resolve_person_class_id(model: YOLO, forced_id: int | None) -> int:
    if forced_id is not None:
        return forced_id
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        for class_id, class_name in names.items():
            if str(class_name).strip().lower() == "person":
                return int(class_id)
    return 0


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
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["session_id", "started_at", "finished_at", "entries", "exits", "total_passages"],
        )
        writer.writeheader()
        writer.writerow(
            {
                "session_id": session_id,
                "started_at": session.created_at.isoformat(),
                "finished_at": datetime.now().isoformat(),
                "entries": session.entries,
                "exits": session.exits,
                "total_passages": session.total,
            }
        )


@dataclass
class StreamSharedState:
    session: SessionState
    lock: threading.Lock = field(default_factory=threading.Lock)
    last_frame_jpeg: bytes | None = None
    last_error: str | None = None
    started_at: datetime = field(default_factory=datetime.now)


def process_bgr_frame(
    frame: np.ndarray,
    sess: SessionState,
    model: YOLO,
    person_class_id: int,
    conf: float,
    imgsz: int,
    lx1: float,
    ly1: float,
    lx2: float,
    ly2: float,
    draw: bool,
) -> tuple[list[dict], np.ndarray]:
    h, w = frame.shape[:2]
    px1, py1, px2, py2 = lx1 * w, ly1 * h, lx2 * w, ly2 * h
    result = model.predict(
        frame,
        conf=conf,
        imgsz=imgsz,
        classes=[person_class_id],
        verbose=False,
    )[0]

    sess.updated_at_ts = time.time()

    detections = []
    if result.boxes is not None:
        for b in result.boxes.xyxy.tolist():
            x1, y1, x2, y2 = b
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            detections.append((x1, y1, x2, y2, cx, cy))

    max_dist = max(45.0, min(w, h) * 0.12)
    assigned_tracks: set[int] = set()
    boxes_out: list[dict] = []

    out_frame = frame if not draw else frame.copy()

    for x1, y1, x2, y2, cx, cy in detections:
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

        if best_id is None:
            best_id = sess.next_track_id
            sess.next_track_id += 1
            sess.tracks[best_id] = TrackState(cx=cx, cy=cy, side=side, last_seen_ts=now_ts)
        else:
            tr = sess.tracks[best_id]
            if tr.side < 0 <= side:
                sess.entries += 1
            elif tr.side > 0 >= side:
                sess.exits += 1
            tr.cx, tr.cy, tr.side, tr.last_seen_ts = cx, cy, side, now_ts

        assigned_tracks.add(best_id)
        boxes_out.append({"id": best_id, "x1": int(x1), "y1": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)})

        if draw:
            cv2.rectangle(out_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
            cv2.putText(
                out_frame,
                f"id={best_id}",
                (int(x1), int(y1) - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                1,
            )

    cutoff = time.time() - 2.0
    sess.tracks = {tid: tr for tid, tr in sess.tracks.items() if tr.last_seen_ts >= cutoff}

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

    return boxes_out, out_frame


def stream_inference_loop(
    args: argparse.Namespace,
    model: YOLO,
    person_class_id: int,
    lx1: float,
    ly1: float,
    lx2: float,
    ly2: float,
    shared: StreamSharedState,
    stop_event: threading.Event,
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

            _, drawn = process_bgr_frame(
                frame,
                sess,
                model,
                person_class_id,
                args.conf,
                args.imgsz,
                lx1,
                ly1,
                lx2,
                ly2,
                draw=True,
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


def create_stream_app(args: argparse.Namespace, shared: StreamSharedState) -> Flask:
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
            payload = {
                "entries": shared.session.entries,
                "exits": shared.session.exits,
                "total_passages": shared.session.total,
                "error": shared.last_error,
            }
        return jsonify(payload)

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
    model = YOLO(args.model)
    person_class_id = resolve_person_class_id(model, args.person_class_id)
    line_vals = [float(v) for v in args.line.split(",")]
    if len(line_vals) != 4:
        raise ValueError("Linha deve ter 4 valores: x1,y1,x2,y2")
    lx1, ly1, lx2, ly2 = line_vals
    sessions: dict[str, SessionState] = {}

    print(f"[mobile] model={args.model} person_class_id={person_class_id} line={args.line}")

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
      <video id="video" autoplay playsinline style="display:none"></video>
      <canvas id="canvas"></canvas>
      <div class="actions">
        <button id="start">Iniciar Camera</button>
        <button id="stop">Parar</button>
        <button id="csv">Exportar CSV</button>
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
      function setCounts(j) {{
        document.getElementById('entries').textContent = j.entries;
        document.getElementById('exits').textContent = j.exits;
        document.getElementById('total').textContent = j.total_passages;
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
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
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.strokeRect(b.x1, b.y1, b.w, b.h);
            ctx.fillStyle = '#22c55e';
            ctx.fillText('id=' + b.id, b.x1 + 2, Math.max(12, b.y1 - 4));
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

            boxes_out, _ = process_bgr_frame(
                frame,
                sess,
                model,
                person_class_id,
                args.conf,
                args.imgsz,
                lx1,
                ly1,
                lx2,
                ly2,
                draw=False,
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
                }
            )
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

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
        person_class_id = resolve_person_class_id(model, args.person_class_id)
        line_vals = [float(v) for v in args.line.split(",")]
        if len(line_vals) != 4:
            raise ValueError("Linha deve ter 4 valores: x1,y1,x2,y2")
        lx1, ly1, lx2, ly2 = line_vals
        shared = StreamSharedState(session=SessionState())
        stop_event = threading.Event()
        t = threading.Thread(
            target=stream_inference_loop,
            args=(args, model, person_class_id, lx1, ly1, lx2, ly2, shared, stop_event),
            daemon=True,
        )
        t.start()
        print(
            f"[mobile] Modo stream: source={args.source!r} model={args.model} "
            f"person_class_id={person_class_id} line={args.line}"
        )
        app = create_stream_app(args, shared)
        try:
            app.run(host=args.host, port=args.port, debug=False, use_reloader=False)
        finally:
            stop_event.set()
    else:
        app = create_app(args)
        app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
