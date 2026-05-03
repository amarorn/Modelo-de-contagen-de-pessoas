"""Templates builtin: poligonos normalizados [0,1] e pesos padrao para hotspot."""

from __future__ import annotations

import json
from typing import Any

# Cada zona: name, type, polygon: lista de (x,y) em [0,1]
BUILTIN_TEMPLATE_SPECS: dict[str, dict[str, Any]] = {
    "entrance": {
        "name": "Entrada",
        "description": "Linha virtual + aproximacao + passagem",
        "zones": [
            {
                "name": "Aproximacao",
                "zone_type": "approach",
                "polygon": [(0.15, 0.05), (0.85, 0.05), (0.7, 0.28), (0.3, 0.28)],
            },
            {
                "name": "Linha",
                "zone_type": "line_band",
                "polygon": [(0.42, 0.38), (0.58, 0.38), (0.58, 0.45), (0.42, 0.45)],
            },
            {
                "name": "Passagem",
                "zone_type": "passage",
                "polygon": [(0.1, 0.52), (0.9, 0.52), (0.9, 0.95), (0.1, 0.95)],
            },
        ],
        "default_weights": {"visit_weight": 0.75, "dwell_weight": 0.25},
    },
    "retail_interior": {
        "name": "Interior / vitrine",
        "description": "Tres faixas: vitrine, corredor, saida",
        "zones": [
            {
                "name": "Vitrine",
                "zone_type": "display",
                "polygon": [(0.05, 0.1), (0.32, 0.1), (0.32, 0.9), (0.05, 0.9)],
            },
            {
                "name": "Corredor",
                "zone_type": "aisle",
                "polygon": [(0.35, 0.1), (0.65, 0.1), (0.65, 0.9), (0.35, 0.9)],
            },
            {
                "name": "Saida",
                "zone_type": "exit_area",
                "polygon": [(0.68, 0.1), (0.95, 0.1), (0.95, 0.9), (0.68, 0.9)],
            },
        ],
        "default_weights": {"visit_weight": 0.45, "dwell_weight": 0.55},
    },
    "checkout": {
        "name": "Caixa",
        "description": "Fila e balcao",
        "zones": [
            {
                "name": "Fila",
                "zone_type": "queue",
                "polygon": [(0.08, 0.08), (0.45, 0.08), (0.45, 0.92), (0.08, 0.92)],
            },
            {
                "name": "Balcao",
                "zone_type": "counter",
                "polygon": [(0.52, 0.08), (0.92, 0.08), (0.92, 0.92), (0.52, 0.92)],
            },
        ],
        "default_weights": {"visit_weight": 0.25, "dwell_weight": 0.75},
    },
}


def template_zone_defs_json(slug: str) -> str:
    spec = BUILTIN_TEMPLATE_SPECS.get(slug)
    if not spec:
        return "[]"
    return json.dumps(spec.get("zones", []), separators=(",", ":"))


def template_weights_json(slug: str) -> str:
    spec = BUILTIN_TEMPLATE_SPECS.get(slug)
    if not spec:
        return "{}"
    w = spec.get("default_weights", {})
    return json.dumps(w, separators=(",", ":"))
