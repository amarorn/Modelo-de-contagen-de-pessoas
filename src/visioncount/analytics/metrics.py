from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("analytics")

_COUNTER_NAMES = (
    "vision_events_ingested_total",
    "vision_events_ingestion_errors_total",
    "vision_aggregated_rows_updated_total",
    "vision_closed_trajectories_total",
)
_GAUGE_NAMES = (
    "vision_aggregator_lag_seconds",
    "vision_event_processing_duration_ms",
    "vision_active_trajectories",
    "vision_queue_size",
)


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, int] = {k: 0 for k in _COUNTER_NAMES}
        self._gauges: dict[str, float] = {k: 0.0 for k in _GAUGE_NAMES}

    def inc(self, name: str, value: int = 1) -> None:
        with self._lock:
            self._counters[name] = self._counters.get(name, 0) + value

    def set_gauge(self, name: str, value: float) -> None:
        with self._lock:
            self._gauges[name] = value

    def get(self, name: str) -> int | float:
        with self._lock:
            return self._counters.get(name) or self._gauges.get(name, 0)

    def snapshot(self) -> dict[str, int | float]:
        with self._lock:
            return {**self._counters, **self._gauges}


# module-level singleton
metrics = Metrics()


def log_event(level: str, event: str, **kwargs: Any) -> None:
    record: dict[str, Any] = {
        "level": level,
        "event": event,
        "ts": datetime.now(timezone.utc).isoformat(),
        **kwargs,
    }
    msg = json.dumps(record, default=str)
    getattr(logger, level, logger.info)(msg)
