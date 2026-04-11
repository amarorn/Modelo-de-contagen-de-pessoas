#!/usr/bin/env python3
"""Dashboard web para contagem de pessoas em tempo real."""

from __future__ import annotations

import argparse
import csv
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, Response, jsonify
from ultralytics import YOLO


@dataclass
class CounterState:
    entries: int = 0
    exits: int = 0

    @property
    def total(self) -> int:
        return self.entries + self.exits


class SharedState:
    def __init__(self) -> None:
        self.counter = CounterState()
        self.started_at = datetime.now()
        self.last_frame_jpeg: bytes | None = None
        self.last_error: str | None = None
        self.lock = threading.Lock()


class HeatmapAccumulator:
    """Acumula posicoes (ex.: pes) em grade reduzida; agregado, sem identidade."""

    def __init__(
        self,
        scale: int,
        decay: float,
        radius: int,
        alpha: float,
        blob_gain: float,
    ) -> None:
        self.scale = max(1, scale)
        self.decay = float(np.clip(decay, 0.0, 1.0))
        self.radius = max(1, radius)
        self.alpha = float(np.clip(alpha, 0.0, 1.0))
        self.blob_gain = max(0.0, blob_gain)
        self.acc: np.ndarray | None = None
        self._gh = 0
        self._gw = 0

    def _ensure(self, h: int, w: int) -> None:
        gh, gw = max(1, h // self.scale), max(1, w // self.scale)
        if self.acc is None or self._gh != gh or self._gw != gw:
            self.acc = np.zeros((gh, gw), dtype=np.float32)
            self._gh, self._gw = gh, gw

    def step(self, h: int, w: int, foot_xy: list[tuple[float, float]]) -> None:
        self._ensure(h, w)
        assert self.acc is not None
        self.acc *= self.decay
        if self.blob_gain <= 0 or not foot_xy:
            return
        for fx, fy in foot_xy:
            gx = int(np.clip(round(fx / self.scale), 0, self._gw - 1))
            gy = int(np.clip(round(fy / self.scale), 0, self._gh - 1))
            blob = np.zeros_like(self.acc)
            cv2.circle(blob, (gx, gy), self.radius, 1.0, -1)
            self.acc += blob * self.blob_gain

    def blend_over(self, frame_bgr: np.ndarray) -> np.ndarray:
        if self.acc is None or self.alpha <= 0:
            return frame_bgr
        h, w = frame_bgr.shape[:2]
        full = cv2.resize(self.acc, (w, h), interpolation=cv2.INTER_LINEAR)
        mx = float(full.max())
        if mx < 1e-6:
            return frame_bgr
        norm_u8 = np.clip(full / mx * 255.0, 0, 255).astype(np.uint8)
        colored = cv2.applyColorMap(norm_u8, cv2.COLORMAP_INFERNO)
        return cv2.addWeighted(frame_bgr, 1.0 - self.alpha, colored, self.alpha, 0)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Dashboard web do contador de pessoas")
    p.add_argument("--model", required=True)
    p.add_argument("--source", default="0", help="camera index, arquivo ou rtsp://")
    p.add_argument("--line", default="960,300,960,900", help="x1,y1,x2,y2 em pixels do frame")
    p.add_argument(
        "--conf",
        type=float,
        default=0.22,
        help="limiar de confianca (menor = mais deteccoes, mais falsos positivos)",
    )
    p.add_argument(
        "--imgsz",
        type=int,
        default=1280,
        help="lado maximo de redimensionamento na inferencia (maior ajuda pessoas pequenas)",
    )
    p.add_argument(
        "--iou",
        type=float,
        default=0.5,
        help="limiar IoU do NMS",
    )
    p.add_argument(
        "--max-det",
        type=int,
        default=200,
        help="maximo de deteccoes por frame (multidao)",
    )
    p.add_argument(
        "--augment",
        action="store_true",
        help="test-time augmentation (mais lento, pode ajudar cenas dificeis)",
    )
    p.add_argument(
        "--agnostic-nms",
        action="store_true",
        help="NMS entre classes (util se varias classes no modelo)",
    )
    p.add_argument("--person-class-id", type=int, default=None)
    p.add_argument("--no-heatmap", action="store_true", help="desliga sobreposicao do mapa de calor")
    p.add_argument(
        "--heat-scale",
        type=int,
        default=4,
        help="divide resolucao do acumulador (4 = grade ~1/4 do frame; menor = mais detalhe, mais CPU)",
    )
    p.add_argument(
        "--heat-decay",
        type=float,
        default=0.985,
        help="decaimento por frame (mais perto de 1 = rastro mais longo)",
    )
    p.add_argument(
        "--heat-radius",
        type=int,
        default=10,
        help="raio do blob na grade reduzida (ver --heat-scale)",
    )
    p.add_argument(
        "--heat-alpha",
        type=float,
        default=0.42,
        help="opacidade da camada de calor sobre o video (0..1)",
    )
    p.add_argument(
        "--heat-gain",
        type=float,
        default=1.0,
        help="intensidade somada por deteccao no acumulador",
    )
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8080)
    return p.parse_args()


def side_of_line(x: float, y: float, x1: int, y1: int, x2: int, y2: int) -> float:
    return (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)


def resolve_person_class_id(model: YOLO, forced_id: int | None) -> int:
    if forced_id is not None:
        return forced_id
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        for class_id, class_name in names.items():
            if str(class_name).strip().lower() == "person":
                return int(class_id)
    return 0


def validate_source(source: str | int) -> None:
    if isinstance(source, int):
        cap = cv2.VideoCapture(source)
        ok = cap.isOpened()
        cap.release()
        if not ok:
            raise ConnectionError(
                "Falha ao abrir camera local. No macOS, libere Camera para Terminal/iTerm/Python."
            )


def write_summary_csv(path: Path, state: CounterState, started_at: datetime) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["started_at", "finished_at", "entries", "exits", "total_passages"],
        )
        writer.writeheader()
        writer.writerow(
            {
                "started_at": started_at.isoformat(),
                "finished_at": datetime.now().isoformat(),
                "entries": state.entries,
                "exits": state.exits,
                "total_passages": state.total,
            }
        )


def inference_loop(args: argparse.Namespace, shared: SharedState, stop_event: threading.Event) -> None:
    try:
        model = YOLO(args.model)
        person_class_id = resolve_person_class_id(model, args.person_class_id)
        names = getattr(model, "names", {})
        cls_label = "?"
        if isinstance(names, dict):
            cls_label = str(names.get(person_class_id, names.get(str(person_class_id), "?")))
        print(
            f"[web] classe filtrada id={person_class_id} ({cls_label}) | "
            f"conf={args.conf} imgsz={args.imgsz} max_det={args.max_det} "
            f"augment={args.augment} agnostic_nms={args.agnostic_nms}"
        )

        x1, y1, x2, y2 = [int(v) for v in args.line.split(",")]
        source = int(args.source) if args.source.isdigit() else args.source
        validate_source(source)

        last_side_by_id: dict[int, float] = {}
        heat: HeatmapAccumulator | None = None
        if not args.no_heatmap:
            heat = HeatmapAccumulator(
                scale=args.heat_scale,
                decay=args.heat_decay,
                radius=args.heat_radius,
                alpha=args.heat_alpha,
                blob_gain=args.heat_gain,
            )
            print(
                f"[web] Heatmap scale={args.heat_scale} decay={args.heat_decay} "
                f"radius={args.heat_radius} alpha={args.heat_alpha}"
            )

        track_kw: dict = {
            "source": source,
            "stream": True,
            "conf": args.conf,
            "iou": args.iou,
            "imgsz": args.imgsz,
            "max_det": args.max_det,
            "classes": [person_class_id],
            "tracker": "bytetrack.yaml",
            "persist": True,
            "verbose": False,
        }
        if args.augment:
            track_kw["augment"] = True
        if args.agnostic_nms:
            track_kw["agnostic_nms"] = True

        stream = model.track(**track_kw)

        for result in stream:
            if stop_event.is_set():
                break

            frame = result.orig_img
            if frame is None:
                continue

            fh, fw = frame.shape[:2]
            foot_points: list[tuple[float, float]] = []

            if result.boxes is not None and len(result.boxes) > 0:
                xys = result.boxes.xyxy.tolist()
                for x_min, y_min, x_max, y_max in xys:
                    foot_x = (x_min + x_max) / 2.0
                    foot_y = float(y_max)
                    foot_points.append((foot_x, foot_y))

            if heat is not None:
                heat.step(fh, fw, foot_points)
                frame = heat.blend_over(frame)

            if result.boxes is not None and len(result.boxes) > 0 and result.boxes.id is not None:
                xys = result.boxes.xyxy.tolist()
                ids = result.boxes.id.int().tolist()
                for track_id, (x_min, y_min, x_max, y_max) in zip(ids, xys):
                    cx = (x_min + x_max) / 2.0
                    cy = (y_min + y_max) / 2.0
                    side = side_of_line(cx, cy, x1, y1, x2, y2)

                    with shared.lock:
                        prev = last_side_by_id.get(track_id)
                        if prev is not None and prev < 0 <= side:
                            shared.counter.entries += 1
                        elif prev is not None and prev > 0 >= side:
                            shared.counter.exits += 1
                    last_side_by_id[track_id] = side

                    cv2.rectangle(frame, (int(x_min), int(y_min)), (int(x_max), int(y_max)), (0, 255, 0), 2)
                    cv2.putText(
                        frame,
                        f"id={track_id}",
                        (int(x_min), int(y_min) - 10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (0, 255, 0),
                        1,
                    )

            with shared.lock:
                text = f"in={shared.counter.entries} out={shared.counter.exits} total={shared.counter.total}"
            cv2.line(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
            cv2.putText(frame, text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)

            ok, encoded = cv2.imencode(".jpg", frame)
            if ok:
                with shared.lock:
                    shared.last_frame_jpeg = encoded.tobytes()
    except Exception as exc:
        with shared.lock:
            shared.last_error = str(exc)


def create_app(shared: SharedState) -> Flask:
    app = Flask(__name__)

    @app.get("/")
    def index() -> str:
        return """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>People Counter</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #111; color: #fff; }
      .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
      .card { background: #1e1e1e; padding: 12px; border-radius: 8px; }
      img { max-width: 100%; border-radius: 8px; border: 1px solid #444; }
      button { padding: 8px 12px; margin-top: 10px; }
    </style>
  </head>
  <body>
    <h2>Contagem de Pessoas (Web)</h2>
    <p style="color:#aaa;font-size:14px;">Mapa de calor: intensidade agregada no solo (base do bbox), sem identidade.</p>
    <div class="grid">
      <div class="card">Entradas: <b id="entries">0</b></div>
      <div class="card">Saidas: <b id="exits">0</b></div>
      <div class="card">Total: <b id="total">0</b></div>
    </div>
    <img src="/video_feed" />
    <br/>
    <button onclick="exportCsv()">Exportar CSV</button>
    <p id="status"></p>
    <script>
      async function refresh() {
        const r = await fetch('/api/stats');
        const j = await r.json();
        document.getElementById('entries').textContent = j.entries;
        document.getElementById('exits').textContent = j.exits;
        document.getElementById('total').textContent = j.total_passages;
        document.getElementById('status').textContent = j.error ? ('Erro: ' + j.error) : 'Online';
      }
      async function exportCsv() {
        const r = await fetch('/api/export', {method: 'POST'});
        const j = await r.json();
        document.getElementById('status').textContent = 'CSV salvo: ' + j.csv_path;
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
                "entries": shared.counter.entries,
                "exits": shared.counter.exits,
                "total_passages": shared.counter.total,
                "error": shared.last_error,
            }
        return jsonify(payload)

    @app.post("/api/export")
    def export_csv() -> Response:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = Path("outputs") / f"count_summary_web_{ts}.csv"
        with shared.lock:
            write_summary_csv(csv_path, shared.counter, shared.started_at)
        return jsonify({"csv_path": str(csv_path)})

    @app.get("/video_feed")
    def video_feed() -> Response:
        def gen() -> bytes:
            while True:
                with shared.lock:
                    frame = shared.last_frame_jpeg
                if frame is None:
                    time.sleep(0.05)
                    continue
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                )

        return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")

    return app


def main() -> None:
    args = parse_args()
    shared = SharedState()
    stop_event = threading.Event()

    t = threading.Thread(target=inference_loop, args=(args, shared, stop_event), daemon=True)
    t.start()

    app = create_app(shared)
    app.run(host=args.host, port=args.port, debug=False)


if __name__ == "__main__":
    main()
