# ============================================================
# core/mlflow_client.py
# Wrapper MLflow SDK.
#
# ROBUSTESSE : par defaut le tracking est un store SQLITE local du workspace
# (MLFLOW_TRACKING_URI = sqlite:///<ws>/mlflow_data/mlflow.db). Aucun serveur
# MLflow, aucun port ouvert -> plus de deconnexions ni de collisions de port.
# MlflowClient lit/ecrit directement le fichier. Le mode serveur HTTP n'est
# demarre QUE si l'URI est explicitement http(s):// (compat legacy).
# ============================================================

import os
import subprocess
import time
import logging

# Disable mlflow plugin loading at import time to avoid circular import.
os.environ.setdefault("MLFLOW_DISABLE_PLUGINS", "1")

from backend.config import MLFLOW_TRACKING_URI, MLFLOW_DATA_DIR

logger = logging.getLogger(__name__)

_mlflow_proc: "subprocess.Popen | None" = None


def _is_http_uri() -> bool:
    return MLFLOW_TRACKING_URI.startswith(("http://", "https://"))


def get_client():
    """MlflowClient sur MLFLOW_TRACKING_URI (sqlite:// direct ou http://)."""
    from mlflow.tracking import MlflowClient
    return MlflowClient(tracking_uri=MLFLOW_TRACKING_URI)


def is_mlflow_running() -> bool:
    """Store disponible ?
    - sqlite/file : toujours vrai si le client peut lister (store local).
    - http        : ping /health du serveur.
    """
    if _is_http_uri():
        try:
            import requests
            return requests.get(f"{MLFLOW_TRACKING_URI}/health", timeout=2).ok
        except Exception:
            return False
    # Store local : un simple search_experiments confirme l'acces au fichier.
    try:
        get_client().search_experiments(max_results=1)
        return True
    except Exception:
        logger.exception("Store MLflow local inaccessible : %s", MLFLOW_TRACKING_URI)
        return False


def ensure_mlflow_running() -> bool:
    """Store local : rien a demarrer (retourne True). HTTP : spawn le serveur."""
    global _mlflow_proc
    if not _is_http_uri():
        logger.info("Store MLflow serverless (sqlite) : %s", MLFLOW_TRACKING_URI)
        return is_mlflow_running()

    if is_mlflow_running():
        logger.info("Serveur MLflow deja actif : %s", MLFLOW_TRACKING_URI)
        return True

    from urllib.parse import urlparse
    parsed = urlparse(MLFLOW_TRACKING_URI)
    host, port = parsed.hostname or "127.0.0.1", parsed.port or 5000
    logger.info("Demarrage du serveur MLflow sur %s:%d ...", host, port)
    try:
        import sys as _sys
        _mlflow_proc = subprocess.Popen(
            [_sys.executable, "-m", "mlflow", "server", "--host", host, "--port", str(port),
             "--backend-store-uri", f"sqlite:///{(MLFLOW_DATA_DIR / 'mlflow.db').as_posix()}",
             "--default-artifact-root", str(MLFLOW_DATA_DIR / "artifacts")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        logger.error("Module mlflow introuvable — pip install mlflow")
        return False

    for _ in range(30):
        time.sleep(1)
        if is_mlflow_running():
            return True
    logger.error("Serveur MLflow n'a pas demarre dans les delais")
    return False


def stop_mlflow_server() -> None:
    global _mlflow_proc
    if _mlflow_proc is not None:
        _mlflow_proc.terminate()
        _mlflow_proc = None
        logger.info("Serveur MLflow arrete")
