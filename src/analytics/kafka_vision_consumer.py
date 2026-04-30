"""Consumer Kafka dedicado: escritor primário de events_aggregated + trajectories.

Inicia com: scripts/run_analytics_kafka_consumer.sh
Obrigatório quando ANALYTICS_KAFKA_PUBLISH=1 — é ele quem persiste os eventos no BD.

Garantias:
  - Offset Kafka só avança após session.commit() bem-sucedido (enable_auto_commit=False)
  - Falha de BD: rollback + retry na próxima iteração do poll (eventos reprocessados)
  - Idempotência: update_aggregation/upsert_trajectory toleram reprocessamento
  - Lote: até BATCH_SIZE eventos por transação (reduz round-trips)
"""

from __future__ import annotations

import json
import os
import signal
import sys
import time

from sqlalchemy.orm import sessionmaker

from persistence.db import init_db, make_engine
from persistence.envutil import strip_env_comment

from analytics.models import EventRaw, ValidationError
from analytics.store import AnalyticsStore

BATCH_SIZE = 64
_BACKOFF_MAX_S = 30.0


def _handle_payload(store: AnalyticsStore, data: dict) -> bool:
    if data.get("type") != "vision_analytics_event":
        return False
    raw = data.get("payload")
    if not isinstance(raw, dict):
        return False
    try:
        event = EventRaw.from_dict(raw)
    except (ValidationError, KeyError, TypeError, ValueError):
        return False
    store.update_aggregation(event, commit=False)
    store.upsert_trajectory(event, commit=False)
    return True


def run_consumer() -> None:
    bs = strip_env_comment(os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:19092"))
    if not bs:
        print("Defina KAFKA_BOOTSTRAP_SERVERS", file=sys.stderr)
        raise SystemExit(2)
    topic = strip_env_comment(os.environ.get("ANALYTICS_KAFKA_TOPIC", "vision.analytics.events"))
    topic = topic or "vision.analytics.events"
    group = strip_env_comment(os.environ.get("ANALYTICS_KAFKA_GROUP", "contagem-analytics-vision"))
    group = group or "contagem-analytics-vision"

    try:
        from kafka import KafkaConsumer
    except ImportError:
        print("Instale kafka-python", file=sys.stderr)
        raise SystemExit(2)

    init_db()
    engine = make_engine()
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    consumer = KafkaConsumer(
        topic,
        bootstrap_servers=[x.strip() for x in bs.split(",") if x.strip()],
        group_id=group,
        value_deserializer=lambda b: json.loads(b.decode("utf-8")),
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        consumer_timeout_ms=1000,
        max_poll_records=BATCH_SIZE,
    )

    stop = False
    _backoff = 1.0

    def _sig(_a: int, _b: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    print(f"[analytics-consumer] Kafka {bs!r} topico={topic!r} grupo={group!r} lote={BATCH_SIZE}", flush=True)
    print(f"[analytics-consumer] DATABASE_URL={os.environ.get('DATABASE_URL', '')!r}", flush=True)

    while not stop:
        try:
            pack = consumer.poll(timeout_ms=800)
        except Exception as exc:
            print(f"[analytics-consumer] poll erro: {exc}", flush=True)
            time.sleep(min(_backoff, _BACKOFF_MAX_S))
            _backoff = min(_backoff * 2, _BACKOFF_MAX_S)
            continue

        if not pack:
            _backoff = 1.0
            continue

        # Acumula todos os registos do poll num único lote
        records = [rec for records in pack.values() for rec in records if rec.value]
        if not records:
            continue

        with Session() as sess:
            store = AnalyticsStore(sess)
            processed = 0
            try:
                for rec in records:
                    if _handle_payload(store, rec.value):
                        processed += 1
                sess.commit()
                consumer.commit()
                _backoff = 1.0
                if processed:
                    print(
                        f"[analytics-consumer] {processed}/{len(records)} eventos persistidos",
                        flush=True,
                    )
            except Exception as exc:
                try:
                    sess.rollback()
                except Exception:
                    pass
                print(
                    f"[analytics-consumer] erro BD ({processed} processados de {len(records)}): {exc} "
                    f"— offset nao avancado, reprocessamento na proxima iteracao",
                    flush=True,
                )
                # Não avança o offset: Kafka vai re-entregar na próxima iteração
                time.sleep(min(_backoff, _BACKOFF_MAX_S))
                _backoff = min(_backoff * 2, _BACKOFF_MAX_S)

    consumer.close()
    print("[analytics-consumer] terminado.", flush=True)


def main() -> None:
    run_consumer()


if __name__ == "__main__":
    main()
