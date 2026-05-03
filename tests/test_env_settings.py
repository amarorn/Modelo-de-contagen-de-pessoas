"""env_settings: hot-reload vs restart heuristics."""

import unittest

from visioncount.core.config import (
    settings_updates_require_restart,
    settings_updates_trigger_stream_reload,
)


class TestEnvSettingsHotReload(unittest.TestCase):
    def test_stream_reload_only_infer_keys(self) -> None:
        self.assertFalse(
            settings_updates_require_restart({"YOLO_INFER_CONF", "YOLO_INFER_IMGSZ"})
        )
        self.assertTrue(settings_updates_trigger_stream_reload({"YOLO_INFER_CONF"}))

    def test_restart_for_model_path(self) -> None:
        self.assertTrue(settings_updates_require_restart({"YOLO_INFER_MODEL"}))
        self.assertFalse(settings_updates_trigger_stream_reload({"YOLO_INFER_MODEL"}))

    def test_mixed_update_requires_restart(self) -> None:
        keys = {"YOLO_INFER_CONF", "YOLO_INFER_MODEL"}
        self.assertTrue(settings_updates_require_restart(keys))
        self.assertTrue(settings_updates_trigger_stream_reload(keys))

    def test_mjpeg_only_no_restart_no_stream_reload(self) -> None:
        keys = {"YOLO_MJPEG_MAX_FPS", "YOLO_MJPEG_ADAPTIVE_FPS"}
        self.assertFalse(settings_updates_require_restart(keys))
        self.assertFalse(settings_updates_trigger_stream_reload(keys))

    def test_overlay_draw_keys_no_restart(self) -> None:
        keys = {
            "YOLO_OVERLAY_VEHICLE_EDGE_MARGIN_FRAC",
            "YOLO_OVERLAY_VEHICLE_EDGE_COVER_FRAC",
            "YOLO_OVERLAY_PERSON_EDGE_MARGIN_FRAC",
            "YOLO_OVERLAY_PERSON_EDGE_COVER_FRAC",
            "YOLO_OVERLAY_PERSON_MIN_HEIGHT_FRAC",
            "YOLO_OVERLAY_PERSON_GLARE_ZONE_FRAC",
            "YOLO_OVERLAY_PERSON_GLARE_ZONE_MIN_CONF",
            "YOLO_HIDE_STALE_BOXES",
        }
        self.assertFalse(settings_updates_require_restart(keys))
        self.assertFalse(settings_updates_trigger_stream_reload(keys))


if __name__ == "__main__":
    unittest.main()
