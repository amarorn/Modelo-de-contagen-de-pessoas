#!/usr/bin/env python3
"""Treino YOLO classify no Gender-Classifier-7K (pasta datasete/).

O dataset deve ter apenas classes em Female/ e Male/. Um clone Git inclui .git/;
treinar diretamente nessa pasta faria o Ultralytics tratar .git como classe extra.
Este script cria ligacoes simbolicas so para Female e Male em data/gender_classify_7k_view/.

Imagens reais: se os .png forem ponteiros LFS, execute no clone do dataset:
  git lfs install && git lfs pull

Validacao:
  python scripts/verify_classify_dataset.py datasete/Gender-Classifier-7K

Exemplos:
  python scripts/train_gender_classify_7k.py --epochs 50 --model yolov8n-cls.pt
  python scripts/train_gender_classify_7k.py --data /outro/caminho/Female_e_Male --epochs 10
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = REPO_ROOT / "datasete" / "Gender-Classifier-7K"
VIEW_ROOT = REPO_ROOT / "data" / "gender_classify_7k_view"


def ensure_class_view(src: Path, view_root: Path) -> Path:
    """Symlinks Female/ e Male/ para view_root (sem .git)."""
    for name in ("Female", "Male"):
        if not (src / name).is_dir():
            print(f"ERRO: pasta em falta: {src / name}", file=sys.stderr)
            raise SystemExit(1)
    view_root.mkdir(parents=True, exist_ok=True)
    for name in ("Female", "Male"):
        link = view_root / name
        dest = (src / name).resolve()
        if link.is_symlink():
            link.unlink()
        elif link.exists():
            print(f"ERRO: {link} existe e nao e symlink; apague ou mude --view-root.", file=sys.stderr)
            raise SystemExit(1)
        link.symlink_to(dest, target_is_directory=True)
    return view_root


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, default=DEFAULT_DATA, help="Raiz com Female/ e Male/")
    p.add_argument("--view-root", type=Path, default=VIEW_ROOT, help="Onde criar symlinks (so Female/Male)")
    p.add_argument("--model", type=str, default="yolov8n-cls.pt")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=224)
    p.add_argument("--batch", type=int, default=32)
    p.add_argument("--device", type=str, default="auto")
    p.add_argument("--project", type=str, default="runs/gender_classify")
    p.add_argument("--name", type=str, default="gender-7k")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--skip-verify", action="store_true", help="Nao correr verify_classify_dataset")
    args = p.parse_args()

    src = args.data.resolve()
    if not args.skip_verify:
        sys.path.insert(0, str(REPO_ROOT / "scripts"))
        from dataset_image_utils import verify_dataset_images

        code = verify_dataset_images(src)
        if code != 0:
            raise SystemExit(code)

    data_dir = ensure_class_view(src, args.view_root.resolve())
    print(f"[classify] data={data_dir} (Ultralytics faz split train/val se necessario)", flush=True)

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(
        data=str(data_dir),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        workers=args.workers,
        seed=args.seed,
        pretrained=True,
        verbose=True,
    )
    best = Path(args.project) / args.name / "weights" / "best.pt"
    print(f"[classify] Concluido. Pesos: {best}", flush=True)


if __name__ == "__main__":
    main()
