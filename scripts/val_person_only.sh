#!/usr/bin/env bash
set -euo pipefail

# Avalia um modelo YOLO apenas na classe "Pessoa" (index 0 do dataset).
# Responde a questao: "quanto do mAP baixo vem das classes fantasma do dataset?"
#
# Uso:
#   bash scripts/val_person_only.sh                                  # default: exp-31-4/weights/best.pt
#   bash scripts/val_person_only.sh caminho/para/best.pt
#   MODEL=runs/.../best.pt DATA=ul://amaro-neto/datasets/person bash scripts/val_person_only.sh
#
# Compara com a run de treino:
#   - Se mAP50 (Pessoa) > 0.65 -> o modelo JA e bom, so as classes vazias distorcem.
#   - Se mAP50 (Pessoa) ~ 0.30 -> o modelo e realmente fraco para pessoa; dataset precisa crescer.

if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < .env
fi

MODEL="${1:-${MODEL:-runs/detect/amaro-neto/peoplecount-3/exp-31-4/weights/best.pt}}"

# O CLI 'yolo val' nao resolve 'ul://...'. Preferir YAML local ja cached pelo treino anterior.
# O Ultralytics guarda datasets do HUB em ~/datasets/<slug>-<hash>/data.yaml.
resolve_data_local() {
  local datasets_dir="${HOME}/datasets"
  if [ ! -d "${datasets_dir}" ]; then
    return 1
  fi
  local found
  found="$(ls -dt "${datasets_dir}"/person-*/data.yaml 2>/dev/null | head -n 1 || true)"
  if [ -n "${found}" ]; then
    echo "${found}"
    return 0
  fi
  return 1
}

if [ -n "${DATA:-}" ]; then
  :  # utilizador forcou
elif DATA_LOCAL="$(resolve_data_local)"; then
  DATA="${DATA_LOCAL}"
  echo "[val] A usar YAML local cached: ${DATA}"
else
  DATA="ul://amaro-neto/datasets/person"
  echo "[val] Nao encontrei cache local; usando ${DATA} (pode falhar se o CLI nao resolver)."
fi
IMGSZ="${IMGSZ:-640}"
DEVICE="${DEVICE:-${YOLO_DEVICE:-0}}"
BATCH="${BATCH:-16}"
CLASSES="${CLASSES:-0}"    # 0 = Pessoa
CONF="${CONF:-0.001}"      # default do Ultralytics para val (max recall nas curvas PR)
IOU="${IOU:-0.6}"          # default val

if [ ! -f "${MODEL}" ]; then
  echo "[val] ERRO: ficheiro do modelo nao existe: ${MODEL}" >&2
  echo "       Passa caminho como argumento: bash $0 <caminho/para/best.pt>" >&2
  exit 1
fi

echo "[val] MODEL=${MODEL}"
echo "[val] DATA=${DATA}  classes=${CLASSES}  imgsz=${IMGSZ}  device=${DEVICE}"

# Prefere o yolo do .venv do projecto; fallback para o do PATH.
YOLO_BIN="${YOLO_BIN:-}"
if [ -z "${YOLO_BIN}" ]; then
  if [ -x ".venv/bin/yolo" ]; then
    YOLO_BIN=".venv/bin/yolo"
  elif [ -x "/home/amaro-neto/.venv/bin/yolo" ]; then
    YOLO_BIN="/home/amaro-neto/.venv/bin/yolo"
  elif command -v yolo >/dev/null 2>&1; then
    YOLO_BIN="yolo"
  else
    echo "[val] ERRO: binario 'yolo' nao encontrado. Activa o venv ou define YOLO_BIN." >&2
    exit 1
  fi
fi

"${YOLO_BIN}" val \
  model="${MODEL}" \
  data="${DATA}" \
  imgsz="${IMGSZ}" \
  batch="${BATCH}" \
  device="${DEVICE}" \
  conf="${CONF}" \
  iou="${IOU}" \
  classes="${CLASSES}" \
  plots=True \
  save_json=True \
  verbose=True
