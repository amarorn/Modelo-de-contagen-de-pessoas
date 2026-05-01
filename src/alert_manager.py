"""Gerenciador de alertas em memoria com cooldown por track_id.

Usado pelo dashboard para acumular eventos (ex.: pessoa com bone, carro vermelho)
produzidos pelos detectores secundarios no loop de inferencia. O front consome
via `/api/alerts?since=<seq>` em polling curto e toca um beep a cada novo evento.

Regras:
- Cooldown por (kind, track_id): evita disparar o mesmo alerta a cada frame.
- Ring buffer com limite (mais antigo e' descartado quando cheio).
- Seq monotonico global: o front guarda a ultima seq vista e pede apenas as novas.
"""

from __future__ import annotations

import sys
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class AlertEvent:
    seq: int
    ts: float
    kind: str
    track_id: int | None
    label: str
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class AlertManager:
    def __init__(
        self,
        cooldown_seconds: float = 3.0,
        max_buffer: int = 200,
        server_beep: bool = False,
    ) -> None:
        self._cooldown = max(0.0, float(cooldown_seconds))
        self._buf: deque[AlertEvent] = deque(maxlen=max(16, int(max_buffer)))
        self._lock = threading.Lock()
        self._seq = 0
        # (kind, track_id) -> ultimo timestamp emitido
        self._last_fired: dict[tuple[str, int | None], float] = {}
        self._server_beep = bool(server_beep)

    @property
    def cooldown_seconds(self) -> float:
        return self._cooldown

    @cooldown_seconds.setter
    def cooldown_seconds(self, value: float) -> None:
        with self._lock:
            self._cooldown = max(0.0, float(value))

    @property
    def server_beep(self) -> bool:
        return self._server_beep

    @server_beep.setter
    def server_beep(self, value: bool) -> None:
        self._server_beep = bool(value)

    def maybe_fire(
        self,
        kind: str,
        track_id: int | None,
        label: str,
        detail: dict[str, Any] | None = None,
    ) -> AlertEvent | None:
        """Emite o alerta se fora do cooldown; devolve o evento ou None."""
        now = time.time()
        key = (kind, track_id)
        with self._lock:
            last = self._last_fired.get(key)
            if last is not None and (now - last) < self._cooldown:
                return None
            self._last_fired[key] = now
            self._seq += 1
            ev = AlertEvent(
                seq=self._seq,
                ts=now,
                kind=kind,
                track_id=track_id,
                label=label,
                detail=dict(detail or {}),
            )
            self._buf.append(ev)
        if self._server_beep:
            try:
                sys.stdout.write("\a")
                sys.stdout.flush()
            except Exception:
                pass
        return ev

    def since(self, seq: int) -> list[AlertEvent]:
        """Devolve todos os eventos com seq > `seq` (ordem cronologica)."""
        with self._lock:
            return [ev for ev in self._buf if ev.seq > seq]

    def latest_seq(self) -> int:
        with self._lock:
            return self._seq

    def forget_stale_tracks(self, active_ids: set[int]) -> None:
        """Limpa cooldowns de tracks que ja nao estao na cena (evita dict crescer)."""
        with self._lock:
            keys_to_drop = [
                key for key in self._last_fired
                if key[1] is not None and key[1] not in active_ids
            ]
            for k in keys_to_drop:
                self._last_fired.pop(k, None)
