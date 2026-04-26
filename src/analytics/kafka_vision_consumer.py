"""Consumidor dedicado: aplica EventRaw à mesma lógica que AggregatorWorker (idempotente)."""

from __future__ import annotations

import json
import os
import signal
import sys

from sqlalchemy.orm import sessionmaker

from persistence.db import init_db, make_engine
from persistence.envutil import strip_env_comment

from analytics.models import EventRaw, ValidationError
from analytics.store import AnalyticsStore


def _handle_payload(sess: object, data: dict) -> None:
    if data.get("type") != "vision_analytics_event":
        return
    raw = data.get("payload")
    if not isinstance(raw, dict):
        return
    try:
        event = EventRaw.from_dict(raw)
    except (ValidationError, KeyError, TypeError, ValueError):
        return
    store = AnalyticsStore(sess)
    store.update_aggregation(event)
    store.upsert_trajectory(event)


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
    )

    stop = False

    def _sig(_a: int, _b: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    print(f"[analytics-consumer] Kafka {bs!r} topico={topic!r} grupo={group!r}", flush=True)
    print(f"[analytics-consumer] DATABASE_URL={os.environ.get('DATABASE_URL', '')!r}", flush=True)

    while not stop:
        try:
            pack = consumer.poll(timeout_ms=800)
        except Exception as exc:
            print(f"[analytics-consumer] poll: {exc}", flush=True)
            continue
        if not pack:
            continue
        with Session() as sess:
            try:
                for _tp, records in pack.items():
                    for rec in records:
                        if rec.value:
                            _handle_payload(sess, rec.value)
                sess.commit()
                consumer.commit()
            except Exception as exc:
                sess.rollback()
                print(f"[analytics-consumer] erro: {exc}", flush=True)
    consumer.close()
    print("[analytics-consumer] terminado.", flush=True)


def main() -> None:
    run_consumer()


if __name__ == "__main__":
    main()
