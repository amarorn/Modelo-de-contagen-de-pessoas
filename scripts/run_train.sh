#!/usr/bin/env bash
set -euo pipefail

# Treino com Ultralytics (local ou HUB se token estiver definido em .env).
# Exemplo:
#   bash scripts/run_train.sh

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Ignora linhas vazias e comentarios.
    case "$line" in
      ''|\#*) continue ;;
    esac
    # Aceita apenas chave=valor para evitar erro de parsing.
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < .env
  echo "[train] Variaveis carregadas de .env"
fi

MODEL="${YOLO_MODEL:-yolov8m.pt}"
# Prioridade:
# 1) YOLO_DATA_CONFIG
# 2) ULTRALYTICS_DATASET_SLUG convertido para "<slug>.yaml"
# 3) configs/dataset.yaml local
if [ -n "${YOLO_DATA_CONFIG:-}" ]; then
  DATA="${YOLO_DATA_CONFIG}"
elif [ -n "${ULTRALYTICS_DATASET_SLUG:-}" ]; then
  DATASET_SLUG_CLEAN="${ULTRALYTICS_DATASET_SLUG// /-}"
  DATA="${DATASET_SLUG_CLEAN}.yaml"
else
  DATA="configs/dataset.yaml"
fi
EPOCHS="${YOLO_EPOCHS:-120}"
IMGSZ="${YOLO_IMGSZ:-640}"
BATCH="${YOLO_BATCH:-16}"
DEVICE="${YOLO_DEVICE:-auto}"
WORKERS="${YOLO_WORKERS:-8}"
PATIENCE="${YOLO_PATIENCE:-30}"
CLOSE_MOSAIC="${YOLO_CLOSE_MOSAIC:-10}"

# Se nao vier nome de experimento explicito, usa os campos da plataforma quando existirem.
PROJECT="${YOLO_PROJECT:-${ULTRALYTICS_PLATFORM_PROJECT:-runs/people_count}}"
NAME="${YOLO_EXPERIMENT_NAME:-${ULTRALYTICS_PLATFORM_NAME:-yolov8m-door-counter}}"
# Treinar so classes indicadas (indices no YAML do dataset), ex.: YOLO_CLASSES=6 ou 0 (COCO person=0)
YOLO_CLASSES="${YOLO_CLASSES:-}"

python3 -m pip install -r requirements.txt

EXTRA=()
if [ -n "${YOLO_CLASSES}" ]; then
  EXTRA+=(--classes "${YOLO_CLASSES}")
fi

python3 src/train_ultralytics.py \
  --model "${MODEL}" \
  --data "${DATA}" \
  --epochs "${EPOCHS}" \
  --imgsz "${IMGSZ}" \
  --batch "${BATCH}" \
  --device "${DEVICE}" \
  --workers "${WORKERS}" \
  --patience "${PATIENCE}" \
  --close-mosaic "${CLOSE_MOSAIC}" \
  --project "${PROJECT}" \
  --name "${NAME}" \
  "${EXTRA[@]}"
