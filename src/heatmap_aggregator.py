"""SlotAggregator — acumula raw grids em janelas de 30 min e sinaliza flush."""
from __future__ import annotations

import time

import numpy as np

SLOT_SIZE_S: int = 1800  # 30 minutos


class SlotAggregator:
    """Recebe snapshots brutos do GridLive e agrega por slot temporal de 30 min.

    Uso no loop de inferência:
        aggregator.feed(grid_live.to_raw_array(), time.time())
        for slot_ts, slot_grid in aggregator.pop_pending():
            heatmap_store.write_slot(..., slot_ts, slot_grid, ...)
    """

    def __init__(self, grid_h: int = 18, grid_w: int = 32) -> None:
        self.grid_h = grid_h
        self.grid_w = grid_w
        self._cur_slot_ts: int | None = None
        self._cur_grid = np.zeros((grid_h, grid_w), dtype=np.float64)
        self._pending: list[tuple[int, np.ndarray]] = []

    @staticmethod
    def slot_ts_for(wall_time: float) -> int:
        """Retorna o timestamp unix do início do slot de 30 min."""
        return int(wall_time // SLOT_SIZE_S) * SLOT_SIZE_S

    def feed(self, raw_grid: np.ndarray, wall_time: float | None = None) -> None:
        """Adiciona snapshot bruto ao slot atual; auto-flush ao mudar de slot."""
        t = wall_time if wall_time is not None else time.time()
        slot_ts = self.slot_ts_for(t)

        if self._cur_slot_ts is None:
            self._cur_slot_ts = slot_ts

        if slot_ts != self._cur_slot_ts:
            # Slot completado — empurra para pending se tiver dados
            if self._cur_grid.sum() > 0:
                self._pending.append((self._cur_slot_ts, self._cur_grid.copy()))
            self._cur_slot_ts = slot_ts
            self._cur_grid = np.zeros((self.grid_h, self.grid_w), dtype=np.float64)

        self._cur_grid += raw_grid.astype(np.float64)

    def pop_pending(self) -> list[tuple[int, np.ndarray]]:
        """Retorna e limpa a lista de slots completados prontos para escrita."""
        result = list(self._pending)
        self._pending.clear()
        return result

    def flush_current(self) -> tuple[int, np.ndarray] | None:
        """Força flush do slot em progresso (chamar no encerramento do processo)."""
        if self._cur_slot_ts is not None and self._cur_grid.sum() > 0:
            return (self._cur_slot_ts, self._cur_grid.copy())
        return None
