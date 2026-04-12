#!/usr/bin/env python3
"""POST de imagem para endpoint dedicado Ultralytics (Cloud Run).

  ULTRALYTICS_API_KEY=ul_... DEPLOY_BASE_URL=https://predict-....run.app \\
    .venv/bin/python scripts/predict_deployed_image.py foto.jpg

Ou carrega .env na raiz do projeto (mesmas chaves que o resto do repo).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) < 2:
        print("Uso: python scripts/predict_deployed_image.py <imagem.jpg>", file=sys.stderr)
        sys.exit(1)

    root = Path(__file__).resolve().parents[1]
    env_path = root / ".env"
    if env_path.is_file():
        with env_path.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k and k[0].isalpha() and k not in os.environ:
                    os.environ[k] = v

    base = (os.environ.get("DEPLOY_BASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("ULTRALYTICS_API_KEY") or os.environ.get("ULTRALYTICS_HUB_API_KEY") or "").strip()
    if not base or not key:
        print("Defina DEPLOY_BASE_URL e ULTRALYTICS_API_KEY (ou no .env).", file=sys.stderr)
        sys.exit(1)

    url = f"{base}/predict"
    path = Path(sys.argv[1]).expanduser()
    if not path.is_file():
        print(f"Ficheiro inexistente: {path}", file=sys.stderr)
        sys.exit(1)

    args = {
        "conf": os.environ.get("PREDICT_CONF", "0.25"),
        "iou": os.environ.get("PREDICT_IOU", "0.7"),
        "imgsz": os.environ.get("PREDICT_IMGSZ", "640"),
    }

    try:
        import requests
    except ImportError:
        print("pip install requests", file=sys.stderr)
        sys.exit(1)

    with path.open("rb") as f:
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {key}"},
            data=args,
            files={"file": (path.name, f, "application/octet-stream")},
            timeout=120,
        )
    r.raise_for_status()
    print(json.dumps(r.json(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
