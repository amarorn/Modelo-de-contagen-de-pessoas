"""Zonas semanticas, templates e atribuicao de pes ao poligono."""

from zones.zone_assigner import ZoneAssigner
from zones.zone_model import ZoneRecord
from zones.zone_store import ZoneStore, ensure_builtin_templates
from zones.zone_templates import BUILTIN_TEMPLATE_SPECS

__all__ = [
    "ZoneAssigner",
    "ZoneRecord",
    "ZoneStore",
    "ensure_builtin_templates",
    "BUILTIN_TEMPLATE_SPECS",
]
