#!/usr/bin/env python3
"""Extrai frames de URL HLS/RTSP/video via OpenCV (mesma stack que o dashboard).

Usar quando `ffmpeg -i URL` devolve Input/output error. Carrega OPENCV_FFMPEG_CAPTURE_OPTIONS
do .env na raiz do repo, se existir (igual a scripts/run_web.sh).

Exemplo:
  ./.venv/bin/python scripts/extract_frames_opencv.py 'https://...m3u8...' -o data/person_count/images/staging --fps 0.5 --duration 120
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_env_opencv_options() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("OPENCV_FFMPEG_CAPTURE_OPTIONS="):
            _, _, rest = line.partition("=")
            rest = rest.strip().strip('"').strip("'")
            if rest:
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = rest
            return


def _configure_quiet_capture_logs() -> None:
    """Reduz spam libav no stderr antes de importar cv2."""
    if os.environ.get("YOLO_WEB_VERBOSE", "").strip() == "1":
        return
    os.environ.setdefault("AV_LOG_LEVEL", "error")


def main() -> None:
    p = argparse.ArgumentParser(description="Extrai frames para dataset YOLO (fallback OpenCV)")
    p.add_argument("url", help="URL m3u8, rtsp ou caminho de ficheiro")
    p.add_argument("-o", "--out-dir", required=True, type=Path)
    p.add_argument("--fps", type=float, default=1.0, help="Frames a guardar por segundo")
    p.add_argument(
        "--duration",
        type=float,
        default=0.0,
        help="Segundos a capturar (0 = ate Ctrl+C)",
    )
    p.add_argument("--max-frames", type=int, default=0, help="Parar apos N frames (0 = sem limite)")
    p.add_argument(
        "--warmup-reads",
        type=int,
        default=45,
        help="Descartar N leituras iniciais para o decoder H.264 sincronizar (0 = desligado)",
    )
    args = p.parse_args()

    _load_env_opencv_options()
    _configure_quiet_capture_logs()

    import cv2  # noqa: E402 — depois de OPENCV_FFMPEG_CAPTURE_OPTIONS e AV_LOG_LEVEL

    try:
        import cv2.utils.logging as cv2_log

        cv2_log.setLogLevel(cv2_log.LOG_LEVEL_ERROR)
    except Exception:
        pass

    print(
        "[extract_cv] A ligar ao stream (avisos 'non-existing SPS' em HLS ao vivo sao normais; aguarde os primeiros frames)...",
        file=sys.stderr,
    )

    out = args.out_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(args.url)
    if not cap.isOpened():
        print("[extract_cv] ERRO: nao foi possivel abrir a fonte (mesmo erro que cv2 no dashboard).", file=sys.stderr)
        print("[extract_cv] Atualize o token na URL ou teste a mesma URL em ./scripts/run_web.sh", file=sys.stderr)
        raise SystemExit(1)

    # Detectar se a fonte e ficheiro (decode a velocidade maxima) ou stream ao vivo.
    # Em ficheiro: usar decimacao por contagem de frames ancorada no FPS da fonte.
    # Em stream: manter a logica de wall-clock (a cadencia real tempo-e-a-mesma do stream).
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    is_file = frame_count > 0 and src_fps > 0.0

    if args.warmup_reads > 0 and not is_file:
        for _ in range(args.warmup_reads):
            cap.read()

    target_fps = max(0.05, float(args.fps))
    step_frames = max(1, int(round(src_fps / target_fps))) if is_file else 0
    interval = 1.0 / target_fps
    t_start = time.perf_counter()
    last_write = t_start - interval
    n_saved = 0
    idx = 0
    src_idx = -1

    if is_file:
        print(
            f"[extract_cv] ficheiro: {frame_count} frames @ {src_fps:.2f} fps -> guardar 1 a cada {step_frames} frames (alvo {target_fps} fps)",
            file=sys.stderr,
        )

    try:
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                if not is_file:
                    print("[extract_cv] aviso: read() falhou ou fim do stream", file=sys.stderr)
                break
            src_idx += 1
            if is_file:
                if src_idx % step_frames != 0:
                    continue
            else:
                now = time.perf_counter()
                if now - last_write < interval:
                    continue
                last_write = now
            idx += 1
            path = out / f"frame_{idx:06d}.jpg"
            cv2.imwrite(str(path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
            n_saved += 1
            if args.max_frames and n_saved >= args.max_frames:
                break
            if not is_file and args.duration > 0:
                if (time.perf_counter() - t_start) >= args.duration:
                    break
    finally:
        cap.release()

    print(f"[extract_cv] Guardados {n_saved} frames em {out}")
    if n_saved == 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
