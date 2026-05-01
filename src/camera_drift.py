"""Camera drift detector.

6.3 — Detects three types of camera degradation without any external reference:

  * illumination  — mean brightness drifts beyond ±40% of baseline
  * focus         — blur score drops below 50% of baseline (Laplacian variance)
  * position      — background mean-absolute-difference spikes, indicating the
                    camera was moved or its FOV changed

The detector establishes a baseline during a warmup period (first
WARMUP_FRAMES stable frames), then monitors each sampled frame against it.

All thresholds are relative to the baseline, so they adapt automatically to
different scenes (dark warehouse vs bright atrium).
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np


def _env_float(key: str, default: float) -> float:
    raw = os.environ.get(key, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _clamp_unit(v: float) -> float:
    return max(0.05, min(0.98, v))


def _clamp_mad_frac(v: float) -> float:
    """Scale for excess MAD vs baseline*frac; larger = less sensitive (crowded/dynamic BG)."""
    return max(0.04, min(3.0, v))


# ── Tunables ──────────────────────────────────────────────────────────────────

WARMUP_FRAMES: int = 90           # frames before baseline is locked
SAMPLE_EVERY:  int = 15           # check every N frames (≈ 2× per second at 30fps)

# Drift triggers relative to baseline
ILLUM_DRIFT_FRAC:    float = 0.40  # |brightness_now - baseline| / baseline
FOCUS_LOSS_FRAC:     float = 0.50  # blur_now < baseline * (1 - FOCUS_LOSS_FRAC)
# score = (mad - baseline_mad) / (baseline_mad * frac). Env CAM_DRIFT_POSITION_MAD_FRAC (default 0.12).
# Em ruas/crowds o score satura a 100% com frac=0.12; use 1.0–2.5 para fundos muito dinâmicos.
POSITION_MAD_FRAC: float = _clamp_mad_frac(
    _env_float("CAM_DRIFT_POSITION_MAD_FRAC", 0.12)
)
# Normalised position_score in [0, 1]; alert when >= this. Env: CAM_DRIFT_POSITION_THRESHOLD (default 0.45).
POSITION_ALERT_THRESHOLD: float = _clamp_unit(
    _env_float("CAM_DRIFT_POSITION_THRESHOLD", 0.45)
)

# EMA alpha for real-time metrics
_EMA: float = 0.12


@dataclass
class DriftState:
    level: str = "ok"          # "ok" | "illumination" | "focus" | "position"
    score: float = 0.0         # 0-1 severity
    reason: str = ""
    baseline_ready: bool = False
    # Raw metrics (latest)
    brightness: float = 0.0
    blur: float = 0.0
    bg_mad: float = 0.0        # mean-absolute-difference from reference background
    # Baselines
    baseline_brightness: float = 0.0
    baseline_blur: float = 0.0
    baseline_bg_mad: float = 0.0


class CameraDriftDetector:
    """Incrementally detects camera drift from a session-start baseline."""

    def __init__(self) -> None:
        self._state = DriftState()
        self._frame_count: int = 0
        self._warmup_brightness: list[float] = []
        self._warmup_blur: list[float] = []
        self._ref_frame: np.ndarray | None = None   # low-res grayscale reference
        # EMA of running metrics
        self._brightness_ema: float = 0.0
        self._blur_ema: float = 0.0
        self._bg_mad_ema: float = 0.0
        self._last_check: float = 0.0

    # ── Public API ─────────────────────────────────────────────────────────────

    def update(self, frame: np.ndarray) -> DriftState:
        """Process one frame and return the current drift state."""
        self._frame_count += 1

        # Downsample once for all metrics
        small = cv2.resize(frame, (160, 90))
        gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        brightness = float(gray.mean())
        blur       = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        # Update EMAs
        if self._brightness_ema <= 0:
            self._brightness_ema = brightness
        else:
            self._brightness_ema = _EMA * brightness + (1 - _EMA) * self._brightness_ema

        if self._blur_ema <= 0:
            self._blur_ema = blur
        else:
            self._blur_ema = _EMA * blur + (1 - _EMA) * self._blur_ema

        self._state.brightness = self._brightness_ema
        self._state.blur       = self._blur_ema

        # Background difference
        if self._ref_frame is not None:
            mad = float(np.abs(gray.astype(np.float32) - self._ref_frame).mean())
            if self._bg_mad_ema <= 0:
                self._bg_mad_ema = mad
            else:
                self._bg_mad_ema = _EMA * mad + (1 - _EMA) * self._bg_mad_ema
            self._state.bg_mad = self._bg_mad_ema

        # ── Warmup phase ──────────────────────────────────────────────────────
        if not self._state.baseline_ready:
            self._warmup_brightness.append(brightness)
            self._warmup_blur.append(blur)
            if self._frame_count == WARMUP_FRAMES // 2:
                # Lock reference background at the midpoint
                self._ref_frame = gray.astype(np.float32)
            if self._frame_count >= WARMUP_FRAMES:
                self._state.baseline_brightness = float(np.median(self._warmup_brightness))
                self._state.baseline_blur       = float(np.median(self._warmup_blur))
                self._state.baseline_bg_mad     = self._bg_mad_ema
                self._state.baseline_ready      = True
            return self._state

        # ── Detection phase (sample every N frames) ───────────────────────────
        if self._frame_count % SAMPLE_EVERY != 0:
            return self._state

        self._detect()
        return self._state

    def reset_baseline(self) -> None:
        """Force re-learn of baseline (call after intentional camera move)."""
        self.__init__()

    @property
    def state(self) -> DriftState:
        return self._state

    # ── Internal ───────────────────────────────────────────────────────────────

    def _detect(self) -> None:
        s = self._state
        bb = s.baseline_brightness
        bblur = s.baseline_blur
        bbg = s.baseline_bg_mad

        if bb <= 0:
            return

        # 1. Position drift (highest priority — camera physically moved)
        if bbg > 0:
            position_score = max(0.0, (self._bg_mad_ema - bbg) / (bbg * POSITION_MAD_FRAC + 1e-9))
            position_score = min(1.0, position_score)
        else:
            position_score = 0.0

        if position_score >= POSITION_ALERT_THRESHOLD:
            s.level  = "position"
            s.score  = min(1.0, position_score)
            s.reason = (
                f"Fundo desviou {self._bg_mad_ema:.1f} vs baseline {bbg:.1f} "
                f"(score {position_score*100:.0f}%)"
            )
            return

        # 2. Focus loss
        if bblur > 0:
            blur_ratio = self._blur_ema / (bblur + 1e-9)
            if blur_ratio < (1 - FOCUS_LOSS_FRAC):
                s.level  = "focus"
                s.score  = min(1.0, 1.0 - blur_ratio)
                s.reason = (
                    f"Nitidez caiu para {blur_ratio*100:.0f}% do baseline "
                    f"({self._blur_ema:.1f} vs {bblur:.1f})"
                )
                return

        # 3. Illumination drift
        illum_frac = abs(self._brightness_ema - bb) / (bb + 1e-9)
        if illum_frac > ILLUM_DRIFT_FRAC:
            direction = "mais escuro" if self._brightness_ema < bb else "mais claro"
            s.level  = "illumination"
            s.score  = min(1.0, illum_frac / ILLUM_DRIFT_FRAC)
            s.reason = f"Brilho {direction}: {self._brightness_ema:.1f} vs baseline {bb:.1f}"
            return

        s.level  = "ok"
        s.score  = 0.0
        s.reason = ""
