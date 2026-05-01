"""Publicação de eventos de visão para Kafka (caminho primário quando habilitado)."""

from __future__ import annotations

import json
import os
from typing import Any

from persistence.envutil import strip_env_comment

from analytics.models import EventRaw

_configured: bool | None = None
_producer: Any = None


def _bootstrap_servers() -> str:
    return strip_env_comment(os.environ.get("KAFKA_BOOTSTRAP_SERVERS", ""))


def _topic() -> str:
    t = strip_env_comment(os.environ.get("ANALYTICS_KAFKA_TOPIC", "vision.analytics.events"))
    return t or "vision.analytics.events"


def kafka_publish_enabled() -> bool:
    return strip_env_comment(os.environ.get("ANALYTICS_KAFKA_PUBLISH", "")) == "1"


def _ensure_producer() -> Any:
    global _producer, _configured
    if not kafka_publish_enabled():
        return None
    if _configured is False:
        return None
    if _producer is not None:
        return _producer
    bs = _bootstrap_servers()
    if not bs:
        _configured = False
        return None
    try:
        from kafka import KafkaProducer
    except ImportError:
        _configured = False
        return None
    servers = [x.strip() for x in bs.split(",") if x.strip()]
    _producer = KafkaProducer(
        bootstrap_servers=servers,
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
        acks=1,
        linger_ms=5,
        compression_type="gzip",
        retries=3,
        request_timeout_ms=10000,
    )
    _configured = True
    print(f"[analytics-kafka] produtor topico={_topic()!r} servers={servers!r}", flush=True)
    return _producer


def publish_vision_analytics_event(event: EventRaw) -> bool:
    """Publica evento no Kafka. Retorna True se entregue, False em falha.

    Quando Kafka é o caminho primário (ANALYTICS_KAFKA_PUBLISH=1), a chamada
    deve ser feita antes de qualquer gravação local para garantir que o evento
    está durável no broker antes de descartar o objeto.
    """
    prod = _ensure_producer()
    if prod is None:
        return False
    body = {"type": "vision_analytics_event", "payload": event.to_dict()}
    try:
        prod.send(_topic(), value=body)
        return True
    except Exception as exc:
        print(f"[analytics-kafka] falha ao publicar evento {event.id!r}: {exc}", flush=True)
        return False
