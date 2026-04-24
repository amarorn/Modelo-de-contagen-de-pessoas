from __future__ import annotations

import queue
import threading
import time
from datetime import datetime, timedelta, timezone

from analytics.metrics import log_event, metrics
from analytics.models import EventRaw
from analytics.store import AnalyticsStore

# How long (seconds) without updates before a track is closed
TRACK_TIMEOUT_SECONDS = int(300)
# Interval between inactivity-close sweeps
CLOSER_INTERVAL_SECONDS = 30
# Worker event-queue capacity
QUEUE_MAXSIZE = 10_000


class AggregatorWorker:
    """
    Background worker that:
      1. Pulls EventRaw objects from an in-memory queue.
      2. Updates events_aggregated (idempotent).
      3. Upserts trajectories.
      4. Periodically closes inactive tracks.
    """

    def __init__(
        self,
        session_factory,
        track_timeout_seconds: int = TRACK_TIMEOUT_SECONDS,
    ) -> None:
        self._factory = session_factory
        self._track_timeout = track_timeout_seconds
        self._queue: queue.Queue[EventRaw] = queue.Queue(maxsize=QUEUE_MAXSIZE)
        self._stop = threading.Event()
        self._worker_thread = threading.Thread(
            target=self._run_worker,
            name="analytics-worker",
            daemon=True,
        )
        self._closer_thread = threading.Thread(
            target=self._run_closer,
            name="analytics-closer",
            daemon=True,
        )

    # ── public API ─────────────────────────────────────────────────────────

    def start(self) -> None:
        log_event("info", "analytics_worker_start", track_timeout_s=self._track_timeout)
        self._worker_thread.start()
        self._closer_thread.start()

    def stop(self) -> None:
        self._stop.set()

    def submit(self, event: EventRaw) -> None:
        """Non-blocking submit. Drops event and logs if queue is full."""
        try:
            self._queue.put_nowait(event)
            metrics.set_gauge("vision_queue_size", self._queue.qsize())
        except queue.Full:
            metrics.inc("vision_events_ingestion_errors_total")
            log_event(
                "warning",
                "queue_full",
                camera_id=event.camera_id,
                event_type=event.event_type,
            )

    # ── worker thread ──────────────────────────────────────────────────────

    def _run_worker(self) -> None:
        session = self._factory()
        store = AnalyticsStore(session)
        log_event("info", "analytics_worker_ready")

        while not self._stop.is_set():
            try:
                event = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue

            t0 = time.perf_counter()
            try:
                store.update_aggregation(event)
                store.upsert_trajectory(event)
                metrics.inc("vision_aggregated_rows_updated_total")
                elapsed_ms = (time.perf_counter() - t0) * 1000
                metrics.set_gauge("vision_event_processing_duration_ms", elapsed_ms)
                # rough lag = now - event timestamp
                lag = (datetime.now(timezone.utc) - event.timestamp).total_seconds()
                metrics.set_gauge("vision_aggregator_lag_seconds", max(0.0, lag))
            except Exception as exc:
                try:
                    session.rollback()
                except Exception:
                    pass
                log_event(
                    "error",
                    "aggregation_error",
                    camera_id=event.camera_id,
                    event_id=event.id,
                    error=str(exc),
                )

        try:
            session.close()
        except Exception:
            pass
        log_event("info", "analytics_worker_stopped")

    # ── closer thread ──────────────────────────────────────────────────────

    def _run_closer(self) -> None:
        log_event("info", "analytics_closer_ready", interval_s=CLOSER_INTERVAL_SECONDS)
        while not self._stop.wait(timeout=CLOSER_INTERVAL_SECONDS):
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(seconds=self._track_timeout)
                session = self._factory()
                try:
                    store = AnalyticsStore(session)
                    closed = store.close_inactive_trajectories(cutoff)
                    if closed:
                        metrics.inc("vision_closed_trajectories_total", closed)
                        log_event("info", "tracks_closed", count=closed)
                finally:
                    session.close()
            except Exception as exc:
                log_event("error", "closer_error", error=str(exc))
        log_event("info", "analytics_closer_stopped")
