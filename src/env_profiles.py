"""Environment profile presets.

Each profile bundles thresholds that change how the inference loop classifies
and alerts. Applying a profile writes the new values into SharedState (under
shared.lock) so the inference loop picks them up on the next frame without
needing a restart.

Custom profiles are persisted in configs/custom_profiles.json alongside the
built-in presets.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional


@dataclass
class EnvProfile:
    id: str
    label: str
    description: str
    icon: str  # emoji used in the UI

    # Loitering / stationary thresholds
    loitering_seconds: float = 10.0
    stationary_max_speed: float = 2.2   # px/frame

    # Queue detection
    queue_saturation: int = 8           # person count that triggers saturation alert

    # Density / occupancy alert
    density_alert_threshold: int = 0    # 0 = disabled

    # Camera quality / confidence helpers
    blur_thresh_low: float = 60.0       # below this → blur reason
    blur_thresh_critical: float = 20.0

    # Min bbox height (px) below which bbox_small reason fires
    bbox_small_thresh_px: float = 40.0

    # Re-id parameters
    reid_radius_norm: float = 0.18      # max normalised distance for re-link
    reid_timeout_s: float = 20.0        # ghost expiry

    # Metadata
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ── Built-in profiles ──────────────────────────────────────────────────────────

PROFILES: dict[str, EnvProfile] = {
    p.id: p
    for p in [
        EnvProfile(
            id="default",
            label="Padrão",
            description="Configuração equilibrada para ambientes genéricos.",
            icon="⚙️",
            loitering_seconds=10.0,
            stationary_max_speed=2.2,
            queue_saturation=8,
            density_alert_threshold=0,
            blur_thresh_low=60.0,
            blur_thresh_critical=20.0,
            bbox_small_thresh_px=40.0,
            reid_radius_norm=0.18,
            reid_timeout_s=20.0,
            notes=[],
        ),
        EnvProfile(
            id="praca_aberta",
            label="Praça Aberta",
            description="Espaço amplo com trânsito livre e câmera alta. "
                        "Loitering tolerante, fila improvável.",
            icon="🌳",
            loitering_seconds=30.0,
            stationary_max_speed=2.5,
            queue_saturation=20,
            density_alert_threshold=0,
            blur_thresh_low=50.0,
            blur_thresh_critical=15.0,
            bbox_small_thresh_px=25.0,
            reid_radius_norm=0.25,
            reid_timeout_s=30.0,
            notes=["Câmera tipicamente alta; pessoas aparecem pequenas no frame."],
        ),
        EnvProfile(
            id="loja",
            label="Loja / Varejo",
            description="Ambiente interno com zonas de interesse. "
                        "Permanência esperada; loitering moderado.",
            icon="🛍️",
            loitering_seconds=60.0,
            stationary_max_speed=2.0,
            queue_saturation=6,
            density_alert_threshold=15,
            blur_thresh_low=70.0,
            blur_thresh_critical=30.0,
            bbox_small_thresh_px=40.0,
            reid_radius_norm=0.15,
            reid_timeout_s=30.0,
            notes=["Permanência longa é esperada — loitering alto para não gerar falsos alertas."],
        ),
        EnvProfile(
            id="corredor",
            label="Corredor",
            description="Fluxo unidirecional rápido. "
                        "Detecta filas e bloqueios rapidamente.",
            icon="🚶",
            loitering_seconds=8.0,
            stationary_max_speed=2.0,
            queue_saturation=4,
            density_alert_threshold=10,
            blur_thresh_low=65.0,
            blur_thresh_critical=25.0,
            bbox_small_thresh_px=40.0,
            reid_radius_norm=0.12,
            reid_timeout_s=15.0,
            notes=["Fila satura rapidamente; loitering curto indica bloqueio."],
        ),
        EnvProfile(
            id="portaria",
            label="Portaria / Acesso",
            description="Ponto de controle de entrada. Alta precisão de contagem; "
                        "filas pequenas já são alerta.",
            icon="🚪",
            loitering_seconds=15.0,
            stationary_max_speed=1.8,
            queue_saturation=3,
            density_alert_threshold=8,
            blur_thresh_low=80.0,
            blur_thresh_critical=35.0,
            bbox_small_thresh_px=50.0,
            reid_radius_norm=0.14,
            reid_timeout_s=25.0,
            notes=["Câmera próxima; bboxes grandes. Fila de 3+ já é crítica."],
        ),
        EnvProfile(
            id="estacionamento",
            label="Estacionamento",
            description="Ambiente aberto com veículos e pedestres. "
                        "Loitering alto; câmera pode ter baixa resolução.",
            icon="🅿️",
            loitering_seconds=45.0,
            stationary_max_speed=3.0,
            queue_saturation=12,
            density_alert_threshold=0,
            blur_thresh_low=40.0,
            blur_thresh_critical=12.0,
            bbox_small_thresh_px=20.0,
            reid_radius_norm=0.22,
            reid_timeout_s=45.0,
            notes=["Veículos geram falsos positivos — use filtro de classe."],
        ),
    ]
}

_BUILTIN_IDS: frozenset[str] = frozenset(PROFILES)

# ── Custom profile persistence ─────────────────────────────────────────────────

_CUSTOM_PATH = Path(__file__).parent.parent / "configs" / "custom_profiles.json"
_custom_lock = threading.Lock()
_custom_profiles: dict[str, EnvProfile] = {}
_custom_loaded = False


def _ensure_loaded() -> None:
    global _custom_loaded
    if _custom_loaded:
        return
    _reload_custom()
    _custom_loaded = True


def _reload_custom() -> None:
    global _custom_profiles
    if not _CUSTOM_PATH.is_file():
        _custom_profiles = {}
        return
    try:
        raw = json.loads(_CUSTOM_PATH.read_text(encoding="utf-8"))
        result: dict[str, EnvProfile] = {}
        for d in raw.get("profiles", []):
            pid = d.get("id", "")
            if not pid or pid in _BUILTIN_IDS:
                continue
            result[pid] = EnvProfile(
                id=pid,
                label=d.get("label", pid),
                description=d.get("description", ""),
                icon=d.get("icon", "📷"),
                loitering_seconds=float(d.get("loitering_seconds", 10.0)),
                stationary_max_speed=float(d.get("stationary_max_speed", 2.2)),
                queue_saturation=int(d.get("queue_saturation", 8)),
                density_alert_threshold=int(d.get("density_alert_threshold", 0)),
                blur_thresh_low=float(d.get("blur_thresh_low", 60.0)),
                blur_thresh_critical=float(d.get("blur_thresh_critical", 20.0)),
                bbox_small_thresh_px=float(d.get("bbox_small_thresh_px", 40.0)),
                reid_radius_norm=float(d.get("reid_radius_norm", 0.18)),
                reid_timeout_s=float(d.get("reid_timeout_s", 20.0)),
                notes=list(d.get("notes", [])),
            )
        _custom_profiles = result
    except Exception:
        _custom_profiles = {}


def _write_custom() -> None:
    _CUSTOM_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {"profiles": [p.to_dict() for p in _custom_profiles.values()]}
    _CUSTOM_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _slug(label: str) -> str:
    s = label.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "custom"


# ── Public API ─────────────────────────────────────────────────────────────────

def get_profile(profile_id: str) -> Optional[EnvProfile]:
    with _custom_lock:
        _ensure_loaded()
        return _custom_profiles.get(profile_id) or PROFILES.get(profile_id)


def is_builtin_profile(profile_id: str) -> bool:
    return profile_id in _BUILTIN_IDS


def list_profiles() -> list[dict]:
    with _custom_lock:
        _ensure_loaded()
        out = []
        for p in PROFILES.values():
            d = p.to_dict()
            d["is_builtin"] = True
            out.append(d)
        for p in _custom_profiles.values():
            d = p.to_dict()
            d["is_builtin"] = False
            out.append(d)
        return out


def save_custom_profile(profile: EnvProfile) -> EnvProfile:
    """Create or update a custom profile.  Returns the saved profile (id may be reassigned)."""
    with _custom_lock:
        _ensure_loaded()
        pid = profile.id
        # Protect built-ins: fork with a new id
        if pid in _BUILTIN_IDS or not pid:
            base = _slug(profile.label) if profile.label else "custom"
            # avoid collision
            candidate = base
            counter = 1
            while candidate in _BUILTIN_IDS or candidate in _custom_profiles:
                candidate = f"{base}_{counter}"
                counter += 1
            profile = EnvProfile(
                id=candidate,
                label=profile.label,
                description=profile.description,
                icon=profile.icon,
                loitering_seconds=profile.loitering_seconds,
                stationary_max_speed=profile.stationary_max_speed,
                queue_saturation=profile.queue_saturation,
                density_alert_threshold=profile.density_alert_threshold,
                blur_thresh_low=profile.blur_thresh_low,
                blur_thresh_critical=profile.blur_thresh_critical,
                bbox_small_thresh_px=profile.bbox_small_thresh_px,
                reid_radius_norm=profile.reid_radius_norm,
                reid_timeout_s=profile.reid_timeout_s,
                notes=list(profile.notes),
            )
        _custom_profiles[profile.id] = profile
        _write_custom()
        return profile


def delete_custom_profile(profile_id: str) -> bool:
    """Delete a custom profile. Returns False if not found or if it's a built-in."""
    if profile_id in _BUILTIN_IDS:
        return False
    with _custom_lock:
        _ensure_loaded()
        if profile_id not in _custom_profiles:
            return False
        del _custom_profiles[profile_id]
        _write_custom()
        return True
