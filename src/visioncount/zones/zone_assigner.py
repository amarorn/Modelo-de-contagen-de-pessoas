"""Atribui pes (x,y) em coordenadas de frame a zonas (poligonos normalizados)."""

from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np

from visioncount.zones.zone_model import ZoneRecord


class ZoneAssigner:
    def __init__(self, zones: Sequence[ZoneRecord], frame_w: int, frame_h: int) -> None:
        self._zones: list[ZoneRecord] = list(zones)
        self._fw = max(1, int(frame_w))
        self._fh = max(1, int(frame_h))
        self._cnts: list[tuple[int, np.ndarray]] = []
        for z in self._zones:
            pts = np.array(
                [
                    [int(round(p[0] * self._fw)), int(round(p[1] * self._fh))]
                    for p in z.polygon_norm
                ],
                dtype=np.int32,
            ).reshape(-1, 1, 2)
            self._cnts.append((z.id, pts))

    def assign(self, foot_x: float, foot_y: float) -> list[int]:
        pt = (float(foot_x), float(foot_y))
        out: list[int] = []
        for zid, cnt in self._cnts:
            r = cv2.pointPolygonTest(cnt, pt, False)
            if r >= 0:
                out.append(zid)
        return out

    def zone_ids(self) -> list[int]:
        return [z.id for z in self._zones]
