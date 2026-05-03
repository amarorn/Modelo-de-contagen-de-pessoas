"""Agrega deltas de dwell por celula em slots de 30 min (paralelo a SlotAggregator)."""

from __future__ import annotations

import time

import numpy as np

from visioncount.analytics.heatmap.aggregator import SLOT_SIZE_S


class DwellSlotAggregator:
    def __init__(self, grid_h: int = 18, grid_w: int = 32) -> None:
        self.grid_h = grid_h
        self.grid_w = grid_w
        self._cur_slot_ts: int | None = None
        self._cur_grid = np.zeros((grid_h, grid_w), dtype=np.float64)
        self._pending: list[tuple[int, np.ndarray]] = []

    @staticmethod
    def slot_ts_for(wall_time: float) -> int:
        return int(wall_time // SLOT_SIZE_S) * SLOT_SIZE_S

    def feed(self, delta_grid: np.ndarray, wall_time: float | None = None) -> None:
        t = wall_time if wall_time is not None else time.time()
        slot_ts = self.slot_ts_for(t)
        if self._cur_slot_ts is None:
            self._cur_slot_ts = slot_ts
        if slot_ts != self._cur_slot_ts:
            if self._cur_grid.sum() > 1e-12:
                self._pending.append((self._cur_slot_ts, self._cur_grid.copy()))
            self._cur_slot_ts = slot_ts
            self._cur_grid = np.zeros((self.grid_h, self.grid_w), dtype=np.float64)
        if delta_grid.shape != (self.grid_h, self.grid_w):
            raise ValueError("delta_grid shape mismatch")
        self._cur_grid += delta_grid.astype(np.float64)

    def pop_pending(self) -> list[tuple[int, np.ndarray]]:
        result = list(self._pending)
        self._pending.clear()
        return result

    def flush_current(self) -> tuple[int, np.ndarray] | None:
        if self._cur_slot_ts is not None and self._cur_grid.sum() > 1e-12:
            return (self._cur_slot_ts, self._cur_grid.copy())
        return None
