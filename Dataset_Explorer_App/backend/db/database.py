# ============================================================
# db/database.py
# Moteur SQLite synchrone + gestion de session.
# ============================================================

from sqlalchemy import event
from sqlmodel import SQLModel, Session, create_engine

from backend.config import DATABASE_URL


# Moteur SQLite — WAL mode pour meilleures performances concurrentes
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, _conn_record):
    """Active WAL + busy_timeout à chaque connexion.

    Nécessaire car plusieurs tâches de fond peuvent écrire en parallèle
    (scan/thumbnails + embedding + recluster) : WAL autorise lecteurs
    concurrents + un écrivain, et busy_timeout fait patienter un écrivain
    plutôt que de lever immédiatement 'database is locked'.
    """
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=10000")   # 10 s
        cur.execute("PRAGMA synchronous=NORMAL")
    finally:
        cur.close()


def create_db_and_tables() -> None:
    """Crée toutes les tables si elles n'existent pas."""
    # Import des modèles pour que SQLModel les enregistre
    from backend.db import models  # noqa: F401
    SQLModel.metadata.create_all(engine)


def get_session():
    """Dépendance FastAPI — générateur de session SQLite."""
    with Session(engine) as session:
        yield session
