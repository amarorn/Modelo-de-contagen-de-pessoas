#!/usr/bin/env python3
"""Dashboard web para contagem de pessoas em tempo real.

Estatistica agregada por sexo (opcional): nao ha base de dados separada. O ambiente
`.env` pode definir `YOLO_SEX_MODEL` e `YOLO_SEX_ABSTAIN`; `scripts/run_web.sh`
passa-os como `--sex-model` e `--sex-abstain`. `YOLO_SEX_MODEL` e o caminho no
disco para um unico ficheiro de pesos Ultralytics `task=classify` (ex. treino com
`yolo classify`, classes nomeadas female/male ou mulher/homem). Ver
`sex_classifier_agg.OptionalSexClassifier` e docs/04_privacidade_etica.md.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

# Antes de cv2: FFmpeg/libav em streams HLS pode imprimir "non-existing SPS" (join a meio do GOP); nao e fatal.
if os.environ.get("YOLO_WEB_VERBOSE", "").strip() != "1":
    os.environ.setdefault("AV_LOG_LEVEL", "error")

import cv2
import numpy as np
import torch
from flask import Flask, Response, abort, jsonify, request, send_from_directory
from ultralytics import YOLO
from werkzeug.utils import secure_filename

from device_utils import resolve_device
from sex_classifier_agg import OptionalSexClassifier, SexAggregateStats


def _check_tcp_port_available(host: str, port: int) -> None:
    """Falha antes de abrir stream/GPU se a porta HTTP estiver ocupada."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((host, port))
    except OSError as exc:
        print(
            f"[web] ERRO: {host}:{port} indisponivel ({exc}). "
            "Pare a outra instancia do dashboard ou use outra porta, ex.: WEB_PORT=8081 ./scripts/run_web.sh ...",
            file=sys.stderr,
        )
        raise SystemExit(1) from exc


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


class SharedState:
    def __init__(self, line_default: tuple[int, int, int, int]) -> None:
        self.counter = CounterState()
        self.sex_agg = SexAggregateStats()
        self.sex_classifier_enabled: bool = False
        self.started_at = datetime.now()
        self.last_frame_jpeg: bytes | None = None
        self.last_error: str | None = None
        self.lock = threading.Lock()
        self.line_default_px = line_default
        self._line_seed_px: tuple[int, int, int, int] = line_default
        self.line_frac: tuple[float, float, float, float] | None = None
        self.default_line_frac: tuple[float, float, float, float] | None = None
        self.count_mode: str = "line"
        self.polygon_default: list[tuple[int, int]] = []
        self.polygon_live: list[tuple[int, int]] = []
        self.grabber_manager: Any = None  # GrabberManager quando inference inicia
        self.heatmap_overlay_enabled: bool = True
        self.heatmap_available: bool = False
        self.current_source_display: str | int | None = None
        # False = pausa: grabber nao avanca frames; inferencia parada. True = reproduzir.
        self.inference_playing: bool = True
        # Resolucao do frame de inferencia (antes do MJPEG redimensionado); para alinhar overlay web.
        self.inference_frame_w: int = 0
        self.inference_frame_h: int = 0


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


def _ffmpeg_global_opts_for_url(url: str) -> list[str]:
    """Opcoes libav antes de ``-i`` para HLS (ffprobe/ffmpeg)."""
    u = url.lower()
    opts: list[str] = []
    if "m3u8" in u:
        opts += [
            "-protocol_whitelist",
            "file,http,https,tcp,tls,crypto,udp,rtp",
        ]
    opts += [
        "-user_agent",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36",
    ]
    opts += ["-analyzeduration", "10000000", "-probesize", "10000000"]
    return opts


def _ffmpeg_http_headers_for_source(source: str) -> str | None:
    """Cabecalhos HTTP para ffprobe/ffmpeg em URLs (HLS/CDN muitas vezes exige Referer).

    Defina ``FFMPEG_HTTP_HEADERS`` ou ``PREDICT_FFMPEG_HEADERS`` (mesmo formato que
    scripts/predict_deployed_hls_frame.sh). Para skylinewebcams.com usa valores
    padrao se as variaveis estiverem vazias.
    """
    raw = (
        os.environ.get("FFMPEG_HTTP_HEADERS")
        or os.environ.get("PREDICT_FFMPEG_HEADERS")
        or ""
    ).strip()
    if raw:
        return raw if raw.endswith("\r\n") else raw + "\r\n"
    s = str(source).lower()
    if "skylinewebcams.com" in s:
        return (
            "Referer: https://www.skylinewebcams.com/\r\n"
            "Origin: https://www.skylinewebcams.com\r\n"
        )
    return None


def _parse_ffprobe_json_streams(raw: bytes) -> tuple[int, int] | None:
    try:
        data = json.loads(raw.decode())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None

    def wh_from_stream(st: dict) -> tuple[int, int] | None:
        w, h = st.get("width"), st.get("height")
        if w is None or h is None:
            return None
        try:
            iw, ih = int(w), int(h)
        except (TypeError, ValueError):
            return None
        if iw > 1 and ih > 1:
            return iw, ih
        return None

    streams = data.get("streams")
    if isinstance(streams, list):
        for st in streams:
            if isinstance(st, dict):
                got = wh_from_stream(st)
                if got is not None:
                    return got
    programs = data.get("programs")
    if isinstance(programs, list):
        for prog in programs:
            if not isinstance(prog, dict):
                continue
            subs = prog.get("streams")
            if isinstance(subs, list):
                for st in subs:
                    if isinstance(st, dict):
                        got = wh_from_stream(st)
                        if got is not None:
                            return got
    return None


def _probe_resolution_cv2_one_frame(url: str) -> tuple[int, int] | None:
    """Se ffprobe nao obtiver WxH, dimensoes via OpenCV (HLS pode precisar de varios read)."""
    try:
        cap = cv2.VideoCapture(url)
        if not cap.isOpened():
            return None
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        frame = None
        try:
            for _ in range(120):
                ok, frame = cap.read()
                if ok and frame is not None:
                    break
                time.sleep(0.05)
            if frame is None:
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                if w > 1 and h > 1:
                    return w, h
                return None
            fh, fw = frame.shape[:2]
            if fw < 2 or fh < 2:
                return None
            return int(fw), int(fh)
        finally:
            cap.release()
    except Exception:
        return None


def _probe_resolution(source: str | int) -> tuple[int, int] | None:
    """Largura x altura do video: ffprobe (preferencial) ou primeiro frame OpenCV."""
    ffprobe = shutil.which("ffprobe")
    if isinstance(source, int):
        return None
    s = str(source)
    is_net = s.startswith(("http://", "https://", "rtsp://", "rtmp://", "mms://"))

    if ffprobe is not None:
        cmd: list[str] = [ffprobe, "-v", "error"]
        if is_net:
            cmd += _ffmpeg_global_opts_for_url(s)
            hdr = _ffmpeg_http_headers_for_source(s)
            if hdr:
                cmd += ["-headers", hdr]
        cmd += [
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            "-i",
            s,
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=45,
                check=False,
            )
            if proc.returncode == 0 and proc.stdout:
                parsed = _parse_ffprobe_json_streams(proc.stdout)
                if parsed is not None:
                    return parsed
            err = (proc.stderr or b"").decode(errors="replace").strip()
            if err:
                tail = err[-400:] if len(err) > 400 else err
                print(f"[grabber] ffprobe stderr: {tail}")
        except Exception as exc:
            print(f"[grabber] ffprobe falhou: {exc}")

    fb = _probe_resolution_cv2_one_frame(s)
    if fb is not None:
        print(
            "[grabber] resolucao via primeiro frame OpenCV (ffprobe sem WxH ou indisponivel)"
        )
        return fb
    return None


def _source_is_url(source: str | int) -> bool:
    if isinstance(source, int):
        return False
    s = str(source).strip().lower()
    return s.startswith(("http://", "https://", "rtsp://", "rtmp://", "mms://"))


class FrameGrabber:
    """Thread de captura desacoplada: le stream continuamente e guarda apenas o ultimo frame.

    Se ``use_ffmpeg_relay=True`` e o source for URL e ffmpeg estiver instalado,
    usa subprocess ffmpeg para decodificar o stream e le raw BGR24 via pipe,
    reduzindo jitter/rebuffer de HLS. Caso contrario, usa cv2.VideoCapture.
    """

    def __init__(
        self,
        source: str | int,
        vid_stride: int,
        app_stop: threading.Event,
        thread_stop: threading.Event,
        use_ffmpeg_relay: bool = False,
        pause_check: Callable[[], bool] | None = None,
    ) -> None:
        self._source = source
        self._vid_stride = max(1, vid_stride)
        self._app_stop = app_stop
        self._thread_stop = thread_stop
        self._use_ffmpeg = use_ffmpeg_relay
        self._pause_check = pause_check
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._frame_count = 0
        self._grab_ts: float = 0.0

    def _stopped(self) -> bool:
        return self._app_stop.is_set() or self._thread_stop.is_set()

    def _wait_if_paused(self) -> None:
        if self._pause_check is None:
            return
        while self._pause_check() and not self._stopped():
            time.sleep(0.02)

    def run(self) -> None:
        if (
            self._use_ffmpeg
            and _source_is_url(self._source)
            and shutil.which("ffmpeg") is not None
        ):
            self._run_ffmpeg()
        else:
            if self._use_ffmpeg:
                if not _source_is_url(self._source):
                    print("[grabber] ffmpeg relay ignorado: source nao e URL")
                elif shutil.which("ffmpeg") is None:
                    print("[grabber] ffmpeg nao encontrado no PATH; usando cv2 direto")
            self._run_cv2()

    def _run_cv2(self) -> None:
        cap = cv2.VideoCapture(self._source)
        if not cap.isOpened():
            print(f"[grabber] ERRO: nao foi possivel abrir source={self._source!r}", file=sys.stderr)
            return
        print(f"[grabber] cv2 captura iniciada: source={self._source!r} vid_stride={self._vid_stride}")
        try:
            while not self._stopped():
                self._wait_if_paused()
                ok, frame = cap.read()
                if not ok or frame is None:
                    time.sleep(0.005)
                    continue
                self._frame_count += 1
                if self._vid_stride > 1 and (self._frame_count % self._vid_stride) != 0:
                    continue
                with self._lock:
                    self._frame = frame
                    self._grab_ts = time.perf_counter()
        finally:
            cap.release()

    def _run_ffmpeg(self) -> None:
        res = _probe_resolution(self._source)
        if res is None:
            print(
                "[grabber] relay ffmpeg sem resolucao (ffprobe + OpenCV); fallback para cv2"
            )
            self._run_cv2()
            return
        w, h = res
        frame_bytes = w * h * 3
        print(
            f"[grabber] ffmpeg relay iniciado: {w}x{h} source={self._source!r} "
            f"vid_stride={self._vid_stride}"
        )
        src = str(self._source)
        hdr = _ffmpeg_http_headers_for_source(src)
        cmd: list[str] = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-fflags",
            "+nobuffer+discardcorrupt",
            "-flags",
            "low_delay",
        ]
        cmd += _ffmpeg_global_opts_for_url(src)
        if hdr:
            cmd += ["-headers", hdr]
        cmd += [
            "-i",
            src,
            "-an",
            "-c:v",
            "rawvideo",
            "-pix_fmt",
            "bgr24",
            "-f",
            "rawvideo",
            "pipe:1",
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            while not self._stopped():
                self._wait_if_paused()
                raw = proc.stdout.read(frame_bytes)  # type: ignore[union-attr]
                if len(raw) < frame_bytes:
                    if proc.poll() is not None:
                        print("[grabber] ffmpeg encerrou; fallback para cv2")
                        self._run_cv2()
                        return
                    time.sleep(0.005)
                    continue
                frame = np.frombuffer(raw, dtype=np.uint8).reshape((h, w, 3))
                self._frame_count += 1
                if self._vid_stride > 1 and (self._frame_count % self._vid_stride) != 0:
                    continue
                with self._lock:
                    self._frame = frame.copy()
                    self._grab_ts = time.perf_counter()
        finally:
            proc.kill()
            proc.wait()

    def get_latest(self) -> tuple[np.ndarray | None, float]:
        with self._lock:
            f = self._frame
            ts = self._grab_ts
            self._frame = None
            return f, ts


class GrabberManager:
    """Gere o FrameGrabber atual e permite trocar a fonte em runtime (API)."""

    def __init__(
        self,
        initial_source: str | int,
        vid_stride: int,
        app_stop: threading.Event,
        use_ffmpeg_relay: bool,
        pause_check: Callable[[], bool] | None = None,
    ) -> None:
        self._app_stop = app_stop
        self._vid_stride = vid_stride
        self._use_ffmpeg = use_ffmpeg_relay
        self._pause_check = pause_check
        self._lock = threading.Lock()
        self._thread_stop = threading.Event()
        self._grabber: FrameGrabber | None = None
        self._thread: threading.Thread | None = None
        self._source: str | int = initial_source
        self._start_locked()

    def _start_locked(self) -> None:
        self._thread_stop.clear()
        self._grabber = FrameGrabber(
            self._source,
            self._vid_stride,
            self._app_stop,
            self._thread_stop,
            self._use_ffmpeg,
            self._pause_check,
        )
        self._thread = threading.Thread(target=self._grabber.run, daemon=True)
        self._thread.start()

    def get_latest(self) -> tuple[np.ndarray | None, float]:
        g = self._grabber
        if g is None:
            return None, 0.0
        return g.get_latest()

    @property
    def current_source(self) -> str | int:
        return self._source

    def swap(self, new_source: str | int) -> None:
        with self._lock:
            self._thread_stop.set()
            if self._thread is not None:
                self._thread.join(timeout=10.0)
            self._source = new_source
            self._thread_stop = threading.Event()
            self._start_locked()


def _is_probably_youtube_url(url: str) -> bool:
    u = url.strip().lower()
    return "youtube.com/" in u or "youtu.be/" in u


def resolve_youtube_stream_url(url: str) -> str | None:
    """Resolve URL HLS/mp4 direta via yt-dlp (mesma ideia que scripts/run_web.sh)."""
    bin_path = shutil.which("yt-dlp")
    if bin_path is None:
        return None
    try:
        out = subprocess.check_output(
            [bin_path, "-g", "-f", "best[height<=720]", url],
            stderr=subprocess.DEVNULL,
            timeout=120,
            text=True,
        )
        lines = [ln.strip() for ln in out.strip().splitlines() if ln.strip()]
        return lines[-1] if lines else None
    except (subprocess.CalledProcessError, OSError, subprocess.TimeoutExpired) as exc:
        print(f"[web] yt-dlp falhou: {exc}", file=sys.stderr)
        return None


def coerce_source_value(raw: str) -> tuple[str | int, str]:
    """Retorna (fonte para OpenCV, texto para UI)."""
    s = raw.strip()
    if not s:
        raise ValueError("Fonte vazia")
    if s.isdigit():
        return int(s), s
    if _is_probably_youtube_url(s):
        resolved = resolve_youtube_stream_url(s)
        if not resolved:
            raise ValueError(
                "Falha ao resolver YouTube (instale yt-dlp no venv e atualize o cliente)"
            )
        return resolved, s
    return s, s


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Dashboard web do contador de pessoas")
    p.add_argument("--model", required=True)
    p.add_argument("--source", default="0", help="camera index, arquivo ou rtsp://")
    p.add_argument(
        "--line",
        default="0,540,1919,540",
        help="x1,y1,x2,y2 em pixels do frame (padrao: linha horizontal em toda a largura, eixo medio 1080p; o clamp adapta a resolucao)",
    )
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
        "--hide-stale-boxes",
        action="store_true",
        help="Nao desenha caixas sem deteccao atual (posicao 'stale'). Reduz caixas que ficam no sitio apos a pessoa sair.",
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
        "--min-det-conf",
        type=float,
        default=None,
        help=(
            "Opcional: descarta deteccoes com conf < este valor (apos o tracker). "
            "Util com --conf mais baixo para o tracker e limiar mais alto para exibir/contar. "
            "Reduz falsos positivos em texturas (chao, barcos)."
        ),
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
        "--ffmpeg-relay",
        action="store_true",
        help="Usa ffmpeg como relay para decodificar o stream (reduz jitter HLS). Requer ffmpeg instalado.",
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


def pixels_to_frac(
    x1: int, y1: int, x2: int, y2: int, fw: int, fh: int
) -> tuple[float, float, float, float]:
    """Normaliza a linha para [0,1] em relacao ao frame, para escalar com a resolucao."""
    if fw < 2 or fh < 2:
        return (0.0, 0.0, 0.0, 0.0)

    def nf(v: int, m: int) -> float:
        return max(0.0, min(1.0, float(v) / float(m - 1)))

    return (nf(x1, fw), nf(y1, fh), nf(x2, fw), nf(y2, fh))


def frac_to_pixels(
    frac: tuple[float, float, float, float], fw: int, fh: int
) -> tuple[int, int, int, int]:
    if fw < 1 or fh < 1:
        return (0, 0, 0, 0)
    fx1, fy1, fx2, fy2 = frac

    def p(t: float, m: int) -> int:
        if m <= 1:
            return 0
        return int(max(0, min(m - 1, round(t * (m - 1)))))

    return (p(fx1, fw), p(fy1, fh), p(fx2, fw), p(fy2, fh))


def line_pixels_for_frame(
    shared: SharedState, fw: int, fh: int
) -> tuple[int, int, int, int]:
    """Segmento em pixels para o frame atual; usa line_frac se ja inicializado."""
    with shared.lock:
        lf = shared.line_frac
        seed = shared._line_seed_px
    if fw >= 1 and fh >= 1 and lf is not None:
        return frac_to_pixels(lf, fw, fh)
    if fw >= 1 and fh >= 1:
        return clamp_line(*seed, fw, fh)
    return seed


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


def apply_min_det_conf_filter(result: Any, min_c: float | None) -> None:
    """Remove deteccoes com conf abaixo do limiar (in-place em result.boxes)."""
    if min_c is None or result is None or result.boxes is None or len(result.boxes) == 0:
        return
    keep = result.boxes.conf >= min_c
    if bool(keep.all()):
        return
    if not bool(keep.any()):
        result.boxes = None
        return
    result.boxes = result.boxes[keep]


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
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["started_at", "finished_at", "entries", "exits", "total_passages"]
    if sex is not None:
        fields += ["sex_female_agg", "sex_male_agg", "sex_unknown_agg"]
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
            _ld = shared._line_seed_px
            _mode = shared.count_mode
            _np = len(shared.polygon_live)
        print(
            f"[web] Modo contagem={_mode} | linha (pixels seed): {_ld} | poligono: {_np} vertices. "
            "Linha: pes cruzam segmento. Poligono: entrada/saida pela area (UI /roi)."
        )
        source = int(args.source) if args.source.isdigit() else args.source
        validate_source(source)
        if isinstance(source, str) and Path(source).is_file():
            with shared.lock:
                shared.inference_playing = False

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

        last_side_by_id: dict[int, float] = {}
        prev_inside_by_id: dict[int, bool] = {}
        prev_config_sig: str | None = None
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

        with shared.lock:
            shared.heatmap_available = heat is not None
            shared.heatmap_overlay_enabled = heat is not None

        tracker_yaml = resolve_tracker_yaml(args.tracker)
        box_overlay = TrackBoxOverlay(args.track_ema, args.track_hold_frames)
        print(
            f"[web] tracker={tracker_yaml} track_ema={args.track_ema} "
            f"track_hold_frames={args.track_hold_frames} hide_stale_boxes={args.hide_stale_boxes}"
        )
        if args.no_shape_filter:
            print("[web] Filtro de forma desligado (--no-shape-filter)")
        else:
            print(
                f"[web] Filtro de forma ativo: ar=[{args.min_person_ar},{args.max_person_ar}] "
                f"max_area_frac={args.max_box_area_frac} min_h_px={args.min_person_height_px}"
            )
        if args.min_det_conf is not None:
            print(f"[web] Filtro extra por confianca por bbox: min_det_conf={args.min_det_conf} (alem de conf={args.conf})")
            if args.min_det_conf <= args.conf:
                print(
                    "[web] AVISO: defina min_det_conf > conf (ex. conf=0.25 e min_det_conf=0.42) para filtrar falsos positivos.",
                    file=sys.stderr,
                )

        track_kw: dict = {
            "conf": args.conf,
            "iou": args.iou,
            "imgsz": args.imgsz,
            "max_det": args.max_det,
            "classes": [person_class_id],
            "tracker": tracker_yaml,
            "persist": True,
            "verbose": False,
            "device": resolved_device,
        }
        if use_half:
            track_kw["half"] = True
        if args.augment:
            track_kw["augment"] = True
        if args.agnostic_nms:
            track_kw["agnostic_nms"] = True

        def pause_when_not_playing() -> bool:
            with shared.lock:
                return not shared.inference_playing

        mgr = GrabberManager(
            source,
            args.vid_stride,
            stop_event,
            args.ffmpeg_relay,
            pause_check=pause_when_not_playing,
        )
        with shared.lock:
            shared.grabber_manager = mgr
            shared.current_source_display = (
                str(source) if not isinstance(source, int) else source
            )

        _pmw = os.environ.get("YOLO_WEB_PREVIEW_MAX_WIDTH", "").strip()
        preview_max_w = int(_pmw) if _pmw.isdigit() else 0
        _jq = os.environ.get("YOLO_WEB_JPEG_QUALITY", "").strip()
        jpeg_q: int | None = int(_jq) if _jq.isdigit() else None
        if jpeg_q is not None:
            jpeg_q = max(40, min(95, jpeg_q))
        if preview_max_w > 0 or jpeg_q is not None:
            print(
                f"[web] MJPEG para o browser: "
                f"preview_max_width={preview_max_w if preview_max_w > 0 else 'full'} "
                f"jpeg_quality={jpeg_q if jpeg_q is not None else 'opencv default'}"
            )

        last_frame_ts = time.perf_counter()
        fps_ema = 0.0
        inf_ms_ema = 0.0
        enc_ms_ema = 0.0

        while not stop_event.is_set():
            frame, grab_ts = mgr.get_latest()
            if frame is None:
                time.sleep(0.005)
                continue

            now_ts = time.perf_counter()
            dt = max(1e-6, now_ts - last_frame_ts)
            last_frame_ts = now_ts
            inst_fps = 1.0 / dt
            fps_ema = inst_fps if fps_ema <= 0.0 else 0.90 * fps_ema + 0.10 * inst_fps
            cap_ms = max(0.0, (now_ts - grab_ts) * 1000.0) if grab_ts > 0.0 else 0.0

            t_inf_0 = time.perf_counter()
            results = model.track(frame, **track_kw)
            t_inf_1 = time.perf_counter()
            inf_ms = (t_inf_1 - t_inf_0) * 1000.0
            inf_ms_ema = inf_ms if inf_ms_ema <= 0.0 else 0.90 * inf_ms_ema + 0.10 * inf_ms

            result = results[0] if results else None
            if result is None:
                continue
            apply_min_det_conf_filter(result, args.min_det_conf)

            fh, fw = frame.shape[:2]
            with shared.lock:
                shared.inference_frame_w = int(fw)
                shared.inference_frame_h = int(fh)
                if shared.line_frac is None:
                    shared.line_frac = pixels_to_frac(*shared._line_seed_px, fw, fh)
                if shared.default_line_frac is None:
                    shared.default_line_frac = pixels_to_frac(
                        *shared.line_default_px, fw, fh
                    )
                raw_line = line_pixels_for_frame(shared, fw, fh)
                count_mode = shared.count_mode
                poly_raw = list(shared.polygon_live)
            cfg_sig = f"{count_mode}|{raw_line}|{poly_raw}"
            if prev_config_sig is not None and cfg_sig != prev_config_sig:
                last_side_by_id.clear()
                prev_inside_by_id.clear()
            prev_config_sig = cfg_sig

            x1, y1, x2, y2 = clamp_line(*raw_line, fw, fh)
            poly_pts = clamp_polygon(poly_raw, fw, fh) if len(poly_raw) >= 3 else []

            entry_boxes: list[tuple[float, float, float, float]] = []

            foot_points: list[tuple[float, float]] = []

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
                with shared.lock:
                    _show_heat = shared.heatmap_overlay_enabled
                if _show_heat:
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
                    if count_mode == "polygon" and len(poly_pts) >= 3:
                        inside = foot_inside_polygon(foot_x, foot_y, poly_pts)
                        with shared.lock:
                            prev_b = prev_inside_by_id.get(track_id)
                            if prev_b is not None and not prev_b and inside:
                                shared.counter.entries += 1
                                entry_boxes.append((x_min, y_min, x_max, y_max))
                            elif prev_b is not None and prev_b and not inside:
                                shared.counter.exits += 1
                        prev_inside_by_id[track_id] = inside
                    elif count_mode == "line":
                        side = side_of_line(foot_x, foot_y, x1, y1, x2, y2)
                        with shared.lock:
                            prev = last_side_by_id.get(track_id)
                            if prev is not None and prev < 0 <= side:
                                shared.counter.entries += 1
                                entry_boxes.append((x_min, y_min, x_max, y_max))
                            elif prev is not None and prev > 0 >= side:
                                shared.counter.exits += 1
                        last_side_by_id[track_id] = side

                if sex_clf and sex_clf.enabled and entry_boxes and frame is not None:
                    for box in entry_boxes:
                        bucket = sex_clf.classify_crop(frame, box)
                        with shared.lock:
                            if bucket == "female":
                                shared.sex_agg.female += 1
                            elif bucket == "male":
                                shared.sex_agg.male += 1
                            else:
                                shared.sex_agg.unknown += 1

            draw_items = box_overlay.step(ids_list, xys_raw)
            active_ids = {t for t, _, _ in draw_items}
            for tid in list(last_side_by_id.keys()):
                if tid not in active_ids:
                    del last_side_by_id[tid]
            for tid in list(prev_inside_by_id.keys()):
                if tid not in active_ids:
                    del prev_inside_by_id[tid]

            for track_id, (xa, ya, xb, yb), stale in draw_items:
                if args.hide_stale_boxes and stale:
                    continue
                color = (0, 200, 100) if stale else (0, 255, 0)
                cv2.rectangle(frame, (xa, ya), (xb, yb), color, 2)
                label = f"id={track_id}" + (" ~" if stale else "")
                cv2.putText(
                    frame,
                    label,
                    (xa, ya - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    color,
                    1,
                )

            with shared.lock:
                text = f"in={shared.counter.entries} out={shared.counter.exits} total={shared.counter.total}"
            if count_mode == "polygon" and len(poly_pts) >= 3:
                arr = np.array(poly_pts, dtype=np.int32).reshape(-1, 1, 2)
                cv2.polylines(
                    frame,
                    [arr],
                    isClosed=True,
                    color=(255, 200, 0),
                    thickness=2,
                    lineType=cv2.LINE_AA,
                )
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
            else:
                cv2.line(frame, (x1, y1), (x2, y2), (0, 0, 255), 2, cv2.LINE_AA)
                cv2.putText(frame, text, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)

            cv2.putText(
                frame,
                f"fps={fps_ema:.1f} inf={inf_ms_ema:.0f}ms cap={cap_ms:.0f}ms enc={enc_ms_ema:.0f}ms",
                (20, 76),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (40, 220, 255),
                2,
            )

            send_frame = frame
            if preview_max_w > 0:
                fh0, fw0 = frame.shape[:2]
                if fw0 > preview_max_w:
                    scale = preview_max_w / float(fw0)
                    send_frame = cv2.resize(
                        frame,
                        (preview_max_w, int(round(fh0 * scale))),
                        interpolation=cv2.INTER_AREA,
                    )

            t_enc_0 = time.perf_counter()
            if jpeg_q is None:
                ok, encoded = cv2.imencode(".jpg", send_frame)
            else:
                ok, encoded = cv2.imencode(
                    ".jpg",
                    send_frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_q],
                )
            t_enc_1 = time.perf_counter()
            enc_ms = (t_enc_1 - t_enc_0) * 1000.0
            enc_ms_ema = enc_ms if enc_ms_ema <= 0.0 else 0.90 * enc_ms_ema + 0.10 * enc_ms
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
      .video-wrap { display: block; width: 100%; max-width: 100%; position: relative; line-height: 0; text-align: center; }
      #roiFeed { width: auto; height: auto; max-width: 100%; max-height: 90vh; border-radius: 8px; border: 1px solid #444; display: inline-block; vertical-align: top; }
      #roiCanvas { position: absolute; left: 0; top: 0; cursor: crosshair; border-radius: 8px; }
      button { padding: 8px 12px; margin: 8px 8px 0 0; }
      .hint { color: #aaa; font-size: 14px; max-width: 720px; line-height: 1.45; }
      ul { color: #bbb; }
    </style>
  </head>
  <body>
    <p><a href="/" target="_top">&larr; Voltar ao dashboard</a></p>
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

_REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = _REPO_ROOT / "frontend" / "dist"

_LEGACY_INDEX_HTML = """<!doctype html>
<html lang="pt"><head><meta charset="utf-8"/><title>People Counter</title></head>
<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;padding:1.5rem;max-width:52rem">
  <h2>Dashboard React nao compilado</h2>
  <p>Na raiz do repositorio execute:</p>
  <pre style="background:#1a1a1a;padding:12px;border-radius:8px;overflow:auto">cd frontend &amp;&amp; npm install &amp;&amp; npm run build</pre>
  <p>Depois reinicie o servidor Flask. Endpoints: <a href="/api/stats" style="color:#6cf">/api/stats</a>,
  <a href="/video_feed" style="color:#6cf">/video_feed</a>, <a href="/roi" style="color:#6cf">/roi</a>.</p>
</body></html>"""


def create_app(shared: SharedState) -> Flask:
    app = Flask(__name__)

    @app.get("/roi")
    def roi_page():
        idx = FRONTEND_DIST / "index.html"
        if idx.is_file():
            return send_from_directory(FRONTEND_DIST, "index.html")
        return _ROI_PAGE_HTML

    @app.get("/")
    def index():
        idx = FRONTEND_DIST / "index.html"
        if idx.is_file():
            return send_from_directory(FRONTEND_DIST, "index.html")
        return _LEGACY_INDEX_HTML

    @app.get("/assets/<path:fname>")
    def spa_assets(fname: str):
        d = FRONTEND_DIST / "assets"
        if not d.is_dir():
            abort(404)
        return send_from_directory(d, fname)

    @app.get("/api/config")
    def get_config() -> Response:
        with shared.lock:
            mode = shared.count_mode
            poly = [{"x": a, "y": b} for a, b in shared.polygon_live]
            pdef = [{"x": a, "y": b} for a, b in shared.polygon_default]
            hm_avail = shared.heatmap_available
            hm_on = shared.heatmap_overlay_enabled
            cur = shared.current_source_display
            playing = shared.inference_playing
            iw, ih = shared.inference_frame_w, shared.inference_frame_h
        if iw > 0 and ih > 0:
            x1, y1, x2, y2 = line_pixels_for_frame(shared, iw, ih)
            with shared.lock:
                dlf = shared.default_line_frac
                ldp = shared.line_default_px
            if dlf is not None:
                d1, d2, d3, d4 = frac_to_pixels(dlf, iw, ih)
            else:
                d1, d2, d3, d4 = clamp_line(*ldp, iw, ih)
        else:
            with shared.lock:
                x1, y1, x2, y2 = shared._line_seed_px
                d1, d2, d3, d4 = shared.line_default_px
        inf_size = (
            {"w": iw, "h": ih}
            if iw > 0 and ih > 0
            else None
        )
        return jsonify(
            {
                "mode": mode,
                "line": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "default_line": {"x1": d1, "y1": d2, "x2": d3, "y2": d4},
                "polygon": poly,
                "default_polygon": pdef,
                "heatmap_available": hm_avail,
                "heatmap_overlay_enabled": hm_on,
                "current_source": cur,
                "inference_playing": playing,
                "inference_size": inf_size,
            }
        )

    @app.post("/api/source")
    def post_source() -> Response:
        mgr = getattr(shared, "grabber_manager", None)
        if mgr is None:
            return jsonify({"error": "Captura ainda nao iniciada"}), 503
        data = request.get_json(silent=True) or {}
        raw = data.get("source")
        if raw is None:
            return jsonify({"error": "Campo source obrigatorio"}), 400
        reset_counters = bool(data.get("reset_counters", False))
        try:
            if isinstance(raw, int):
                src: str | int = raw
                disp: str | int = raw
            else:
                s = str(raw).strip()
                if not s:
                    return jsonify({"error": "Fonte vazia"}), 400
                src, disp = coerce_source_value(s)
            if isinstance(src, int):
                validate_source(src)
            mgr.swap(src)
            with shared.lock:
                shared.current_source_display = disp
                shared.last_frame_jpeg = None
                shared.last_error = None
                if reset_counters:
                    reset_entry_exit_counters(shared)
                if isinstance(src, str) and Path(src).is_file():
                    shared.inference_playing = False
                else:
                    shared.inference_playing = True
            return jsonify({"ok": True, "source": disp})
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.post("/api/upload")
    def post_upload() -> Response:
        mgr = getattr(shared, "grabber_manager", None)
        if mgr is None:
            return jsonify({"error": "Captura ainda nao iniciada"}), 503
        max_mb = int(os.environ.get("WEB_UPLOAD_MAX_MB", "512"))
        max_bytes = max(1, max_mb) * 1024 * 1024
        cl = request.content_length
        if cl is not None and cl > max_bytes:
            return jsonify({"error": f"Ficheiro demasiado grande (max {max_mb} MB)"}), 413
        f = request.files.get("file")
        if f is None or not f.filename:
            return jsonify({"error": "Campo file em falta"}), 400
        raw_name = secure_filename(f.filename)
        ext = Path(raw_name).suffix.lower()
        if ext not in (".mp4", ".webm", ".mov"):
            return jsonify({"error": "Extensao permitida: .mp4, .webm, .mov"}), 400
        upload_dir = _REPO_ROOT / "outputs" / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        name = f"{uuid.uuid4().hex}{ext}"
        path = upload_dir / name
        try:
            f.save(str(path))
            resolved = str(path.resolve())
            mgr.swap(resolved)
            with shared.lock:
                shared.current_source_display = resolved
                shared.last_frame_jpeg = None
                shared.last_error = None
                shared.inference_playing = False
            return jsonify({"ok": True, "path": resolved})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.post("/api/heatmap")
    def post_heatmap() -> Response:
        data = request.get_json(silent=True) or {}
        en = data.get("enabled")
        if not isinstance(en, bool):
            return jsonify({"error": "enabled (boolean) obrigatorio"}), 400
        with shared.lock:
            if not shared.heatmap_available:
                return jsonify({"error": "Heatmap indisponivel (servidor com --no-heatmap)"}), 400
            shared.heatmap_overlay_enabled = en
        return jsonify({"ok": True, "enabled": en})

    @app.post("/api/playback")
    def post_playback() -> Response:
        data = request.get_json(silent=True) or {}
        playing = data.get("playing")
        if not isinstance(playing, bool):
            return jsonify({"error": "playing (boolean) obrigatorio"}), 400
        with shared.lock:
            shared.inference_playing = playing
        return jsonify({"ok": True, "inference_playing": playing})

    @app.get("/api/line")
    def get_line() -> Response:
        with shared.lock:
            mode = shared.count_mode
            iw, ih = shared.inference_frame_w, shared.inference_frame_h
            poly = [{"x": a, "y": b} for a, b in shared.polygon_live]
        if iw > 0 and ih > 0:
            x1, y1, x2, y2 = line_pixels_for_frame(shared, iw, ih)
            with shared.lock:
                dlf = shared.default_line_frac
                ldp = shared.line_default_px
            if dlf is not None:
                d1, d2, d3, d4 = frac_to_pixels(dlf, iw, ih)
            else:
                d1, d2, d3, d4 = clamp_line(*ldp, iw, ih)
        else:
            with shared.lock:
                x1, y1, x2, y2 = shared._line_seed_px
                d1, d2, d3, d4 = shared.line_default_px
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
            iw, ih = shared.inference_frame_w, shared.inference_frame_h
            if iw > 0 and ih > 0:
                shared.line_frac = pixels_to_frac(x1, y1, x2, y2, iw, ih)
            else:
                shared.line_frac = None
            shared._line_seed_px = (x1, y1, x2, y2)
            if reset_counters:
                reset_entry_exit_counters(shared)
        if iw > 0 and ih > 0:
            ox1, oy1, ox2, oy2 = line_pixels_for_frame(shared, iw, ih)
        else:
            ox1, oy1, ox2, oy2 = x1, y1, x2, y2
        return jsonify(
            {
                "ok": True,
                "line": {"x1": ox1, "y1": oy1, "x2": ox2, "y2": oy2},
            }
        )

    @app.post("/api/line/reset")
    def reset_line() -> Response:
        data = request.get_json(silent=True) or {}
        reset_counters = bool(data.get("reset_counters", False))
        with shared.lock:
            iw, ih = shared.inference_frame_w, shared.inference_frame_h
            if shared.default_line_frac is not None:
                shared.line_frac = shared.default_line_frac
            else:
                shared.line_frac = None
            shared._line_seed_px = shared.line_default_px
            if reset_counters:
                reset_entry_exit_counters(shared)
        if iw > 0 and ih > 0:
            x1, y1, x2, y2 = line_pixels_for_frame(shared, iw, ih)
        else:
            with shared.lock:
                x1, y1, x2, y2 = shared._line_seed_px
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
            iw, ih = shared.inference_frame_w, shared.inference_frame_h
            payload = {
                "entries": shared.counter.entries,
                "exits": shared.counter.exits,
                "total_passages": shared.counter.total,
                "error": shared.last_error,
                "sex_classifier_enabled": shared.sex_classifier_enabled,
                "sex_female_agg": shared.sex_agg.female,
                "sex_male_agg": shared.sex_agg.male,
                "sex_unknown_agg": shared.sex_agg.unknown,
                "inference_playing": shared.inference_playing,
                "inference_size": (
                    {"w": iw, "h": ih} if iw > 0 and ih > 0 else None
                ),
            }
        return jsonify(payload)

    @app.post("/api/export")
    def export_csv() -> Response:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_path = Path("outputs") / f"count_summary_web_{ts}.csv"
        with shared.lock:
            sex = shared.sex_agg if shared.sex_classifier_enabled else None
            write_summary_csv(csv_path, shared.counter, shared.started_at, sex=sex)
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
    _check_tcp_port_available(args.host, args.port)
    line_init = tuple(int(v) for v in args.line.split(","))
    shared = SharedState(line_default=line_init)
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
