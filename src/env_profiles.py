"""Environment profile presets.

Each profile bundles thresholds that change how the inference loop classifies
and alerts. Applying a profile writes the new values into SharedState (under
shared.lock) so the inference loop picks them up on the next frame without
needing a restart.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
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
            bbox_small_thresh_px=25.0,  # pessoas ficam pequenas
            reid_radius_norm=0.25,       # mais distância para re-link em espaço aberto
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
            reid_radius_norm=0.12,       # corredor estreito → menor raio
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
            blur_thresh_low=40.0,      # qualidade de câmera tipicamente pior
            blur_thresh_critical=12.0,
            bbox_small_thresh_px=20.0,  # pessoas pequenas ao fundo
            reid_radius_norm=0.22,
            reid_timeout_s=45.0,        # pessoas podem voltar ao carro lentamente
            notes=["Veículos geram falsos positivos — use filtro de classe."],
        ),
    ]
}


def get_profile(profile_id: str) -> Optional[EnvProfile]:
    return PROFILES.get(profile_id)


def list_profiles() -> list[dict]:
    return [p.to_dict() for p in PROFILES.values()]
