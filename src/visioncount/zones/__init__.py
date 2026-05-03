"""Zonas semanticas, templates e atribuicao de pes ao poligono."""

from visioncount.zones.zone_assigner import ZoneAssigner
from visioncount.zones.zone_model import ZoneRecord
from visioncount.zones.zone_store import ZoneStore, ensure_builtin_templates
from visioncount.zones.zone_templates import BUILTIN_TEMPLATE_SPECS

__all__ = [
    "ZoneAssigner",
    "ZoneRecord",
    "ZoneStore",
    "ensure_builtin_templates",
    "BUILTIN_TEMPLATE_SPECS",
]
