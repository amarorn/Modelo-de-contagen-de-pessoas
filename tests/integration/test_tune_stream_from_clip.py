"""Testes leves para scripts/tune_stream_from_clip.py (sem correr YOLO)."""

from __future__ import annotations

import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_SCRIPT = _REPO / "scripts" / "tune_stream_from_clip.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("tune_stream_from_clip", _SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestTuneStreamHelpers(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mod = _load_module()

    def test_norm_minmax(self) -> None:
        self.assertEqual(self.mod._norm_minmax([1.0, 3.0]), [0.0, 1.0])
        self.assertEqual(self.mod._norm_minmax([5.0, 5.0]), [0.5, 0.5])

    def test_load_gt_csv(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".csv", delete=False, encoding="utf-8", newline=""
        ) as f:
            w = csv.DictWriter(f, fieldnames=["frame", "person_count"])
            w.writeheader()
            w.writerow({"frame": "0", "person_count": "3"})
            w.writerow({"frame": "1", "person_count": "5"})
            path = Path(f.name)
        try:
            gt = self.mod._load_gt_csv(path)
            self.assertEqual(gt[0], 3)
            self.assertEqual(gt[1], 5)
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
