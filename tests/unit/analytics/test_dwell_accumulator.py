"""Testes unitários para DwellGridLive."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "src"))

from visioncount.analytics.dwell.accumulator import GRID_H, GRID_W, DwellGridLive


class TestDwellGridLive(unittest.TestCase):
    def setUp(self):
        self.grid = DwellGridLive(grid_w=GRID_W, grid_h=GRID_H)

    def test_update_increments_cell(self):
        self.grid.update_track(track_id=1, cx_norm=0.5, cy_norm=0.5, dt=1.0)
        arr = self.grid.to_raw_array()
        cx = int(0.5 * GRID_W)
        cy = int(0.5 * GRID_H)
        self.assertAlmostEqual(arr[cy, cx], 1.0)

    def test_dt_cap_at_2s(self):
        self.grid.update_track(track_id=1, cx_norm=0.5, cy_norm=0.5, dt=10.0)
        arr = self.grid.to_raw_array()
        cx = int(0.5 * GRID_W)
        cy = int(0.5 * GRID_H)
        self.assertAlmostEqual(arr[cy, cx], 2.0)

    def test_negative_dt_ignored(self):
        self.grid.update_track(track_id=1, cx_norm=0.5, cy_norm=0.5, dt=-1.0)
        arr = self.grid.to_raw_array()
        self.assertAlmostEqual(float(arr.sum()), 0.0)

    def test_frame_delta_resets_after_take(self):
        self.grid.update_track(track_id=1, cx_norm=0.0, cy_norm=0.0, dt=0.5)
        delta1 = self.grid.take_frame_delta()
        delta2 = self.grid.take_frame_delta()
        self.assertGreater(float(delta1.sum()), 0.0)
        self.assertAlmostEqual(float(delta2.sum()), 0.0)

    def test_payload_normalised(self):
        self.grid.update_track(track_id=1, cx_norm=0.1, cy_norm=0.1, dt=1.0)
        payload = self.grid.to_payload()
        self.assertEqual(payload["grid_w"], GRID_W)
        self.assertEqual(payload["grid_h"], GRID_H)
        self.assertGreater(payload["max_val"], 0.0)
        self.assertGreater(payload["total_dwell_s"], 0.0)
        # Maximum normalised cell must equal 1.0
        cells_flat = [v for row in payload["cells"] for v in row]
        self.assertAlmostEqual(max(cells_flat), 1.0)

    def test_empty_payload_has_no_cells(self):
        payload = self.grid.to_payload()
        self.assertEqual(payload["cells"], [])
        self.assertAlmostEqual(payload["max_val"], 0.0)


if __name__ == "__main__":
    unittest.main()
