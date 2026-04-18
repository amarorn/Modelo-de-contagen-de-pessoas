"""Detector zero-shot de 'pessoa com bone/chapeu' usando CLIP.

Desenho:
- Carregamento preguicoso (lazy): o modelo so e' baixado/carregado na 1a chamada.
- Lib opcional: `open-clip-torch`. Se nao estiver instalada, `enabled=False` e o
  dashboard apenas ignora o detector com um aviso unico no log.
- Cache por track_id: CLIP e' caro (~30-50 ms/crop em GPU). Por isso,
  classificamos cada track no maximo 1x por `reclassify_after_s` segundos,
  salvamos o resultado e apenas reusamos no proximo frame.

Instalacao:
    pip install open-clip-torch
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

# Prompts zero-shot (alvo vs distratores)
_POSITIVE_PROMPTS: tuple[str, ...] = (
    "a photo of a person wearing a cap",
    "a photo of a person wearing a baseball cap",
    "a photo of a person with a hat",
)
_NEGATIVE_PROMPTS: tuple[str, ...] = (
    "a photo of a person without a cap",
    "a photo of a person with bare head",
    "a photo of a person",
)


@dataclass
class CapResult:
    has_cap: bool
    prob: float
    ts: float


class OptionalCapDetector:
    """Classificador zero-shot; se lib indisponivel -> enabled=False (no-op)."""

    def __init__(
        self,
        device: str,
        threshold: float = 0.55,
        reclassify_after_s: float = 1.5,
        model_name: str = "ViT-B-32",
        pretrained: str = "laion2b_s34b_b79k",
        min_box_side: int = 80,
    ) -> None:
        self._device_str = str(device)
        self._threshold = float(np.clip(threshold, 0.0, 1.0))
        self._reclassify_after_s = float(max(0.1, reclassify_after_s))
        self._model_name = model_name
        self._pretrained = pretrained
        self._min_side = int(max(16, min_box_side))
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._text_features = None
        self._torch = None
        self._lock = threading.Lock()
        self._cache: dict[int, CapResult] = {}
        self._enabled: bool = True
        self._load_error: str | None = None
        self._num_positive = 0

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def load_error(self) -> str | None:
        return self._load_error

    def _ensure_loaded(self) -> bool:
        if self._model is not None:
            return True
        if not self._enabled:
            return False
        try:
            import torch
            import open_clip
        except Exception as exc:
            self._enabled = False
            self._load_error = (
                f"open-clip-torch nao instalado ({exc}). "
                "Rode: pip install open-clip-torch"
            )
            return False
        try:
            model, _, preprocess = open_clip.create_model_and_transforms(
                self._model_name, pretrained=self._pretrained
            )
            model.eval()
            device = self._device_str
            if device.isdigit():
                device = f"cuda:{device}"
            if device == "auto":
                device = "cuda" if torch.cuda.is_available() else "cpu"
            model = model.to(device)
            tokenizer = open_clip.get_tokenizer(self._model_name)

            all_prompts = list(_POSITIVE_PROMPTS) + list(_NEGATIVE_PROMPTS)
            self._num_positive = len(_POSITIVE_PROMPTS)
            tokens = tokenizer(all_prompts).to(device)
            with torch.no_grad():
                text_feats = model.encode_text(tokens)
                text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)

            self._model = model
            self._preprocess = preprocess
            self._tokenizer = tokenizer
            self._text_features = text_feats
            self._torch = torch
            self._device_str = device
            return True
        except Exception as exc:
            self._enabled = False
            self._load_error = f"falha ao carregar CLIP: {exc}"
            return False

    def classify(
        self,
        frame_bgr: np.ndarray,
        xyxy: tuple[float, float, float, float],
        track_id: int | None,
    ) -> CapResult | None:
        """Devolve resultado (possivelmente do cache) ou None se crop invalido."""
        if not self._enabled:
            return None
        if track_id is not None:
            hit = self._cache.get(int(track_id))
            if hit is not None and (time.time() - hit.ts) < self._reclassify_after_s:
                return hit
        if not self._ensure_loaded():
            return None

        crop = _safe_crop_rgb(frame_bgr, xyxy, self._min_side)
        if crop is None:
            return None
        from PIL import Image

        try:
            pil = Image.fromarray(crop)
            assert self._preprocess is not None
            tensor = self._preprocess(pil).unsqueeze(0).to(self._device_str)
            torch = self._torch
            assert torch is not None and self._model is not None
            with torch.no_grad():
                img_feat = self._model.encode_image(tensor)
                img_feat = img_feat / img_feat.norm(dim=-1, keepdim=True)
                # similaridade (img x N_prompts)
                assert self._text_features is not None
                logits = (100.0 * img_feat @ self._text_features.T).softmax(dim=-1)
                probs = logits[0].detach().cpu().numpy()
            pos_prob = float(probs[: self._num_positive].sum())
        except Exception as exc:
            self._enabled = False
            self._load_error = f"erro em CLIP.encode_image: {exc}"
            return None

        result = CapResult(
            has_cap=pos_prob >= self._threshold,
            prob=pos_prob,
            ts=time.time(),
        )
        if track_id is not None:
            self._cache[int(track_id)] = result
        return result

    def forget_stale_tracks(self, active_ids: set[int]) -> None:
        with self._lock:
            for k in list(self._cache.keys()):
                if k not in active_ids:
                    self._cache.pop(k, None)


def _safe_crop_rgb(
    frame_bgr: np.ndarray, xyxy: tuple[float, float, float, float], min_side: int
) -> np.ndarray | None:
    x1, y1, x2, y2 = (int(round(v)) for v in xyxy)
    h, w = frame_bgr.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < min_side or y2 - y1 < min_side:
        return None
    # Recorta apenas o terco superior do bbox (cabeca/ombros) para acelerar CLIP
    # e dar prompt mais discriminativo entre "com bone" / "sem bone".
    bh = y2 - y1
    y2_top = y1 + max(int(bh * 0.45), min_side // 2)
    y2_top = min(y2, y2_top)
    crop_bgr = frame_bgr[y1:y2_top, x1:x2].copy()
    return crop_bgr[:, :, ::-1]  # BGR -> RGB
