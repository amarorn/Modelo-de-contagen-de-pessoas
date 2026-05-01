"""Testes para previsão de fluxo e recomendações."""

import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from flow_insights import compute_flow_insights_payload


def _base_kw():
    z = [0] * 24
    return {
        "hourly_entries": z.copy(),
        "hourly_exits": z.copy(),
    }


class TestFlowInsights(unittest.TestCase):
    def test_projection_linear(self):
        now = datetime(2026, 4, 20, 12, 0, 0)
        started = now - timedelta(minutes=60)
        p = compute_flow_insights_payload(
            **_base_kw(),
            entries=60,
            exits=30,
            occupancy_now=10,
            queue_size=0,
            queue_saturated=False,
            queue_avg_wait_s=0.0,
            loitering_now=0,
            started_at=started,
            now=now,
        )
        self.assertEqual(p["rates_per_min"]["entries"], 1.0)
        self.assertEqual(p["rates_per_min"]["exits"], 0.5)
        self.assertEqual(p["projected_occupancy"]["15"], 10 + int(round(0.5 * 15)))
        self.assertEqual(p["expected_crossings"]["15"], 22.5)

    def test_recommendation_queue_saturated(self):
        now = datetime(2026, 4, 20, 12, 0, 0)
        started = now - timedelta(hours=2)
        p = compute_flow_insights_payload(
            **_base_kw(),
            entries=10,
            exits=10,
            occupancy_now=5,
            queue_size=10,
            queue_saturated=True,
            queue_avg_wait_s=120.0,
            loitering_now=0,
            started_at=started,
            now=now,
        )
        ids = [r["id"] for r in p["recommendations"]]
        self.assertIn("open_checkout", ids)

    def test_recommendation_loitering(self):
        now = datetime(2026, 4, 20, 12, 0, 0)
        started = now - timedelta(hours=1)
        p = compute_flow_insights_payload(
            **_base_kw(),
            entries=5,
            exits=5,
            occupancy_now=10,
            queue_size=0,
            queue_saturated=False,
            queue_avg_wait_s=0.0,
            loitering_now=10,
            started_at=started,
            now=now,
        )
        self.assertTrue(any(r["id"] == "zone_intervention" for r in p["recommendations"]))


if __name__ == "__main__":
    unittest.main()
