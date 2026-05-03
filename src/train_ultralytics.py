#!/usr/bin/env python3
"""Treino de detector de pessoas com Ultralytics YOLO (YOLOv8, YOLO11, RT-DETR, etc.).

Uso rapido:
  python src/train_ultralytics.py --data configs/dataset.yaml --model yolov8m.pt

YOLO11 ou RT-DETR (mesma API YOLO()):
  python src/train_ultralytics.py --model yolo11m.pt --data coco.yaml
  python src/train_ultralytics.py --model rtdetr-l.pt --data coco.yaml

Treinar so com classes escolhidas do dataset (ex.: so indice 6 — ver indices no YAML do data):
  python src/train_ultralytics.py --data coco.yaml --classes 6
  # COCO 80 classes: person=0, nao 6. Use o indice que o teu dataset/HUB define para "person".

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

from visioncount.core.device import resolve_device
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


def _is_hub_dataset_uri(data_arg: str) -> bool:
    """Identifica URIs de dataset do Ultralytics HUB (ul://..., https://hub.ultralytics.com/...)."""
    s = str(data_arg).strip().lower()
    return (
        s.startswith("ul://")
        or s.startswith("https://hub.ultralytics.com/")
        or s.startswith("http://hub.ultralytics.com/")
        or s.startswith("hub.ultralytics.com/")
    )


def expand_project_dataset_yaml(data_arg: str) -> tuple[str, Path | None]:
    """Ultralytics junta `path` relativo a DATASETS_DIR se a pasta nao existir no cwd.

    Em `configs/dataset.yaml`, `path: data/person_count` e relativo a este repositorio.
    Gera um YAML temporario com `path` absoluto para o treino encontrar os dados.
    """
    if _is_hub_dataset_uri(data_arg):
        return str(data_arg), None
    data_path = Path(data_arg).resolve()
    try:
        rel_in_repo = data_path.relative_to(REPO_ROOT)
    except ValueError:
        return str(data_arg), None
    # Com venv dentro do repo, ultralytics/cfg/datasets/*.yaml fica sob .venv/.../site-packages:
    # nao e dataset do projeto; nao reescrever path para REPO_ROOT/<nome>.
    _parts = rel_in_repo.parts
    if _parts and _parts[0] == ".venv":
        return str(data_arg), None
    if "site-packages" in _parts:
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


def parse_train_classes(arg: str | None) -> list[int] | None:
    """Converte '6' ou '0,1' em lista de indices de classe; None = todas as classes."""
    if arg is None or not str(arg).strip():
        return None
    out: list[int] = []
    for part in str(arg).split(","):
        part = part.strip()
        if not part:
            continue
        out.append(int(part))
    return out or None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Treino YOLO para contagem de pessoas")
    parser.add_argument(
        "--model",
        default="yolov8m.pt",
        help="Checkpoint/base: yolov8m.pt, yolo11m.pt, rtdetr-l.pt, rtdetr-x.pt, ...",
    )
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
    parser.add_argument("--deterministic", action="store_true")
    parser.add_argument("--optimizer", default=None, help="auto, SGD, Adam, AdamW, NAdam, RAdam, RMSProp")
    parser.add_argument("--lr0", type=float, default=None)
    parser.add_argument("--lrf", type=float, default=None)
    parser.add_argument("--weight-decay", type=float, default=None)
    parser.add_argument("--warmup-epochs", type=float, default=None)
    parser.add_argument("--momentum", type=float, default=None)
    parser.add_argument("--box", type=float, default=None)
    parser.add_argument("--cls", type=float, default=None)
    parser.add_argument("--dfl", type=float, default=None)
    parser.add_argument("--mosaic", type=float, default=None)
    parser.add_argument("--mixup", type=float, default=None)
    parser.add_argument("--cutmix", type=float, default=None)
    parser.add_argument("--erasing", type=float, default=None)
    parser.add_argument("--scale", type=float, default=None)
    parser.add_argument("--translate", type=float, default=None)
    parser.add_argument("--degrees", type=float, default=None)
    parser.add_argument("--fliplr", type=float, default=None)
    parser.add_argument("--flipud", type=float, default=None)
    parser.add_argument("--hsv-h", type=float, default=None)
    parser.add_argument("--hsv-s", type=float, default=None)
    parser.add_argument("--hsv-v", type=float, default=None)
    parser.add_argument("--copy-paste", type=float, default=None)
    parser.add_argument("--auto-augment", default=None, help="randaugment, autoaugment, augmix ou None")
    parser.add_argument("--amp", action="store_true", default=None)
    parser.add_argument(
        "--classes",
        default=None,
        metavar="IDS",
        help=(
            "Indices de classe no dataset (separados por virgula) para treinar so essas classes. "
            "Ex.: --classes 6 ou --classes 0 (COCO 80: person e 0, nao 6). "
            "Omissao = todas as classes do YAML."
        ),
    )
    return parser.parse_args()


def resolve_data_arg(data_arg: str) -> str:
    # URIs do HUB passam direto; o Ultralytics resolve com o API key autenticado.
    if _is_hub_dataset_uri(data_arg):
        return str(data_arg)
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
    # Se YOLO_NO_HUB=1, forcar treino totalmente offline (desliga callbacks do HUB).
    if os.getenv("YOLO_NO_HUB", "").strip() in {"1", "true", "True", "YES", "yes"}:
        if "hub" in settings:
            settings.update({"hub": False})
        if "sync" in settings:
            settings.update({"sync": False})
        print("[train] YOLO_NO_HUB=1 -> HUB/Platform desactivados (treino local puro).")
        return False
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

    cls_filter = parse_train_classes(args.classes)
    if cls_filter is not None:
        print("[train] Filtrar classes (indices no data YAML):", cls_filter)

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
    if cls_filter is not None:
        train_kwargs["classes"] = cls_filter

    # Hiperparametros opcionais: so passa ao Ultralytics se o utilizador definiu.
    _optional = {
        "deterministic": args.deterministic or None,
        "optimizer": args.optimizer,
        "lr0": args.lr0,
        "lrf": args.lrf,
        "weight_decay": args.weight_decay,
        "warmup_epochs": args.warmup_epochs,
        "momentum": args.momentum,
        "box": args.box,
        "cls": args.cls,
        "dfl": args.dfl,
        "mosaic": args.mosaic,
        "mixup": args.mixup,
        "cutmix": args.cutmix,
        "erasing": args.erasing,
        "scale": args.scale,
        "translate": args.translate,
        "degrees": args.degrees,
        "fliplr": args.fliplr,
        "flipud": args.flipud,
        "hsv_h": args.hsv_h,
        "hsv_s": args.hsv_s,
        "hsv_v": args.hsv_v,
        "copy_paste": args.copy_paste,
        "auto_augment": args.auto_augment,
        "amp": args.amp,
    }
    for _k, _v in _optional.items():
        if _v is not None:
            train_kwargs[_k] = _v

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
