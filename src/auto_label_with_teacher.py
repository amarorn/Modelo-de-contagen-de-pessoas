"""
Pre-anota frames usando um modelo "teacher" (ex.: exp-25.pt).

Para cada imagem na pasta de input gera o ficheiro .txt de labels YOLO
(formato: <class> <x_center> <y_center> <w> <h>, todos normalizados 0-1)
na pasta de labels. Opcionalmente copia/symlinka as imagens para uma
pasta paralela e produz previews para inspeccao manual.

Workflow tipico:
    1) Extrair frames novos com scripts/extract_frames_from_stream.sh
    2) Pre-anotar com este script (rapido, recall alto)
    3) Abrir no LabelImg/CVAT/Roboflow e CORRIGIR (tira FPs, ajusta caixas)
    4) Mover para o dataset (images/train+labels/train) e re-treinar
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

import numpy as np
from ultralytics import YOLO

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def list_images(root: Path, recursive: bool) -> list[Path]:
    if recursive:
        return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMG_EXTS)
    return sorted(p for p in root.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXTS)


def link_or_copy(src: Path, dst: Path, mode: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    if mode == "symlink":
        os.symlink(src.resolve(), dst)
    elif mode == "copy":
        shutil.copy2(src, dst)
    elif mode == "none":
        pass
    else:
        raise ValueError(f"image_mode invalido: {mode}")


def write_yolo_label(txt_path: Path, boxes_xyxyn: np.ndarray, classes: np.ndarray) -> int:
    """Escreve label YOLO. Retorna numero de bboxes escritos."""
    txt_path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with txt_path.open("w") as f:
        for (x1, y1, x2, y2), cls in zip(boxes_xyxyn, classes):
            xc = (x1 + x2) / 2.0
            yc = (y1 + y2) / 2.0
            w = max(0.0, x2 - x1)
            h = max(0.0, y2 - y1)
            if w <= 0 or h <= 0:
                continue
            xc = float(np.clip(xc, 0.0, 1.0))
            yc = float(np.clip(yc, 0.0, 1.0))
            w = float(np.clip(w, 0.0, 1.0))
            h = float(np.clip(h, 0.0, 1.0))
            f.write(f"{int(cls)} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}\n")
            n += 1
    return n


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--teacher", required=True, help="caminho para o .pt teacher (ex.: exp-25.pt)")
    p.add_argument("--images", required=True, help="pasta com as imagens novas")
    p.add_argument("--out", required=True, help="pasta destino (cria images/ e labels/)")
    p.add_argument("--classes", default="0", help="ids das classes a manter (ex.: 0 ou 0,1,2)")
    p.add_argument("--conf", type=float, default=0.20, help="confianca minima (default 0.20)")
    p.add_argument("--iou", type=float, default=0.6, help="IoU NMS")
    p.add_argument("--imgsz", type=int, default=1280)
    p.add_argument("--device", default=os.environ.get("YOLO_DEVICE", "cpu"))
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--recursive", action="store_true", help="varre subpastas de --images")
    p.add_argument(
        "--image-mode",
        choices=["symlink", "copy", "none"],
        default="symlink",
        help="symlink (rapido, default), copy (independe do source) ou none (so gera labels)",
    )
    p.add_argument(
        "--keep-empty",
        action="store_true",
        help="Tambem regista imagens sem deteccoes (cria .txt vazio = background).",
    )
    p.add_argument(
        "--max-images", type=int, default=0, help="0 = todas; util para teste rapido"
    )
    args = p.parse_args()

    teacher = Path(args.teacher)
    src_dir = Path(args.images)
    out_dir = Path(args.out)
    if not teacher.is_file():
        print(f"[auto_label] ERRO: teacher nao existe: {teacher}", file=sys.stderr)
        return 2
    if not src_dir.is_dir():
        print(f"[auto_label] ERRO: --images nao e pasta: {src_dir}", file=sys.stderr)
        return 2

    keep_classes = sorted({int(x) for x in args.classes.split(",") if x.strip() != ""})
    if not keep_classes:
        print("[auto_label] ERRO: --classes vazio", file=sys.stderr)
        return 2

    images = list_images(src_dir, args.recursive)
    if args.max_images > 0:
        images = images[: args.max_images]
    if not images:
        print(f"[auto_label] nenhuma imagem encontrada em {src_dir}")
        return 0

    print(f"[auto_label] teacher={teacher}")
    print(f"[auto_label] {len(images)} imagens; classes={keep_classes} conf>={args.conf}")
    print(f"[auto_label] saida: {out_dir}/{{images,labels}}")

    model = YOLO(str(teacher))

    out_imgs = out_dir / "images"
    out_lbls = out_dir / "labels"
    out_imgs.mkdir(parents=True, exist_ok=True)
    out_lbls.mkdir(parents=True, exist_ok=True)

    n_ok = 0
    n_empty = 0
    n_bbox = 0
    for batch_start in range(0, len(images), args.batch):
        batch = [str(p) for p in images[batch_start : batch_start + args.batch]]
        results = model.predict(
            batch,
            imgsz=args.imgsz,
            conf=args.conf,
            iou=args.iou,
            device=args.device,
            classes=keep_classes,
            verbose=False,
            stream=False,
        )
        for src_path_str, r in zip(batch, results):
            src_path = Path(src_path_str)
            stem = src_path.stem
            lbl_path = out_lbls / f"{stem}.txt"

            if r.boxes is None or len(r.boxes) == 0:
                if args.keep_empty:
                    lbl_path.write_text("")
                    if args.image_mode != "none":
                        link_or_copy(src_path, out_imgs / src_path.name, args.image_mode)
                    n_empty += 1
                continue

            xyxyn = r.boxes.xyxyn.detach().cpu().numpy()
            cls = r.boxes.cls.detach().cpu().numpy().astype(int)
            written = write_yolo_label(lbl_path, xyxyn, cls)
            if written == 0:
                if not args.keep_empty:
                    lbl_path.unlink(missing_ok=True)
                continue
            if args.image_mode != "none":
                link_or_copy(src_path, out_imgs / src_path.name, args.image_mode)
            n_ok += 1
            n_bbox += written

        done = min(batch_start + args.batch, len(images))
        print(f"[auto_label] {done}/{len(images)}  com_label={n_ok} vazias={n_empty} bboxes={n_bbox}")

    print("\n=== Resumo ===")
    print(f"  imagens com bbox  : {n_ok}")
    print(f"  imagens vazias    : {n_empty} (escritas: {'sim' if args.keep_empty else 'nao'})")
    print(f"  total bboxes      : {n_bbox}")
    print(f"  imagens em        : {out_imgs}")
    print(f"  labels em         : {out_lbls}")
    print("\nProximo passo: abrir em LabelImg / Roboflow / CVAT e CORRIGIR (especialmente FPs).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
