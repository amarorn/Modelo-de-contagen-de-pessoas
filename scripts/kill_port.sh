#!/usr/bin/env bash
# Liberta uma porta TCP (por defeito 8080). Uso: ./scripts/kill_port.sh [PORTA]
set -euo pipefail
PORT="${1:-8080}"

if command -v fuser >/dev/null 2>&1; then
  if fuser "${PORT}/tcp" >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp"
    echo "[kill_port] Enviado SIGKILL/SIGTERM a processos em ${PORT}/tcp (fuser)."
    exit 0
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "${PIDS}" ]]; then
    # shellcheck disable=SC2086
    kill ${PIDS} 2>/dev/null || true
    sleep 0.3
    PIDS2=$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "${PIDS2}" ]]; then
      # shellcheck disable=SC2086
      kill -9 ${PIDS2} 2>/dev/null || true
    fi
    echo "[kill_port] Terminados processos na porta ${PORT} (lsof)."
    exit 0
  fi
fi

echo "[kill_port] Nenhum processo em LISTEN na porta ${PORT}."
exit 0
