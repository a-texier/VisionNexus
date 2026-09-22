# ============================================================
# core/job_runner.py
# Pool de workers borné pour les traitements lourds
# (scan, embeddings, recluster, réduction 2D).
#
# Pourquoi pas BackgroundTasks : Starlette exécute chaque tâche de fond dans le
# threadpool anyio PARTAGÉ avec tous les endpoints synchrones. Un scan ou un
# embed qui dure plusieurs minutes y monopolise un thread, et rien ne limite le
# nombre de pipelines lourds simultanés — deux embeds lancés en même temps se
# battent pour le GPU et se ralentissent mutuellement.
#
# Ce pool est séparé (les requêtes HTTP gardent leurs threads), borné
# (EXPLORER_JOB_WORKERS, 3 par défaut) et dédupliqué par clé : relancer un job
# déjà en cours sur le même dataset est un no-op.
# ============================================================

import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Dict, List

logger = logging.getLogger(__name__)

JOB_WORKERS = max(1, int(os.environ.get("EXPLORER_JOB_WORKERS", "3")))

_executor = ThreadPoolExecutor(max_workers=JOB_WORKERS, thread_name_prefix="cvexp-job")
_lock = threading.Lock()
_active: Dict[str, str] = {}   # clé -> "queued" | "running"


def submit_job(key: str, fn: Callable, *args, **kwargs) -> bool:
    """Planifie `fn(*args)` dans le pool. Retourne False si `key` tourne déjà."""
    with _lock:
        if key in _active:
            logger.info("Job %s deja en cours (%s) — ignore", key, _active[key])
            return False
        _active[key] = "queued"

    def _wrapper():
        with _lock:
            _active[key] = "running"
        try:
            fn(*args, **kwargs)
        except Exception:
            logger.exception("Job %s termine en erreur", key)
        finally:
            with _lock:
                _active.pop(key, None)

    _executor.submit(_wrapper)
    return True


def active_jobs() -> List[dict]:
    with _lock:
        return [{"key": k, "state": v} for k, v in sorted(_active.items())]


def is_active(key: str) -> bool:
    with _lock:
        return key in _active


def wait_idle(timeout: float = 60.0) -> bool:
    """Bloque jusqu'à ce qu'aucun job ne soit en cours. False si le délai expire.

    Utile pour un arrêt propre et pour tout appelant qui a besoin du résultat
    d'un job (les tests notamment, qui ne peuvent plus s'appuyer sur l'exécution
    synchrone des BackgroundTasks de TestClient)."""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _lock:
            if not _active:
                return True
        time.sleep(0.05)
    return False


def shutdown(wait: bool = False) -> None:
    _executor.shutdown(wait=wait, cancel_futures=not wait)
