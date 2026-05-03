from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from visioncount.persistence.envutil import strip_env_comment
from visioncount.persistence.models import Base
import visioncount.persistence.heatmap_models  # noqa: F401 — registra HeatmapSlot e GridVersion no Base.metadata
import visioncount.persistence.dwell_models  # noqa: F401 — DwellSlot, ZoneStatsSlot
import visioncount.persistence.zone_models  # noqa: F401 — Zone, ZoneTemplate
import visioncount.persistence.analytics_models  # noqa: F401 — EventRawRow, EventAggregatedRow, TrajectoryRow


def database_url() -> str:
    return strip_env_comment(os.environ.get("DATABASE_URL", "sqlite:///data/contagem.db"))


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
        # connect_timeout evita que o startup do Flask fique bloqueado por >OS-TCP-timeout
        # (20-127s) quando o container Postgres ainda não estiver pronto.
        return create_engine(
            url,
            future=True,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 5},
        )
    except ImportError as exc:
        if "psycopg2" in str(exc).lower():
            raise ImportError(
                "Driver PostgreSQL em falta: pip install psycopg2-binary\n"
                "Ou, sem servidor Postgres, use no .env:\n"
                "  DATABASE_URL=sqlite:///data/contagem.db"
            ) from exc
        raise


def init_db(engine: Engine | None = None) -> Engine:
    eng = engine or make_engine()
    Base.metadata.create_all(eng)
    return eng


SessionLocal: sessionmaker[Session] | None = None
_db_startup_logged = False


def _log_db_target_once(url: str) -> None:
    global _db_startup_logged
    if _db_startup_logged:
        return
    _db_startup_logged = True
    try:
        u = make_url(url)
        driver = u.drivername or "?"
        if driver == "sqlite":
            db = u.database or ""
            print(f"[db] Persistencia activa: sqlite ficheiro={db!r}", flush=True)
        else:
            host = u.host or ""
            port = u.port or ""
            db = u.database or ""
            hp = f"{host}:{port}" if port else host
            print(
                f"[db] Persistencia activa: {driver} host={hp!r} database={db!r}",
                flush=True,
            )
    except Exception:
        print(f"[db] Persistencia activa (URL nao parseada): {url[:120]!r}", flush=True)


def get_session_factory() -> sessionmaker[Session]:
    global SessionLocal
    if SessionLocal is None:
        eng = init_db()
        _log_db_target_once(database_url())
        SessionLocal = sessionmaker(bind=eng, autoflush=False, autocommit=False, future=True)
    return SessionLocal
