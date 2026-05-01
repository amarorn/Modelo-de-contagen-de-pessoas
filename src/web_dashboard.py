#!/usr/bin/env python3
"""Dashboard web para contagem de pessoas em tempo real.

Persistencia opcional (metricas ao vivo e eventos de configuracao): produtor nao bloqueante
para Kafka e consumidor que grava em SQL; ver KAFKA_BOOTSTRAP_SERVERS e
scripts/run_kafka_consumer.sh.

Estatistica agregada por sexo (opcional): nao ha base de dados separada para esses agregados. O ambiente
`.env` pode definir `YOLO_SEX_MODEL` e `YOLO_SEX_ABSTAIN`; `scripts/run_web.sh`
passa-os como `--sex-model` e `--sex-abstain`. `YOLO_SEX_MODEL` e o caminho no
disco para um unico ficheiro de pesos Ultralytics `task=classify` (ex. treino com
`yolo classify`, classes nomeadas female/male ou mulher/homem). Ver
`sex_classifier_agg.OptionalSexClassifier` e docs/04_privacidade_etica.md.
Faixa etaria agregada (opcional): `YOLO_AGE_MODEL` / `--age-model` com `age_classifier_agg.OptionalAgeClassifier`.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import uuid
from collections import deque
import os
import socket
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv

    _repo_root = Path(__file__).resolve().parents[1]
    load_dotenv(_repo_root / ".env", override=False)
except ImportError:
    pass


def _configure_opencv_videoio_priorities() -> None:
    """Antes de importar cv2: no Linux, Obsensor pode ser escolhido antes de V4L2 e spammar o stderr."""
    if not sys.platform.startswith("linux"):
        return
    os.environ.setdefault("OPENCV_VIDEOIO_PRIORITY_OBSENSOR", "0")


_configure_opencv_videoio_priorities()

# Antes de cv2: FFmpeg/libav em streams HLS pode imprimir "non-existing SPS" (join a meio do GOP); nao e fatal.
if os.environ.get("YOLO_WEB_VERBOSE", "").strip() != "1":
    os.environ.setdefault("AV_LOG_LEVEL", "error")

import cv2
import numpy as np
import torch
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from ultralytics import YOLO

from device_utils import resolve_device
from stream_source_resolve import (
    apply_opencv_ffmpeg_capture_env,
    is_skylinewebcams_webcam_page,
    is_skyline_hls_url,
    probe_skyline_hls_url,
    resolve_stream_source,
)
from yolo_class_utils import (
    infer_model_nc,
    resolve_yolo_classes_and_person_id,
    short_class_tag,
)
from age_classifier_agg import AgeAggregateStats, OptionalAgeClassifier
from alert_car_color import CarColorClassifier, parse_target_colors
from alert_cap_detector import OptionalCapDetector
from alert_manager import AlertManager
from sex_classifier_agg import OptionalSexClassifier, PerTrackSexSmoother, SexAggregateStats
from env_settings import (
    EDITABLE_ENV_KEYS,
    SETTINGS_RUNTIME_APPLY_KEYS,
    apply_settings_updates_to_environ,
    filter_updates,
    merge_env_file,
    read_training_metrics_from_weights,
    settings_updates_require_restart,
    settings_updates_trigger_stream_reload,
    snapshot_editable_env,
)

MJPEG_SHARED_SYNC_KEYS = SETTINGS_RUNTIME_APPLY_KEYS | frozenset({"YOLO_FEED_STALE_S"})
from persistence.emitter import emit_config_event, shutdown_emitter, start_stats_emitter_thread
from persistence.db import get_session_factory
from analytics import AggregatorWorker, bp as analytics_bp
from analytics.models import EventRaw as _AnalyticsEventRaw
from persistence.dwell_store import DwellStore
from persistence.heatmap_store import HeatmapStore
from dwell_accumulator import DwellGridLive, ZoneSlotTracker
from dwell_slot_aggregator import DwellSlotAggregator
from heatmap_aggregator import SlotAggregator
from hotspot_scorer import HotspotScorer, rasterize_norm_polygon
from zones.zone_assigner import ZoneAssigner
from zones.zone_store import ZoneStore, ensure_builtin_templates
from queue_detector import QueueDetector
from flow_vector_grid import FlowVectorGrid
from env_profiles import (
    PROFILES,
    get_profile,
    is_builtin_profile,
    list_profiles as _list_env_profiles,
    save_custom_profile as _save_custom_profile,
    delete_custom_profile as _delete_custom_profile,
    EnvProfile as _EnvProfile,
)
from roi_suggester import suggest_line as _suggest_line, suggest_zones as _suggest_zones
from track_confidence import TrackConfidenceTracker
from camera_drift import CameraDriftDetector
from persistence.audit_log import AuditLog
from person_tracker import PersonTracker

import persistence.camera_calibration_store as cam_cal


def _resolve_listen_port(host: str, preferred: int) -> int:
    """Escolhe uma porta livre: `preferred` ou a primeira seguinte (ate +31).

    Defina WEB_PORT_STRICT=1 para exigir exactamente `preferred` e falhar se estiver ocupada.
    """
    strict = os.environ.get("WEB_PORT_STRICT", "").strip() == "1"

    def try_bind(p: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind((host, p))
        except OSError:
            return False
        return True

    if strict:
        if not try_bind(preferred):
            print(
                f"[web] ERRO: {host}:{preferred} indisponivel (WEB_PORT_STRICT=1). "
                "Pare a outra instancia ou use WEB_PORT=8081.",
                file=sys.stderr,
            )
            raise SystemExit(1)
        return preferred

    for port in range(preferred, preferred + 32):
        if try_bind(port):
            if port != preferred:
                print(
                    f"[web] Porta {preferred} ocupada; a servir em http://{host}:{port}/",
                    flush=True,
                )
            return port
    print(
        f"[web] ERRO: nenhuma porta livre entre {preferred} e {preferred + 31} em {host}.",
        file=sys.stderr,
    )
    raise SystemExit(1)


def _configure_runtime_logging() -> None:
    """Reduz [ERROR:0] cap_ffmpeg no terminal e spam 'Waiting for stream' do Ultralytics."""
    try:
        import cv2.utils.logging as cv2_log

        cv2_log.setLogLevel(cv2_log.LOG_LEVEL_ERROR)
    except Exception:
        pass
    if os.environ.get("YOLO_WEB_VERBOSE", "").strip() == "1":
        return
    try:
        from ultralytics.utils import LOGGER as ulog

        ulog.setLevel(logging.ERROR)
    except Exception:
        pass
    # Avisos repetidos do Hub (CLIP etc.); definir HF_TOKEN no .env se precisares de downloads rápidos.
    logging.getLogger("huggingface_hub.utils._http").setLevel(logging.ERROR)


@dataclass
class CounterState:
    def __init__(self) -> None:
        self.entries: int = 0
        self.exits: int = 0
        self.vehicle_entries: int = 0
        self.vehicle_exits: int = 0
        self.vehicle_class_entries: dict[int, int] = {}
        self.vehicle_class_exits: dict[int, int] = {}

    @property
    def total(self) -> int:
        return self.entries + self.exits

    @property
    def vehicle_total(self) -> int:
        return self.vehicle_entries + self.vehicle_exits


def reset_entry_exit_counters(shared: SharedState) -> None:
    shared.counter = CounterState()
    shared.sex_agg = SexAggregateStats()
    shared.age_agg = AgeAggregateStats()
    shared.hourly_entries = [0] * 24
    shared.hourly_exits = [0] * 24
    # Sinaliza ao loop de inferencia para zerar contadores por poligono
    # e limpar o historico de "dentro/fora" (senao tracks ja presentes
    # ficam travados e a proxima entrada nao e registrada).
    shared.counters_reset_flag = True


def _hour_now() -> int:
    return datetime.now().hour % 24


def _bump_hourly(shared: SharedState, kind: str) -> None:
    h = _hour_now()
    if kind == "entry":
        shared.hourly_entries[h] += 1
    elif kind == "exit":
        shared.hourly_exits[h] += 1


def _peak_hour_stats(shared: SharedState) -> tuple[int, int]:
    """Indice 0-23 com maior (entradas+saidas); fluxo nessa hora."""
    best_h = 0
    best_v = -1
    for h in range(24):
        v = shared.hourly_entries[h] + shared.hourly_exits[h]
        if v > best_v:
            best_v = v
            best_h = h
    return best_h, max(0, best_v)


_MAX_SOURCE_PRESETS = 24
_SOURCE_PRESETS_FILE = Path("outputs/source_presets_web.json")


def _load_source_presets_from_env() -> list[dict[str, str]]:
    """JSON em YOLO_WEB_SOURCE_PRESETS ou um preset a partir de URL_HLS_OU_RTSP_OU_FICHEIRO."""
    out: list[dict[str, str]] = []
    raw = os.environ.get("YOLO_WEB_SOURCE_PRESETS", "").strip()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                for i, item in enumerate(data):
                    if not isinstance(item, dict):
                        continue
                    label = str(item.get("label", "") or f"Câmera {i + 1}").strip()[:128]
                    url = str(item.get("url", "")).strip()
                    if not url or len(url) > 4096:
                        continue
                    pid = str(item.get("id", "")).strip()
                    if not pid:
                        pid = uuid.uuid4().hex[:12]
                    out.append({"id": pid, "label": label, "url": url})
        except (json.JSONDecodeError, TypeError):
            pass
    if not out:
        fallback = os.environ.get("URL_HLS_OU_RTSP_OU_FICHEIRO", "").strip()
        if fallback:
            out.append(
                {
                    "id": uuid.uuid4().hex[:12],
                    "label": "Stream principal (.env)",
                    "url": fallback,
                }
            )
    return out[:_MAX_SOURCE_PRESETS]


def _resolve_initial_video_source(args: argparse.Namespace, presets: list[dict[str, str]]) -> str:
    """Fonte inicial: respeita YOLO_WEB_FORCE_WEBCAM (CLI numerica via run_web.sh), .env, depois 1. preset se source=0."""
    if os.environ.get("YOLO_WEB_FORCE_WEBCAM", "").strip() == "1":
        return str(args.source).strip()
    env_w = os.environ.get("YOLO_WEB_SOURCE", "").strip()
    s = str(args.source).strip()
    if env_w and env_w != "0":
        return env_w
    if s != "0":
        return s
    if presets:
        chosen = presets[0]
        # Presets Skyline com .html sao mais estaveis que hd-auth...m3u8?a=TOKEN,
        # que costuma expirar entre reinicios. Se houver pagina da Skyline guardada,
        # preferi-la evita arrancar o painel ja em "Fonte offline".
        first_url = str(chosen.get("url") or "").strip()
        if is_skyline_hls_url(first_url):
            for candidate in presets:
                cand_url = str(candidate.get("url") or "").strip()
                if is_skylinewebcams_webcam_page(cand_url):
                    chosen = candidate
                    print(
                        "[web] Preset inicial Skyline: a preferir a pagina .html "
                        "em vez do m3u8 temporario hd-auth.",
                        flush=True,
                    )
                    break
        u = str(chosen.get("url") or "").strip()
        if u:
            print(
                "[web] YOLO_WEB_SOURCE/--source=0: a usar um preset guardado "
                "(webcam: ./scripts/run_web.sh <indice> ou remova/vazio YOLO_WEB_SOURCE_PRESETS).",
                flush=True,
            )
            os.environ["YOLO_WEB_SOURCE"] = u
            return u
    return s


def _load_source_presets_from_file() -> list[dict[str, str]]:
    try:
        if not _SOURCE_PRESETS_FILE.exists():
            return []
        data = json.loads(_SOURCE_PRESETS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, str]] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label", "") or f"Câmera {i + 1}").strip()[:128]
        url = str(item.get("url", "")).strip()
        if not url or len(url) > 4096:
            continue
        pid = str(item.get("id", "")).strip() or uuid.uuid4().hex[:12]
        out.append({"id": pid, "label": label, "url": url})
    return out[:_MAX_SOURCE_PRESETS]


def _save_source_presets_to_file(presets: list[dict[str, str]]) -> None:
    try:
        _SOURCE_PRESETS_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = [
            {
                "id": str(p.get("id", "")).strip() or uuid.uuid4().hex[:12],
                "label": str(p.get("label", "")).strip()[:128] or "Câmera",
                "url": str(p.get("url", "")).strip(),
            }
            for p in presets[:_MAX_SOURCE_PRESETS]
            if str(p.get("url", "")).strip()
        ]
        _SOURCE_PRESETS_FILE.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    except OSError:
        pass


def _is_youtube_page_url(url: str) -> bool:
    u = str(url or "").strip().lower()
    if not u:
        return False
    return (
        "youtube.com/watch" in u
        or "youtube.com/live/" in u
        or "youtube.com/shorts/" in u
        or "youtu.be/" in u
    )


def _youtube_source_error_payload() -> dict[str, str]:
    return {
        "error": (
            "URL de pagina do YouTube nao e uma fonte de video direta. "
            "Use ./scripts/run_web.sh --youtube 'URL_DO_YOUTUBE' "
            "ou defina YOLO_WEB_YOUTUBE_URL no .env para converter via yt-dlp."
        )
    }


def _preset_id_for_url(presets: list[dict[str, str]], url: str) -> str:
    u = str(url).strip()
    for p in presets:
        if str(p.get("url", "")).strip() == u:
            return str(p.get("id", "")).strip()
    return ""


def _apply_default_calibration(shared: SharedState) -> None:
    with shared.lock:
        shared.count_mode = "line"
        shared.line_live = shared.line_default
        shared.polygons_live = []
        shared.polygons_default = []


def _calibration_store_preset_id(preset_id: str) -> str:
    """Chave SQL para calibracao: preset real ou 'default' quando nao ha preset (URL directa)."""
    pid = str(preset_id or "").strip()[:32]
    return pid if pid else "default"


def _load_calibration_for_preset(shared: SharedState, preset_id: str) -> None:
    pid = _calibration_store_preset_id(preset_id)
    data = cam_cal.load(cam_cal.site_id(), pid)
    if not data:
        _apply_default_calibration(shared)
        return
    with shared.lock:
        shared.count_mode = data["count_mode"]
        shared.line_live = tuple(data["line"])
        raw_polys = data.get("polygons") or []
        if isinstance(raw_polys, list) and raw_polys and isinstance(raw_polys[0], dict):
            shared.polygons_live = copy_polygon_entries(raw_polys)
        else:
            shared.polygons_live = []
        if not shared.polygons_live and data.get("polygon"):
            legacy = list(data["polygon"])
            if len(legacy) >= 3:
                shared.polygons_live = [
                    {"title": "Área 1", "points": [tuple(int(a), int(b)) for a, b in legacy]}
                ]
        shared.polygons_default = copy_polygon_entries(shared.polygons_live)


def _save_calibration_for_preset(shared: SharedState, preset_id: str) -> None:
    pid = _calibration_store_preset_id(preset_id)
    with shared.lock:
        mode = shared.count_mode
        line = shared.line_live
        polys = copy_polygon_entries(shared.polygons_live)
    cam_cal.save(
        cam_cal.site_id(),
        pid,
        count_mode=mode,
        line=tuple(int(x) for x in line),
        polygons=polys,
    )


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
        self.alert_cap_detector: "OptionalCapDetector | None" = None
        self.alert_car_color_clf: "CarColorClassifier | None" = None
        self.alert_cap_threshold: float = 0.55
        self.alert_car_min_score: float = 0.08
        self.alert_server_beep: bool = False
        # UI «Todos os veículos»: conta todas as passagens sem alertas por cor de carro
        self.all_vehicles_mode: bool = False
        self.started_at = datetime.now()
        self.last_frame_jpeg: bytes | None = None
        # time.monotonic() do ultimo frame JPEG escrito pelo inference_loop (watchdog + MJPEG stale).
        self.last_frame_mono: float = 0.0
        # Sequencia monotona do JPEG publicado (consumidor MJPEG detecta frame novo sem ambiguidade).
        self.last_frame_seq: int = 0
        # Ring buffer curto com os ultimos JPEGs para reduzir "salto" visual em picos de carga.
        self.frame_ring: deque[tuple[int, float, bytes]] = deque(maxlen=3)
        # Ultimo avanco do iterador model.track (incl. orig_img None entre segmentos HLS). Watchdog usa max(mono, tick).
        self.last_track_tick_mono: float = 0.0
        # Lock dedicado ao JPEG: o inference_loop segura `lock` durante processamento pesado por frame;
        # /video_feed e o watchdog leem `last_frame_*` sem competir com esse lock (evita MJPEG "congelado").
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
        # Media do rastro dos pes (px/frame) só para quem nao esta "parado"; px/s = * infer_fps_ema
        self.avg_move_speed_px_per_frame: float = 0.0
        self.avg_move_speed_px_per_sec: float = 0.0
        self.vehicle_avg_speed_px_per_sec: float = 0.0
        self.infer_fps_ema: float = 0.0
        # fonte de vídeo trocável em tempo real
        self.source_live: str = ""
        self.source_changed: bool = False
        # id do preset em uso (evita ambiguidade se dois presets tiverem a mesma url)
        self.active_preset_id: str = ""
        # Presets: {"id", "label", "url"} — max 24; preenchido no arranque a partir do .env
        self.source_presets: list[dict[str, str]] = []
        # overlays no MJPEG (caixas/labels mantêm-se; só rastro e seta PCA)
        self.show_trail_overlay: bool = False
        self.show_heading_overlay: bool = False
        # Linha/polígono visíveis por defeito para alinhar contagem (UI pode desligar «Marcações ROI»).
        self.show_roi_overlay: bool = True
        # Mapa de calor: só tem efeito se o processo foi iniciado sem --no-heatmap (WEB_HEATMAP=1)
        self.heatmap_available: bool = False
        self.show_heatmap_overlay: bool = False
        # Sexo (classify): disponivel se --sex-model carregou; overlay ligavel na UI como o mapa de calor
        self.sex_overlay_available: bool = False
        self.show_sex_overlay: bool = False
        # GridLive — payload serializado para /api/heatmap/live; atualizado a cada ~30 frames
        self.heatmap_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "total_events": 0, "cells": [],
        }
        self.vehicle_heatmap_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "total_events": 0, "cells": [],
        }
        self.vehicle_zone_live_payload: dict = {"zones": []}
        # Per-polygon live stats (assembled each inference frame; polygon mode only)
        self.polygon_live_stats: list[dict[str, Any]] = []
        self.dwell_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "total_dwell_s": 0.0, "cells": [],
        }
        self.hotspots_live_payload: dict = {
            "grid_w": 32, "grid_h": 18, "max_val": 0.0, "cells": [], "mode": "composite", "alpha": 0.6,
        }
        self.zones_reload_flag: bool = True
        # Quando True, o loop de inferencia zera contadores por poligono
        # e limpa o historico "prev_inside_per_poly_by_id" na proxima iteracao.
        self.counters_reset_flag: bool = False
        # Posicao dos pes (centro-baixo do bbox) das pessoas ativas no ultimo frame,
        # e rastro agregado dos pes nos ultimos segundos (guia visual no editor de ROI).
        self.live_feet_px: list[tuple[int, int]] = []
        self.recent_feet_trail_px: deque[tuple[int, int]] = deque(maxlen=600)
        self.frame_w: int = 0
        self.frame_h: int = 0
        # Multi-classe YOLO (ex. pessoa + veículo): controlado na UI sem reiniciar processo
        self.yolo_count_class_ids: list[int] = []
        self.yolo_person_class_id: int = 0
        self.yolo_class_names: dict[int, str] = {}
        self.model_nc: int = 0
        self.track_active_class_ids: list[int] = []
        self.track_person_enabled: bool = True
        self.track_vehicle_enabled: bool = False
        self.track_classes_changed: bool = False
        # POST /api/settings: reabrir model.track() com novos conf/imgsz/etc. (sem reiniciar o processo).
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
        # ── Mutable thresholds (may be updated via env profile without restart) ──
        self.thr_loitering_seconds: float = loitering_threshold_sec
        self.thr_stationary_max_speed: float = 2.2
        self.thr_queue_saturation: int = 8
        self.thr_density_alert: int = 0
        self.thr_blur_low: float = 60.0
        self.thr_blur_critical: float = 20.0
        self.thr_bbox_small_px: float = 40.0
        self.thr_reid_radius_norm: float = 0.18
        self.thr_reid_timeout_s: float = 20.0
        # Active env profile id ("" = none / custom)
        self.active_env_profile: str = ""
        # Latest frame dimensions (set by inference loop)
        self.frame_w: int = 0
        self.frame_h: int = 0
        # ── Track confidence ─────────────────────────────────────────────────
        self.low_conf_tracks: int = 0
        self.suppressed_events: int = 0   # cumulative crossing events suppressed
        # ── Camera drift ─────────────────────────────────────────────────────
        self.cam_drift_level: str = "ok"   # "ok"|"illumination"|"focus"|"position"
        self.cam_drift_score: float = 0.0  # 0-1 severity
        self.cam_drift_reason: str = ""
        self.cam_drift_baseline_ready: bool = False
        # ── Camera observation (used for profile suggestion) ──────────────────
        self.cam_blur_ema: float = 0.0       # Laplacian variance EMA
        self.cam_avg_bbox_h: float = 0.0     # mean person bbox height (px)
        # Smooth display (YOLO_SMOOTH_DISPLAY=1): segundo VideoCapture lê à FPS nativa da câmera
        # e composta o último diff de overlay (int16) do YOLO por cima de cada frame bruto.
        # O loop YOLO NÃO escreve em last_frame_jpeg quando smooth display está activo —
        # só a thread de display escreve, evitando o tremido causado por dois fundos alternados.
        self.smooth_display_overlay_i16: "np.ndarray | None" = None
        self.smooth_display_overlay_lock = threading.Lock()
        # MJPEG /video_feed (espelho de YOLO_MJPEG_* + YOLO_FEED_STALE_S; actualizado no arranque e em POST /api/settings)
        self.mjpeg_max_fps: float = 10.0
        self.mjpeg_adaptive_fps: bool = False
        self.mjpeg_adaptive_headroom: float = 1.15
        self.mjpeg_adaptive_min_fps: float = 8.0
        self.mjpeg_burst_new: bool = True
        self.mjpeg_burst_cap_fps: float = 35.0
        self.mjpeg_stale_s: float = 8.0


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


def _publish_jpeg_frame(shared: SharedState, jpeg: bytes, now_mono: float | None = None) -> None:
    ts = time.monotonic() if now_mono is None else float(now_mono)
    with shared.frame_output_lock:
        seq = shared.last_frame_seq + 1
        shared.last_frame_seq = seq
        shared.last_frame_jpeg = jpeg
        shared.last_frame_mono = ts
        shared.frame_ring.append((seq, ts, jpeg))


def _sync_track_flags_from_active(
    shared: SharedState,
    count_class_ids: list[int],
    person_class_id: int,
) -> None:
    active = set(shared.track_active_class_ids)
    shared.track_person_enabled = person_class_id in active
    v_ids = [c for c in count_class_ids if c != person_class_id]
    shared.track_vehicle_enabled = bool(v_ids) and any(c in active for c in v_ids)


def _rebuild_active_from_flags(
    shared: SharedState,
    count_class_ids: list[int],
    person_class_id: int,
) -> None:
    active: list[int] = []
    if shared.track_person_enabled:
        active.append(person_class_id)
    if shared.track_vehicle_enabled:
        for c in count_class_ids:
            if c != person_class_id:
                active.append(c)
    if not active:
        active = [person_class_id]
    shared.track_active_class_ids = sorted(set(active))


class GridLive:
    """Grade 32×18 de centroides acumulados por sessão; exportada via /api/heatmap/live."""

    GRID_W: int = 32
    GRID_H: int = 18
    MIN_DISPLACEMENT: float = 0.015  # 1.5% da largura — move mínimo para emitir
    MAX_INTERVAL_S: float = 5.0       # fallback para tracks parados

    def __init__(self) -> None:
        self._grid = np.zeros((self.GRID_H, self.GRID_W), dtype=np.float32)
        self._frame_delta = np.zeros((self.GRID_H, self.GRID_W), dtype=np.float32)
        self._last: dict[int, tuple[float, float, float]] = {}  # tid → (cx, cy, ts)

    def update_track(self, track_id: int, cx_norm: float, cy_norm: float, ts: float) -> None:
        """cx_norm, cy_norm em [0, 1] (coordenadas normalizadas pelo frame)."""
        if not self._should_emit(track_id, cx_norm, cy_norm, ts):
            return
        gx = int(min(cx_norm * self.GRID_W, self.GRID_W - 1))
        gy = int(min(cy_norm * self.GRID_H, self.GRID_H - 1))
        self._grid[gy, gx] += 1.0
        self._frame_delta[gy, gx] += 1.0

    def take_frame_delta(self) -> np.ndarray:
        d = self._frame_delta.copy()
        self._frame_delta[:] = 0.0
        return d

    def _should_emit(self, track_id: int, cx: float, cy: float, ts: float) -> bool:
        if track_id not in self._last:
            self._last[track_id] = (cx, cy, ts)
            return True
        lx, ly, lt = self._last[track_id]
        dist = ((cx - lx) ** 2 + (cy - ly) ** 2) ** 0.5
        if dist >= self.MIN_DISPLACEMENT or (ts - lt) >= self.MAX_INTERVAL_S:
            self._last[track_id] = (cx, cy, ts)
            return True
        return False

    def evict_track(self, track_id: int) -> None:
        self._last.pop(track_id, None)

    def to_payload(self) -> dict:
        max_val = float(self._grid.max())
        total = int(self._grid.sum())
        if max_val < 1e-6:
            cells: list = []
        else:
            cells = (self._grid / max_val).tolist()
        return {
            "grid_w": self.GRID_W,
            "grid_h": self.GRID_H,
            "max_val": max_val,
            "total_events": total,
            "cells": cells,
        }

    def to_raw_array(self) -> np.ndarray:
        """Retorna cópia do grid com contagens brutas (não normalizado)."""
        return self._grid.copy()

    def reset(self) -> None:
        self._grid[:] = 0.0
        self._frame_delta[:] = 0.0
        self._last.clear()


class HeatmapAccumulator:
    """Acumula posicoes (ex.: pes) em grade reduzida; agregado, sem identidade."""

    def __init__(
        self,
        scale: int,
        decay: float,
        radius: int,
        alpha: float,
        blob_gain: float,
    ) -> None:
        self.scale = max(1, scale)
        self.decay = float(np.clip(decay, 0.0, 1.0))
        self.radius = max(1, radius)
        self.alpha = float(np.clip(alpha, 0.0, 1.0))
        self.blob_gain = max(0.0, blob_gain)
        self.acc: np.ndarray | None = None
        self._gh = 0
        self._gw = 0

    def _ensure(self, h: int, w: int) -> None:
        gh, gw = max(1, h // self.scale), max(1, w // self.scale)
        if self.acc is None or self._gh != gh or self._gw != gw:
            self.acc = np.zeros((gh, gw), dtype=np.float32)
            self._gh, self._gw = gh, gw

    def step(self, h: int, w: int, foot_xy: list[tuple[float, float]]) -> None:
        self._ensure(h, w)
        assert self.acc is not None
        self.acc *= self.decay
        if self.blob_gain <= 0 or not foot_xy:
            return
        for fx, fy in foot_xy:
            gx = int(np.clip(round(fx / self.scale), 0, self._gw - 1))
            gy = int(np.clip(round(fy / self.scale), 0, self._gh - 1))
            blob = np.zeros_like(self.acc)
            cv2.circle(blob, (gx, gy), self.radius, 1.0, -1)
            self.acc += blob * self.blob_gain

    def blend_over(self, frame_bgr: np.ndarray) -> np.ndarray:
        if self.acc is None or self.alpha <= 0:
            return frame_bgr
        h, w = frame_bgr.shape[:2]
        full = cv2.resize(self.acc, (w, h), interpolation=cv2.INTER_LINEAR)
        mx = float(full.max())
        if mx < 1e-6:
            return frame_bgr
        norm_u8 = np.clip(full / mx * 255.0, 0, 255).astype(np.uint8)
        colored = cv2.applyColorMap(norm_u8, cv2.COLORMAP_INFERNO)
        return cv2.addWeighted(frame_bgr, 1.0 - self.alpha, colored, self.alpha, 0)


class TrackBoxOverlay:
    """Suaviza bbox por track (EMA) e mantem ultima caixa ate sumir do tracker."""

    def __init__(self, ema_alpha: float, hold_frames: int) -> None:
        self.ema_alpha = float(np.clip(ema_alpha, 0.0, 1.0))
        self.hold_frames = max(0, hold_frames)
        self._smooth: dict[int, tuple[float, float, float, float]] = {}
        self._miss: dict[int, int] = {}

    def set_params(self, ema_alpha: float, hold_frames: int) -> None:
        self.ema_alpha = float(np.clip(ema_alpha, 0.0, 1.0))
        self.hold_frames = max(0, hold_frames)

    def step(
        self,
        ids: list[int] | None,
        xyxys: list[tuple[float, float, float, float]] | None,
    ) -> list[tuple[int, tuple[int, int, int, int], bool]]:
        seen: set[int] = set()
        if ids is not None and xyxys is not None and len(ids) == len(xyxys):
            for tid, raw in zip(ids, xyxys):
                seen.add(int(tid))
                t = int(tid)
                prev = self._smooth.get(t)
                if prev is None or self.ema_alpha >= 1.0:
                    sm = raw
                else:
                    a = self.ema_alpha
                    sm = tuple(a * r + (1.0 - a) * p for p, r in zip(prev, raw))
                self._smooth[t] = sm
                self._miss[t] = 0

        for t in list(self._smooth.keys()):
            if t not in seen:
                self._miss[t] = self._miss.get(t, 0) + 1
                if self._miss[t] > self.hold_frames:
                    del self._smooth[t]
                    del self._miss[t]

        out: list[tuple[int, tuple[int, int, int, int], bool]] = []
        for t, box in self._smooth.items():
            x1, y1, x2, y2 = box
            stale = self._miss.get(t, 0) > 0
            out.append(
                (
                    t,
                    (int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))),
                    stale,
                )
            )
        return out


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Dashboard web do contador de pessoas")
    p.add_argument("--model", required=True)
    p.add_argument("--source", default="0", help="camera index, arquivo ou rtsp://")
    p.add_argument("--line", default="960,300,960,900", help="x1,y1,x2,y2 em pixels do frame")
    p.add_argument(
        "--conf",
        type=float,
        default=0.22,
        help="limiar de confianca (menor = mais deteccoes, mais falsos positivos)",
    )
    p.add_argument(
        "--imgsz",
        type=int,
        default=1280,
        help="lado maximo de redimensionamento na inferencia (maior ajuda pessoas pequenas)",
    )
    p.add_argument(
        "--iou",
        type=float,
        default=0.5,
        help="limiar IoU do NMS",
    )
    p.add_argument(
        "--max-det",
        type=int,
        default=200,
        help="maximo de deteccoes por frame (multidao)",
    )
    p.add_argument(
        "--augment",
        action="store_true",
        help="test-time augmentation (mais lento, pode ajudar cenas dificeis)",
    )
    p.add_argument(
        "--agnostic-nms",
        action="store_true",
        help="NMS entre classes (util se varias classes no modelo)",
    )
    p.add_argument("--person-class-id", type=int, default=None)
    p.add_argument(
        "--count-class-ids",
        default=None,
        help=(
            "IDs de classes YOLO a inferir, separados por virgula (ex.: 0,1 para pessoa e carro). "
            "Se omitido, so a classe pessoa. Em .env: COUNT_CLASS_IDS=0,1"
        ),
    )
    p.add_argument(
        "--device",
        default="auto",
        help="auto, cpu, mps ou id CUDA (ex: 0). Omissao anterior: inferencia podia ficar em CPU.",
    )
    p.add_argument(
        "--no-half",
        action="store_true",
        help="Na GPU, usa FP32 em vez de FP16 (mais lento). Por defeito FP16 na CUDA.",
    )
    p.add_argument(
        "--vid-stride",
        type=int,
        default=1,
        help="Processa 1 em cada N frames do video (2 ou 3 alivia CPU e reduz 'Waiting for stream').",
    )
    p.add_argument(
        "--stream-buffer",
        action="store_true",
        help="Fila ate ~30 frames no loader Ultralytics (menos 'Waiting for stream' se a inferencia atrasar o HLS; aumenta atraso vs. live).",
    )
    p.add_argument("--no-heatmap", action="store_true", help="desliga sobreposicao do mapa de calor")
    p.add_argument(
        "--heat-scale",
        type=int,
        default=4,
        help="divide resolucao do acumulador (4 = grade ~1/4 do frame; menor = mais detalhe, mais CPU)",
    )
    p.add_argument(
        "--heat-decay",
        type=float,
        default=0.985,
        help="decaimento por frame (mais perto de 1 = rastro mais longo)",
    )
    p.add_argument(
        "--heat-radius",
        type=int,
        default=10,
        help="raio do blob na grade reduzida (ver --heat-scale)",
    )
    p.add_argument(
        "--heat-alpha",
        type=float,
        default=0.42,
        help="opacidade da camada de calor sobre o video (0..1)",
    )
    p.add_argument(
        "--heat-gain",
        type=float,
        default=1.0,
        help="intensidade somada por deteccao no acumulador",
    )
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument(
        "--tracker",
        default="bytetrack.yaml",
        help="YAML do tracker (nome Ultralytics ou caminho, ex.: configs/bytetrack_stable.yaml)",
    )
    p.add_argument(
        "--track-ema",
        type=float,
        default=0.35,
        help="Peso do bbox novo na suavizacao 0..1 (menor = menos tremor; 1 = sem EMA)",
    )
    p.add_argument(
        "--track-hold-frames",
        type=int,
        default=25,
        help="Manter a ultima caixa N frames sem deteccao (reduz piscar; 0 = so frame atual)",
    )
    p.add_argument(
        "--trail-len",
        type=int,
        default=72,
        help="Historico de posicoes dos pes por pessoa para desenhar o trajeto; 0 desliga.",
    )
    p.add_argument(
        "--no-shape-filter",
        action="store_true",
        help="Desliga filtro de forma (postes/placas/caixas enormes podem ser contados como pessoa)",
    )
    p.add_argument(
        "--min-person-ar",
        type=float,
        default=0.85,
        help="Altura/largura minima do bbox (placas horizontais tendem a ser baixas)",
    )
    p.add_argument(
        "--max-person-ar",
        type=float,
        default=4.0,
        help="Altura/largura maxima (postes muito finos e altos excedem isto)",
    )
    p.add_argument(
        "--max-box-area-frac",
        type=float,
        default=0.14,
        help="Pessoa: rejeita bbox com area > esta fraccao do frame (estruturas gigantes)",
    )
    p.add_argument(
        "--max-nonperson-area-frac",
        type=float,
        default=0.92,
        help="Carro/outras classes: limite de area do bbox (veiculos em primeiro plano podem ocupar quase o ecra)",
    )
    p.add_argument(
        "--min-person-height-px",
        type=int,
        default=28,
        help="Altura minima do bbox em pixels",
    )
    p.add_argument(
        "--sex-model",
        default=None,
        help=(
            "Caminho para um .pt YOLO classify (pesos locais; nao e URL). "
            "Em .env: YOLO_SEX_MODEL=runs/.../weights/best.pt. "
            "Classes reconhecidas: female/male ou mulher/homem (nome no modelo). "
            "Estatistica so agregada na entrada; ver docs/04_privacidade_etica.md."
        ),
    )
    p.add_argument(
        "--sex-abstain",
        type=float,
        default=0.65,
        help="Confianca minima do top-1 (YOLO_SEX_ABSTAIN no .env); abaixo conta como unknown.",
    )
    p.add_argument(
        "--age-model",
        default=None,
        help=(
            "Caminho para um .pt YOLO classify com faixas etarias (nome das classes: "
            "crianca/child, adolescent/teen, young/jovem, adult, elderly/senior/idoso). "
            "Em .env: YOLO_AGE_MODEL=... Estatistica agregada na entrada."
        ),
    )
    p.add_argument(
        "--age-abstain",
        type=float,
        default=0.55,
        help="Confianca minima do top-1 (YOLO_AGE_ABSTAIN); abaixo conta como unknown.",
    )
    p.add_argument(
        "--no-heading-arrow",
        action="store_true",
        help="Nao desenhar seta de direcao prevista (PCA sobre o historico do trajeto).",
    )
    p.add_argument(
        "--heading-min-points",
        type=int,
        default=5,
        help="Minimo de pontos no rastro para estimar direcao.",
    )
    p.add_argument(
        "--heading-arrow-len",
        type=int,
        default=72,
        help="Comprimento em pixels da seta de tendencia.",
    )
    p.add_argument(
        "--heading-min-anisotropy",
        type=float,
        default=0.12,
        help="Limiar de anisotropia PCA (0=circular, 1=linha); abaixo usa direcao liquida.",
    )
    p.add_argument(
        "--heading-min-speed",
        type=float,
        default=0.05,
        help="Comprimento medio minimo por segmento do rastro (px/frame).",
    )
    p.add_argument(
        "--stationary-min-points",
        type=int,
        default=6,
        help="Minimo de pontos no rastro para classificar pessoa como parada/em movimento.",
    )
    p.add_argument(
        "--stationary-max-speed",
        type=float,
        default=2.2,
        help="Velocidade media maxima (px/frame) para considerar pessoa parada.",
    )
    p.add_argument(
        "--loitering-seconds",
        type=float,
        default=10.0,
        help="Segundos continuos parada para marcar permanencia prolongada.",
    )
    p.add_argument(
        "--queue-saturation",
        type=int,
        default=8,
        help="Tamanho de fila a partir do qual dispara alerta de saturação.",
    )
    p.add_argument(
        "--alert-cooldown",
        type=float,
        default=3.0,
        help="Segundos minimos entre alertas do mesmo tipo para o mesmo track_id.",
    )
    p.add_argument(
        "--alert-server-beep",
        action="store_true",
        help="Tocar bell do terminal (\\a) no processo do servidor a cada alerta.",
    )
    p.add_argument(
        "--cap-alert",
        action="store_true",
        help="Disparar alerta quando detectar pessoa com bone/chapeu via CLIP (zero-shot).",
    )
    p.add_argument(
        "--cap-alert-threshold",
        type=float,
        default=0.55,
        help="Probabilidade minima (CLIP) para confirmar 'pessoa com bone'.",
    )
    p.add_argument(
        "--car-color-alert",
        default="",
        help="Lista separada por virgula das cores-alvo (vermelho,azul,...); vazio desativa.",
    )
    p.add_argument(
        "--car-color-min-score",
        type=float,
        default=0.08,
        help="Fracao minima de pixels com a cor-alvo no crop central para confirmar.",
    )
    return p.parse_args()


def resolve_tracker_yaml(spec: str) -> str:
    if not spec.strip():
        return "bytetrack.yaml"
    p = Path(spec)
    if p.is_file():
        return str(p.resolve())
    return spec


# ── Dashboard visual theme (BGR) ────────────────────────────────────────────
# Cores alinhadas com o frontend: #00D4FF cyan, #10B981 verde, #6366F1 indigo
_C_CYAN        = (255, 212,   0)   # #00D4FF — movendo lado A / entrada
_C_CYAN_DIM    = (170, 140,   0)   # stale
_C_GREEN       = (129, 185,  16)   # #10B981 — movendo lado B / saída
_C_GREEN_DIM   = ( 85, 120,  10)
_C_GRAY        = (170, 170, 170)
_C_GRAY_DIM    = (100, 100, 100)
_C_AMBER       = ( 11, 158, 245)   # #F59E0B — parado
_C_AMBER_DIM   = (  7, 105, 163)   # stale parado
_C_RED         = ( 68,  68, 239)   # #EF4444 — loitering
_C_RED_DIM     = ( 45,  45, 160)   # stale loitering
_C_WHITE       = (255, 255, 255)
_C_BLACK       = (  0,   0,   0)
_C_SEX_FEMALE  = (140,  29, 225)
_C_SEX_FEMALE_DIM = (95, 20, 150)
_C_SEX_MALE    = (235,  99,  37)
_C_SEX_MALE_DIM = (155, 65, 25)
_C_SEX_UNKNOWN = (148, 163, 184)
_C_SEX_UNKNOWN_DIM = (100, 110, 125)
_C_VEHICLE     = (  0, 140, 255)   # #FF8C00 laranja — veículos e não-pessoas
_C_VEHICLE_DIM = (  0,  90, 170)   # stale veículo


def _draw_corner_box(
    frame: np.ndarray,
    xa: int, ya: int, xb: int, yb: int,
    color: tuple[int, int, int],
    thickness: int = 2,
    corner_frac: float = 0.22,
) -> None:
    """Bounding-box elegante: desenha apenas os cantos em vez do retângulo completo."""
    w = xb - xa
    h = yb - ya
    cl = max(8, int(min(w, h) * corner_frac))
    pts = [
        ((xa, ya), (xa + cl, ya), (xa, ya + cl)),          # top-left
        ((xb, ya), (xb - cl, ya), (xb, ya + cl)),          # top-right
        ((xa, yb), (xa + cl, yb), (xa, yb - cl)),          # bottom-left
        ((xb, yb), (xb - cl, yb), (xb, yb - cl)),          # bottom-right
    ]
    for corner, h_end, v_end in pts:
        cv2.line(frame, corner, h_end, color, thickness, lineType=cv2.LINE_AA)
        cv2.line(frame, corner, v_end, color, thickness, lineType=cv2.LINE_AA)


def _draw_footstep_trail(
    frame: np.ndarray,
    pts: np.ndarray,
    color: tuple[int, int, int],
) -> None:
    """Rastro em pegadas: círculos que crescem e ficam mais brilhantes do início ao fim."""
    n = len(pts)
    if n < 2:
        return
    shadow = tuple(max(0, int(c * 0.20)) for c in color)
    for i, pt in enumerate(pts):
        x, y = int(pt[0][0]), int(pt[0][1])
        # progresso 0.0 (cauda) → 1.0 (cabeça)
        t = i / (n - 1)
        # raio: 2px na cauda → 5px na cabeça
        r = max(2, int(2 + t * 3))
        # cor: escura na cauda, plena na cabeça
        faded = tuple(max(0, int(c * (0.25 + 0.75 * t))) for c in color)
        # sombra preta para contraste
        cv2.circle(frame, (x, y), r + 1, shadow, -1, lineType=cv2.LINE_AA)  # type: ignore[arg-type]
        cv2.circle(frame, (x, y), r,     faded,  -1, lineType=cv2.LINE_AA)  # type: ignore[arg-type]


def _draw_count_line(
    frame: np.ndarray,
    x1: int, y1: int, x2: int, y2: int,
) -> None:
    """Linha de contagem: glow suave + cyan fino + marcadores discretos."""
    shadow = tuple(int(c * 0.3) for c in _C_CYAN)
    cv2.line(frame, (x1, y1), (x2, y2), shadow, 4, lineType=cv2.LINE_AA)   # type: ignore[arg-type]
    cv2.line(frame, (x1, y1), (x2, y2), _C_CYAN, 2, lineType=cv2.LINE_AA)
    for pt in ((x1, y1), (x2, y2)):
        cv2.circle(frame, pt, 4, _C_BLACK, -1, lineType=cv2.LINE_AA)
        cv2.circle(frame, pt, 3, _C_CYAN,  -1, lineType=cv2.LINE_AA)


def _draw_heading_arrow(
    frame: np.ndarray,
    p0: tuple[int, int], p1: tuple[int, int],
    color: tuple[int, int, int],
) -> None:
    """Seta de direção: contorno fino + cor do tema."""
    cv2.arrowedLine(frame, p0, p1, _C_BLACK, 3, cv2.LINE_AA, 0, 0.22)
    cv2.arrowedLine(frame, p0, p1, color,    1, cv2.LINE_AA, 0, 0.22)
    cv2.circle(frame, p1, 4, _C_BLACK, -1, cv2.LINE_AA)
    cv2.circle(frame, p1, 2, color,    -1, cv2.LINE_AA)


def _draw_label_pill(
    frame: np.ndarray,
    text: str,
    center: tuple[int, int],
    color: tuple[int, int, int],
    fw: int, fh: int,
    scale: float = 0.36,
    thickness: int = 1,
) -> None:
    """Desenha label em pilula (fundo preto + borda colorida + texto branco)."""
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
    pad_x, pad_y = 5, 3
    cx, cy = center
    x0 = max(2, cx - tw // 2 - pad_x)
    y0 = max(2, cy - th // 2 - pad_y)
    x1 = min(fw - 3, x0 + tw + pad_x * 2)
    y1 = min(fh - 3, y0 + th + pad_y * 2)
    overlay = frame.copy()
    cv2.rectangle(overlay, (x0, y0), (x1, y1), (0, 0, 0), -1, cv2.LINE_AA)
    cv2.addWeighted(overlay, 0.62, frame, 0.38, 0, frame)
    cv2.rectangle(frame, (x0, y0), (x1, y1), color, 1, cv2.LINE_AA)
    tx = x0 + pad_x
    ty = y0 + pad_y + th - 1
    cv2.putText(frame, text, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), thickness + 1, cv2.LINE_AA)
    cv2.putText(frame, text, (tx, ty), cv2.FONT_HERSHEY_SIMPLEX,
                scale, _C_WHITE, thickness, cv2.LINE_AA)


def _draw_flow_direction_arrow(
    frame: np.ndarray,
    tail: tuple[int, int],
    head: tuple[int, int],
    color: tuple[int, int, int],
    fw: int, fh: int,
    inverted: bool = False,
) -> None:
    """Seta estilizada de fluxo dentro da zona.

    A cauda e' onde as pessoas entram na zona (tag ENTRADA); a ponta e' onde
    saem (tag SAIDA). Se 'inverted' as tags sao trocadas.

    Visual: shaft com glow (preto) + cor + highlight branco fino; ponta em
    triangulo preenchido com contorno escuro; cauda com ponto duplo.
    """
    sx, sy = tail
    ex, ey = head
    dx = float(ex - sx)
    dy = float(ey - sy)
    length = (dx * dx + dy * dy) ** 0.5
    if length < 5.0:
        return
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux
    head_len = max(10.0, min(24.0, length * 0.32))
    head_half_w = head_len * 0.44
    shaft_end_x = ex - ux * head_len
    shaft_end_y = ey - uy * head_len
    s0 = (int(round(sx)), int(round(sy)))
    se = (int(round(shaft_end_x)), int(round(shaft_end_y)))
    cv2.line(frame, s0, se, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.line(frame, s0, se, color, 2, cv2.LINE_AA)
    cv2.line(frame, s0, se, _C_WHITE, 1, cv2.LINE_AA)
    tip = (int(round(ex)), int(round(ey)))
    pL = (int(round(shaft_end_x + nx * head_half_w)),
          int(round(shaft_end_y + ny * head_half_w)))
    pR = (int(round(shaft_end_x - nx * head_half_w)),
          int(round(shaft_end_y - ny * head_half_w)))
    tri = np.array([tip, pL, pR], dtype=np.int32)
    tri_outer = np.array([
        (int(round(ex + ux)), int(round(ey + uy))),
        (int(round(shaft_end_x + nx * (head_half_w + 1))),
         int(round(shaft_end_y + ny * (head_half_w + 1)))),
        (int(round(shaft_end_x - nx * (head_half_w + 1))),
         int(round(shaft_end_y - ny * (head_half_w + 1)))),
    ], dtype=np.int32)
    cv2.fillPoly(frame, [tri_outer], (0, 0, 0), lineType=cv2.LINE_AA)
    cv2.fillPoly(frame, [tri], color, lineType=cv2.LINE_AA)
    # Brilho interno do triangulo: linha fina do centro ate o tip
    mid_base_x = (pL[0] + pR[0]) / 2.0
    mid_base_y = (pL[1] + pR[1]) / 2.0
    cv2.line(
        frame,
        (int(round(mid_base_x)), int(round(mid_base_y))),
        tip,
        _C_WHITE,
        1,
        cv2.LINE_AA,
    )
    cv2.circle(frame, s0, 5, (0, 0, 0), -1, cv2.LINE_AA)
    cv2.circle(frame, s0, 4, color, -1, cv2.LINE_AA)
    cv2.circle(frame, s0, 2, _C_WHITE, -1, cv2.LINE_AA)
    tail_label = "SAIDA" if inverted else "ENTRADA"
    head_label = "ENTRADA" if inverted else "SAIDA"
    off = 15
    tail_lbl_pos = (int(round(sx + nx * off)), int(round(sy + ny * off)))
    head_lbl_pos = (int(round(ex - nx * off)), int(round(ey - ny * off)))
    _draw_label_pill(frame, tail_label, tail_lbl_pos, color, fw, fh)
    _draw_label_pill(frame, head_label, head_lbl_pos, color, fw, fh)


def _overlay_text(
    frame: np.ndarray,
    text: str,
    live_text: str,
    fw: int,
    fh: int,
    infer_fps: float = 0.0,
) -> None:
    """Textos de contagem no canto superior esquerdo com fundo escuro."""
    pad = 8
    # Hershey nao desenha acentos (aparecem como "?"); manter ASCII.
    _fps = f"FPS infer. {infer_fps:.1f}" if infer_fps > 0.05 else "FPS infer. --"
    for i, (line, scale, thick) in enumerate([
        (text, 0.72, 2),
        (live_text, 0.52, 1),
        (_fps, 0.55, 1),
    ]):
        (tw, th), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
        y = pad + (i * (th + 7)) + th
        cv2.rectangle(frame, (pad - 4, y - th - 4), (pad + tw + 4, y + 4),
                      (0, 0, 0), -1)
        cv2.putText(frame, line, (pad, y),
                    cv2.FONT_HERSHEY_SIMPLEX, scale, _C_WHITE, thick, lineType=cv2.LINE_AA)


def side_of_line(x: float, y: float, x1: int, y1: int, x2: int, y2: int) -> float:
    return (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)


def clamp_line(
    x1: int, y1: int, x2: int, y2: int, fw: int, fh: int
) -> tuple[int, int, int, int]:
    def c(v: int, m: int) -> int:
        return int(max(0, min(m - 1, v)))

    if fw < 1 or fh < 1:
        return x1, y1, x2, y2
    return c(x1, fw), c(y1, fh), c(x2, fw), c(y2, fh)


def clamp_polygon(
    pts: list[tuple[int, int]], fw: int, fh: int
) -> list[tuple[int, int]]:
    if fw < 1 or fh < 1:
        return list(pts)
    out: list[tuple[int, int]] = []
    for x, y in pts:
        out.append(
            (int(max(0, min(fw - 1, x))), int(max(0, min(fh - 1, y))))
        )
    return out


def foot_inside_polygon(
    fx: float, fy: float, pts: list[tuple[int, int]]
) -> bool:
    if len(pts) < 3:
        return False
    cnt = np.array(pts, dtype=np.float32).reshape(-1, 1, 2)
    v = cv2.pointPolygonTest(cnt, (float(fx), float(fy)), False)
    return float(v) >= 0.0


def _seg_cross(ax: float, ay: float, bx: float, by: float,
               cx: float, cy: float, dx: float, dy: float) -> bool:
    """True se segmento AB cruza segmento CD (excluindo extremidades collineares)."""
    def _cross(ox, oy, px, py, qx, qy) -> float:
        return (px - ox) * (qy - oy) - (py - oy) * (qx - ox)
    d1 = _cross(cx, cy, dx, dy, ax, ay)
    d2 = _cross(cx, cy, dx, dy, bx, by)
    d3 = _cross(ax, ay, bx, by, cx, cy)
    d4 = _cross(ax, ay, bx, by, dx, dy)
    if ((d1 > 0 > d2) or (d1 < 0 < d2)) and ((d3 > 0 > d4) or (d3 < 0 < d4)):
        return True
    return False


def polygon_crossing_direction(
    prev_x: float, prev_y: float,
    curr_x: float, curr_y: float,
    pts: list[tuple[int, int]],
) -> int:
    """
    Retorna +1 (entrou no polígono), -1 (saiu), 0 (sem cruzamento).

    Conta quantas arestas do polígono o segmento prev→curr cruza.
    Cruzamento ímpar significa que os pontos estão em lados opostos (cruzou).
    A direção (entrou/saiu) é determinada pela posição do ponto anterior.
    """
    n = len(pts)
    if n < 3:
        return 0
    crossings = 0
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        if _seg_cross(prev_x, prev_y, curr_x, curr_y, ax, ay, bx, by):
            crossings += 1
    if crossings % 2 == 0:
        return 0
    # Número ímpar de cruzamentos: usamos o ponto anterior para determinar
    # se o movimento foi de fora para dentro (+1) ou de dentro para fora (-1).
    prev_inside = foot_inside_polygon(prev_x, prev_y, pts)
    return +1 if not prev_inside else -1


def foot_inside_any_of_polygons(
    fx: float, fy: float, polygons: list[list[tuple[int, int]]]
) -> bool:
    for pts in polygons:
        if foot_inside_polygon(fx, fy, pts):
            return True
    return False


def clamp_polygons_list(
    polygons: list[list[tuple[int, int]]], fw: int, fh: int
) -> list[list[tuple[int, int]]]:
    out: list[list[tuple[int, int]]] = []
    for ring in polygons:
        if len(ring) < 3:
            continue
        out.append(clamp_polygon(list(ring), fw, fh))
    return out


def copy_polygon_entries(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        pts = [(int(a), int(b)) for a, b in (e.get("points") or [])]
        if len(pts) < 3:
            continue
        t = str(e.get("title") or "").strip() or f"Área {len(out) + 1}"
        out.append({"title": t[:64], "points": pts, "inverted": bool(e.get("inverted", False))})
    return out


def clamp_named_polygons(
    entries: list[dict[str, Any]], fw: int, fh: int
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        pts = list(e.get("points") or ())
        if len(pts) < 3:
            continue
        t = str(e.get("title") or "").strip() or f"Área {len(out) + 1}"
        out.append({
            "title": t[:64],
            "points": clamp_polygon(list(pts), fw, fh),
            "inverted": bool(e.get("inverted", False)),
        })
    return out


def polygon_entries_sig(entries: list[dict[str, Any]]) -> str:
    ser: list[list[Any]] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        pts = e.get("points") or []
        if len(pts) < 3:
            continue
        t = str(e.get("title") or "").strip() or "?"
        ser.append([t, [[int(a), int(b)] for a, b in pts], bool(e.get("inverted", False))])
    return json.dumps(ser, separators=(",", ":"))


def _compute_cam_confidence(
    fps: float,
    blur_ema: float,
    avg_bbox_h: float,
    track_stability: float,
    present_count: int,
    *,
    blur_thresh_low: float = 60.0,
    blur_thresh_critical: float = 20.0,
    bbox_small_thresh_px: float = 40.0,
) -> tuple[str, list[str]]:
    """Retorna (nível, motivos) com base nos sinais de qualidade disponíveis."""
    reasons: list[str] = []
    if fps > 0 and fps < 8:
        reasons.append("fps_critical")
    elif fps > 0 and fps < 15:
        reasons.append("fps_low")
    if blur_ema > 0 and blur_ema < blur_thresh_critical:
        reasons.append("blur")
    elif blur_ema > 0 and blur_ema < blur_thresh_low:
        reasons.append("blur")
    if avg_bbox_h > 0 and avg_bbox_h < bbox_small_thresh_px:
        reasons.append("bbox_small")
    if present_count > 2 and track_stability < 0.4:
        reasons.append("tracking_unstable")

    if "fps_critical" in reasons or len(reasons) >= 3:
        return "low", reasons
    if reasons:
        return "medium", reasons
    return "high", []


def bbox_looks_like_person(
    xyxy: tuple[float, float, float, float],
    fw: int,
    fh: int,
    min_ar: float,
    max_ar: float,
    max_area_frac: float,
    min_h_px: int,
) -> bool:
    """Heuristica simples: exclui postes muito finos, placas horizontais e caixas enormes."""
    x1, y1, x2, y2 = xyxy
    w = max(0.0, float(x2 - x1))
    h = max(0.0, float(y2 - y1))
    if h < float(min_h_px) or w < 3.0:
        return False
    ar = h / max(w, 1e-6)
    if ar < min_ar or ar > max_ar:
        return False
    if w * h > max_area_frac * float(fw * fh):
        return False
    return True


def bbox_non_person_sane(
    xyxy: tuple[float, float, float, float],
    fw: int,
    fh: int,
    max_area_frac: float,
    min_h_px: int,
    min_h_frac: float = 0.28,
) -> bool:
    """Heuristica leve para carro/outros: rejeita caixas minusculas ou que cobrem o ecra inteiro.

    `max_area_frac` deve ser alto para veiculos (ex. 0.5): carros em primeiro plano ocupam
    uma fraccao grande do frame; o mesmo limite usado para pessoas (ex. 0.14) descarta-nos.
    `min_h_frac` (env YOLO_NONPERSON_MIN_H_FRAC): motas vistas de cima podem ter bbox baixa;
    valor menor aceita mais (ex. 0.18).
    """
    x1, y1, x2, y2 = xyxy
    w = max(0.0, float(x2 - x1))
    h = max(0.0, float(y2 - y1))
    _mf = max(0.08, min(0.45, float(min_h_frac)))
    if h < max(5.0, float(min_h_px) * _mf):
        return False
    if w * h > max_area_frac * float(fw * fh):
        return False
    return True


def filter_boxes_by_shape_multi(
    ids: list[int],
    xyxys: list[tuple[float, float, float, float]],
    clss: list[int],
    person_class_id: int,
    fw: int,
    fh: int,
    min_ar: float,
    max_ar: float,
    max_person_area_frac: float,
    max_nonperson_area_frac: float,
    min_h_px: int,
    nonperson_min_h_frac: float = 0.28,
    confs: list[float] | None = None,
) -> tuple[
    list[int],
    list[tuple[float, float, float, float]],
    list[int],
    list[float] | None,
]:
    out_ids: list[int] = []
    out_xy: list[tuple[float, float, float, float]] = []
    out_cls: list[int] = []
    out_confs: list[float] | None = (
        [] if confs is not None and len(confs) == len(ids) else None
    )
    for i, (tid, box, c) in enumerate(zip(ids, xyxys, clss)):
        c = int(c)
        if c == person_class_id:
            ok = bbox_looks_like_person(
                box, fw, fh, min_ar, max_ar, max_person_area_frac, min_h_px
            )
        else:
            ok = bbox_non_person_sane(
                box, fw, fh, max_nonperson_area_frac, min_h_px, min_h_frac=nonperson_min_h_frac
            )
        if ok:
            out_ids.append(tid)
            out_xy.append(box)
            out_cls.append(c)
            if out_confs is not None and confs is not None:
                out_confs.append(float(confs[i]))
    return out_ids, out_xy, out_cls, out_confs


def fallback_track_ids_from_detections(
    xyxys: list[tuple[float, float, float, float]],
    clss: list[int],
    *,
    cell_px: float = 44.0,
) -> list[int]:
    """Quando o ByteTrack nao devolve id (ou tensores 6-col), gera IDs estaveis por grelha + classe."""
    out: list[int] = []
    for i, (xy, c) in enumerate(zip(xyxys, clss)):
        x1, y1, x2, y2 = xy
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        gx = int(cx // cell_px) & 0x1FF
        gy = int(cy // cell_px) & 0x1FF
        base = 5_200_000 + (int(c) & 0x1F) * 131_072 + gy * 512 + gx
        out.append(base + i * 3)
    return out


def predict_trail_heading_pca(
    pts: list[tuple[int, int]],
    *,
    max_points: int = 28,
    min_points: int = 5,
    min_anisotropy: float = 0.12,
    min_speed: float = 0.05,
) -> tuple[float, float, float] | None:
    """Tendencia de movimento a partir do rastro: PCA 2D; fallback se o trajeto for curvo.

    Velocidade usa o comprimento medio dos segmentos (|Delta p| por frame), nunca a media
    dos Delta x/y separados (isso anula-se em ziguezague). Sentido PCA alinha-se ao
    deslocamento liquido (primeiro->ultimo) ou ao ultimo segmento se o liquido for quase nulo.

    Retorna (ux, uy, confianca). None se o movimento for fraco.
    """
    if len(pts) < min_points:
        return None
    seg = pts[-max_points:]
    xs_o = np.array([p[0] for p in seg], dtype=np.float64)
    ys_o = np.array([p[1] for p in seg], dtype=np.float64)
    if len(xs_o) < min_points:
        return None
    dx = np.diff(xs_o)
    dy = np.diff(ys_o)
    seg_len = np.hypot(dx, dy)
    positive = seg_len[seg_len > 1e-6]
    if positive.size == 0:
        return None
    speed = float(np.mean(positive))
    if speed < min_speed:
        return None

    def _align_sign(ux: float, uy: float) -> tuple[float, float]:
        gx = float(xs_o[-1] - xs_o[0])
        gy = float(ys_o[-1] - ys_o[0])
        if np.hypot(gx, gy) < 0.5:
            gx = float(xs_o[-1] - xs_o[-2])
            gy = float(ys_o[-1] - ys_o[-2])
        if ux * gx + uy * gy < 0:
            return -ux, -uy
        return ux, uy

    xs = xs_o - xs_o.mean()
    ys = ys_o - ys_o.mean()
    cov = np.cov(np.stack([xs, ys], axis=0))
    evals, evecs = np.linalg.eigh(cov)
    e0, e1 = float(evals[0]), float(evals[1])
    trace = e1 + e0 + 1e-9
    anisotropy = (e1 - e0) / trace

    if anisotropy >= min_anisotropy and trace > 1e-8:
        vx = float(evecs[0, -1])
        vy = float(evecs[1, -1])
        h = float(np.hypot(vx, vy))
        if h > 1e-9:
            ux, uy = vx / h, vy / h
            ux, uy = _align_sign(ux, uy)
            conf = float(np.clip(anisotropy, 0.0, 1.0))
            return ux, uy, conf

    gx = float(xs_o[-1] - xs_o[0])
    gy = float(ys_o[-1] - ys_o[0])
    gn = float(np.hypot(gx, gy))
    if gn < 1e-3 and len(xs_o) >= 2:
        gx = float(xs_o[-1] - xs_o[-2])
        gy = float(ys_o[-1] - ys_o[-2])
        gn = float(np.hypot(gx, gy))
    if gn < 1e-6:
        return None
    ux, uy = gx / gn, gy / gn
    return ux, uy, 0.35


def estimate_trail_speed(
    pts: list[tuple[int, int]],
    *,
    max_points: int = 12,
) -> float | None:
    """Velocidade media recente do rastro em px/frame."""
    if len(pts) < 2:
        return None
    seg = pts[-max(2, max_points):]
    if len(seg) < 2:
        return None
    xs = np.array([p[0] for p in seg], dtype=np.float64)
    ys = np.array([p[1] for p in seg], dtype=np.float64)
    dx = np.diff(xs)
    dy = np.diff(ys)
    seg_len = np.hypot(dx, dy)
    if seg_len.size == 0:
        return None
    return float(np.mean(seg_len))


def _camera_unavailable_message() -> str:
    if sys.platform == "darwin":
        return (
            "Falha ao abrir a camera por indice. No macOS: Ajustes > Privacidade e seguranca > Camera "
            "para Terminal/iTerm/Python. Tente tambem --source 1 ou 2."
        )
    return (
        "Nenhuma camera V4L2 disponivel (ex.: sem /dev/video0). Ligue uma webcam ou use fonte por ficheiro/URL: "
        "defina YOLO_WEB_SOURCE ou YOLO_WEB_YOUTUBE_URL no .env, ou ./scripts/run_web.sh --youtube 'URL_DO_YOUTUBE'."
    )


def validate_source(source: str | int) -> None:
    if isinstance(source, int):
        cap: cv2.VideoCapture | None = None
        try:
            if sys.platform.startswith("linux") and hasattr(cv2, "CAP_V4L2"):
                cap = cv2.VideoCapture(source, cv2.CAP_V4L2)
            if cap is None or not cap.isOpened():
                if cap is not None:
                    cap.release()
                cap = cv2.VideoCapture(source)
            ok = bool(cap.isOpened())
        finally:
            if cap is not None:
                cap.release()
        if not ok:
            raise ConnectionError(_camera_unavailable_message())


def write_summary_csv(
    path: Path,
    state: CounterState,
    started_at: datetime,
    sex: SexAggregateStats | None = None,
    age: AgeAggregateStats | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["started_at", "finished_at", "entries", "exits", "total_passages"]
    if sex is not None:
        fields += ["sex_female_agg", "sex_male_agg", "sex_unknown_agg"]
    if age is not None:
        fields += [
            "age_child_agg",
            "age_adolescent_agg",
            "age_young_agg",
            "age_adult_agg",
            "age_elderly_agg",
            "age_unknown_agg",
        ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        row: dict = {
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now().isoformat(),
            "entries": state.entries,
            "exits": state.exits,
            "total_passages": state.total,
        }
        if sex is not None:
            row["sex_female_agg"] = sex.female
            row["sex_male_agg"] = sex.male
            row["sex_unknown_agg"] = sex.unknown
        if age is not None:
            row["age_child_agg"] = age.child
            row["age_adolescent_agg"] = age.adolescent
            row["age_young_agg"] = age.young
            row["age_adult_agg"] = age.adult
            row["age_elderly_agg"] = age.elderly
            row["age_unknown_agg"] = age.unknown
        writer.writerow(row)


def _read_track_infer_env(args: argparse.Namespace) -> dict[str, Any]:
    """Parametros para model.track() a partir de os.environ (hot-reload), com fallback em args."""

    def _f(key: str, default: float) -> float:
        raw = os.environ.get(key, "").strip()
        if raw == "":
            return float(default)
        try:
            return float(raw)
        except ValueError:
            return float(default)

    def _i(key: str, default: int) -> int:
        raw = os.environ.get(key, "").strip()
        if raw == "":
            return int(default)
        try:
            return int(float(raw))
        except ValueError:
            return int(default)

    def _bool_env(key: str, default_bool: bool) -> bool:
        raw = os.environ.get(key, "").strip().lower()
        if raw in ("1", "true", "yes", "on"):
            return True
        if raw in ("0", "false", "no", "off"):
            return False
        return bool(default_bool)

    conf = max(0.01, min(0.99, _f("YOLO_INFER_CONF", float(args.conf))))
    iou = max(0.05, min(0.95, _f("YOLO_INFER_IOU", float(args.iou))))
    imgsz = max(320, min(2048, _i("YOLO_INFER_IMGSZ", int(args.imgsz))))
    max_det = max(1, min(500, _i("YOLO_MAX_DET", int(args.max_det))))
    vid_stride = max(1, min(16, _i("YOLO_VID_STRIDE", int(max(1, getattr(args, "vid_stride", 1))))))
    stream_buffer = _bool_env("YOLO_STREAM_BUFFER", bool(getattr(args, "stream_buffer", False)))
    augment = _bool_env("YOLO_AUGMENT", bool(args.augment))
    agnostic_nms = _bool_env("YOLO_AGNOSTIC_NMS", bool(args.agnostic_nms))
    tracker = os.environ.get("YOLO_TRACKER", "").strip() or str(getattr(args, "tracker", "bytetrack.yaml"))
    track_ema = max(0.0, min(1.0, _f("YOLO_TRACK_EMA", float(args.track_ema))))
    track_hold = max(0, min(240, _i("YOLO_TRACK_HOLD_FRAMES", int(args.track_hold_frames))))
    tc_suppress = max(0.01, min(0.99, _f("TRACK_CONF_SUPPRESS_THRESHOLD", 0.35)))
    tc_vehicle_suppress = max(0.01, min(0.99, _f("TRACK_CONF_VEHICLE_SUPPRESS_THRESHOLD", 0.30)))
    tc_min_age = max(1, min(30, _i("TRACK_CONF_MIN_AGE_FRAMES", 3)))
    return {
        "conf": conf,
        "iou": iou,
        "imgsz": imgsz,
        "max_det": max_det,
        "vid_stride": vid_stride,
        "stream_buffer": stream_buffer,
        "augment": augment,
        "agnostic_nms": agnostic_nms,
        "tracker": tracker,
        "track_ema": track_ema,
        "track_hold_frames": track_hold,
        "tc_suppress": tc_suppress,
        "tc_vehicle_suppress": tc_vehicle_suppress,
        "tc_min_age": tc_min_age,
    }


def _jpeg_quality_from_env(default: int = 80) -> int:
    try:
        q = int(os.environ.get("YOLO_WEB_JPEG_QUALITY", "").strip() or str(default))
    except ValueError:
        q = default
    return max(30, min(100, q))


def _heading_enabled_from_env(args: argparse.Namespace) -> bool:
    raw = os.environ.get("YOLO_WEB_HEADING", "").strip().lower()
    if raw in ("0", "false", "no", "off"):
        return False
    if raw in ("1", "true", "yes", "on"):
        return True
    return not bool(getattr(args, "no_heading_arrow", False))


def inference_loop(
    args: argparse.Namespace,
    shared: SharedState,
    stop_event: threading.Event,
    audit_log: AuditLog,
    drift_detector: CameraDriftDetector,
    analytics_worker: "AggregatorWorker | None" = None,
) -> None:
    import uuid as _uuid_mod
    from datetime import datetime as _dt, timezone as _tz

    def _emit(
        event_type: str,
        track_id_int: int,
        cls_id: int,
        cx_n: float,
        cy_n: float,
        confidence: float,
        roi_id: str,
        mode: str,
        frame_ts: float,
    ) -> None:
        if analytics_worker is None:
            return
        try:
            with shared.lock:
                cam_id = str(shared.active_preset_id or shared.session_id)
                cls_name = shared.yolo_class_names.get(cls_id, f"class_{cls_id}")
            analytics_worker.submit(_AnalyticsEventRaw(
                id=str(_uuid_mod.uuid4()),
                timestamp=_dt.fromtimestamp(frame_ts, tz=_tz.utc),
                camera_id=cam_id,
                roi_id=roi_id,
                track_id=str(track_id_int),
                cls=cls_name,
                event_type=event_type,
                x=round(cx_n, 6),
                y=round(cy_n, 6),
                confidence=round(confidence, 4),
                metadata={"mode": mode},
            ))
        except Exception:
            pass

    try:
        model = YOLO(args.model)
        count_class_ids, person_class_id = resolve_yolo_classes_and_person_id(
            model, args.person_class_id, args.count_class_ids
        )
        names = getattr(model, "names", {})
        cls_label = "?"
        if isinstance(names, dict):
            cls_label = ", ".join(
                str(names.get(i, names.get(str(i), "?"))) for i in count_class_ids
            )
        print(
            f"[web] torch.cuda.is_available()={torch.cuda.is_available()} "
            f"device_count={torch.cuda.device_count()}"
        )
        if not torch.cuda.is_available():
            print(
                "[web] AVISO: PyTorch nao ve GPU neste processo (inferencia em CPU = poucos FPS). "
                "Se o treino usa GPU, abra o terminal apos 'newgrp video' ou novo login, ou confira drivers."
            )

        resolved_device = resolve_device(args.device)
        use_half = (
            not args.no_half
            and resolved_device != "cpu"
            and resolved_device != "mps"
            and torch.cuda.is_available()
        )
        _nc_model = infer_model_nc(model)
        with shared.lock:
            shared.model_nc = int(_nc_model)
        print(
            f"[web] classes inferencia ids={count_class_ids} ({cls_label}) | "
            f"model_nc={_nc_model} | "
            f"classe pessoa (sexo/idade) id={person_class_id} | "
            f"conf={args.conf} imgsz={args.imgsz} max_det={args.max_det} "
            f"augment={args.augment} agnostic_nms={args.agnostic_nms} | "
            f"device={resolved_device} half={use_half} vid_stride={args.vid_stride} stream_buffer={args.stream_buffer}"
        )

        with shared.lock:
            _ld = shared.line_live
            _mode = shared.count_mode
            _np = sum(len(e.get("points") or ()) for e in shared.polygons_live)
        with shared.lock:
            _n_poly = len(shared.polygons_live)
        print(
            f"[web] Modo contagem={_mode} | linha (pixels): {_ld} | poligonos: {_n_poly} ({_np} vertices). "
            "Linha: pes cruzam segmento. Poligono: entrada/saida pela uniao das areas (UI /roi)."
        )
        with shared.lock:
            nm: dict[int, str] = {}
            if isinstance(names, dict):
                for _k, _v in names.items():
                    try:
                        nm[int(_k)] = str(_v)
                    except (TypeError, ValueError):
                        pass
            shared.yolo_class_names = nm
            shared.yolo_count_class_ids = list(count_class_ids)
            shared.yolo_person_class_id = person_class_id
            if len(count_class_ids) <= 1:
                shared.track_vehicle_enabled = False
                shared.track_person_enabled = True
                shared.track_active_class_ids = list(count_class_ids)
            else:
                _rebuild_active_from_flags(shared, list(count_class_ids), person_class_id)
        if len(count_class_ids) > 1 and not args.agnostic_nms:
            print(
                "[web] Dica: varias classes no mesmo modelo; se caixas se sobreporem entre classes, "
                "experimente YOLO_AGNOSTIC_NMS=1 no .env."
            )
        # Inicializa fonte no SharedState
        with shared.lock:
            if not shared.source_live:
                shared.source_live = args.source

        sex_clf: OptionalSexClassifier | None = None
        if args.sex_model:
            try:
                sex_clf = OptionalSexClassifier(args.sex_model, resolved_device, args.sex_abstain)
            except Exception as exc:
                print(f"[web] ERRO ao carregar --sex-model: {exc}")
                sex_clf = None
            with shared.lock:
                _sen = bool(sex_clf and sex_clf.enabled)
                shared.sex_classifier_enabled = _sen
                shared.sex_overlay_available = _sen
            if sex_clf and sex_clf.enabled:
                print(
                    f"[web] Estatistica agregada por sexo na entrada (abstain>={args.sex_abstain}). "
                    "Apenas totais; ver docs/04_privacidade_etica.md"
                )
            else:
                print("[web] AVISO: --sex-model nao ativo (ficheiro inexistente ou nao e YOLO classify)")

        age_clf: OptionalAgeClassifier | None = None
        if args.age_model:
            try:
                age_clf = OptionalAgeClassifier(args.age_model, resolved_device, args.age_abstain)
            except Exception as exc:
                print(f"[web] ERRO ao carregar --age-model: {exc}")
                age_clf = None
            with shared.lock:
                shared.age_classifier_enabled = bool(age_clf and age_clf.enabled)
            if age_clf and age_clf.enabled:
                print(
                    f"[web] Estatistica agregada por faixa etaria na entrada (abstain>={args.age_abstain}). "
                    "Classes: nomeie o modelo com child/teen/young/adult/elderly ou equivalentes PT."
                )
            else:
                print("[web] AVISO: --age-model nao ativo (ficheiro inexistente ou nao e YOLO classify)")

        alert_mgr = AlertManager(
            cooldown_seconds=args.alert_cooldown,
            server_beep=args.alert_server_beep,
        )
        cap_detector = OptionalCapDetector(
            device=resolved_device,
            threshold=args.cap_alert_threshold,
        ) if args.cap_alert else None
        car_colors = parse_target_colors(args.car_color_alert)
        car_color_clf = CarColorClassifier(
            targets=car_colors,
            min_target_score=args.car_color_min_score,
        ) if car_colors else None
        with shared.lock:
            shared.alert_manager = alert_mgr
            shared.alert_cap_enabled = bool(cap_detector is not None)
            shared.alert_car_colors = list(car_colors)
            shared.alert_cap_detector = cap_detector
            shared.alert_car_color_clf = car_color_clf
            shared.alert_cap_threshold = args.cap_alert_threshold
            shared.alert_car_min_score = args.car_color_min_score
            shared.alert_server_beep = args.alert_server_beep
        if cap_detector is not None:
            print(
                f"[web] Alerta de bone/chapeu ATIVO (CLIP, threshold={args.cap_alert_threshold}, "
                f"cooldown={args.alert_cooldown}s). Instale se faltar: pip install open-clip-torch"
            )
        if car_color_clf is not None and car_color_clf.enabled:
            print(
                f"[web] Alerta de cor de carro ATIVO: {sorted(car_color_clf.targets)} "
                f"(min_score={args.car_color_min_score}, cooldown={args.alert_cooldown}s)"
            )

        last_side_by_id: dict[int, float] = {}
        # Ultima classe YOLO por track (persiste em frames de hold do overlay / filtro intermitente)
        last_yolo_cls_by_tid: dict[int, int] = {}
        prev_inside_by_id: dict[int, bool] = {}
        prev_inside_per_poly_by_id: dict[int, list[bool | None]] = {}
        zone_entered_per_poly_by_id: dict[int, list[float | None]] = {}
        # Ultimo ponto do pe por track_id (para deteção de cruzamento por segmento)
        prev_foot_per_track: dict[int, tuple[float, float]] = {}
        poly_session_entries: list[int] = []
        poly_session_exits: list[int] = []
        poly_session_vehicle_entries: list[int] = []
        poly_session_vehicle_exits: list[int] = []
        # Vetor de direcao medio (EMA) por poligono, em px/frame.
        # Usado para desenhar uma seta de fluxo dentro da zona.
        poly_heading_ema: list[tuple[float, float]] = []
        prev_foot_px_by_id: dict[int, tuple[int, int]] = {}
        prev_config_sig: str | None = None
        zone_entered_at_by_id: dict[int, float] = {}
        stationary_since_by_id: dict[int, float] = {}
        heat: HeatmapAccumulator | None = None
        if not args.no_heatmap:
            heat = HeatmapAccumulator(
                scale=args.heat_scale,
                decay=args.heat_decay,
                radius=args.heat_radius,
                alpha=args.heat_alpha,
                blob_gain=args.heat_gain,
            )
            print(
                f"[web] Heatmap scale={args.heat_scale} decay={args.heat_decay} "
                f"radius={args.heat_radius} alpha={args.heat_alpha}"
            )

        grid_live = GridLive()
        vehicle_grid_live = GridLive()
        _grid_live_counter: int = 0
        heatmap_store = HeatmapStore()
        slot_aggregator = SlotAggregator(grid_h=GridLive.GRID_H, grid_w=GridLive.GRID_W)
        with shared.lock:
            _hm_site_id = cam_cal.site_id()
            _hm_cam_id = shared.active_preset_id or "default"
            _hm_sess_id = shared.session_id
        _hm_grid_version = heatmap_store.get_or_create_grid_version(_hm_site_id, _hm_cam_id)

        ensure_builtin_templates()
        dwell_store = DwellStore()
        dwell_slot_aggregator = DwellSlotAggregator(
            grid_h=GridLive.GRID_H, grid_w=GridLive.GRID_W
        )
        dwell_grid = DwellGridLive()
        zone_store_inf = ZoneStore()
        zone_tracker = ZoneSlotTracker([])
        zone_tracker_ids: tuple[int, ...] = ()
        vehicle_zone_tracker = ZoneSlotTracker([])
        vehicle_zone_tracker_ids: tuple[int, ...] = ()
        last_ts_by_id: dict[int, float] = {}
        hotspot_scorer = HotspotScorer(
            _hm_site_id, _hm_cam_id, _hm_grid_version, heatmap_store, dwell_store
        )
        _hotspot_payload_counter = 0
        _last_hotspot_cam: str | None = None
        queue_detector = QueueDetector()
        flow_grid = FlowVectorGrid()
        _flow_vec_counter: int = 0
        person_tracker = PersonTracker()
        _last_norm_pos_by_id: dict[int, tuple[float, float]] = {}
        track_conf_tracker = TrackConfidenceTracker()

        box_overlay = TrackBoxOverlay(args.track_ema, args.track_hold_frames)
        if args.no_shape_filter:
            print("[web] Filtro de forma desligado (--no-shape-filter)")
        else:
            print(
                f"[web] Filtro de forma ativo: ar=[{args.min_person_ar},{args.max_person_ar}] "
                f"max_person_area_frac={args.max_box_area_frac} "
                f"max_nonperson_area_frac={args.max_nonperson_area_frac} "
                f"min_h_px={args.min_person_height_px}"
            )

        # ── Loop externo: reinicia o stream ao trocar fonte ─────────────────
        while not stop_event.is_set():
            with shared.lock:
                raw_src = shared.source_live
                shared.source_changed = False
                shared.track_classes_changed = False

            _tp = _read_track_infer_env(args)
            box_overlay.set_params(_tp["track_ema"], _tp["track_hold_frames"])
            tracker_yaml = resolve_tracker_yaml(_tp["tracker"])
            _ffmpeg_capture_base = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS", "").strip()
            print(
                f"[web] tracker={tracker_yaml} conf={_tp['conf']:.3f} imgsz={_tp['imgsz']} "
                f"max_det={_tp['max_det']} vid_stride={_tp['vid_stride']} "
                f"stream_buffer={_tp['stream_buffer']}",
                flush=True,
            )

            try:
                stream_src = resolve_stream_source(str(raw_src))
            except Exception as exc:
                err_msg = f"Resolucao da fonte: {exc}"
                print(f"[web] {err_msg}")
                with shared.lock:
                    shared.last_error = err_msg
                time.sleep(5.0)
                continue

            if stream_src != str(raw_src).strip():
                print("[web] Pagina SkylineWebcams (.html) resolvida para manifesto HLS.")

            source = int(stream_src) if str(stream_src).strip().isdigit() else stream_src
            try:
                validate_source(source)
            except Exception as exc:
                with shared.lock:
                    shared.last_error = f"Fonte inválida: {exc}"
                # Indice de camara inexistente: validate_source falha em loop curto -> Obsensor/OpenCV no stderr.
                _retry_s = 15.0 if isinstance(source, int) else 2.0
                time.sleep(_retry_s)
                continue

            print(f"[web] Abrindo fonte: {source!r}")

            apply_opencv_ffmpeg_capture_env(source, base_opts=_ffmpeg_capture_base)

            if isinstance(source, str) and is_skyline_hls_url(source):
                _ok_hls, _probe_err = probe_skyline_hls_url(source)
                if not _ok_hls:
                    _pe = (
                        f"Skyline HLS inacessivel ({_probe_err}). O token ?a= nos URLs hd-auth expira; "
                        "abra a pagina da camara, copie um m3u8 novo (F12 > Rede) ou use o URL .html no preset."
                    )
                    print(f"[web] {_pe}")
                    with shared.lock:
                        shared.last_error = f"{_pe} Fonte: {source[:120]}{'...' if len(source) > 120 else ''}"
                    time.sleep(5.0)
                    continue

            _v_ids = [c for c in count_class_ids if c != person_class_id]
            with shared.lock:
                _allowed_ids = set(shared.yolo_count_class_ids)
                _active_raw = list(shared.track_active_class_ids)
            effective_class_ids = sorted({c for c in _active_raw if c in _allowed_ids})
            if not effective_class_ids:
                if _v_ids and person_class_id not in _active_raw:
                    print(
                        "[web] AVISO: nenhuma classe ativa valida; a usar classe pessoa no YOLO."
                    )
                effective_class_ids = [person_class_id]
            seen: set[int] = set()
            _uniq: list[int] = []
            for _cid in effective_class_ids:
                if _cid not in seen:
                    seen.add(_cid)
                    _uniq.append(_cid)
            # So as classes ativas na UI (_uniq), nao a uniao de todos os veiculos em COUNT_CLASS_IDS.
            # A expansao antiga fazia aparecer carros com «so moto» marcado (YOLO_TRACK_NO_CLASSES_ARG).
            effective_class_ids = sorted(set(_uniq))
            _eff_set = set(effective_class_ids)
            _track_people = person_class_id in _eff_set
            _tv = any(c in _eff_set for c in _v_ids)
            print(
                f"[web] YOLO classes={effective_class_ids} "
                f"(track_active={_active_raw}, track_people={_track_people}, track_vehicles={_tv})"
            )

            _omit_track_classes_kw = os.environ.get("YOLO_TRACK_NO_CLASSES_ARG", "0").strip().lower() in (
                "1",
                "true",
                "yes",
                "on",
            )
            _strict_ui_classes_fz = frozenset(_uniq)
            if _omit_track_classes_kw:
                _eff_cls_fz = _strict_ui_classes_fz
                print(
                    "[web] YOLO_TRACK_NO_CLASSES_ARG=1: inferencia sem argumento classes=; "
                    f"filtro local por classes ativas na UI={sorted(_eff_cls_fz)}."
                )
            else:
                _eff_cls_fz = _strict_ui_classes_fz

            _infer_conf = float(_tp["conf"])
            _vehicles_only_stream = (
                person_class_id not in _eff_set and bool(_v_ids) and any(c in _eff_set for c in _v_ids)
            )
            if _vehicles_only_stream:
                try:
                    _vmult = float(os.environ.get("YOLO_CONF_MULT_VEHICLE_ONLY", "0.55").strip())
                except ValueError:
                    _vmult = 0.55
                _infer_conf = max(0.02, min(0.99, _infer_conf * _vmult))
                print(
                    f"[web] Modo so veiculos: conf={_infer_conf:.3f} "
                    f"(base {_tp['conf']:.3f} * YOLO_CONF_MULT_VEHICLE_ONLY={_vmult})"
                )

            track_kw: dict = {
                "source": source,
                "stream": True,
                "conf": _infer_conf,
                "iou": _tp["iou"],
                "imgsz": _tp["imgsz"],
                "max_det": _tp["max_det"],
                "tracker": tracker_yaml,
                "persist": True,
                "verbose": False,
                "device": resolved_device,
                "vid_stride": max(1, int(_tp["vid_stride"])),
                "stream_buffer": bool(_tp["stream_buffer"]),
            }
            _is_http_hls = (
                isinstance(source, str)
                and source.lower().startswith(("http://", "https://"))
                and ".m3u8" in source.lower()
            )
            if _is_http_hls and track_kw["stream_buffer"]:
                # Em HLS ao vivo (especialmente Skyline), deixar o dataloader do
                # Ultralytics enfileirar segmentos pode levar a stalls longos:
                # a URL abre, mas o loop deixa de receber `result.orig_img`.
                track_kw["stream_buffer"] = False
                print(
                    "[web] HLS ao vivo detectado: stream_buffer=False para reduzir stalls no tracker.",
                    flush=True,
                )
            if not _omit_track_classes_kw:
                track_kw["classes"] = effective_class_ids
            if use_half:
                track_kw["half"] = True
            if _tp["augment"]:
                track_kw["augment"] = True
            if _tp["agnostic_nms"]:
                track_kw["agnostic_nms"] = True

            # ── Smooth display: thread extra com segundo VideoCapture lê o mesmo source à FPS
            # «natural» e publica JPEG com overlay composto (diff). Em webcam local ajuda a fluidez.
            # Em HLS/RTSP/HTTP outro cap paralelo ao model.track() disputa decoder/CDN e pode travar.
            _smooth_disp: bool = os.environ.get("YOLO_SMOOTH_DISPLAY", "0").strip().lower() in (
                "1", "true", "yes", "on",
            )
            if _smooth_disp and isinstance(source, str):
                _su = source.strip().lower()
                if _su.startswith(("http://", "https://", "rtsp://", "rtmp://")):
                    print(
                        "[web] YOLO_SMOOTH_DISPLAY ignorado para URL em rede "
                        "(um único leitor; segundo VideoCapture competia com track() e travava HLS).",
                        flush=True,
                    )
                    _smooth_disp = False
            _smooth_disp_stop = threading.Event()
            _smooth_disp_thread: threading.Thread | None = None
            if _smooth_disp:
                try:
                    _jpeg_q_smooth = max(40, min(95, int(
                        os.environ.get("YOLO_WEB_JPEG_QUALITY", "80").strip() or "80"
                    )))
                except ValueError:
                    _jpeg_q_smooth = 80

                def _make_smooth_fn(
                    _src=source,
                    _stop=_smooth_disp_stop,
                    _jq=_jpeg_q_smooth,
                ):
                    def _fn() -> None:
                        try:
                            if (
                                isinstance(_src, int)
                                and sys.platform.startswith("linux")
                                and hasattr(cv2, "CAP_V4L2")
                            ):
                                _cap = cv2.VideoCapture(_src, cv2.CAP_V4L2)
                                if not _cap.isOpened():
                                    _cap.release()
                                    _cap = cv2.VideoCapture(_src)
                            else:
                                _cap = cv2.VideoCapture(_src)
                        except Exception:
                            return
                        if not _cap.isOpened():
                            print(
                                f"[web] smooth-display: nao foi possivel abrir {_src!r}",
                                flush=True,
                            )
                            return
                        print(
                            f"[web] smooth-display: capture aberto ({_src!r})",
                            flush=True,
                        )
                        # cap.read() bloqueia naturalmente à FPS do stream — não precisamos de
                        # sleep extra; a câmera/HLS controla o ritmo de entrega de frames.
                        while not _stop.is_set():
                            _ok_r, _raw = _cap.read()
                            if not _ok_r:
                                time.sleep(0.05)
                                continue
                            with shared.smooth_display_overlay_lock:
                                _ov = shared.smooth_display_overlay_i16
                            if _ov is not None:
                                try:
                                    if _ov.shape[:2] == _raw.shape[:2]:
                                        _disp = np.clip(
                                            _raw.astype(np.int16) + _ov, 0, 255
                                        ).astype(np.uint8)
                                    else:
                                        _disp = _raw
                                except Exception:
                                    _disp = _raw
                            else:
                                _disp = _raw
                            _ok_e, _enc = cv2.imencode(
                                ".jpg", _disp, [int(cv2.IMWRITE_JPEG_QUALITY), _jq]
                            )
                            if _ok_e:
                                _publish_jpeg_frame(shared, _enc.tobytes())
                        _cap.release()
                        print("[web] smooth-display: encerrado.", flush=True)
                    return _fn

                _smooth_disp_thread = threading.Thread(
                    target=_make_smooth_fn(),
                    daemon=True,
                    name="smooth-display",
                )
                _smooth_disp_thread.start()

            stream = model.track(**track_kw)
            try:
                _np_h_frac = float(os.environ.get("YOLO_NONPERSON_MIN_H_FRAC", "0.20").strip() or "0.20")
            except ValueError:
                _np_h_frac = 0.20
            _np_h_frac = max(0.08, min(0.45, _np_h_frac))
            last_yolo_cls_by_tid.clear()
            sex_smoother: PerTrackSexSmoother | None = (
                PerTrackSexSmoother.from_env() if sex_clf is not None and sex_clf.enabled else None
            )
            foot_trail_by_id: dict[int, deque[tuple[int, int]]] = {}
            try:
                trail_max = max(
                    0,
                    int(os.environ.get("YOLO_WEB_TRAIL_LEN", "").strip() or str(int(args.trail_len))),
                )
            except ValueError:
                trail_max = max(0, int(args.trail_len))
            show_heading_arrow = _heading_enabled_from_env(args) and trail_max >= 2
            prev_frame_mono: float | None = None
            ema_infer_fps: float = 0.0
            blur_ema: float = 0.0
            _frames_received = 0
            _synthetic_id_warned = False
            try:
                _blur_sample_every = int(os.environ.get("YOLO_BLUR_SAMPLE_EVERY", "1").strip() or "1")
            except ValueError:
                _blur_sample_every = 1
            _blur_sample_every = max(1, min(30, _blur_sample_every))
            try:
                _sex_ui_stride = int(os.environ.get("YOLO_SEX_UI_STRIDE", "1").strip() or "1")
            except ValueError:
                _sex_ui_stride = 1
            _sex_ui_stride = max(1, min(12, _sex_ui_stride))
            if _blur_sample_every > 1 or _sex_ui_stride > 1:
                print(
                    f"[web] Desempenho: YOLO_BLUR_SAMPLE_EVERY={_blur_sample_every} "
                    f"YOLO_SEX_UI_STRIDE={_sex_ui_stride} (1=desligado)",
                    flush=True,
                )

            for result in stream:
                if stop_event.is_set():
                    break
                _tick_now = time.monotonic()
                with shared.frame_output_lock:
                    shared.last_track_tick_mono = _tick_now
                with shared.lock:
                    if shared.source_changed or shared.track_classes_changed:
                        break
                    if shared.infer_params_reload:
                        break

                frame = result.orig_img
                if frame is None:
                    continue
                # Cópia do frame antes do desenho — usada para calcular o diff de overlay.
                # Feita apenas quando smooth display está activo para evitar custo desnecessário.
                _smooth_orig: "np.ndarray | None" = frame.copy() if _smooth_disp else None

                _frames_received += 1
                fh, fw = frame.shape[:2]
                if shared.frame_w != fw or shared.frame_h != fh:
                    with shared.lock:
                        shared.frame_w = fw
                        shared.frame_h = fh
                if _frames_received % _blur_sample_every == 0 or blur_ema <= 0.0:
                    _blur_gray = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2GRAY)
                    _blur_score = float(cv2.Laplacian(_blur_gray, cv2.CV_64F).var())
                    blur_ema = blur_ema * 0.9 + _blur_score * 0.1 if blur_ema > 0 else _blur_score
                with shared.lock:
                    _hm_cam_id = shared.active_preset_id or "default"
                if _hm_cam_id != _last_hotspot_cam:
                    _last_hotspot_cam = _hm_cam_id
                    _hm_grid_version = heatmap_store.get_or_create_grid_version(
                        _hm_site_id, _hm_cam_id
                    )
                    hotspot_scorer.camera_id = _hm_cam_id
                    hotspot_scorer.grid_version = _hm_grid_version
                    hotspot_scorer._hist_cache = None
                with shared.lock:
                    raw_line = shared.line_live
                    count_mode = shared.count_mode
                    pe_sig = copy_polygon_entries(shared.polygons_live)
                    show_sex_ui = bool(shared.show_sex_overlay and shared.sex_overlay_available)
                cfg_sig = f"{count_mode}|{raw_line}|{polygon_entries_sig(pe_sig)}"
                if prev_config_sig is not None and cfg_sig != prev_config_sig:
                    last_side_by_id.clear()
                    prev_inside_by_id.clear()
                    prev_inside_per_poly_by_id.clear()
                    zone_entered_per_poly_by_id.clear()
                    prev_foot_per_track.clear()
                    foot_trail_by_id.clear()
                    zone_entered_at_by_id.clear()
                    stationary_since_by_id.clear()
                prev_config_sig = cfg_sig

                x1, y1, x2, y2 = clamp_line(*raw_line, fw, fh)
                named_clamped = clamp_named_polygons(pe_sig, fw, fh)
                poly_pts_list = [e["points"] for e in named_clamped]
                poly_titles = [str(e.get("title") or "") for e in named_clamped]
                n_poly = len(poly_pts_list)
                if len(poly_session_entries) != n_poly:
                    poly_session_entries = [0] * n_poly
                    poly_session_exits = [0] * n_poly
                    poly_session_vehicle_entries = [0] * n_poly
                    poly_session_vehicle_exits = [0] * n_poly
                if len(poly_heading_ema) != n_poly:
                    poly_heading_ema = [(0.0, 0.0)] * n_poly
                with shared.lock:
                    _do_reset = bool(shared.counters_reset_flag)
                    if _do_reset:
                        shared.counters_reset_flag = False
                if _do_reset:
                    poly_session_entries = [0] * n_poly
                    poly_session_exits = [0] * n_poly
                    poly_session_vehicle_entries = [0] * n_poly
                    poly_session_vehicle_exits = [0] * n_poly
                    poly_heading_ema = [(0.0, 0.0)] * n_poly
                    prev_inside_by_id.clear()
                    prev_inside_per_poly_by_id.clear()
                    zone_entered_per_poly_by_id.clear()
                    prev_foot_px_by_id.clear()
                    last_side_by_id.clear()
                frame_ts = time.monotonic()
                if prev_frame_mono is not None:
                    dt = frame_ts - prev_frame_mono
                    if dt > 1e-6:
                        inst_fps = 1.0 / dt
                        ema_infer_fps = (
                            inst_fps if ema_infer_fps <= 0 else 0.92 * ema_infer_fps + 0.08 * inst_fps
                        )
                prev_frame_mono = frame_ts

                _v_ids_loop = [c for c in count_class_ids if c != person_class_id]
                with shared.lock:
                    _allowed_sf = set(shared.yolo_count_class_ids)
                    _active_sf = {c for c in shared.track_active_class_ids if c in _allowed_sf}
                _tp_sf = person_class_id in _active_sf
                _tv_sf = any(c in _active_sf for c in _v_ids_loop)
                _vehicles_only_mode = (not _tp_sf) and _tv_sf and len(_v_ids_loop) > 0
                # Com so veiculos no YOLO, o filtro de forma para "nao-pessoa" cortava muitas caixas reais
                _skip_nonperson_shape = _vehicles_only_mode
                if (not _tp_sf) and _tv_sf and _v_ids_loop:
                    _veh_active = sorted(c for c in _active_sf if c != person_class_id)
                    _default_det_cls = int(_veh_active[0]) if _veh_active else int(_v_ids_loop[0])
                else:
                    _default_det_cls = int(person_class_id)

                entry_boxes: list[tuple[int, tuple[float, float, float, float]]] = []
                _bbox_h_samples: list[float] = []
                _person_pos_norm: dict[int, tuple[float, float]] = {}

                foot_points: list[tuple[float, float]] = []
                current_present_ids: set[int] = set()
                # conjuntos de status do frame anterior — usados na colorização
                _stationary_ids: set[int] = set()
                _loitering_ids: set[int] = set()

                if result.boxes is not None and len(result.boxes) > 0:
                    xys = result.boxes.xyxy.tolist()
                    clss_hm = (
                        result.boxes.cls.int().tolist()
                        if result.boxes.cls is not None
                        else [person_class_id] * len(xys)
                    )
                    for (x_min, y_min, x_max, y_max), c_raw in zip(xys, clss_hm):
                        c = int(c_raw)
                        if c not in _eff_cls_fz:
                            continue
                        box = (float(x_min), float(y_min), float(x_max), float(y_max))
                        if not args.no_shape_filter:
                            if _skip_nonperson_shape:
                                pass
                            elif c == person_class_id:
                                if not bbox_looks_like_person(
                                    box,
                                    fw,
                                    fh,
                                    args.min_person_ar,
                                    args.max_person_ar,
                                    args.max_box_area_frac,
                                    args.min_person_height_px,
                                ):
                                    continue
                            elif not bbox_non_person_sane(
                                box,
                                fw,
                                fh,
                                args.max_nonperson_area_frac,
                                args.min_person_height_px,
                                _np_h_frac,
                            ):
                                continue
                        foot_x = (x_min + x_max) / 2.0
                        foot_y = float(y_max)
                        if count_mode == "polygon" and poly_pts_list:
                            if not foot_inside_any_of_polygons(foot_x, foot_y, poly_pts_list):
                                continue
                        foot_points.append((foot_x, foot_y))

                if heat is not None:
                    heat.step(fh, fw, foot_points)
                    with shared.lock:
                        show_hm = shared.show_heatmap_overlay
                    if show_hm:
                        frame = heat.blend_over(frame)

                ids_list: list[int] | None = None
                xys_raw: list[tuple[float, float, float, float]] | None = None
                cls_by_tid: dict[int, int] = {}
                conf_by_tid: dict[int, float] = {}
                if result.boxes is not None and len(result.boxes) > 0:
                    _boxes = result.boxes
                    xys_raw = [tuple(map(float, t)) for t in _boxes.xyxy.tolist()]
                    clss_raw = [int(t) for t in _boxes.cls.int().tolist()]
                    confs_raw = (
                        _boxes.conf.tolist()
                        if _boxes.conf is not None
                        else [1.0] * len(xys_raw)
                    )
                    ids_pre: list[int] | None = None
                    if (
                        getattr(_boxes, "is_track", False)
                        and _boxes.id is not None
                        and len(_boxes.id) == len(xys_raw)
                    ):
                        ids_pre = [int(t) for t in _boxes.id.int().tolist()]
                    if _omit_track_classes_kw:
                        _keep_ix = [i for i, c in enumerate(clss_raw) if c in _eff_cls_fz]
                        if len(_keep_ix) != len(clss_raw):
                            xys_raw = [xys_raw[i] for i in _keep_ix]
                            clss_raw = [clss_raw[i] for i in _keep_ix]
                            confs_raw = [confs_raw[i] for i in _keep_ix]
                            if ids_pre is not None:
                                ids_pre = [ids_pre[i] for i in _keep_ix]
                    if ids_pre is not None:
                        ids_list = ids_pre
                    else:
                        ids_list = fallback_track_ids_from_detections(xys_raw, clss_raw)
                        if not _synthetic_id_warned:
                            print(
                                "[web] AVISO: deteccoes sem IDs ByteTrack validos; "
                                "overlay usa IDs por posicao (menos estavel que o tracker)."
                            )
                            _synthetic_id_warned = True
                    if len(ids_list) != len(xys_raw):
                        ids_list = fallback_track_ids_from_detections(xys_raw, clss_raw)
                    if not args.no_shape_filter and not _skip_nonperson_shape:
                        ids_list, xys_raw, clss_raw, _cf_f = filter_boxes_by_shape_multi(
                            ids_list,
                            xys_raw,
                            clss_raw,
                            person_class_id,
                            fw,
                            fh,
                            args.min_person_ar,
                            args.max_person_ar,
                            args.max_box_area_frac,
                            args.max_nonperson_area_frac,
                            args.min_person_height_px,
                            _np_h_frac,
                            confs_raw,
                        )
                        if _cf_f is not None:
                            confs_raw = _cf_f
                    elif (
                        args.no_shape_filter
                        and not _skip_nonperson_shape
                        and os.environ.get("YOLO_SHAPE_FILTER_NONPERSON", "").strip().lower()
                        in ("1", "true", "yes", "on")
                    ):
                        _oi: list[int] = []
                        _ox: list[tuple[float, float, float, float]] = []
                        _oc: list[int] = []
                        _of: list[float] = []
                        for tid, box, c, cf in zip(ids_list, xys_raw, clss_raw, confs_raw):
                            ci = int(c)
                            if ci == int(person_class_id):
                                _oi.append(tid)
                                _ox.append(box)
                                _oc.append(ci)
                                _of.append(float(cf))
                            elif bbox_non_person_sane(
                                box,
                                fw,
                                fh,
                                args.max_nonperson_area_frac,
                                args.min_person_height_px,
                                _np_h_frac,
                            ):
                                _oi.append(tid)
                                _ox.append(box)
                                _oc.append(ci)
                                _of.append(float(cf))
                        ids_list = _oi
                        xys_raw = _ox
                        clss_raw = _oc
                        confs_raw = _of
                    conf_by_tid = {int(tid): float(c) for tid, c in zip(ids_list, confs_raw)}
                    cls_by_tid = {int(tid): int(c) for tid, c in zip(ids_list, clss_raw)}
                    for _tid, _c in cls_by_tid.items():
                        last_yolo_cls_by_tid[int(_tid)] = int(_c)
                    dt_by_tid: dict[int, float] = {}
                    for tid in ids_list:
                        it = int(tid)
                        prev = last_ts_by_id.get(it, frame_ts)
                        dt_by_tid[it] = max(0.0, min(frame_ts - prev, 2.0))
                        last_ts_by_id[it] = frame_ts
                    for track_id, (x_min, y_min, x_max, y_max) in zip(ids_list, xys_raw):
                        foot_x = (x_min + x_max) / 2.0
                        foot_y = float(y_max)
                        inside_for_presence = True
                        if count_mode == "polygon" and poly_pts_list:
                            inside_for_presence = foot_inside_any_of_polygons(
                                foot_x, foot_y, poly_pts_list
                            )
                        if inside_for_presence:
                            current_present_ids.add(track_id)
                            zone_entered_at_by_id.setdefault(track_id, frame_ts)
                        # Track confidence update (veiculos: score sem penalizar bbox instavel)
                        _det_conf = conf_by_tid.get(track_id, 1.0)
                        _is_veh = cls_by_tid.get(track_id, _default_det_cls) != person_class_id
                        track_conf_tracker.update(
                            track_id,
                            _det_conf,
                            (x_min, y_min, x_max, y_max),
                            frame_ts,
                            is_vehicle=_is_veh,
                        )
                        _track_reliable = track_conf_tracker.is_reliable(
                            track_id,
                            suppress_thresh=_tp["tc_suppress"],
                            vehicle_suppress_thresh=_tp["tc_vehicle_suppress"],
                            min_age=_tp["tc_min_age"],
                        )
                        _cx_n, _cy_n = foot_x / fw, foot_y / fh
                        grid_live.update_track(int(track_id), _cx_n, _cy_n, frame_ts)
                        flow_grid.update_track(int(track_id), _cx_n, _cy_n)
                        dwell_grid.update_track(
                            int(track_id),
                            foot_x / float(fw),
                            foot_y / float(fh),
                            dt_by_tid.get(int(track_id), 0.0),
                        )
                        if _is_veh:
                            vehicle_grid_live.update_track(int(track_id), _cx_n, _cy_n, frame_ts)
                        _last_norm_pos_by_id[int(track_id)] = (_cx_n, _cy_n)
                        if not _is_veh:
                            _bbox_h_samples.append(y_max - y_min)
                            if inside_for_presence:
                                _person_pos_norm[int(track_id)] = (_cx_n, _cy_n)
                                person_tracker.get_or_assign(int(track_id), _cx_n, _cy_n, frame_ts)
                                person_tracker.update_dwell(
                                    int(track_id), dt_by_tid.get(int(track_id), 0.0)
                                )
                        if count_mode == "polygon" and poly_pts_list:
                            inside = inside_for_presence
                            prev_b = prev_inside_by_id.get(track_id)
                            _poly_roi = (named_clamped[0].get("title") or "polygon") if named_clamped else "polygon"
                            # Entrada na uniao: (1) fora->dentro classico; (2) primeira observacao
                            # ja dentro — sem (2), camaras que so cobrem o interior da zona ficam sempre a 0.
                            union_entry = (
                                _track_reliable
                                and inside
                                and (prev_b is None or not prev_b)
                            )
                            if union_entry:
                                with shared.lock:
                                    _sess_poly = shared.session_id
                                    shared.counter.entries += 1
                                    if _is_veh:
                                        shared.counter.vehicle_entries += 1
                                        _vcls = cls_by_tid.get(track_id, _default_det_cls)
                                        shared.counter.vehicle_class_entries[_vcls] = shared.counter.vehicle_class_entries.get(_vcls, 0) + 1
                                    _bump_hourly(shared, "entry")
                                entry_boxes.append(
                                    (track_id, (x_min, y_min, x_max, y_max))
                                )
                                audit_log.log(
                                    ts=frame_ts, session_id=_sess_poly,
                                    event_type="entry", track_id=int(track_id),
                                    confidence=track_conf_tracker.score_of(track_id),
                                    x_norm=_cx_n, y_norm=_cy_n,
                                    metadata={"mode": "polygon"},
                                )
                                _emit("entry", int(track_id), cls_by_tid.get(track_id, _default_det_cls), _cx_n, _cy_n, track_conf_tracker.score_of(track_id), _poly_roi, "polygon", frame_ts)
                            elif (
                                prev_b is not None
                                and not prev_b
                                and inside
                                and not _track_reliable
                            ):
                                with shared.lock:
                                    shared.suppressed_events += 1
                            elif prev_b is not None and prev_b and not inside:
                                if _track_reliable:
                                    with shared.lock:
                                        _sess_poly = shared.session_id
                                        shared.counter.exits += 1
                                        if _is_veh:
                                            shared.counter.vehicle_exits += 1
                                            _vcls = cls_by_tid.get(track_id, _default_det_cls)
                                            shared.counter.vehicle_class_exits[_vcls] = shared.counter.vehicle_class_exits.get(_vcls, 0) + 1
                                        _bump_hourly(shared, "exit")
                                    audit_log.log(
                                        ts=frame_ts, session_id=_sess_poly,
                                        event_type="exit", track_id=int(track_id),
                                        confidence=track_conf_tracker.score_of(track_id),
                                        x_norm=_cx_n, y_norm=_cy_n,
                                        metadata={"mode": "polygon"},
                                    )
                                    _emit("exit", int(track_id), cls_by_tid.get(track_id, _default_det_cls), _cx_n, _cy_n, track_conf_tracker.score_of(track_id), _poly_roi, "polygon", frame_ts)
                                else:
                                    with shared.lock:
                                        shared.suppressed_events += 1
                            # Primeira observacao dentro mas track ainda "novo": nao fixar prev=True
                            # ate ser confiavel, senao perde-se a entrada implicita na uniao.
                            if not (prev_b is None and inside and not _track_reliable):
                                prev_inside_by_id[track_id] = inside
                            # Per-polygon individual tracking (entries/exits per zone)
                            if poly_pts_list:
                                cur_poly = [foot_inside_polygon(foot_x, foot_y, pts) for pts in poly_pts_list]
                                prev_foot = prev_foot_per_track.get(track_id)
                                prev_poly = prev_inside_per_poly_by_id.get(track_id)
                                is_new_track = prev_poly is None or len(prev_poly) != len(poly_pts_list)
                                if is_new_track:
                                    prev_poly = [False] * len(poly_pts_list)
                                for pi, inside_pi in enumerate(cur_poly):
                                    if _track_reliable:
                                        _inv = bool(named_clamped[pi].get("inverted", False)) if pi < len(named_clamped) else False
                                        if prev_foot is not None:
                                            # Detecção precisa: segmento prev→curr cruza a fronteira?
                                            _cross = polygon_crossing_direction(
                                                prev_foot[0], prev_foot[1],
                                                foot_x, foot_y,
                                                poly_pts_list[pi],
                                            )
                                            _is_entry = (_cross == -1) if _inv else (_cross == +1)
                                            _is_exit  = (_cross == +1) if _inv else (_cross == -1)
                                        else:
                                            # Primeiro frame do track: fallback à comparação de estado
                                            pp = prev_poly[pi]
                                            _went_in  = not pp and inside_pi
                                            _went_out = pp and not inside_pi
                                            _is_entry = _went_out if _inv else _went_in
                                            _is_exit  = _went_in  if _inv else _went_out
                                        if _is_entry:
                                            if pi < len(poly_session_entries):
                                                poly_session_entries[pi] += 1
                                            if _is_veh and pi < len(poly_session_vehicle_entries):
                                                poly_session_vehicle_entries[pi] += 1
                                            ept = zone_entered_per_poly_by_id.setdefault(
                                                track_id, [None] * len(poly_pts_list)
                                            )
                                            if len(ept) < len(poly_pts_list):
                                                ept.extend([None] * (len(poly_pts_list) - len(ept)))
                                            ept[pi] = frame_ts
                                        elif _is_exit:
                                            if pi < len(poly_session_exits):
                                                poly_session_exits[pi] += 1
                                            if _is_veh and pi < len(poly_session_vehicle_exits):
                                                poly_session_vehicle_exits[pi] += 1
                                # Atualiza EMA de direcao por poligono: vetor de
                                # deslocamento dos pes (px/frame) entre o frame
                                # anterior e o atual, so para tracks confiaveis
                                # que estao dentro do poligono.
                                _prev_foot = prev_foot_px_by_id.get(track_id)
                                if (
                                    _track_reliable
                                    and _prev_foot is not None
                                    and not is_new_track
                                ):
                                    _vx = float(foot_x) - float(_prev_foot[0])
                                    _vy = float(foot_y) - float(_prev_foot[1])
                                    _speed = (_vx * _vx + _vy * _vy) ** 0.5
                                    # Ignora ruido muito pequeno (pessoa parada).
                                    if _speed > 1.2:
                                        _alpha = 0.08
                                        for pi, inside_pi in enumerate(cur_poly):
                                            if inside_pi and pi < len(poly_heading_ema):
                                                _hx, _hy = poly_heading_ema[pi]
                                                _nx = (1 - _alpha) * _hx + _alpha * _vx
                                                _ny = (1 - _alpha) * _hy + _alpha * _vy
                                                poly_heading_ema[pi] = (_nx, _ny)
                                prev_inside_per_poly_by_id[track_id] = cur_poly
                                prev_foot_px_by_id[track_id] = (
                                    int(round(foot_x)), int(round(foot_y))
                                )
                                prev_foot_per_track[track_id] = (foot_x, foot_y)
                        elif count_mode == "line":
                            side = side_of_line(foot_x, foot_y, x1, y1, x2, y2)
                            prev = last_side_by_id.get(track_id)
                            if prev is not None and prev < 0 <= side:
                                if _track_reliable:
                                    with shared.lock:
                                        _sess_line = shared.session_id
                                        shared.counter.entries += 1
                                        if _is_veh:
                                            shared.counter.vehicle_entries += 1
                                            _vcls = cls_by_tid.get(track_id, _default_det_cls)
                                            shared.counter.vehicle_class_entries[_vcls] = shared.counter.vehicle_class_entries.get(_vcls, 0) + 1
                                        _bump_hourly(shared, "entry")
                                    entry_boxes.append(
                                        (track_id, (x_min, y_min, x_max, y_max))
                                    )
                                    audit_log.log(
                                        ts=frame_ts, session_id=_sess_line,
                                        event_type="entry", track_id=int(track_id),
                                        confidence=track_conf_tracker.score_of(track_id),
                                        x_norm=_cx_n, y_norm=_cy_n,
                                        metadata={"mode": "line"},
                                    )
                                    _emit("entry", int(track_id), cls_by_tid.get(track_id, _default_det_cls), _cx_n, _cy_n, track_conf_tracker.score_of(track_id), "line", "line", frame_ts)
                                else:
                                    with shared.lock:
                                        shared.suppressed_events += 1
                            elif prev is not None and prev > 0 >= side:
                                if _track_reliable:
                                    with shared.lock:
                                        _sess_line = shared.session_id
                                        shared.counter.exits += 1
                                        if _is_veh:
                                            shared.counter.vehicle_exits += 1
                                            _vcls = cls_by_tid.get(track_id, _default_det_cls)
                                            shared.counter.vehicle_class_exits[_vcls] = shared.counter.vehicle_class_exits.get(_vcls, 0) + 1
                                        _bump_hourly(shared, "exit")
                                    audit_log.log(
                                        ts=frame_ts, session_id=_sess_line,
                                        event_type="exit", track_id=int(track_id),
                                        confidence=track_conf_tracker.score_of(track_id),
                                        x_norm=_cx_n, y_norm=_cy_n,
                                        metadata={"mode": "line"},
                                    )
                                    _emit("exit", int(track_id), cls_by_tid.get(track_id, _default_det_cls), _cx_n, _cy_n, track_conf_tracker.score_of(track_id), "line", "line", frame_ts)
                                else:
                                    with shared.lock:
                                        shared.suppressed_events += 1
                            last_side_by_id[track_id] = side

                    if (
                        ids_list is not None
                        and xys_raw is not None
                        and len(ids_list) == len(xys_raw)
                    ):
                        with shared.lock:
                            _zr = shared.zones_reload_flag
                        if _zr:
                            with shared.lock:
                                shared.zones_reload_flag = False
                            _hm_grid_version = heatmap_store.get_or_create_grid_version(
                                _hm_site_id, _hm_cam_id
                            )
                            hotspot_scorer.grid_version = _hm_grid_version
                        zrec = zone_store_inf.load_zone_records(_hm_site_id, _hm_cam_id)
                        cur_zids = tuple(z.id for z in zrec)
                        if cur_zids != zone_tracker_ids:
                            zone_tracker = ZoneSlotTracker(list(cur_zids))
                            zone_tracker_ids = cur_zids
                        assigner = ZoneAssigner(zrec, fw, fh)
                        positions = [
                            (
                                int(tid),
                                float((xa + xb) / 2.0),
                                float(yb),
                            )
                            for tid, (xa, ya, xb, yb) in zip(ids_list, xys_raw)
                        ]
                        zone_tracker.step_frame(assigner, positions, dt_by_tid)

                        # Vehicle zone tracking (separate tracker, vehicles only)
                        if cur_zids != vehicle_zone_tracker_ids:
                            vehicle_zone_tracker = ZoneSlotTracker(list(cur_zids))
                            vehicle_zone_tracker_ids = cur_zids
                        vehicle_positions = [
                            (int(tid), float((xa + xb) / 2.0), float(yb))
                            for tid, (xa, ya, xb, yb) in zip(ids_list, xys_raw)
                            if cls_by_tid.get(tid, _default_det_cls) != person_class_id
                        ]
                        vehicle_zone_tracker.step_frame(assigner, vehicle_positions, dt_by_tid)

                draw_items = box_overlay.step(ids_list, xys_raw)
                active_ids = {t for t, _, _ in draw_items}
                raw_foot_by_id: dict[int, tuple[int, int]] = {}
                if ids_list is not None and xys_raw is not None and len(ids_list) == len(xys_raw):
                    for tid, (rx1, ry1, rx2, ry2) in zip(ids_list, xys_raw):
                        raw_foot_by_id[int(tid)] = (
                            int(round((rx1 + rx2) / 2.0)),
                            int(round(float(ry2))),
                        )
                # Publica pes atuais + rastro para o editor de ROI (guia visual do chao).
                _feet_now = list(raw_foot_by_id.values())
                with shared.lock:
                    shared.live_feet_px = _feet_now
                    shared.frame_w = int(fw)
                    shared.frame_h = int(fh)
                    for _pt in _feet_now:
                        shared.recent_feet_trail_px.append(_pt)
                flow_grid.decay()
                for tid in list(last_side_by_id.keys()):
                    if tid not in active_ids:
                        del last_side_by_id[tid]
                        grid_live.evict_track(tid)
                        vehicle_grid_live.evict_track(tid)
                        flow_grid.evict_track(tid)
                for tid in list(prev_inside_by_id.keys()):
                    if tid not in active_ids:
                        del prev_inside_by_id[tid]
                for tid in list(prev_inside_per_poly_by_id.keys()):
                    if tid not in active_ids:
                        del prev_inside_per_poly_by_id[tid]
                        zone_entered_per_poly_by_id.pop(tid, None)
                        prev_foot_per_track.pop(tid, None)
                for tid in list(prev_foot_px_by_id.keys()):
                    if tid not in active_ids:
                        del prev_foot_px_by_id[tid]
                for tid in list(foot_trail_by_id.keys()):
                    if tid not in active_ids:
                        del foot_trail_by_id[tid]
                for tid in list(zone_entered_at_by_id.keys()):
                    if tid not in current_present_ids:
                        del zone_entered_at_by_id[tid]
                for tid in list(stationary_since_by_id.keys()):
                    if tid not in current_present_ids:
                        del stationary_since_by_id[tid]
                person_tracker.expire_ghosts(frame_ts)
                for tid in list(last_ts_by_id.keys()):
                    if tid not in active_ids:
                        last_ts_by_id.pop(tid, None)
                        last_yolo_cls_by_tid.pop(tid, None)
                        zone_tracker.forget_track(tid)
                        vehicle_zone_tracker.forget_track(tid)
                        track_conf_tracker.evict(tid)
                        _lp = _last_norm_pos_by_id.pop(tid, None)
                        if _lp is not None:
                            person_tracker.on_track_lost(tid, _lp[0], _lp[1], frame_ts)

                with shared.lock:
                    show_trail_ui = shared.show_trail_overlay
                    show_heading_ui = shared.show_heading_overlay
                    show_roi_ui = shared.show_roi_overlay
                    _active_classes = frozenset(shared.track_active_class_ids)
                    _all_vehicles_mode = shared.all_vehicles_mode

                _hide_stale_boxes = os.environ.get("YOLO_HIDE_STALE_BOXES", "").strip().lower() in (
                    "1",
                    "true",
                    "yes",
                    "on",
                )
                try:
                    _ov_min_det = float(
                        os.environ.get("YOLO_OVERLAY_MIN_DET_CONF", "").strip() or "0"
                    )
                except ValueError:
                    _ov_min_det = 0.0
                _ov_min_det = max(0.0, min(0.99, _ov_min_det))
                try:
                    _ov_min_v = float(
                        os.environ.get("YOLO_OVERLAY_MIN_DET_CONF_VEHICLE", "").strip() or "0"
                    )
                except ValueError:
                    _ov_min_v = 0.0
                _ov_min_v = max(0.0, min(0.99, _ov_min_v))
                try:
                    _ov_v_wmin = float(
                        os.environ.get("YOLO_OVERLAY_VEHICLE_MIN_WIDTH_FRAC", "").strip() or "0"
                    )
                except ValueError:
                    _ov_v_wmin = 0.0
                _ov_v_wmin = max(0.0, min(0.5, _ov_v_wmin))
                try:
                    _ov_v_edge = float(
                        os.environ.get(
                            "YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC", ""
                        ).strip()
                        or "0"
                    )
                except ValueError:
                    _ov_v_edge = 0.0
                _ov_v_edge = max(0.0, min(0.45, _ov_v_edge))
                _raw_v_edge_cov = os.environ.get(
                    "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC", ""
                ).strip()
                if not _raw_v_edge_cov:
                    _ov_v_edge_cover = 0.5
                else:
                    try:
                        _ov_v_edge_cover = float(_raw_v_edge_cov)
                    except ValueError:
                        _ov_v_edge_cover = 0.5
                _ov_v_edge_cover = max(0.0, min(1.0, _ov_v_edge_cover))
                try:
                    _ov_p_edge = float(
                        os.environ.get(
                            "YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC", ""
                        ).strip()
                        or "0"
                    )
                except ValueError:
                    _ov_p_edge = 0.0
                _ov_p_edge = max(0.0, min(0.45, _ov_p_edge))
                try:
                    _ov_p_hmin = float(
                        os.environ.get(
                            "YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC", ""
                        ).strip()
                        or "0"
                    )
                except ValueError:
                    _ov_p_hmin = 0.0
                _ov_p_hmin = max(0.0, min(0.5, _ov_p_hmin))
                _raw_p_edge_cov = os.environ.get(
                    "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC", ""
                ).strip()
                if not _raw_p_edge_cov:
                    _ov_p_edge_cover = 0.5
                else:
                    try:
                        _ov_p_edge_cover = float(_raw_p_edge_cov)
                    except ValueError:
                        _ov_p_edge_cover = 0.5
                _ov_p_edge_cover = max(0.0, min(1.0, _ov_p_edge_cover))
                try:
                    _ov_p_glare_z = float(
                        os.environ.get(
                            "YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC", ""
                        ).strip()
                        or "0"
                    )
                except ValueError:
                    _ov_p_glare_z = 0.0
                _ov_p_glare_z = max(0.0, min(0.45, _ov_p_glare_z))
                try:
                    _ov_p_glare_min = float(
                        os.environ.get(
                            "YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF", ""
                        ).strip()
                        or "0"
                    )
                except ValueError:
                    _ov_p_glare_min = 0.0
                _ov_p_glare_min = max(0.0, min(0.99, _ov_p_glare_min))
                for track_id, (xa, ya, xb, yb), stale in draw_items:
                    if _hide_stale_boxes and stale:
                        continue
                    # ByteTrack pode ainda devolver ID com predição Kalman (stale=False) e conf baixa;
                    # esconde overlay sem cortar a lógica de contagem em cima.
                    if _ov_min_det > 0.0:
                        _dc = conf_by_tid.get(track_id)
                        if _dc is None or float(_dc) < _ov_min_det:
                            continue
                    if _ov_min_v > 0.0:
                        _oc = cls_by_tid.get(track_id)
                        if _oc is None:
                            _oc = last_yolo_cls_by_tid.get(track_id, _default_det_cls)
                        if int(_oc) != int(person_class_id):
                            _dcv = conf_by_tid.get(track_id)
                            if _dcv is None or float(_dcv) < _ov_min_v:
                                continue
                    if track_id in raw_foot_by_id:
                        fcx, fcy = raw_foot_by_id[track_id]
                    else:
                        fcx = int(round((xa + xb) / 2.0))
                        fcy = int(yb)

                    _cls_prev = last_yolo_cls_by_tid.get(track_id)
                    if _cls_prev is None:
                        _cls_prev = cls_by_tid.get(track_id, _default_det_cls)
                    det_cls = int(_cls_prev)
                    cls_tag = short_class_tag(names, det_cls) if isinstance(names, dict) else "?"
                    is_person = det_cls == person_class_id
                    if _ov_v_wmin > 0.0 and not is_person:
                        _bw = max(0.0, float(xb) - float(xa))
                        if _bw < _ov_v_wmin * float(max(fw, 1)):
                            continue
                    if _ov_v_edge > 0.0 and not is_person:
                        _fwf = float(max(fw, 1))
                        _mx = _ov_v_edge * _fwf
                        _xa_f, _xb_f = float(xa), float(xb)
                        _bwv = max(0.0, _xb_f - _xa_f)
                        _cxn = (_xa_f + _xb_f) * 0.5 / _fwf
                        _in_margin_center = _cxn < _ov_v_edge or _cxn > (
                            1.0 - _ov_v_edge
                        )
                        _frac_in_margin = 0.0
                        if _bwv > 1e-6:
                            _lo = max(0.0, min(_xb_f, _mx) - max(_xa_f, 0.0))
                            _ro = max(
                                0.0,
                                min(_xb_f, _fwf) - max(_xa_f, _fwf - _mx),
                            )
                            _frac_in_margin = min(1.0, (_lo + _ro) / _bwv)
                        if _ov_v_edge_cover <= 0.0:
                            if _in_margin_center:
                                continue
                        elif (
                            _frac_in_margin >= _ov_v_edge_cover
                            or _in_margin_center
                        ):
                            continue
                    if _ov_p_edge > 0.0 and is_person:
                        _fwfp = float(max(fw, 1))
                        _mxp = _ov_p_edge * _fwfp
                        _xap, _xbp = float(xa), float(xb)
                        _bwp = max(0.0, _xbp - _xap)
                        _cxp = (_xap + _xbp) * 0.5 / _fwfp
                        _in_p_margin_center = _cxp < _ov_p_edge or _cxp > (
                            1.0 - _ov_p_edge
                        )
                        _frac_p_margin = 0.0
                        if _bwp > 1e-6:
                            _lop = max(0.0, min(_xbp, _mxp) - max(_xap, 0.0))
                            _rop = max(
                                0.0,
                                min(_xbp, _fwfp) - max(_xap, _fwfp - _mxp),
                            )
                            _frac_p_margin = min(1.0, (_lop + _rop) / _bwp)
                        if _ov_p_edge_cover <= 0.0:
                            if _in_p_margin_center:
                                continue
                        elif (
                            _frac_p_margin >= _ov_p_edge_cover
                            or _in_p_margin_center
                        ):
                            continue
                    if _ov_p_hmin > 0.0 and is_person:
                        _bh = max(0.0, float(yb) - float(ya))
                        if _bh < _ov_p_hmin * float(max(fh, 1)):
                            continue
                    if (
                        _ov_p_glare_z > 0.0
                        and _ov_p_glare_min > 0.0
                        and is_person
                    ):
                        _gz_lo = _ov_p_glare_z
                        _gz_hi = 1.0 - _ov_p_glare_z
                        _cxg = (float(xa) + float(xb)) * 0.5 / float(max(fw, 1))
                        _cyg = (float(ya) + float(yb)) * 0.5 / float(max(fh, 1))
                        if _gz_lo < _cxg < _gz_hi and _gz_lo < _cyg < _gz_hi:
                            _dgl = conf_by_tid.get(track_id)
                            if _dgl is None or float(_dgl) < _ov_p_glare_min:
                                continue
                    _vehicle_alert_eligible = (
                        (not is_person)
                        and det_cls in _active_classes
                        and det_cls in count_class_ids
                    )

                    # ── Estado de movimento (usa frame anterior) ──────────
                    is_loiter = track_id in _loitering_ids
                    is_static = track_id in _stationary_ids

                    sex_bucket: str | None = None
                    if (
                        show_sex_ui
                        and sex_clf is not None
                        and sex_clf.enabled
                        and det_cls == person_class_id
                    ):
                        if _frames_received % _sex_ui_stride == 0:
                            raw_sx = sex_clf.classify_crop(
                                frame, (float(xa), float(ya), float(xb), float(yb))
                            )
                            sex_bucket = (
                                sex_smoother.update(track_id, raw_sx)
                                if sex_smoother is not None
                                else raw_sx
                            )
                        elif sex_smoother is not None:
                            _lb = sex_smoother.last(track_id)
                            sex_bucket = _lb if _lb != "unknown" else None

                    if (
                        is_person
                        and person_class_id in _active_classes
                        and cap_detector is not None
                        and cap_detector.enabled
                    ):
                        cap_res = cap_detector.classify(
                            frame,
                            (float(xa), float(ya), float(xb), float(yb)),
                            track_id,
                        )
                        if cap_res is not None and cap_res.has_cap:
                            alert_mgr.maybe_fire(
                                kind="cap",
                                track_id=int(track_id),
                                label=f"Pessoa com bone (#{track_id}, {cap_res.prob*100:.0f}%)",
                                detail={"prob": cap_res.prob},
                            )
                    elif (
                        _vehicle_alert_eligible
                        and not _all_vehicles_mode
                        and shared.alert_car_color_clf is not None
                        and shared.alert_car_color_clf.enabled
                    ):
                        col_res = shared.alert_car_color_clf.classify(
                            frame,
                            (float(xa), float(ya), float(xb), float(yb)),
                            track_id,
                        )
                        if shared.alert_car_color_clf.matches_target(col_res) and col_res is not None:
                            alert_mgr.maybe_fire(
                                kind="car_color",
                                track_id=int(track_id),
                                label=f"Carro {col_res.name} (#{track_id})",
                                detail={"color": col_res.name, "score": col_res.score},
                            )

                    # ── Cor base pelo lado da linha ───────────────────────
                    side_v = last_side_by_id.get(track_id) if count_mode == "line" else None
                    if count_mode == "line" and side_v is not None:
                        if side_v < 0:
                            base_mv = _C_CYAN
                            base_mv_dim = _C_CYAN_DIM
                            side_tag = "A"
                        elif side_v > 0:
                            base_mv = _C_GREEN
                            base_mv_dim = _C_GREEN_DIM
                            side_tag = "B"
                        else:
                            base_mv = _C_GRAY
                            base_mv_dim = _C_GRAY_DIM
                            side_tag = "|"
                        label = f"{cls_tag}{track_id}{side_tag}" + ("~" if stale else "")
                    else:
                        base_mv = _C_CYAN
                        base_mv_dim = _C_CYAN_DIM
                        side_tag = ""
                        label = f"{cls_tag}{track_id}" + ("~" if stale else "")

                    # Veículos: cor laranja distinta — substitui cores de lado de linha
                    if not is_person:
                        base_mv = _C_VEHICLE
                        base_mv_dim = _C_VEHICLE_DIM

                    # ── Cor final: loitering > parado > sexo (classify) > lado linha ───────────
                    if is_loiter:
                        color = _C_RED_DIM if stale else _C_RED
                        label = f"{cls_tag}{track_id}!" + ("~" if stale else "")
                    elif is_static:
                        color = _C_AMBER_DIM if stale else _C_AMBER
                        label = f"{cls_tag}{track_id}■" + ("~" if stale else "")
                    elif sex_bucket is not None:
                        if sex_bucket == "female":
                            color = _C_SEX_FEMALE_DIM if stale else _C_SEX_FEMALE
                            sx = "F"
                        elif sex_bucket == "male":
                            color = _C_SEX_MALE_DIM if stale else _C_SEX_MALE
                            sx = "M"
                        else:
                            color = _C_SEX_UNKNOWN_DIM if stale else _C_SEX_UNKNOWN
                            sx = "?"
                        if count_mode == "line" and side_v is not None:
                            label = f"{cls_tag}{track_id}{side_tag}{sx}" + ("~" if stale else "")
                        else:
                            label = f"{cls_tag}{track_id}{sx}" + ("~" if stale else "")
                    else:
                        color = base_mv_dim if stale else base_mv
                    if trail_max >= 2:
                        dq = foot_trail_by_id.get(track_id)
                        if dq is None:
                            dq = deque(maxlen=trail_max)
                            foot_trail_by_id[track_id] = dq
                        if not dq or dq[-1] != (fcx, fcy):
                            dq.append((fcx, fcy))
                        if show_trail_ui and len(dq) >= 2:
                            pts = np.array(list(dq), dtype=np.int32).reshape((-1, 1, 2))
                            _draw_footstep_trail(frame, pts, color)
                    _draw_corner_box(frame, xa, ya, xb, yb, color, thickness=2)
                    # Label compacto com fundo escuro semi-transparente
                    lx, ly = xa + 4, ya - 12
                    if ly < 14:
                        ly = ya + 16
                    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
                    cv2.rectangle(frame, (lx - 2, ly - th - 2), (lx + tw + 2, ly + 2),
                                  _C_BLACK, -1)
                    cv2.putText(frame, label, (lx, ly),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.42, color, 1, lineType=cv2.LINE_AA)
                    if show_heading_ui and trail_max >= 2 and show_heading_arrow:
                        dq = foot_trail_by_id.get(track_id)
                        if dq is not None and len(dq) >= args.heading_min_points:
                            hdg = predict_trail_heading_pca(
                                list(dq),
                                max_points=min(trail_max, 28),
                                min_points=args.heading_min_points,
                                min_anisotropy=args.heading_min_anisotropy,
                                min_speed=args.heading_min_speed,
                            )
                            if hdg is not None:
                                ux, uy, _conf = hdg
                                L = max(24, int(args.heading_arrow_len))
                                box_h = max(1, int(yb - ya))
                                acx = int(round((xa + xb) / 2.0))
                                off = max(8, min(28, box_h // 4))
                                acy = int(np.clip(ya + off, ya + 1, max(ya + 1, yb - 2)))
                                tx = int(round(acx + ux * L))
                                ty = int(round(acy + uy * L))
                                tx = int(np.clip(tx, 0, fw - 1))
                                ty = int(np.clip(ty, 0, fh - 1))
                                p0 = (acx, acy)
                                p1 = (tx, ty)
                                if (tx - acx) ** 2 + (ty - acy) ** 2 >= 16:
                                    _draw_heading_arrow(frame, p0, p1, color)

                if entry_boxes and result.orig_img is not None:
                    for tid_ent, box in entry_boxes:
                        if cls_by_tid.get(tid_ent, person_class_id) != person_class_id:
                            continue
                        if sex_clf and sex_clf.enabled and show_sex_ui:
                            if sex_smoother is not None:
                                bucket = sex_smoother.last(tid_ent)
                            else:
                                bucket = sex_clf.classify_crop(result.orig_img, box)
                            with shared.lock:
                                if bucket == "female":
                                    shared.sex_agg.female += 1
                                elif bucket == "male":
                                    shared.sex_agg.male += 1
                                else:
                                    shared.sex_agg.unknown += 1
                        if age_clf and age_clf.enabled:
                            ab = age_clf.classify_crop(result.orig_img, box)
                            with shared.lock:
                                if ab == "child":
                                    shared.age_agg.child += 1
                                elif ab == "adolescent":
                                    shared.age_agg.adolescent += 1
                                elif ab == "young":
                                    shared.age_agg.young += 1
                                elif ab == "adult":
                                    shared.age_agg.adult += 1
                                elif ab == "elderly":
                                    shared.age_agg.elderly += 1
                                else:
                                    shared.age_agg.unknown += 1

                if sex_smoother is not None:
                    sex_smoother.forget_stale(active_ids)
                if cap_detector is not None:
                    cap_detector.forget_stale_tracks(active_ids)
                _car_clf_live = shared.alert_car_color_clf
                if _car_clf_live is not None:
                    _car_clf_live.forget_stale_tracks(active_ids)
                alert_mgr.forget_stale_tracks(active_ids)

                moving_now = 0
                stationary_now = 0
                loitering_now = 0
                dwell_values: list[float] = []
                move_speed_samples: list[float] = []
                _speed_by_id: dict[int, float | None] = {}
                trail_eval_max = max(2, min(trail_max, 12))
                for tid in current_present_ids:
                    entered_at = zone_entered_at_by_id.get(tid, frame_ts)
                    dwell_values.append(max(0.0, frame_ts - entered_at))
                    dq = foot_trail_by_id.get(tid)
                    speed = estimate_trail_speed(list(dq), max_points=trail_eval_max) if dq is not None else None
                    _speed_by_id[tid] = speed
                    is_stationary = (
                        dq is not None
                        and len(dq) >= max(2, args.stationary_min_points)
                        and speed is not None
                        and speed <= shared.thr_stationary_max_speed
                    )
                    if is_stationary:
                        stationary_now += 1
                        _stationary_ids.add(tid)
                        stationary_since_by_id.setdefault(tid, frame_ts)
                        if frame_ts - stationary_since_by_id[tid] >= shared.thr_loitering_seconds:
                            loitering_now += 1
                            _loitering_ids.add(tid)
                    else:
                        moving_now += 1
                        stationary_since_by_id.pop(tid, None)
                        if speed is not None:
                            move_speed_samples.append(speed)

                occupancy_now = len(current_present_ids)
                avg_dwell_sec = float(sum(dwell_values) / len(dwell_values)) if dwell_values else 0.0
                max_dwell_sec = float(max(dwell_values)) if dwell_values else 0.0
                avg_move_px_frame = (
                    float(sum(move_speed_samples) / len(move_speed_samples)) if move_speed_samples else 0.0
                )
                avg_move_px_sec = avg_move_px_frame * ema_infer_fps if ema_infer_fps > 0 else 0.0

                # Velocidade média dos veículos (cls != person): usa tracks activos no overlay,
                # nao so current_present_ids (poligono pode excluir carros na estrada).
                # Limiar minimo em px/frame (default 0.12): o antigo > thr_stationary (2.2) excluia trafego lento.
                try:
                    _veh_move_min = float(
                        os.environ.get("YOLO_VEHICLE_SPEED_MIN_PX_FRAME", "0.12").strip() or "0.12"
                    )
                except ValueError:
                    _veh_move_min = 0.12
                _veh_speed_samples: list[float] = []
                for _vtid in active_ids:
                    if last_yolo_cls_by_tid.get(_vtid, person_class_id) == person_class_id:
                        continue
                    _vdq = foot_trail_by_id.get(_vtid)
                    _vspd = estimate_trail_speed(list(_vdq), max_points=trail_eval_max) if _vdq is not None else None
                    if _vspd is not None and _vspd >= _veh_move_min and _vspd <= 240.0:
                        _veh_speed_samples.append(_vspd)
                vehicle_avg_speed_px_sec = (
                    float(sum(_veh_speed_samples) / len(_veh_speed_samples)) * ema_infer_fps
                    if _veh_speed_samples and ema_infer_fps > 0
                    else 0.0
                )

                _established = sum(1 for d in dwell_values if d > 1.0)
                _track_stability = _established / max(1, len(dwell_values)) if dwell_values else 1.0
                avg_bbox_h = float(sum(_bbox_h_samples) / len(_bbox_h_samples)) if _bbox_h_samples else 0.0
                cam_conf, cam_conf_reasons = _compute_cam_confidence(
                    ema_infer_fps, blur_ema, avg_bbox_h, _track_stability, occupancy_now,
                    blur_thresh_low=shared.thr_blur_low,
                    blur_thresh_critical=shared.thr_blur_critical,
                    bbox_small_thresh_px=shared.thr_bbox_small_px,
                )
                _q = queue_detector.detect(
                    _person_pos_norm, _speed_by_id, zone_entered_at_by_id,
                    frame_ts, saturation_threshold=shared.thr_queue_saturation,
                )
                _flow_vec_counter += 1
                _drift = drift_detector.update(frame)
                _hp_refresh_after = False
                _log_drift_now = _drift.level != "ok" and _drift.score > 0.5
                if count_mode == "polygon" and poly_pts_list and named_clamped:
                    _poly_occ = [0] * len(poly_pts_list)
                    _poly_dwell_sums = [0.0] * len(poly_pts_list)
                    _poly_dwell_cnts = [0] * len(poly_pts_list)
                    for _tid in current_present_ids:
                        _pstate = prev_inside_per_poly_by_id.get(_tid, [])
                        _ept = zone_entered_per_poly_by_id.get(_tid, [])
                        for _pi in range(len(poly_pts_list)):
                            if _pi < len(_pstate) and _pstate[_pi]:
                                _poly_occ[_pi] += 1
                                if _pi < len(_ept) and _ept[_pi] is not None:
                                    _poly_dwell_sums[_pi] += max(0.0, frame_ts - _ept[_pi])
                                    _poly_dwell_cnts[_pi] += 1
                    _polygon_stats_publish: list[dict[str, Any]] = []
                    for _pi, _e in enumerate(named_clamped):
                        _title = str(_e.get("title") or "").strip() or f"Área {_pi + 1}"
                        _avg_d = _poly_dwell_sums[_pi] / _poly_dwell_cnts[_pi] if _poly_dwell_cnts[_pi] > 0 else 0.0
                        _hdx, _hdy = (
                            poly_heading_ema[_pi]
                            if _pi < len(poly_heading_ema)
                            else (0.0, 0.0)
                        )
                        _hmag = (_hdx * _hdx + _hdy * _hdy) ** 0.5
                        _hdeg = (
                            (math.degrees(math.atan2(_hdy, _hdx)) + 360.0) % 360.0
                            if _hmag > 0.35
                            else None
                        )
                        _polygon_stats_publish.append({
                            "title": _title,
                            "entries": poly_session_entries[_pi] if _pi < len(poly_session_entries) else 0,
                            "exits": poly_session_exits[_pi] if _pi < len(poly_session_exits) else 0,
                            "vehicle_entries": poly_session_vehicle_entries[_pi] if _pi < len(poly_session_vehicle_entries) else 0,
                            "vehicle_exits": poly_session_vehicle_exits[_pi] if _pi < len(poly_session_vehicle_exits) else 0,
                            "occupancy_now": _poly_occ[_pi],
                            "avg_dwell_s": round(_avg_d, 1),
                            "inverted": bool(_e.get("inverted", False)),
                            "heading_deg": (
                                round(_hdeg, 1) if _hdeg is not None else None
                            ),
                            "heading_speed_px_frame": round(_hmag, 2),
                        })
                else:
                    _polygon_stats_publish = []
                _flow_vec_payload = None
                if _flow_vec_counter >= 30:
                    _flow_vec_counter = 0
                    _flow_vec_payload = flow_grid.to_payload()
                _rs_reid = person_tracker.session_stats(current_present_ids)
                _low_conf_ct = track_conf_tracker.low_confidence_count(
                    suppress_thresh=_tp["tc_suppress"],
                    vehicle_suppress_thresh=_tp["tc_vehicle_suppress"],
                )
                with shared.lock:
                    text = f"in={shared.counter.entries} out={shared.counter.exits} total={shared.counter.total}"
                    live_text = (
                        f"presentes={occupancy_now} mov={moving_now} "
                        f"paradas={stationary_now} fila={loitering_now}"
                    )
                    shared.occupancy_now = occupancy_now
                    shared.moving_now = moving_now
                    shared.stationary_now = stationary_now
                    shared.loitering_now = loitering_now
                    shared.avg_dwell_sec = avg_dwell_sec
                    shared.max_dwell_sec = max_dwell_sec
                    shared.avg_move_speed_px_per_frame = avg_move_px_frame
                    shared.avg_move_speed_px_per_sec = avg_move_px_sec
                    shared.vehicle_avg_speed_px_per_sec = vehicle_avg_speed_px_sec
                    shared.vehicle_zone_live_payload = {"zones": vehicle_zone_tracker.get_snapshot()}
                    shared.polygon_live_stats = list(_polygon_stats_publish)
                    shared.infer_fps_ema = ema_infer_fps
                    shared.cam_confidence = cam_conf
                    shared.cam_confidence_reasons = cam_conf_reasons
                    if _q is not None:
                        shared.queue_size = _q.size
                        shared.queue_avg_wait_s = _q.avg_wait_s
                        shared.queue_saturated = _q.saturated
                        shared.queue_linearity = _q.linearity
                    else:
                        shared.queue_size = 0
                        shared.queue_avg_wait_s = 0.0
                        shared.queue_saturated = False
                        shared.queue_linearity = 0.0
                    if _flow_vec_payload is not None:
                        shared.flow_vectors_payload = _flow_vec_payload
                    shared.reid_unique_persons = _rs_reid["unique_persons"]
                    shared.reid_active_persons = _rs_reid["active_persons"]
                    shared.reid_revisited = _rs_reid["revisited_persons"]
                    shared.reid_avg_dwell_s = _rs_reid["avg_total_dwell_s"]
                    shared.low_conf_tracks = _low_conf_ct
                    shared.cam_drift_level = _drift.level
                    shared.cam_drift_score = _drift.score
                    shared.cam_drift_reason = _drift.reason
                    shared.cam_drift_baseline_ready = _drift.baseline_ready
                    shared.cam_blur_ema = blur_ema
                    shared.cam_avg_bbox_h = avg_bbox_h
                    _hm_sess_id = shared.session_id
                    _grid_live_counter += 1
                    _hotspot_payload_counter += 1
                    if _grid_live_counter >= 30:
                        _grid_live_counter = 0
                        shared.heatmap_live_payload = grid_live.to_payload()
                        shared.vehicle_heatmap_live_payload = vehicle_grid_live.to_payload()
                        _hm_cam_id = shared.active_preset_id or "default"
                        _hm_sess_id = shared.session_id
                    if _hotspot_payload_counter >= 30:
                        _hotspot_payload_counter = 0
                        shared.dwell_live_payload = dwell_grid.to_payload()
                        _hp_refresh_after = True
                if _log_drift_now:
                    with shared.lock:
                        _sid_drift_log = shared.session_id
                    audit_log.log(
                        ts=frame_ts,
                        session_id=_sid_drift_log,
                        event_type="drift_detected",
                        metadata={
                            "level": _drift.level,
                            "reason": _drift.reason,
                            "score": round(_drift.score, 3),
                        },
                    )
                if _hp_refresh_after:
                    with shared.lock:
                        _cam_hot = shared.active_preset_id or "default"
                    _zrec_h = zone_store_inf.load_zone_records(_hm_site_id, _cam_hot)
                    _masks = [
                        (z.id, rasterize_norm_polygon(z.polygon_norm))
                        for z in _zrec_h
                    ]
                    _sg = hotspot_scorer.score_grid("composite")
                    _zs = (
                        hotspot_scorer.score_zones(_masks, "composite") if _masks else []
                    )
                    _hp_payload = {**_sg, "zones": _zs}
                    with shared.lock:
                        shared.hotspots_live_payload = _hp_payload
                slot_aggregator.feed(grid_live.to_raw_array(), time.time())
                for _slot_ts, _slot_grid in slot_aggregator.pop_pending():
                    heatmap_store.write_slot(
                        site_id=_hm_site_id,
                        camera_id=_hm_cam_id,
                        session_id=_hm_sess_id,
                        slot_ts=_slot_ts,
                        raw_grid=_slot_grid,
                        grid_version=_hm_grid_version,
                    )
                _vd = grid_live.take_frame_delta()
                _dd = dwell_grid.take_frame_delta()
                hotspot_scorer.push_frame_deltas(frame_ts, _vd, _dd)
                dwell_slot_aggregator.feed(_dd, time.time())
                for _slot_ts, _dg in dwell_slot_aggregator.pop_pending():
                    dwell_store.write_dwell_slot(
                        site_id=_hm_site_id,
                        camera_id=_hm_cam_id,
                        session_id=_hm_sess_id,
                        slot_ts=_slot_ts,
                        raw_grid=_dg,
                        grid_version=_hm_grid_version,
                    )
                    for row in zone_tracker.flush_stats():
                        dwell_store.write_zone_stats_slot(
                            site_id=_hm_site_id,
                            camera_id=_hm_cam_id,
                            session_id=_hm_sess_id,
                            slot_ts=_slot_ts,
                            grid_version=_hm_grid_version,
                            zone_id=int(row["zone_id"]),
                            visits=int(row["visits"]),
                            unique_ids=int(row["unique_ids"]),
                            total_dwell_s=float(row["total_dwell_s"]),
                            avg_dwell_s=float(row["avg_dwell_s"]),
                            p95_dwell_s=float(row["p95_dwell_s"]),
                            peak_occupancy=int(row["peak_occupancy"]),
                        )
                    vehicle_zone_tracker.flush_stats()  # reset session slot; no DB persistence yet
                if count_mode == "polygon" and poly_pts_list:
                    if show_roi_ui:
                        # Pintura no piso: fill translucido sobre o frame, depois
                        # contorno fino. Evita o efeito "neon/elevado" do outline duplo.
                        overlay = frame.copy()
                        for ri, ring in enumerate(poly_pts_list):
                            bd_color = _C_AMBER if ri % 2 == 0 else _C_CYAN
                            arr = np.array(ring, dtype=np.int32).reshape(-1, 1, 2)
                            cv2.fillPoly(overlay, [arr], bd_color, lineType=cv2.LINE_AA)
                        cv2.addWeighted(overlay, 0.17, frame, 0.83, 0, frame)

                        for ri, ring in enumerate(poly_pts_list):
                            bd_color = _C_AMBER if ri % 2 == 0 else _C_CYAN
                            arr = np.array(ring, dtype=np.int32).reshape(-1, 1, 2)
                            cv2.polylines(
                                frame, [arr], isClosed=True, color=bd_color, thickness=1, lineType=cv2.LINE_AA
                            )
                            for pt in ring:
                                cv2.circle(frame, pt, 3, _C_BLACK, -1, lineType=cv2.LINE_AA)
                                cv2.circle(frame, pt, 2, bd_color, -1, lineType=cv2.LINE_AA)
                            label = (
                                (poly_titles[ri].strip() if ri < len(poly_titles) else "")
                                or f"Área {ri + 1}"
                            )[:48]
                            cx = int(sum(int(p[0]) for p in ring) / max(len(ring), 1))
                            cy = int(sum(int(p[1]) for p in ring) / max(len(ring), 1))
                            (tw, th), _ = cv2.getTextSize(
                                label, cv2.FONT_HERSHEY_SIMPLEX, 0.43, 1
                            )
                            tx, ty = max(4, cx - tw // 2), max(th + 4, cy + th // 2)
                            cv2.putText(
                                frame,
                                label,
                                (tx, ty),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.43,
                                _C_BLACK,
                                2,
                                lineType=cv2.LINE_AA,
                            )
                            cv2.putText(
                                frame,
                                label,
                                (tx, ty),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.43,
                                bd_color,
                                1,
                                lineType=cv2.LINE_AA,
                            )
                            # Seta estilizada de fluxo dentro da zona:
                            # cauda = ENTRADA (por onde as pessoas entram);
                            # ponta = SAIDA (por onde as pessoas saem).
                            if ri < len(poly_heading_ema):
                                _hx, _hy = poly_heading_ema[ri]
                                _hmag = (_hx * _hx + _hy * _hy) ** 0.5
                                if _hmag > 0.35:
                                    # Comprimento proporcional ao menor raio da zona.
                                    _xs = [int(p[0]) for p in ring]
                                    _ys = [int(p[1]) for p in ring]
                                    _zw = max(1, max(_xs) - min(_xs))
                                    _zh = max(1, max(_ys) - min(_ys))
                                    _max_len = min(_zw, _zh) * 0.32
                                    _arr_len = max(28.0, min(72.0, _max_len))
                                    _scale = _arr_len / max(1e-6, _hmag)
                                    _ex = int(round(cx + _hx * _scale * 0.55))
                                    _ey = int(round(cy + _hy * _scale * 0.55))
                                    _sx = int(round(cx - _hx * _scale * 0.45))
                                    _sy = int(round(cy - _hy * _scale * 0.45))
                                    _sx = max(2, min(fw - 3, _sx))
                                    _sy = max(2, min(fh - 3, _sy))
                                    _ex = max(2, min(fw - 3, _ex))
                                    _ey = max(2, min(fh - 3, _ey))
                                    _inv = bool(
                                        named_clamped[ri].get("inverted", False)
                                    ) if ri < len(named_clamped) else False
                                    _draw_flow_direction_arrow(
                                        frame,
                                        (_sx, _sy),
                                        (_ex, _ey),
                                        bd_color,
                                        fw, fh,
                                        inverted=_inv,
                                    )
                    _overlay_text(frame, text, live_text, fw, fh, ema_infer_fps)
                elif count_mode == "polygon":
                    cv2.putText(
                        frame,
                        "Defina poligono(s) em /roi (min. 3 pontos por area)",
                        (20, 36),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        _C_AMBER,
                        2,
                        lineType=cv2.LINE_AA,
                    )
                    _overlay_text(frame, text, live_text, fw, fh, ema_infer_fps)
                else:
                    if show_roi_ui:
                        _draw_count_line(frame, x1, y1, x2, y2)
                    _overlay_text(frame, text, live_text, fw, fh, ema_infer_fps)

                # Calcula e armazena o diff int16 (frame anotado − frame original) para a
                # thread de display suave. Isso captura TODOS os desenhos (caixas, texto, ROI)
                # e permite compô-los sobre frames brutos mais recentes a 30 fps.
                if _smooth_disp and _smooth_orig is not None and _smooth_orig.shape == frame.shape:
                    try:
                        _ov_i16 = frame.astype(np.int16) - _smooth_orig.astype(np.int16)
                        with shared.smooth_display_overlay_lock:
                            shared.smooth_display_overlay_i16 = _ov_i16
                    except Exception:
                        pass

                # Quando smooth display está activo, só a thread de display escreve em
                # last_frame_jpeg — evita tremido causado por dois fundos alternados.
                if not _smooth_disp:
                    _jq = _jpeg_quality_from_env(80)
                    ok, encoded = cv2.imencode(
                        ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), _jq]
                    )
                    if ok:
                        _publish_jpeg_frame(shared, encoded.tobytes())
            # Para a thread de display suave antes de reconectar a fonte.
            _smooth_disp_stop.set()
            if _smooth_disp_thread is not None and _smooth_disp_thread.is_alive():
                _smooth_disp_thread.join(timeout=3.0)

            _reload_params_exit = False
            with shared.lock:
                if shared.infer_params_reload:
                    shared.infer_params_reload = False
                    _reload_params_exit = True
            if _reload_params_exit:
                print(
                    "[web] Parametros de inferencia/track (.env) aplicados; stream reaberto.",
                    flush=True,
                )

            # Fim do for: se saímos sem nenhum frame e a fonte não foi trocada,
            # a URL/câmera falhou ao abrir. Registra erro e faz backoff para não
            # encher o log com "Failed to open" em loop contínuo.
            if not stop_event.is_set():
                with shared.lock:
                    _src_changed_now = shared.source_changed
                if not _src_changed_now and not _reload_params_exit and _frames_received == 0:
                    if is_skylinewebcams_webcam_page(str(raw_src)):
                        _err_msg = (
                            "Falha ao ler o stream HLS (Skyline): a pagina .html foi resolvida para m3u8, "
                            "mas nao chegou nenhum frame (token expirou, rede lenta ou FFmpeg bloqueado). "
                            "Tente: copiar o URL .m3u8 atual das DevTools (Rede); definir YOLO_STREAM_BUFFER=1; "
                            "ou aguardar — nova tentativa em 5 s. Pagina: "
                            f"{raw_src!r}"
                        )
                    elif is_skyline_hls_url(str(raw_src)):
                        _err_msg = (
                            "Falha ao ler segmentos HLS Skyline (token ?a= expira; manifesto m3u8 pode abrir mas os .ts falham). "
                            "Solucao: no preset ou YOLO_WEB_SOURCE use a pagina .html da camara "
                            "(ex.: skylinewebcams.com/.../webcam/.../nome.html), nao o link hd-auth.../live.m3u8?a=... copiado. "
                            "Defina YOLO_STREAM_BUFFER=1 no .env. Fonte actual: "
                            f"{raw_src!r}"
                        )
                    else:
                        _err_msg = (
                            f"Falha ao abrir fonte: {raw_src!r}. Verifique a URL/câmera e tente novamente."
                        )
                    print(f"[web] {_err_msg}")
                    with shared.lock:
                        shared.last_error = _err_msg
                    time.sleep(5.0)
    except Exception as exc:
        with shared.lock:
            shared.last_error = str(exc)


_ROI_PAGE_HTML = """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ROI poligonal — porta</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #111; color: #fff; }
      a { color: #6cf; }
      .video-wrap { display: inline-block; position: relative; max-width: 100%; line-height: 0; }
      #roiFeed { max-width: 100%; border-radius: 8px; border: 1px solid #444; display: block; }
      #roiCanvas { position: absolute; left: 0; top: 0; cursor: crosshair; border-radius: 8px; }
      button { padding: 8px 12px; margin: 8px 8px 0 0; }
      .hint { color: #aaa; font-size: 14px; max-width: 720px; line-height: 1.45; }
      ul { color: #bbb; }
    </style>
  </head>
  <body>
    <p><a href="/">&larr; Voltar ao dashboard</a></p>
    <h2>Modo ROI poligonal (porta)</h2>
    <p class="hint">
      Clique na imagem para marcar vertices no sentido horario ou anti-horario (minimo 3).
      A contagem considera <strong>entrada</strong> quando os pes passam de fora para dentro do poligono,
      e <strong>saida</strong> no sentido inverso. Multidao fora da zona nao entra no mapa de calor nem na logica.
    </p>
    <ul>
      <li><strong>Aplicar</strong>: envia o poligono e ativa este modo.</li>
      <li><strong>Modo linha</strong>: volta ao cruzamento de segmento (calibracao na pagina principal).</li>
    </ul>
    <p>
      <button type="button" id="btnClear">Limpar pontos</button>
      <button type="button" id="btnUndo">Desfazer ultimo</button>
      <button type="button" id="btnApply">Aplicar poligono e ativar</button>
      <button type="button" id="btnLineMode">Usar modo linha</button>
    </p>
    <p><label><input type="checkbox" id="resetOnRoi" /> Zerar contadores ao aplicar / mudar modo</label></p>
    <p id="roiStatus" style="color:#fc0;min-height:1.2em;"></p>
    <div class="video-wrap" id="wrap">
      <img id="roiFeed" src="/video_feed" alt="video" />
      <canvas id="roiCanvas"></canvas>
    </div>
    <script>
      let points = [];
      const img = document.getElementById('roiFeed');
      const canvas = document.getElementById('roiCanvas');
      function syncCanvas() {
        const w = img.clientWidth, h = img.clientHeight;
        if (w && h) { canvas.width = w; canvas.height = h; }
        draw();
      }
      function draw() {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
        const sx = canvas.width / nw, sy = canvas.height / nh;
        if (points.length === 0) return;
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        points.forEach((p, i) => {
          const x = p.x * sx, y = p.y * sy;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        if (points.length >= 3) ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = '#00ff88';
        points.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x * sx, p.y * sy, 5, 0, 6.29);
          ctx.fill();
        });
      }
      img.addEventListener('load', syncCanvas);
      function evToFrame(ev) {
        const r = img.getBoundingClientRect();
        const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
        return [
          Math.round((ev.clientX - r.left) / r.width * nw),
          Math.round((ev.clientY - r.top) / r.height * nh)
        ];
      }
      canvas.addEventListener('click', (ev) => {
        const [x, y] = evToFrame(ev);
        points.push({x, y});
        document.getElementById('roiStatus').textContent =
          points.length + ' ponto(s). Minimo 3 para aplicar.';
        draw();
      });
      window.addEventListener('resize', syncCanvas);
      setTimeout(syncCanvas, 300);
      document.getElementById('btnClear').addEventListener('click', () => {
        points = [];
        draw();
        document.getElementById('roiStatus').textContent = '';
      });
      document.getElementById('btnUndo').addEventListener('click', () => {
        points.pop();
        draw();
        document.getElementById('roiStatus').textContent = points.length + ' ponto(s).';
      });
      async function loadCfg() {
        try {
          const r = await fetch('/api/config');
          const j = await r.json();
          points = (j.polygon || []).map(p => ({x: p.x, y: p.y}));
          draw();
          document.getElementById('roiStatus').textContent =
            'Modo atual: ' + j.mode + ' (' + (j.polygon || []).length + ' vertices no servidor).';
        } catch (e) {}
      }
      document.getElementById('btnApply').addEventListener('click', async () => {
        if (points.length < 3) {
          document.getElementById('roiStatus').textContent = 'Precisa de pelo menos 3 pontos.';
          return;
        }
        const resetCounters = document.getElementById('resetOnRoi').checked;
        try {
          const r = await fetch('/api/polygon', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              points: points.map(p => ({x: p.x, y: p.y})),
              reset_counters: resetCounters
            })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || String(r.status));
          document.getElementById('roiStatus').textContent = 'Poligono aplicado. Modo ROI ativo.';
        } catch (e) {
          document.getElementById('roiStatus').textContent = 'Erro: ' + e;
        }
      });
      document.getElementById('btnLineMode').addEventListener('click', async () => {
        const resetCounters = document.getElementById('resetOnRoi').checked;
        try {
          const r = await fetch('/api/mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'line', reset_counters: resetCounters })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || String(r.status));
          document.getElementById('roiStatus').textContent = 'Modo linha ativo. Calibre o segmento na pagina principal.';
        } catch (e) {
          document.getElementById('roiStatus').textContent = 'Erro: ' + e;
        }
      });
      loadCfg();
    </script>
  </body>
</html>
"""


def _persist_config_event(shared: SharedState, event_type: str, payload: dict) -> None:
    try:
        emit_config_event(session_id=shared.session_id, event_type=event_type, payload=payload)
    except Exception as exc:
        if os.environ.get("YOLO_WEB_VERBOSE", "").strip() == "1":
            print(f"[persist] {event_type}: {exc}", flush=True)


def build_stats_payload(shared: SharedState) -> dict:
    """Mesmo conteudo que GET /api/stats (para fila Kafka / espelho)."""
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
                str(k): {"entries": shared.counter.vehicle_class_entries.get(k, 0), "exits": shared.counter.vehicle_class_exits.get(k, 0)}
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
            "show_sex_overlay": shared.show_sex_overlay
            if shared.sex_overlay_available
            else False,
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
            # Migracoes zona-zona: sum(entradas por poligono) - entradas globais.
            # Conta quantas pessoas migraram de uma zona para outra sem sair
            # da uniao (esses eventos nao aparecem no contador global).
            "polygon_migrations": max(
                0,
                sum(int(p.get("entries", 0) or 0) for p in shared.polygon_live_stats)
                - int(shared.counter.entries),
            ),
        }


def create_app(
    shared: SharedState,
    audit_log: AuditLog,
    drift_detector: CameraDriftDetector,
    analytics_worker: "AggregatorWorker | None" = None,
) -> Flask:
    app = Flask(__name__)
    CORS(
        app,
        resources={
            r"/api/*": {"origins": "*"},
            r"/video_feed": {"origins": "*"},
            r"/openapi.yaml": {"origins": "*"},
            r"/docs": {"origins": "*"},
        },
    )
    app.config["ANALYTICS_WORKER"] = analytics_worker
    app.register_blueprint(analytics_bp)
    env_file = Path(__file__).resolve().parent.parent / ".env"
    heatmap_store_api = HeatmapStore()
    dwell_store_api = DwellStore()
    zone_store_api = ZoneStore()

    @app.get("/api/settings")
    def get_settings() -> Response:
        data = snapshot_editable_env()
        model_path = str(os.environ.get("YOLO_INFER_MODEL", "") or "").strip()
        metrics = read_training_metrics_from_weights(model_path) if model_path else None
        return jsonify(
            {
                "env": data,
                "metrics": metrics,
                "editable_keys": list(EDITABLE_ENV_KEYS),
                "env_file": str(env_file),
            }
        )

    @app.post("/api/settings")
    def post_settings() -> Response:
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            return jsonify({"error": "JSON invalido"}), 400
        updates = filter_updates(body)
        if not updates:
            return jsonify({"error": "Nenhuma chave editavel reconhecida"}), 400
        if not env_file.is_file():
            return jsonify({"error": f".env nao encontrado: {env_file}"}), 404
        try:
            merge_env_file(env_file, updates)
        except OSError as exc:
            return jsonify({"error": str(exc)}), 500
        apply_settings_updates_to_environ(updates)
        _uk = frozenset(updates.keys())
        if _uk & MJPEG_SHARED_SYNC_KEYS:
            _sync_mjpeg_from_environ(shared)
        _need_restart = settings_updates_require_restart(_uk)
        _stream_reload = (not _need_restart) and settings_updates_trigger_stream_reload(_uk)
        if _stream_reload:
            with shared.lock:
                shared.infer_params_reload = True
        _persist_config_event(shared, "settings", {"updated_keys": list(updates.keys())})
        if _need_restart:
            _hint = (
                "Reinicie o servidor (bash scripts/run_web.sh) para modelo, GPU, HTTP, heatmap, "
                "filtros geometricos, fonte inicial, etc."
            )
        elif _stream_reload:
            _hint = (
                "O stream de inferencia sera reaberto em poucos segundos (conf/imgsz/track/FFmpeg); "
                "actualize o video se nao mudar sozinho."
            )
        else:
            _hint = "Valores guardados no .env e no ambiente do processo."
        return jsonify(
            {
                "ok": True,
                "updated": list(updates.keys()),
                "restart_required": _need_restart,
                "stream_reload_requested": _stream_reload,
                "hint": _hint,
            }
        )

    @app.post("/api/restart")
    def api_restart() -> Response:
        """Reinicia o processo (exit code 3 → run_web.sh reinicia automaticamente)."""
        def _do_exit() -> None:
            time.sleep(0.35)
            os._exit(3)

        threading.Thread(target=_do_exit, daemon=True).start()
        return jsonify({"ok": True})

    @app.get("/roi")
    def roi_page() -> str:
        return _ROI_PAGE_HTML

    @app.get("/")
    def index() -> str:
        return """
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>People Counter</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; background: #111; color: #fff; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
      .card { background: #1e1e1e; padding: 12px; border-radius: 8px; }
      .video-wrap { display: inline-block; position: relative; max-width: 100%; }
      #feed { max-width: 100%; border-radius: 8px; border: 1px solid #444; display: block; }
      #feed.calib-on { cursor: crosshair; outline: 2px solid #fc0; }
      button { padding: 8px 12px; margin: 8px 8px 0 0; }
      .row { margin: 10px 0; color: #ccc; font-size: 14px; }
      label { cursor: pointer; }
    </style>
  </head>
  <body>
    <h2>Contagem de Pessoas (Web)</h2>
    <p><a href="/roi" style="color:#6cf;">Modo ROI poligonal (porta)</a> — desenhe a zona no video; contagem so para quem entra/sai dessa area.</p>
    <p style="color:#aaa;font-size:14px;">Mapa de calor: intensidade agregada no solo (base do bbox), sem identidade.</p>
    <div class="grid">
      <div class="card">Entradas: <b id="entries">0</b></div>
      <div class="card">Saidas: <b id="exits">0</b></div>
      <div class="card">Total: <b id="total">0</b></div>
      <div class="card">Presentes agora: <b id="occupancyNow">0</b></div>
      <div class="card">Em movimento: <b id="movingNow">0</b></div>
      <div class="card">Paradas: <b id="stationaryNow">0</b></div>
      <div class="card">Paradas longas: <b id="loiteringNow">0</b></div>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:baseline;">
      <strong>Permanencia atual na zona:</strong>
      <span id="dwellInfo">media 0s | max 0s</span>
    </div>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:baseline;">
      <strong>Horario de pico (maior fluxo):</strong>
      <span id="peakHour">—</span>
    </div>
    <div style="font-size:12px;max-width:900px;margin:8px 0 16px 0;overflow-x:auto;">
      <table id="hourlyTable" style="border-collapse:collapse;width:100%;min-width:640px;">
        <thead><tr id="hourlyHead"></tr></thead>
        <tbody><tr id="hourlyIn"></tr><tr id="hourlyOut"></tr><tr id="hourlySum"></tr></tbody>
      </table>
    </div>
    <div id="sexPanel" style="display:none;margin:12px 0;padding:12px;background:#1a1a2e;border-radius:8px;font-size:14px;max-width:520px;">
      <p style="color:#9cf;margin:0 0 8px 0;">Entradas por classe (agregado; abstencao se confianca baixa). Ver docs/04_privacidade_etica.md.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        <span>F: <b id="sexF">0</b></span>
        <span>M: <b id="sexM">0</b></span>
        <span>Incerto: <b id="sexU">0</b></span>
      </div>
    </div>
    <div id="agePanel" style="display:none;margin:12px 0;padding:12px;background:#1a2e1a;border-radius:8px;font-size:14px;max-width:720px;">
      <p style="color:#9f9;margin:0 0 8px 0;">Entradas por faixa etaria (agregado; requer YOLO_AGE_MODEL e classes nomeadas no .pt).</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        <span>Crianca: <b id="ageChild">0</b></span>
        <span>Adolescente: <b id="ageAdolescent">0</b></span>
        <span>Jovem: <b id="ageYoung">0</b></span>
        <span>Adulto: <b id="ageAdult">0</b></span>
        <span>Idoso: <b id="ageElderly">0</b></span>
        <span>Incerto: <b id="ageUnknown">0</b></span>
      </div>
    </div>
    <div class="row">
      <strong>Modo / geometria:</strong> <span id="modeInfo">—</span>
    </div>
    <div class="row">
      <button type="button" id="btnCalib">Calibrar linha (2 cliques)</button>
      <button type="button" id="btnCancel">Cancelar calibracao</button>
      <button type="button" id="btnResetLine">Repor linha inicial (.env)</button>
    </div>
    <div class="row">
      <label><input type="checkbox" id="resetOnCalib" /> Zerar contadores ao aplicar nova linha</label>
    </div>
    <p id="calibStatus" style="color:#fc0;font-size:14px;min-height:1.2em;"></p>
    <div class="video-wrap">
      <img id="feed" src="/video_feed" alt="video" />
    </div>
    <br/>
    <button onclick="exportCsv()">Exportar CSV</button>
    <p id="status"></p>
    <script>
      let calibrating = false;
      let p1 = null;
      const feed = document.getElementById('feed');
      function frameCoords(ev) {
        const r = feed.getBoundingClientRect();
        const nw = feed.naturalWidth || feed.width;
        const nh = feed.naturalHeight || feed.height;
        const x = Math.round((ev.clientX - r.left) / r.width * nw);
        const y = Math.round((ev.clientY - r.top) / r.height * nh);
        return [x, y];
      }
      async function loadLineInfo() {
        try {
          const r = await fetch('/api/config');
          const j = await r.json();
          const L = j.line;
          let t = j.mode === 'polygon'
            ? ('poligono ' + (j.polygon || []).length + ' pontos')
            : ('linha (' + L.x1 + ',' + L.y1 + ')->(' + L.x2 + ',' + L.y2 + ')');
          document.getElementById('modeInfo').textContent = j.mode + ' | ' + t;
        } catch (e) {}
      }
      feed.addEventListener('click', async (ev) => {
        if (!calibrating) return;
        ev.preventDefault();
        const [x, y] = frameCoords(ev);
        if (!p1) {
          p1 = [x, y];
          document.getElementById('calibStatus').textContent =
            'Ponto 1 em (' + x + ',' + y + '). Clique o 2o ponto.';
          return;
        }
        const resetCounters = document.getElementById('resetOnCalib').checked;
        try {
          const r = await fetch('/api/line', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x1: p1[0], y1: p1[1], x2: x, y2: y,
              reset_counters: resetCounters
            })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || r.status);
          document.getElementById('calibStatus').textContent = 'Linha aplicada.';
          loadLineInfo();
        } catch (e) {
          document.getElementById('calibStatus').textContent = 'Erro: ' + e;
        }
        calibrating = false;
        p1 = null;
        feed.classList.remove('calib-on');
      });
      document.getElementById('btnCalib').addEventListener('click', () => {
        calibrating = true;
        p1 = null;
        feed.classList.add('calib-on');
        document.getElementById('calibStatus').textContent =
          'Clique o 1o ponto da linha no video (coordenadas alinhadas ao frame do servidor).';
      });
      document.getElementById('btnCancel').addEventListener('click', () => {
        calibrating = false;
        p1 = null;
        feed.classList.remove('calib-on');
        document.getElementById('calibStatus').textContent = '';
      });
      document.getElementById('btnResetLine').addEventListener('click', async () => {
        const resetCounters = document.getElementById('resetOnCalib').checked;
        try {
          const r = await fetch('/api/line/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reset_counters: resetCounters })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || r.status);
          document.getElementById('calibStatus').textContent = 'Linha reposta ao valor inicial.';
          loadLineInfo();
        } catch (e) {
          document.getElementById('calibStatus').textContent = 'Erro: ' + e;
        }
      });
      function buildHourlyTable(he, hx) {
        const head = document.getElementById('hourlyHead');
        const rin = document.getElementById('hourlyIn');
        const rout = document.getElementById('hourlyOut');
        const rsum = document.getElementById('hourlySum');
        head.innerHTML = '<th style="text-align:left;padding:4px 6px;">Hora</th>';
        rin.innerHTML = '<td style="padding:4px 6px;">Entr.</td>';
        rout.innerHTML = '<td style="padding:4px 6px;">Saida</td>';
        rsum.innerHTML = '<td style="padding:4px 6px;font-weight:bold;">Fluxo</td>';
        for (let h = 0; h < 24; h++) {
          const e = he[h] || 0;
          const x = hx[h] || 0;
          const s = e + x;
          head.innerHTML += '<th style="padding:2px 4px;font-size:11px;">' + h + 'h</th>';
          rin.innerHTML += '<td style="padding:2px 4px;text-align:center;">' + e + '</td>';
          rout.innerHTML += '<td style="padding:2px 4px;text-align:center;">' + x + '</td>';
          rsum.innerHTML += '<td style="padding:2px 4px;text-align:center;background:#222;">' + s + '</td>';
        }
      }
      async function refresh() {
        const r = await fetch('/api/stats');
        const j = await r.json();
        document.getElementById('entries').textContent = j.entries;
        document.getElementById('exits').textContent = j.exits;
        document.getElementById('total').textContent = j.total_passages;
        document.getElementById('occupancyNow').textContent = j.occupancy_now || 0;
        document.getElementById('movingNow').textContent = j.moving_now || 0;
        document.getElementById('stationaryNow').textContent = j.stationary_now || 0;
        const loiteringCount = j.loitering_now || 0;
        document.getElementById('loiteringNow').textContent = loiteringCount;
        document.getElementById('status').textContent = j.error ? ('Erro: ' + j.error) : 'Online';
        const avgDwell = Math.round(j.avg_dwell_sec || 0);
        const maxDwell = Math.round(j.max_dwell_sec || 0);
        const loiteringThreshold = Math.round(j.loitering_threshold_sec || 0);
        document.getElementById('dwellInfo').textContent =
          'media ' + avgDwell + 's | max ' + maxDwell + 's | alerta de parada longa: ' +
          loiteringThreshold + 's (' + loiteringCount + ' pessoa(s))';
        const he = j.hourly_entries || [];
        const hx = j.hourly_exits || [];
        buildHourlyTable(he, hx);
        const pf = j.peak_flow != null ? j.peak_flow : 0;
        const ph = j.peak_hour != null ? j.peak_hour : 0;
        document.getElementById('peakHour').textContent = pf > 0
          ? (ph + 'h–' + (ph + 1) + 'h (' + pf + ' passagens no total nessa hora)')
          : '— (ainda sem passagens nesta sessao)';
        const sp = document.getElementById('sexPanel');
        if (j.sex_classifier_enabled && j.sex_overlay_available && j.show_sex_overlay) {
          sp.style.display = 'block';
          document.getElementById('sexF').textContent = j.sex_female_agg;
          document.getElementById('sexM').textContent = j.sex_male_agg;
          document.getElementById('sexU').textContent = j.sex_unknown_agg;
        } else {
          sp.style.display = 'none';
        }
        const ap = document.getElementById('agePanel');
        if (j.age_classifier_enabled) {
          ap.style.display = 'block';
          document.getElementById('ageChild').textContent = j.age_child_agg;
          document.getElementById('ageAdolescent').textContent = j.age_adolescent_agg;
          document.getElementById('ageYoung').textContent = j.age_young_agg;
          document.getElementById('ageAdult').textContent = j.age_adult_agg;
          document.getElementById('ageElderly').textContent = j.age_elderly_agg;
          document.getElementById('ageUnknown').textContent = j.age_unknown_agg;
        } else {
          ap.style.display = 'none';
        }
      }
      async function exportCsv() {
        const r = await fetch('/api/export', {method: 'POST'});
        const j = await r.json();
        document.getElementById('status').textContent = 'CSV salvo: ' + j.csv_path;
      }
      setInterval(refresh, 1000);
      refresh();
      loadLineInfo();
    </script>
  </body>
</html>
"""

    @app.get("/api/config")
    def get_config() -> Response:
        with shared.lock:
            mode = shared.count_mode
            x1, y1, x2, y2 = shared.line_live
            d1, d2, d3, d4 = shared.line_default
            plive = copy_polygon_entries(shared.polygons_live)
            pdef_l = copy_polygon_entries(shared.polygons_default)
            poly0 = plive[0]["points"] if plive else []
            poly = [{"x": a, "y": b} for a, b in poly0]
            pdef0 = pdef_l[0]["points"] if pdef_l else []
            pdef = [{"x": a, "y": b} for a, b in pdef0]
            polys_out = [
                {
                    "title": str(e.get("title") or ""),
                    "points": [{"x": int(a), "y": int(b)} for a, b in e["points"]],
                }
                for e in plive
            ]
            polys_def_out = [
                {
                    "title": str(e.get("title") or ""),
                    "points": [{"x": int(a), "y": int(b)} for a, b in e["points"]],
                }
                for e in pdef_l
            ]
            show_trail = shared.show_trail_overlay
            show_heading = shared.show_heading_overlay
            hm_ok = shared.heatmap_available
            show_hm = shared.show_heatmap_overlay
            sex_ok = shared.sex_overlay_available
            show_sex = shared.show_sex_overlay
            show_roi = shared.show_roi_overlay
            apid = str(shared.active_preset_id or "").strip()
        return jsonify(
            {
                "mode": mode,
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "default_line": {"x1": d1, "y1": d2, "x2": d3, "y2": d4},
                "polygon": poly,
                "polygons": polys_out,
                "default_polygon": pdef,
                "default_polygons": polys_def_out,
                "show_trail": show_trail,
                "show_heading": show_heading,
                "heatmap_available": hm_ok,
                "show_heatmap": show_hm if hm_ok else False,
                "sex_overlay_available": sex_ok,
                "show_sex_overlay": show_sex if sex_ok else False,
                "show_roi": show_roi,
                "active_preset_id": apid,
            }
        )

    @app.post("/api/overlay")
    def post_overlay() -> Response:
        try:
            data = request.get_json(silent=True) or {}
            with shared.lock:
                if "show_trail" in data:
                    shared.show_trail_overlay = bool(data["show_trail"])
                if "show_heading" in data:
                    shared.show_heading_overlay = bool(data["show_heading"])
                if "show_heatmap" in data and shared.heatmap_available:
                    shared.show_heatmap_overlay = bool(data["show_heatmap"])
                if "show_sex_overlay" in data and shared.sex_overlay_available:
                    shared.show_sex_overlay = bool(data["show_sex_overlay"])
                if "show_roi" in data:
                    shared.show_roi_overlay = bool(data["show_roi"])
                st = shared.show_trail_overlay
                sh = shared.show_heading_overlay
                shm = shared.show_heatmap_overlay
                hm_ok = shared.heatmap_available
                ssx = shared.show_sex_overlay
                sex_ok = shared.sex_overlay_available
                sroi = shared.show_roi_overlay
            ev_overlay: dict = {"show_trail": st, "show_heading": sh, "show_roi": sroi}
            if hm_ok:
                ev_overlay["show_heatmap"] = shm
            if sex_ok:
                ev_overlay["show_sex_overlay"] = ssx
            _persist_config_event(shared, "overlay", ev_overlay)
            return jsonify(
                {
                    "ok": True,
                    "show_trail": st,
                    "show_heading": sh,
                    "heatmap_available": hm_ok,
                    "show_heatmap": shm if hm_ok else False,
                    "sex_overlay_available": sex_ok,
                    "show_sex_overlay": ssx if sex_ok else False,
                    "show_roi": sroi,
                }
            )
        except Exception as exc:
            print(f"[web] POST /api/overlay: {exc}", flush=True)
            return jsonify({"ok": False, "error": str(exc)}), 500

    @app.get("/api/line")
    def get_line() -> Response:
        with shared.lock:
            mode = shared.count_mode
            x1, y1, x2, y2 = shared.line_live
            d1, d2, d3, d4 = shared.line_default
            plive = copy_polygon_entries(shared.polygons_live)
            poly0 = plive[0]["points"] if plive else []
            poly = [{"x": a, "y": b} for a, b in poly0]
            polys_out = [
                {
                    "title": str(e.get("title") or ""),
                    "points": [{"x": int(a), "y": int(b)} for a, b in e["points"]],
                }
                for e in plive
            ]
        return jsonify(
            {
                "mode": mode,
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "default": {"x1": d1, "y1": d2, "x2": d3, "y2": d4},
                "polygon": poly,
                "polygons": polys_out,
            }
        )

    @app.post("/api/line")
    def post_line() -> Response:
        data = request.get_json(silent=True) or {}
        try:
            x1 = int(data["x1"])
            y1 = int(data["y1"])
            x2 = int(data["x2"])
            y2 = int(data["y2"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "JSON invalido: precisa x1,y1,x2,y2 inteiros"}), 400
        if (x1 - x2) ** 2 + (y1 - y2) ** 2 < 64:
            return jsonify({"error": "Linha muito curta: afaste os dois pontos"}), 400
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            shared.count_mode = "line"
            shared.line_live = (x1, y1, x2, y2)
            shared.polygons_live = []
            shared.polygons_default = []
            if reset_counters:
                reset_entry_exit_counters(shared)
        _persist_config_event(
            shared,
            "line",
            {
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "reset_counters": reset_counters,
                "preset_id": str(shared.active_preset_id or "").strip(),
            },
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        return jsonify({"ok": True, "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}})

    @app.post("/api/line/reset")
    def reset_line() -> Response:
        data = request.get_json(silent=True) or {}
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            shared.line_live = shared.line_default
            if reset_counters:
                reset_entry_exit_counters(shared)
        with shared.lock:
            x1, y1, x2, y2 = shared.line_live
        _persist_config_event(
            shared,
            "line_reset",
            {"reset_counters": reset_counters, "preset_id": str(shared.active_preset_id or "").strip()},
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        return jsonify({"ok": True, "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}})

    @app.get("/api/live/feet")
    def get_live_feet() -> Response:
        """Retorna a posicao dos pes (centro-baixo do bbox) das pessoas ativas
        e um rastro recente dos pes, em coords de frame (px). Usado pelo editor
        de ROI como guia visual para desenhar poligonos no chao."""
        with shared.lock:
            feet = list(shared.live_feet_px)
            trail = list(shared.recent_feet_trail_px)
            fw = int(shared.frame_w)
            fh = int(shared.frame_h)
        return jsonify({
            "feet": [{"x": int(x), "y": int(y)} for x, y in feet],
            "trail": [{"x": int(x), "y": int(y)} for x, y in trail],
            "frame_w": fw,
            "frame_h": fh,
        })

    @app.post("/api/counters/reset")
    def reset_counters_only() -> Response:
        """Zera apenas os contadores (entradas, saidas, fluxo horario, agregados
        de sexo/idade) sem alterar linha ou poligonos."""
        with shared.lock:
            reset_entry_exit_counters(shared)
            snapshot = {
                "entries": int(shared.counter.entries),
                "exits": int(shared.counter.exits),
            }
        _persist_config_event(
            shared,
            "counters_reset",
            {"preset_id": str(shared.active_preset_id or "").strip()},
        )
        return jsonify({"ok": True, **snapshot})

    @app.post("/api/polygon")
    def post_polygon() -> Response:
        data = request.get_json(silent=True) or {}
        max_rings = 16
        max_vertices = 64

        def _one_ring(raw: object) -> list[tuple[int, int]] | None:
            if not isinstance(raw, list) or len(raw) < 3:
                return None
            pts: list[tuple[int, int]] = []
            try:
                for p in raw[:max_vertices]:
                    if not isinstance(p, dict):
                        return None
                    pts.append((int(p["x"]), int(p["y"])))
            except (KeyError, TypeError, ValueError):
                return None
            return pts

        entries_out: list[dict[str, Any]] = []
        if isinstance(data.get("polygons"), list):
            for raw_item in data["polygons"][:max_rings]:
                if isinstance(raw_item, dict) and isinstance(raw_item.get("points"), list):
                    ring = _one_ring(raw_item["points"])
                    if ring is not None:
                        t = raw_item.get("title") or raw_item.get("name")
                        title = (
                            str(t).strip()[:64]
                            if isinstance(t, str) and str(t).strip()
                            else f"Área {len(entries_out) + 1}"
                        )
                        inverted = bool(raw_item.get("inverted", False))
                        entries_out.append({"title": title, "points": ring, "inverted": inverted})
                else:
                    ring = _one_ring(raw_item)
                    if ring is not None:
                        entries_out.append({"title": f"Área {len(entries_out) + 1}", "points": ring, "inverted": False})
            if not entries_out:
                return jsonify(
                    {"error": "Lista polygons: cada poligono precisa de pelo menos 3 vertices (x,y)"}
                ), 400
        else:
            raw = data.get("points")
            if not isinstance(raw, list) or len(raw) < 3:
                return jsonify({"error": "Precisa de lista points com pelo menos 3 vertices"}), 400
            if len(raw) > max_vertices:
                return jsonify({"error": f"No maximo {max_vertices} vertices por poligono"}), 400
            ring = _one_ring(raw)
            if ring is None:
                return jsonify({"error": "Cada ponto precisa x e y inteiros"}), 400
            entries_out = [{"title": "Área 1", "points": ring}]

        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            shared.polygons_live = copy_polygon_entries(entries_out)
            shared.polygons_default = copy_polygon_entries(entries_out)
            shared.count_mode = "polygon"
            if reset_counters:
                reset_entry_exit_counters(shared)
        n_v = sum(len(e["points"]) for e in entries_out)
        _persist_config_event(
            shared,
            "polygon",
            {
                "polygons": len(entries_out),
                "vertices": n_v,
                "reset_counters": reset_counters,
                "preset_id": str(shared.active_preset_id or "").strip(),
            },
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        polys_json = [
            {
                "title": str(e.get("title") or ""),
                "points": [{"x": a, "y": b} for a, b in e["points"]],
                "inverted": bool(e.get("inverted", False)),
            }
            for e in entries_out
        ]
        poly0 = polys_json[0]["points"] if polys_json else []
        return jsonify({"ok": True, "polygon": poly0, "polygons": polys_json, "mode": "polygon"})

    @app.post("/api/polygon/reset")
    def reset_polygon() -> Response:
        data = request.get_json(silent=True) or {}
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            shared.polygons_live = copy_polygon_entries(shared.polygons_default)
            shared.count_mode = "line"
            if reset_counters:
                reset_entry_exit_counters(shared)
        with shared.lock:
            plive = copy_polygon_entries(shared.polygons_live)
            poly0 = plive[0]["points"] if plive else []
            poly = [{"x": a, "y": b} for a, b in poly0]
            polys_out = [
                {
                    "title": str(e.get("title") or ""),
                    "points": [{"x": int(a), "y": int(b)} for a, b in e["points"]],
                }
                for e in plive
            ]
        _persist_config_event(
            shared,
            "polygon_reset",
            {"reset_counters": reset_counters, "preset_id": str(shared.active_preset_id or "").strip()},
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        return jsonify({"ok": True, "polygon": poly, "polygons": polys_out, "mode": "line"})

    @app.post("/api/mode")
    def post_mode() -> Response:
        data = request.get_json(silent=True) or {}
        m = data.get("mode", "")
        if m not in ("line", "polygon"):
            return jsonify({"error": "mode deve ser 'line' ou 'polygon'"}), 400
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            poly_ok = any(len(e.get("points") or ()) >= 3 for e in shared.polygons_live)
        if m == "polygon" and not poly_ok:
            return jsonify(
                {"error": "Poligono incompleto: use POST /api/polygon com minimo 3 pontos por area"}
            ), 400
        with shared.lock:
            shared.count_mode = m
            if reset_counters:
                reset_entry_exit_counters(shared)
        _persist_config_event(
            shared,
            "mode",
            {
                "mode": m,
                "reset_counters": reset_counters,
                "preset_id": str(shared.active_preset_id or "").strip(),
            },
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        return jsonify({"ok": True, "mode": m})

    @app.get("/api/source")
    def get_source() -> Response:
        with shared.lock:
            return jsonify({
                "source": shared.source_live,
                "changing": shared.source_changed,
                "active_preset_id": shared.active_preset_id,
                "presets": list(shared.source_presets),
            })

    @app.get("/api/source/hls")
    def get_source_hls() -> Response:
        with shared.lock:
            raw_source = str(shared.source_live or "").strip()
            changing = bool(shared.source_changed)
            active_preset_id = str(shared.active_preset_id or "").strip()
        if not raw_source:
            return jsonify({"error": "source vazio"}), 404
        if raw_source.isdigit():
            return jsonify(
                {
                    "error": "Fonte local por indice (webcam) nao fornece URL HLS para player web.",
                    "source": raw_source,
                }
            ), 400
        try:
            resolved = resolve_stream_source(raw_source)
        except Exception as exc:
            return jsonify(
                {
                    "error": f"Falha ao resolver fonte HLS: {exc}",
                    "source": raw_source,
                }
            ), 502
        low = resolved.strip().lower()
        if not (low.startswith("http://") or low.startswith("https://")):
            return jsonify(
                {
                    "error": "Fonte resolvida nao e URL HTTP(s).",
                    "source": raw_source,
                    "resolved": resolved,
                }
            ), 400
        if ".m3u8" not in low:
            return jsonify(
                {
                    "error": "Fonte resolvida nao parece HLS (.m3u8).",
                    "source": raw_source,
                    "resolved": resolved,
                }
            ), 400
        return jsonify(
            {
                "ok": True,
                "source": raw_source,
                "url": resolved,
                "changing": changing,
                "active_preset_id": active_preset_id,
            }
        )

    @app.post("/api/source")
    def post_source() -> Response:
        data = request.get_json(silent=True) or {}
        new_src = str(data.get("source", "")).strip()
        if not new_src:
            return jsonify({"error": "source vazio"}), 400
        if len(new_src) > 4096:
            return jsonify({"error": "source demasiado longo"}), 400
        if _is_youtube_page_url(new_src):
            return jsonify(_youtube_source_error_payload()), 400
        with shared.lock:
            old_pid = str(shared.active_preset_id or "").strip()
            presets = list(shared.source_presets)
        _save_calibration_for_preset(shared, old_pid)
        new_pid = _preset_id_for_url(presets, new_src)
        with shared.lock:
            shared.source_live = new_src
            shared.source_changed = True
            shared.active_preset_id = new_pid
            reset_entry_exit_counters(shared)
            presets = list(shared.source_presets)
            apid = shared.active_preset_id
        _load_calibration_for_preset(shared, apid)
        print(f"[web] Fonte de video alterada para: {new_src!r}")
        _persist_config_event(shared, "source", {"source_len": len(new_src)})
        return jsonify({"ok": True, "source": new_src, "active_preset_id": apid, "presets": presets})

    @app.post("/api/source/presets")
    def post_source_preset() -> Response:
        data = request.get_json(silent=True) or {}
        url = str(data.get("url", "")).strip()
        if not url or len(url) > 4096:
            return jsonify({"error": "url invalido"}), 400
        if _is_youtube_page_url(url):
            return jsonify(_youtube_source_error_payload()), 400
        label = str(data.get("label", "") or "").strip()[:128] or "Câmera"
        with shared.lock:
            if len(shared.source_presets) >= _MAX_SOURCE_PRESETS:
                return jsonify({"error": f"No maximo {_MAX_SOURCE_PRESETS} câmaras"}), 400
            pid = uuid.uuid4().hex[:12]
            shared.source_presets.append({"id": pid, "label": label, "url": url})
            presets = list(shared.source_presets)
        _save_source_presets_to_file(presets)
        _persist_config_event(shared, "preset_add", {"id": pid, "label": label})
        return jsonify({"ok": True, "preset": {"id": pid, "label": label, "url": url}, "presets": presets})

    @app.delete("/api/source/presets/<preset_id>")
    def delete_source_preset(preset_id: str) -> Response:
        with shared.lock:
            shared.source_presets = [p for p in shared.source_presets if p.get("id") != preset_id]
            if shared.active_preset_id == preset_id:
                shared.active_preset_id = ""
            presets = list(shared.source_presets)
        cam_cal.delete(cam_cal.site_id(), preset_id)
        _save_source_presets_to_file(presets)
        _persist_config_event(shared, "preset_delete", {"preset_id": preset_id})
        return jsonify({"ok": True, "presets": presets})

    @app.put("/api/source/presets/<preset_id>")
    def put_source_preset(preset_id: str) -> Response:
        data = request.get_json(silent=True) or {}
        new_url = str(data.get("url", "")).strip()
        new_label = str(data.get("label", "") or "").strip()[:128]
        if not new_url or len(new_url) > 4096:
            return jsonify({"error": "url invalido"}), 400
        if _is_youtube_page_url(new_url):
            return jsonify(_youtube_source_error_payload()), 400
        with shared.lock:
            found = False
            for p in shared.source_presets:
                if str(p.get("id", "")) == preset_id:
                    p["url"] = new_url
                    if new_label:
                        p["label"] = new_label
                    found = True
                    # Se o preset editado e o activo, actualiza tambem a fonte viva.
                    if shared.active_preset_id == preset_id:
                        shared.source_live = new_url
                        shared.source_changed = True
                    break
            if not found:
                return jsonify({"error": "Preset nao encontrado"}), 404
            presets = list(shared.source_presets)
            apid = shared.active_preset_id
        _save_source_presets_to_file(presets)
        _persist_config_event(shared, "preset_update", {"preset_id": preset_id})
        return jsonify(
            {"ok": True, "preset_id": preset_id, "active_preset_id": apid, "presets": presets}
        )

    @app.post("/api/source/select")
    def post_source_select() -> Response:
        data = request.get_json(silent=True) or {}
        preset_id = str(data.get("preset_id", "")).strip()
        if not preset_id:
            return jsonify({"error": "preset_id obrigatorio"}), 400
        with shared.lock:
            old_pid = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, old_pid)
        with shared.lock:
            url = ""
            for p in shared.source_presets:
                if p.get("id") == preset_id:
                    url = str(p.get("url", "")).strip()
                    break
            if not url:
                return jsonify({"error": "Preset nao encontrado"}), 404
            if _is_youtube_page_url(url):
                return jsonify(_youtube_source_error_payload()), 400
            shared.source_live = url
            shared.source_changed = True
            shared.active_preset_id = preset_id
            reset_entry_exit_counters(shared)
            presets = list(shared.source_presets)
        _load_calibration_for_preset(shared, preset_id)
        print(f"[web] Fonte (preset {preset_id}) alterada para: {url!r}")
        _persist_config_event(shared, "source_select", {"preset_id": preset_id})
        return jsonify(
            {"ok": True, "source": url, "active_preset_id": preset_id, "presets": presets}
        )

    @app.get("/api/stats")
    def stats() -> Response:
        return jsonify(build_stats_payload(shared))

    @app.post("/api/tracking/mode")
    def tracking_mode_post() -> Response:
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            return jsonify({"error": "JSON invalido"}), 400

        if "class_ids" in body:
            raw = body.get("class_ids")
            if not isinstance(raw, list) or not raw:
                return jsonify({"error": "class_ids deve ser uma lista nao vazia"}), 400
            try:
                want = [int(x) for x in raw]
            except (TypeError, ValueError):
                return jsonify({"error": "class_ids deve conter inteiros"}), 400
            with shared.lock:
                allowed = set(shared.yolo_count_class_ids)
                if not all(c in allowed for c in want):
                    return jsonify(
                        {"error": "class_ids contem ID nao permitido (use classes do COUNT_CLASS_IDS)"}
                    ), 400
                shared.track_active_class_ids = sorted(set(want))
                _sync_track_flags_from_active(
                    shared, list(shared.yolo_count_class_ids), int(shared.yolo_person_class_id)
                )
                shared.track_classes_changed = True
                tp = shared.track_person_enabled
                tv = shared.track_vehicle_enabled
                active = list(shared.track_active_class_ids)
        else:
            legacy_only_v = "track_vehicles" in body and "track_people" not in body
            has_field = legacy_only_v or "track_people" in body or "track_vehicles" in body
            if not has_field:
                return jsonify({"error": "Envie class_ids ou track_people e/ou track_vehicles"}), 400
            with shared.lock:
                multi = len(shared.yolo_count_class_ids) > 1
                count_class_ids = list(shared.yolo_count_class_ids)
                person_class_id = int(shared.yolo_person_class_id)
                if legacy_only_v:
                    want_v = bool(body.get("track_vehicles"))
                    shared.track_person_enabled = True
                    shared.track_vehicle_enabled = want_v if multi else False
                else:
                    if "track_people" in body:
                        shared.track_person_enabled = bool(body.get("track_people"))
                    if "track_vehicles" in body:
                        if not multi and bool(body.get("track_vehicles")):
                            return jsonify(
                                {
                                    "error": (
                                        "O modelo so tem uma classe YOLO; nao ha veiculos para rastrear."
                                    ),
                                    "vehicle_tracking_available": False,
                                }
                            ), 400
                        shared.track_vehicle_enabled = bool(body.get("track_vehicles")) if multi else False
                _rebuild_active_from_flags(shared, count_class_ids, person_class_id)
                if not shared.track_person_enabled and not shared.track_vehicle_enabled:
                    return jsonify(
                        {
                            "error": "Ative pelo menos uma classe (pessoas e/ou veiculos).",
                        }
                    ), 400
                shared.track_classes_changed = True
                tp = shared.track_person_enabled
                tv = shared.track_vehicle_enabled
                active = list(shared.track_active_class_ids)
        _persist_config_event(
            shared,
            "tracking_mode",
            {"track_people": tp, "track_vehicles": tv, "track_active_class_ids": active},
        )
        return jsonify(
            {
                "ok": True,
                "track_people": tp,
                "track_vehicles": tv,
                "track_active_class_ids": active,
            }
        )

    @app.get("/api/insights/flow")
    def flow_insights() -> Response:
        from datetime import datetime as _dt

        from flow_insights import compute_flow_insights_payload

        with shared.lock:
            payload = compute_flow_insights_payload(
                hourly_entries=list(shared.hourly_entries),
                hourly_exits=list(shared.hourly_exits),
                entries=shared.counter.entries,
                exits=shared.counter.exits,
                occupancy_now=shared.occupancy_now,
                queue_size=shared.queue_size,
                queue_saturated=shared.queue_saturated,
                queue_avg_wait_s=shared.queue_avg_wait_s,
                loitering_now=shared.loitering_now,
                started_at=shared.started_at,
                now=_dt.now(),
            )
        return jsonify(payload)

    @app.get("/api/heatmap/live")
    def heatmap_live() -> Response:
        with shared.lock:
            payload = shared.heatmap_live_payload
        return jsonify(payload)

    @app.get("/api/heatmap/vehicles/live")
    def heatmap_vehicles_live() -> Response:
        with shared.lock:
            payload = shared.vehicle_heatmap_live_payload
        return jsonify(payload)

    @app.get("/api/heatmap/historical")
    def heatmap_historical() -> Response:
        """Retorna heatmap agregado para um período.
        ?period=session|1h|today  (padrão: session)
        """
        from datetime import datetime as _dt

        period = request.args.get("period", "session")
        now = time.time()

        if period == "1h":
            from_ts = now - 3600.0
        elif period == "today":
            today_midnight = _dt.now().replace(hour=0, minute=0, second=0, microsecond=0)
            from_ts = today_midnight.timestamp()
        else:  # session
            with shared.lock:
                from_ts = shared.started_at.timestamp()

        with shared.lock:
            cam_id = shared.active_preset_id or "default"

        payload = heatmap_store_api.query_historical(
            site_id=cam_cal.site_id(),
            camera_id=cam_id,
            from_ts=from_ts,
            to_ts=now,
        )
        payload["period"] = period
        payload["from_ts"] = int(from_ts)
        payload["to_ts"] = int(now)
        return jsonify(payload)

    @app.get("/api/heatmap/diff")
    def heatmap_diff() -> Response:
        """Compara dois períodos.
        ?period=1h&baseline=today  (padrão)
        Suporta: period=[session|1h|today], baseline=[1h|today]
        """
        from datetime import datetime as _dt
        period   = request.args.get("period",   "1h")
        baseline = request.args.get("baseline", "today")
        now = time.time()
        day_start = float(_dt.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())

        def _resolve_from(label: str) -> float:
            if label == "1h":
                return now - 3600
            if label == "today":
                return day_start
            if label == "session":
                with shared.lock:
                    return shared.started_at.timestamp()
            return now - 3600

        period_from   = _resolve_from(period)
        baseline_from = _resolve_from(baseline)

        with shared.lock:
            cam_id = shared.active_preset_id or "default"

        payload = heatmap_store_api.query_diff(
            site_id=cam_cal.site_id(),
            camera_id=cam_id,
            period_from=period_from,
            period_to=now,
            baseline_from=baseline_from,
            baseline_to=now,
        )
        payload["period_label"]   = period
        payload["baseline_label"] = baseline
        return jsonify(payload)

    @app.get("/api/heatmap/replay")
    def heatmap_replay() -> Response:
        """Retorna slots individuais para animação/replay.
        ?period=today  (padrão) | session | 1h
        ?max_slots=48
        """
        from datetime import datetime as _dt
        period    = request.args.get("period", "today")
        max_slots = min(96, max(1, int(request.args.get("max_slots", "48"))))
        now = time.time()
        day_start = float(_dt.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())

        if period == "today":
            from_ts = day_start
        elif period == "1h":
            from_ts = now - 3600
        else:  # session
            with shared.lock:
                from_ts = shared.started_at.timestamp()

        with shared.lock:
            cam_id = shared.active_preset_id or "default"

        raw_slots = heatmap_store_api.query_slots_raw(
            site_id=cam_cal.site_id(),
            camera_id=cam_id,
            from_ts=from_ts,
            to_ts=now,
            max_slots=max_slots,
        )

        if not raw_slots:
            return jsonify({"grid_w": 32, "grid_h": 18, "slots": []})

        gw = raw_slots[0][1].shape[1]
        gh = raw_slots[0][1].shape[0]
        slots_out = []
        for slot_ts, arr in raw_slots:
            max_v = float(arr.max())
            cells = (arr / max_v).tolist() if max_v > 1e-9 else []
            label = _dt.fromtimestamp(slot_ts).strftime("%H:%M")
            slots_out.append({
                "ts": slot_ts,
                "label": label,
                "cells": cells,
                "total_events": int(arr.sum()),
            })

        return jsonify({"grid_w": gw, "grid_h": gh, "slots": slots_out})

    @app.get("/api/flow/vectors")
    def flow_vectors() -> Response:
        with shared.lock:
            payload = shared.flow_vectors_payload
        return jsonify(payload)

    # ── Environment profiles ─────────────────────────────────────────────────

    @app.get("/api/profiles")
    def get_profiles() -> Response:
        with shared.lock:
            active = shared.active_env_profile
        profiles = _list_env_profiles()  # already includes is_builtin flag
        return jsonify({"profiles": profiles, "active": active})

    @app.post("/api/profiles/<profile_id>/apply")
    def apply_profile(profile_id: str) -> Response:
        profile = get_profile(profile_id)
        if profile is None:
            return jsonify({"error": f"Profile '{profile_id}' not found"}), 404
        with shared.lock:
            shared.thr_loitering_seconds = profile.loitering_seconds
            shared.loitering_threshold_sec = profile.loitering_seconds
            shared.thr_stationary_max_speed = profile.stationary_max_speed
            shared.thr_queue_saturation = profile.queue_saturation
            shared.thr_density_alert = profile.density_alert_threshold
            shared.thr_blur_low = profile.blur_thresh_low
            shared.thr_blur_critical = profile.blur_thresh_critical
            shared.thr_bbox_small_px = profile.bbox_small_thresh_px
            shared.thr_reid_radius_norm = profile.reid_radius_norm
            shared.thr_reid_timeout_s = profile.reid_timeout_s
            shared.active_env_profile = profile_id
        _persist_config_event(shared, "profile_applied", {"profile_id": profile_id})
        return jsonify({"ok": True, "applied": profile_id, "profile": profile.to_dict()})

    @app.post("/api/profiles/save")
    def save_profile() -> Response:
        data = request.get_json(force=True, silent=True) or {}
        try:
            profile = _EnvProfile(
                id=str(data.get("id", "")),
                label=str(data.get("label", "Personalizado")),
                description=str(data.get("description", "")),
                icon=str(data.get("icon", "📷")),
                loitering_seconds=float(data.get("loitering_seconds", 10.0)),
                stationary_max_speed=float(data.get("stationary_max_speed", 2.2)),
                queue_saturation=int(data.get("queue_saturation", 8)),
                density_alert_threshold=int(data.get("density_alert_threshold", 0)),
                blur_thresh_low=float(data.get("blur_thresh_low", 60.0)),
                blur_thresh_critical=float(data.get("blur_thresh_critical", 20.0)),
                bbox_small_thresh_px=float(data.get("bbox_small_thresh_px", 40.0)),
                reid_radius_norm=float(data.get("reid_radius_norm", 0.18)),
                reid_timeout_s=float(data.get("reid_timeout_s", 20.0)),
                notes=[str(n) for n in data.get("notes", []) if n],
            )
        except (TypeError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400
        saved = _save_custom_profile(profile)
        return jsonify({"ok": True, "profile": {**saved.to_dict(), "is_builtin": False}})

    @app.delete("/api/profiles/<profile_id>")
    def delete_profile(profile_id: str) -> Response:
        if is_builtin_profile(profile_id):
            return jsonify({"error": "Cannot delete built-in profiles"}), 403
        ok = _delete_custom_profile(profile_id)
        if not ok:
            return jsonify({"error": f"Profile '{profile_id}' not found"}), 404
        with shared.lock:
            if shared.active_env_profile == profile_id:
                shared.active_env_profile = ""
        return jsonify({"ok": True, "deleted": profile_id})

    @app.post("/api/profiles/reset")
    def reset_profile() -> Response:
        with shared.lock:
            shared.thr_loitering_seconds = 10.0
            shared.loitering_threshold_sec = 10.0
            shared.thr_stationary_max_speed = 2.2
            shared.thr_queue_saturation = 8
            shared.thr_density_alert = 0
            shared.thr_blur_low = 60.0
            shared.thr_blur_critical = 20.0
            shared.thr_bbox_small_px = 40.0
            shared.thr_reid_radius_norm = 0.18
            shared.thr_reid_timeout_s = 20.0
            shared.active_env_profile = ""
        return jsonify({"ok": True, "active": ""})

    @app.get("/api/profiles/suggest")
    def suggest_profile() -> Response:
        with shared.lock:
            blur = shared.cam_blur_ema
            avg_bbox_h = shared.cam_avg_bbox_h
            avg_dwell = shared.avg_dwell_sec
            avg_speed = shared.avg_move_speed_px_per_sec
            occupancy = shared.occupancy_now

        scores: dict[str, float] = {pid: 0.0 for pid in PROFILES}
        reasoning: list[str] = []
        has_signal = False

        if blur > 0:
            has_signal = True
            if blur < 25:
                scores["estacionamento"] += 3.0
                scores["praca_aberta"] += 1.5
                reasoning.append(f"Imagem muito desfocada (blur={blur:.0f}) → câmera de baixa qualidade")
            elif blur < 50:
                scores["estacionamento"] += 1.5
                scores["praca_aberta"] += 1.0
                reasoning.append(f"Qualidade de imagem moderada (blur={blur:.0f})")
            elif blur > 120:
                scores["portaria"] += 1.5
                scores["loja"] += 1.0
                reasoning.append(f"Imagem muito nítida (blur={blur:.0f}) → câmera próxima")

        if avg_bbox_h > 0:
            has_signal = True
            if avg_bbox_h < 30:
                scores["praca_aberta"] += 2.5
                scores["estacionamento"] += 1.5
                reasoning.append(f"Pessoas pequenas no frame (h médio={avg_bbox_h:.0f}px) → câmera alta ou distante")
            elif avg_bbox_h < 50:
                scores["praca_aberta"] += 1.0
                reasoning.append(f"Pessoas de tamanho médio (h médio={avg_bbox_h:.0f}px)")
            elif avg_bbox_h > 90:
                scores["portaria"] += 2.5
                scores["loja"] += 1.0
                reasoning.append(f"Pessoas grandes no frame (h médio={avg_bbox_h:.0f}px) → câmera próxima")

        if avg_dwell > 0:
            has_signal = True
            if avg_dwell > 90:
                scores["loja"] += 3.0
                scores["estacionamento"] += 0.5
                reasoning.append(f"Permanência longa (dwell médio={avg_dwell:.0f}s) → ambiente de permanência")
            elif avg_dwell > 40:
                scores["loja"] += 1.5
                reasoning.append(f"Permanência moderada (dwell médio={avg_dwell:.0f}s)")
            elif avg_dwell < 12:
                scores["corredor"] += 2.0
                scores["portaria"] += 1.5
                reasoning.append(f"Trânsito rápido (dwell médio={avg_dwell:.0f}s) → fluxo de passagem")

        if avg_speed > 0:
            has_signal = True
            if avg_speed > 25:
                scores["corredor"] += 2.5
                reasoning.append(f"Movimento rápido (vel. média={avg_speed:.0f}px/s) → corredor ou área de passagem")
            elif avg_speed > 12:
                scores["corredor"] += 1.0
            elif avg_speed < 4:
                scores["loja"] += 0.8
                scores["portaria"] += 0.8

        if occupancy > 0:
            has_signal = True
            if occupancy >= 15:
                scores["praca_aberta"] += 1.0
                scores["loja"] += 0.5
                reasoning.append(f"Alta ocupação instantânea ({occupancy} pessoas)")
            elif occupancy <= 4:
                scores["portaria"] += 1.0
                scores["corredor"] += 0.5

        if not has_signal:
            return jsonify({
                "suggested_profile_id": "default",
                "profile": PROFILES["default"].to_dict(),
                "confidence": 0.0,
                "reasoning": ["Sem dados suficientes ainda — aguarde alguns segundos de inferência"],
                "signals": {"blur_ema": 0, "avg_bbox_h": 0, "avg_dwell_sec": 0, "avg_speed_px_s": 0, "occupancy_now": 0},
                "scores": {},
            })

        best_id = max(scores, key=lambda k: scores[k])
        best_score = scores[best_id]
        total_score = sum(scores.values()) or 1.0
        confidence = round(best_score / total_score, 2)

        if best_score < 1.0:
            best_id = "default"
            confidence = 0.0
            reasoning.append("Sinal ambíguo — recomendado perfil Padrão")

        return jsonify({
            "suggested_profile_id": best_id,
            "profile": PROFILES[best_id].to_dict(),
            "confidence": confidence,
            "reasoning": reasoning,
            "signals": {
                "blur_ema": round(blur, 1),
                "avg_bbox_h": round(avg_bbox_h, 1),
                "avg_dwell_sec": round(avg_dwell, 1),
                "avg_speed_px_s": round(avg_speed, 1),
                "occupancy_now": occupancy,
            },
            "scores": {k: round(v, 2) for k, v in scores.items()},
        })

    # ── Assisted configuration ────────────────────────────────────────────────

    @app.get("/api/suggest/line")
    def suggest_line_endpoint() -> Response:
        with shared.lock:
            vectors_payload = shared.flow_vectors_payload
            fw = shared.frame_w or 1920
            fh = shared.frame_h or 1080
        result = _suggest_line(vectors_payload, fw, fh)
        if result is None:
            return jsonify({"available": False, "reason": "Dados de fluxo insuficientes"}), 200
        return jsonify({
            "available": True,
            "line": {
                "x1": result.x1, "y1": result.y1,
                "x2": result.x2, "y2": result.y2,
            },
            "confidence": result.confidence,
            "dominant_angle_deg": result.dominant_angle_deg,
        })

    @app.get("/api/suggest/zones")
    def suggest_zones_endpoint() -> Response:
        max_zones = int(request.args.get("max_zones", 4))
        with shared.lock:
            heatmap_payload = shared.heatmap_live_payload
        zones = _suggest_zones(heatmap_payload, max_zones=min(max_zones, 6))
        return jsonify({
            "zones": [
                {"label": z.label, "x": z.x, "y": z.y, "w": z.w, "h": z.h, "density": z.density}
                for z in zones
            ]
        })

    @app.get("/api/heatmap/grid_version")
    def heatmap_grid_version() -> Response:
        with shared.lock:
            cam_id = shared.active_preset_id or "default"
        version = heatmap_store_api.get_or_create_grid_version(cam_cal.site_id(), cam_id)
        return jsonify({"camera_id": cam_id, "grid_version": version})

    @app.get("/api/dwell/live")
    def dwell_live() -> Response:
        with shared.lock:
            payload = shared.dwell_live_payload
        return jsonify(payload)

    @app.get("/api/hotspots/live")
    def hotspots_live() -> Response:
        with shared.lock:
            payload = shared.hotspots_live_payload
        return jsonify(payload)

    @app.get("/api/hotspots/historical")
    def hotspots_historical() -> Response:
        mode = request.args.get("window", "composite") or "composite"
        if mode not in ("recent", "hist", "composite"):
            mode = "composite"
        try:
            from_ts = float(request.args.get("from", "0"))
        except (TypeError, ValueError):
            from_ts = 0.0
        try:
            to_ts = float(request.args.get("to", str(time.time())))
        except (TypeError, ValueError):
            to_ts = time.time()
        with shared.lock:
            cam_id = shared.active_preset_id or "default"
        gv = heatmap_store_api.get_or_create_grid_version(cam_cal.site_id(), cam_id)
        hs = HotspotScorer(cam_cal.site_id(), cam_id, gv, heatmap_store_api, dwell_store_api)
        return jsonify(hs.score_grid(mode))

    @app.get("/api/zone-templates")
    def zone_templates_list() -> Response:
        return jsonify({"templates": zone_store_api.list_templates()})

    @app.post("/api/zone-templates")
    def zone_templates_create() -> Response:
        body = request.get_json(silent=True) or {}
        slug = str(body.get("slug", "")).strip()
        name = str(body.get("name", "")).strip()
        zones = body.get("zones")
        if not slug or not name or not isinstance(zones, list):
            return jsonify({"error": "slug, name e zones (lista) obrigatorios"}), 400
        try:
            tid = zone_store_api.create_custom_template(
                slug=slug,
                name=name,
                description=str(body.get("description", "")),
                zones=zones,
                weights=body.get("weights") if isinstance(body.get("weights"), dict) else None,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify({"ok": True, "id": tid})

    @app.get("/api/zones")
    def zones_list() -> Response:
        cam = str(request.args.get("camera_id", "")).strip() or "default"
        return jsonify({"zones": zone_store_api.list_zones(cam_cal.site_id(), cam)})

    @app.post("/api/zones")
    def zones_create() -> Response:
        body = request.get_json(silent=True) or {}
        cam = str(body.get("camera_id", "")).strip() or "default"
        name = str(body.get("name", "")).strip()
        raw_poly = body.get("polygon")
        zt = str(body.get("zone_type", "generic")).strip() or "generic"
        if not name or not isinstance(raw_poly, list):
            return jsonify({"error": "name e polygon (lista) obrigatorios"}), 400
        poly: list[tuple[float, float]] = []
        for p in raw_poly:
            if isinstance(p, dict) and "x" in p and "y" in p:
                poly.append((float(p["x"]), float(p["y"])))
            elif isinstance(p, (list, tuple)) and len(p) >= 2:
                poly.append((float(p[0]), float(p[1])))
        if len(poly) < 3:
            return jsonify({"error": "poligono invalido"}), 400
        tpl_id = body.get("template_id")
        tpl_id_i = int(tpl_id) if tpl_id is not None else None
        gv = heatmap_store_api.bump_grid_version(cam_cal.site_id(), cam, reason="zone_create")
        try:
            zid = zone_store_api.create_zone(
                site_id=cam_cal.site_id(),
                camera_id=cam,
                name=name,
                zone_type=zt,
                polygon_norm=poly,
                template_id=tpl_id_i,
                grid_version=gv,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        with shared.lock:
            shared.zones_reload_flag = True
        return jsonify({"ok": True, "id": zid, "grid_version": gv})

    @app.post("/api/zones/from-template")
    def zones_from_template() -> Response:
        body = request.get_json(silent=True) or {}
        slug = str(body.get("template_slug", "")).strip()
        cam = str(body.get("camera_id", "")).strip() or "default"
        if not slug:
            return jsonify({"error": "template_slug obrigatorio"}), 400
        try:
            ids = zone_store_api.instantiate_from_template(
                site_id=cam_cal.site_id(),
                camera_id=cam,
                template_slug=slug,
                heatmap_store=heatmap_store_api,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        with shared.lock:
            shared.zones_reload_flag = True
        gv = heatmap_store_api.get_or_create_grid_version(cam_cal.site_id(), cam)
        return jsonify({"ok": True, "zone_ids": ids, "grid_version": gv})

    @app.put("/api/zones/<int:zone_id>")
    def zones_update(zone_id: int) -> Response:
        body = request.get_json(silent=True) or {}
        cam = str(body.get("camera_id", "")).strip() or "default"
        gv = heatmap_store_api.bump_grid_version(cam_cal.site_id(), cam, reason="zone_update")
        poly = None
        if "polygon" in body:
            raw_poly = body["polygon"]
            if not isinstance(raw_poly, list):
                return jsonify({"error": "polygon invalido"}), 400
            poly = []
            for p in raw_poly:
                if isinstance(p, dict) and "x" in p and "y" in p:
                    poly.append((float(p["x"]), float(p["y"])))
                elif isinstance(p, (list, tuple)) and len(p) >= 2:
                    poly.append((float(p[0]), float(p[1])))
        ok = zone_store_api.update_zone(
            zone_id,
            name=str(body["name"]) if "name" in body else None,
            zone_type=str(body["zone_type"]) if "zone_type" in body else None,
            polygon_norm=poly,
            grid_version=gv,
        )
        if not ok:
            return jsonify({"error": "zona nao encontrada"}), 404
        with shared.lock:
            shared.zones_reload_flag = True
        return jsonify({"ok": True, "grid_version": gv})

    @app.delete("/api/zones/<int:zone_id>")
    def zones_delete(zone_id: int) -> Response:
        cam = str(request.args.get("camera_id", "")).strip() or "default"
        heatmap_store_api.bump_grid_version(cam_cal.site_id(), cam, reason="zone_delete")
        if not zone_store_api.delete_zone(zone_id):
            return jsonify({"error": "zona nao encontrada"}), 404
        with shared.lock:
            shared.zones_reload_flag = True
        return jsonify({"ok": True})

    @app.get("/api/zones/vehicles/live")
    def zones_vehicles_live() -> Response:
        with shared.lock:
            payload = dict(shared.vehicle_zone_live_payload)
            cam_id = shared.active_preset_id or "default"
        try:
            zrecs = zone_store_api.load_zone_records(cam_cal.site_id(), cam_id)
            name_map = {z.id: {"name": z.name, "zone_type": z.zone_type} for z in zrecs}
        except Exception:
            name_map = {}
        zones_out = []
        for z in payload.get("zones", []):
            zid = int(z.get("zone_id", 0))
            info = name_map.get(zid, {})
            zones_out.append({
                "id": zid,
                "name": info.get("name", f"Zona {zid}"),
                "zone_type": info.get("zone_type", "generic"),
                "occupancy_now": int(z.get("occupancy_now", 0)),
                "session_visits": int(z.get("session_visits", 0)),
            })
        return jsonify({"zones": zones_out})

    @app.get("/api/zones/<int:zone_id>/stats")
    def zones_stats(zone_id: int) -> Response:
        try:
            from_ts = float(request.args.get("from", "0"))
        except (TypeError, ValueError):
            from_ts = 0.0
        try:
            to_ts = float(request.args.get("to", str(time.time())))
        except (TypeError, ValueError):
            to_ts = time.time()
        rows = dwell_store_api.query_zone_stats(zone_id, from_ts, to_ts)
        return jsonify({"zone_id": zone_id, "slots": rows})

    @app.get("/api/alerts")
    def alerts() -> Response:
        try:
            since = int(request.args.get("since", "0"))
        except (TypeError, ValueError):
            since = 0
        mgr = shared.alert_manager
        if mgr is None:
            with shared.lock:
                _avm = shared.all_vehicles_mode
            return jsonify({
                "alerts": [],
                "latest_seq": 0,
                "cap_enabled": False,
                "car_colors": [],
                "cooldown_seconds": 0.0,
                "all_vehicles_mode": _avm,
            })
        events = [ev.to_dict() for ev in mgr.since(since)]
        with shared.lock:
            _avm = shared.all_vehicles_mode
        return jsonify({
            "alerts": events,
            "latest_seq": mgr.latest_seq(),
            "cap_enabled": shared.alert_cap_enabled,
            "cap_available": shared.alert_cap_detector is not None,
            "cap_threshold": shared.alert_cap_threshold,
            "car_colors": list(shared.alert_car_colors),
            "car_min_score": shared.alert_car_min_score,
            "cooldown_seconds": mgr.cooldown_seconds,
            "server_beep": mgr.server_beep,
            "all_vehicles_mode": _avm,
        })

    @app.post("/api/alerts/config")
    def alerts_config() -> Response:
        mgr = shared.alert_manager
        if mgr is None:
            return jsonify({"error": "AlertManager não inicializado"}), 400
        body = request.get_json(force=True) or {}

        if "cooldown_seconds" in body:
            mgr.cooldown_seconds = float(body["cooldown_seconds"])
        if "server_beep" in body:
            mgr.server_beep = bool(body["server_beep"])
            with shared.lock:
                shared.alert_server_beep = bool(body["server_beep"])
        if "cap_enabled" in body:
            active = bool(body["cap_enabled"])
            with shared.lock:
                shared.alert_cap_enabled = active
            if shared.alert_cap_detector is not None:
                shared.alert_cap_detector.set_active(active)
        if "cap_threshold" in body and shared.alert_cap_detector is not None:
            th = float(body["cap_threshold"])
            shared.alert_cap_detector.set_threshold(th)
            with shared.lock:
                shared.alert_cap_threshold = th
        if "all_vehicles_mode" in body:
            with shared.lock:
                shared.all_vehicles_mode = bool(body["all_vehicles_mode"])
        if "car_colors" in body:
            new_colors = parse_target_colors(",".join(body["car_colors"]))
            min_score = float(body.get("car_min_score", shared.alert_car_min_score))
            with shared.lock:
                if shared.alert_car_color_clf is not None:
                    shared.alert_car_color_clf.update_targets(new_colors, min_score)
                else:
                    shared.alert_car_color_clf = CarColorClassifier(
                        targets=new_colors,
                        min_target_score=min_score,
                    )
                shared.alert_car_colors = new_colors
                shared.alert_car_min_score = min_score
        elif "car_min_score" in body and shared.alert_car_color_clf is not None:
            min_score = float(body["car_min_score"])
            shared.alert_car_color_clf.update_targets(
                shared.alert_car_color_clf.targets, min_score
            )
            with shared.lock:
                shared.alert_car_min_score = min_score

        with shared.lock:
            _avm = shared.all_vehicles_mode
        return jsonify({
            "cap_enabled": shared.alert_cap_enabled,
            "cap_available": shared.alert_cap_detector is not None,
            "cap_threshold": shared.alert_cap_threshold,
            "car_colors": list(shared.alert_car_colors),
            "car_min_score": shared.alert_car_min_score,
            "cooldown_seconds": mgr.cooldown_seconds,
            "server_beep": mgr.server_beep,
            "all_vehicles_mode": _avm,
        })

    # ── Audit log ────────────────────────────────────────────────────────────

    @app.get("/api/audit-log")
    def audit_log_endpoint() -> Response:
        with shared.lock:
            session_id = shared.session_id
        event_type = request.args.get("type") or None
        limit = min(int(request.args.get("limit", 200)), 1000)
        since_ts = float(request.args.get("since", 0)) or None
        all_sessions = request.args.get("all_sessions", "0") == "1"
        rows = audit_log.query(
            session_id=None if all_sessions else session_id,
            event_type=event_type,
            since_ts=since_ts,
            limit=limit,
        )
        summary = audit_log.session_summary(session_id)
        return jsonify({"events": rows, "summary": summary, "session_id": session_id})

    # ── Camera drift ─────────────────────────────────────────────────────────

    @app.get("/api/camera/drift")
    def camera_drift_status() -> Response:
        with shared.lock:
            return jsonify({
                "level": shared.cam_drift_level,
                "score": shared.cam_drift_score,
                "reason": shared.cam_drift_reason,
                "baseline_ready": shared.cam_drift_baseline_ready,
            })

    @app.post("/api/camera/drift/reset")
    def camera_drift_reset() -> Response:
        drift_detector.reset_baseline()
        return jsonify({"ok": True})

    @app.post("/api/export")
    def export_csv() -> Response:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = Path("outputs") / f"count_summary_web_{ts}.csv"
        with shared.lock:
            sex = (
                shared.sex_agg
                if shared.sex_classifier_enabled and shared.show_sex_overlay
                else None
            )
            age = shared.age_agg if shared.age_classifier_enabled else None
            write_summary_csv(csv_path, shared.counter, shared.started_at, sex=sex, age=age)
        return jsonify({"csv_path": str(csv_path)})

    @app.post("/api/export/zones")
    def export_zones_csv() -> Response:
        body = request.get_json(silent=True) or {}
        cam = str(body.get("camera_id", "")).strip() or "default"
        try:
            from_ts = float(body.get("from", 0))
        except (TypeError, ValueError):
            from_ts = 0.0
        to_ts = time.time()
        zones = zone_store_api.list_zones(cam_cal.site_id(), cam)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = Path("outputs") / f"zones_stats_{cam}_{ts}.csv"
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with csv_path.open("w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(
                [
                    "zone_id",
                    "name",
                    "slot_ts",
                    "visits",
                    "unique_ids",
                    "total_dwell_s",
                    "avg_dwell_s",
                    "p95_dwell_s",
                    "peak_occupancy",
                ]
            )
            for z in zones:
                zid = int(z["id"])
                rows = dwell_store_api.query_zone_stats(zid, from_ts, to_ts)
                name = str(z.get("name", ""))
                for row in rows:
                    w.writerow(
                        [
                            zid,
                            name,
                            row["slot_ts"],
                            row["visits"],
                            row["unique_ids"],
                            row["total_dwell_s"],
                            row["avg_dwell_s"],
                            row["p95_dwell_s"],
                            row["peak_occupancy"],
                        ]
                    )
        return jsonify({"ok": True, "csv_path": str(csv_path)})

    @app.post("/api/export/dwell-report")
    def export_dwell_report() -> Response:
        body = request.get_json(silent=True) or {}
        cam = str(body.get("camera_id", "")).strip() or "default"
        ts = datetime.now().strftime("%Y%m%d")
        out = Path("outputs") / f"dwell_report_{cam}_{ts}.txt"
        out.parent.mkdir(parents=True, exist_ok=True)
        lines = [
            f"Relatorio dwell — camera {cam}",
            f"Data UTC: {datetime.utcnow().isoformat()}Z",
            "",
        ]
        zones = zone_store_api.list_zones(cam_cal.site_id(), cam)
        for z in zones:
            zid = int(z["id"])
            rows = dwell_store_api.query_zone_stats(zid, 0, time.time())
            lines.append(f"Zona {zid} ({z.get('name', '')}):")
            if not rows:
                lines.append("  (sem slots)")
                continue
            last = rows[-1]
            lines.append(
                f"  ultimo slot: visits={last['visits']} "
                f"avg_dwell_s={last['avg_dwell_s']:.2f} p95={last['p95_dwell_s']:.2f}"
            )
        out.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return jsonify({"ok": True, "path": str(out)})

    def _build_offline_jpeg() -> bytes:
        canvas = np.zeros((540, 960, 3), dtype=np.uint8)
        canvas[:] = (18, 22, 28)
        cv2.putText(
            canvas, "FONTE OFFLINE / A RECONECTAR", (120, 260),
            cv2.FONT_HERSHEY_SIMPLEX, 1.35, (230, 230, 230), 3, cv2.LINE_AA,
        )
        cv2.putText(
            canvas, "Verifique URL da camera ou aguarde o watchdog",
            (100, 320),
            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (160, 160, 160), 1, cv2.LINE_AA,
        )
        ok, enc = cv2.imencode(".jpg", canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 72])
        return enc.tobytes() if ok else b""

    _offline_jpeg = _build_offline_jpeg()

    @app.get("/video_feed")
    def video_feed() -> Response:
        def gen() -> bytes:
            _last_emit = 0.0
            _last_sent_seq = 0
            _cached_infer_fps = 0.0
            _next_fps_refresh = 0.0
            while True:
                now = time.perf_counter()
                with shared.frame_output_lock:
                    seq = shared.last_frame_seq
                    frame = shared.last_frame_jpeg
                    last_mono = shared.last_frame_mono
                    if shared.frame_ring:
                        seq, last_mono, frame = shared.frame_ring[-1]
                with shared.lock:
                    _max_fps = max(1.0, min(30.0, float(shared.mjpeg_max_fps)))
                    _adaptive_fps = shared.mjpeg_adaptive_fps
                    _adaptive_headroom = max(1.0, min(1.8, float(shared.mjpeg_adaptive_headroom)))
                    _adaptive_min_fps = max(1.0, min(_max_fps, float(shared.mjpeg_adaptive_min_fps)))
                    stale_s = max(2.0, float(shared.mjpeg_stale_s))
                    _burst_new = shared.mjpeg_burst_new
                    _burst_cap = max(10.0, min(60.0, float(shared.mjpeg_burst_cap_fps)))
                    if _adaptive_fps and now >= _next_fps_refresh:
                        _cached_infer_fps = float(shared.infer_fps_ema or 0.0)
                        _next_fps_refresh = now + 0.4
                _min_burst = 1.0 / _burst_cap
                target_fps = _max_fps
                if _adaptive_fps and _cached_infer_fps > 0.2:
                    target_fps = min(
                        _max_fps,
                        max(_adaptive_min_fps, _cached_infer_fps * _adaptive_headroom),
                    )
                _dynamic_min_interval = 1.0 / max(1.0, target_fps)
                is_stale = last_mono > 0.0 and (time.monotonic() - last_mono) >= stale_s
                _fresh = (
                    _burst_new
                    and not is_stale
                    and frame is not None
                    and seq > _last_sent_seq
                )
                if _fresh:
                    wait = max(0.0, _min_burst - (now - _last_emit))
                else:
                    wait = max(0.0, _dynamic_min_interval - (now - _last_emit))
                if wait > 0:
                    time.sleep(wait)
                if frame is None or is_stale:
                    out = _offline_jpeg if (is_stale or frame is None) and _offline_jpeg else frame
                    if out is None:
                        time.sleep(0.08)
                        continue
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + out + b"\r\n"
                    )
                    _last_emit = time.perf_counter()
                    if frame is None:
                        time.sleep(0.35)
                    continue
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                )
                _last_emit = time.perf_counter()
                _last_sent_seq = seq

        return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")

    _openapi_path = Path(__file__).resolve().parent.parent / "docs" / "openapi.yaml"

    @app.get("/openapi.yaml")
    def serve_openapi() -> Response:
        if not _openapi_path.is_file():
            return jsonify({"error": "Especificacao OpenAPI nao encontrada"}), 404
        return Response(
            _openapi_path.read_text(encoding="utf-8"),
            mimetype="text/yaml; charset=utf-8",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/docs")
    def swagger_ui_page() -> Response:
        html = """<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>API — Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.yaml",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
      });
    };
  </script>
</body>
</html>"""
        return Response(html, mimetype="text/html; charset=utf-8")

    return app


def main() -> None:
    _configure_runtime_logging()
    args = parse_args()
    args.port = _resolve_listen_port(args.host, args.port)
    line_init = tuple(int(v) for v in args.line.split(","))
    shared = SharedState(
        line_default=line_init,
        loitering_threshold_sec=args.loitering_seconds,
    )
    _sync_mjpeg_from_environ(shared)
    with shared.lock:
        shared.heatmap_available = not args.no_heatmap
        shared.show_heatmap_overlay = False
        shared.sex_overlay_available = False
        shared.show_sex_overlay = False
    presets = _load_source_presets_from_file()
    if not presets:
        presets = _load_source_presets_from_env()
    _src_resolved = _resolve_initial_video_source(args, presets)
    if _src_resolved != str(args.source).strip():
        args.source = _src_resolved
    with shared.lock:
        shared.source_presets = presets
        shared.active_preset_id = _preset_id_for_url(presets, str(args.source).strip())
    try:
        get_session_factory()
    except Exception as exc:
        print(f"[web] Falha ao inicializar a base de dados (DATABASE_URL): {exc}", flush=True)
    try:
        ap_boot = ""
        with shared.lock:
            ap_boot = str(shared.active_preset_id or "").strip()
        _load_calibration_for_preset(shared, ap_boot)
    except Exception as exc:
        print(f"[web] Calibracao por camera (SQL): {exc}", flush=True)
    stop_event = threading.Event()

    audit_log = AuditLog()
    drift_detector = CameraDriftDetector()
    audit_log.log(ts=0.0, session_id=shared.session_id, event_type="session_start")

    try:
        analytics_worker = AggregatorWorker(get_session_factory())
        analytics_worker.start()
    except Exception as exc:
        print(f"[web] Analytics worker nao iniciado (BD indisponivel): {exc}", flush=True)
        analytics_worker = None

    t = threading.Thread(
        target=inference_loop,
        args=(args, shared, stop_event, audit_log, drift_detector, analytics_worker),
        daemon=True,
    )
    t.start()

    def _stream_watchdog() -> None:
        try:
            _soft = float(os.environ.get("YOLO_WATCHDOG_SOFT_S", "15").strip() or "15")
        except ValueError:
            _soft = 15.0
        try:
            _hard = float(os.environ.get("YOLO_WATCHDOG_HARD_S", "60").strip() or "60")
        except ValueError:
            _hard = 60.0
        _soft = max(5.0, _soft)
        # Margem minima soft->hard: HLS (segmentos, buffer) pode ficar >30s sem frame sem ser falha;
        # com HARD perto de SOFT o processo morria (os._exit) durante reconexao lenta.
        _min_margin = 50.0
        _hard = max(_soft + _min_margin, _hard)
        print(
            f"[watchdog] stream stall soft={_soft:.0f}s (recover) hard={_hard:.0f}s (os._exit); "
            f"margem min. soft->hard={_min_margin:.0f}s. Override: YOLO_WATCHDOG_SOFT_S / YOLO_WATCHDOG_HARD_S",
            flush=True,
        )
        _last_recover_mono = 0.0
        while not stop_event.is_set():
            time.sleep(2.0)
            _now = time.monotonic()
            with shared.frame_output_lock:
                _lf = shared.last_frame_mono
                _lt = shared.last_track_tick_mono
                last = max(_lf, _lt)
            if last <= 0.0:
                continue
            idle = _now - last
            _idle_jpeg = _now - _lf if _lf > 0.0 else -1.0
            _idle_tick = _now - _lt if _lt > 0.0 else -1.0
            if idle >= _hard:
                print(
                    f"[watchdog] FATAL: sem actividade ha {idle:.1f}s >= {_hard:.0f}s "
                    f"(idle JPEG={_idle_jpeg:.1f}s, idle iterador={_idle_tick:.1f}s); "
                    "os._exit(3) para restart (run_web.sh em loop).",
                    flush=True,
                )
                os._exit(3)
            if idle >= _soft and (_now - _last_recover_mono) >= 20.0:
                print(
                    f"[watchdog] stream parado ha {idle:.1f}s (SOFT={_soft:.0f}s); "
                    f"idle JPEG={_idle_jpeg:.1f}s idle iterador YOLO={_idle_tick:.1f}s; "
                    "source_changed=True (reabrir fonte).",
                    flush=True,
                )
                with shared.lock:
                    shared.last_error = (
                        f"Stream sem frames ha {idle:.0f}s; a reconectar. "
                        "URLs HLS com token expiram; valide o URL ou use pagina .html Skyline."
                    )
                    shared.source_changed = True
                _last_recover_mono = time.monotonic()

    threading.Thread(target=_stream_watchdog, daemon=True).start()

    start_stats_emitter_thread(
        session_id=shared.session_id,
        get_stats=lambda: build_stats_payload(shared),
    )

    app = create_app(shared, audit_log, drift_detector, analytics_worker=analytics_worker)
    print(
        f"[web] Documentacao OpenAPI: http://{args.host}:{args.port}/docs "
        f"(YAML: http://{args.host}:{args.port}/openapi.yaml)",
        flush=True,
    )
    # Evita access log duplicado (mesma linha em stdout e via logger raiz).
    logging.getLogger("werkzeug").propagate = False
    try:
        app.run(
            host=args.host,
            port=args.port,
            debug=False,
            use_reloader=False,
            threaded=True,
        )
    except KeyboardInterrupt:
        pass
    finally:
        stop_event.set()
        shutdown_emitter()
        t.join(timeout=8.0)


if __name__ == "__main__":
    main()
