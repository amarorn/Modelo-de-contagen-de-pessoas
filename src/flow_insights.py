"""Previsão de fluxo (curto prazo), simulação de cenário e recomendações operacionais.

7.1 — Taxa derivada da sessão (entradas/saídas / tempo decorrido).
7.2 — Projeção de lotação se a taxa líquida se mantiver.
7.3 — Regras heurísticas (fila, lotação, permanência prolongada).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


def _elapsed_minutes(started_at: datetime, now: datetime) -> float:
    dt = (now - started_at).total_seconds() / 60.0
    return max(dt, 1.0 / 60.0)


def _hourly_passage_rate(
    hourly_entries: list[int],
    hourly_exits: list[int],
    now: datetime,
) -> float | None:
    """Passagens/hora na hora corrente (extrapolação pelo minuto atual)."""
    h = now.hour
    m = now.minute
    if len(hourly_entries) != 24 or len(hourly_exits) != 24:
        return None
    flow_h = float(hourly_entries[h] + hourly_exits[h])
    if m <= 0:
        return flow_h
    return flow_h * (60.0 / float(m))


def compute_flow_insights_payload(
    *,
    hourly_entries: list[int],
    hourly_exits: list[int],
    entries: int,
    exits: int,
    occupancy_now: int,
    queue_size: int,
    queue_saturated: bool,
    queue_avg_wait_s: float,
    loitering_now: int,
    started_at: datetime,
    now: datetime,
) -> dict[str, Any]:
    elapsed_min = _elapsed_minutes(started_at, now)
    entry_per_min = entries / elapsed_min
    exit_per_min = exits / elapsed_min
    gross_per_min = entry_per_min + exit_per_min
    net_per_min = entry_per_min - exit_per_min

    # 7.1 — previsão de passagens (curto prazo)
    crossings_15 = gross_per_min * 15.0
    crossings_30 = gross_per_min * 30.0
    net_delta_15 = net_per_min * 15.0
    net_delta_30 = net_per_min * 30.0

    # Refinar com hora corrente se a sessão for longa e houver dados na hora
    hr_rate = _hourly_passage_rate(hourly_entries, hourly_exits, now)
    method = "session_rate"
    if elapsed_min > 45.0 and hr_rate is not None and hr_rate > 0:
        blend = 0.35
        gpm = (1.0 - blend) * gross_per_min + blend * (hr_rate / 60.0)
        crossings_15 = gpm * 15.0
        crossings_30 = gpm * 30.0
        method = "session_rate_blended_hourly"

    # 7.2 — lotação projetada (linear, cenário "se continuar assim")
    occ_15 = max(0, int(round(occupancy_now + net_delta_15)))
    occ_30 = max(0, int(round(occupancy_now + net_delta_30)))

    # 7.3 — recomendações
    recommendations: list[dict[str, Any]] = []

    if queue_saturated and queue_size >= 6:
        recommendations.append(
            {
                "id": "open_checkout",
                "severity": "high",
                "action": "Abrir caixa / reforço no atendimento",
                "detail": (
                    f"Fila saturada (~{queue_size} pessoas, espera média ~{queue_avg_wait_s:.0f}s). "
                    "Considerar abrir ponto adicional ou desviar fluxo."
                ),
            }
        )
    elif queue_size >= 4 and not queue_saturated:
        recommendations.append(
            {
                "id": "monitor_queue",
                "severity": "medium",
                "action": "Monitorizar fila",
                "detail": (
                    f"Fila com {queue_size} pessoas. Preparar reforço se a espera ultrapassar o habitual."
                ),
            }
        )

    if occupancy_now >= 25 and net_per_min > 0.05:
        recommendations.append(
            {
                "id": "redirect_flow",
                "severity": "medium",
                "action": "Redirecionar fluxo / sinalética",
                "detail": (
                    "Lotação elevada e saldo líquido positivo na sessão. Avaliar rotas alternativas ou comunicação no espaço."
                ),
            }
        )

    if loitering_now >= 8:
        recommendations.append(
            {
                "id": "zone_intervention",
                "severity": "medium",
                "action": "Intervir em zona com permanência prolongada",
                "detail": (
                    f"Muitas pessoas paradas prolongadamente (~{loitering_now}). "
                    "Ver mapa de calor / zonas para identificar gargalos."
                ),
            }
        )

    if occupancy_now >= 40:
        recommendations.append(
            {
                "id": "high_occupancy",
                "severity": "high",
                "action": "Plano de lotação",
                "detail": "Ocupação instantânea muito alta; rever capacidade e saídas de emergência/sinalização.",
            }
        )

    return {
        "version": 1,
        "method": method,
        "horizons_min": [15, 30],
        "expected_crossings": {"15": round(crossings_15, 1), "30": round(crossings_30, 1)},
        "expected_net_flow": {"15": round(net_delta_15, 2), "30": round(net_delta_30, 2)},
        "projected_occupancy": {"15": occ_15, "30": occ_30},
        "rates_per_min": {
            "entries": round(entry_per_min, 4),
            "exits": round(exit_per_min, 4),
            "gross_passages": round(gross_per_min, 4),
            "net": round(net_per_min, 4),
        },
        "session_elapsed_min": round(elapsed_min, 2),
        "disclaimer_pt": (
            "Projeção linear a partir da taxa média desde o início da sessão; não inclui picos sazonais nem eventos externos."
        ),
        "recommendations": recommendations,
    }
