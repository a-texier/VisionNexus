# ============================================================
# database.py — SQLite engine (SQLModel)
# ============================================================

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

from backend.config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


# Colonnes ajoutees apres coup : create_all ne modifie pas une table existante.
_ADDED_COLUMNS = {
    "training_run": {"engine": "VARCHAR NOT NULL DEFAULT 'yolox'"},
}


def _add_missing_columns() -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            present = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in present:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def get_session():
    with Session(engine) as session:
        yield session
