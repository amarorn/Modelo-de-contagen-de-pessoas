#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < .env
fi

MODEL_PATH="${YOLO_INFER_MODEL:-runs/people_count/yolov8m-door-counter/weights/best.pt}"
SOURCE="${1:-${YOLO_WEB_SOURCE:-0}}"
LINE_DEF="${COUNT_LINE:-960,300,960,900}"
CONF_THRES="${YOLO_INFER_CONF:-0.22}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
IOU_NMS="${YOLO_INFER_IOU:-0.5}"
MAX_DET="${YOLO_MAX_DET:-200}"
YOLO_AUGMENT="${YOLO_AUGMENT:-0}"
YOLO_AGNOSTIC_NMS="${YOLO_AGNOSTIC_NMS:-0}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"

WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-8080}"

WEB_HEATMAP="${WEB_HEATMAP:-1}"
HEAT_SCALE="${HEAT_SCALE:-4}"
HEAT_DECAY="${HEAT_DECAY:-0.985}"
HEAT_RADIUS="${HEAT_RADIUS:-10}"
HEAT_ALPHA="${HEAT_ALPHA:-0.42}"
HEAT_GAIN="${HEAT_GAIN:-1.0}"

python3 -m pip install -r requirements.txt

# Um unico array evita "${arr[@]}" vazio com set -u (bash no macOS).
WEB_ARGS=(
  python3
  src/web_dashboard.py
  --model "${MODEL_PATH}"
  --source "${SOURCE}"
  --line "${LINE_DEF}"
  --conf "${CONF_THRES}"
  --imgsz "${IMGSZ}"
  --iou "${IOU_NMS}"
  --max-det "${MAX_DET}"
)
if [ "${YOLO_AUGMENT}" = "1" ]; then
  WEB_ARGS+=(--augment)
fi
if [ "${YOLO_AGNOSTIC_NMS}" = "1" ]; then
  WEB_ARGS+=(--agnostic-nms)
fi
if [ "${WEB_HEATMAP}" = "0" ]; then
  WEB_ARGS+=(--no-heatmap)
else
  WEB_ARGS+=(
    --heat-scale "${HEAT_SCALE}"
    --heat-decay "${HEAT_DECAY}"
    --heat-radius "${HEAT_RADIUS}"
    --heat-alpha "${HEAT_ALPHA}"
    --heat-gain "${HEAT_GAIN}"
  )
fi
if [ -n "${PERSON_CLASS_ID}" ]; then
  WEB_ARGS+=(--person-class-id "${PERSON_CLASS_ID}")
fi
WEB_ARGS+=(--host "${WEB_HOST}" --port "${WEB_PORT}")

"${WEB_ARGS[@]}"
