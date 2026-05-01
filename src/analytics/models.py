from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

VALID_EVENT_TYPES: frozenset[str] = frozenset(
    {"detection", "entry", "exit", "zone_enter", "zone_exit", "drift", "alert"}
)

# event types that require track_id / roi_id
_NEED_TRACK = frozenset({"detection", "entry", "exit", "zone_enter", "zone_exit"})
_NEED_ROI = frozenset({"entry", "exit", "zone_enter", "zone_exit"})


class ValidationError(ValueError):
    pass


def _parse_dt(value: str | datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


@dataclass
class EventRaw:
    id: str
    timestamp: datetime
    camera_id: str
    event_type: str
    track_id: str | None = None
    roi_id: str | None = None
    cls: str | None = None
    x: float | None = None
    y: float | None = None
    speed: float | None = None
    direction: float | None = None
    confidence: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EventRaw":
        event_type = str(data.get("event_type") or "").strip()
        if not event_type:
            raise ValidationError("event_type is required")
        if event_type not in VALID_EVENT_TYPES:
            raise ValidationError(
                f"invalid event_type {event_type!r}; valid: {sorted(VALID_EVENT_TYPES)}"
            )

        camera_id = str(data.get("camera_id") or "").strip()
        if not camera_id:
            raise ValidationError("camera_id is required")

        track_id: str | None = str(data["track_id"]).strip() if data.get("track_id") else None
        if track_id is None and event_type in _NEED_TRACK:
            raise ValidationError(f"track_id is required for event_type={event_type!r}")

        roi_id: str | None = str(data["roi_id"]).strip() if data.get("roi_id") else None
        if roi_id is None and event_type in _NEED_ROI:
            raise ValidationError(f"roi_id is required for event_type={event_type!r}")

        x = float(data["x"]) if data.get("x") is not None else None
        y = float(data["y"]) if data.get("y") is not None else None
        if x is not None and not 0.0 <= x <= 1.0:
            raise ValidationError(f"x must be in [0..1], got {x}")
        if y is not None and not 0.0 <= y <= 1.0:
            raise ValidationError(f"y must be in [0..1], got {y}")

        direction = float(data["direction"]) if data.get("direction") is not None else None
        if direction is not None and not 0.0 <= direction <= 360.0:
            raise ValidationError(f"direction must be in [0..360], got {direction}")

        return cls(
            id=str(data.get("id") or uuid.uuid4()),
            timestamp=_parse_dt(data.get("timestamp")),
            camera_id=camera_id,
            event_type=event_type,
            track_id=track_id,
            roi_id=roi_id,
            cls=str(data.get("class") or data.get("cls") or "unknown").strip() or None,
            x=x,
            y=y,
            speed=float(data["speed"]) if data.get("speed") is not None else None,
            direction=direction,
            confidence=float(data["confidence"]) if data.get("confidence") is not None else None,
            metadata=dict(data.get("metadata") or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "camera_id": self.camera_id,
            "event_type": self.event_type,
            "track_id": self.track_id,
            "roi_id": self.roi_id,
            "class": self.cls,
            "x": self.x,
            "y": self.y,
            "speed": self.speed,
            "direction": self.direction,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }


@dataclass
class TrajectoryPoint:
    timestamp: datetime
    x: float
    y: float
    speed: float | None = None
    direction: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "x": self.x,
            "y": self.y,
            "speed": self.speed,
            "direction": self.direction,
        }


@dataclass
class Trajectory:
    track_id: str
    camera_id: str
    cls: str
    started_at: datetime
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    path: list[TrajectoryPoint] = field(default_factory=list)
    zones_crossed: list[str] = field(default_factory=list)
    entry_count: int = 0
    exit_count: int = 0
    status: str = "active"
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict[str, Any]:
        return {
            "track_id": self.track_id,
            "camera_id": self.camera_id,
            "class": self.cls,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else None,
            "duration_seconds": self.duration_seconds,
            "path": [p.to_dict() for p in self.path],
            "zones_crossed": self.zones_crossed,
            "entry_count": self.entry_count,
            "exit_count": self.exit_count,
            "status": self.status,
            "updated_at": self.updated_at.isoformat(),
        }
