"""Persistencia de dwell_slots e zone_stats_slots."""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

import numpy as np
from sqlalchemy import select

import visioncount.persistence.dwell_models  # noqa: F401
from visioncount.persistence.db import get_session_factory
from visioncount.persistence.dwell_models import DwellSlot, ZoneStatsSlot

log = logging.getLogger(__name__)


class DwellStore:
    def write_dwell_slot(
        self,
        site_id: str,
        camera_id: str,
        session_id: str,
        slot_ts: int,
        raw_grid: np.ndarray,
        grid_version: int = 1,
    ) -> None:
        total = float(raw_grid.sum())
        if total < 1e-12:
            return
        gh, gw = raw_grid.shape
        cells_flat = raw_grid.flatten().tolist()
        try:
            sf = get_session_factory()
            with sf() as session:
                row = DwellSlot(
                    site_id=site_id,
                    camera_id=camera_id,
                    session_id=session_id,
                    slot_ts=slot_ts,
                    grid_version=grid_version,
                    grid_w=gw,
                    grid_h=gh,
                    cells_json=json.dumps(cells_flat),
                    total_dwell_s=total,
                )
                session.add(row)
                session.commit()
        except Exception:
            log.exception("[dwell] write_dwell_slot failed slot_ts=%d", slot_ts)

    def write_zone_stats_slot(
        self,
        *,
        site_id: str,
        camera_id: str,
        session_id: str,
        slot_ts: int,
        grid_version: int,
        zone_id: int,
        visits: int,
        unique_ids: int,
        total_dwell_s: float,
        avg_dwell_s: float,
        p95_dwell_s: float,
        peak_occupancy: int,
    ) -> None:
        try:
            sf = get_session_factory()
            with sf() as session:
                row = ZoneStatsSlot(
                    site_id=site_id,
                    camera_id=camera_id,
                    session_id=session_id,
                    zone_id=int(zone_id),
                    slot_ts=int(slot_ts),
                    grid_version=int(grid_version),
                    visits=int(visits),
                    unique_ids=int(unique_ids),
                    total_dwell_s=float(total_dwell_s),
                    avg_dwell_s=float(avg_dwell_s),
                    p95_dwell_s=float(p95_dwell_s),
                    peak_occupancy=int(peak_occupancy),
                )
                session.add(row)
                session.commit()
        except Exception:
            log.exception("[dwell] write_zone_stats_slot failed zone_id=%s", zone_id)

    def query_dwell_historical(
        self,
        site_id: str,
        camera_id: str,
        from_ts: float,
        to_ts: float,
        grid_version: Optional[int] = None,
        grid_w: int = 32,
        grid_h: int = 18,
    ) -> dict[str, Any]:
        try:
            sf = get_session_factory()
            with sf() as session:
                stmt = (
                    select(DwellSlot)
                    .where(DwellSlot.site_id == site_id)
                    .where(DwellSlot.camera_id == camera_id)
                    .where(DwellSlot.slot_ts >= int(from_ts))
                    .where(DwellSlot.slot_ts < int(to_ts))
                )
                if grid_version is not None:
                    stmt = stmt.where(DwellSlot.grid_version == grid_version)
                rows = list(session.scalars(stmt).all())
        except Exception:
            log.exception("[dwell] query_dwell_historical failed")
            rows = []

        if not rows:
            return {
                "grid_w": grid_w,
                "grid_h": grid_h,
                "total_dwell_s": 0.0,
                "max_val": 0.0,
                "cells": [],
                "slots_merged": 0,
            }

        gw = rows[0].grid_w
        gh = rows[0].grid_h
        merged = np.zeros((gh, gw), dtype=np.float64)
        total_d = 0.0
        for row in rows:
            try:
                flat = json.loads(row.cells_json)
                arr = np.array(flat, dtype=np.float64).reshape(gh, gw)
                merged += arr
                total_d += float(row.total_dwell_s)
            except (json.JSONDecodeError, ValueError):
                log.warning("[dwell] bad cells_json dwell slot id=%d", row.id)

        max_val = float(merged.max())
        cells = (merged / max_val).tolist() if max_val >= 1e-12 else []
        return {
            "grid_w": gw,
            "grid_h": gh,
            "total_dwell_s": total_d,
            "max_val": max_val,
            "cells": cells,
            "slots_merged": len(rows),
        }

    def query_zone_stats(
        self,
        zone_id: int,
        from_ts: float,
        to_ts: float,
    ) -> list[dict[str, Any]]:
        try:
            sf = get_session_factory()
            with sf() as session:
                stmt = (
                    select(ZoneStatsSlot)
                    .where(ZoneStatsSlot.zone_id == int(zone_id))
                    .where(ZoneStatsSlot.slot_ts >= int(from_ts))
                    .where(ZoneStatsSlot.slot_ts < int(to_ts))
                    .order_by(ZoneStatsSlot.slot_ts)
                )
                rows = list(session.scalars(stmt).all())
        except Exception:
            log.exception("[dwell] query_zone_stats failed")
            rows = []
        return [
            {
                "slot_ts": r.slot_ts,
                "visits": r.visits,
                "unique_ids": r.unique_ids,
                "total_dwell_s": r.total_dwell_s,
                "avg_dwell_s": r.avg_dwell_s,
                "p95_dwell_s": r.p95_dwell_s,
                "peak_occupancy": r.peak_occupancy,
            }
            for r in rows
        ]
