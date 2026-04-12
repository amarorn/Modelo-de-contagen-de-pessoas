#!/usr/bin/env python3
"""Inferencia em stream/video para contagem por linha com YOLO track (ByteTrack).

Teste com live web (ex.: Fremont Street na Skyline usa YouTube; obter URL HLS e passar em --source):

  URL=$(yt-dlp -g -f "best[height<=720]" "https://www.youtube.com/watch?v=ZvYvZLfPatQ")
  python src/infer_ultralytics_count.py --source "$URL" --line "640,160,640,560" --show

Ajuste --line (pixels) a resolucao real do video. Links HLS expiram; regenere com yt-dlp se o stream parar.
"""

from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path

import cv2
import torch
from ultralytics import YOLO

from device_utils import resolve_device


@dataclass
class CounterState:
    entries: int = 0
    exits: int = 0


def side_of_line(x: float, y: float, x1: int, y1: int, x2: int, y2: int) -> float:
    return (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Contagem de pessoas com YOLO + ByteTrack")
    p.add_argument("--model", default="runs/people_count/yolov8m-door-counter/weights/best.pt")
    p.add_argument(
        "--source",
        default="0",
        help="Indice de camera (0,1,...), path de ficheiro, rtsp:// ou URL de stream (ex. m3u8 de yt-dlp).",
    )
    p.add_argument("--device", default="auto", help="auto, cpu, mps ou id CUDA (ex: 0)")
    p.add_argument("--line", default="960,300,960,900", help="x1,y1,x2,y2 em pixels do frame")
    p.add_argument(
        "--conf",
        type=float,
        default=0.22,
        help="limiar de confianca (noite/cenas amplas: tente 0.18-0.28)",
    )
    p.add_argument(
        "--imgsz",
        type=int,
        default=1280,
        help="tamanho de inferencia (1280 costuma ajudar pessoas pequenas no quadro)",
    )
    p.add_argument("--iou", type=float, default=0.5, help="IoU do NMS")
    p.add_argument(
        "--person-class-id",
        type=int,
        default=None,
        help="ID da classe pessoa. Se omitido, tenta detectar classe 'person' no modelo.",
    )
    p.add_argument(
        "--csv-out",
        default="",
        help="Caminho do CSV de resumo. Se vazio, gera em outputs/count_summary_YYYYmmdd_HHMMSS.csv",
    )
    p.add_argument("--show", action="store_true")
    return p.parse_args()


def resolve_person_class_id(model: YOLO, forced_id: int | None) -> int:
    if forced_id is not None:
        return forced_id

    names = getattr(model, "names", {})
    if isinstance(names, dict):
        for class_id, class_name in names.items():
            if str(class_name).strip().lower() == "person":
                return int(class_id)

    # Fallback conservador para modelos COCO-like.
    return 0


def _camera_unavailable_message() -> str:
    if sys.platform == "darwin":
        return (
            "Falha ao abrir a camera. No macOS: System Settings > Privacy & Security > Camera para o terminal/Python. "
            "Ou use --source com ficheiro/URL."
        )
    return (
        "Sem camera local (/dev/video*). Use --source path.mp4, rtsp://... ou URL HLS (ex. via yt-dlp)."
    )


def resolve_local_media_path(source: str) -> str:
    """Se o path nao existir, tenta o mesmo nome de ficheiro com outra normalizacao Unicode (NFC/NFD)."""
    if source.isdigit():
        return source
    low = source.lower()
    if low.startswith(("http://", "https://", "rtsp://", "rtmp://", "udp://", "tcp://", "mms://")):
        return source
    p = Path(source).expanduser()
    if p.exists():
        return str(p.resolve())
    parent = p.parent
    if not parent.exists():
        return source
    target = unicodedata.normalize("NFC", p.name)
    for entry in parent.iterdir():
        if unicodedata.normalize("NFC", entry.name) == target:
            resolved = entry.resolve()
            print(f"[infer] Caminho resolvido (Unicode): {resolved}")
            return str(resolved)
    return source


def validate_source(source: str | int) -> None:
    """Valida camera local antes de iniciar pipeline do Ultralytics."""
    if isinstance(source, int):
        cap = cv2.VideoCapture(source)
        ok = cap.isOpened()
        cap.release()
        if not ok:
            raise ConnectionError(_camera_unavailable_message())


def resolve_csv_path(csv_out_arg: str) -> Path:
    if csv_out_arg.strip():
        path = Path(csv_out_arg).expanduser()
    else:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = Path("outputs") / f"count_summary_{ts}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def write_summary_csv(
    csv_path: Path,
    started_at: datetime,
    finished_at: datetime,
    source: str | int,
    model_path: str,
    person_class_id: int,
    entries: int,
    exits: int,
) -> None:
    total = entries + exits
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "started_at",
                "finished_at",
                "source",
                "model",
                "person_class_id",
                "entries",
                "exits",
                "total_passages",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "started_at": started_at.isoformat(),
                "finished_at": finished_at.isoformat(),
                "source": source,
                "model": model_path,
                "person_class_id": person_class_id,
                "entries": entries,
                "exits": exits,
                "total_passages": total,
            }
        )


def main() -> None:
    args = parse_args()
    started_at = datetime.now()
    x1, y1, x2, y2 = [int(v) for v in args.line.split(",")]
    resolved_device = resolve_device(args.device)
    model = YOLO(args.model)
    person_class_id = resolve_person_class_id(model, args.person_class_id)
    print(f"[infer] Filtrando apenas classe pessoa: id={person_class_id} | device={resolved_device}")

    state = CounterState()
    last_side_by_id: dict[int, float] = {}

    source = int(args.source) if args.source.isdigit() else args.source
    if isinstance(source, str):
        source = resolve_local_media_path(source)
    validate_source(source)
    csv_path = resolve_csv_path(args.csv_out)

    try:
        stream = model.track(
            source=source,
            stream=True,
            conf=args.conf,
            iou=args.iou,
            imgsz=args.imgsz,
            classes=[person_class_id],
            tracker="bytetrack.yaml",
            persist=True,
            verbose=False,
            device=resolved_device,
        )
    except Exception as exc:
        hint = (
            " Para URL de stream, obtenha um m3u8 atual com: "
            "yt-dlp -g -f best[height<=720] 'https://www.youtube.com/watch?v=VIDEO_ID'"
            if isinstance(source, str) and source.startswith("http")
            else " Se estiver no macOS, valide permissao de camera para o terminal/python."
        )
        raise ConnectionError(
            f"Nao foi possivel iniciar a fonte de video '{source}'.{hint}"
        ) from exc

    try:
        try:
            for result in stream:
                frame = result.orig_img

                if result.boxes is not None and result.boxes.id is not None:
                    ids = result.boxes.id.int().tolist()
                    xys = result.boxes.xyxy.tolist()

                    for track_id, (x_min, y_min, x_max, y_max) in zip(ids, xys):
                        foot_x = (x_min + x_max) / 2.0
                        foot_y = float(y_max)
                        side = side_of_line(foot_x, foot_y, x1, y1, x2, y2)

                        if track_id in last_side_by_id:
                            prev = last_side_by_id[track_id]
                            if prev < 0 <= side:
                                state.entries += 1
                                print(f"entry track={track_id} total={state.entries}")
                            elif prev > 0 >= side:
                                state.exits += 1
                                print(f"exit track={track_id} total={state.exits}")

                        last_side_by_id[track_id] = side

                        if args.show:
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

                if args.show:
                    cv2.line(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
                    cv2.putText(
                        frame,
                        f"in={state.entries} out={state.exits}",
                        (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1.0,
                        (255, 255, 255),
                        2,
                    )
                    cv2.imshow("people-counter", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
        except ConnectionError as exc:
            msg = str(exc).lower()
            hint = ""
            if "resolve" in msg or "name or service not known" in msg or "failed to open" in msg:
                hint = (
                    " Falha de rede/DNS ou stream indisponivel: confirme internet, "
                    "teste `ping`/`nslookup` ao hostname ou use outro URL/ficheiro .mp4."
                )
            print(f"[infer] Nao foi possivel abrir a fonte: {exc}{hint}", file=sys.stderr)
            raise SystemExit(1) from exc
    finally:
        finished_at = datetime.now()
        write_summary_csv(
            csv_path=csv_path,
            started_at=started_at,
            finished_at=finished_at,
            source=source,
            model_path=args.model,
            person_class_id=person_class_id,
            entries=state.entries,
            exits=state.exits,
        )
        print(
            f"[infer] CSV salvo em {csv_path} | "
            f"entries={state.entries} exits={state.exits} total={state.entries + state.exits}"
        )

    if args.show:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
