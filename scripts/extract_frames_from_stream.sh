#!/usr/bin/env bash
# Extrai frames de um stream HLS/RTSP ou ficheiro de video para preparar dataset YOLO.
# Depois: rotular (Roboflow/CVAT), dividir train/val/test, treinar com YOLO_MODEL apontando para o teu best.pt.
#
# Uso:
#   ./scripts/extract_frames_from_stream.sh
#     (sem URL: usa URL_HLS_OU_RTSP_OU_FICHEIRO do .env)
#   ./scripts/extract_frames_from_stream.sh 'https://.../live.m3u8?...'
#   FPS=0.5 DURATION_SEC=120 ./scripts/extract_frames_from_stream.sh 'URL'
#
# Variaveis opcionais:
#   OUT_DIR   (defeito: data/person_count/images/staging)
#   FPS       frames por segundo (defeito: 1)
#   DURATION_SEC  segundos a gravar (defeito: 60); 0 = sem limite (Ctrl+C para parar)
#   MAX_FRAMES    parar apos N frames (alternativa a duracao)
#   FFMPEG_REFERER  Referer HTTP (defeito: https://www.skylinewebcams.com/ para URLs skyline)
#   FFMPEG_USER_AGENT  (defeito: string tipo browser)
#   FFMPEG_EXTRACT_EXTRA  espaco extra de argumentos ffmpeg antes de -i (ex.: -tls_verify 0 — so se souber o risco)
#   EXTRACT_OPENCV_ONLY=1   saltar ffmpeg e usar so OpenCV (mesmo motor que o dashboard)
#   EXTRACT_NO_OPENCV_FALLBACK=1   se ffmpeg falhar, nao tentar OpenCV
#
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

URL="${1:-${URL_HLS_OU_RTSP_OU_FICHEIRO:-}}"
if [ -z "${URL}" ]; then
  echo "Uso: $0 ['URL_HLS_OU_RTSP_OU_FICHEIRO'] [OUT_DIR]" >&2
  echo "  Sem argumentos: usa URL_HLS_OU_RTSP_OU_FICHEIRO do ficheiro .env na raiz do projeto." >&2
  echo "Exemplo: $0 'https://hd-auth.skylinewebcams.com/live.m3u8?a=...'" >&2
  exit 1
fi

OUT_DIR="${2:-${OUT_DIR:-data/person_count/images/staging}}"
FPS="${FPS:-1}"
DURATION_SEC="${DURATION_SEC:-60}"
MAX_FRAMES="${MAX_FRAMES:-}"

mkdir -p "${OUT_DIR}"

FFMPEG=(ffmpeg -hide_banner -loglevel warning -stats)
VF="fps=${FPS}"
FRAME_ARGS=()
if [ -n "${MAX_FRAMES}" ] && [ "${MAX_FRAMES}" -gt 0 ] 2>/dev/null; then
  FRAME_ARGS=(-frames:v "${MAX_FRAMES}")
fi

# Opcoes de entrada para HLS/HTTPS (reduz "Input/output error" e quedas de segmento)
USER_AGENT="${FFMPEG_USER_AGENT:-Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36}"
INPUT_OPTS=(
  -fflags "+genpts+discardcorrupt"
  -reconnect 1
  -reconnect_streamed 1
  -reconnect_delay_max 5
  -rw_timeout 15000000
  -user_agent "${USER_AGENT}"
)
if [[ "${URL}" == *"m3u8"* ]] || [[ "${URL}" == *"skylinewebcams"* ]] || [[ "${URL}" == *"skyline"* ]]; then
  INPUT_OPTS+=(-protocol_whitelist "file,http,https,tcp,tls,crypto")
  REF="${FFMPEG_REFERER:-https://www.skylinewebcams.com/}"
  HDR="Referer: ${REF}"$'\r\n'
  INPUT_OPTS+=(-headers "${HDR}")
fi
# shellcheck disable=SC2206
EXTRA_PARSE=(${FFMPEG_EXTRACT_EXTRA:-})

echo "[extract] saida: ${OUT_DIR}"
echo "[extract] fps=${FPS} duracao_s=${DURATION_SEC} max_frames=${MAX_FRAMES:-ilimitado}"

PYTHON_BIN="${ROOT_DIR}/.venv/bin/python"
if [ ! -x "${PYTHON_BIN}" ]; then
  PYTHON_BIN="python3"
fi

run_opencv() {
  echo "[extract] A usar OpenCV (cv2.VideoCapture — igual ao dashboard web)..." >&2
  OC_ARGS=(
    "${PYTHON_BIN}" "${ROOT_DIR}/scripts/extract_frames_opencv.py"
    "${URL}"
    -o "${OUT_DIR}"
    --fps "${FPS}"
    --duration "${DURATION_SEC:-0}"
    --max-frames "${MAX_FRAMES:-0}"
  )
  "${OC_ARGS[@]}"
}

if [ "${EXTRACT_OPENCV_ONLY:-0}" = "1" ]; then
  run_opencv
else
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "[extract] ffmpeg ausente; a usar OpenCV." >&2
    run_opencv
  else
    RUN_CMD=(
      "${FFMPEG[@]}" -y
      "${INPUT_OPTS[@]}"
      "${EXTRA_PARSE[@]}"
    )
    if [ -n "${DURATION_SEC}" ] && [ "${DURATION_SEC}" != "0" ]; then
      RUN_CMD+=(-t "${DURATION_SEC}")
    fi
    RUN_CMD+=(
      -i "${URL}"
      -vf "${VF}"
      -q:v 2
      "${FRAME_ARGS[@]}"
      "${OUT_DIR}/frame_%06d.jpg"
    )

    if ! "${RUN_CMD[@]}"; then
      echo "[extract] ffmpeg falhou (Input/output error e comum em HLS com TLS)." >&2
      if [ "${EXTRACT_NO_OPENCV_FALLBACK:-0}" != "1" ]; then
        echo "[extract] A tentar fallback OpenCV..." >&2
        if ! run_opencv; then
          echo "[extract] OpenCV tambem falhou. Atualize o token ?a=... na URL (DevTools > Rede > m3u8)." >&2
          exit 1
        fi
      else
        echo "[extract] Tente: EXTRACT_OPENCV_ONLY=1 $0 ... ou URL nova / gravar .mp4 com OBS." >&2
        exit 1
      fi
    fi
  fi
fi

echo "[extract] Concluido. Proximos passos:"
echo "  1) Rotular com classe 0=person (export YOLO)"
echo "  2) Mover .jpg + .txt para data/person_count/images/{train,val,test} e labels/{...}"
echo "  3) Fine-tune: YOLO_MODEL=caminho/para/best.pt YOLO_DATA_CONFIG=configs/dataset.yaml bash scripts/run_train.sh"
