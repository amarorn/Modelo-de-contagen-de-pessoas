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


def _ring_from_dict_list(raw_ring: Any) -> list[tuple[int, int]]:
    if not isinstance(raw_ring, list):
        return []
    out: list[tuple[int, int]] = []
    for p in raw_ring:
        if isinstance(p, dict) and "x" in p and "y" in p:
            try:
                out.append((int(p["x"]), int(p["y"])))
            except (TypeError, ValueError):
                continue
    return out


def _polygon_title_from_item(item: Any, fallback_index: int) -> str:
    if isinstance(item, dict):
        t = item.get("title") or item.get("name")
        if isinstance(t, str) and t.strip():
            return t.strip()[:64]
    return f"Área {fallback_index + 1}"


def parse_polygons_json(raw: Any) -> list[dict[str, Any]]:
    """JSON em polygon_json: [{title, points:[{x,y},...]}, ...] ou legado [[...],...] ou [{x,y},...]."""
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list) or not raw:
        return []
    first = raw[0]
    if isinstance(first, dict):
        if "points" in first:
            out: list[dict[str, Any]] = []
            for item in raw:
                if not isinstance(item, dict):
                    continue
                ring = _ring_from_dict_list(item.get("points"))
                if len(ring) < 3:
                    continue
                title = _polygon_title_from_item(item, len(out))
                out.append({"title": title, "points": ring, "inverted": bool(item.get("inverted", False))})
            return out
        ring = _ring_from_dict_list(raw)
        return [{"title": "Área 1", "points": ring}] if len(ring) >= 3 else []
    out2: list[dict[str, Any]] = []
    for item in raw:
        ring = _ring_from_dict_list(item)
        if len(ring) >= 3:
            out2.append({"title": f"Área {len(out2) + 1}", "points": ring})
    return out2


def dump_polygons_json(polygons: list[dict[str, Any]]) -> str:
    items: list[dict[str, Any]] = []
    for i, e in enumerate(polygons):
        if not isinstance(e, dict):
            continue
        pts = e.get("points") or []
        if len(pts) < 3:
            continue
        title = _polygon_title_from_item(e, len(items))
        items.append(
            {
                "title": title,
                "points": [{"x": int(a), "y": int(b)} for a, b in pts],
                "inverted": bool(e.get("inverted", False)),
            }
        )
    return json.dumps(items, ensure_ascii=False)


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
            polygons = parse_polygons_json(raw)
            first_flat: list[tuple[int, int]] = (
                list(polygons[0]["points"]) if polygons and isinstance(polygons[0], dict) else []
            )
            mode = str(row.count_mode or "line").strip()
            if mode not in ("line", "polygon"):
                mode = "line"
            if mode == "polygon" and not polygons:
                mode = "line"
            return {
                "count_mode": mode,
                "line": (int(row.line_x1), int(row.line_y1), int(row.line_x2), int(row.line_y2)),
                "polygons": polygons,
                "polygon": first_flat,
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
    polygons: list[dict[str, Any]],
) -> None:
    if not preset_id:
        return
    pid = preset_id.strip()[:32]
    if not pid:
        return
    mode = count_mode if count_mode in ("line", "polygon") else "line"
    entries = [
        e
        for e in polygons
        if isinstance(e, dict) and len(e.get("points") or []) >= 3
    ]
    if mode == "polygon" and not entries:
        mode = "line"
    x1, y1, x2, y2 = (int(line[0]), int(line[1]), int(line[2]), int(line[3]))
    poly_json = dump_polygons_json(entries) if entries else "[]"
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
