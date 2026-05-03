"""Fábrica da aplicação Flask.

Uso:
    from visioncount.api.app import create_app

    shared = SharedState(...)
    app = create_app(shared, audit_log, drift_detector)
    app.run(...)

TODO (PR 3b): as 63 rotas ainda vivem em src/web_dashboard.py dentro de
create_app().  Extrair para blueprints por domínio:
  - api/routes/stats.py
  - api/routes/config.py
  - api/routes/zones.py
  - api/routes/heatmaps.py
  - api/routes/dwell.py
  - api/routes/reports.py
  - api/routes/streams.py
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from flask import Flask
    from visioncount.pipeline.context import SharedState
    from visioncount.persistence.audit_log import AuditLog
    from visioncount.vision.calibration.camera_drift import CameraDriftDetector
    from visioncount.analytics import AggregatorWorker


def create_app(
    shared: SharedState,
    audit_log: AuditLog,
    drift_detector: CameraDriftDetector,
    analytics_worker: AggregatorWorker | None = None,
) -> Flask:
    """Cria e configura a aplicação Flask com todas as rotas registadas.

    Delega para a implementação em web_dashboard enquanto a extração de
    blueprints não está completa (ver TODO acima).
    """
    from web_dashboard import create_app as _create_app  # noqa: PLC0415

    return _create_app(shared, audit_log, drift_detector, analytics_worker=analytics_worker)
