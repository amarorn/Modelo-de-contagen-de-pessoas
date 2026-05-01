"""Re-identificação leve dentro da mesma câmera e sessão.

Não usa modelo de aparência. Linka tracks pelo critério espaço-temporal:
  - posição do novo track dentro de REID_RADIUS_NORM do ghost
  - tempo desde o desaparecimento < REID_TIMEOUT_S

Zero PII — armazena apenas counters agregados e posições normalizadas efêmeras.
Os person_ids são inteiros incrementais, válidos apenas durante a sessão corrente.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class _Ghost:
    cx_norm: float
    cy_norm: float
    lost_at: float   # time.monotonic()


class PersonTracker:
    """Associa track_ids (instáveis) a person_ids (estáveis dentro da sessão)."""

    REID_TIMEOUT_S: float = 20.0    # janela de reidentificação
    REID_RADIUS_NORM: float = 0.18  # 18% da largura do frame

    def __init__(self) -> None:
        self._next_pid: int = 0
        self._track_to_pid: dict[int, int] = {}
        self._ghosts: dict[int, _Ghost] = {}        # person_id → ghost

        # Acumuladores por person_id — nunca removidos (memória de sessão)
        self._first_seen: dict[int, float] = {}
        self._dwell_s: dict[int, float] = {}
        self._zones: dict[int, list[str]] = {}      # sequência de zonas visitadas
        self._revisits: dict[int, int] = {}         # nº de re-links para este pid
        self._total_relinks: int = 0

    # ── API principal ──────────────────────────────────────────────────────────

    def get_or_assign(
        self,
        track_id: int,
        cx_norm: float,
        cy_norm: float,
        now: float,
    ) -> int:
        """Retorna o person_id para este track (re-linkando ou criando novo)."""
        if track_id in self._track_to_pid:
            return self._track_to_pid[track_id]

        pid = self._find_ghost(cx_norm, cy_norm, now)
        if pid is not None:
            del self._ghosts[pid]
            self._revisits[pid] = self._revisits.get(pid, 0) + 1
            self._total_relinks += 1
        else:
            pid = self._next_pid
            self._next_pid += 1
            self._first_seen[pid] = now
            self._dwell_s[pid] = 0.0
            self._zones[pid] = []
            self._revisits[pid] = 0

        self._track_to_pid[track_id] = pid
        return pid

    def update_dwell(self, track_id: int, dt: float) -> None:
        """Acumula dt (segundos) no dwell total do person_id associado."""
        pid = self._track_to_pid.get(track_id)
        if pid is not None and dt > 0:
            self._dwell_s[pid] = self._dwell_s.get(pid, 0.0) + dt

    def record_zone(self, track_id: int, zone_name: str) -> None:
        """Registra transição de zona (só insere se diferente da última)."""
        pid = self._track_to_pid.get(track_id)
        if pid is None:
            return
        zones = self._zones.setdefault(pid, [])
        if not zones or zones[-1] != zone_name:
            zones.append(zone_name)

    def on_track_lost(
        self,
        track_id: int,
        cx_norm: float,
        cy_norm: float,
        now: float,
    ) -> None:
        """Chamado quando um track sai do detector; cria ghost para re-id futura."""
        pid = self._track_to_pid.pop(track_id, None)
        if pid is not None:
            self._ghosts[pid] = _Ghost(cx_norm=cx_norm, cy_norm=cy_norm, lost_at=now)

    def expire_ghosts(self, now: float) -> None:
        """Remove ghosts expirados — chame uma vez por frame."""
        to_del = [
            pid for pid, g in self._ghosts.items()
            if now - g.lost_at > self.REID_TIMEOUT_S
        ]
        for pid in to_del:
            del self._ghosts[pid]

    # ── Stats ──────────────────────────────────────────────────────────────────

    def session_stats(self, active_track_ids: set[int]) -> dict:
        active_pids = {
            self._track_to_pid[t]
            for t in active_track_ids
            if t in self._track_to_pid
        }
        all_pids = set(self._dwell_s)
        revisited = sum(1 for pid in all_pids if self._revisits.get(pid, 0) > 0)
        dwells = [d for d in self._dwell_s.values() if d > 1.0]
        avg_dwell = float(sum(dwells) / len(dwells)) if dwells else 0.0
        journey_lens = [len(z) for z in self._zones.values() if z]
        avg_journey = float(sum(journey_lens) / len(journey_lens)) if journey_lens else 0.0
        return {
            "unique_persons": len(all_pids),
            "active_persons": len(active_pids),
            "revisited_persons": revisited,
            "total_relinks": self._total_relinks,
            "avg_total_dwell_s": avg_dwell,
            "avg_journey_zones": avg_journey,
        }

    # ── Interno ────────────────────────────────────────────────────────────────

    def _find_ghost(self, cx_norm: float, cy_norm: float, now: float) -> int | None:
        best_pid: int | None = None
        best_dist = float("inf")
        for pid, g in self._ghosts.items():
            if now - g.lost_at > self.REID_TIMEOUT_S:
                continue
            dist = ((cx_norm - g.cx_norm) ** 2 + (cy_norm - g.cy_norm) ** 2) ** 0.5
            if dist < self.REID_RADIUS_NORM and dist < best_dist:
                best_dist = dist
                best_pid = pid
        return best_pid
