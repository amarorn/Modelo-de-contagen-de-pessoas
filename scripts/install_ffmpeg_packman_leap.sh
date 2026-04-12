#!/usr/bin/env bash
# Instala FFmpeg completo (H.264, etc.) a partir do Packman no openSUSE Leap 15.x.
# Executar na maquina local: sudo bash scripts/install_ffmpeg_packman_leap.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute como root, por exemplo: sudo bash $0" >&2
  exit 1
fi

REPO_URL="https://ftp.gwdg.de/pub/linux/misc/packman/suse/openSUSE_Leap_15.6/"
REPO_ALIAS="packman"

if ! zypper lr -a 2>/dev/null | grep -qE '\|[[:space:]]*'"${REPO_ALIAS}"'[[:space:]]*\|'; then
  echo "[packman] A adicionar repositorio ${REPO_URL}"
  zypper ar -cfp 90 "${REPO_URL}" "${REPO_ALIAS}"
fi

zypper --gpg-auto-import-keys refresh -r "${REPO_ALIAS}"
echo "[packman] A instalar ffmpeg (vendor change a partir de Packman)..."
zypper in -y --allow-vendor-change --from "${REPO_ALIAS}" -f ffmpeg

echo "[packman] Verificacao:"
ffmpeg -decoders 2>/dev/null | grep -E '^\s+VFS.*\s+h264\s' || true
command -v ffmpeg
ffmpeg -version | head -1
