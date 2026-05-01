"""Event audit log — append-only SQLite journal.

6.2 — Records every counting event (entry/exit/zone) with track id, confidence
score, normalised position, and free-form metadata.  Designed for:

  * Debugging false-positives / false-negatives
  * Audit trails for high-security installations
  * Explainability ("why did entry 47 fire?")

Table: audit_events
    id           INTEGER PRIMARY KEY AUTOINCREMENT
    ts           REAL     NOT NULL        -- time.monotonic() at event
    wall_ts      TEXT     NOT NULL        -- ISO-8601 wall-clock
    session_id   TEXT     NOT NULL
    event_type   TEXT     NOT NULL        -- 'entry','exit','zone_entry','zone_exit',
                                          --   'alert','profile_change','session_start',
                                          --   'drift_detected'
    track_id     INTEGER                  -- NULL for system events
    confidence   REAL                     -- track confidence score at event time
    x_norm       REAL                     -- foot x in [0,1]
    y_norm       REAL                     -- foot y in [0,1]
    metadata     TEXT                     -- JSON blob (zone_name, reason, etc.)
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path


_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "audit_log.db"
_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          REAL    NOT NULL,
    wall_ts     TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    event_type  TEXT    NOT NULL,
    track_id    INTEGER,
    confidence  REAL,
    x_norm      REAL,
    y_norm      REAL,
    metadata    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_type    ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_ts      ON audit_events(ts);
"""

# Insert batching: flush when buffer >= BATCH_SIZE or >= FLUSH_INTERVAL_S seconds.
_BATCH_SIZE: int = 64
_FLUSH_INTERVAL_S: float = 5.0


class AuditLog:
    """Thread-safe audit log backed by SQLite with write-batching."""

    def __init__(self, db_path: Path | None = None) -> None:
        self._path = db_path or _DB_PATH
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._buf: list[tuple] = []
        self._last_flush = 0.0
        self._con: sqlite3.Connection | None = None
        self._init_db()

    def _init_db(self) -> None:
        try:
            con = sqlite3.connect(str(self._path), check_same_thread=False)
            con.executescript(_SCHEMA)
            con.commit()
            self._con = con
        except Exception:
            self._con = None   # degrade gracefully if data/ dir missing

    def log(
        self,
        *,
        ts: float,
        session_id: str,
        event_type: str,
        track_id: int | None = None,
        confidence: float | None = None,
        x_norm: float | None = None,
        y_norm: float | None = None,
        metadata: dict | None = None,
    ) -> None:
        if self._con is None:
            return
        wall = datetime.now(tz=timezone.utc).isoformat()
        row = (
            ts, wall, session_id, event_type,
            track_id, confidence, x_norm, y_norm,
            json.dumps(metadata) if metadata else None,
        )
        import time as _time
        with self._lock:
            self._buf.append(row)
            now = _time.monotonic()
            if len(self._buf) >= _BATCH_SIZE or (now - self._last_flush) >= _FLUSH_INTERVAL_S:
                self._flush_locked()
                self._last_flush = now

    def flush(self) -> None:
        with self._lock:
            self._flush_locked()

    def _flush_locked(self) -> None:
        if not self._buf or self._con is None:
            return
        try:
            self._con.executemany(
                "INSERT INTO audit_events "
                "(ts,wall_ts,session_id,event_type,track_id,confidence,x_norm,y_norm,metadata) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                self._buf,
            )
            self._con.commit()
            self._buf.clear()
        except Exception:
            pass  # never crash the inference loop

    def query(
        self,
        session_id: str | None = None,
        event_type: str | None = None,
        since_ts: float | None = None,
        limit: int = 200,
    ) -> list[dict]:
        """Return up to *limit* events newest-first, optionally filtered."""
        self.flush()
        if self._con is None:
            return []
        clauses: list[str] = []
        params: list = []
        if session_id:
            clauses.append("session_id = ?")
            params.append(session_id)
        if event_type:
            clauses.append("event_type = ?")
            params.append(event_type)
        if since_ts is not None:
            clauses.append("ts >= ?")
            params.append(since_ts)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        sql = f"SELECT * FROM audit_events {where} ORDER BY ts DESC LIMIT ?"
        params.append(limit)
        try:
            cur = self._con.execute(sql, params)
            cols = [d[0] for d in cur.description]
            rows = []
            for row in cur.fetchall():
                d = dict(zip(cols, row))
                if d.get("metadata"):
                    try:
                        d["metadata"] = json.loads(d["metadata"])
                    except Exception:
                        pass
                rows.append(d)
            return rows
        except Exception:
            return []

    def session_summary(self, session_id: str) -> dict:
        """Count events by type for a session."""
        self.flush()
        if self._con is None:
            return {}
        try:
            cur = self._con.execute(
                "SELECT event_type, COUNT(*) FROM audit_events "
                "WHERE session_id=? GROUP BY event_type",
                (session_id,),
            )
            return dict(cur.fetchall())
        except Exception:
            return {}
