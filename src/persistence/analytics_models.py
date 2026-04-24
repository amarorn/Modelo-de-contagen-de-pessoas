from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Double, Index, Integer, PrimaryKeyConstraint, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from persistence.models import Base


class EventRawRow(Base):
    __tablename__ = "events_raw"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    camera_id: Mapped[str] = mapped_column(String(128), nullable=False)
    roi_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    track_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cls: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    x: Mapped[float | None] = mapped_column(Double, nullable=True)
    y: Mapped[float | None] = mapped_column(Double, nullable=True)
    speed: Mapped[float | None] = mapped_column(Double, nullable=True)
    direction: Mapped[float | None] = mapped_column(Double, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Double, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


Index("idx_events_raw_camera_time", EventRawRow.camera_id, EventRawRow.timestamp)
Index("idx_events_raw_type_time", EventRawRow.event_type, EventRawRow.timestamp)
Index("idx_events_raw_track", EventRawRow.track_id, EventRawRow.timestamp)


class EventAggregatedRow(Base):
    __tablename__ = "events_aggregated"
    __table_args__ = (
        PrimaryKeyConstraint("minute_bucket", "camera_id", "roi_id", "cls", name="pk_events_agg"),
    )

    minute_bucket: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    camera_id: Mapped[str] = mapped_column(String(128), nullable=False)
    roi_id: Mapped[str] = mapped_column(String(128), nullable=False)
    cls: Mapped[str] = mapped_column(String(64), nullable=False, default="all")
    entries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    detections: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    avg_speed: Mapped[float | None] = mapped_column(Double, nullable=True)
    speed_sum: Mapped[float] = mapped_column(Double, nullable=False, default=0.0)
    speed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_tracks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # JSON sets for idempotency and unique-track dedup
    processed_event_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    track_ids_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TrajectoryRow(Base):
    __tablename__ = "trajectories"
    __table_args__ = (
        PrimaryKeyConstraint("track_id", "camera_id", name="pk_trajectories"),
    )

    track_id: Mapped[str] = mapped_column(String(64), nullable=False)
    camera_id: Mapped[str] = mapped_column(String(128), nullable=False)
    cls: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    path_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    zones_crossed_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    entry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


Index(
    "idx_trajectories_camera_status",
    TrajectoryRow.camera_id,
    TrajectoryRow.status,
    TrajectoryRow.updated_at,
)
