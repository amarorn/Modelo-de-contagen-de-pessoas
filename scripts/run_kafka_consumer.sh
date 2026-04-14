#!/usr/bin/env bash
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

# Compativel com Redpanda em docker-compose.kafka.yml (porta 9092 no host).
export KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-127.0.0.1:9092}"

if [ -x "${ROOT_DIR}/.venv/bin/python" ]; then
  PYTHON="${ROOT_DIR}/.venv/bin/python"
else
  PYTHON="${PYTHON:-python3}"
fi

export PYTHONPATH="${ROOT_DIR}/src:${PYTHONPATH:-}"

exec "${PYTHON}" -m persistence.consumer_service
