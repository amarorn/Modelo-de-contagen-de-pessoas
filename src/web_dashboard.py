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
from stream_source_resolve import resolve_stream_source
from age_classifier_agg import AgeAggregateStats, OptionalAgeClassifier
from sex_classifier_agg import OptionalSexClassifier, SexAggregateStats
from env_settings import (
    EDITABLE_ENV_KEYS,
    filter_updates,
    merge_env_file,
    read_training_metrics_from_weights,
    snapshot_editable_env,
)
from persistence.emitter import emit_config_event, shutdown_emitter, start_stats_emitter_thread
from persistence.db import get_session_factory

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


@dataclass
class CounterState:
    entries: int = 0
    exits: int = 0

    @property
    def total(self) -> int:
        return self.entries + self.exits


def reset_entry_exit_counters(shared: SharedState) -> None:
    shared.counter = CounterState()
    shared.sex_agg = SexAggregateStats()
    shared.age_agg = AgeAggregateStats()
    shared.hourly_entries = [0] * 24
    shared.hourly_exits = [0] * 24


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
        shared.polygon_live = []


def _load_calibration_for_preset(shared: SharedState, preset_id: str) -> None:
    pid = str(preset_id or "").strip()
    if not pid:
        _apply_default_calibration(shared)
        return
    data = cam_cal.load(cam_cal.site_id(), pid)
    if not data:
        _apply_default_calibration(shared)
        return
    with shared.lock:
        shared.count_mode = data["count_mode"]
        shared.line_live = tuple(data["line"])
        shared.polygon_live = list(data["polygon"])


def _save_calibration_for_preset(shared: SharedState, preset_id: str) -> None:
    pid = str(preset_id or "").strip()
    if not pid:
        return
    with shared.lock:
        mode = shared.count_mode
        line = shared.line_live
        poly = list(shared.polygon_live)
    cam_cal.save(
        cam_cal.site_id(),
        pid,
        count_mode=mode,
        line=tuple(int(x) for x in line),
        polygon=poly,
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
        self.started_at = datetime.now()
        self.last_frame_jpeg: bytes | None = None
        self.last_error: str | None = None
        self.lock = threading.Lock()
        self.line_default = line_default
        self.line_live = line_default
        self.count_mode: str = "line"
        self.polygon_default: list[tuple[int, int]] = []
        self.polygon_live: list[tuple[int, int]] = []
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
        self.infer_fps_ema: float = 0.0
        # fonte de vídeo trocável em tempo real
        self.source_live: str = ""
        self.source_changed: bool = False
        # id do preset em uso (evita ambiguidade se dois presets tiverem a mesma url)
        self.active_preset_id: str = ""
        # Presets: {"id", "label", "url"} — max 24; preenchido no arranque a partir do .env
        self.source_presets: list[dict[str, str]] = []
        # overlays no MJPEG (caixas/labels mantêm-se; só rastro e seta PCA)
        self.show_trail_overlay: bool = True
        self.show_heading_overlay: bool = True


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
        help="Rejeita bbox com area > esta fraccao do frame (estruturas gigantes)",
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
    """Linha de contagem estilizada: glow escuro + cyan + marcadores nas extremidades."""
    shadow = tuple(int(c * 0.3) for c in _C_CYAN)
    cv2.line(frame, (x1, y1), (x2, y2), shadow, 6, lineType=cv2.LINE_AA)   # type: ignore[arg-type]
    cv2.line(frame, (x1, y1), (x2, y2), _C_CYAN, 2, lineType=cv2.LINE_AA)
    for pt in ((x1, y1), (x2, y2)):
        cv2.circle(frame, pt, 6, _C_BLACK, -1, lineType=cv2.LINE_AA)
        cv2.circle(frame, pt, 4, _C_CYAN,  -1, lineType=cv2.LINE_AA)


def _draw_heading_arrow(
    frame: np.ndarray,
    p0: tuple[int, int], p1: tuple[int, int],
    color: tuple[int, int, int],
) -> None:
    """Seta de direção com glow: contorno escuro + cor do tema."""
    # arrowedLine(img, pt1, pt2, color, thickness, lineType, shift, tipLength)
    cv2.arrowedLine(frame, p0, p1, _C_BLACK, 5, cv2.LINE_AA, 0, 0.30)
    cv2.arrowedLine(frame, p0, p1, color,    2, cv2.LINE_AA, 0, 0.30)
    # circle(img, center, radius, color, thickness, lineType, shift)
    cv2.circle(frame, p1, 5, _C_BLACK, -1, cv2.LINE_AA)
    cv2.circle(frame, p1, 3, color,    -1, cv2.LINE_AA)


def _overlay_text(
    frame: np.ndarray,
    text: str,
    live_text: str,
    fw: int,
    fh: int,
) -> None:
    """Textos de contagem no canto superior esquerdo com fundo escuro."""
    pad = 10
    for i, (line, scale, thick) in enumerate([
        (text,      0.85, 2),
        (live_text, 0.58, 1),
    ]):
        (tw, th), _ = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
        y = pad + (i * (th + 10)) + th
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


def filter_boxes_by_shape(
    ids: list[int],
    xyxys: list[tuple[float, float, float, float]],
    fw: int,
    fh: int,
    min_ar: float,
    max_ar: float,
    max_area_frac: float,
    min_h_px: int,
) -> tuple[list[int], list[tuple[float, float, float, float]]]:
    out_ids: list[int] = []
    out_xy: list[tuple[float, float, float, float]] = []
    for tid, box in zip(ids, xyxys):
        if bbox_looks_like_person(box, fw, fh, min_ar, max_ar, max_area_frac, min_h_px):
            out_ids.append(tid)
            out_xy.append(box)
    return out_ids, out_xy


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


def resolve_person_class_id(model: YOLO, forced_id: int | None) -> int:
    if forced_id is not None:
        return forced_id
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        for class_id, class_name in names.items():
            if str(class_name).strip().lower() == "person":
                return int(class_id)
    return 0


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
        cap = cv2.VideoCapture(source)
        ok = cap.isOpened()
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


def inference_loop(args: argparse.Namespace, shared: SharedState, stop_event: threading.Event) -> None:
    try:
        model = YOLO(args.model)
        person_class_id = resolve_person_class_id(model, args.person_class_id)
        names = getattr(model, "names", {})
        cls_label = "?"
        if isinstance(names, dict):
            cls_label = str(names.get(person_class_id, names.get(str(person_class_id), "?")))
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
        print(
            f"[web] classe filtrada id={person_class_id} ({cls_label}) | "
            f"conf={args.conf} imgsz={args.imgsz} max_det={args.max_det} "
            f"augment={args.augment} agnostic_nms={args.agnostic_nms} | "
            f"device={resolved_device} half={use_half} vid_stride={args.vid_stride} stream_buffer={args.stream_buffer}"
        )

        with shared.lock:
            _ld = shared.line_live
            _mode = shared.count_mode
            _np = len(shared.polygon_live)
        print(
            f"[web] Modo contagem={_mode} | linha (pixels): {_ld} | poligono: {_np} vertices. "
            "Linha: pes cruzam segmento. Poligono: entrada/saida pela area (UI /roi)."
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
                shared.sex_classifier_enabled = bool(sex_clf and sex_clf.enabled)
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

        last_side_by_id: dict[int, float] = {}
        prev_inside_by_id: dict[int, bool] = {}
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

        tracker_yaml = resolve_tracker_yaml(args.tracker)
        box_overlay = TrackBoxOverlay(args.track_ema, args.track_hold_frames)
        print(
            f"[web] tracker={tracker_yaml} track_ema={args.track_ema} "
            f"track_hold_frames={args.track_hold_frames} trail_len={args.trail_len} "
            f"heading_arrow={not args.no_heading_arrow}"
        )
        if args.no_shape_filter:
            print("[web] Filtro de forma desligado (--no-shape-filter)")
        else:
            print(
                f"[web] Filtro de forma ativo: ar=[{args.min_person_ar},{args.max_person_ar}] "
                f"max_area_frac={args.max_box_area_frac} min_h_px={args.min_person_height_px}"
            )

        # ── Loop externo: reinicia o stream ao trocar fonte ─────────────────
        while not stop_event.is_set():
            with shared.lock:
                raw_src = shared.source_live
                shared.source_changed = False

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
                time.sleep(2.0)
                continue

            print(f"[web] Abrindo fonte: {source!r}")

            track_kw: dict = {
                "source": source,
                "stream": True,
                "conf": args.conf,
                "iou": args.iou,
                "imgsz": args.imgsz,
                "max_det": args.max_det,
                "classes": [person_class_id],
                "tracker": tracker_yaml,
                "persist": True,
                "verbose": False,
                "device": resolved_device,
                "vid_stride": max(1, args.vid_stride),
                "stream_buffer": args.stream_buffer,
            }
            if use_half:
                track_kw["half"] = True
            if args.augment:
                track_kw["augment"] = True
            if args.agnostic_nms:
                track_kw["agnostic_nms"] = True

            stream = model.track(**track_kw)
            foot_trail_by_id: dict[int, deque[tuple[int, int]]] = {}
            trail_max = max(0, int(args.trail_len))
            show_heading_arrow = (not args.no_heading_arrow) and trail_max >= 2
            prev_frame_mono: float | None = None
            ema_infer_fps: float = 0.0
            _frames_received = 0

            for result in stream:
                if stop_event.is_set():
                    break
                with shared.lock:
                    if shared.source_changed:
                        break

                frame = result.orig_img
                if frame is None:
                    continue

                _frames_received += 1
                fh, fw = frame.shape[:2]
                with shared.lock:
                    raw_line = shared.line_live
                    count_mode = shared.count_mode
                    poly_raw = list(shared.polygon_live)
                cfg_sig = f"{count_mode}|{raw_line}|{poly_raw}"
                if prev_config_sig is not None and cfg_sig != prev_config_sig:
                    last_side_by_id.clear()
                    prev_inside_by_id.clear()
                    foot_trail_by_id.clear()
                    zone_entered_at_by_id.clear()
                    stationary_since_by_id.clear()
                prev_config_sig = cfg_sig

                x1, y1, x2, y2 = clamp_line(*raw_line, fw, fh)
                poly_pts = clamp_polygon(poly_raw, fw, fh) if len(poly_raw) >= 3 else []
                frame_ts = time.monotonic()
                if prev_frame_mono is not None:
                    dt = frame_ts - prev_frame_mono
                    if dt > 1e-6:
                        inst_fps = 1.0 / dt
                        ema_infer_fps = (
                            inst_fps if ema_infer_fps <= 0 else 0.92 * ema_infer_fps + 0.08 * inst_fps
                        )
                prev_frame_mono = frame_ts

                entry_boxes: list[tuple[float, float, float, float]] = []

                foot_points: list[tuple[float, float]] = []
                current_present_ids: set[int] = set()
                # conjuntos de status do frame anterior — usados na colorização
                _stationary_ids: set[int] = set()
                _loitering_ids: set[int] = set()

                if result.boxes is not None and len(result.boxes) > 0:
                    xys = result.boxes.xyxy.tolist()
                    for x_min, y_min, x_max, y_max in xys:
                        box = (float(x_min), float(y_min), float(x_max), float(y_max))
                        if not args.no_shape_filter and not bbox_looks_like_person(
                            box,
                            fw,
                            fh,
                            args.min_person_ar,
                            args.max_person_ar,
                            args.max_box_area_frac,
                            args.min_person_height_px,
                        ):
                            continue
                        foot_x = (x_min + x_max) / 2.0
                        foot_y = float(y_max)
                        if count_mode == "polygon" and len(poly_pts) >= 3:
                            if not foot_inside_polygon(foot_x, foot_y, poly_pts):
                                continue
                        foot_points.append((foot_x, foot_y))

                if heat is not None:
                    heat.step(fh, fw, foot_points)
                    frame = heat.blend_over(frame)

                ids_list: list[int] | None = None
                xys_raw: list[tuple[float, float, float, float]] | None = None
                if result.boxes is not None and len(result.boxes) > 0 and result.boxes.id is not None:
                    ids_list = [int(t) for t in result.boxes.id.int().tolist()]
                    xys_raw = [tuple(map(float, t)) for t in result.boxes.xyxy.tolist()]
                    if not args.no_shape_filter:
                        ids_list, xys_raw = filter_boxes_by_shape(
                            ids_list,
                            xys_raw,
                            fw,
                            fh,
                            args.min_person_ar,
                            args.max_person_ar,
                            args.max_box_area_frac,
                            args.min_person_height_px,
                        )
                    for track_id, (x_min, y_min, x_max, y_max) in zip(ids_list, xys_raw):
                        foot_x = (x_min + x_max) / 2.0
                        foot_y = float(y_max)
                        inside_for_presence = True
                        if count_mode == "polygon" and len(poly_pts) >= 3:
                            inside_for_presence = foot_inside_polygon(foot_x, foot_y, poly_pts)
                        if inside_for_presence:
                            current_present_ids.add(track_id)
                            zone_entered_at_by_id.setdefault(track_id, frame_ts)
                        if count_mode == "polygon" and len(poly_pts) >= 3:
                            inside = inside_for_presence
                            with shared.lock:
                                prev_b = prev_inside_by_id.get(track_id)
                                if prev_b is not None and not prev_b and inside:
                                    shared.counter.entries += 1
                                    _bump_hourly(shared, "entry")
                                    entry_boxes.append((x_min, y_min, x_max, y_max))
                                elif prev_b is not None and prev_b and not inside:
                                    shared.counter.exits += 1
                                    _bump_hourly(shared, "exit")
                            prev_inside_by_id[track_id] = inside
                        elif count_mode == "line":
                            side = side_of_line(foot_x, foot_y, x1, y1, x2, y2)
                            with shared.lock:
                                prev = last_side_by_id.get(track_id)
                                if prev is not None and prev < 0 <= side:
                                    shared.counter.entries += 1
                                    _bump_hourly(shared, "entry")
                                    entry_boxes.append((x_min, y_min, x_max, y_max))
                                elif prev is not None and prev > 0 >= side:
                                    shared.counter.exits += 1
                                    _bump_hourly(shared, "exit")
                            last_side_by_id[track_id] = side

                    if entry_boxes and result.orig_img is not None:
                        for box in entry_boxes:
                            if sex_clf and sex_clf.enabled:
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

                draw_items = box_overlay.step(ids_list, xys_raw)
                active_ids = {t for t, _, _ in draw_items}
                raw_foot_by_id: dict[int, tuple[int, int]] = {}
                if ids_list is not None and xys_raw is not None and len(ids_list) == len(xys_raw):
                    for tid, (rx1, ry1, rx2, ry2) in zip(ids_list, xys_raw):
                        raw_foot_by_id[int(tid)] = (
                            int(round((rx1 + rx2) / 2.0)),
                            int(round(float(ry2))),
                        )
                for tid in list(last_side_by_id.keys()):
                    if tid not in active_ids:
                        del last_side_by_id[tid]
                for tid in list(prev_inside_by_id.keys()):
                    if tid not in active_ids:
                        del prev_inside_by_id[tid]
                for tid in list(foot_trail_by_id.keys()):
                    if tid not in active_ids:
                        del foot_trail_by_id[tid]
                for tid in list(zone_entered_at_by_id.keys()):
                    if tid not in current_present_ids:
                        del zone_entered_at_by_id[tid]
                for tid in list(stationary_since_by_id.keys()):
                    if tid not in current_present_ids:
                        del stationary_since_by_id[tid]

                with shared.lock:
                    show_trail_ui = shared.show_trail_overlay
                    show_heading_ui = shared.show_heading_overlay

                for track_id, (xa, ya, xb, yb), stale in draw_items:
                    if track_id in raw_foot_by_id:
                        fcx, fcy = raw_foot_by_id[track_id]
                    else:
                        fcx = int(round((xa + xb) / 2.0))
                        fcy = int(yb)

                    # ── Estado de movimento (usa frame anterior) ──────────
                    is_loiter = track_id in _loitering_ids
                    is_static = track_id in _stationary_ids

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
                        label = f"{track_id}{side_tag}" + ("~" if stale else "")
                    else:
                        base_mv = _C_CYAN
                        base_mv_dim = _C_CYAN_DIM
                        side_tag = ""
                        label = f"{track_id}" + ("~" if stale else "")

                    # ── Cor final: loitering > parado > movendo ───────────
                    if is_loiter:
                        color = _C_RED_DIM if stale else _C_RED
                        label = f"{track_id}!" + ("~" if stale else "")
                    elif is_static:
                        color = _C_AMBER_DIM if stale else _C_AMBER
                        label = f"{track_id}■" + ("~" if stale else "")
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

                moving_now = 0
                stationary_now = 0
                loitering_now = 0
                dwell_values: list[float] = []
                move_speed_samples: list[float] = []
                trail_eval_max = max(2, min(trail_max, 12))
                for tid in current_present_ids:
                    entered_at = zone_entered_at_by_id.get(tid, frame_ts)
                    dwell_values.append(max(0.0, frame_ts - entered_at))
                    dq = foot_trail_by_id.get(tid)
                    speed = estimate_trail_speed(list(dq), max_points=trail_eval_max) if dq is not None else None
                    is_stationary = (
                        dq is not None
                        and len(dq) >= max(2, args.stationary_min_points)
                        and speed is not None
                        and speed <= args.stationary_max_speed
                    )
                    if is_stationary:
                        stationary_now += 1
                        _stationary_ids.add(tid)
                        stationary_since_by_id.setdefault(tid, frame_ts)
                        if frame_ts - stationary_since_by_id[tid] >= args.loitering_seconds:
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
                    shared.infer_fps_ema = ema_infer_fps
                if count_mode == "polygon" and len(poly_pts) >= 3:
                    arr = np.array(poly_pts, dtype=np.int32).reshape(-1, 1, 2)
                    # Glow do polígono: sombra escura + amber
                    shadow_poly = tuple(int(c * 0.25) for c in _C_AMBER)
                    cv2.polylines(frame, [arr], isClosed=True, color=shadow_poly, thickness=5, lineType=cv2.LINE_AA)  # type: ignore[arg-type]
                    cv2.polylines(frame, [arr], isClosed=True, color=_C_AMBER, thickness=2, lineType=cv2.LINE_AA)
                    for pt in poly_pts:
                        cv2.circle(frame, pt, 5, _C_BLACK, -1, lineType=cv2.LINE_AA)
                        cv2.circle(frame, pt, 3, _C_AMBER,  -1, lineType=cv2.LINE_AA)
                    _overlay_text(frame, text, live_text, fw, fh)
                elif count_mode == "polygon":
                    cv2.putText(
                        frame,
                        "Defina poligono em /roi (min. 3 pontos)",
                        (20, 36),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        _C_AMBER,
                        2,
                        lineType=cv2.LINE_AA,
                    )
                    _overlay_text(frame, text, live_text, fw, fh)
                else:
                    _draw_count_line(frame, x1, y1, x2, y2)
                    _overlay_text(frame, text, live_text, fw, fh)

                ok, encoded = cv2.imencode(".jpg", frame)
                if ok:
                    with shared.lock:
                        shared.last_frame_jpeg = encoded.tobytes()

            # Fim do for: se saímos sem nenhum frame e a fonte não foi trocada,
            # a URL/câmera falhou ao abrir. Registra erro e faz backoff para não
            # encher o log com "Failed to open" em loop contínuo.
            if not stop_event.is_set():
                with shared.lock:
                    _src_changed_now = shared.source_changed
                if not _src_changed_now and _frames_received == 0:
                    _err_msg = f"Falha ao abrir fonte: {raw_src!r}. Verifique a URL/câmera e tente novamente."
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
        }


def create_app(shared: SharedState) -> Flask:
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}, r"/video_feed": {"origins": "*"}})
    env_file = Path(__file__).resolve().parent.parent / ".env"

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
        _persist_config_event(shared, "settings", {"updated_keys": list(updates.keys())})
        return jsonify(
            {
                "ok": True,
                "updated": list(updates.keys()),
                "restart_required": True,
                "hint": "Reinicie o servidor (bash scripts/run_web.sh) para carregar os novos valores.",
            }
        )

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
        if (j.sex_classifier_enabled) {
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
            poly = [{"x": a, "y": b} for a, b in shared.polygon_live]
            pdef = [{"x": a, "y": b} for a, b in shared.polygon_default]
            show_trail = shared.show_trail_overlay
            show_heading = shared.show_heading_overlay
            apid = str(shared.active_preset_id or "").strip()
        return jsonify(
            {
                "mode": mode,
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "default_line": {"x1": d1, "y1": d2, "x2": d3, "y2": d4},
                "polygon": poly,
                "default_polygon": pdef,
                "show_trail": show_trail,
                "show_heading": show_heading,
                "active_preset_id": apid,
            }
        )

    @app.post("/api/overlay")
    def post_overlay() -> Response:
        data = request.get_json(silent=True) or {}
        with shared.lock:
            if "show_trail" in data:
                shared.show_trail_overlay = bool(data["show_trail"])
            if "show_heading" in data:
                shared.show_heading_overlay = bool(data["show_heading"])
            st = shared.show_trail_overlay
            sh = shared.show_heading_overlay
        _persist_config_event(shared, "overlay", {"show_trail": st, "show_heading": sh})
        return jsonify({"ok": True, "show_trail": st, "show_heading": sh})

    @app.get("/api/line")
    def get_line() -> Response:
        with shared.lock:
            mode = shared.count_mode
            x1, y1, x2, y2 = shared.line_live
            d1, d2, d3, d4 = shared.line_default
            poly = [{"x": a, "y": b} for a, b in shared.polygon_live]
        return jsonify(
            {
                "mode": mode,
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "default": {"x1": d1, "y1": d2, "x2": d3, "y2": d4},
                "polygon": poly,
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

    @app.post("/api/polygon")
    def post_polygon() -> Response:
        data = request.get_json(silent=True) or {}
        raw = data.get("points")
        if not isinstance(raw, list) or len(raw) < 3:
            return jsonify({"error": "Precisa de lista points com pelo menos 3 vertices"}), 400
        if len(raw) > 32:
            return jsonify({"error": "No maximo 32 vertices"}), 400
        pts: list[tuple[int, int]] = []
        try:
            for p in raw:
                pts.append((int(p["x"]), int(p["y"])))
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "Cada ponto precisa x e y inteiros"}), 400
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            shared.polygon_live = pts
            shared.count_mode = "polygon"
            if reset_counters:
                reset_entry_exit_counters(shared)
        _persist_config_event(
            shared,
            "polygon",
            {
                "vertices": len(pts),
                "reset_counters": reset_counters,
                "preset_id": str(shared.active_preset_id or "").strip(),
            },
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        return jsonify(
            {"ok": True, "polygon": [{"x": a, "y": b} for a, b in pts], "mode": "polygon"}
        )

    @app.post("/api/polygon/reset")
    def reset_polygon() -> Response:
        data = request.get_json(silent=True) or {}
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            shared.polygon_live = list(shared.polygon_default)
            shared.count_mode = "line"
            if reset_counters:
                reset_entry_exit_counters(shared)
        with shared.lock:
            poly = [{"x": a, "y": b} for a, b in shared.polygon_live]
        _persist_config_event(
            shared,
            "polygon_reset",
            {"reset_counters": reset_counters, "preset_id": str(shared.active_preset_id or "").strip()},
        )
        with shared.lock:
            ap = str(shared.active_preset_id or "").strip()
        _save_calibration_for_preset(shared, ap)
        return jsonify({"ok": True, "polygon": poly, "mode": "line"})

    @app.post("/api/mode")
    def post_mode() -> Response:
        data = request.get_json(silent=True) or {}
        m = data.get("mode", "")
        if m not in ("line", "polygon"):
            return jsonify({"error": "mode deve ser 'line' ou 'polygon'"}), 400
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            poly_len = len(shared.polygon_live)
        if m == "polygon" and poly_len < 3:
            return jsonify(
                {"error": "Poligono incompleto: use POST /api/polygon com minimo 3 pontos"}
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

    @app.post("/api/source")
    def post_source() -> Response:
        data = request.get_json(silent=True) or {}
        new_src = str(data.get("source", "")).strip()
        if not new_src:
            return jsonify({"error": "source vazio"}), 400
        if len(new_src) > 4096:
            return jsonify({"error": "source demasiado longo"}), 400
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

    @app.post("/api/export")
    def export_csv() -> Response:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = Path("outputs") / f"count_summary_web_{ts}.csv"
        with shared.lock:
            sex = shared.sex_agg if shared.sex_classifier_enabled else None
            age = shared.age_agg if shared.age_classifier_enabled else None
            write_summary_csv(csv_path, shared.counter, shared.started_at, sex=sex, age=age)
        return jsonify({"csv_path": str(csv_path)})

    @app.get("/video_feed")
    def video_feed() -> Response:
        def gen() -> bytes:
            while True:
                with shared.lock:
                    frame = shared.last_frame_jpeg
                if frame is None:
                    time.sleep(0.05)
                    continue
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
                )

        return Response(gen(), mimetype="multipart/x-mixed-replace; boundary=frame")

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
    presets = _load_source_presets_from_file()
    if not presets:
        presets = _load_source_presets_from_env()
    with shared.lock:
        shared.source_presets = presets
        shared.active_preset_id = _preset_id_for_url(presets, str(args.source).strip())
    try:
        get_session_factory()
        ap_boot = ""
        with shared.lock:
            ap_boot = str(shared.active_preset_id or "").strip()
        _load_calibration_for_preset(shared, ap_boot)
    except Exception as exc:
        print(f"[web] Calibracao por camera (SQL): {exc}", flush=True)
    stop_event = threading.Event()

    t = threading.Thread(target=inference_loop, args=(args, shared, stop_event), daemon=True)
    t.start()

    start_stats_emitter_thread(
        session_id=shared.session_id,
        get_stats=lambda: build_stats_payload(shared),
    )

    app = create_app(shared)
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
