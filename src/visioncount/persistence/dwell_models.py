"""Modelos SQLAlchemy para dwell por celula e estatisticas por zona semantica."""

from __future__ import annotations

from sqlalchemy import Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from visioncount.persistence.models import Base


class DwellSlot(Base):
    """Agregado de 30 min de segundos de permanencia por celula (32x18)."""

    __tablename__ = "dwell_slots"
    __table_args__ = (
        Index("ix_dwell_slot_lookup", "site_id", "camera_id", "slot_ts", "grid_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    camera_id: Mapped[str] = mapped_column(String(64), nullable=False)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    slot_ts: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    grid_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    grid_w: Mapped[int] = mapped_column(Integer, nullable=False, default=32)
    grid_h: Mapped[int] = mapped_column(Integer, nullable=False, default=18)
    cells_json: Mapped[str] = mapped_column(Text, nullable=False)
    total_dwell_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)


class ZoneStatsSlot(Base):
    """Metricas agregadas por zona semantica em cada slot de 30 min."""

    __tablename__ = "zone_stats_slots"
    __table_args__ = (
        Index("ix_zone_stats_lookup", "site_id", "camera_id", "zone_id", "slot_ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    camera_id: Mapped[str] = mapped_column(String(64), nullable=False)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    zone_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    slot_ts: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    grid_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    visits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_ids: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_dwell_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_dwell_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    p95_dwell_s: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    peak_occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
