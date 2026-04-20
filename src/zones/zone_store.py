"""CRUD de zonas e templates; seed dos builtins."""

from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy import delete, select

from persistence.db import get_session_factory
from persistence.heatmap_store import HeatmapStore
from persistence.zone_models import Zone, ZoneTemplate

from zones.zone_model import ZoneRecord
from zones.zone_templates import BUILTIN_TEMPLATE_SPECS, template_weights_json, template_zone_defs_json


def _parse_polygon_norm(raw: str) -> list[tuple[float, float]]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    out: list[tuple[float, float]] = []
    if isinstance(data, list):
        for p in data:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                out.append((float(p[0]), float(p[1])))
            elif isinstance(p, dict):
                out.append((float(p.get("x", 0)), float(p.get("y", 0))))
    return out


def ensure_builtin_templates() -> None:
    now = time.time()
    fac = get_session_factory()
    with fac() as session:
        for slug, spec in BUILTIN_TEMPLATE_SPECS.items():
            stmt = select(ZoneTemplate).where(ZoneTemplate.slug == slug)
            row = session.scalars(stmt).first()
            zj = template_zone_defs_json(slug)
            wj = template_weights_json(slug)
            name = str(spec.get("name", slug))
            desc = str(spec.get("description", ""))
            if row is None:
                session.add(
                    ZoneTemplate(
                        slug=slug,
                        name=name,
                        description=desc,
                        zone_defs_json=zj,
                        builtin=True,
                        default_weights_json=wj,
                        created_at=now,
                    )
                )
            else:
                row.name = name
                row.description = desc
                row.zone_defs_json = zj
                row.default_weights_json = wj
                row.builtin = True
        session.commit()


class ZoneStore:
    def list_templates(self) -> list[dict[str, Any]]:
        ensure_builtin_templates()
        fac = get_session_factory()
        with fac() as session:
            rows = list(session.scalars(select(ZoneTemplate).order_by(ZoneTemplate.slug)).all())
        return [
            {
                "id": r.id,
                "slug": r.slug,
                "name": r.name,
                "description": r.description,
                "builtin": r.builtin,
                "default_weights": json.loads(r.default_weights_json or "{}"),
            }
            for r in rows
        ]

    def get_template(self, slug: str) -> ZoneTemplate | None:
        ensure_builtin_templates()
        fac = get_session_factory()
        with fac() as session:
            return session.scalars(
                select(ZoneTemplate).where(ZoneTemplate.slug == slug.strip())
            ).first()

    def create_custom_template(
        self,
        *,
        slug: str,
        name: str,
        description: str,
        zones: list[dict[str, Any]],
        weights: dict[str, float] | None = None,
    ) -> int:
        ensure_builtin_templates()
        fac = get_session_factory()
        slug = slug.strip()[:96]
        if not slug:
            raise ValueError("slug vazio")
        now = time.time()
        with fac() as session:
            if session.scalars(select(ZoneTemplate).where(ZoneTemplate.slug == slug)).first():
                raise ValueError(f"slug ja existe: {slug}")
            row = ZoneTemplate(
                slug=slug,
                name=name[:256],
                description=description[:4096],
                zone_defs_json=json.dumps(zones, separators=(",", ":")),
                builtin=False,
                default_weights_json=json.dumps(weights or {}, separators=(",", ":")),
                created_at=now,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            return int(row.id)

    def list_zones(self, site_id: str, camera_id: str) -> list[dict[str, Any]]:
        ensure_builtin_templates()
        sid = site_id[:64]
        cid = camera_id[:64]
        fac = get_session_factory()
        with fac() as session:
            rows = list(
                session.scalars(
                    select(Zone)
                    .where(Zone.site_id == sid)
                    .where(Zone.camera_id == cid)
                    .where(Zone.active_until.is_(None))
                    .order_by(Zone.id)
                ).all()
            )
        return [
            {
                "id": r.id,
                "name": r.name,
                "zone_type": r.zone_type,
                "template_id": r.template_id,
                "polygon": _parse_polygon_norm(r.polygon_json),
                "grid_version": r.grid_version,
            }
            for r in rows
        ]

    def load_zone_records(self, site_id: str, camera_id: str) -> list[ZoneRecord]:
        rows = self.list_zones(site_id, camera_id)
        out: list[ZoneRecord] = []
        for z in rows:
            poly = z.get("polygon") or []
            if len(poly) < 3:
                continue
            norm = [(float(p[0]), float(p[1])) for p in poly]
            out.append(
                ZoneRecord(
                    id=int(z["id"]),
                    site_id=site_id[:64],
                    camera_id=camera_id[:64],
                    name=str(z["name"]),
                    zone_type=str(z.get("zone_type") or "generic"),
                    grid_version=int(z.get("grid_version") or 1),
                    polygon_norm=norm,
                )
            )
        return out

    def create_zone(
        self,
        *,
        site_id: str,
        camera_id: str,
        name: str,
        zone_type: str,
        polygon_norm: list[tuple[float, float]],
        template_id: int | None,
        grid_version: int,
    ) -> int:
        ensure_builtin_templates()
        if len(polygon_norm) < 3:
            raise ValueError("poligono precisa de pelo menos 3 pontos")
        fac = get_session_factory()
        now = time.time()
        poly_json = json.dumps([[a, b] for a, b in polygon_norm], separators=(",", ":"))
        with fac() as session:
            row = Zone(
                site_id=site_id[:64],
                camera_id=camera_id[:64],
                template_id=template_id,
                name=name[:256],
                zone_type=zone_type[:64],
                polygon_json=poly_json,
                grid_version=int(grid_version),
                active_from=now,
                active_until=None,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
            return int(row.id)

    def update_zone(
        self,
        zone_id: int,
        *,
        name: str | None = None,
        zone_type: str | None = None,
        polygon_norm: list[tuple[float, float]] | None = None,
        grid_version: int | None = None,
    ) -> bool:
        ensure_builtin_templates()
        fac = get_session_factory()
        with fac() as session:
            row = session.get(Zone, int(zone_id))
            if row is None or row.active_until is not None:
                return False
            if name is not None:
                row.name = name[:256]
            if zone_type is not None:
                row.zone_type = zone_type[:64]
            if polygon_norm is not None:
                if len(polygon_norm) < 3:
                    return False
                row.polygon_json = json.dumps(
                    [[a, b] for a, b in polygon_norm], separators=(",", ":")
                )
            if grid_version is not None:
                row.grid_version = int(grid_version)
            session.commit()
            return True

    def delete_zone(self, zone_id: int) -> bool:
        fac = get_session_factory()
        now = time.time()
        with fac() as session:
            row = session.get(Zone, int(zone_id))
            if row is None:
                return False
            row.active_until = now
            session.commit()
            return True

    def instantiate_from_template(
        self,
        *,
        site_id: str,
        camera_id: str,
        template_slug: str,
        heatmap_store: HeatmapStore | None = None,
    ) -> list[int]:
        """Cria zonas a partir de um template builtin; faz bump de grid_version."""
        ensure_builtin_templates()
        tpl = self.get_template(template_slug)
        if tpl is None:
            raise ValueError(f"template desconhecido: {template_slug}")
        hs = heatmap_store or HeatmapStore()
        gv = hs.bump_grid_version(site_id[:64], camera_id[:64], reason=f"template:{template_slug}")
        try:
            defs = json.loads(tpl.zone_defs_json or "[]")
        except json.JSONDecodeError:
            defs = []
        ids: list[int] = []
        if not isinstance(defs, list):
            return ids
        for z in defs:
            if not isinstance(z, dict):
                continue
            raw_poly = z.get("polygon")
            name = str(z.get("name", "Zona"))[:256]
            zt = str(z.get("zone_type", "generic"))[:64]
            if not isinstance(raw_poly, list) or len(raw_poly) < 3:
                continue
            poly: list[tuple[float, float]] = []
            for p in raw_poly:
                if isinstance(p, (list, tuple)) and len(p) >= 2:
                    poly.append((float(p[0]), float(p[1])))
            if len(poly) < 3:
                continue
            ids.append(
                self.create_zone(
                    site_id=site_id,
                    camera_id=camera_id,
                    name=name,
                    zone_type=zt,
                    polygon_norm=poly,
                    template_id=int(tpl.id),
                    grid_version=gv,
                )
            )
        return ids
