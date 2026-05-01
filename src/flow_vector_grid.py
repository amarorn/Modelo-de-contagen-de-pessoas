from __future__ import annotations

import numpy as np


class FlowVectorGrid:
    """Grade 16×9 de vetores de velocidade por célula com EMA temporal.

    Acumula deslocamento normalizado (dx_norm, dy_norm) de cada track frame-a-frame.
    Decai exponencialmente para refletir padrões recentes e não histórico distante.
    """

    GRID_W: int = 16
    GRID_H: int = 9
    DECAY: float = 0.97        # ~33 frames para decair a 37% (~1s a 30fps)
    CELL_ALPHA: float = 0.3    # peso do novo vetor na EMA da célula
    MIN_MAG_NORM: float = 0.003  # deslocamento mínimo para emitir (0.3% da largura)
    EXPORT_THRESH: float = 0.05  # células com mag < 5% do max são omitidas na export

    def __init__(self) -> None:
        self._vx = np.zeros((self.GRID_H, self.GRID_W), dtype=np.float32)
        self._vy = np.zeros((self.GRID_H, self.GRID_W), dtype=np.float32)
        self._prev: dict[int, tuple[float, float]] = {}  # tid → (cx_norm, cy_norm)

    def update_track(self, track_id: int, cx_norm: float, cy_norm: float) -> None:
        prev = self._prev.get(track_id)
        self._prev[track_id] = (cx_norm, cy_norm)
        if prev is None:
            return
        dx = cx_norm - prev[0]
        dy = cy_norm - prev[1]
        mag = float(np.hypot(dx, dy))
        if mag < self.MIN_MAG_NORM:
            return
        ci = max(0, min(self.GRID_H - 1, int(cy_norm * self.GRID_H)))
        cj = max(0, min(self.GRID_W - 1, int(cx_norm * self.GRID_W)))
        self._vx[ci, cj] = (1 - self.CELL_ALPHA) * self._vx[ci, cj] + self.CELL_ALPHA * float(dx)
        self._vy[ci, cj] = (1 - self.CELL_ALPHA) * self._vy[ci, cj] + self.CELL_ALPHA * float(dy)

    def decay(self) -> None:
        """Deprecia todos os vetores — chame uma vez por frame."""
        self._vx *= self.DECAY
        self._vy *= self.DECAY

    def evict_track(self, track_id: int) -> None:
        self._prev.pop(track_id, None)

    def to_payload(self) -> dict:
        mag = np.hypot(self._vx, self._vy)
        max_mag = float(mag.max())
        if max_mag < 1e-9:
            return {"grid_w": self.GRID_W, "grid_h": self.GRID_H, "max_mag": 0.0, "vectors": []}

        thresh = max_mag * self.EXPORT_THRESH
        vectors = []
        for ci in range(self.GRID_H):
            for cj in range(self.GRID_W):
                m = float(mag[ci, cj])
                if m < thresh:
                    continue
                vectors.append({
                    "r": ci,
                    "c": cj,
                    "vx": float(self._vx[ci, cj]) / max_mag,
                    "vy": float(self._vy[ci, cj]) / max_mag,
                    "mag": m / max_mag,
                })
        return {"grid_w": self.GRID_W, "grid_h": self.GRID_H, "max_mag": max_mag, "vectors": vectors}
