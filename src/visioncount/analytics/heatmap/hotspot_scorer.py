"""Hotspot score: janela recente (segundos) + historico (dias), composite com alpha."""

from __future__ import annotations

import os
import time
from collections import deque
from typing import Any

import numpy as np

from visioncount.persistence.dwell_store import DwellStore
from visioncount.persistence.heatmap_store import HeatmapStore

GRID_W = 32
GRID_H = 18


def rasterize_norm_polygon(
    poly: list[tuple[float, float]], gw: int = GRID_W, gh: int = GRID_H
) -> np.ndarray:
    """Mascara binaria gh x gw: centro da celula dentro do poligono normalizado."""
    import cv2

    mask = np.zeros((gh, gw), dtype=np.float64)
    if len(poly) < 3:
        return mask
    cnt = np.array(
        [[int(round(p[0] * gw)), int(round(p[1] * gh))] for p in poly],
        dtype=np.int32,
    ).reshape(-1, 1, 2)
    for gy in range(gh):
        for gx in range(gw):
            cx = (gx + 0.5) / float(gw)
            cy = (gy + 0.5) / float(gh)
            if cv2.pointPolygonTest(cnt, (cx * gw, cy * gh), False) >= 0:
                mask[gy, gx] = 1.0
    return mask


def _norm_log_grid(arr: np.ndarray) -> np.ndarray:
    v = np.maximum(arr.astype(np.float64), 0.0)
    v = np.log1p(v)
    mx = float(v.max())
    if mx < 1e-12:
        return np.zeros_like(v)
    return v / mx


class HotspotScorer:
    """Acumula deltas por segundo e calcula score por celula."""

    def __init__(
        self,
        site_id: str,
        camera_id: str,
        grid_version: int,
        heatmap_store: HeatmapStore | None = None,
        dwell_store: DwellStore | None = None,
    ) -> None:
        self.site_id = site_id[:64]
        self.camera_id = camera_id[:64]
        self.grid_version = int(grid_version)
        self._heatmap_store = heatmap_store or HeatmapStore()
        self._dwell_store = dwell_store or DwellStore()
        self._alpha = float(os.environ.get("HOTSPOT_RECENT_ALPHA", "0.6"))
        self._window_s = float(os.environ.get("HOTSPOT_RECENT_WINDOW_S", "900"))
        self._hist_days = float(os.environ.get("HOTSPOT_HIST_DAYS", "7"))
        self._cache_ttl = float(os.environ.get("HOTSPOT_HIST_CACHE_TTL_S", "60"))
        self._hist_cache: tuple[float, dict[str, Any]] | None = None
        self._buckets: deque[tuple[int, np.ndarray, np.ndarray]] = deque()
        self._cur_sec: int | None = None
        self._acc_v: np.ndarray | None = None
        self._acc_d: np.ndarray | None = None

    def push_frame_deltas(self, ts: float, visit_delta: np.ndarray, dwell_delta: np.ndarray) -> None:
        if visit_delta.shape != (GRID_H, GRID_W) or dwell_delta.shape != (GRID_H, GRID_W):
            return
        sec = int(ts)
        if self._acc_v is None:
            self._acc_v = visit_delta.astype(np.float64).copy()
            self._acc_d = dwell_delta.astype(np.float64).copy()
            self._cur_sec = sec
            return
        if sec != self._cur_sec:
            self._buckets.append(
                (int(self._cur_sec), self._acc_v.copy(), self._acc_d.copy())
            )
            cut = sec - int(self._window_s)
            while self._buckets and self._buckets[0][0] < cut:
                self._buckets.popleft()
            self._acc_v = visit_delta.astype(np.float64).copy()
            self._acc_d = dwell_delta.astype(np.float64).copy()
            self._cur_sec = sec
        else:
            self._acc_v += visit_delta
            self._acc_d += dwell_delta

    def _recent_sums(self) -> tuple[np.ndarray, np.ndarray]:
        v = np.zeros((GRID_H, GRID_W), dtype=np.float64)
        d = np.zeros((GRID_H, GRID_W), dtype=np.float64)
        for _, vg, dg in self._buckets:
            v += vg
            d += dg
        if self._acc_v is not None and self._cur_sec is not None:
            v += self._acc_v
            d += self._acc_d
        return v, d

    def _historical_merged(self) -> tuple[np.ndarray, np.ndarray]:
        now = time.time()
        if self._hist_cache is not None:
            ts0, payload = self._hist_cache
            if now - ts0 < self._cache_ttl:
                hv = np.array(payload["visit_cells"], dtype=np.float64).reshape(GRID_H, GRID_W)
                hd = np.array(payload["dwell_cells"], dtype=np.float64).reshape(GRID_H, GRID_W)
                return hv, hd

        t0 = now - self._hist_days * 86400.0
        hv = self._heatmap_store.query_historical(
            self.site_id, self.camera_id, t0, now, grid_version=self.grid_version
        )
        hd = self._dwell_store.query_dwell_historical(
            self.site_id, self.camera_id, t0, now, grid_version=self.grid_version
        )
        def cells_to_grid(cells: list, gw: int, gh: int) -> np.ndarray:
            if not cells:
                return np.zeros((GRID_H, GRID_W), dtype=np.float64)
            a = np.array(cells, dtype=np.float64)
            if a.size != gw * gh:
                return np.zeros((GRID_H, GRID_W), dtype=np.float64)
            g = a.reshape(gh, gw)
            if g.shape != (GRID_H, GRID_W):
                return np.zeros((GRID_H, GRID_W), dtype=np.float64)
            mx = float(g.max())
            if mx < 1e-12:
                return g
            return g

        gv = int(hv.get("grid_w") or GRID_W)
        gh = int(hv.get("grid_h") or GRID_H)
        visit_grid = cells_to_grid(hv.get("cells") or [], gv, gh)
        gd = int(hd.get("grid_w") or GRID_W)
        gdh = int(hd.get("grid_h") or GRID_H)
        dwell_grid = cells_to_grid(hd.get("cells") or [], gd, gdh)
        payload = {
            "visit_cells": visit_grid.flatten().tolist(),
            "dwell_cells": dwell_grid.flatten().tolist(),
        }
        self._hist_cache = (now, payload)
        return visit_grid, dwell_grid

    def score_grid(self, mode: str = "composite") -> dict[str, Any]:
        rv, rd = self._recent_sums()
        hv, hd = self._historical_merged()
        nrv = _norm_log_grid(rv)
        nrd = _norm_log_grid(rd)
        nhv = _norm_log_grid(hv)
        nhd = _norm_log_grid(hd)
        recent = 0.5 * nrv + 0.5 * nrd
        hist = 0.5 * nhv + 0.5 * nhd
        if mode == "recent":
            combined = recent
        elif mode == "hist":
            combined = hist
        else:
            a = float(np.clip(self._alpha, 0.0, 1.0))
            combined = a * recent + (1.0 - a) * hist
        mx = float(combined.max())
        cells = (combined / mx).tolist() if mx >= 1e-12 else []
        return {
            "grid_w": GRID_W,
            "grid_h": GRID_H,
            "mode": mode,
            "alpha": self._alpha,
            "cells": cells,
            "max_val": mx,
        }

    def score_zones(
        self,
        zone_masks: list[tuple[int, np.ndarray]],
        mode: str = "composite",
    ) -> list[dict[str, Any]]:
        """zone_masks: (zone_id, mask 32x18 float 0/1)."""
        sg = self.score_grid(mode=mode)
        g = (
            np.array(sg["cells"], dtype=np.float64).reshape(GRID_H, GRID_W)
            if sg["cells"]
            else np.zeros((GRID_H, GRID_W))
        )
        out: list[dict[str, Any]] = []
        for zid, mask in zone_masks:
            m = np.asarray(mask, dtype=np.float64)
            if m.shape != (GRID_H, GRID_W):
                continue
            s = float((g * m).sum() / max(1e-12, m.sum()))
            out.append({"id": int(zid), "score": s})
        return out
