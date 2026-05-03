"""Modelos SQLAlchemy para heatmap analítico.
Schema compatível com ClickHouse heatmap_hourly para migração futura.
"""
from __future__ import annotations

from sqlalchemy import Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from visioncount.persistence.models import Base


class HeatmapSlot(Base):
    """Agregado de 30 min de centroides por câmera.
    Equivalente ao heatmap_hourly do ClickHouse — uma linha por slot completado.
    """

    __tablename__ = "heatmap_slots"
    __table_args__ = (
        Index("ix_hm_slot_lookup", "site_id", "camera_id", "slot_ts", "grid_version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    camera_id: Mapped[str] = mapped_column(String(64), nullable=False)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # unix timestamp do início do slot (floor(ts / 1800) * 1800)
    slot_ts: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    grid_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    grid_w: Mapped[int] = mapped_column(Integer, nullable=False, default=32)
    grid_h: Mapped[int] = mapped_column(Integer, nullable=False, default=18)
    # contagens brutas (não normalizadas) em flat JSON row-major: len = grid_h * grid_w
    cells_json: Mapped[str] = mapped_column(Text, nullable=False)
    total_events: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class GridVersion(Base):
    """Versão da grade/ROI por câmera — rastreia mudanças de calibração."""

    __tablename__ = "grid_versions"
    __table_args__ = (
        Index("ix_gv_camera", "site_id", "camera_id", "version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(64), nullable=False, default="default")
    camera_id: Mapped[str] = mapped_column(String(64), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    valid_from: Mapped[float] = mapped_column(Float, nullable=False)
    valid_until: Mapped[float | None] = mapped_column(Float, nullable=True)
    grid_w: Mapped[int] = mapped_column(Integer, nullable=False, default=32)
    grid_h: Mapped[int] = mapped_column(Integer, nullable=False, default=18)
    # 'initial' | 'roi_change' | 'camera_moved' | 'resolution_change'
    reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
