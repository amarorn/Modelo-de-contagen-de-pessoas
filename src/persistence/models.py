from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
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
