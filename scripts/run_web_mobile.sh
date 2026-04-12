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

SOURCE=""
USE_YOUTUBE=0

if [ "$#" -gt 0 ]; then
  if [ "${1}" = "--youtube" ] || [ "${1}" = "--youte" ]; then
    if [ -z "${2:-}" ]; then
      echo "Uso: $0 [URL_DO_STREAM | --youtube URL_DO_YOUTUBE | sem argumento]" >&2
      exit 1
    fi
    if [ "${1}" = "--youte" ]; then
      echo "[run_web_mobile] Aviso: use --youtube (correcao ortografica)." >&2
    fi
    SOURCE="$2"
    USE_YOUTUBE=1
    shift 2
  elif [ -n "${1:-}" ]; then
    SOURCE="$1"
    shift
  fi
fi

if [ -z "${SOURCE}" ]; then
  SOURCE="${YOLO_WEB_SOURCE:-}"
fi

if [ -n "${SOURCE}" ]; then
  export WEB_HOST="${WEB_HOST:-0.0.0.0}"
  export WEB_PORT="${WEB_MOBILE_PORT:-8081}"
  if [ "${USE_YOUTUBE}" = "1" ]; then
    export YOLO_WEB_YOUTUBE_URL="${SOURCE}"
    unset YOLO_WEB_SOURCE || true
  else
    export YOLO_WEB_SOURCE="${SOURCE}"
    unset YOLO_WEB_YOUTUBE_URL || true
  fi
  bash "${SCRIPT_DIR}/run_web.sh"
  exit 0
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
