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
CONF_THRES="${YOLO_INFER_CONF:-0.22}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_MOBILE_PORT:-8081}"
MOBILE_COUNT_LINE="${MOBILE_COUNT_LINE:-0.5,0.3,0.5,0.9}"

python3 -m pip install -r requirements.txt

python3 src/web_mobile_camera.py \
  --model "${MODEL_PATH}" \
  --conf "${CONF_THRES}" \
  --imgsz "${IMGSZ}" \
  ${PERSON_CLASS_ID:+--person-class-id "${PERSON_CLASS_ID}"} \
  --line "${MOBILE_COUNT_LINE}" \
  --host "${WEB_HOST}" \
  --port "${WEB_PORT}"
