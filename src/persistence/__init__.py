"""Persistência assíncrona: produtor (dashboard) → Kafka → consumidor → SQL."""

from persistence.emitter import (
    emit_config_event,
    shutdown_emitter,
    start_stats_emitter_thread,
)

__all__ = [
    "emit_config_event",
    "shutdown_emitter",
    "start_stats_emitter_thread",
]
