# ============================================================
# database.py
# Configuration et initialisation de la base de données SQLite.
# Utilise SQLModel (surcouche Pydantic + SQLAlchemy) pour la définition
# des tables et la gestion des sessions de base de données.
# ============================================================

from typing import Generator

from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from backend.config import DATABASE_URL  # noqa: F401 — workspace configurable via ANNOTATION_WORKSPACE

# check_same_thread=False est nécessaire pour FastAPI (threads multiples)
# timeout=30 : attend jusqu'à 30 s qu'un verrou d'écriture se libère au lieu
# d'échouer immédiatement en "database is locked" (imports en arrière-plan).
# Dimensionnement du pool : SQLAlchemy 2.x utilise QueuePool meme pour un SQLite
# sur fichier, avec pool_size=5 / max_overflow=10, soit 15 connexions MAXIMUM.
# Or les endpoints FastAPI declares en `def` (la grande majorite ici) tournent
# dans le threadpool anyio, qui compte 40 threads : 40 requetes peuvent donc
# reclamer une session en meme temps pour 15 connexions disponibles. Les 25
# autres attendaient `pool_timeout`, soit exactement 30 s -- la meme valeur que
# le timeout axios du frontend, d'ou le "Le backend ne repond pas" affiche sur
# TOUTES les requetes en vol et l'app entierement figee, sans qu'aucun calcul
# GPU ne soit en cours.
#
# Ce qui remplissait le pool : les endpoints lourds gardent leur connexion
# pendant toute leur E/S. `frame_histogram` et `serve_frame_image` font un
# cv2.imread d'un PNG 16 bits situe sur un montage RESEAU (les frames sont des
# liens symboliques vers un autre partage) tout en tenant une connexion.
# Quelques frames en vol suffisaient a saturer les 15 places.
#
# On dimensionne donc le pool AU-DESSUS du threadpool : une requete ne doit
# jamais attendre une connexion, seulement le verrou SQLite (gere par WAL +
# busy_timeout). Des connexions SQLite sont bon marche, et QueuePool les
# recycle -- les PRAGMA ci-dessous ne repassent qu'a l'ouverture reelle.
_POOL_SIZE = 20
_MAX_OVERFLOW = 40   # 60 connexions max > 40 threads anyio

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
    pool_size=_POOL_SIZE,
    max_overflow=_MAX_OVERFLOW,
    # Si malgre tout le pool sature, echouer VITE et bruyamment plutot que de
    # laisser 30 s de silence que l'UI ne peut pas distinguer d'un plantage.
    pool_timeout=10,
    pool_recycle=3600,
    echo=False,  # Passer à True pour voir les requêtes SQL en développement
)


# ---- Activation de WAL mode pour SQLite (meilleures performances en concurrence) ----
@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    """
    Active le mode WAL (Write-Ahead Logging) de SQLite.
    Ce mode permet des lectures concurrentes pendant les écritures,
    ce qui est important pour les tâches Celery en arrière-plan.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")  # Enforce les clés étrangères
    cursor.execute("PRAGMA busy_timeout=30000")  # Attente verrou (ms) au niveau connexion
    cursor.execute("PRAGMA synchronous=NORMAL")  # Suffisant en WAL, écritures bien plus rapides
    cursor.close()


def create_db_and_tables() -> None:
    """
    Crée toutes les tables définies dans les modèles SQLModel.
    À appeler au démarrage de l'application (événement startup FastAPI).
    Les imports ci-dessous sont nécessaires pour que SQLModel découvre les tables.
    """
    # Importations nécessaires pour enregistrer les métadonnées des tables
    import backend.models.annotation  # noqa: F401
    import backend.models.frame  # noqa: F401
    import backend.models.label_class  # noqa: F401
    import backend.models.project  # noqa: F401
    import backend.models.session_state  # noqa: F401
    import backend.models.track  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    """
    Générateur de session SQLModel à utiliser comme dépendance FastAPI.
    Garantit que la session est fermée après chaque requête, même en cas d'erreur.

    Usage dans un endpoint FastAPI :
        @router.get("/items")
        def get_items(session: Session = Depends(get_session)):
            ...
    """
    with Session(engine) as session:
        yield session
