"""Helpers para classes YOLO (varias classes no mesmo modelo, ex.: pessoa + carro)."""

from __future__ import annotations

from ultralytics import YOLO

_CAR_NAME_HINTS = frozenset(
    {"car", "carro", "automobile", "vehicle", "veiculo", "truck", "bus", "motorcycle"}
)


def resolve_person_class_id(model: YOLO, forced_id: int | None) -> int:
    if forced_id is not None:
        return forced_id
    names = getattr(model, "names", {})
    if isinstance(names, dict):
        for class_id, class_name in names.items():
            if str(class_name).strip().lower() == "person":
                return int(class_id)
    return 0


def resolve_yolo_classes_and_person_id(
    model: YOLO,
    person_class_id_arg: int | None,
    count_class_ids_str: str | None,
) -> tuple[list[int], int]:
    """Retorna (lista de IDs para o argumento `classes=` do YOLO, id da classe pessoa para sexo/rotulos).

    Se `count_class_ids_str` estiver vazio, usa apenas a classe pessoa (comportamento anterior).
    Caso contrario, espera IDs separados por virgula ou ponto-e-virgula, ex.: "0,1".
    """
    person_id = resolve_person_class_id(model, person_class_id_arg)
    raw = (count_class_ids_str or "").strip()
    if not raw:
        return [person_id], person_id
    parts = [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
    ids = [int(p) for p in parts]
    return ids, person_id


def short_class_tag(names: dict | object, class_id: int) -> str:
    """Etiqueta curta para overlay (P/C/...)."""
    d = names if isinstance(names, dict) else {}
    raw = str(d.get(class_id, d.get(str(class_id), "?"))).strip()
    low = raw.lower()
    if low in ("person", "pessoa"):
        return "P"
    if low in _CAR_NAME_HINTS:
        return "C"
    if len(raw) <= 4:
        return raw.upper()
    return raw[:3].upper()

