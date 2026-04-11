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

# OpenCV+FFmpeg: ler antes de importar cv2 no Python. Reduz buffer em HLS/HTTP (menos atraso vs. live).
# Sobrescreva no .env se o stream falhar (ex.: rtsp_transport;tcp para RTSP).
if [ -z "${OPENCV_FFMPEG_CAPTURE_OPTIONS:-}" ]; then
  export OPENCV_FFMPEG_CAPTURE_OPTIONS="fflags;nobuffer|max_delay;500000"
fi

# Preferir venv (yt-dlp/python do sistema podem ser 3.6 e falhar no YouTube).
if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
  PYTHON="${ROOT_DIR}/.venv/bin/python"
  YT_DLP="${ROOT_DIR}/.venv/bin/yt-dlp"
else
  PYTHON="python3"
  YT_DLP="yt-dlp"
fi

# Opcional: ./scripts/run_web.sh --youtube 'https://www.youtube.com/watch?v=...'
YOLO_WEB_YOUTUBE_URL="${YOLO_WEB_YOUTUBE_URL:-}"
REMAINING=()
while [ $# -gt 0 ]; do
  case "$1" in
    --youtube)
      if [ -z "${2:-}" ]; then
        echo "Uso: $0 --youtube 'URL_DO_YOUTUBE_LIVE' [outros args...]" >&2
        exit 1
      fi
      YOLO_WEB_YOUTUBE_URL="$2"
      shift 2
      ;;
    *)
      REMAINING+=("$1")
      shift
      ;;
  esac
done
set -- "${REMAINING[@]}"

resolve_stream_url() {
  local url="$1"
  if [ ! -x "$YT_DLP" ] && ! command -v yt-dlp >/dev/null 2>&1; then
    echo "[run_web] Instale yt-dlp no venv: ${PYTHON} -m pip install -U yt-dlp" >&2
    exit 1
  fi
  local bin="$YT_DLP"
  command -v "$bin" >/dev/null 2>&1 || bin="yt-dlp"
  echo "[run_web] A obter URL HLS com yt-dlp (pode falhar se o YouTube exigir cliente atualizado)..." >&2
  "$bin" -g -f "best[height<=720]" "$url" 2>/dev/null | tail -1
}

MODEL_PATH="${YOLO_INFER_MODEL:-runs/people_count/yolov8m-door-counter/weights/best.pt}"
if [ -n "${YOLO_WEB_YOUTUBE_URL}" ]; then
  SOURCE="$(resolve_stream_url "${YOLO_WEB_YOUTUBE_URL}")"
  if [ -z "${SOURCE}" ]; then
    echo "[run_web] Falha ao resolver stream. Atualize: ${PYTHON} -m pip install -U yt-dlp" >&2
    echo "[run_web] Alternativa: URL=\$(.venv/bin/yt-dlp -g -f 'best[height<=720]' 'URL') && YOLO_WEB_SOURCE=\"\$URL\" ./scripts/run_web.sh" >&2
    exit 1
  fi
else
  SOURCE="${1:-${YOLO_WEB_SOURCE:-0}}"
fi

# Linha em 720p (ex. stream YouTube): ajuste COUNT_LINE no .env se o video for 1280x720.
LINE_DEF="${COUNT_LINE:-960,300,960,900}"
CONF_THRES="${YOLO_INFER_CONF:-0.22}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
IOU_NMS="${YOLO_INFER_IOU:-0.5}"
MAX_DET="${YOLO_MAX_DET:-200}"
YOLO_AUGMENT="${YOLO_AUGMENT:-0}"
YOLO_AGNOSTIC_NMS="${YOLO_AGNOSTIC_NMS:-0}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"

YOLO_DEVICE="${YOLO_DEVICE:-auto}"
YOLO_NO_HALF="${YOLO_NO_HALF:-0}"
YOLO_VID_STRIDE="${YOLO_VID_STRIDE:-1}"
# 0 = frame mais recente (menos latencia em HLS/HTTP). 1 = fila ate ~30 frames se a inferencia atrasar o decode.
YOLO_STREAM_BUFFER="${YOLO_STREAM_BUFFER:-0}"
YOLO_TRACKER="${YOLO_TRACKER:-bytetrack.yaml}"
YOLO_TRACK_EMA="${YOLO_TRACK_EMA:-0.35}"
YOLO_TRACK_HOLD_FRAMES="${YOLO_TRACK_HOLD_FRAMES:-25}"
YOLO_NO_SHAPE_FILTER="${YOLO_NO_SHAPE_FILTER:-0}"
YOLO_MIN_PERSON_AR="${YOLO_MIN_PERSON_AR:-0.85}"
YOLO_MAX_PERSON_AR="${YOLO_MAX_PERSON_AR:-4.0}"
YOLO_MAX_BOX_AREA_FRAC="${YOLO_MAX_BOX_AREA_FRAC:-0.14}"
YOLO_MIN_PERSON_HEIGHT_PX="${YOLO_MIN_PERSON_HEIGHT_PX:-28}"
YOLO_SEX_MODEL="${YOLO_SEX_MODEL:-}"
YOLO_SEX_ABSTAIN="${YOLO_SEX_ABSTAIN:-0.65}"

WEB_HOST="${WEB_HOST:-0.0.0.0}"
WEB_PORT="${WEB_PORT:-8080}"

WEB_HEATMAP="${WEB_HEATMAP:-1}"
HEAT_SCALE="${HEAT_SCALE:-4}"
HEAT_DECAY="${HEAT_DECAY:-0.985}"
HEAT_RADIUS="${HEAT_RADIUS:-10}"
HEAT_ALPHA="${HEAT_ALPHA:-0.42}"
HEAT_GAIN="${HEAT_GAIN:-1.0}"

"${PYTHON}" -m pip install -q -r requirements.txt

"${PYTHON}" -c "import torch; print('[run_web] torch.cuda.is_available():', torch.cuda.is_available(), '| device_count:', torch.cuda.device_count())" 2>/dev/null || true
if [ "${YOLO_NO_HALF}" = "1" ]; then
  if "${PYTHON}" -c "import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)" 2>/dev/null; then
    echo "[run_web] Aviso: YOLO_NO_HALF=1 forca FP32 na GPU; para mais FPS use YOLO_NO_HALF=0 (FP16). WEB_HEATMAP=0 reduz CPU por frame." >&2
  fi
fi

WEB_ARGS=(
  "$PYTHON"
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
WEB_ARGS+=(--device "${YOLO_DEVICE}")
if [ "${YOLO_NO_HALF}" = "1" ]; then
  WEB_ARGS+=(--no-half)
fi
WEB_ARGS+=(--vid-stride "${YOLO_VID_STRIDE}")
if [ "${YOLO_STREAM_BUFFER}" = "1" ]; then
  WEB_ARGS+=(--stream-buffer)
fi
WEB_ARGS+=(
  --tracker "${YOLO_TRACKER}"
  --track-ema "${YOLO_TRACK_EMA}"
  --track-hold-frames "${YOLO_TRACK_HOLD_FRAMES}"
)
if [ "${YOLO_NO_SHAPE_FILTER}" = "1" ]; then
  WEB_ARGS+=(--no-shape-filter)
fi
WEB_ARGS+=(
  --min-person-ar "${YOLO_MIN_PERSON_AR}"
  --max-person-ar "${YOLO_MAX_PERSON_AR}"
  --max-box-area-frac "${YOLO_MAX_BOX_AREA_FRAC}"
  --min-person-height-px "${YOLO_MIN_PERSON_HEIGHT_PX}"
)
if [ -n "${YOLO_SEX_MODEL}" ]; then
  WEB_ARGS+=(--sex-model "${YOLO_SEX_MODEL}" --sex-abstain "${YOLO_SEX_ABSTAIN}")
fi
WEB_ARGS+=(--host "${WEB_HOST}" --port "${WEB_PORT}")

echo "[run_web] model=${MODEL_PATH} YOLO_DEVICE=${YOLO_DEVICE} YOLO_STREAM_BUFFER=${YOLO_STREAM_BUFFER} YOLO_VID_STRIDE=${YOLO_VID_STRIDE} OPENCV_FFMPEG_CAPTURE_OPTIONS=${OPENCV_FFMPEG_CAPTURE_OPTIONS:0:60}..."
echo "[run_web] Se vir 'Waiting for stream' em loop: YOLO_STREAM_BUFFER=1, ou aumente YOLO_VID_STRIDE, GPU (newgrp video), ou URL HLS valida (yt-dlp -g)."
echo "[run_web] Logs OpenCV/Ultralytics reduzidos por defeito; export YOLO_WEB_VERBOSE=1 para avisos completos."
"${WEB_ARGS[@]}"
