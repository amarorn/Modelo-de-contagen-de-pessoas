#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

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
# Webcam + JPEG no browser: scores costumam ser mais baixos que em RTSP/HLS; YOLO_INFER_CONF do dashboard (ex. 0.25) remove quase tudo.
# Omisso 0.02; suba (ex. 0.08) se houver muitos falsos positivos. Para usar o mesmo limiar do dashboard: YOLO_MOBILE_INFER_CONF="${YOLO_INFER_CONF}"
CONF_THRES="${YOLO_MOBILE_INFER_CONF:-0.02}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"
COUNT_CLASS_IDS="${COUNT_CLASS_IDS:-}"
WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_MOBILE_PORT:-8081}"
MOBILE_COUNT_LINE="${MOBILE_COUNT_LINE:-0.5,0.3,0.5,0.9}"
YOLO_DEVICE="${YOLO_DEVICE:-auto}"
YOLO_SEX_MODEL="${YOLO_SEX_MODEL:-}"
YOLO_SEX_ABSTAIN="${YOLO_SEX_ABSTAIN:-0.65}"

if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
  PYTHON="${ROOT_DIR}/.venv/bin/python"
else
  PYTHON="python3"
fi

"${PYTHON}" -m pip install -r requirements.txt

MOBILE_ARGS=(
  --model "${MODEL_PATH}"
  --conf "${CONF_THRES}"
  --imgsz "${IMGSZ}"
  --line "${MOBILE_COUNT_LINE}"
  --host "${WEB_HOST}"
  --port "${WEB_PORT}"
  --device "${YOLO_DEVICE}"
)
if [ -n "${PERSON_CLASS_ID}" ]; then
  MOBILE_ARGS+=(--person-class-id "${PERSON_CLASS_ID}")
fi
if [ -n "${COUNT_CLASS_IDS}" ]; then
  MOBILE_ARGS+=(--count-class-ids "${COUNT_CLASS_IDS}")
fi
if [ -n "${YOLO_SEX_MODEL}" ]; then
  MOBILE_ARGS+=(--sex-model "${YOLO_SEX_MODEL}" --sex-abstain "${YOLO_SEX_ABSTAIN}")
fi

"${PYTHON}" src/web_mobile_camera.py "${MOBILE_ARGS[@]}"
