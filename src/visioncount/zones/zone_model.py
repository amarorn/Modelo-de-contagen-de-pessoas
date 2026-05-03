"""Tipos leves para zonas (sem depender de ORM no loop quente)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ZoneRecord:
    id: int
    site_id: str
    camera_id: str
    name: str
    zone_type: str
    grid_version: int
    polygon_norm: list[tuple[float, float]]
