"""
Baixa todos os modelos de um projecto da Ultralytics Platform.

Usa a API REST autenticada com o token da .env (ULTRALYTICS_HUB_API_KEY).
Cada modelo "completed" e guardado em:
    runs/detect/runs/<project_slug>/<model_slug>/weights/best.pt

Tambem grava metadata.json com info util (bestEpoch, bestFitness, trainArgs).

Uso:
    python src/download_hub_project.py --project peoplecountv2
    python src/download_hub_project.py --project peoplecountv2 --out runs/hub
    python src/download_hub_project.py --project peoplecountv2 --include-failed
    python src/download_hub_project.py --project peoplecountv2 --only exp-4 --only exp-3
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_ROOT = "https://platform.ultralytics.com/api"


def load_api_key(env_path: Path) -> str:
    if not env_path.is_file():
        raise SystemExit(f"[hub] .env nao encontrado em {env_path}")
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("ULTRALYTICS_HUB_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("[hub] ULTRALYTICS_HUB_API_KEY ausente no .env")


def api_get(url: str, key: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def find_project(key: str, slug: str) -> dict:
    data = api_get(f"{API_ROOT}/projects?limit=200", key)
    for p in data.get("projects", []):
        if p.get("slug") == slug:
            return p
    raise SystemExit(f"[hub] projecto com slug='{slug}' nao encontrado")


def list_models(key: str, project_id: str) -> list[dict]:
    data = api_get(f"{API_ROOT}/models?projectId={project_id}&limit=200", key)
    return data.get("models", [])


def model_files(key: str, model_id: str) -> list[dict]:
    data = api_get(f"{API_ROOT}/models/{model_id}/files", key)
    return data.get("files", [])


def download(url: str, dest: Path, expected_size: int | None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and expected_size and dest.stat().st_size == expected_size:
        print(f"  [skip] ja existe ({dest.stat().st_size} bytes)")
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=120) as r, tmp.open("wb") as f:
        total = 0
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    tmp.replace(dest)
    dt = time.time() - t0
    mbps = (total / 1e6) / max(dt, 1e-3)
    print(f"  [ok] {dest}  ({total/1e6:.1f} MB em {dt:.1f}s  {mbps:.1f} MB/s)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--project", required=True, help="slug do projecto na Platform (ex.: peoplecountv2)")
    ap.add_argument(
        "--out",
        default="runs/detect/runs",
        help="raiz onde guardar (default: runs/detect/runs/<project_slug>/<model>/weights/)",
    )
    ap.add_argument("--env", default=".env", help="caminho do .env (default ./.env)")
    ap.add_argument(
        "--include-failed",
        action="store_true",
        help="tambem baixa modelos com status=failed (raramente tem peso)",
    )
    ap.add_argument(
        "--only",
        action="append",
        default=[],
        help="restringe a 1+ slugs (repetir flag). Ex.: --only exp-4 --only exp-3",
    )
    ap.add_argument(
        "--filename",
        choices=["best.pt", "<slug>.pt", "as-is"],
        default="best.pt",
        help="nome do ficheiro local. as-is = mantem o nome do HUB (ex.: exp-4.pt)",
    )
    args = ap.parse_args()

    key = load_api_key(Path(args.env))
    print(f"[hub] projecto={args.project}")
    proj = find_project(key, args.project)
    print(f"[hub] _id={proj['_id']}  modelCount={proj.get('modelCount')}")

    models = list_models(key, proj["_id"])
    if args.only:
        wanted = set(args.only)
        models = [m for m in models if m.get("slug") in wanted]
    print(f"[hub] {len(models)} modelos para inspeccionar")

    out_root = Path(args.out) / args.project
    out_root.mkdir(parents=True, exist_ok=True)

    n_ok = n_skip = 0
    for m in models:
        slug = m.get("slug", m["_id"])
        status = m.get("status", "?")
        if status != "completed" and not args.include_failed:
            print(f"\n[hub] - {slug}: status={status} (skip; usa --include-failed)")
            n_skip += 1
            continue

        print(f"\n[hub] >>> {slug}  status={status}  bestEpoch={m.get('bestEpoch')}  bestFitness={m.get('bestFitness')}")

        try:
            files = model_files(key, m["_id"])
        except urllib.error.HTTPError as e:
            print(f"  [erro] /files -> {e.code}: {e.reason}")
            n_skip += 1
            continue

        if not files:
            print("  [vazio] sem ficheiros associados")
            n_skip += 1
            continue

        model_dir = out_root / slug / "weights"
        for f in files:
            url = f.get("downloadUrl") or f.get("url")
            if not url:
                print(f"  [skip] sem downloadUrl: {f}")
                continue
            if args.filename == "best.pt":
                local_name = "best.pt"
            elif args.filename == "<slug>.pt":
                local_name = f"{slug}.pt"
            else:
                local_name = f.get("name", "best.pt")
            print(f"  -> {f.get('name')}  ({f.get('size',0)/1e6:.1f} MB)")
            try:
                download(url, model_dir / local_name, f.get("size"))
                n_ok += 1
            except Exception as exc:
                print(f"  [erro] download falhou: {exc!r}")
                n_skip += 1

        meta = {k: v for k, v in m.items() if k not in {"plots", "trainArgs"}}
        meta["trainArgs"] = m.get("trainArgs")
        (out_root / slug / "metadata.json").write_text(json.dumps(meta, indent=2))

    print(f"\n[hub] FIM. baixados={n_ok}  saltados={n_skip}")
    print(f"[hub] saida: {out_root}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
