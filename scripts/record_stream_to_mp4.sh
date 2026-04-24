#!/usr/bin/env bash
# Grava N segundos de um stream (HLS, RTSP, YouTube live) para MP4 com stream copy
# (nao re-codifica: dispensa decoder h264 no ffmpeg).
# Opcionalmente chama scripts/extract_frames_from_stream.sh sobre o MP4 gerado.
#
# Uso:
#   ./scripts/record_stream_to_mp4.sh 'https://www.youtube.com/watch?v=...'
#   ./scripts/record_stream_to_mp4.sh 'https://hd-auth.skylinewebcams.com/live.m3u8?a=TOKEN'
#   ./scripts/record_stream_to_mp4.sh 'rtsp://user:pass@host/path'
#   ./scripts/record_stream_to_mp4.sh  # usa YOLO_WEB_SOURCE ou URL_HLS_OU_RTSP_OU_FICHEIRO do .env
#
# Variaveis opcionais:
#   DURATION_SEC        segundos a gravar (defeito: 120)
#   OUT_FILE            caminho MP4 de saida (defeito: capturas/stream_<timestamp>.mp4)
#   OUT_DIR             pasta de capturas (defeito: capturas)
#   EXTRACT_AFTER=1     apos gravar, chamar extract_frames_from_stream.sh sobre o MP4
#   FPS / MAX_FRAMES    passados ao extractor quando EXTRACT_AFTER=1
#   YTDLP_FORMAT        formato para yt-dlp (defeito: best[height<=720])
#   FFMPEG_REFERER      Referer p/ HLS (defeito: https://www.skylinewebcams.com/ para URLs skyline)
#
# Depois de gravar, para extrair frames manualmente:
#   bash scripts/extract_frames_from_stream.sh capturas/stream_<timestamp>.mp4

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

URL="${1:-}"
if [ -z "${URL}" ]; then
  URL="${URL_HLS_OU_RTSP_OU_FICHEIRO:-${YOLO_WEB_SOURCE:-}}"
fi
if [ -z "${URL}" ]; then
  echo "Uso: $0 'URL_HLS_RTSP_OU_YOUTUBE'" >&2
  echo "  Defina YOLO_WEB_SOURCE no .env para correr sem argumentos." >&2
  exit 1
fi

DURATION_SEC="${DURATION_SEC:-120}"
OUT_DIR="${OUT_DIR:-capturas}"
mkdir -p "${OUT_DIR}"
TS="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_FILE:-${OUT_DIR}/stream_${TS}.mp4}"

# YouTube: deixar o yt-dlp orquestrar a gravacao (sabe todos os headers/cookies correctos).
# Ele chama o ffmpeg internamente com -t para limitar a duracao.
IS_YOUTUBE=0
if [[ "${URL}" == *"youtube.com/"* ]] || [[ "${URL}" == *"youtu.be/"* ]]; then
  IS_YOUTUBE=1
fi

# Preferir yt-dlp do venv (costuma estar actualizado); cair para PATH se nao existir
YTDLP_BIN="${ROOT_DIR}/.venv/bin/yt-dlp"
if [ ! -x "${YTDLP_BIN}" ]; then
  YTDLP_BIN="$(command -v yt-dlp || true)"
fi

echo "[record] Gravar ${DURATION_SEC}s para: ${OUT_FILE}"

if [ "${IS_YOUTUBE}" = "1" ]; then
  if [ -z "${YTDLP_BIN}" ]; then
    echo "[record] URL YouTube mas yt-dlp nao encontrado. Instale: .venv/bin/pip install -U yt-dlp" >&2
    exit 1
  fi
  YTDLP_VER="$("${YTDLP_BIN}" --version 2>/dev/null || echo '?')"
  YTDLP_FORMAT="${YTDLP_FORMAT:-best[height<=720]}"
  echo "[record] yt-dlp ${YTDLP_VER} -> ffmpeg (formato: ${YTDLP_FORMAT})"
  echo "[record] URL: ${URL}"
  # Deixa o yt-dlp resolver URL/headers/cookies e passa -t ao ffmpeg.
  # -c copy para nao recodificar; hls-use-mpegts para muxing robusto.
  if ! "${YTDLP_BIN}" \
      --no-progress \
      -f "${YTDLP_FORMAT}" \
      --hls-use-mpegts \
      --downloader ffmpeg \
      --downloader-args "ffmpeg_i:-t ${DURATION_SEC}" \
      --no-part \
      -o "${OUT_FILE}" \
      "${URL}"; then
    echo "[record] yt-dlp/ffmpeg falhou ao gravar. Tente YTDLP_FORMAT=best ou outro URL." >&2
    exit 1
  fi
else
  INPUT_OPTS=(
    -fflags "+genpts+discardcorrupt"
    -reconnect 1
    -reconnect_streamed 1
    -reconnect_delay_max 5
    -rw_timeout 15000000
    -user_agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  )
  if [[ "${URL}" == *"m3u8"* ]]; then
    INPUT_OPTS+=(-protocol_whitelist "file,http,https,tcp,tls,crypto")
  fi
  if [[ "${URL}" == *"skylinewebcams"* ]] || [[ "${URL}" == *"hd-auth.skyline"* ]] || [ -n "${FFMPEG_REFERER:-}" ]; then
    REF="${FFMPEG_REFERER:-https://www.skylinewebcams.com/}"
    INPUT_OPTS+=(-headers "Referer: ${REF}"$'\r\n')
  fi
  if [[ "${URL}" == rtsp://* ]]; then
    INPUT_OPTS=(-rtsp_transport tcp -stimeout 10000000)
  fi

  echo "[record] URL: ${URL}"
  if ! ffmpeg -hide_banner -loglevel warning -stats -y \
      "${INPUT_OPTS[@]}" \
      -i "${URL}" \
      -t "${DURATION_SEC}" \
      -c copy \
      -bsf:a aac_adtstoasc \
      "${OUT_FILE}"; then
    echo "[record] ffmpeg falhou. Verifique token/URL ou conectividade." >&2
    exit 1
  fi
fi

if [ ! -s "${OUT_FILE}" ]; then
  echo "[record] ficheiro vazio. Abortar." >&2
  rm -f "${OUT_FILE}"
  exit 1
fi

echo "[record] OK: $(du -h "${OUT_FILE}" | cut -f1) gravados em ${OUT_FILE}"

if [ "${EXTRACT_AFTER:-0}" = "1" ]; then
  echo "[record] A extrair frames com scripts/extract_frames_from_stream.sh..."
  EXTRACT_SKIP_RESOLVE=1 bash "${SCRIPT_DIR}/extract_frames_from_stream.sh" "${OUT_FILE}"
else
  echo "[record] Proximo passo: bash scripts/extract_frames_from_stream.sh '${OUT_FILE}'"
fi
