"""Classificador de sexo apenas para estatistica agregada (opcional).

Requer modelo YOLO `task=classify` (.pt) com nomes de classe reconheciveis
(ex.: female/male ou mulher/homem). Abaixo do limiar de confianca conta-se como
unknown (abstention). Nao armazenar rotulos por individuo em producao sem
revisao legal — ver docs/04_privacidade_etica.md.
"""

from __future__ import annotations

import os
from collections import Counter, deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np

Bucket = Literal["female", "male", "unknown"]


@dataclass
class SexAggregateStats:
    female: int = 0
    male: int = 0
    unknown: int = 0


def _sex_classify_imgsz() -> int:
    raw = os.environ.get("YOLO_SEX_CLASSIFY_IMGSZ", "224").strip()
    try:
        return int(np.clip(int(raw), 32, 640))
    except ValueError:
        return 224


def _sex_crop_pad_frac() -> float:
    raw = os.environ.get("YOLO_SEX_CROP_PAD", "0.06").strip()
    try:
        return float(np.clip(float(raw), 0.0, 0.35))
    except ValueError:
        return 0.06


def _sex_min_box_height_px() -> int:
    """Altura minima da bbox de detecao (pixels) para classificar sexo; 0 = sem limite.

    Em camaras longe / vista de cima as pessoas sao poucos pixels: o classificador
    tende a errar; subir este valor (ex.: 120-200) forca 'unknown' em figuras pequenas.
    """
    raw = os.environ.get("YOLO_SEX_MIN_BOX_HEIGHT_PX", "0").strip()
    try:
        return int(np.clip(int(raw), 0, 4096))
    except ValueError:
        return 0


def _expand_xyxy(
    xyxy: tuple[float, float, float, float],
    frame_hw: tuple[int, int],
    pad_frac: float,
) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = xyxy
    h, w = int(frame_hw[0]), int(frame_hw[1])
    bw = max(1.0, x2 - x1)
    bh = max(1.0, y2 - y1)
    px = bw * pad_frac
    py = bh * pad_frac
    nx1 = max(0.0, x1 - px)
    ny1 = max(0.0, y1 - py)
    nx2 = min(float(w - 1), x2 + px)
    ny2 = min(float(h - 1), y2 + py)
    return (nx1, ny1, nx2, ny2)


@dataclass
class PerTrackSexSmoother:
    """Consenso por janela deslizante: reduz alternancia F/M/? entre frames."""

    window: int = 9
    min_agree: int = 5
    _hist: dict[int, deque[str]] = field(default_factory=dict)
    _last: dict[int, str] = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> PerTrackSexSmoother:
        try:
            w = int(os.environ.get("YOLO_SEX_SMOOTH_WINDOW", "9").strip())
        except ValueError:
            w = 9
        try:
            m = int(os.environ.get("YOLO_SEX_SMOOTH_MIN", "5").strip())
        except ValueError:
            m = 5
        w = max(1, min(31, w))
        m = max(1, min(w, m))
        return cls(window=w, min_agree=m)

    def update(self, track_id: int, bucket: str) -> str:
        tid = int(track_id)
        if self.window <= 1:
            self._last[tid] = bucket
            return bucket
        dq = self._hist.setdefault(tid, deque(maxlen=self.window))
        dq.append(bucket)
        out = self._consensus(list(dq))
        self._last[tid] = out
        return out

    def last(self, track_id: int) -> str:
        return self._last.get(int(track_id), "unknown")

    def forget(self, track_id: int) -> None:
        tid = int(track_id)
        self._hist.pop(tid, None)
        self._last.pop(tid, None)

    def forget_stale(self, active_ids: set[int]) -> None:
        for tid in list(self._hist.keys()):
            if tid not in active_ids:
                self.forget(tid)

    def _consensus(self, xs: list[str]) -> str:
        if not xs:
            return "unknown"
        c = Counter(xs)
        best, n = c.most_common(1)[0]
        if n >= self.min_agree:
            return str(best)
        return "unknown"


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
        x1, y1, x2, y2 = xyxy
        min_h = _sex_min_box_height_px()
        if min_h > 0 and (y2 - y1) < float(min_h):
            return "unknown"
        fh, fw = frame_bgr.shape[:2]
        pad = _sex_crop_pad_frac()
        box = _expand_xyxy(xyxy, (fh, fw), pad) if pad > 0 else xyxy
        crop = _safe_crop(frame_bgr, box)
        if crop is None:
            return "unknown"
        results = self._model.predict(
            crop,
            verbose=False,
            device=self.device,
            imgsz=_sex_classify_imgsz(),
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
