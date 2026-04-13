#!/usr/bin/env python3
"""Dashboard web para contagem de pessoas em tempo real.

Estatistica agregada por sexo (opcional): nao ha base de dados separada. O ambiente
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
import logging
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
from age_classifier_agg import AgeAggregateStats, OptionalAgeClassifier
from sex_classifier_agg import OptionalSexClassifier, SexAggregateStats


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


class SharedState:
    def __init__(
        self,
        line_default: tuple[int, int, int, int],
        loitering_threshold_sec: float = 10.0,
    ) -> None:
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
        source = int(args.source) if args.source.isdigit() else args.source
        validate_source(source)

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

        for result in stream:
            if stop_event.is_set():
                break

            frame = result.orig_img
            if frame is None:
                continue

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

            entry_boxes: list[tuple[float, float, float, float]] = []

            foot_points: list[tuple[float, float]] = []
            current_present_ids: set[int] = set()

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

            for track_id, (xa, ya, xb, yb), stale in draw_items:
                if track_id in raw_foot_by_id:
                    fcx, fcy = raw_foot_by_id[track_id]
                else:
                    fcx = int(round((xa + xb) / 2.0))
                    fcy = int(yb)
                side_v = last_side_by_id.get(track_id) if count_mode == "line" else None
                if count_mode == "line" and side_v is not None:
                    if side_v < 0:
                        color = (60, 100, 200) if stale else (80, 140, 255)
                        side_tag = "A"
                    elif side_v > 0:
                        color = (50, 160, 50) if stale else (70, 210, 70)
                        side_tag = "B"
                    else:
                        color = (140, 140, 140) if stale else (180, 180, 180)
                        side_tag = "|"
                    label = f"id={track_id} {side_tag}" + (" ~" if stale else "")
                else:
                    color = (0, 200, 100) if stale else (0, 255, 0)
                    label = f"id={track_id}" + (" ~" if stale else "")
                if trail_max >= 2:
                    dq = foot_trail_by_id.get(track_id)
                    if dq is None:
                        dq = deque(maxlen=trail_max)
                        foot_trail_by_id[track_id] = dq
                    if not dq or dq[-1] != (fcx, fcy):
                        dq.append((fcx, fcy))
                    if len(dq) >= 2:
                        pts = np.array(list(dq), dtype=np.int32).reshape((-1, 1, 2))
                        cv2.polylines(
                            frame,
                            [pts],
                            isClosed=False,
                            color=color,
                            thickness=3,
                            lineType=cv2.LINE_AA,
                        )
                cv2.rectangle(frame, (xa, ya), (xb, yb), color, 2)
                cv2.putText(
                    frame,
                    label,
                    (xa, ya - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    1,
                )
                if trail_max >= 2 and show_heading_arrow:
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
                                cv2.arrowedLine(
                                    frame,
                                    p0,
                                    p1,
                                    (0, 0, 0),
                                    5,
                                    lineType=cv2.LINE_AA,
                                    tipLength=0.28,
                                )
                                cv2.arrowedLine(
                                    frame,
                                    p0,
                                    p1,
                                    (255, 255, 255),
                                    3,
                                    lineType=cv2.LINE_AA,
                                    tipLength=0.28,
                                )
                                cv2.circle(frame, p1, 5, (0, 0, 0), -1, lineType=cv2.LINE_AA)
                                cv2.circle(frame, p1, 4, (255, 255, 255), -1, lineType=cv2.LINE_AA)

            moving_now = 0
            stationary_now = 0
            loitering_now = 0
            dwell_values: list[float] = []
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
                    stationary_since_by_id.setdefault(tid, frame_ts)
                    if frame_ts - stationary_since_by_id[tid] >= args.loitering_seconds:
                        loitering_now += 1
                else:
                    moving_now += 1
                    stationary_since_by_id.pop(tid, None)

            occupancy_now = len(current_present_ids)
            avg_dwell_sec = float(sum(dwell_values) / len(dwell_values)) if dwell_values else 0.0
            max_dwell_sec = float(max(dwell_values)) if dwell_values else 0.0
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
            if count_mode == "polygon" and len(poly_pts) >= 3:
                arr = np.array(poly_pts, dtype=np.int32).reshape(-1, 1, 2)
                cv2.polylines(frame, [arr], isClosed=True, color=(255, 200, 0), thickness=2)
                cv2.putText(
                    frame,
                    "ROI poligonal",
                    (20, fh - 20),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 200, 0),
                    2,
                )
                cv2.putText(frame, text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
                cv2.putText(frame, live_text, (20, 76), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            elif count_mode == "polygon":
                cv2.putText(
                    frame,
                    "Defina poligono em /roi (min. 3 pontos)",
                    (20, 36),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    (0, 165, 255),
                    2,
                )
                cv2.putText(frame, text, (20, 72), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
                cv2.putText(frame, live_text, (20, 106), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            else:
                cv2.line(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
                cv2.putText(frame, text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
                cv2.putText(frame, live_text, (20, 76), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
                cv2.putText(
                    frame,
                    "A/B=lados | linha= trajeto | seta (topo bbox)= tendencia (PCA)",
                    (20, fh - 24),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (200, 200, 200),
                    1,
                )

            ok, encoded = cv2.imencode(".jpg", frame)
            if ok:
                with shared.lock:
                    shared.last_frame_jpeg = encoded.tobytes()
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


def create_app(shared: SharedState) -> Flask:
    app = Flask(__name__)
    CORS(app, resources={r"/api/*": {"origins": "*"}, r"/video_feed": {"origins": "*"}})

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
        return jsonify(
            {
                "mode": mode,
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "default_line": {"x1": d1, "y1": d2, "x2": d3, "y2": d4},
                "polygon": poly,
                "default_polygon": pdef,
            }
        )

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
        return jsonify({"ok": True, "mode": m})

    @app.get("/api/stats")
    def stats() -> Response:
        with shared.lock:
            peak_h, peak_v = _peak_hour_stats(shared)
            payload = {
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
        return jsonify(payload)

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
    stop_event = threading.Event()

    t = threading.Thread(target=inference_loop, args=(args, shared, stop_event), daemon=True)
    t.start()

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
        t.join(timeout=8.0)


if __name__ == "__main__":
    main()
