from __future__ import annotations

from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, make_response, request

from analytics.metrics import log_event, metrics
from analytics.models import EventRaw, ValidationError
from analytics.store import AnalyticsStore
from persistence.db import get_session_factory

bp = Blueprint("analytics", __name__)

# Intervalo máximo permitido em consultas analytics (alinhado ao plano de query guards).
MAX_QUERY_RANGE = timedelta(days=31)

_CACHE_FLOW = "private, max-age=5"


def _get_worker():
    return current_app.config.get("ANALYTICS_WORKER")


def _parse_dt(value: str | None, default: datetime) -> datetime:
    if not value:
        return default
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _clamp_range(from_dt: datetime, to_dt: datetime) -> tuple[datetime, datetime]:
    if from_dt > to_dt:
        from_dt, to_dt = to_dt, from_dt
    if to_dt - from_dt > MAX_QUERY_RANGE:
        from_dt = to_dt - MAX_QUERY_RANGE
    return from_dt, to_dt


def _dt_args() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    from_dt = _parse_dt(request.args.get("from"), now - timedelta(hours=1))
    to_dt = _parse_dt(request.args.get("to"), now)
    return _clamp_range(from_dt, to_dt)


def _json_cached(data: dict, status: int = 200):
    resp = make_response(jsonify(data), status)
    resp.headers["Cache-Control"] = _CACHE_FLOW
    return resp


# ── Event ingest ────────────────────────────────────────────────────────────

@bp.post("/api/events")
def ingest_event():
    data = request.get_json(force=True, silent=True) or {}
    try:
        event = EventRaw.from_dict(data)
    except ValidationError as exc:
        metrics.inc("vision_events_ingestion_errors_total")
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        metrics.inc("vision_events_ingestion_errors_total")
        log_event("error", "ingest_parse_error", error=str(exc))
        return jsonify({"error": "invalid payload"}), 400

    try:
        factory = get_session_factory()
        session = factory()
        try:
            store = AnalyticsStore(session)
            is_new = store.append_event(event)
        finally:
            session.close()
    except Exception as exc:
        log_event("error", "ingest_store_error", error=str(exc))
        return jsonify({"error": "storage error"}), 500

    if is_new:
        worker = _get_worker()
        if worker is not None:
            worker.submit(event)
        metrics.inc("vision_events_ingested_total")
        log_event(
            "info",
            "event_ingested",
            camera_id=event.camera_id,
            track_id=event.track_id,
            event_type=event.event_type,
            timestamp=event.timestamp.isoformat(),
        )
        return jsonify({"id": event.id, "status": "accepted"}), 201
    else:
        return jsonify({"id": event.id, "status": "duplicate"}), 200


# ── Analytics queries ───────────────────────────────────────────────────────

@bp.get("/api/analytics/flow")
def analytics_flow():
    camera_id = request.args.get("camera_id", "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    try:
        from_dt, to_dt = _dt_args()
    except ValueError as exc:
        return jsonify({"error": f"invalid date: {exc}"}), 400

    roi_id = request.args.get("roi_id") or None
    cls = request.args.get("class") or None

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        series = store.list_aggregations(camera_id, from_dt, to_dt, roi_id=roi_id, cls=cls)
    finally:
        session.close()

    return _json_cached({
        "camera_id": camera_id,
        "bucket": "minute",
        "from": from_dt.isoformat(),
        "to": to_dt.isoformat(),
        "series": series,
    })


@bp.get("/api/analytics/hourly")
def analytics_hourly():
    camera_id = request.args.get("camera_id", "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    now = datetime.now(timezone.utc)
    try:
        from_dt = _parse_dt(request.args.get("from"), now - timedelta(hours=24))
        to_dt = _parse_dt(request.args.get("to"), now)
        from_dt, to_dt = _clamp_range(from_dt, to_dt)
    except ValueError as exc:
        return jsonify({"error": f"invalid date: {exc}"}), 400

    roi_id = request.args.get("roi_id") or None
    cls = request.args.get("class") or None

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        bins = store.hourly_bins_from_aggregations(camera_id, from_dt, to_dt, roi_id=roi_id, cls=cls)
    finally:
        session.close()

    payload = {
        "camera_id": camera_id,
        "from": from_dt.isoformat(),
        "to": to_dt.isoformat(),
        **bins,
    }
    return _json_cached(payload)


@bp.post("/api/analytics/rebuild")
def analytics_rebuild():
    data = request.get_json(force=True, silent=True) or {}
    camera_id = str(data.get("camera_id") or "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    now = datetime.now(timezone.utc)
    try:
        from_dt = _parse_dt(data.get("from"), now - timedelta(hours=24))
        to_dt = _parse_dt(data.get("to"), now)
    except ValueError as exc:
        return jsonify({"error": f"invalid date: {exc}"}), 400

    from_dt, to_dt = _clamp_range(from_dt, to_dt)

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        count = store.rebuild_aggregations(camera_id, from_dt, to_dt)
    finally:
        session.close()

    log_event("info", "aggregations_rebuilt", camera_id=camera_id, events_processed=count)
    return jsonify({"status": "rebuilt", "camera_id": camera_id, "events_processed": count})


# ── Events raw queries ──────────────────────────────────────────────────────

@bp.get("/api/events")
def list_events():
    camera_id = request.args.get("camera_id", "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    try:
        from_dt, to_dt = _dt_args()
    except ValueError as exc:
        return jsonify({"error": f"invalid date: {exc}"}), 400

    event_types_raw = request.args.get("event_types", "")
    event_types = [e.strip() for e in event_types_raw.split(",") if e.strip()] or None

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        events = store.list_events(camera_id, from_dt, to_dt, event_types=event_types)
    finally:
        session.close()

    return jsonify({
        "camera_id": camera_id,
        "count": len(events),
        "events": [e.to_dict() for e in events],
    })


# ── Trajectory queries ──────────────────────────────────────────────────────

@bp.get("/api/trajectories/active")
def trajectories_active():
    camera_id = request.args.get("camera_id", "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        trajs = store.get_active_trajectories(camera_id)
    finally:
        session.close()

    metrics.set_gauge("vision_active_trajectories", len(trajs))
    return jsonify({
        "camera_id": camera_id,
        "count": len(trajs),
        "trajectories": [t.to_dict() for t in trajs],
    })


@bp.get("/api/trajectories/replay")
def trajectories_replay():
    camera_id = request.args.get("camera_id", "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    try:
        from_dt, to_dt = _dt_args()
    except ValueError as exc:
        return jsonify({"error": f"invalid date: {exc}"}), 400

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        trajs = store.get_trajectories_in_range(camera_id, from_dt, to_dt)
    finally:
        session.close()

    return jsonify({
        "camera_id": camera_id,
        "from": from_dt.isoformat(),
        "to": to_dt.isoformat(),
        "count": len(trajs),
        "trajectories": [t.to_dict() for t in trajs],
    })


@bp.get("/api/trajectories/<track_id>")
def trajectory_by_track(track_id: str):
    camera_id = request.args.get("camera_id", "").strip()
    if not camera_id:
        return jsonify({"error": "camera_id is required"}), 400

    factory = get_session_factory()
    session = factory()
    try:
        store = AnalyticsStore(session)
        traj = store.get_trajectory_by_track_id(track_id, camera_id)
    finally:
        session.close()

    if traj is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(traj.to_dict())


# ── Observability ───────────────────────────────────────────────────────────

@bp.get("/api/analytics/metrics")
def analytics_metrics():
    return jsonify(metrics.snapshot())
