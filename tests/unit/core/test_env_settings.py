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

    def test_empty_set_no_reload(self) -> None:
        self.assertFalse(settings_updates_require_restart(set()))
        self.assertFalse(settings_updates_trigger_stream_reload(set()))


if __name__ == "__main__":
    unittest.main()
