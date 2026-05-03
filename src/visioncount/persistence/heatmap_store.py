"""Persistência e consulta histórica de heatmap slots."""
from __future__ import annotations

import json
import logging
import time
from typing import Optional

import numpy as np
from sqlalchemy import select

import visioncount.persistence.heatmap_models  # noqa: F401 — registra tabelas no Base.metadata
from visioncount.persistence.db import get_session_factory
from visioncount.persistence.heatmap_models import GridVersion, HeatmapSlot

log = logging.getLogger(__name__)


class HeatmapStore:
    """Fachada de leitura/escrita para heatmap_slots e grid_versions."""

    def __init__(self) -> None:
        self._sf = None  # lazy: criado na primeira chamada

    def _get_sf(self):
        if self._sf is None:
            self._sf = get_session_factory()
        return self._sf

    # ── Grid version ──────────────────────────────────────────────

    def get_or_create_grid_version(self, site_id: str, camera_id: str) -> int:
        sf = self._get_sf()
        with sf() as session:
            stmt = (
                select(GridVersion)
                .where(GridVersion.site_id == site_id)
                .where(GridVersion.camera_id == camera_id)
                .where(GridVersion.valid_until.is_(None))
                .order_by(GridVersion.version.desc())
                .limit(1)
            )
            row = session.scalars(stmt).first()
            if row:
                return int(row.version)
            v = GridVersion(
                site_id=site_id,
                camera_id=camera_id,
                version=1,
                valid_from=time.time(),
                valid_until=None,
                grid_w=32,
                grid_h=18,
                reason="initial",
            )
            session.add(v)
            session.commit()
            return 1

    def bump_grid_version(
        self, site_id: str, camera_id: str, reason: str = "roi_change"
    ) -> int:
        """Fecha a versão atual e cria uma nova. Retorna o novo número de versão."""
        sf = self._get_sf()
        now = time.time()
        with sf() as session:
            stmt = (
                select(GridVersion)
                .where(GridVersion.site_id == site_id)
                .where(GridVersion.camera_id == camera_id)
                .where(GridVersion.valid_until.is_(None))
                .order_by(GridVersion.version.desc())
                .limit(1)
            )
            current = session.scalars(stmt).first()
            new_version = 1
            if current:
                current.valid_until = now
                new_version = current.version + 1
            v = GridVersion(
                site_id=site_id,
                camera_id=camera_id,
                version=new_version,
                valid_from=now,
                valid_until=None,
                grid_w=32,
                grid_h=18,
                reason=reason,
            )
            session.add(v)
            session.commit()
            log.info("[heatmap] grid_version bumped → %d (%s)", new_version, reason)
            return new_version

    # ── Write ─────────────────────────────────────────────────────

    def write_slot(
        self,
        site_id: str,
        camera_id: str,
        session_id: str,
        slot_ts: int,
        raw_grid: np.ndarray,
        grid_version: int = 1,
    ) -> None:
        total = int(raw_grid.sum())
        if total == 0:
            return
        gh, gw = raw_grid.shape
        cells_flat = raw_grid.flatten().tolist()
        try:
            sf = self._get_sf()
            with sf() as session:
                row = HeatmapSlot(
                    site_id=site_id,
                    camera_id=camera_id,
                    session_id=session_id,
                    slot_ts=slot_ts,
                    grid_version=grid_version,
                    grid_w=gw,
                    grid_h=gh,
                    cells_json=json.dumps(cells_flat),
                    total_events=total,
                )
                session.add(row)
                session.commit()
                log.debug(
                    "[heatmap] slot written: cam=%s slot_ts=%d events=%d",
                    camera_id, slot_ts, total,
                )
        except Exception:
            log.exception("[heatmap] write_slot failed — slot_ts=%d", slot_ts)

    # ── Query ─────────────────────────────────────────────────────

    def query_historical(
        self,
        site_id: str,
        camera_id: str,
        from_ts: float,
        to_ts: float,
        grid_version: Optional[int] = None,
        grid_w: int = 32,
        grid_h: int = 18,
    ) -> dict:
        """Agrega todos os slots no intervalo [from_ts, to_ts) e normaliza."""
        try:
            sf = self._get_sf()
            with sf() as session:
                stmt = (
                    select(HeatmapSlot)
                    .where(HeatmapSlot.site_id == site_id)
                    .where(HeatmapSlot.camera_id == camera_id)
                    .where(HeatmapSlot.slot_ts >= int(from_ts))
                    .where(HeatmapSlot.slot_ts < int(to_ts))
                )
                if grid_version is not None:
                    stmt = stmt.where(HeatmapSlot.grid_version == grid_version)
                rows = list(session.scalars(stmt).all())
        except Exception:
            log.exception("[heatmap] query_historical failed")
            rows = []

        if not rows:
            return {
                "grid_w": grid_w, "grid_h": grid_h,
                "total_events": 0, "max_val": 0.0,
                "cells": [], "slots_merged": 0,
            }

        gw = rows[0].grid_w
        gh = rows[0].grid_h
        merged = np.zeros((gh, gw), dtype=np.float64)
        total_events = 0

        for row in rows:
            try:
                flat = json.loads(row.cells_json)
                arr = np.array(flat, dtype=np.float64).reshape(gh, gw)
                merged += arr
                total_events += row.total_events
            except (json.JSONDecodeError, ValueError):
                log.warning("[heatmap] bad cells_json in slot id=%d", row.id)

        max_val = float(merged.max())
        cells = (merged / max_val).tolist() if max_val >= 1e-6 else []

        return {
            "grid_w": gw,
            "grid_h": gh,
            "total_events": total_events,
            "max_val": max_val,
            "cells": cells,
            "slots_merged": len(rows),
        }

    def query_slots_raw(
        self,
        site_id: str,
        camera_id: str,
        from_ts: float,
        to_ts: float,
        grid_version: Optional[int] = None,
        max_slots: int = 96,
    ) -> list[tuple[int, np.ndarray]]:
        """Retorna lista de (slot_ts, raw_grid) ordenada por slot_ts."""
        try:
            sf = self._get_sf()
            with sf() as session:
                stmt = (
                    select(HeatmapSlot)
                    .where(HeatmapSlot.site_id == site_id)
                    .where(HeatmapSlot.camera_id == camera_id)
                    .where(HeatmapSlot.slot_ts >= int(from_ts))
                    .where(HeatmapSlot.slot_ts < int(to_ts))
                    .order_by(HeatmapSlot.slot_ts.asc())
                    .limit(max_slots)
                )
                if grid_version is not None:
                    stmt = stmt.where(HeatmapSlot.grid_version == grid_version)
                rows = list(session.scalars(stmt).all())
        except Exception:
            log.exception("[heatmap] query_slots_raw failed")
            return []

        result: list[tuple[int, np.ndarray]] = []
        for row in rows:
            try:
                arr = np.array(json.loads(row.cells_json), dtype=np.float64).reshape(
                    row.grid_h, row.grid_w
                )
                result.append((int(row.slot_ts), arr))
            except (json.JSONDecodeError, ValueError):
                log.warning("[heatmap] bad cells_json slot_ts=%d", row.slot_ts)
        return result

    def query_diff(
        self,
        site_id: str,
        camera_id: str,
        period_from: float,
        period_to: float,
        baseline_from: float,
        baseline_to: float,
        grid_version: Optional[int] = None,
        grid_w: int = 32,
        grid_h: int = 18,
    ) -> dict:
        """Compara período recente contra baseline histórico.

        Retorna:
          delta   — (period_norm − baseline_norm) normalizado em [-1, +1]
          anomaly — z-score normalizado em [0, 1]; NaN tratado como 0
        """
        period_slots  = self.query_slots_raw(site_id, camera_id, period_from,  period_to,  grid_version)
        baseline_slots = self.query_slots_raw(site_id, camera_id, baseline_from, baseline_to, grid_version)

        empty = {
            "grid_w": grid_w, "grid_h": grid_h,
            "delta": [], "anomaly": [],
            "period_events": 0, "baseline_events": 0,
            "has_anomaly_data": False,
        }
        if not period_slots or not baseline_slots:
            return empty

        gw = period_slots[0][1].shape[1]
        gh = period_slots[0][1].shape[0]

        # Somar slots de cada janela
        period_sum = np.zeros((gh, gw), dtype=np.float64)
        for _, arr in period_slots:
            period_sum += arr

        baseline_sum = np.zeros((gh, gw), dtype=np.float64)
        for _, arr in baseline_slots:
            baseline_sum += arr

        # Normalizar cada soma independentemente em [0, 1]
        pm = float(period_sum.max())
        bm = float(baseline_sum.max())
        period_norm   = period_sum   / pm if pm > 1e-9 else period_sum
        baseline_norm = baseline_sum / bm if bm > 1e-9 else baseline_sum

        delta = period_norm - baseline_norm  # [-1, +1]

        # Anomalia: z-score por célula sobre os slots de baseline normalizados
        has_anomaly = len(baseline_slots) >= 3
        if has_anomaly:
            stack = np.stack([
                arr / max(float(arr.max()), 1e-9)
                for _, arr in baseline_slots
            ], axis=0)  # shape: (n_slots, gh, gw)
            b_mean = stack.mean(axis=0)
            b_std  = stack.std(axis=0)
            z = (period_norm - b_mean) / np.maximum(b_std, 0.08)
            # Normalizar z positivo para [0, 1] (clip em 3σ)
            z_norm = np.clip(z, 0.0, 3.0) / 3.0
            anomaly_cells = z_norm.tolist()
        else:
            anomaly_cells = []

        return {
            "grid_w": gw,
            "grid_h": gh,
            "delta": delta.tolist(),
            "anomaly": anomaly_cells,
            "period_events": sum(int(arr.sum()) for _, arr in period_slots),
            "baseline_events": sum(int(arr.sum()) for _, arr in baseline_slots),
            "has_anomaly_data": has_anomaly,
        }
