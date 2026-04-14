"""Persistencia de linha/poligono/modo por preset de camera (SQLAlchemy)."""

from __future__ import annotations

import json
import os
from typing import Any

from sqlalchemy import delete, select

from persistence.db import get_session_factory
from persistence.envutil import strip_env_comment
from persistence.models import CameraCalibration


def site_id() -> str:
    s = strip_env_comment(os.environ.get("SITE_ID", "default"))
    return (s or "default")[:64]


def load(site_id_: str, preset_id: str) -> dict[str, Any] | None:
    if not preset_id:
        return None
    pid = preset_id.strip()[:32]
    if not pid:
        return None
    try:
        fac = get_session_factory()
        with fac() as sess:
            row = sess.execute(
                select(CameraCalibration).where(
                    CameraCalibration.site_id == site_id_[:64],
                    CameraCalibration.preset_id == pid,
                )
            ).scalar_one_or_none()
            if row is None:
                return None
            try:
                raw = json.loads(row.polygon_json or "[]")
            except json.JSONDecodeError:
                raw = []
            poly: list[tuple[int, int]] = []
            if isinstance(raw, list):
                for p in raw:
                    if isinstance(p, dict) and "x" in p and "y" in p:
                        poly.append((int(p["x"]), int(p["y"])))
            mode = str(row.count_mode or "line").strip()
            if mode not in ("line", "polygon"):
                mode = "line"
            if mode == "polygon" and len(poly) < 3:
                mode = "line"
                poly = []
            return {
                "count_mode": mode,
                "line": (int(row.line_x1), int(row.line_y1), int(row.line_x2), int(row.line_y2)),
                "polygon": poly,
            }
    except Exception as exc:
        print(f"[camera_cal] load falhou preset={preset_id!r}: {exc}", flush=True)
        return None


def save(
    site_id_: str,
    preset_id: str,
    *,
    count_mode: str,
    line: tuple[int, int, int, int],
    polygon: list[tuple[int, int]],
) -> None:
    if not preset_id:
        return
    pid = preset_id.strip()[:32]
    if not pid:
        return
    mode = count_mode if count_mode in ("line", "polygon") else "line"
    if mode == "polygon" and len(polygon) < 3:
        mode = "line"
        polygon = []
    x1, y1, x2, y2 = (int(line[0]), int(line[1]), int(line[2]), int(line[3]))
    poly_json = json.dumps([{"x": a, "y": b} for a, b in polygon], ensure_ascii=False)
    sid = site_id_[:64]
    try:
        fac = get_session_factory()
        with fac() as sess:
            row = sess.execute(
                select(CameraCalibration).where(
                    CameraCalibration.site_id == sid,
                    CameraCalibration.preset_id == pid,
                )
            ).scalar_one_or_none()
            if row is None:
                sess.add(
                    CameraCalibration(
                        site_id=sid,
                        preset_id=pid,
                        count_mode=mode,
                        line_x1=x1,
                        line_y1=y1,
                        line_x2=x2,
                        line_y2=y2,
                        polygon_json=poly_json,
                    )
                )
            else:
                row.count_mode = mode
                row.line_x1 = x1
                row.line_y1 = y1
                row.line_x2 = x2
                row.line_y2 = y2
                row.polygon_json = poly_json
            sess.commit()
    except Exception as exc:
        print(f"[camera_cal] save falhou preset={preset_id!r}: {exc}", flush=True)


def delete(site_id_: str, preset_id: str) -> None:
    pid = (preset_id or "").strip()[:32]
    if not pid:
        return
    sid = site_id_[:64]
    try:
        fac = get_session_factory()
        with fac() as sess:
            sess.execute(
                delete(CameraCalibration).where(
                    CameraCalibration.site_id == sid,
                    CameraCalibration.preset_id == pid,
                )
            )
            sess.commit()
    except Exception as exc:
        print(f"[camera_cal] delete falhou preset={preset_id!r}: {exc}", flush=True)
