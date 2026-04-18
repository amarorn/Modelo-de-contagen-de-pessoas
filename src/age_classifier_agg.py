"""Classificador de faixa etaria (macro) apenas para estatistica agregada (opcional).

Requer modelo YOLO `task=classify` (.pt) com nomes de classe reconheciveis, por exemplo:
crianca/child, adolescent/teen, young/jovem, adult, elderly/senior/idoso.
Abaixo do limiar de confianca conta-se como unknown (abstencao).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

AgeBucket = Literal["child", "adolescent", "young", "adult", "elderly", "unknown"]


@dataclass
class AgeAggregateStats:
    child: int = 0
    adolescent: int = 0
    young: int = 0
    adult: int = 0
    elderly: int = 0
    unknown: int = 0


class OptionalAgeClassifier:
    """Envolve um YOLO classify; se path invalido, enabled=False."""

    def __init__(self, model_path: str | None, device: str, abstain_threshold: float) -> None:
        self.abstain_threshold = float(np.clip(abstain_threshold, 0.0, 1.0))
        self.device = device
        self._model = None
        if not model_path:
            return
        p = Path(model_path).expanduser()
        if not p.is_file():
            return
        from ultralytics import YOLO

        m = YOLO(str(p))
        task = getattr(m, "task", None)
        if task != "classify":
            raise ValueError(
                f"--age-model deve ser um modelo YOLO de classificacao (task=classify); "
                f"este ficheiro tem task={task!r}"
            )
        self._model = m

    @property
    def enabled(self) -> bool:
        return self._model is not None

    def classify_crop(self, frame_bgr: np.ndarray, xyxy: tuple[float, float, float, float]) -> AgeBucket:
        if not self.enabled or self._model is None:
            return "unknown"
        crop = _safe_crop(frame_bgr, xyxy)
        if crop is None:
            return "unknown"
        results = self._model.predict(
            crop,
            verbose=False,
            device=self.device,
            imgsz=224,
        )
        r = results[0]
        probs = getattr(r, "probs", None)
        if probs is None:
            return "unknown"
        conf = float(probs.top1conf)
        if conf < self.abstain_threshold:
            return "unknown"
        idx = probs.top1
        names = getattr(r, "names", None)
        if isinstance(names, dict):
            name = str(names.get(idx, names.get(str(idx), "?")))
        else:
            name = "?"
        return _bucket_from_age_class_name(name)


def _safe_crop(
    frame_bgr: np.ndarray,
    xyxy: tuple[float, float, float, float],
    min_side: int = 48,
) -> np.ndarray | None:
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
    h, w = frame_bgr.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < min_side or y2 - y1 < min_side:
        return None
    return frame_bgr[y1:y2, x1:x2].copy()


def _bucket_from_age_class_name(name: str) -> AgeBucket:
    n = name.lower().strip()
    if any(k in n for k in ("unknown", "desconhec", "abstain", "indeterm")):
        return "unknown"
    if "young adult" in n or "young_adult" in n:
        return "adult"
    if any(
        k in n
        for k in (
            "elderly",
            "senior",
            "idoso",
            "pension",
            "geriatr",
            "60+",
            "65+",
            "70+",
            "80+",
            "90+",
        )
    ):
        return "elderly"
    if any(k in n for k in ("adolescent", "teen", "teenager", "juvenil", "puber")):
        return "adolescent"
    if any(
        k in n
        for k in (
            "child",
            "children",
            "kid",
            "kids",
            "crianç",
            "crianca",
            "infant",
            "toddler",
            "baby",
        )
    ):
        return "child"
    if any(k in n for k in ("young", "jovem", "youth")):
        return "young"
    if any(k in n for k in ("adult", "middle", "adulto")):
        return "adult"
    numeric = _bucket_from_numeric_age(n)
    if numeric is not None:
        return numeric
    return "unknown"


def _bucket_from_numeric_age(n: str) -> AgeBucket | None:
    """Mapeia nomes de classe numericos (ex.: '13-15', '71+', '7 dan kichik', '<7')."""
    # Uzbeque 'N dan kichik' / 'less than N' / '<N' => menor que N (crianca)
    m = re.search(r"(\d+)\s*dan\s*kichik", n)
    if m:
        return _bucket_from_mid(max(0, int(m.group(1)) - 1))
    m = re.search(r"(?:less\s*than|under|<)\s*(\d+)", n)
    if m:
        return _bucket_from_mid(max(0, int(m.group(1)) - 1))
    # Faixa aberta superior: '71+', '60 and over', '65 ou mais'
    m = re.search(r"(\d+)\s*(?:\+|and\s*over|or\s*older|or\s*more|ou\s*mais|e\s*mais)", n)
    if m:
        return _bucket_from_mid(int(m.group(1)) + 5)
    # Intervalo 'N-M' / 'N to M' / 'N a M'
    m = re.search(r"(\d+)\s*(?:-|to|a|\u2013|\u2014)\s*(\d+)", n)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
        if hi < lo:
            lo, hi = hi, lo
        return _bucket_from_mid((lo + hi) // 2)
    # Um unico numero no nome, interpretado como idade
    m = re.fullmatch(r"\s*(\d+)\s*", n)
    if m:
        return _bucket_from_mid(int(m.group(1)))
    return None


def _bucket_from_mid(age: int) -> AgeBucket:
    if age < 13:
        return "child"
    if age < 18:
        return "adolescent"
    if age < 30:
        return "young"
    if age < 60:
        return "adult"
    return "elderly"
