"""Leitura/escrita segura de chaves do .env para o dashboard de configuracao."""

from __future__ import annotations

import csv
import os
from pathlib import Path

# Chaves editaveis (alinhado a scripts/run_web.sh e .env); sem segredos (tokens/API keys).
EDITABLE_ENV_KEYS: tuple[str, ...] = (
    "YOLO_DEVICE",
    "YOLO_NO_HALF",
    "YOLO_INFER_MODEL",
    "PERSON_CLASS_ID",
    "COUNT_CLASS_IDS",
    "YOLO_INFER_CONF",
    "YOLO_CONF_MULT_VEHICLE_ONLY",
    "YOLO_EXPAND_VEHICLE_CLASSES",
    "YOLO_NONPERSON_MIN_H_FRAC",
    "YOLO_TRACK_NO_CLASSES_ARG",
    "YOLO_MIN_DET_CONF",
    "YOLO_INFER_IMGSZ",
    "YOLO_INFER_IOU",
    "YOLO_MAX_DET",
    "YOLO_AUGMENT",
    "YOLO_AGNOSTIC_NMS",
    "YOLO_VID_STRIDE",
    "YOLO_STREAM_BUFFER",
    "COUNT_LINE",
    "URL_HLS_OU_RTSP_OU_FICHEIRO",
    "YOLO_WEB_SOURCE",
    "YOLO_SKYLINE_WEBCAM_PAGE",
    "YOLO_WEB_SOURCE_PRESETS",
    "YOLO_TRACKER",
    "YOLO_TRACK_EMA",
    "YOLO_TRACK_HOLD_FRAMES",
    "YOLO_HIDE_STALE_BOXES",
    "YOLO_NO_SHAPE_FILTER",
    "YOLO_MIN_PERSON_AR",
    "YOLO_MAX_PERSON_AR",
    "YOLO_MAX_BOX_AREA_FRAC",
    "YOLO_MAX_NONPERSON_AREA_FRAC",
    "YOLO_MIN_PERSON_HEIGHT_PX",
    "YOLO_SEX_MODEL",
    "YOLO_SEX_ABSTAIN",
    "YOLO_SEX_MIN_BOX_HEIGHT_PX",
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "FFMPEG_RELAY",
    "FFMPEG_STATIC_DIR",
    "YOLO_WEB_PREVIEW_MAX_WIDTH",
    "YOLO_WEB_JPEG_QUALITY",
    "YOLO_WEB_TRAIL_LEN",
    "CAP_PROP_BUFFERSIZE",
    "WEB_HEATMAP",
    "HEAT_SCALE",
    "HEAT_DECAY",
    "HEAT_RADIUS",
    "HEAT_ALPHA",
    "HEAT_GAIN",
    "INFER_NO_SHOW",
    "YOLO_AGE_MODEL",
    "YOLO_AGE_ABSTAIN",
    "YOLO_WEB_HEADING",
    "WEB_HOST",
    "WEB_PORT",
)


def snapshot_editable_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for k in EDITABLE_ENV_KEYS:
        out[k] = os.environ.get(k, "")
    return out


def filter_updates(raw: dict) -> dict[str, str]:
    """So chaves na whitelist; valores como string."""
    out: dict[str, str] = {}
    for k, v in raw.items():
        if k not in EDITABLE_ENV_KEYS:
            continue
        if v is None:
            out[k] = ""
        elif isinstance(v, (dict, list)):
            continue
        else:
            out[k] = str(v).strip()
    return out


def merge_env_file(env_path: Path, updates: dict[str, str]) -> None:
    """Substitui ou acrescenta linhas KEY= para cada chave em updates."""
    text = env_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    seen: dict[str, bool] = {k: False for k in updates}
    out_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in line:
            k = line.split("=", 1)[0].strip()
            if k in updates:
                if not seen[k]:
                    out_lines.append(f"{k}={updates[k]}")
                    seen[k] = True
                continue
        out_lines.append(line)
    for k, v in updates.items():
        if not seen.get(k):
            out_lines.append(f"{k}={v}")
    env_path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")


def read_training_metrics_from_weights(model_weights_path: str) -> dict | None:
    """Ultima linha de results.csv junto ao run do modelo (weights/.. -> run dir)."""
    p = Path(model_weights_path).expanduser().resolve()
    if not p.is_file():
        return None
    run_dir = p.parent.parent
    rc = run_dir / "results.csv"
    if not rc.is_file():
        return None
    try:
        with rc.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
    except OSError:
        return None
    if not rows:
        return None
    last = rows[-1]
    best_map50 = -1.0
    best_row: dict[str, str] | None = None
    for row in rows:
        try:
            v = float(row.get("metrics/mAP50(B)", "nan"))
        except (TypeError, ValueError):
            continue
        if v > best_map50:
            best_map50 = v
            best_row = row
    return {
        "run_dir": str(run_dir),
        "results_csv": str(rc),
        "last_epoch": last.get("epoch"),
        "last_map50": last.get("metrics/mAP50(B)"),
        "last_map50_95": last.get("metrics/mAP50-95(B)"),
        "last_precision": last.get("metrics/precision(B)"),
        "last_recall": last.get("metrics/recall(B)"),
        "best_epoch": best_row.get("epoch") if best_row else None,
        "best_map50": best_row.get("metrics/mAP50(B)") if best_row else None,
        "best_map50_95": best_row.get("metrics/mAP50-95(B)") if best_row else None,
    }
