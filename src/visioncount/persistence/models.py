from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class StatsSnapshot(Base):
    __tablename__ = "stats_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    site_id: Mapped[str] = mapped_column(String(64), default="default", index=True)
    payload_json: Mapped[str] = mapped_column(Text)


class ConfigEvent(Base):
    __tablename__ = "config_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    session_id: Mapped[str] = mapped_column(String(64), index=True)
    site_id: Mapped[str] = mapped_column(String(64), default="default", index=True)
    event_type: Mapped[str] = mapped_column(String(96), index=True)
    payload_json: Mapped[str] = mapped_column(Text)


class CameraCalibration(Base):
    """Linha / poligono / modo de contagem por preset (id da lista de cameras)."""

    __tablename__ = "camera_calibrations"
    __table_args__ = (UniqueConstraint("site_id", "preset_id", name="uq_cam_cal_site_preset"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    preset_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    count_mode: Mapped[str] = mapped_column(String(16), default="line")
    line_x1: Mapped[int] = mapped_column(Integer, default=0)
    line_y1: Mapped[int] = mapped_column(Integer, default=0)
    line_x2: Mapped[int] = mapped_column(Integer, default=0)
    line_y2: Mapped[int] = mapped_column(Integer, default=0)
    polygon_json: Mapped[str] = mapped_column(Text, default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
