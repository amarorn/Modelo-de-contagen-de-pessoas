"""Assisted configuration helpers.

5.2 – Suggests count lines and zone polygons from accumulated flow data.

* suggest_line: finds the highest-traffic cross-section using the flow
  vector grid; returns a line oriented perpendicular to the dominant flow.
* suggest_zones: clusters heatmap cells by density into 1-4 rectangular
  zone regions.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass
class SuggestedLine:
    """A count line expressed in normalised [0,1] coordinates."""
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float   # 0-1; higher = clearer dominant flow
    dominant_angle_deg: float


@dataclass
class SuggestedZone:
    """A rectangular zone in normalised [0,1] coordinates."""
    label: str
    x: float    # top-left
    y: float
    w: float
    h: float
    density: float  # relative density 0-1


# ── Line suggestion ────────────────────────────────────────────────────────────

def suggest_line(
    vectors_payload: dict,
    frame_w: int = 1920,
    frame_h: int = 1080,
) -> SuggestedLine | None:
    """Derive a count line perpendicular to the dominant flow direction.

    Uses the flow vector grid produced by FlowVectorGrid.  Returns None if
    there is insufficient data.
    """
    vectors: list[dict] = vectors_payload.get("vectors", [])
    if not vectors:
        return None

    grid_w: int = vectors_payload.get("grid_w", 16)
    grid_h: int = vectors_payload.get("grid_h", 9)
    max_mag: float = vectors_payload.get("max_mag", 0.0)
    if max_mag <= 0.0:
        return None

    # Weighted mean flow direction
    wx = wy = wsum = 0.0
    for v in vectors:
        mag = float(v.get("mag", 0.0))
        if mag <= 0:
            continue
        wx += v["vx"] * mag
        wy += v["vy"] * mag
        wsum += mag

    if wsum < 1e-9:
        return None

    dx = wx / wsum
    dy = wy / wsum
    angle = math.atan2(dy, dx)  # radians

    # Confidence: how uniform is the direction?
    # Compare mean magnitude of vectors vs max_mag
    mean_mag = wsum / len(vectors)
    confidence = min(1.0, mean_mag / max_mag)

    # Find the column (or row) with the highest total flow magnitude —
    # this is the best cross-section for a count line.
    col_flux: list[float] = [0.0] * grid_w
    row_flux: list[float] = [0.0] * grid_h
    for v in vectors:
        col_flux[min(int(v["c"]), grid_w - 1)] += abs(v["vx"]) * v["mag"]
        row_flux[min(int(v["r"]), grid_h - 1)] += abs(v["vy"]) * v["mag"]

    total_h_flux = sum(col_flux)
    total_v_flux = sum(row_flux)

    # Place line perpendicular to dominant flow axis
    if total_h_flux >= total_v_flux:
        # Dominant flow is horizontal → vertical line
        best_col = col_flux.index(max(col_flux))
        cx_norm = (best_col + 0.5) / grid_w
        # Vertical line from top to bottom
        return SuggestedLine(
            x1=cx_norm, y1=0.05,
            x2=cx_norm, y2=0.95,
            confidence=confidence,
            dominant_angle_deg=math.degrees(angle),
        )
    else:
        # Dominant flow is vertical → horizontal line
        best_row = row_flux.index(max(row_flux))
        cy_norm = (best_row + 0.5) / grid_h
        # Horizontal line from left to right
        return SuggestedLine(
            x1=0.05, y1=cy_norm,
            x2=0.95, y2=cy_norm,
            confidence=confidence,
            dominant_angle_deg=math.degrees(angle),
        )


# ── Zone suggestion ────────────────────────────────────────────────────────────

def suggest_zones(
    heatmap_payload: dict,
    max_zones: int = 4,
    min_density_frac: float = 0.15,
) -> list[SuggestedZone]:
    """Suggest rectangular zones from heatmap density clusters.

    Uses a simple greedy peak-finding strategy — no external dependencies.
    Iteratively finds the densest cell, expands it into a region above
    `min_density_frac * max_val`, masks used cells, and repeats.
    """
    cells = heatmap_payload.get("cells", [])
    grid_w: int = heatmap_payload.get("grid_w", 32)
    grid_h: int = heatmap_payload.get("grid_h", 18)
    max_val: float = heatmap_payload.get("max_val", 0.0)

    if not cells or max_val <= 0:
        return []

    # Build 2-D grid from sparse cells list [[row, col, val], ...]
    grid = np.zeros((grid_h, grid_w), dtype=np.float32)
    for cell in cells:
        r, c, v = int(cell[0]), int(cell[1]), float(cell[2])
        if 0 <= r < grid_h and 0 <= c < grid_w:
            grid[r, c] = v

    used = np.zeros_like(grid, dtype=bool)
    threshold = max_val * min_density_frac
    zones: list[SuggestedZone] = []
    labels = ["Zona A", "Zona B", "Zona C", "Zona D"]

    for i in range(max_zones):
        masked = np.where(used, 0.0, grid)
        peak_val = masked.max()
        if peak_val < threshold:
            break

        peak_r, peak_c = np.unravel_index(masked.argmax(), masked.shape)

        # Flood-fill connected region above threshold
        visited = np.zeros_like(grid, dtype=bool)
        stack = [(int(peak_r), int(peak_c))]
        while stack:
            r, c = stack.pop()
            if r < 0 or r >= grid_h or c < 0 or c >= grid_w:
                continue
            if visited[r, c] or used[r, c]:
                continue
            if grid[r, c] < threshold:
                continue
            visited[r, c] = True
            stack += [(r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)]

        if not visited.any():
            break

        rows, cols = np.where(visited)
        r_min, r_max = int(rows.min()), int(rows.max())
        c_min, c_max = int(cols.min()), int(cols.max())

        # Normalise to [0,1] frame coordinates with small padding
        pad = 0.01
        x_norm = max(0.0, c_min / grid_w - pad)
        y_norm = max(0.0, r_min / grid_h - pad)
        w_norm = min(1.0, (c_max - c_min + 1) / grid_w + 2 * pad)
        h_norm = min(1.0, (r_max - r_min + 1) / grid_h + 2 * pad)

        zones.append(SuggestedZone(
            label=labels[i],
            x=x_norm, y=y_norm, w=w_norm, h=h_norm,
            density=float(peak_val / max_val),
        ))
        used[visited] = True

    return zones
