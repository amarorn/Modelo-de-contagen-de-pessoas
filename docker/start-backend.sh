#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${YOLO_INFER_MODEL:-runs/people_count/yolov8m-door-counter/weights/best.pt}"
SOURCE="${YOLO_WEB_SOURCE:-0}"
LINE_DEF="${COUNT_LINE:-960,300,960,900}"
CONF_THRES="${YOLO_WEB_INFER_CONF:-${YOLO_INFER_CONF:-0.22}}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
IOU_NMS="${YOLO_INFER_IOU:-0.5}"
MAX_DET="${YOLO_MAX_DET:-200}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-8080}"

exec python src/web_dashboard.py \
  --model "${MODEL_PATH}" \
  --source "${SOURCE}" \
  --line "${LINE_DEF}" \
  --conf "${CONF_THRES}" \
  --imgsz "${IMGSZ}" \
  --iou "${IOU_NMS}" \
  --max-det "${MAX_DET}" \
  --host "${WEB_HOST}" \
  --port "${WEB_PORT}"
