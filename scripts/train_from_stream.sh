#!/usr/bin/env bash
set -euo pipefail

# Pipeline fim-a-fim para "treinar a partir de stream":
# 1) extrai frames do stream
# 2) (opcional) pre-anota com teacher model
# 3) divide em train/val/test
# 4) (opcional) dispara treino YOLO
#
# Uso basico:
#   bash scripts/train_from_stream.sh 'rtsp://...'
#
# Com pre-anotacao + treino:
#   AUTO_LABEL=1 TRAIN_NOW=1 TEACHER=weights/best.pt bash scripts/train_from_stream.sh 'https://...m3u8'
#
# Variaveis principais:
#   AUTO_LABEL=0|1       (default 0)
#   TRAIN_NOW=0|1        (default 0)
#   OUT_ROOT             (default data/person_count)
#   SPLIT_MODE           (default time; time|scene|random)
#   SPLIT_TRAIN          (default 0.7)
#   SPLIT_VAL            (default 0.2)
#   SPLIT_TEST           (default 0.1)
#   SPLIT_USE_SYMLINK=1  usa symlink no split (default 1)
#   YOLO_*               reaproveitadas por scripts/run_train.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

URL="${1:-${URL_HLS_OU_RTSP_OU_FICHEIRO:-}}"
if [ -z "${URL}" ] && [ -n "${YOLO_WEB_SOURCE:-}" ]; then
  case "${YOLO_WEB_SOURCE}" in
    http://*|https://*|rtsp://*) URL="${YOLO_WEB_SOURCE}" ;;
  esac
fi
if [ -z "${URL}" ]; then
  echo "Uso: $0 '<url_do_stream>'" >&2
  echo "  ou defina URL_HLS_OU_RTSP_OU_FICHEIRO/YOLO_WEB_SOURCE no .env" >&2
  exit 1
fi

RUN_ID="${RUN_ID:-$(date +%Y%m%d_%H%M%S)}"
OUT_ROOT="${OUT_ROOT:-data/person_count}"
RAW_STAGING_DIR="${RAW_STAGING_DIR:-${OUT_ROOT}/images/staging_${RUN_ID}}"
AUTO_LABEL="${AUTO_LABEL:-0}"
TRAIN_NOW="${TRAIN_NOW:-0}"
TRAIN_SCRIPT="${TRAIN_SCRIPT:-scripts/run_train.sh}"
SPLIT_MODE="${SPLIT_MODE:-time}"
SPLIT_TRAIN="${SPLIT_TRAIN:-0.7}"
SPLIT_VAL="${SPLIT_VAL:-0.2}"
SPLIT_TEST="${SPLIT_TEST:-0.1}"
SPLIT_USE_SYMLINK="${SPLIT_USE_SYMLINK:-1}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

echo "[stream_train] run_id=${RUN_ID}"
echo "[stream_train] fonte=${URL}"
echo "[stream_train] extracao -> ${RAW_STAGING_DIR}"

bash scripts/extract_frames_from_stream.sh "${URL}" "${RAW_STAGING_DIR}"

SPLIT_SOURCE="${RAW_STAGING_DIR}"
if [ "${AUTO_LABEL}" = "1" ]; then
  AUTO_LABEL_OUT="${AUTO_LABEL_OUT:-${OUT_ROOT}/auto_labeled/${RUN_ID}}"
  echo "[stream_train] AUTO_LABEL=1 -> pre-anotacao em ${AUTO_LABEL_OUT}"
  bash scripts/auto_label.sh "${RAW_STAGING_DIR}" "${AUTO_LABEL_OUT}"
  SPLIT_SOURCE="${AUTO_LABEL_OUT}/images"
  echo "[stream_train] IMPORTANTE: revise as labels antes de treinar em producao."
else
  echo "[stream_train] AUTO_LABEL=0 -> rotule os frames manualmente antes do treino."
fi

SPLIT_ARGS=(
  scripts/split_dataset.py
  --source "${SPLIT_SOURCE}"
  --out-root "${OUT_ROOT}"
  --mode "${SPLIT_MODE}"
  --train "${SPLIT_TRAIN}"
  --val "${SPLIT_VAL}"
  --test "${SPLIT_TEST}"
)
if [ "${SPLIT_USE_SYMLINK}" = "1" ]; then
  SPLIT_ARGS+=(--symlink)
fi

echo "[stream_train] split -> ${OUT_ROOT}/images/{train,val,test}"
"${PYTHON_BIN}" "${SPLIT_ARGS[@]}"

if [ "${TRAIN_NOW}" = "1" ]; then
  echo "[stream_train] TRAIN_NOW=1 -> iniciar treino (${TRAIN_SCRIPT})"
  bash "${TRAIN_SCRIPT}"
else
  echo "[stream_train] Pipeline concluido (sem treino automatico)."
  echo "[stream_train] Para treinar agora:"
  echo "  TRAIN_NOW=1 AUTO_LABEL=${AUTO_LABEL} bash scripts/train_from_stream.sh '${URL}'"
fi

