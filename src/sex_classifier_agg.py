"""Classificador de sexo apenas para estatistica agregada (opcional).

Requer modelo YOLO `task=classify` (.pt) com nomes de classe reconheciveis
(ex.: female/male ou mulher/homem). Abaixo do limiar de confianca conta-se como
unknown (abstention). Nao armazenar rotulos por individuo em producao sem
revisao legal — ver docs/04_privacidade_etica.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np

Bucket = Literal["female", "male", "unknown"]


@dataclass
class SexAggregateStats:
    female: int = 0
    male: int = 0
    unknown: int = 0


class OptionalSexClassifier:
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
                f"--sex-model deve ser um modelo YOLO de classificacao (task=classify); "
                f"este ficheiro tem task={task!r}"
            )
        self._model = m

    @property
    def enabled(self) -> bool:
        return self._model is not None

    def classify_crop(self, frame_bgr: np.ndarray, xyxy: tuple[float, float, float, float]) -> Bucket:
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
        return _bucket_from_class_name(name)


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


def _bucket_from_class_name(name: str) -> Bucket:
    n = name.lower()
    if any(k in n for k in ("female", "femin", "mulher", "woman")):
        return "female"
    if any(k in n for k in ("male", "masc", "homem", "man")):
        return "male"
    if any(k in n for k in ("unknown", "desconhec", "abstain", "indeterm")):
        return "unknown"
    return "unknown"
