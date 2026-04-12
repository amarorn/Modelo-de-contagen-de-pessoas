#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# Exemplos:
#   bash scripts/run_inference.sh
#   bash scripts/run_inference.sh rtsp://usuario:senha@ip:554/stream
#   bash scripts/run_inference.sh --headless "outputs/ficheiro.mov"   # sem janela (SSH / sem DISPLAY)
# Com DISPLAY definido (ex.: :0), abre preview (--show). Sem DISPLAY, nunca usa --show (evita crash Qt).
# INFER_SHOW=1 so avisa se pediste janela mas DISPLAY esta vazio. Desativar: --headless ou INFER_NO_SHOW=1

HEADLESS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --headless|--no-show) HEADLESS=1; shift ;;
    *) break ;;
  esac
done

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
LINE_DEF="${COUNT_LINE:-0,540,1919,540}"
CONF_THRES="${YOLO_INFER_CONF:-0.22}"
IMGSZ="${YOLO_INFER_IMGSZ:-1280}"
IOU_NMS="${YOLO_INFER_IOU:-0.5}"
PERSON_CLASS_ID="${PERSON_CLASS_ID:-}"
COUNT_CSV_OUT="${COUNT_CSV_OUT:-}"

if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
  PYTHON="${ROOT_DIR}/.venv/bin/python"
else
  PYTHON="python3"
fi

SHOW_ARGS=()
if [ "$HEADLESS" != "1" ] && [ "${INFER_NO_SHOW:-0}" != "1" ] && [ -n "${DISPLAY:-}" ]; then
  SHOW_ARGS=(--show)
elif [ "${INFER_SHOW:-0}" = "1" ] && [ -z "${DISPLAY:-}" ]; then
  echo "[run_inference] INFER_SHOW=1 ignorado: DISPLAY vazio (este terminal nao tem servidor grafico X11)." >&2
  echo "[run_inference] Opcoes: abrir terminal na sessao de ambiente grafico; ou ssh -X; ou export DISPLAY=:0 na mesma maquina com sessao local iniciada." >&2
fi

INFER_CMD=(
  "${PYTHON}" src/infer_ultralytics_count.py
  --model "${MODEL_PATH}"
  --source "${SOURCE}"
  --line "${LINE_DEF}"
  --conf "${CONF_THRES}"
  --imgsz "${IMGSZ}"
  --iou "${IOU_NMS}"
)
if [ -n "${PERSON_CLASS_ID:-}" ]; then
  INFER_CMD+=(--person-class-id "${PERSON_CLASS_ID}")
fi
if [ -n "${COUNT_CSV_OUT:-}" ]; then
  INFER_CMD+=(--csv-out "${COUNT_CSV_OUT}")
fi
INFER_CMD+=("${SHOW_ARGS[@]}")
"${INFER_CMD[@]}"
