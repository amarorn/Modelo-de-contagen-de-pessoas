#!/usr/bin/env bash
# Descarrega FFmpeg estático amd64 (John Van Sickle) com H.264/HEVC para tools/.
# O ffmpeg do sistema em algumas distros openSUSE vem sem decoders patenteados; ffprobe falha em HLS tipico.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARCHIVE_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
TARGET="${ROOT_DIR}/tools"
TMP="${TMPDIR:-/tmp}/ffmpeg-static-$$.tar.xz"

mkdir -p "${TARGET}"
echo "[install_static_ffmpeg] A descarregar ${ARCHIVE_URL} ..."
curl -fSL -o "${TMP}" "${ARCHIVE_URL}"
tar -xJf "${TMP}" -C "${TARGET}"
rm -f "${TMP}"
echo "[install_static_ffmpeg] Concluido em ${TARGET}/ffmpeg-*-amd64-static"
echo "[install_static_ffmpeg] scripts/run_web.sh passa a usar este ffmpeg/ffprobe no PATH automaticamente."
echo "[install_static_ffmpeg] Alternativa no sistema (openSUSE): sudo bash scripts/install_ffmpeg_packman_leap.sh"
