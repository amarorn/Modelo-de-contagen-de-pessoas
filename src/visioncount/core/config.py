"""Leitura/escrita segura de chaves do .env para o dashboard de configuracao."""

from __future__ import annotations

import csv
import os
from pathlib import Path

# Chaves editaveis (alinhado a scripts/run_web.sh e .env); sem segredos (tokens/API keys).
# Chaves que, ao guardar no dashboard, podem reabrir só o stream Ultralytics (sem reiniciar o Flask).
SETTINGS_STREAM_RELOAD_KEYS: frozenset[str] = frozenset(
    {
        "YOLO_INFER_CONF",
        "YOLO_INFER_IOU",
        "YOLO_INFER_IMGSZ",
        "YOLO_MAX_DET",
        "YOLO_AUGMENT",
        "YOLO_AGNOSTIC_NMS",
        "YOLO_VID_STRIDE",
        "YOLO_STREAM_BUFFER",
        "YOLO_TRACKER",
        "YOLO_TRACK_EMA",
        "YOLO_TRACK_HOLD_FRAMES",
        "OPENCV_FFMPEG_CAPTURE_OPTIONS",
        "CAP_PROP_BUFFERSIZE",
        "FFMPEG_RELAY",
        "FFMPEG_STATIC_DIR",
        "YOLO_WEB_HEADING",
        "YOLO_WEB_JPEG_QUALITY",
        "YOLO_WEB_TRAIL_LEN",
        # Limiares de contagem: relidos a cada reabertura do stream
        "TRACK_CONF_SUPPRESS_THRESHOLD",
        "TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD",
        "TRACK_CONF_MIN_AGE_FRAMES",
        # Watchdog e feed: relidos dinamicamente pelo watchdog/flask
        "YOLO_WATCHDOG_SOFT_S",
        "YOLO_WATCHDOG_HARD_S",
        "YOLO_FEED_STALE_S",
    }
)

MJPEG_ENV_DEFAULTS: dict[str, str] = {
    "YOLO_MJPEG_MAX_FPS": "10",
    # Com infer baixo + smooth display, cadência fixa costuma ser mais estável que seguir infer_fps.
    "YOLO_MJPEG_ADAPTIVE_FPS": "0",
    "YOLO_MJPEG_ADAPTIVE_HEADROOM": "1.15",
    "YOLO_MJPEG_ADAPTIVE_MIN_FPS": "8",
    "YOLO_MJPEG_BURST_NEW": "1",
    "YOLO_MJPEG_BURST_CAP_FPS": "35",
}

# Lidas em cada frame ao desenhar overlay (web_dashboard). POST /api/settings aplica sem reinício.
# Defaults só para snapshot /api/settings quando a chave ainda não está no ambiente.
OVERLAY_SNAPSHOT_DEFAULTS: dict[str, str] = {
    "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC": "0.5",
    "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC": "0.5",
}

SETTINGS_DRAW_LOOP_ENV_KEYS: frozenset[str] = frozenset(
    {
        "YOLO_HIDE_STALE_BOXES",
        "YOLO_OVERLAY_MIN_DET_CONF",
        "YOLO_OVERLAY_MIN_DET_CONF_VEHICLE",
        "YOLO_OVERLAY_VEHICLE_MIN_WIDTH_FRAC",
        "YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC",
        "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC",
        "YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC",
        "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC",
        "YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC",
        "YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC",
        "YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF",
    }
)

# Chaves que o Flask aplica em memória sem reinício nem reabertura do stream YOLO.
SETTINGS_RUNTIME_APPLY_KEYS: frozenset[str] = frozenset(MJPEG_ENV_DEFAULTS.keys())

EDITABLE_ENV_KEYS: tuple[str, ...] = (
    "YOLO_DEVICE",
    "YOLO_NO_HALF",
    "YOLO_INFER_MODEL",
    "PERSON_CLASS_ID",
    "COUNT_CLASS_IDS",
    "YOLO_CLASS_DISPLAY_LABELS",
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
    "YOLO_OVERLAY_MIN_DET_CONF",
    "YOLO_OVERLAY_MIN_DET_CONF_VEHICLE",
    "YOLO_OVERLAY_VEHICLE_MIN_WIDTH_FRAC",
    "YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC",
    "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC",
    "YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC",
    "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC",
    "YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC",
    "YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC",
    "YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF",
    "YOLO_SHAPE_FILTER_NONPERSON",
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
    # Limiares de contagem (confiança do rastreamento)
    "TRACK_CONF_SUPPRESS_THRESHOLD",
    "TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD",
    "TRACK_CONF_MIN_AGE_FRAMES",
    # Reconexão de stream / watchdog
    "YOLO_WATCHDOG_SOFT_S",
    "YOLO_WATCHDOG_HARD_S",
    "YOLO_FEED_STALE_S",
    # MJPEG (/video_feed): ritmo de imagens no browser
    "YOLO_MJPEG_MAX_FPS",
    "YOLO_MJPEG_ADAPTIVE_FPS",
    "YOLO_MJPEG_ADAPTIVE_HEADROOM",
    "YOLO_MJPEG_ADAPTIVE_MIN_FPS",
    "YOLO_MJPEG_BURST_NEW",
    "YOLO_MJPEG_BURST_CAP_FPS",
    # Persistência e analytics
    "ANALYTICS_KAFKA_PUBLISH",
    "DATABASE_URL",
    "KAFKA_BOOTSTRAP_SERVERS",
    # Alertas
    "ALERT_CAP_ENABLED",
    "ALERT_CAP_THRESHOLD",
    "ALERT_CAR_COLOR",
    "ALERT_COOLDOWN",
)


def snapshot_editable_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for k in EDITABLE_ENV_KEYS:
        v = os.environ.get(k, "")
        if (not v) and k in MJPEG_ENV_DEFAULTS:
            v = MJPEG_ENV_DEFAULTS[k]
        if (not v) and k in OVERLAY_SNAPSHOT_DEFAULTS:
            v = OVERLAY_SNAPSHOT_DEFAULTS[k]
        out[k] = v
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


def apply_settings_updates_to_environ(updates: dict[str, str]) -> None:
    """Reflecte valores guardados no processo actual (os.environ)."""
    for k, v in updates.items():
        os.environ[k] = v


def settings_updates_require_restart(keys: set[str] | frozenset[str]) -> bool:
    """Modelo, GPU, bind HTTP, heatmap no processo, fonte inicial, filtros geometricos, etc."""
    fk = frozenset(keys) - SETTINGS_RUNTIME_APPLY_KEYS - SETTINGS_DRAW_LOOP_ENV_KEYS
    if not fk:
        return False
    return bool(fk - SETTINGS_STREAM_RELOAD_KEYS)


def settings_updates_trigger_stream_reload(keys: set[str] | frozenset[str]) -> bool:
    fk = frozenset(keys) - SETTINGS_RUNTIME_APPLY_KEYS - SETTINGS_DRAW_LOOP_ENV_KEYS
    if not fk:
        return False
    return bool(fk & SETTINGS_STREAM_RELOAD_KEYS)


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
