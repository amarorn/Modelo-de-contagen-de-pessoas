from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from persistence.models import Base


def database_url() -> str:
    return os.environ.get("DATABASE_URL", "sqlite:///data/contagem.db").strip()


def make_engine() -> Engine:
    url = database_url()
    parsed = make_url(url)
    if parsed.drivername == "sqlite" and parsed.database:
        repo_root = Path(__file__).resolve().parent.parent.parent
        db_path = Path(parsed.database)
        if not db_path.is_absolute():
            db_path = repo_root / db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
    if parsed.drivername == "sqlite":
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            future=True,
        )
    try:
        return create_engine(url, future=True)
    except ImportError as exc:
        if "psycopg2" in str(exc).lower():
            raise ImportError(
                "Driver PostgreSQL em falta: pip install psycopg2-binary\n"
                "Ou, sem servidor Postgres (ex.: so Redpanda no docker-compose.kafka.yml), use no .env:\n"
                "  DATABASE_URL=sqlite:///data/contagem.db"
            ) from exc
        raise


def init_db(engine: Engine | None = None) -> Engine:
    eng = engine or make_engine()
    Base.metadata.create_all(eng)
    return eng


SessionLocal: sessionmaker[Session] | None = None


def get_session_factory() -> sessionmaker[Session]:
    global SessionLocal
    if SessionLocal is None:
        eng = init_db()
        SessionLocal = sessionmaker(bind=eng, autoflush=False, autocommit=False, future=True)
    return SessionLocal
