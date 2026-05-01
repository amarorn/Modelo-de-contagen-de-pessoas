#!/usr/bin/env python3
"""
Avaliação offline de hiperparâmetros de stream/inferência num clip de vídeo.

Por cada combinação na grelha mede:
  - infer_fps: frames / tempo de parede
  - mean_persons, std_persons: bbox classe pessoa por frame
  - mean_conf_person: média das confianças (proxy)
  - mae_person (opcional): CSV com contagens por frame

Sem GT: score = w_fps*norm(fps) - w_std*norm(std) + w_mean*norm(mean_persons)
Com GT:   score = w_fps*norm(fps) - w_mae*norm(mae)

Uso:
  cd /repo && PYTHONPATH=src .venv/bin/python scripts/tune_stream_from_clip.py \\
    --video path/clip.mp4 --model runs/.../best.pt --frames 400 \\
    --conf-grid 0.24,0.28,0.32 --stride-grid 1,2 --imgsz-grid 960

  # gt.csv: frame,person_count (frame = índice 0-based do resultado)
  .venv/bin/python scripts/tune_stream_from_clip.py --video clip.mp4 --model best.pt \\
    --gt-csv clip_gt.csv --json-out /tmp/tune_report.json
"""

from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]


def _parse_csv_ints(s: str) -> list[int]:
    out: list[int] = []
    for p in s.split(","):
        p = p.strip()
        if not p:
            continue
        out.append(int(p))
    return out or [1]


def _parse_csv_floats(s: str) -> list[float]:
    out: list[float] = []
    for p in s.split(","):
        p = p.strip()
        if not p:
            continue
        out.append(float(p))
    return out or [0.25]


def _resolve_tracker(spec: str) -> str:
    p = Path(spec)
    if not p.is_absolute():
        p = REPO_ROOT / spec
    if p.is_file():
        return str(p.resolve())
    return spec


def _load_gt_csv(path: Path) -> dict[int, int]:
    out: dict[int, int] = {}
    with path.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        if not r.fieldnames:
            raise ValueError("gt csv: sem cabeçalho")
        fields = {h.strip().lower(): h for h in r.fieldnames}
        fk = fields.get("frame") or fields.get("frame_index") or fields.get("idx")
        ck = fields.get("person_count") or fields.get("count") or fields.get("n")
        if not fk or not ck:
            raise ValueError(
                "gt csv: colunas frame (ou frame_index) e person_count (ou count)"
            )
        for row in r:
            fi = int(float(row[fk].strip()))
            out[fi] = int(float(row[ck].strip()))
    return out


def _run_track_series(
    model_path: Path,
    video_path: Path,
    *,
    conf: float,
    iou: float,
    imgsz: int,
    max_det: int,
    vid_stride: int,
    stream_buffer: bool,
    augment: bool,
    agnostic_nms: bool,
    tracker: str,
    classes: list[int] | None,
    person_class_id: int,
    max_frames: int,
    device: str,
) -> dict[str, Any]:
    from ultralytics import YOLO

    model = YOLO(str(model_path))
    kw: dict[str, Any] = {
        "source": str(video_path),
        "stream": True,
        "conf": conf,
        "iou": iou,
        "imgsz": imgsz,
        "max_det": max_det,
        "vid_stride": max(1, vid_stride),
        "stream_buffer": stream_buffer,
        "tracker": tracker,
        "persist": True,
        "verbose": False,
        "device": device,
        "augment": augment,
        "agnostic_nms": agnostic_nms,
    }
    if classes is not None:
        kw["classes"] = classes

    det_counts: list[int] = []
    person_counts: list[int] = []
    confs_person: list[float] = []
    all_track_ids: set[int] = set()

    t0 = time.perf_counter()
    n = 0
    err = None
    try:
        for result in model.track(**kw):
            n += 1
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                det_counts.append(0)
                person_counts.append(0)
            else:
                cls = boxes.cls.cpu().numpy()
                conf_arr = boxes.conf.cpu().numpy()
                det_counts.append(int(len(cls)))
                pmask = cls == float(person_class_id)
                pc = int(pmask.sum())
                person_counts.append(pc)
                if pc > 0:
                    confs_person.extend(conf_arr[pmask].tolist())
                if boxes.id is not None:
                    for tid in boxes.id.cpu().numpy().astype(int).tolist():
                        all_track_ids.add(int(tid))
            if n >= max_frames:
                break
    except Exception as exc:
        err = repr(exc)
    elapsed = max(time.perf_counter() - t0, 1e-9)
    infer_fps = n / elapsed
    std_p = statistics.pstdev(person_counts) if len(person_counts) > 1 else 0.0
    mean_p = statistics.mean(person_counts) if person_counts else 0.0
    mean_d = statistics.mean(det_counts) if det_counts else 0.0
    mean_cp = statistics.mean(confs_person) if confs_person else None

    return {
        "conf": conf,
        "iou": iou,
        "imgsz": imgsz,
        "max_det": max_det,
        "vid_stride": vid_stride,
        "stream_buffer": stream_buffer,
        "frames": n,
        "wall_s": round(elapsed, 3),
        "infer_fps": round(infer_fps, 3),
        "mean_dets": round(mean_d, 4),
        "mean_persons": round(mean_p, 4),
        "std_persons": round(std_p, 4),
        "mean_conf_person": round(mean_cp, 4) if mean_cp is not None else None,
        "unique_track_ids_seen": len(all_track_ids),
        "error": err,
        "_person_counts": person_counts,
    }


def _mae(gt: dict[int, int], person_counts: list[int]) -> float | None:
    if not gt:
        return None
    s = 0.0
    k = 0
    for i, c in enumerate(person_counts):
        if i in gt:
            s += abs(c - gt[i])
            k += 1
    if k == 0:
        return None
    return s / k


def _norm_minmax(vals: list[float]) -> list[float]:
    if not vals:
        return []
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-12:
        return [0.5 for _ in vals]
    return [(v - lo) / (hi - lo) for v in vals]


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Grelha offline: clip + YOLO track — FPS e métricas (GT opcional)."
    )
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--model", required=True, type=Path)
    ap.add_argument("--frames", type=int, default=500)
    ap.add_argument("--device", default="0")
    ap.add_argument("--person-class-id", type=int, default=0)
    ap.add_argument(
        "--classes",
        default="",
        help="IDs CSV (ex. 0). Vazio = todas as classes.",
    )
    ap.add_argument("--iou", type=float, default=0.45)
    ap.add_argument("--conf-grid", default="0.24,0.28,0.32")
    ap.add_argument("--stride-grid", default="1,2,3")
    ap.add_argument("--imgsz-grid", default="960")
    ap.add_argument("--max-det-grid", default="150")
    ap.add_argument("--stream-buffer", action="store_true")
    ap.add_argument("--augment", action="store_true")
    ap.add_argument("--agnostic-nms", action="store_true", default=True)
    ap.add_argument("--no-agnostic-nms", action="store_false", dest="agnostic_nms")
    ap.add_argument("--tracker", default="configs/bytetrack_live.yaml")
    ap.add_argument("--gt-csv", type=Path, default=None)
    ap.add_argument("--json-out", type=Path, default=None)
    ap.add_argument("--w-fps", type=float, default=1.0)
    ap.add_argument("--w-std", type=float, default=0.35)
    ap.add_argument("--w-mean", type=float, default=0.15)
    ap.add_argument("--w-mae", type=float, default=2.0)
    args = ap.parse_args()

    if not args.video.is_file():
        print(f"ERRO: vídeo: {args.video}", file=sys.stderr)
        return 2
    if not args.model.is_file():
        print(f"ERRO: modelo: {args.model}", file=sys.stderr)
        return 2

    gt: dict[int, int] = {}
    if args.gt_csv is not None:
        if not args.gt_csv.is_file():
            print(f"ERRO: gt: {args.gt_csv}", file=sys.stderr)
            return 2
        gt = _load_gt_csv(args.gt_csv)

    classes: list[int] | None = None
    if args.classes.strip():
        classes = [int(x.strip()) for x in args.classes.split(",") if x.strip()]

    confs = _parse_csv_floats(args.conf_grid)
    strides = _parse_csv_ints(args.stride_grid)
    imgszs = _parse_csv_ints(args.imgsz_grid)
    max_dets = _parse_csv_ints(args.max_det_grid)
    tracker = _resolve_tracker(args.tracker)

    rows: list[dict[str, Any]] = []
    for conf in confs:
        for vs in strides:
            for im in imgszs:
                for md in max_dets:
                    print(
                        f"[tune] conf={conf} stride={vs} imgsz={im} max_det={md} ...",
                        flush=True,
                    )
                    r = _run_track_series(
                        args.model,
                        args.video,
                        conf=conf,
                        iou=args.iou,
                        imgsz=im,
                        max_det=md,
                        vid_stride=vs,
                        stream_buffer=args.stream_buffer,
                        augment=args.augment,
                        agnostic_nms=args.agnostic_nms,
                        tracker=tracker,
                        classes=classes,
                        person_class_id=args.person_class_id,
                        max_frames=args.frames,
                        device=args.device,
                    )
                    pc = r.pop("_person_counts", [])
                    r["combo"] = (
                        f"c{r['conf']}_s{r['vid_stride']}_sz{r['imgsz']}_md{r['max_det']}"
                    )
                    mae = _mae(gt, pc)
                    r["mae_person"] = round(mae, 4) if mae is not None else None
                    rows.append(r)

    ok_rows = [r for r in rows if not r.get("error")]
    fps_list = [float(r["infer_fps"]) for r in ok_rows]
    std_list = [float(r["std_persons"]) for r in ok_rows]
    mean_list = [float(r["mean_persons"]) for r in ok_rows]
    mae_per_row: list[float | None] = []
    for r in ok_rows:
        m = r.get("mae_person")
        mae_per_row.append(float(m) if m is not None else None)
    mae_norm_by_i: dict[int, float] = {}
    _mae_vals = [v for v in mae_per_row if v is not None]
    if _mae_vals:
        _nn = _norm_minmax(_mae_vals)
        _j = 0
        for _i, _v in enumerate(mae_per_row):
            if _v is not None:
                mae_norm_by_i[_i] = _nn[_j]
                _j += 1

    nf = _norm_minmax(fps_list)
    ns = _norm_minmax(std_list)
    nm = _norm_minmax(mean_list)
    for i, r in enumerate(ok_rows):
        fps_n = nf[i]
        std_n = ns[i]
        mean_n = nm[i]
        if gt and i in mae_norm_by_i:
            r["score"] = round(
                args.w_fps * fps_n - args.w_mae * mae_norm_by_i[i],
                4,
            )
        else:
            r["score"] = round(
                args.w_fps * fps_n - args.w_std * std_n + args.w_mean * mean_n,
                4,
            )

    rows_sorted = sorted(ok_rows, key=lambda x: float(x["score"]), reverse=True)

    print("\n=== Top (score; maior = melhor compromisso na grelha) ===\n")
    hdr = f"{'combo':<30} {'fps':>7} {'meanP':>7} {'stdP':>6} {'mConf':>7} {'MAE':>7} {'score':>8}"
    print(hdr)
    print("-" * len(hdr))
    for r in rows_sorted[:20]:
        mc = r.get("mean_conf_person")
        mcs = f"{mc:>7.3f}" if mc is not None else "    n/a"
        mae_s = f"{r['mae_person']:>7.3f}" if r["mae_person"] is not None else "    n/a"
        print(
            f"{r['combo']:<30} {r['infer_fps']:>7.2f} {r['mean_persons']:>7.2f} "
            f"{r['std_persons']:>6.2f} {mcs} {mae_s} {r['score']:>8.3f}"
        )

    if not ok_rows:
        print("Nenhuma combinação concluída sem erro.", file=sys.stderr)

    bad = [r for r in rows if r.get("error")]
    if bad:
        print("\n=== Erros ===", flush=True)
        for r in bad:
            print(r.get("combo", "?"), r["error"], flush=True)

    if args.json_out:
        export_rows = []
        for r in rows:
            d = {k: v for k, v in r.items() if not k.startswith("_")}
            export_rows.append(d)
        args.json_out.write_text(
            json.dumps(
                {
                    "video": str(args.video),
                    "model": str(args.model),
                    "frames_cap": args.frames,
                    "gt_csv": str(args.gt_csv) if args.gt_csv else None,
                    "weights": {
                        "w_fps": args.w_fps,
                        "w_std": args.w_std,
                        "w_mean": args.w_mean,
                        "w_mae": args.w_mae,
                    },
                    "rows": export_rows,
                    "top": [{k: v for k, v in r.items()} for r in rows_sorted[:15]],
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(f"\nJSON: {args.json_out}", flush=True)

    if rows_sorted:
        print(
            "\nSugestão .env (melhor score na grelha; validar no stream real):",
            f"YOLO_INFER_CONF={rows_sorted[0]['conf']}",
            f"YOLO_VID_STRIDE={rows_sorted[0]['vid_stride']}",
            f"YOLO_INFER_IMGSZ={rows_sorted[0]['imgsz']}",
            f"YOLO_MAX_DET={rows_sorted[0]['max_det']}",
            sep="\n",
            flush=True,
        )

    return 0 if ok_rows and not bad else (1 if bad else 2)


if __name__ == "__main__":
    sys.exit(main())
