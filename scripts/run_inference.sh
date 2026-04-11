#!/usr/bin/env bash
set -euo pipefail

# Exemplo:
#   bash scripts/run_inference.sh
#   bash scripts/run_inference.sh rtsp://usuario:senha@ip:554/stream

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

SOURCE="${1:-0}"
MODEL_PATH="${YOLO_INFER_MODEL:-runs/people_count/yolov8m-door-counter/weights/best.pt}"
LINE_DEF="${COUNT_LINE:-960,300,960,900}"
CONF_THRES="${YOLO_INFER_CONF:-0.22}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
IOU_NMS="${YOLO_INFER_IOU:-0.5}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"
COUNT_CSV_OUT="${COUNT_CSV_OUT:-}"

python3 src/infer_ultralytics_count.py \
  --model "${MODEL_PATH}" \
  --source "${SOURCE}" \
  --line "${LINE_DEF}" \
  --conf "${CONF_THRES}" \
  --imgsz "${IMGSZ}" \
  --iou "${IOU_NMS}" \
  ${PERSON_CLASS_ID:+--person-class-id "${PERSON_CLASS_ID}"} \
  ${COUNT_CSV_OUT:+--csv-out "${COUNT_CSV_OUT}"} \
  --show
