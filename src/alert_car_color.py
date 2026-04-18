"""Classificador de cor de veiculo por histograma HSV.

Estrategia: recorta a regiao central do bbox (remove paralamas/janelas),
mascara pixels com saturacao/valor baixos (preto/branco/cinza saem para
paletas proprias) e usa a tonalidade dominante para decidir a cor.

Cores suportadas (nomes em portugues, minusculas):
- vermelho, laranja, amarelo, verde, ciano, azul, roxo, rosa,
  preto, branco, cinza, marrom
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Iterable

import cv2
import numpy as np


@dataclass
class ColorResult:
    name: str
    score: float
    ts: float


# Faixas HUE em OpenCV (H vai de 0 a 179). Vermelho quebra em 2 faixas.
_HUE_RANGES: dict[str, tuple[tuple[int, int], ...]] = {
    "vermelho": ((0, 10), (170, 179)),
    "laranja": ((11, 20),),
    "amarelo": ((21, 33),),
    "verde": ((34, 85),),
    "ciano": ((86, 95),),
    "azul": ((96, 130),),
    "roxo": ((131, 155),),
    "rosa": ((156, 169),),
    "marrom": ((10, 20),),  # marrom/tan = laranja com Saturacao media e Value baixo
}


_ALIASES: dict[str, str] = {
    "red": "vermelho",
    "orange": "laranja",
    "yellow": "amarelo",
    "green": "verde",
    "cyan": "ciano",
    "blue": "azul",
    "purple": "roxo",
    "violet": "roxo",
    "pink": "rosa",
    "black": "preto",
    "white": "branco",
    "grey": "cinza",
    "gray": "cinza",
    "brown": "marrom",
}


def normalize_color_name(name: str) -> str:
    n = (name or "").strip().lower()
    return _ALIASES.get(n, n)


def parse_target_colors(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for token in str(raw).split(","):
        c = normalize_color_name(token)
        if c and c in _ALL_COLORS and c not in out:
            out.append(c)
    return out


_ALL_COLORS: tuple[str, ...] = (
    "vermelho", "laranja", "amarelo", "verde", "ciano", "azul",
    "roxo", "rosa", "preto", "branco", "cinza", "marrom",
)


class CarColorClassifier:
    """Classifica a cor predominante de um crop de carro. Barato (sem rede neural)."""

    def __init__(
        self,
        targets: Iterable[str],
        min_box_side: int = 60,
        reclassify_after_s: float = 1.0,
        min_target_score: float = 0.08,
    ) -> None:
        self._targets = {normalize_color_name(c) for c in targets if c}
        self._enabled = len(self._targets) > 0
        self._min_side = int(max(16, min_box_side))
        self._reclassify_after_s = float(max(0.1, reclassify_after_s))
        self._min_target_score = float(np.clip(min_target_score, 0.0, 1.0))
        self._cache: dict[int, ColorResult] = {}

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def targets(self) -> set[str]:
        return set(self._targets)

    def classify(
        self,
        frame_bgr: np.ndarray,
        xyxy: tuple[float, float, float, float],
        track_id: int | None,
    ) -> ColorResult | None:
        if not self._enabled:
            return None
        if track_id is not None:
            hit = self._cache.get(int(track_id))
            if hit is not None and (time.time() - hit.ts) < self._reclassify_after_s:
                return hit

        crop = _center_crop(frame_bgr, xyxy, self._min_side)
        if crop is None:
            return None
        name, score = _dominant_color(crop)
        result = ColorResult(name=name, score=score, ts=time.time())
        if track_id is not None:
            self._cache[int(track_id)] = result
        return result

    def update_targets(
        self,
        targets: "Iterable[str]",
        min_target_score: float | None = None,
    ) -> None:
        new = {normalize_color_name(c) for c in targets if c}
        self._targets = new
        self._enabled = len(new) > 0
        if min_target_score is not None:
            self._min_target_score = float(np.clip(min_target_score, 0.0, 1.0))
        self._cache.clear()

    def matches_target(self, result: ColorResult | None) -> bool:
        if result is None:
            return False
        if result.name not in self._targets:
            return False
        return result.score >= self._min_target_score

    def forget_stale_tracks(self, active_ids: set[int]) -> None:
        for k in list(self._cache.keys()):
            if k not in active_ids:
                self._cache.pop(k, None)


def _center_crop(
    frame_bgr: np.ndarray,
    xyxy: tuple[float, float, float, float],
    min_side: int,
) -> np.ndarray | None:
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
    h, w = frame_bgr.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    bw, bh = x2 - x1, y2 - y1
    if bw < min_side or bh < min_side:
        return None
    # Regiao central 50% x 50% (evita reflexos/paralamas)
    cx1 = x1 + bw // 4
    cy1 = y1 + bh // 4
    cx2 = x2 - bw // 4
    cy2 = y2 - bh // 4
    if cx2 - cx1 < 8 or cy2 - cy1 < 8:
        return None
    return frame_bgr[cy1:cy2, cx1:cx2].copy()


def _dominant_color(bgr: np.ndarray) -> tuple[str, float]:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h_, s_, v_ = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    total = float(h_.size)

    mask_black = (v_ < 45)
    mask_white = (v_ >= 200) & (s_ < 30)
    mask_gray = (~mask_black) & (~mask_white) & (s_ < 35)
    mask_chromatic = ~(mask_black | mask_white | mask_gray)

    frac = {
        "preto": float(mask_black.sum()) / total,
        "branco": float(mask_white.sum()) / total,
        "cinza": float(mask_gray.sum()) / total,
    }

    if mask_chromatic.any():
        chrom_h = h_[mask_chromatic]
        chrom_v = v_[mask_chromatic]
        for name, ranges in _HUE_RANGES.items():
            count = 0
            for lo, hi in ranges:
                count += int(((chrom_h >= lo) & (chrom_h <= hi)).sum())
            if name == "marrom":
                # Marrom = laranja com Value baixo
                count = int(
                    (((chrom_h >= 10) & (chrom_h <= 20)) & (chrom_v < 130)).sum()
                )
            frac[name] = count / total

    # Cor com maior fracao vence.
    name = max(frac, key=lambda k: frac[k])
    return name, float(frac[name])
