#!/usr/bin/env bash
set -euo pipefail

# Treino v2 — hiperparametros corrigidos apos analise exp-26..exp-30.
# Corre localmente reportando ao Ultralytics HUB (ULTRALYTICS_HUB_API_KEY do .env).
#
# Mudancas face aos experimentos anteriores:
# - modelo base: yolov8s.pt limpo (nao continuar de exp-27 que teve NaN val_loss)
# - lr0 baixo (0.001) + cos_lr -> curvas estaveis, sem oscilacoes de 30-40 pp
# - optimizer AdamW -> melhor para datasets pequenos
# - patience 30 -> para cedo quando estabiliza, evita memorizar ruido
# - augmentation mais suave (mosaic 0.5, erasing 0.1, scale 0.3) para camera fixa
# - close_mosaic 20 -> ultimos 20 epochs sem mosaic, refina deteccao real
# - batch 16 fixo (nao -1 auto)
#
# Override por env: ex. YOLO_MODEL=yolov8m.pt YOLO_EPOCHS=200 bash scripts/run_train_v2.sh

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < .env
  echo "[train_v2] Variaveis carregadas de .env"
fi

# ------------------------------------------------------------------
# Config — pode ser substituida por env var antes de rodar
# ------------------------------------------------------------------
MODEL="${YOLO_MODEL:-yolov8s.pt}"
DATA="${YOLO_DATA_CONFIG:-ul://amaro-neto/datasets/person}"
PROJECT="${YOLO_PROJECT:-amaro-neto/peoplecount-3}"
NAME="${YOLO_EXPERIMENT_NAME:-exp-31}"

EPOCHS="${YOLO_EPOCHS:-150}"
IMGSZ="${YOLO_IMGSZ:-640}"
BATCH="${YOLO_BATCH:-16}"
DEVICE="${YOLO_DEVICE:-0}"
WORKERS="${YOLO_WORKERS:-8}"
PATIENCE="${YOLO_PATIENCE:-30}"
SEED="${YOLO_SEED:-0}"

OPTIMIZER="${YOLO_OPTIMIZER:-AdamW}"
LR0="${YOLO_LR0:-0.001}"
LRF="${YOLO_LRF:-0.01}"
WEIGHT_DECAY="${YOLO_WEIGHT_DECAY:-0.0005}"
WARMUP_EPOCHS="${YOLO_WARMUP_EPOCHS:-3.0}"
MOMENTUM="${YOLO_MOMENTUM:-0.937}"

BOX="${YOLO_BOX:-7.5}"
CLS="${YOLO_CLS:-0.5}"
DFL="${YOLO_DFL:-1.5}"

CLOSE_MOSAIC="${YOLO_CLOSE_MOSAIC:-20}"
MOSAIC="${YOLO_MOSAIC:-0.5}"
MIXUP="${YOLO_MIXUP:-0.05}"
CUTMIX="${YOLO_CUTMIX:-0.0}"
ERASING="${YOLO_ERASING:-0.1}"
SCALE="${YOLO_SCALE:-0.3}"
TRANSLATE="${YOLO_TRANSLATE:-0.1}"
DEGREES="${YOLO_DEGREES:-0.0}"
FLIPLR="${YOLO_FLIPLR:-0.5}"
FLIPUD="${YOLO_FLIPUD:-0.0}"
HSV_H="${YOLO_HSV_H:-0.015}"
HSV_S="${YOLO_HSV_S:-0.5}"
HSV_V="${YOLO_HSV_V:-0.3}"
COPY_PASTE="${YOLO_COPY_PASTE:-0.0}"

# Filtro de classes: util quando o dataset tem muitas classes raras/ruido.
# Ex.: YOLO_CLASSES=0 treina so Pessoa; YOLO_CLASSES=0,1,2,3,4,5,6 ignora class7..24.
CLASSES="${YOLO_CLASSES:-}"

# ------------------------------------------------------------------
# Detectar modo: DATA local (ficheiro) vs HUB (ul://... ou URL)
# Se for local -> desligar HUB/Platform (evita callbacks que abortam o treino).
# Se for HUB   -> exigir token.
# ------------------------------------------------------------------
IS_HUB_DATA=0
if [[ "${DATA}" == ul://* || "${DATA}" == http*://* ]]; then
  IS_HUB_DATA=1
fi

if [ "${IS_HUB_DATA}" = "1" ]; then
  if [ -z "${ULTRALYTICS_HUB_API_KEY:-}" ]; then
    echo "[train_v2] ERRO: ULTRALYTICS_HUB_API_KEY ausente mas DATA=${DATA} aponta para HUB." >&2
    exit 1
  fi
else
  echo "[train_v2] DATA local (${DATA}) -> HUB/Platform desactivados (treino totalmente offline)."
  unset ULTRALYTICS_HUB_API_KEY
  unset ULTRALYTICS_PLATFORM_PROJECT
  unset ULTRALYTICS_PLATFORM_PROJECT_NAME
  unset ULTRALYTICS_PLATFORM_NAME
  unset ULTRALYTICS_PLATFORM_URL
  export YOLO_NO_HUB=1
  # Project com slash (amaro-neto/peoplecount-3) cria pasta aninhada no HUB;
  # em treino local, evita que o path se parta em duas ao chegar ao trainer.
  if [[ "${PROJECT}" == */* ]] && [ -z "${YOLO_KEEP_PROJECT_SLASH:-}" ]; then
    PROJECT="runs/people_count_v2"
    echo "[train_v2] Project renomeado para '${PROJECT}' (evita slash em modo local)."
  fi
fi

echo "[train_v2] MODEL=${MODEL}"
echo "[train_v2] DATA=${DATA}"
echo "[train_v2] PROJECT=${PROJECT} NAME=${NAME}"
echo "[train_v2] epochs=${EPOCHS} imgsz=${IMGSZ} batch=${BATCH} device=${DEVICE}"
echo "[train_v2] optimizer=${OPTIMIZER} lr0=${LR0} lrf=${LRF} cos_lr=on patience=${PATIENCE}"
echo "[train_v2] mosaic=${MOSAIC} close_mosaic=${CLOSE_MOSAIC} erasing=${ERASING} scale=${SCALE} mixup=${MIXUP}"
if [ -n "${CLASSES}" ]; then
  echo "[train_v2] classes=${CLASSES} (filtro activo)"
fi

python3 -m pip install -q -r requirements.txt

CLASSES_ARG=()
if [ -n "${CLASSES}" ]; then
  CLASSES_ARG=(--classes "${CLASSES}")
fi

python3 src/train_ultralytics.py \
  --model "${MODEL}" \
  --data "${DATA}" \
  ${CLASSES_ARG[@]+"${CLASSES_ARG[@]}"} \
  --epochs "${EPOCHS}" \
  --imgsz "${IMGSZ}" \
  --batch "${BATCH}" \
  --device "${DEVICE}" \
  --workers "${WORKERS}" \
  --patience "${PATIENCE}" \
  --cos-lr \
  --close-mosaic "${CLOSE_MOSAIC}" \
  --seed "${SEED}" \
  --deterministic \
  --project "${PROJECT}" \
  --name "${NAME}" \
  --optimizer "${OPTIMIZER}" \
  --lr0 "${LR0}" \
  --lrf "${LRF}" \
  --weight-decay "${WEIGHT_DECAY}" \
  --warmup-epochs "${WARMUP_EPOCHS}" \
  --momentum "${MOMENTUM}" \
  --box "${BOX}" \
  --cls "${CLS}" \
  --dfl "${DFL}" \
  --mosaic "${MOSAIC}" \
  --mixup "${MIXUP}" \
  --cutmix "${CUTMIX}" \
  --erasing "${ERASING}" \
  --scale "${SCALE}" \
  --translate "${TRANSLATE}" \
  --degrees "${DEGREES}" \
  --fliplr "${FLIPLR}" \
  --flipud "${FLIPUD}" \
  --hsv-h "${HSV_H}" \
  --hsv-s "${HSV_S}" \
  --hsv-v "${HSV_V}" \
  --copy-paste "${COPY_PASTE}" \
  --amp

echo ""
echo "[train_v2] Treino concluido. Ver no HUB: https://hub.ultralytics.com/models"
