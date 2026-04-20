from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class QueueState:
    size: int
    avg_wait_s: float
    linearity: float      # λ1/λ2 — elongação espacial (>2 = alinhado = fila)
    saturated: bool
    centroid_x: float     # posição normalizada [0,1]
    centroid_y: float


class QueueDetector:
    """Detecta padrão de fila: múltiplos tracks lentos com alinhamento espacial."""

    MIN_SIZE: int = 3
    MIN_LINEARITY: float = 2.0
    # "lento mas presente" — velocidade máxima em px/frame para candidato a fila
    SLOW_MAX_PX_FRAME: float = 3.0

    def detect(
        self,
        pos_norm: dict[int, tuple[float, float]],    # tid → (cx_norm, cy_norm)
        speed_px_frame: dict[int, float | None],      # tid → px/frame, None=sem trail
        entered_at: dict[int, float],                 # tid → monotonic ts de entrada
        now: float,
        saturation_threshold: int = 8,
    ) -> QueueState | None:
        """Retorna QueueState se padrão de fila detectado, None caso contrário."""
        slow_ids = [
            tid for tid in pos_norm
            if speed_px_frame.get(tid) is not None
            and speed_px_frame[tid] <= self.SLOW_MAX_PX_FRAME  # type: ignore[operator]
        ]
        if len(slow_ids) < self.MIN_SIZE:
            return None

        pts = np.array([pos_norm[tid] for tid in slow_ids], dtype=np.float64)
        centroid = pts.mean(axis=0)
        centered = pts - centroid
        cov = (centered.T @ centered) / max(1, len(centered) - 1)
        eigvals = np.sort(np.linalg.eigvalsh(cov))[::-1]
        lambda1 = float(eigvals[0])
        lambda2 = float(eigvals[1]) if len(eigvals) > 1 else 0.0
        linearity = lambda1 / max(lambda2, 1e-9)

        if linearity < self.MIN_LINEARITY:
            return None

        wait_times = [max(0.0, now - entered_at.get(tid, now)) for tid in slow_ids]
        avg_wait = float(sum(wait_times) / len(wait_times))

        return QueueState(
            size=len(slow_ids),
            avg_wait_s=avg_wait,
            linearity=linearity,
            saturated=len(slow_ids) >= saturation_threshold,
            centroid_x=float(centroid[0]),
            centroid_y=float(centroid[1]),
        )
