#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# Preferir venv antes de carregar .env (parser Python com shlex para JSON e valores com '=').
if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
  PYTHON="${ROOT_DIR}/.venv/bin/python"
  YT_DLP="${ROOT_DIR}/.venv/bin/yt-dlp"
else
  PYTHON="python3"
  YT_DLP="yt-dlp"
fi

if [ -f .env ]; then
  eval "$("${PYTHON}" - <<'PY'
import re
from pathlib import Path
from shlex import quote

def main() -> None:
    p = Path(".env")
    if not p.is_file():
        return
    text = p.read_text(encoding="utf-8", errors="replace")
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        if s.lower().startswith("export "):
            s = s[7:].strip()
        if "=" not in s:
            continue
        k, _, rest = s.partition("=")
        k = k.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k):
            continue
        v = rest
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
            v = v[1:-1]
        print(f"export {k}={quote(v)}")

main()
PY
)"
fi

# OpenCV+FFmpeg: ler antes de importar cv2 no Python. Reduz buffer em HLS/HTTP (menos atraso vs. live).
# Sobrescreva no .env se o stream falhar (ex.: rtsp_transport;tcp para RTSP).
if [ -z "${OPENCV_FFMPEG_CAPTURE_OPTIONS:-}" ]; then
  export OPENCV_FFMPEG_CAPTURE_OPTIONS="fflags;nobuffer|max_delay;500000"
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

# Sem URL na CLI: YOLO_WEB_SOURCE=0 tenta webcam; sem USB falha. Usar 1. URL de YOLO_WEB_SOURCE_PRESETS.
if [ -z "${1:-}" ] && [ "${SOURCE}" = "0" ]; then
  _preset_url="$("${PYTHON}" - <<'PY'
import json
import os

raw = os.environ.get("YOLO_WEB_SOURCE_PRESETS", "")
try:
    presets = json.loads(raw)
    if isinstance(presets, list) and presets and isinstance(presets[0], dict):
        u = (presets[0].get("url") or "").strip()
        if u:
            print(u)
except Exception:
    pass
PY
)"
  if [ -n "${_preset_url}" ]; then
    export YOLO_WEB_SOURCE="${_preset_url}"
    SOURCE="${_preset_url}"
    echo "[run_web] Fonte era 0 sem argumento na CLI: a usar a primeira URL de YOLO_WEB_SOURCE_PRESETS. Webcam USB: ./scripts/run_web.sh 0" >&2
  fi
fi

unset YOLO_WEB_FORCE_WEBCAM 2>/dev/null || true
if [ -n "${1:-}" ] && [[ "$1" =~ ^[0-9]+$ ]]; then
  export YOLO_WEB_FORCE_WEBCAM=1
fi

# Linha em 720p (ex. stream YouTube): ajuste COUNT_LINE no .env se o video for 1280x720.
LINE_DEF="${COUNT_LINE:-960,300,960,900}"
# Limiar de confianca: por omissao YOLO_INFER_CONF (ex. 0.25 em RTSP). Para camera local (webcam) com poucas caixas,
# defina YOLO_WEB_INFER_CONF=0.02 (mesmo racional que YOLO_MOBILE_INFER_CONF em scripts/run_web_mobile.sh).
CONF_THRES="${YOLO_WEB_INFER_CONF:-${YOLO_INFER_CONF:-0.22}}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
IOU_NMS="${YOLO_INFER_IOU:-0.5}"
MAX_DET="${YOLO_MAX_DET:-200}"
YOLO_AUGMENT="${YOLO_AUGMENT:-0}"
YOLO_AGNOSTIC_NMS="${YOLO_AGNOSTIC_NMS:-0}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"
COUNT_CLASS_IDS="${COUNT_CLASS_IDS:-}"

YOLO_DEVICE="${YOLO_DEVICE:-auto}"
YOLO_NO_HALF="${YOLO_NO_HALF:-0}"
YOLO_VID_STRIDE="${YOLO_VID_STRIDE:-1}"
# 0 = frame mais recente (menos latencia em HLS/HTTP). 1 = fila ate ~30 frames se a inferencia atrasar o decode.
YOLO_STREAM_BUFFER="${YOLO_STREAM_BUFFER:-0}"
YOLO_TRACKER="${YOLO_TRACKER:-bytetrack.yaml}"
YOLO_TRACK_EMA="${YOLO_TRACK_EMA:-0.35}"
YOLO_TRACK_HOLD_FRAMES="${YOLO_TRACK_HOLD_FRAMES:-25}"
YOLO_WEB_TRAIL_LEN="${YOLO_WEB_TRAIL_LEN:-72}"
YOLO_WEB_HEADING="${YOLO_WEB_HEADING:-1}"
YOLO_STATIONARY_MIN_POINTS="${YOLO_STATIONARY_MIN_POINTS:-6}"
YOLO_STATIONARY_MAX_SPEED="${YOLO_STATIONARY_MAX_SPEED:-2.2}"
YOLO_LOITERING_SECONDS="${YOLO_LOITERING_SECONDS:-10}"
YOLO_NO_SHAPE_FILTER="${YOLO_NO_SHAPE_FILTER:-0}"
YOLO_MIN_PERSON_AR="${YOLO_MIN_PERSON_AR:-0.85}"
YOLO_MAX_PERSON_AR="${YOLO_MAX_PERSON_AR:-4.0}"
YOLO_MAX_BOX_AREA_FRAC="${YOLO_MAX_BOX_AREA_FRAC:-0.14}"
YOLO_MAX_NONPERSON_AREA_FRAC="${YOLO_MAX_NONPERSON_AREA_FRAC:-0.92}"
YOLO_MIN_PERSON_HEIGHT_PX="${YOLO_MIN_PERSON_HEIGHT_PX:-28}"
YOLO_SEX_MODEL="${YOLO_SEX_MODEL:-}"
YOLO_SEX_ABSTAIN="${YOLO_SEX_ABSTAIN:-0.65}"
YOLO_AGE_MODEL="${YOLO_AGE_MODEL:-}"
YOLO_AGE_ABSTAIN="${YOLO_AGE_ABSTAIN:-0.55}"
ALERT_CAP_ENABLED="${ALERT_CAP_ENABLED:-0}"
ALERT_CAP_THRESHOLD="${ALERT_CAP_THRESHOLD:-0.55}"
ALERT_CAR_COLOR="${ALERT_CAR_COLOR:-}"
ALERT_CAR_COLOR_MIN_SCORE="${ALERT_CAR_COLOR_MIN_SCORE:-0.08}"
ALERT_COOLDOWN="${ALERT_COOLDOWN:-3.0}"
ALERT_SERVER_BEEP="${ALERT_SERVER_BEEP:-0}"

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
if [ -n "${COUNT_CLASS_IDS}" ]; then
  WEB_ARGS+=(--count-class-ids "${COUNT_CLASS_IDS}")
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
  --trail-len "${YOLO_WEB_TRAIL_LEN}"
  --stationary-min-points "${YOLO_STATIONARY_MIN_POINTS}"
  --stationary-max-speed "${YOLO_STATIONARY_MAX_SPEED}"
  --loitering-seconds "${YOLO_LOITERING_SECONDS}"
)
if [ "${YOLO_NO_SHAPE_FILTER}" = "1" ]; then
  WEB_ARGS+=(--no-shape-filter)
fi
WEB_ARGS+=(
  --min-person-ar "${YOLO_MIN_PERSON_AR}"
  --max-person-ar "${YOLO_MAX_PERSON_AR}"
  --max-box-area-frac "${YOLO_MAX_BOX_AREA_FRAC}"
  --max-nonperson-area-frac "${YOLO_MAX_NONPERSON_AREA_FRAC}"
  --min-person-height-px "${YOLO_MIN_PERSON_HEIGHT_PX}"
)
if [ -n "${YOLO_SEX_MODEL}" ]; then
  WEB_ARGS+=(--sex-model "${YOLO_SEX_MODEL}" --sex-abstain "${YOLO_SEX_ABSTAIN}")
fi
if [ -n "${YOLO_AGE_MODEL}" ]; then
  WEB_ARGS+=(--age-model "${YOLO_AGE_MODEL}" --age-abstain "${YOLO_AGE_ABSTAIN}")
fi
WEB_ARGS+=(--alert-cooldown "${ALERT_COOLDOWN}")
if [ "${ALERT_CAP_ENABLED}" = "1" ]; then
  WEB_ARGS+=(--cap-alert --cap-alert-threshold "${ALERT_CAP_THRESHOLD}")
fi
if [ -n "${ALERT_CAR_COLOR}" ]; then
  WEB_ARGS+=(--car-color-alert "${ALERT_CAR_COLOR}" --car-color-min-score "${ALERT_CAR_COLOR_MIN_SCORE}")
fi
if [ "${ALERT_SERVER_BEEP}" = "1" ]; then
  WEB_ARGS+=(--alert-server-beep)
fi
if [ "${YOLO_WEB_HEADING}" = "0" ]; then
  WEB_ARGS+=(--no-heading-arrow)
fi
WEB_ARGS+=(--host "${WEB_HOST}" --port "${WEB_PORT}")

echo "[run_web] model=${MODEL_PATH} conf=${CONF_THRES} YOLO_DEVICE=${YOLO_DEVICE} YOLO_STREAM_BUFFER=${YOLO_STREAM_BUFFER} YOLO_VID_STRIDE=${YOLO_VID_STRIDE} OPENCV_FFMPEG_CAPTURE_OPTIONS=${OPENCV_FFMPEG_CAPTURE_OPTIONS:0:60}..."
echo "[run_web] watchdog soft=${YOLO_WATCHDOG_SOFT_S:-} hard=${YOLO_WATCHDOG_HARD_S:-} (definir no .env; vazio herda defaults do Python)"
if [[ "${SOURCE:-}" =~ ^[0-9]+$ ]]; then
  echo "[run_web] Aviso: fonte por indice (${SOURCE}) (webcam). Sem dispositivo valido o OpenCV emite 'obsensor_uvc' / Camera index out of range; use URL no .env ou preset na UI." >&2
fi
echo "[run_web] Se vir 'Waiting for stream' em loop: YOLO_STREAM_BUFFER=1, ou aumente YOLO_VID_STRIDE, GPU (newgrp video), ou URL HLS valida (yt-dlp -g)."
echo "[run_web] Logs OpenCV/Ultralytics reduzidos por defeito; export YOLO_WEB_VERBOSE=1 para avisos completos."
echo "[run_web] MJPEG: limite de FPS em YOLO_MJPEG_MAX_FPS (default 10) para nao saturar a API Flask."

if [ "${RUN_WEB_NO_RESTART:-0}" = "1" ]; then
  "${WEB_ARGS[@]}"
  exit $?
fi

RESTART_DELAY_S="${RUN_WEB_RESTART_DELAY_S:-3}"
MAX_RESTART_PER_MIN="${RUN_WEB_MAX_RESTART_PER_MIN:-8}"
_restart_ts_start=$(date +%s)
_restart_count=0
while true; do
  set +e
  "${WEB_ARGS[@]}"
  status=$?
  set -e
  case "${status}" in
    0|130|143)
      echo "[run_web] saida ${status}; encerrando."
      exit ${status}
      ;;
  esac
  now=$(date +%s)
  elapsed=$(( now - _restart_ts_start ))
  if [ ${elapsed} -ge 60 ]; then
    _restart_ts_start=${now}
    _restart_count=0
  fi
  _restart_count=$(( _restart_count + 1 ))
  if [ ${_restart_count} -gt ${MAX_RESTART_PER_MIN} ]; then
    echo "[run_web] >${MAX_RESTART_PER_MIN} reinicios/min (exit=${status}); abortando." >&2
    exit ${status}
  fi
  echo "[run_web] exit=${status}; reinicio em ${RESTART_DELAY_S}s (#${_restart_count})..."
  sleep "${RESTART_DELAY_S}"
done
