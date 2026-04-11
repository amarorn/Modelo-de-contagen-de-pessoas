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
from pathlib import Path

import torch
import ultralytics

from device_utils import resolve_device
from ultralytics import YOLO, settings
from ultralytics.hub import login as hub_login


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
        model.train(**train_kwargs)
    except Exception as exc:
        if hub_enabled and is_hub_training_error(exc):
            print(f"[train] HUB indisponivel ({exc}). Reexecutando treino local sem HUB...")
            if "hub" in settings:
                settings.update({"hub": False})
            model.train(**train_kwargs)
        else:
            raise

    best = Path(args.project) / args.name / "weights" / "best.pt"
    print(f"[train] Treinamento finalizado. Melhor checkpoint esperado em: {best}")


if __name__ == "__main__":
    main()
