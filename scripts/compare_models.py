"""
Compara 3 modelos no mesmo val split (so classe Pessoa).
Util para responder: o exp-25.pt e mesmo melhor que o exp-34/exp-35?
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from ultralytics import YOLO


def run_one(model_path: str, data_yaml: str, imgsz: int, device: str, batch: int) -> dict:
    if not Path(model_path).is_file():
        return {"model": model_path, "error": "file not found"}
    model = YOLO(model_path)
    res = model.val(
        data=data_yaml,
        imgsz=imgsz,
        device=device,
        batch=batch,
        classes=[0],
        conf=0.001,
        iou=0.6,
        plots=False,
        save_json=False,
        verbose=False,
    )
    rd = res.results_dict
    return {
        "model": model_path,
        "P": float(rd.get("metrics/precision(B)", 0.0)),
        "R": float(rd.get("metrics/recall(B)", 0.0)),
        "mAP50": float(rd.get("metrics/mAP50(B)", 0.0)),
        "mAP50-95": float(rd.get("metrics/mAP50-95(B)", 0.0)),
        "fitness": float(rd.get("fitness", 0.0)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/home/amaro-neto/datasets/person-5170a94e/data.yaml")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default=os.environ.get("YOLO_DEVICE", "cpu"))
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--models", nargs="+", required=True, help="caminhos para .pt")
    args = ap.parse_args()

    rows: list[dict] = []
    for mp in args.models:
        print(f"[compare] a validar: {mp}", flush=True)
        try:
            row = run_one(mp, args.data, args.imgsz, args.device, args.batch)
        except Exception as exc:
            row = {"model": mp, "error": repr(exc)}
        rows.append(row)
        print(f"[compare] -> {row}", flush=True)

    print("\n=== Resultado (classe Pessoa apenas) ===")
    header = f"{'modelo':<70} {'P':>6} {'R':>6} {'mAP50':>7} {'mAP50-95':>9} {'fit':>6}"
    print(header)
    print("-" * len(header))
    for r in rows:
        if "error" in r:
            name = Path(r["model"]).name
            print(f"{name:<70} ERRO: {r['error']}")
            continue
        name = Path(r["model"]).name
        if len(name) > 70:
            name = name[:67] + "..."
        print(
            f"{name:<70} {r['P']:>6.3f} {r['R']:>6.3f} {r['mAP50']:>7.3f} {r['mAP50-95']:>9.3f} {r['fitness']:>6.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
