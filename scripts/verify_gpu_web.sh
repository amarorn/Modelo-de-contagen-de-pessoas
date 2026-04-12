#!/usr/bin/env bash
# Verificacoes: PyTorch+CUDA, driver NVIDIA, variaveis .env relevantes ao dashboard.
# Uso: bash scripts/verify_gpu_web.sh
# Com o dashboard a correr, utilization.gpu no nvidia-smi pode subir em rajadas.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

PYTHON="${ROOT_DIR}/.venv/bin/python"
if [ ! -x "${PYTHON}" ]; then
  echo "[verify] ERRO: nao existe .venv/bin/python. Crie o venv e instale requirements."
  exit 1
fi

echo "========== 1) PyTorch / CUDA (mesmo interpretador do run_web.sh) =========="
"${PYTHON}" << 'PY'
import torch
print("torch.__version__:", torch.__version__)
print("torch.cuda.is_available():", torch.cuda.is_available())
print("torch.cuda.device_count():", torch.cuda.device_count())
if torch.cuda.is_available():
    print("torch.cuda.get_device_name(0):", torch.cuda.get_device_name(0))
    print("torch.cuda.get_device_capability(0):", torch.cuda.get_device_capability(0))
else:
    print("AVISO: CUDA indisponivel neste processo (drivers, permissao, ou CUDA_VISIBLE_DEVICES).")
PY

echo ""
echo "========== 2) Driver NVIDIA (nvidia-smi) =========="
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,name,driver_version,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw --format=csv 2>&1 || true
  echo ""
  nvidia-smi -L 2>&1 || true
else
  echo "[verify] nvidia-smi nao encontrado no PATH."
fi

echo ""
echo "========== 3) Linhas .env (GPU / preview web; sem executar o ficheiro) =========="
if [ -f .env ]; then
  grep -E '^(YOLO_DEVICE|YOLO_NO_HALF|YOLO_WEB_PREVIEW_MAX_WIDTH|YOLO_WEB_JPEG_QUALITY)=' .env 2>/dev/null || echo "(nenhuma dessas chaves encontrada)"
else
  echo "[verify] Ficheiro .env nao encontrado."
fi

echo ""
echo "========== 4) Lembrete =========="
echo "- Corra este script e o nvidia-smi na MAQUINA onde corre scripts/run_web.sh (servidor)."
echo "- O PC que so abre o browser NAO executa CUDA; nvidia-smi ai pode nao mostrar o processo Python."
echo "- No video do dashboard: fps=... inf=...ms cap=...ms — se inf for baixo mas fps baixo, MJPEG/rede costuma ser o limite."
echo "============================="
