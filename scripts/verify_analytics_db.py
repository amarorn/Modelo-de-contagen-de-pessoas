#!/usr/bin/env python3
"""Smoke test: DATABASE_URL -> engine, create_all, SELECT 1.

Uso (na raiz do repo, com venv e PYTHONPATH):
  export PYTHONPATH=src
  DATABASE_URL=postgresql+psycopg2://contagem:contagem@127.0.0.1:5433/contagem \\
    python scripts/verify_analytics_db.py

HTTP opcional (servidor Flask a correr):
  ANALYTICS_SMOKE_URL=http://127.0.0.1:5000 ANALYTICS_SMOKE_CAMERA_ID=default \\
    python scripts/verify_analytics_db.py
"""
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))
os.chdir(ROOT)


def main() -> int:
    from sqlalchemy import text

    from persistence.db import database_url, init_db

    url = database_url()
    print(f"[verify] DATABASE_URL={url!r}")
    eng = init_db()
    with eng.connect() as conn:
        conn.execute(text("SELECT 1"))
    print("[verify] OK: init_db + SELECT 1")

    base = os.environ.get("ANALYTICS_SMOKE_URL", "").strip().rstrip("/")
    cam = os.environ.get("ANALYTICS_SMOKE_CAMERA_ID", "").strip() or "default"
    if base:
        q = urllib.parse.urlencode({"camera_id": cam})
        path = f"{base}/api/analytics/flow?{q}"
        try:
            with urllib.request.urlopen(path, timeout=10) as resp:
                body = resp.read()
                if resp.status != 200:
                    print(f"[verify] HTTP flow: status={resp.status}", file=sys.stderr)
                    return 1
        except urllib.error.HTTPError as exc:
            print(f"[verify] HTTP flow failed: {exc}", file=sys.stderr)
            return 1
        except urllib.error.URLError as exc:
            print(f"[verify] HTTP flow unreachable: {exc}", file=sys.stderr)
            return 1
        if not body:
            print("[verify] HTTP flow: empty body", file=sys.stderr)
            return 1
        print(f"[verify] OK: GET /api/analytics/flow camera_id={cam!r}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
