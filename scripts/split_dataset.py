#!/usr/bin/env python3
"""Divide um dataset YOLO detect em train/val/test sem data leak por cena.

Porque e preciso:
  Para video, frames consecutivos sao quase identicos. Se shuffle-arares tudo
  e colocares vizinhos em splits diferentes, o val set "ve" quase o que o
  train ja viu -> metricas infladas, overfit mascarado.

Estrategias:
  time  (default) frames ordenados por nome, divididos em BLOCOS CONTIGUOS
                  70/20/10 por fonte -> train=primeiros 70%, val=20% do meio,
                  test=10% finais. Ideal para 1 fonte com muitos frames.
  scene           cada --source vai inteira para um split (round-robin).
                  Ideal quando tens varias cenas curtas.
  random          shuffle total por fonte (nao recomendado para video).

Uso tipico (depois de rotulares o staging):

  # 1) Criar labels YOLO (.txt) ao lado dos .jpg:
  #    data/person_count/images/staging_20260424_023335/frame_000001.jpg
  #    data/person_count/labels/staging_20260424_023335/frame_000001.txt
  #
  # 2) Rodar este script:
  python scripts/split_dataset.py \\
    --source data/person_count/images/staging_20260424_023335 \\
    --out-root data/person_count \\
    --mode time --train 0.7 --val 0.2 --test 0.1 --symlink

  # Varias fontes (cada uma e uma cena):
  python scripts/split_dataset.py \\
    --source data/person_count/images/staging_20260424_023335 \\
    --source data/person_count/images/staging_20260424_180000 \\
    --mode time --symlink

Estrutura de saida em `--out-root`:
  images/{train,val,test}/*.jpg
  labels/{train,val,test}/*.txt
"""

from __future__ import annotations

import argparse
import os
import random
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

_IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class Sample:
    image: Path
    label: Path | None

    @property
    def has_label(self) -> bool:
        return self.label is not None and self.label.is_file()


def _find_label_for_image(image: Path) -> Path | None:
    """Procura label .txt em <imagens>/../../labels/<mesma_subpasta>/<mesmo_nome>.txt.

    Convencao YOLO do repositorio:
        data/person_count/images/staging_X/frame.jpg
        data/person_count/labels/staging_X/frame.txt
    """
    stem = image.stem
    parent = image.parent
    candidates: list[Path] = []
    # 1) labels ao lado das imagens (raro mas acontece).
    candidates.append(parent / f"{stem}.txt")
    # 2) irmao "labels/<subpasta>" ao mesmo nivel do "images/".
    images_marker = None
    for anc in parent.parents:
        if anc.name == "images":
            images_marker = anc
            break
    if images_marker is not None:
        rel = parent.relative_to(images_marker)
        labels_root = images_marker.parent / "labels" / rel
        candidates.append(labels_root / f"{stem}.txt")
    for c in candidates:
        if c.is_file():
            return c
    return None


def collect_samples(source: Path, allow_empty_labels: bool) -> list[Sample]:
    if not source.is_dir():
        raise FileNotFoundError(f"source nao e pasta: {source}")
    images = sorted(
        p for p in source.iterdir() if p.is_file() and p.suffix.lower() in _IMG_EXT
    )
    samples: list[Sample] = []
    missing = 0
    for img in images:
        lab = _find_label_for_image(img)
        if lab is None:
            missing += 1
            if not allow_empty_labels:
                continue
        samples.append(Sample(image=img, label=lab))
    if missing:
        print(
            f"[split] {source.name}: {missing}/{len(images)} imagens sem label.",
            file=sys.stderr,
        )
        if not allow_empty_labels:
            print(
                "[split]   -> ignoradas (usa --allow-empty-labels para as incluir como 'no objects').",
                file=sys.stderr,
            )
    return samples


def split_time(samples: list[Sample], tr: float, va: float) -> tuple[list[Sample], list[Sample], list[Sample]]:
    n = len(samples)
    n_tr = int(round(n * tr))
    n_va = int(round(n * va))
    n_tr = max(1, min(n_tr, n - 2))
    n_va = max(1, min(n_va, n - n_tr - 1)) if n - n_tr - 1 > 0 else 0
    train = samples[:n_tr]
    val = samples[n_tr : n_tr + n_va]
    test = samples[n_tr + n_va :]
    return train, val, test


def split_random(samples: list[Sample], tr: float, va: float, seed: int) -> tuple[list[Sample], list[Sample], list[Sample]]:
    rng = random.Random(seed)
    data = samples[:]
    rng.shuffle(data)
    return split_time(data, tr, va)


def split_scene(sources_samples: list[list[Sample]]) -> tuple[list[Sample], list[Sample], list[Sample]]:
    """Round-robin: 1a fonte -> train, 2a -> val, 3a -> test, 4a -> train..."""
    train: list[Sample] = []
    val: list[Sample] = []
    test: list[Sample] = []
    buckets = [train, val, test]
    for i, src_samples in enumerate(sources_samples):
        buckets[i % 3].extend(src_samples)
    return train, val, test


def place(samples: list[Sample], split: str, out_root: Path, symlink: bool, dry_run: bool) -> int:
    """Copia/symlinka (imagem, label) para images/<split>/ e labels/<split>/."""
    img_dir = out_root / "images" / split
    lab_dir = out_root / "labels" / split
    img_dir.mkdir(parents=True, exist_ok=True)
    lab_dir.mkdir(parents=True, exist_ok=True)

    n_ok = 0
    for s in samples:
        dst_img = img_dir / s.image.name
        dst_lab = lab_dir / f"{s.image.stem}.txt"
        if dry_run:
            n_ok += 1
            continue
        _place_one(s.image, dst_img, symlink)
        if s.has_label:
            _place_one(s.label, dst_lab, symlink)
        elif not dst_lab.exists():
            dst_lab.write_text("", encoding="utf-8")
        n_ok += 1
    return n_ok


def _place_one(src: Path, dst: Path, symlink: bool) -> None:
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    if symlink:
        os.symlink(src.resolve(), dst)
    else:
        shutil.copy2(src, dst)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", action="append", required=True, type=Path, help="Pasta com imagens (.jpg/.png/...). Pode repetir.")
    p.add_argument("--out-root", default="data/person_count", type=Path, help="Raiz do dataset YOLO (default: data/person_count)")
    p.add_argument("--mode", choices=["time", "scene", "random"], default="time")
    p.add_argument("--train", type=float, default=0.7)
    p.add_argument("--val", type=float, default=0.2)
    p.add_argument("--test", type=float, default=0.1)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--symlink", action="store_true", help="Criar symlinks em vez de copiar (poupa disco; default=copy)")
    p.add_argument("--copy", dest="symlink", action="store_false")
    p.add_argument("--allow-empty-labels", action="store_true", help="Incluir imagens sem label (consideradas 'sem objetos')")
    p.add_argument("--dry-run", action="store_true", help="Nao mover nada, so imprimir o plano")
    p.set_defaults(symlink=False)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    tr, va, te = args.train, args.val, args.test
    total = tr + va + te
    if abs(total - 1.0) > 1e-6:
        print(f"[split] AVISO: --train+--val+--test = {total:.3f} (normalizando).", file=sys.stderr)
        tr, va, te = tr / total, va / total, te / total

    sources_samples: list[list[Sample]] = []
    for src in args.source:
        s = collect_samples(src, args.allow_empty_labels)
        sources_samples.append(s)
        print(f"[split] {src}: {len(s)} amostras validas")

    total_samples = sum(len(s) for s in sources_samples)
    if total_samples == 0:
        print("[split] ERRO: 0 amostras validas. Rotula primeiro os .jpg com labels YOLO .txt.", file=sys.stderr)
        sys.exit(1)

    if args.mode == "scene":
        train, val, test = split_scene(sources_samples)
    else:
        train: list[Sample] = []
        val: list[Sample] = []
        test: list[Sample] = []
        for src_samples in sources_samples:
            if args.mode == "time":
                a, b, c = split_time(src_samples, tr, va)
            else:
                a, b, c = split_random(src_samples, tr, va, args.seed)
            train.extend(a)
            val.extend(b)
            test.extend(c)

    print(f"[split] mode={args.mode}  train={len(train)}  val={len(val)}  test={len(test)}  total={total_samples}")
    if args.dry_run:
        print("[split] --dry-run: nada escrito.")
        return

    n_tr = place(train, "train", args.out_root, args.symlink, False)
    n_va = place(val, "val", args.out_root, args.symlink, False)
    n_te = place(test, "test", args.out_root, args.symlink, False)
    print(f"[split] escrito em {args.out_root.resolve()}")
    print(f"[split]   images/train={n_tr}  images/val={n_va}  images/test={n_te}")
    print(f"[split]   labels/train+val+test tambem populados (YOLO .txt).")
    print("[split] Proximo passo: rodar treino com configs/dataset.yaml apontando para este out-root.")


if __name__ == "__main__":
    main()
