"""Estado compartilhado entre pipeline de inferência e API Flask.

CounterState  — contadores de entrada/saída por frame
SharedState   — objeto mutable passado entre inference_loop e create_app
Helpers       — build_stats_payload, _sync_mjpeg_from_environ, etc.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from visioncount.alerts.manager import AlertManager
from visioncount.classifiers.age import AgeAggregateStats
from visioncount.classifiers.sex import SexAggregateStats
from visioncount.persistence.emitter import emit_config_event

if TYPE_CHECKING:
    import numpy as np
    from visioncount.alerts.cap_detector import OptionalCapDetector
    from visioncount.alerts.car_color import CarColorClassifier


@dataclass
class CounterState:
    entries: int = 0
    exits: int = 0
    vehicle_entries: int = 0
    vehicle_exits: int = 0
    vehicle_class_entries: dict[int, int] = None  # type: ignore[assignment]
    vehicle_class_exits: dict[int, int] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.vehicle_class_entries is None:
            self.vehicle_class_entries = {}
        if self.vehicle_class_exits is None:
            self.vehicle_class_exits = {}

    @property
    def total(self) -> int:
        return self.entries + self.exits

    @property
    def vehicle_total(self) -> int:
        return self.vehicle_entries + self.vehicle_exits


class SharedState:
    def __init__(
        self,
        line_default: tuple[int, int, int, int],
        loitering_threshold_sec: float = 10.0,
    ) -> None:
        self.session_id: str = uuid.uuid4().hex
        self.counter = CounterState()
        self.sex_agg = SexAggregateStats()
        self.age_agg = AgeAggregateStats()
        self.hourly_entries: list[int] = [0] * 24
        self.hourly_exits: list[int] = [0] * 24
        self.sex_classifier_enabled: bool = False
        self.age_classifier_enabled: bool = False
        self.alert_manager: AlertManager | None = None
        self.alert_cap_enabled: bool = False
        self.alert_car_colors: list[str] = []
        self.alert_cap_detector: OptionalCapDetector | None = None
        self.alert_car_color_clf: CarColorClassifier | None = None
        self.alert_cap_threshold: float = 0.55
        self.alert_car_min_score: float = 0.08
        self.alert_server_beep: bool = False
        self.all_vehicles_mode: bool = False
        self.started_at = datetime.now()
        self.last_frame_jpeg: bytes | None = None
        self.last_frame_mono: float = 0.0
        self.last_frame_seq: int = 0
        self.frame_ring: deque[tuple[int, float, bytes]] = deque(maxlen=3)
        self.last_track_tick_mono: float = 0.0
        self.frame_output_lock = threading.Lock()
        self.last_error: str | None = None
        self.lock = threading.Lock()
        self.line_default = line_default
        self.line_live = line_default
        self.count_mode: str = "line"
        self.polygons_default: list[dict[str, Any]] = []
        self.polygons_live: list[dict[str, Any]] = []
        self.occupancy_now: int = 0
        self.moving_now: int = 0
        self.stationary_now: int = 0
        self.loitering_now: int = 0
        self.avg_dwell_sec: float = 0.0
        self.max_dwell_sec: float = 0.0
        self.loitering_threshold_sec: float = max(0.0, float(loitering_threshold_sec))
        self.avg_move_speed_px_per_frame: float = 0.0
        self.avg_move_speed_px_per_sec: float = 0.0
        self.vehicle_avg_speed_px_per_sec: float = 0.0
        self.infer_fps_ema: float = 0.0
        self.source_live: str = ""
        self.source_changed: bool = False
        self.active_preset_id: str = ""
        self.source_presets: list[dict[str, str]] = []
        self.show_trail_overlay: bool = False
        self.show_heading_overlay: bool = False
        self.show_roi_overlay: bool = True
        self.heatmap_available: bool = False
        self.show_heatmap_overlay: bool = False
        self.sex_overlay_available: bool = False
        self.show_sex_overlay: bool = False
        self.heatmap_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "total_events": 0, "cells": [],
        }
        self.vehicle_heatmap_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "total_events": 0, "cells": [],
        }
        self.vehicle_zone_live_payload: dict = {"zones": []}
        self.polygon_live_stats: list[dict[str, Any]] = []
        self.dwell_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "total_dwell_s": 0.0, "cells": [],
        }
        self.hotspots_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "cells": [], "mode": "composite", "alpha": 0.6,
        }
        self.zones_reload_flag: bool = True
        self.counters_reset_flag: bool = False
        self.live_feet_px: list[tuple[int, int]] = []
        self.recent_feet_trail_px: deque[tuple[int, int]] = deque(maxlen=600)
        self.frame_w: int = 0
        self.frame_h: int = 0
        self.yolo_count_class_ids: list[int] = []
        self.yolo_person_class_id: int = 0
        self.yolo_class_names: dict[int, str] = {}
        self.model_nc: int = 0
        self.track_active_class_ids: list[int] = []
        self.track_person_enabled: bool = True
        self.track_vehicle_enabled: bool = False
        self.track_classes_changed: bool = False
        self.infer_params_reload: bool = False
        self.cam_confidence: str = "high"
        self.cam_confidence_reasons: list[str] = []
        self.queue_size: int = 0
        self.queue_avg_wait_s: float = 0.0
        self.queue_saturated: bool = False
        self.queue_linearity: float = 0.0
        self.flow_vectors_payload: dict = {
            "grid_w": 16, "grid_h": 9, "max_mag": 0.0, "vectors": [],
        }
        self.reid_unique_persons: int = 0
        self.reid_active_persons: int = 0
        self.reid_revisited: int = 0
        self.reid_avg_dwell_s: float = 0.0
        self.thr_loitering_seconds: float = loitering_threshold_sec
        self.thr_stationary_max_speed: float = 2.2
        self.thr_queue_saturation: int = 8
        self.thr_density_alert: int = 0
        self.thr_blur_low: float = 60.0
        self.thr_blur_critical: float = 20.0
        self.thr_bbox_small_px: float = 40.0
        self.thr_reid_radius_norm: float = 0.18
        self.thr_reid_timeout_s: float = 20.0
        self.active_env_profile: str = ""
        self.low_conf_tracks: int = 0
        self.suppressed_events: int = 0
        self.cam_drift_level: str = "ok"
        self.cam_drift_score: float = 0.0
        self.cam_drift_reason: str = ""
        self.cam_drift_baseline_ready: bool = False
        self.cam_blur_ema: float = 0.0
        self.cam_avg_bbox_h: float = 0.0
        self.smooth_display_overlay_i16: np.ndarray | None = None
        self.smooth_display_overlay_lock = threading.Lock()
        self.mjpeg_max_fps: float = 10.0
        self.mjpeg_adaptive_fps: bool = False
        self.mjpeg_adaptive_headroom: float = 1.15
        self.mjpeg_adaptive_min_fps: float = 8.0
        self.mjpeg_burst_new: bool = True
        self.mjpeg_burst_cap_fps: float = 35.0
        self.mjpeg_stale_s: float = 8.0


def reset_entry_exit_counters(shared: SharedState) -> None:
    shared.counter = CounterState()
    shared.sex_agg = SexAggregateStats()
    shared.age_agg = AgeAggregateStats()


def _hour_now() -> int:
    return datetime.now().hour % 24


def _bump_hourly(shared: SharedState, kind: str) -> None:
    h = _hour_now()
    if kind == "entry":
        shared.hourly_entries[h] += 1
    elif kind == "exit":
        shared.hourly_exits[h] += 1


def _peak_hour_stats(shared: SharedState) -> tuple[int, int]:
    best_h = 0
    best_v = -1
    for h in range(24):
        v = shared.hourly_entries[h] + shared.hourly_exits[h]
        if v > best_v:
            best_v = v
            best_h = h
    return best_h, max(0, best_v)


def _sync_mjpeg_from_environ(shared: SharedState) -> None:
    """Relê os limiares MJPEG/stale a partir de os.environ (após merge do .env)."""
    try:
        mx = float(os.environ.get("YOLO_MJPEG_MAX_FPS", "10").strip() or "10")
    except ValueError:
        mx = 10.0
    mx = max(1.0, min(30.0, mx))
    adaptive = os.environ.get("YOLO_MJPEG_ADAPTIVE_FPS", "0").strip().lower() in (
        "1", "true", "yes", "on",
    )
    try:
        headroom = float(os.environ.get("YOLO_MJPEG_ADAPTIVE_HEADROOM", "1.15").strip() or "1.15")
    except ValueError:
        headroom = 1.15
    headroom = max(1.0, min(1.8, headroom))
    try:
        min_fps = float(os.environ.get("YOLO_MJPEG_ADAPTIVE_MIN_FPS", "8").strip() or "8")
    except ValueError:
        min_fps = 8.0
    min_fps = max(1.0, min(mx, min_fps))
    try:
        stale_s = float(os.environ.get("YOLO_FEED_STALE_S", "8").strip() or "8")
    except ValueError:
        stale_s = 8.0
    stale_s = max(2.0, stale_s)
    burst_new = os.environ.get("YOLO_MJPEG_BURST_NEW", "1").strip().lower() in (
        "1", "true", "yes", "on",
    )
    try:
        burst_cap = float(os.environ.get("YOLO_MJPEG_BURST_CAP_FPS", "35").strip() or "35")
    except ValueError:
        burst_cap = 35.0
    burst_cap = max(10.0, min(60.0, burst_cap))
    with shared.lock:
        shared.mjpeg_max_fps = mx
        shared.mjpeg_adaptive_fps = adaptive
        shared.mjpeg_adaptive_headroom = headroom
        shared.mjpeg_adaptive_min_fps = min_fps
        shared.mjpeg_stale_s = stale_s
        shared.mjpeg_burst_new = burst_new
        shared.mjpeg_burst_cap_fps = burst_cap


def _persist_config_event(shared: SharedState, event_type: str, payload: dict) -> None:
    try:
        emit_config_event(session_id=shared.session_id, event_type=event_type, payload=payload)
    except Exception as exc:
        if os.environ.get("YOLO_WEB_VERBOSE", "").strip() == "1":
            print(f"[persist] {event_type}: {exc}", flush=True)


def build_stats_payload(shared: SharedState) -> dict:
    """Serializa SharedState para o payload de /api/stats e fila Kafka."""
    with shared.lock:
        peak_h, peak_v = _peak_hour_stats(shared)
        return {
            "entries": shared.counter.entries,
            "exits": shared.counter.exits,
            "total_passages": shared.counter.total,
            "vehicle_entries": shared.counter.vehicle_entries,
            "vehicle_exits": shared.counter.vehicle_exits,
            "vehicle_total": shared.counter.vehicle_total,
            "vehicle_class_counts": {
                str(k): {
                    "entries": shared.counter.vehicle_class_entries.get(k, 0),
                    "exits": shared.counter.vehicle_class_exits.get(k, 0),
                }
                for k in shared.yolo_count_class_ids
                if k != shared.yolo_person_class_id
            },
            "vehicle_avg_speed_px_per_sec": shared.vehicle_avg_speed_px_per_sec,
            "occupancy_now": shared.occupancy_now,
            "moving_now": shared.moving_now,
            "stationary_now": shared.stationary_now,
            "loitering_now": shared.loitering_now,
            "avg_dwell_sec": shared.avg_dwell_sec,
            "max_dwell_sec": shared.max_dwell_sec,
            "loitering_threshold_sec": shared.loitering_threshold_sec,
            "avg_move_speed_px_per_frame": shared.avg_move_speed_px_per_frame,
            "avg_move_speed_px_per_sec": shared.avg_move_speed_px_per_sec,
            "infer_fps_ema": shared.infer_fps_ema,
            "error": shared.last_error,
            "sex_classifier_enabled": shared.sex_classifier_enabled,
            "sex_overlay_available": shared.sex_overlay_available,
            "show_sex_overlay": shared.show_sex_overlay if shared.sex_overlay_available else False,
            "sex_female_agg": shared.sex_agg.female,
            "sex_male_agg": shared.sex_agg.male,
            "sex_unknown_agg": shared.sex_agg.unknown,
            "age_classifier_enabled": shared.age_classifier_enabled,
            "age_child_agg": shared.age_agg.child,
            "age_adolescent_agg": shared.age_agg.adolescent,
            "age_young_agg": shared.age_agg.young,
            "age_adult_agg": shared.age_agg.adult,
            "age_elderly_agg": shared.age_agg.elderly,
            "age_unknown_agg": shared.age_agg.unknown,
            "hourly_entries": list(shared.hourly_entries),
            "hourly_exits": list(shared.hourly_exits),
            "peak_hour": peak_h,
            "peak_flow": peak_v,
            "cam_confidence": shared.cam_confidence,
            "cam_confidence_reasons": list(shared.cam_confidence_reasons),
            "queue_size": shared.queue_size,
            "queue_avg_wait_s": shared.queue_avg_wait_s,
            "queue_saturated": shared.queue_saturated,
            "reid_unique_persons": shared.reid_unique_persons,
            "reid_active_persons": shared.reid_active_persons,
            "reid_revisited": shared.reid_revisited,
            "reid_avg_dwell_s": shared.reid_avg_dwell_s,
            "active_env_profile": shared.active_env_profile,
            "low_conf_tracks": shared.low_conf_tracks,
            "suppressed_events": shared.suppressed_events,
            "cam_drift_level": shared.cam_drift_level,
            "cam_drift_score": shared.cam_drift_score,
            "cam_drift_reason": shared.cam_drift_reason,
            "cam_drift_baseline_ready": shared.cam_drift_baseline_ready,
            "vehicle_tracking_available": len(shared.yolo_count_class_ids) > 1,
            "model_nc": int(shared.model_nc),
            "yolo_count_class_ids": list(shared.yolo_count_class_ids),
            "yolo_person_class_id": int(shared.yolo_person_class_id),
            "track_active_class_ids": list(shared.track_active_class_ids),
            "yolo_class_labels": {
                str(k): shared.yolo_class_names.get(k, f"class_{k}")
                for k in shared.yolo_count_class_ids
            },
            "track_people": shared.track_person_enabled,
            "track_vehicles": (
                shared.track_vehicle_enabled if len(shared.yolo_count_class_ids) > 1 else False
            ),
            "all_vehicles_mode": shared.all_vehicles_mode,
            "polygon_stats": list(shared.polygon_live_stats),
            "polygon_migrations": max(
                0,
                sum(int(p.get("entries", 0) or 0) for p in shared.polygon_live_stats)
                - int(shared.counter.entries),
            ),
        }
