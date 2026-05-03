from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from visioncount.analytics.models import EventRaw, Trajectory, TrajectoryPoint
from visioncount.persistence.analytics_models import EventAggregatedRow, EventRawRow, TrajectoryRow

# Limite defensivo de linhas devolvidas por consultas de agregados (evita scans enormes).
MAX_AGGREGATION_QUERY_ROWS = 50_000
MAX_TRAJECTORY_RANGE_ROWS = 5_000


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _minute_bucket(ts: datetime) -> datetime:
    tz = ts.tzinfo or timezone.utc
    return ts.replace(second=0, microsecond=0, tzinfo=tz)


def _row_to_event(row: EventRawRow) -> EventRaw:
    return EventRaw(
        id=row.id,
        timestamp=row.timestamp,
        camera_id=row.camera_id,
        roi_id=row.roi_id,
        track_id=row.track_id,
        cls=row.cls,
        event_type=row.event_type,
        x=row.x,
        y=row.y,
        speed=row.speed,
        direction=row.direction,
        confidence=row.confidence,
        metadata=json.loads(row.metadata_json or "{}"),
    )


def _row_to_trajectory(row: TrajectoryRow) -> Trajectory:
    path_raw: list[dict[str, Any]] = json.loads(row.path_json or "[]")
    path = [
        TrajectoryPoint(
            timestamp=datetime.fromisoformat(p["timestamp"]),
            x=p["x"],
            y=p["y"],
            speed=p.get("speed"),
            direction=p.get("direction"),
        )
        for p in path_raw
    ]
    return Trajectory(
        track_id=row.track_id,
        camera_id=row.camera_id,
        cls=row.cls,
        started_at=row.started_at,
        ended_at=row.ended_at,
        duration_seconds=row.duration_seconds,
        path=path,
        zones_crossed=json.loads(row.zones_crossed_json or "[]"),
        entry_count=row.entry_count,
        exit_count=row.exit_count,
        status=row.status,
        updated_at=row.updated_at or _utcnow(),
    )


def _agg_to_dict(row: EventAggregatedRow) -> dict[str, Any]:
    return {
        "minute_bucket": row.minute_bucket.isoformat(),
        "camera_id": row.camera_id,
        "roi_id": row.roi_id,
        "class": row.cls,
        "entries": row.entries,
        "exits": row.exits,
        "detections": row.detections,
        "occupancy": row.occupancy,
        "avg_speed": row.avg_speed,
        "unique_tracks": row.unique_tracks,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


class AnalyticsStore:
    """All analytics DB operations. One instance per session/thread."""

    def __init__(self, session: Session) -> None:
        self._s = session

    # ── events_raw ─────────────────────────────────────────────────────────

    def append_event(self, event: EventRaw) -> bool:
        """Persist event. Returns True if inserted, False if duplicate."""
        if self._s.get(EventRawRow, event.id) is not None:
            return False
        self._s.add(
            EventRawRow(
                id=event.id,
                timestamp=event.timestamp,
                camera_id=event.camera_id,
                roi_id=event.roi_id,
                track_id=event.track_id,
                cls=event.cls,
                event_type=event.event_type,
                x=event.x,
                y=event.y,
                speed=event.speed,
                direction=event.direction,
                confidence=event.confidence,
                metadata_json=json.dumps(event.metadata, default=str),
            )
        )
        self._s.commit()
        return True

    def list_events(
        self,
        camera_id: str,
        from_dt: datetime,
        to_dt: datetime,
        event_types: list[str] | None = None,
        limit: int = 20_000,
    ) -> list[EventRaw]:
        q = (
            self._s.query(EventRawRow)
            .filter(
                EventRawRow.camera_id == camera_id,
                EventRawRow.timestamp >= from_dt,
                EventRawRow.timestamp <= to_dt,
            )
            .order_by(EventRawRow.timestamp)
        )
        if event_types:
            q = q.filter(EventRawRow.event_type.in_(event_types))
        return [_row_to_event(r) for r in q.limit(limit).all()]

    # ── events_aggregated ──────────────────────────────────────────────────

    def update_aggregation(self, event: EventRaw, *, commit: bool = True) -> None:
        """Incrementally update minute bucket. Idempotent by event.id."""
        if not event.roi_id:
            return

        bucket = _minute_bucket(event.timestamp)
        cls = event.cls or "all"
        pk = {"minute_bucket": bucket, "camera_id": event.camera_id, "roi_id": event.roi_id, "cls": cls}

        row: EventAggregatedRow | None = self._s.get(EventAggregatedRow, pk)
        if row is None:
            row = EventAggregatedRow(
                minute_bucket=bucket,
                camera_id=event.camera_id,
                roi_id=event.roi_id,
                cls=cls,
                processed_event_ids_json="[]",
                track_ids_json="[]",
            )
            self._s.add(row)

        processed: set[str] = set(json.loads(row.processed_event_ids_json or "[]"))
        if event.id in processed:
            return  # idempotent guard

        # ── counts ────────────────────────────────────────────────────────
        et = event.event_type
        if et == "entry":
            row.entries += 1
            row.occupancy = max(0, row.occupancy + 1)
        elif et == "exit":
            row.exits += 1
            row.occupancy = max(0, row.occupancy - 1)
        elif et == "detection":
            row.detections += 1

        # ── speed (accurate running avg) ──────────────────────────────────
        if event.speed is not None:
            row.speed_sum += event.speed
            row.speed_count += 1
            row.avg_speed = row.speed_sum / row.speed_count

        # ── unique tracks ─────────────────────────────────────────────────
        if event.track_id:
            track_ids: set[str] = set(json.loads(row.track_ids_json or "[]"))
            if event.track_id not in track_ids:
                track_ids.add(event.track_id)
                row.track_ids_json = json.dumps(list(track_ids))
                row.unique_tracks = len(track_ids)

        # ── mark event processed ──────────────────────────────────────────
        processed.add(event.id)
        row.processed_event_ids_json = json.dumps(list(processed))
        row.updated_at = _utcnow()
        if commit:
            self._s.commit()

    def list_aggregations(
        self,
        camera_id: str,
        from_dt: datetime,
        to_dt: datetime,
        roi_id: str | None = None,
        cls: str | None = None,
        limit: int = MAX_AGGREGATION_QUERY_ROWS,
    ) -> list[dict[str, Any]]:
        cap = min(max(1, limit), MAX_AGGREGATION_QUERY_ROWS)
        q = (
            self._s.query(EventAggregatedRow)
            .filter(
                EventAggregatedRow.camera_id == camera_id,
                EventAggregatedRow.minute_bucket >= from_dt,
                EventAggregatedRow.minute_bucket <= to_dt,
            )
            .order_by(EventAggregatedRow.minute_bucket)
        )
        if roi_id:
            q = q.filter(EventAggregatedRow.roi_id == roi_id)
        if cls:
            q = q.filter(EventAggregatedRow.cls == cls)
        return [_agg_to_dict(r) for r in q.limit(cap).all()]

    def hourly_bins_from_aggregations(
        self,
        camera_id: str,
        from_dt: datetime,
        to_dt: datetime,
        roi_id: str | None = None,
        cls: str | None = None,
    ) -> dict[str, Any]:
        """Soma entradas/saídas por hora (0–23 UTC) a partir de events_aggregated."""
        series = self.list_aggregations(camera_id, from_dt, to_dt, roi_id=roi_id, cls=cls)
        hourly_entries = [0] * 24
        hourly_exits = [0] * 24
        for row in series:
            raw = row["minute_bucket"]
            try:
                ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                continue
            h = int(ts.hour)
            hourly_entries[h] += int(row.get("entries") or 0)
            hourly_exits[h] += int(row.get("exits") or 0)
        peak_hour = 0
        peak_val = -1
        for h in range(24):
            v = hourly_entries[h] + hourly_exits[h]
            if v > peak_val:
                peak_val = v
                peak_hour = h
        return {
            "hourly_entries": hourly_entries,
            "hourly_exits": hourly_exits,
            "peak_hour": peak_hour,
        }

    def rebuild_aggregations(self, camera_id: str, from_dt: datetime, to_dt: datetime) -> int:
        """Drop and recompute aggregation rows for a camera/range from events_raw."""
        self._s.query(EventAggregatedRow).filter(
            EventAggregatedRow.camera_id == camera_id,
            EventAggregatedRow.minute_bucket >= _minute_bucket(from_dt),
            EventAggregatedRow.minute_bucket <= _minute_bucket(to_dt),
        ).delete(synchronize_session=False)
        self._s.commit()

        events = self.list_events(camera_id, from_dt, to_dt)
        for ev in events:
            self.update_aggregation(ev)
        return len(events)

    # ── trajectories ───────────────────────────────────────────────────────

    def upsert_trajectory(self, event: EventRaw, *, commit: bool = True) -> None:
        if not event.track_id:
            return

        pk = {"track_id": event.track_id, "camera_id": event.camera_id}
        row: TrajectoryRow | None = self._s.get(TrajectoryRow, pk)

        if row is None:
            row = TrajectoryRow(
                track_id=event.track_id,
                camera_id=event.camera_id,
                cls=event.cls or "unknown",
                started_at=event.timestamp,
                path_json="[]",
                zones_crossed_json="[]",
            )
            self._s.add(row)

        # Append position to path
        if event.x is not None and event.y is not None:
            path: list[dict[str, Any]] = json.loads(row.path_json or "[]")
            path.append({
                "timestamp": event.timestamp.isoformat(),
                "x": event.x,
                "y": event.y,
                "speed": event.speed,
                "direction": event.direction,
            })
            row.path_json = json.dumps(path)

        # Track zones (ordered unique list)
        if event.roi_id and event.event_type in ("entry", "zone_enter"):
            zones: list[str] = json.loads(row.zones_crossed_json or "[]")
            if event.roi_id not in zones:
                zones.append(event.roi_id)
                row.zones_crossed_json = json.dumps(zones)

        if event.event_type == "entry":
            row.entry_count += 1
        elif event.event_type == "exit":
            row.exit_count += 1

        row.updated_at = _utcnow()
        if commit:
            self._s.commit()

    def close_inactive_trajectories(self, before: datetime) -> int:
        rows = (
            self._s.query(TrajectoryRow)
            .filter(TrajectoryRow.status == "active", TrajectoryRow.updated_at < before)
            .all()
        )
        now = _utcnow()
        for row in rows:
            row.status = "closed"
            row.ended_at = now
            row.duration_seconds = max(
                0, int((now - row.started_at).total_seconds())
            )
        if rows:
            self._s.commit()
        return len(rows)

    def get_active_trajectories(self, camera_id: str) -> list[Trajectory]:
        rows = (
            self._s.query(TrajectoryRow)
            .filter(TrajectoryRow.camera_id == camera_id, TrajectoryRow.status == "active")
            .order_by(TrajectoryRow.started_at.desc())
            .all()
        )
        return [_row_to_trajectory(r) for r in rows]

    def get_trajectory_by_track_id(self, track_id: str, camera_id: str) -> Trajectory | None:
        row = self._s.get(TrajectoryRow, {"track_id": track_id, "camera_id": camera_id})
        return _row_to_trajectory(row) if row else None

    def get_trajectories_in_range(
        self, camera_id: str, from_dt: datetime, to_dt: datetime
    ) -> list[Trajectory]:
        rows = (
            self._s.query(TrajectoryRow)
            .filter(
                TrajectoryRow.camera_id == camera_id,
                TrajectoryRow.started_at >= from_dt,
                TrajectoryRow.started_at <= to_dt,
            )
            .order_by(TrajectoryRow.started_at)
            .limit(MAX_TRAJECTORY_RANGE_ROWS)
            .all()
        )
        return [_row_to_trajectory(r) for r in rows]
