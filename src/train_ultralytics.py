#!/usr/bin/env python3
"""Treino de detector de pessoas com Ultralytics YOLO.

Uso rapido:
  python src/train_ultralytics.py --data configs/dataset.yaml --model yolov8m.pt

Com HUB token (opcional):
  ULTRALYTICS_HUB_API_KEY=... python src/train_ultralytics.py ...
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

import torch
import ultralytics
import yaml

from device_utils import resolve_device
from ultralytics import YOLO, settings
from ultralytics.hub import login as hub_login

REPO_ROOT = Path(__file__).resolve().parent.parent

_IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def _count_raster_images(d: Path) -> int:
    if not d.is_dir():
        return 0
    return sum(1 for p in d.rglob("*") if p.is_file() and p.suffix.lower() in _IMG_EXT)


def ensure_yolo_detect_tree(root: Path) -> None:
    """Cria data/person_count/images|labels/{train,val,test} se ainda nao existirem."""
    root.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val", "test"):
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        (root / "labels" / split).mkdir(parents=True, exist_ok=True)


def expand_project_dataset_yaml(data_arg: str) -> tuple[str, Path | None]:
    """Ultralytics junta `path` relativo a DATASETS_DIR se a pasta nao existir no cwd.

    Em `configs/dataset.yaml`, `path: data/person_count` e relativo a este repositorio.
    Gera um YAML temporario com `path` absoluto para o treino encontrar os dados.
    """
    data_path = Path(data_arg).resolve()
    try:
        data_path.relative_to(REPO_ROOT)
    except ValueError:
        return str(data_arg), None
    if data_path.suffix not in {".yaml", ".yml"} or not data_path.is_file():
        return str(data_arg), None
    try:
        cfg = yaml.safe_load(data_path.read_text(encoding="utf-8"))
    except Exception:
        return str(data_arg), None
    if not isinstance(cfg, dict):
        return str(data_arg), None
    rel = cfg.get("path")
    if rel is None or str(rel).strip() == "" or Path(rel).is_absolute():
        return str(data_arg), None
    repo_candidate = (REPO_ROOT / rel).resolve()
    yaml_parent_candidate = (data_path.parent / rel).resolve()
    if repo_candidate.exists():
        root = repo_candidate
    elif yaml_parent_candidate.exists():
        root = yaml_parent_candidate
    else:
        root = repo_candidate
    cfg["path"] = str(root)
    fd, tmp_name = tempfile.mkstemp(suffix=".yaml", prefix="ultralytics_data_")
    os.close(fd)
    tmp_path = Path(tmp_name)
    tmp_path.write_text(
        yaml.safe_dump(cfg, allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    return str(tmp_path), tmp_path


def check_project_det_dataset_layout(tmp_yaml: Path | None) -> None:
    """Falha cedo com mensagem clara se configs/dataset.yaml apontar para pastas em falta."""
    if tmp_yaml is None or not tmp_yaml.is_file():
        return
    cfg = yaml.safe_load(tmp_yaml.read_text(encoding="utf-8"))
    root = Path(cfg.get("path", "")).resolve()
    ensure_yolo_detect_tree(root)

    missing: list[str] = []
    train_imgs = val_imgs = 0
    for key in ("train", "val"):
        rel = cfg.get(key)
        if not rel or isinstance(rel, list):
            continue
        p = (root / rel).resolve()
        n = _count_raster_images(p)
        if key == "train":
            train_imgs = n
        else:
            val_imgs = n
        if not p.is_dir():
            missing.append(f"  - {key}: {p} (pasta inexistente)")
        elif n == 0:
            missing.append(f"  - {key}: {p} (sem imagens .jpg/.png/...)")

    if train_imgs == 0 or val_imgs == 0:
        print(
            "[train] ERRO: dataset YOLO detect sem imagens suficientes para treino/validacao.\n"
            + ("\n".join(missing) if missing else "")
            + f"\nPastas criadas/atualizadas em:\n  {root}\n"
            "  images/train, images/val, images/test e labels/train, labels/val, labels/test\n"
            "Coloque imagens e ficheiros .txt YOLO nas pastas correspondentes.\n"
            "  (configs/dataset.yaml, docs/06_ultralytics_treino.md)\n\n"
            "Teste rapido do pipeline com dataset minimo:\n"
            "  python src/train_ultralytics.py --data coco8.yaml --epochs 1 --batch 4\n",
            file=sys.stderr,
        )
        sys.exit(1)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Treino YOLO para contagem de pessoas")
    parser.add_argument("--model", default="yolov8m.pt", help="Checkpoint/base model")
    parser.add_argument("--data", default="configs/dataset.yaml", help="Dataset YAML")
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="auto", help="auto, cpu, mps ou id CUDA (ex: 0)")
    parser.add_argument("--project", default="runs/people_count")
    parser.add_argument("--name", default="yolov8m-door-counter")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--cos-lr", action="store_true", help="Habilita scheduler coseno")
    parser.add_argument("--close-mosaic", type=int, default=10)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def resolve_data_arg(data_arg: str) -> str:
    data_path = Path(data_arg)
    if data_path.exists():
        return str(data_path)

    # Fallback para datasets YAML embutidos no pacote Ultralytics.
    datasets_dir = Path(ultralytics.__file__).resolve().parent / "cfg" / "datasets"
    builtin_yaml = datasets_dir / data_arg
    if builtin_yaml.exists():
        print(f"[train] Usando dataset builtin da Ultralytics: {builtin_yaml.name}")
        return str(builtin_yaml)

    raise FileNotFoundError(
        f"Arquivo de dataset nao encontrado: {data_arg}. "
        "Use um YAML local valido em YOLO_DATA_CONFIG ou um dataset builtin da Ultralytics "
        "(ex: construction-ppe.yaml, coco8.yaml)."
    )


def configure_hub() -> bool:
    token = os.getenv("ULTRALYTICS_HUB_API_KEY", "").strip()
    if token:
        try:
            # Ultralytics >=8.4 usa autenticacao via hub.login.
            hub_login(api_key=token, save=True)
            # Mantem tambem no settings para compatibilidade com ferramentas CLI.
            if "api_key" in settings:
                settings.update({"api_key": token})
            if "hub" in settings:
                settings.update({"hub": True})
            print("[train] HUB autenticado via ULTRALYTICS_HUB_API_KEY")
            return True
        except Exception as exc:
            print(f"[train] Falha ao autenticar no HUB ({exc}). Continuando em modo local.")
            if "hub" in settings:
                settings.update({"hub": False})
            return False
    else:
        print("[train] Sem HUB token. Treino local padrao sera executado")
        if "hub" in settings:
            settings.update({"hub": False})
        return False


def is_hub_training_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return "hubmodelerror" in exc.__class__.__name__.lower() or "ultralytics hub" in text


def main() -> None:
    args = parse_args()
    resolved_data = resolve_data_arg(args.data)
    resolved_data, tmp_yaml = expand_project_dataset_yaml(resolved_data)
    if tmp_yaml is not None:
        check_project_det_dataset_layout(tmp_yaml)
        print("[train] Dataset resolvido para o repo (YAML temporario):", resolved_data)

    hub_enabled = configure_hub()
    resolved_device = resolve_device(args.device)

    print("[train] Carregando modelo:", args.model)
    model = YOLO(args.model)

    print(f"[train] Iniciando treinamento no device={resolved_device}...")
    train_kwargs = dict(
        data=resolved_data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=resolved_device,
        project=args.project,
        name=args.name,
        workers=args.workers,
        patience=args.patience,
        cos_lr=args.cos_lr,
        close_mosaic=args.close_mosaic,
        seed=args.seed,
        pretrained=True,
        cache=False,
        verbose=True,
    )

    try:
        try:
            model.train(**train_kwargs)
        except Exception as exc:
            if hub_enabled and is_hub_training_error(exc):
                print(f"[train] HUB indisponivel ({exc}). Reexecutando treino local sem HUB...")
                if "hub" in settings:
                    settings.update({"hub": False})
                model.train(**train_kwargs)
            else:
                raise
    finally:
        if tmp_yaml is not None:
            tmp_yaml.unlink(missing_ok=True)

    best = Path(args.project) / args.name / "weights" / "best.pt"
    print(f"[train] Treinamento finalizado. Melhor checkpoint esperado em: {best}")


if __name__ == "__main__":
    main()
