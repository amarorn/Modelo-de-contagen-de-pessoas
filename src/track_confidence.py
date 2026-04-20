"""Per-track confidence scoring.

6.1 — Track confidence: combines detection confidence (YOLO), track age, and
bbox stability into a single score [0, 1].  Tracks below SUPPRESS_THRESHOLD
are flagged; count events emitted while a track is below threshold are
suppressed so they don't inflate or corrupt the counters.

Usage in inference loop:
    tracker = TrackConfidenceTracker()
    ...
    det_conf = conf_by_tid.get(track_id, 1.0)
    tracker.update(track_id, det_conf, (x_min, y_min, x_max, y_max), frame_ts)
    if tracker.is_reliable(track_id):
        # emit count event
        ...
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_float(key: str, default: float) -> float:
    raw = os.environ.get(key, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    raw = os.environ.get(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw, 10)
    except ValueError:
        return default


# Tracks below this score are considered unreliable for counting.
SUPPRESS_THRESHOLD: float = _env_float("TRACK_CONF_SUPPRESS_THRESHOLD", 0.35)

# Tracks need at least this many frames before being trusted.
MIN_AGE_FRAMES: int = max(1, _env_int("TRACK_CONF_MIN_AGE_FRAMES", 3))

# EMA alpha for detection confidence smoothing (lower = more inertia).
_CONF_ALPHA: float = 0.25
# EMA alpha for bbox size stability.
_SIZE_ALPHA: float = 0.20


@dataclass
class _TrackRecord:
    frames: int = 0
    conf_ema: float = 0.0
    size_ema: float = 0.0
    size_var_ema: float = 0.0   # EMA of squared deviation
    last_ts: float = 0.0
    score: float = 0.0


class TrackConfidenceTracker:
    """Maintains per-track confidence records and computes a composite score."""

    def __init__(self) -> None:
        self._records: dict[int, _TrackRecord] = {}

    def update(
        self,
        track_id: int,
        det_conf: float,
        bbox: tuple[float, float, float, float],
        ts: float,
    ) -> float:
        """Update record for *track_id* and return the current confidence score."""
        rec = self._records.get(track_id)
        if rec is None:
            rec = _TrackRecord()
            self._records[track_id] = rec

        x_min, y_min, x_max, y_max = bbox
        bbox_area = (x_max - x_min) * (y_max - y_min)

        rec.frames += 1
        rec.last_ts = ts

        # Smooth detection confidence
        if rec.conf_ema <= 0:
            rec.conf_ema = det_conf
        else:
            rec.conf_ema = _CONF_ALPHA * det_conf + (1 - _CONF_ALPHA) * rec.conf_ema

        # Smooth bbox size and its variance
        if rec.size_ema <= 0:
            rec.size_ema = bbox_area
            rec.size_var_ema = 0.0
        else:
            deviation = bbox_area - rec.size_ema
            rec.size_ema = _SIZE_ALPHA * bbox_area + (1 - _SIZE_ALPHA) * rec.size_ema
            rec.size_var_ema = _SIZE_ALPHA * deviation ** 2 + (1 - _SIZE_ALPHA) * rec.size_var_ema

        # Stability: how consistent is bbox size?  Low variance relative to
        # mean area → stable.  Normalised to [0, 1] with a soft cap.
        if rec.size_ema > 0:
            cv = (rec.size_var_ema ** 0.5) / (rec.size_ema + 1e-9)
            stability = max(0.0, 1.0 - min(1.0, cv * 4.0))
        else:
            stability = 0.5

        # Age bonus: full credit after MIN_AGE_FRAMES frames.
        age_factor = min(1.0, rec.frames / MIN_AGE_FRAMES)

        # Composite score: weighted combination.
        rec.score = (
            0.50 * rec.conf_ema
            + 0.30 * stability
            + 0.20 * age_factor
        )
        return rec.score

    def is_reliable(self, track_id: int) -> bool:
        """Return True if track is above the suppression threshold."""
        rec = self._records.get(track_id)
        if rec is None:
            return False
        if rec.frames < MIN_AGE_FRAMES:
            return False
        return rec.score >= SUPPRESS_THRESHOLD

    def score_of(self, track_id: int) -> float:
        rec = self._records.get(track_id)
        return rec.score if rec is not None else 0.0

    def evict(self, track_id: int) -> None:
        self._records.pop(track_id, None)

    def low_confidence_count(self) -> int:
        return sum(1 for r in self._records.values() if r.score < SUPPRESS_THRESHOLD)

    def scores_snapshot(self) -> dict[int, float]:
        return {tid: r.score for tid, r in self._records.items()}
