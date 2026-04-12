#!/usr/bin/env bash
# Testa inferencia no endpoint dedicado Ultralytics (Cloud Run) com UM frame do stream HLS.
# Docs: https://docs.ultralytics.com/platform/deploy/endpoints/
#
# Uso:
#   export ULTRALYTICS_API_KEY="ul_..."   # chave com acesso ao deploy (Settings > API Keys)
#   export DEPLOY_BASE_URL="https://predict-....run.app"
#   bash scripts/predict_deployed_hls_frame.sh "https://hd-auth.skylinewebcams.com/live.m3u8?a=TOKEN"
#
# O URL do stream nao e enviado ao servidor; so uma imagem JPEG capturada localmente com ffmpeg.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ -f "${ROOT_DIR}/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; esac
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      export "$line"
    fi
  done < "${ROOT_DIR}/.env"
fi

M3U8_URL="${1:-}"
if [ -z "${M3U8_URL}" ]; then
  echo "Uso: $0 'URL_DO_M3U8'" >&2
  exit 1
fi

DEPLOY_BASE_URL="${DEPLOY_BASE_URL:-}"
API_KEY="${ULTRALYTICS_API_KEY:-${ULTRALYTICS_HUB_API_KEY:-}}"
if [ -z "${DEPLOY_BASE_URL}" ] || [ -z "${API_KEY}" ]; then
  echo "Defina DEPLOY_BASE_URL e ULTRALYTICS_API_KEY (ou ULTRALYTICS_HUB_API_KEY no .env)." >&2
  exit 1
fi

PREDICT_URL="${DEPLOY_BASE_URL%/}/predict"
JPG="$(mktemp /tmp/skyline-frame-XXXXXX.jpg)"
FFLOG="$(mktemp /tmp/ffmpeg-skyline-XXXXXX.log)"
cleanup() { rm -f "${JPG}" "${FFLOG}"; }
trap cleanup EXIT

echo "[predict] A capturar 1 frame com ffmpeg..."
# curl -I no m3u8 pode dar 200, mas os .ts no CDN as vezes exigem Referer (browser envia; ffmpeg nao).
# Sobrescreva com PREDICT_FFMPEG_HEADERS se precisar.
if [ -z "${PREDICT_FFMPEG_HEADERS:-}" ]; then
  PREDICT_FFMPEG_HEADERS=$'Referer: https://www.skylinewebcams.com/\r\nOrigin: https://www.skylinewebcams.com\r\n'
fi

if ! ffmpeg -hide_banner -y \
  -loglevel "${PREDICT_FFMPEG_LOGLEVEL:-warning}" \
  -user_agent "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -headers "${PREDICT_FFMPEG_HEADERS}" \
  -rw_timeout 20000000 \
  -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -analyzeduration 10M -probesize 10M \
  -fflags nobuffer+genpts \
  -i "${M3U8_URL}" \
  -vframes 1 -q:v 2 \
  "${JPG}" 2>"${FFLOG}"; then
  echo "[predict] ffmpeg falhou. Saida:" >&2
  sed 's/^/[ffmpeg] /' "${FFLOG}" >&2
  echo >&2
  echo "[predict] O m3u8 pode responder 200 no curl e mesmo assim falhar nos segmentos .ts (403/401)." >&2
  echo "[predict] Tente: export PREDICT_FFMPEG_HEADERS=$'Referer: https://www.skylinewebcams.com/.../pagina-da-camara\\r\\n'" >&2
  echo "[predict] Ou token ?a= expirado: DevTools > Rede > m3u8 e copie URL novo." >&2
  exit 1
fi

echo "[predict] POST ${PREDICT_URL}"
curl -sS -X POST "${PREDICT_URL}" \
  -H "Authorization: Bearer ${API_KEY}" \
  -F "file=@${JPG};type=image/jpeg" \
  -F "conf=0.25" \
  -F "iou=0.7" \
  -F "imgsz=640" | python3 -m json.tool

echo ""
