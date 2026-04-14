from __future__ import annotations

import json
import os
import queue
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

_kafka_configured: bool | None = None
_producer: Any = None
_msg_queue: queue.Queue[dict[str, Any] | None] | None = None
_worker_thread: threading.Thread | None = None
_stop = threading.Event()


def _bootstrap_servers() -> str:
    return os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "").strip()


def _topic() -> str:
    t = os.environ.get("KAFKA_TOPIC_PERSIST", "contagem.persist").strip()
    return t or "contagem.persist"


def _site_id() -> str:
    s = os.environ.get("SITE_ID", "default").strip()
    return s or "default"


def _ensure_producer() -> Any:
    global _producer, _kafka_configured
    if _kafka_configured is False:
        return None
    if _producer is not None:
        return _producer
    bs = _bootstrap_servers()
    if not bs:
        _kafka_configured = False
        print(
            "[persist] KAFKA_BOOTSTRAP_SERVERS nao definido — persistencia via Kafka desativada.",
            flush=True,
        )
        return None
    try:
        from kafka import KafkaProducer
    except ImportError:
        _kafka_configured = False
        print(
            "[persist] Instale kafka-python: pip install kafka-python",
            flush=True,
        )
        return None
    servers = [x.strip() for x in bs.split(",") if x.strip()]
    _producer = KafkaProducer(
        bootstrap_servers=servers,
        value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"),
        acks=1,
        linger_ms=10,
        compression_type="gzip",
        retries=2,
        request_timeout_ms=30000,
    )
    _kafka_configured = True
    print(
        f"[persist] Produtor Kafka: {servers!r} topico={_topic()!r}",
        flush=True,
    )
    return _producer


def _worker() -> None:
    while not _stop.is_set():
        try:
            item = _msg_queue.get(timeout=0.35)  # type: ignore[union-attr]
        except queue.Empty:
            p = _ensure_producer()
            if p is not None:
                p.poll(0)
            continue
        if item is None:
            break
        p = _ensure_producer()
        if p is None:
            continue
        try:
            p.send(_topic(), value=item)
            p.poll(0)
        except Exception as exc:
            print(f"[persist] falha ao enviar (Kafka): {exc}", flush=True)


def _start_queue_worker() -> None:
    global _msg_queue, _worker_thread
    if _msg_queue is not None:
        return
    maxsz = int(os.environ.get("PERSIST_QUEUE_MAX", "4000"))
    _msg_queue = queue.Queue(maxsize=max(64, maxsz))
    _worker_thread = threading.Thread(target=_worker, name="kafka-persist", daemon=True)
    _worker_thread.start()


def enqueue(message: dict[str, Any]) -> None:
    if not _bootstrap_servers():
        return
    _start_queue_worker()
    env = dict(message)
    env.setdefault("v", 1)
    env.setdefault("site_id", _site_id())
    env.setdefault("emitted_at", datetime.now(timezone.utc).isoformat())
    try:
        _msg_queue.put_nowait(env)  # type: ignore[union-attr]
    except queue.Full:
        try:
            _msg_queue.get_nowait()  # type: ignore[union-attr]
        except queue.Empty:
            pass
        try:
            _msg_queue.put_nowait(env)  # type: ignore[union-attr]
        except queue.Full:
            print("[persist] fila interna cheia — mensagem descartada", flush=True)


def emit_config_event(
    *,
    session_id: str,
    event_type: str,
    payload: dict[str, Any],
) -> None:
    enqueue(
        {
            "type": "config_change",
            "session_id": session_id,
            "event_type": event_type,
            "payload": payload,
        }
    )


def start_stats_emitter_thread(
    *,
    session_id: str,
    get_stats: Callable[[], dict[str, Any]],
    interval_sec: float | None = None,
) -> threading.Thread | None:
    if not _bootstrap_servers():
        return None
    sec = float(
        interval_sec
        if interval_sec is not None
        else os.environ.get("PERSIST_STATS_INTERVAL", "2.0")
    )
    sec = max(0.5, sec)
    _start_queue_worker()

    def loop() -> None:
        while not _stop.is_set():
            try:
                body = get_stats()
            except Exception as exc:
                print(f"[persist] leitura de stats para Kafka: {exc}", flush=True)
                time.sleep(sec)
                continue
            enqueue(
                {
                    "type": "stats_snapshot",
                    "session_id": session_id,
                    "payload": body,
                }
            )
            time.sleep(sec)

    t = threading.Thread(target=loop, name="persist-stats", daemon=True)
    t.start()
    return t


def shutdown_emitter() -> None:
    _stop.set()
    if _msg_queue is not None:
        try:
            _msg_queue.put_nowait(None)
        except Exception:
            pass
    if _worker_thread is not None:
        _worker_thread.join(timeout=3.0)
    global _producer
    if _producer is not None:
        try:
            _producer.flush(timeout=8)
            _producer.close()
        except Exception:
            pass
        _producer = None
