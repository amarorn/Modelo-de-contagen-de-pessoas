"""Dwell por celula (32x18) e por zona semantica."""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Sequence

import numpy as np

from visioncount.zones.zone_assigner import ZoneAssigner

GRID_W = 32
GRID_H = 18
_DT_CAP_S = 2.0


class DwellGridLive:
    """Acumula segundos de permanencia por celula; delta por frame para slots."""

    def __init__(self, grid_w: int = GRID_W, grid_h: int = GRID_H) -> None:
        self.grid_w = grid_w
        self.grid_h = grid_h
        self._grid = np.zeros((grid_h, grid_w), dtype=np.float64)
        self._frame_delta = np.zeros((grid_h, grid_w), dtype=np.float64)

    def update_track(
        self,
        track_id: int,
        cx_norm: float,
        cy_norm: float,
        dt: float,
    ) -> None:
        dt = max(0.0, min(float(dt), _DT_CAP_S))
        if dt <= 0:
            return
        gx = int(min(cx_norm * self.grid_w, self.grid_w - 1))
        gy = int(min(cy_norm * self.grid_h, self.grid_h - 1))
        self._grid[gy, gx] += dt
        self._frame_delta[gy, gx] += dt

    def take_frame_delta(self) -> np.ndarray:
        d = self._frame_delta.copy()
        self._frame_delta[:] = 0.0
        return d

    def to_raw_array(self) -> np.ndarray:
        return self._grid.copy()

    def to_payload(self) -> dict:
        max_v = float(self._grid.max())
        total = float(self._grid.sum())
        if max_v < 1e-9:
            cells: list = []
        else:
            cells = (self._grid / max_v).tolist()
        return {
            "grid_w": self.grid_w,
            "grid_h": self.grid_h,
            "max_val": max_v,
            "total_dwell_s": total,
            "cells": cells,
        }


class ZoneSlotTracker:
    """Acumula metricas por zona dentro de um slot temporal (30 min)."""

    def __init__(self, zone_ids: Sequence[int]) -> None:
        self._ids = [int(z) for z in zone_ids]
        self._dwell: dict[int, dict[int, float]] = {z: {} for z in self._ids}
        self._visits: dict[int, int] = {z: 0 for z in self._ids}
        self._peak: dict[int, int] = {z: 0 for z in self._ids}
        self._prev_zones: dict[int, set[int]] = {}

    def step_frame(
        self,
        assigner: ZoneAssigner,
        track_positions: list[tuple[int, float, float]],
        dt_by_tid: dict[int, float],
    ) -> None:
        occupancy: dict[int, int] = {z: 0 for z in self._ids}
        for tid, fx, fy in track_positions:
            itid = int(tid)
            dt = float(dt_by_tid.get(itid, 0.0))
            dt = max(0.0, min(dt, _DT_CAP_S))
            zlist = assigner.assign(fx, fy)
            cur = set(zlist)
            prev = self._prev_zones.get(itid, set())
            for zid in cur:
                if zid in self._dwell:
                    self._dwell[zid][itid] = self._dwell[zid].get(itid, 0.0) + dt
                    occupancy[zid] = occupancy.get(zid, 0) + 1
            for zid in cur - prev:
                if zid in self._visits:
                    self._visits[zid] += 1
            self._prev_zones[itid] = cur
        for zid in self._ids:
            self._peak[zid] = max(self._peak[zid], occupancy.get(zid, 0))

    def get_snapshot(self) -> list[dict]:
        """Live snapshot: occupancy from last frame + session visit count (without clearing)."""
        occ: dict[int, int] = {z: 0 for z in self._ids}
        for zones in self._prev_zones.values():
            for zid in zones:
                if zid in occ:
                    occ[zid] += 1
        return [
            {
                "zone_id": zid,
                "occupancy_now": occ.get(zid, 0),
                "session_visits": int(self._visits.get(zid, 0)),
            }
            for zid in self._ids
        ]

    def forget_track(self, tid: int) -> None:
        self._prev_zones.pop(int(tid), None)

    def forget_all_tracks(self) -> None:
        self._prev_zones.clear()

    def flush_stats(self) -> list[dict]:
        rows: list[dict] = []
        for zid in self._ids:
            dmap = self._dwell.get(zid, {})
            vals = list(dmap.values())
            total = float(sum(vals))
            uniq = len(dmap)
            avg = total / uniq if uniq else 0.0
            p95 = 0.0
            if vals:
                s = sorted(vals)
                idx = int(math.ceil(0.95 * len(s))) - 1
                idx = max(0, min(idx, len(s) - 1))
                p95 = float(s[idx])
            rows.append(
                {
                    "zone_id": zid,
                    "visits": int(self._visits.get(zid, 0)),
                    "unique_ids": uniq,
                    "total_dwell_s": total,
                    "avg_dwell_s": avg,
                    "p95_dwell_s": p95,
                    "peak_occupancy": int(self._peak.get(zid, 0)),
                }
            )
        self._dwell = {z: {} for z in self._ids}
        self._visits = {z: 0 for z in self._ids}
        self._peak = {z: 0 for z in self._ids}
        self._prev_zones.clear()
        return rows
