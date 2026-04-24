#!/usr/bin/env bash
# Pre-anota frames novos usando o exp-25.pt como teacher (recall alto).
#
# Uso:
#   bash scripts/auto_label.sh <pasta_imagens> [pasta_destino]
#
# Ex.:
#   bash scripts/auto_label.sh outputs/frames_extracted_2026-04-24 \
#                              outputs/auto_labeled_2026-04-24
#
# Variaveis opcionais:
#   TEACHER=<caminho.pt>         default: runs/.../exp-25.pt
#   CLASSES=0                    so Pessoa
#   CONF=0.20                    minimo de confianca
#   IMGSZ=1280
#   DEVICE=0                     0/cpu/auto
#   BATCH=8
#   IMAGE_MODE=symlink           symlink|copy|none
#   RECURSIVE=1                  varre subpastas
#   KEEP_EMPTY=0                 1 = guarda imagens sem bbox como background
#   MAX_IMAGES=0                 0 = todas (use 20 para teste)

set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Uso: bash scripts/auto_label.sh <pasta_imagens> [pasta_destino]" >&2
  exit 1
fi

SRC="$1"
DST="${2:-outputs/auto_labeled}"

TEACHER="${TEACHER:-runs/detect/amaro-neto/count_person/yolov8m-door-counter25/exp-25.pt}"
CLASSES="${CLASSES:-0}"
CONF="${CONF:-0.20}"
IMGSZ="${IMGSZ:-1280}"
DEVICE="${DEVICE:-${YOLO_DEVICE:-0}}"
BATCH="${BATCH:-8}"
IMAGE_MODE="${IMAGE_MODE:-symlink}"
MAX_IMAGES="${MAX_IMAGES:-0}"

PY="${PY:-.venv/bin/python3}"
[ -x "${PY}" ] || PY="/home/amaro-neto/.venv/bin/python3"
[ -x "${PY}" ] || PY="python3"

ARGS=(
  --teacher "${TEACHER}"
  --images  "${SRC}"
  --out     "${DST}"
  --classes "${CLASSES}"
  --conf    "${CONF}"
  --imgsz   "${IMGSZ}"
  --device  "${DEVICE}"
  --batch   "${BATCH}"
  --image-mode "${IMAGE_MODE}"
  --max-images "${MAX_IMAGES}"
)
[ "${RECURSIVE:-1}" = "1" ] && ARGS+=( --recursive )
[ "${KEEP_EMPTY:-0}" = "1" ] && ARGS+=( --keep-empty )

echo "[auto_label] PY=${PY}"
echo "[auto_label] TEACHER=${TEACHER}"
echo "[auto_label] SRC=${SRC} -> DST=${DST}"
echo "[auto_label] classes=${CLASSES} conf=${CONF} imgsz=${IMGSZ} device=${DEVICE}"

"${PY}" src/auto_label_with_teacher.py "${ARGS[@]}"
