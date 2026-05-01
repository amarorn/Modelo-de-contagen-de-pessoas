"""Consumidor Kafka: grava linhas na base SQL (desacoplado do processo Flask)."""

from __future__ import annotations

import json
import os
import signal
import sys

from sqlalchemy.orm import sessionmaker

from persistence.db import init_db, make_engine
from persistence.envutil import strip_env_comment
from persistence.models import ConfigEvent, StatsSnapshot


def _handle_message(sess: object, data: dict) -> None:
    site = str(data.get("site_id") or "default")[:64]
    session_id = str(data.get("session_id") or "")[:64]
    kind = data.get("type")
    if kind == "stats_snapshot":
        payload = data.get("payload")
        if payload is None:
            return
        row = StatsSnapshot(
            session_id=session_id or "unknown",
            site_id=site,
            payload_json=json.dumps(payload, ensure_ascii=False),
        )
        sess.add(row)
        return
    if kind == "config_change":
        ev = str(data.get("event_type") or "unknown")[:96]
        payload = data.get("payload")
        row = ConfigEvent(
            session_id=session_id or "unknown",
            site_id=site,
            event_type=ev,
            payload_json=json.dumps(payload if payload is not None else {}, ensure_ascii=False),
        )
        sess.add(row)
        return


def run_consumer() -> None:
    bs = strip_env_comment(os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:19092"))
    if not bs:
        print("Defina KAFKA_BOOTSTRAP_SERVERS", file=sys.stderr)
        raise SystemExit(2)
    topic = strip_env_comment(os.environ.get("KAFKA_TOPIC_PERSIST", "contagem.persist")) or "contagem.persist"
    group = strip_env_comment(os.environ.get("KAFKA_CONSUMER_GROUP", "contagem-persist")) or "contagem-persist"

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

    print(f"[consumer] Kafka {bs!r} topico={topic!r} grupo={group!r}", flush=True)
    print(f"[consumer] DATABASE_URL={os.environ.get('DATABASE_URL', 'sqlite:///data/contagem.db')!r}", flush=True)

    while not stop:
        try:
            pack = consumer.poll(timeout_ms=800)
        except Exception as exc:
            print(f"[consumer] poll: {exc}", flush=True)
            continue
        if not pack:
            continue
        with Session() as sess:
            try:
                for _tp, records in pack.items():
                    for rec in records:
                        if rec.value:
                            _handle_message(sess, rec.value)
                sess.commit()
                consumer.commit()
            except Exception as exc:
                sess.rollback()
                print(f"[consumer] erro ao gravar: {exc}", flush=True)
    consumer.close()
    print("[consumer] terminado.", flush=True)


def main() -> None:
    run_consumer()


if __name__ == "__main__":
    main()
