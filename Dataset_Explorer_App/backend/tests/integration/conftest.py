# ============================================================
# backend/tests/integration/conftest.py
#
# Fixtures partagees pour les tests d'integration multiuser.
#
# La fixture `multiuser_instances` demarre N backends uvicorn
# (un par utilisateur), attend qu'ils soient tous prets,
# puis les arrete et nettoie les workspaces en teardown.
#
# Variables d'environnement configurables :
#   TEST_DATASET_DIR    chemin du dossier d'images de test
#   MULTIUSER_N_USERS   nombre d'utilisateurs (defaut 10, min 2)
#   MULTIUSER_BASE_PORT port de depart (defaut 8010)
#   MULTIUSER_TIMEOUT   secondes d'attente par backend (defaut 90)
#   MULTIUSER_KEEP_WS   si "1", conserve les workspaces apres test
# ============================================================

import json
import os
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import pytest

# ---- Chemins ----------------------------------------------------------------

APP_ROOT = Path(__file__).parent.parent.parent.parent   # Dataset_Explorer_App/
WS_BASE  = APP_ROOT.parent / "workspaces"               # ../workspaces/

# ---- Configuration depuis variables d'environnement ------------------------

ALL_USERS = ["alice", "bob", "carol", "david", "eve",
             "frank", "grace", "henry", "iris", "jack"]

N_USERS     = min(max(int(os.environ.get("MULTIUSER_N_USERS", "10")), 2), 10)
BASE_PORT   = int(os.environ.get("MULTIUSER_BASE_PORT", "8010"))
WAIT_TIMEOUT = int(os.environ.get("MULTIUSER_TIMEOUT", "90"))
KEEP_WS     = os.environ.get("MULTIUSER_KEEP_WS", "0") == "1"

USERS = ALL_USERS[:N_USERS]

DEFAULT_DATASET_DIR = str(Path(__file__).parent.parent.parent.parent.parent / "Annotation_App" / "data_test" / "test dev")
DATASET_DIR = Path(os.environ.get("TEST_DATASET_DIR", DEFAULT_DATASET_DIR))

PYTHON = sys.executable


# ---- Helpers reseau ---------------------------------------------------------

def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _wait_backend_ready(port: int, timeout: int = WAIT_TIMEOUT) -> bool:
    """Poll GET /api/datasets jusqu'a reponse 200."""
    from urllib import request, error as ue
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with request.urlopen(f"http://localhost:{port}/api/datasets", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1.5)
    return False


# ---- Fixture principale -----------------------------------------------------

@pytest.fixture(scope="session")
def multiuser_instances():
    """
    Demarre N backends uvicorn en parallele, un par utilisateur.

    Yield :
        list[dict] — instances avec cles : user, port, workspace
        (uniquement les backends qui ont repondu OK dans le timeout)

    Teardown : SIGTERM sur chaque backend + nettoyage workspaces.
    """

    # Verifier disponibilite des ports
    busy = [BASE_PORT + i for i in range(N_USERS) if not is_port_free(BASE_PORT + i)]
    if busy:
        pytest.skip(
            f"Ports deja occupes : {busy}. "
            "Stoppez les processus en cours ou changez MULTIUSER_BASE_PORT."
        )

    procs: list[tuple[subprocess.Popen, object, Path]] = []
    instances: list[dict] = []

    for i, user in enumerate(USERS):
        port      = BASE_PORT + i
        workspace = WS_BASE / f"workspace_{user}_itest"

        for sub in ["thumbs", "faiss", "subsets"]:
            (workspace / sub).mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["EXPLORER_WORKSPACE"]     = str(workspace)
        env["EXPLORER_USER"]          = user
        env["BACKEND_PORT"]       = str(port)
        env["EXPLORER_FRONTEND_PORT"] = str(port + 1000)

        log_path = workspace / "backend.log"
        log_fh   = open(log_path, "w", encoding="utf-8")

        proc = subprocess.Popen(
            [
                PYTHON, "-m", "uvicorn",
                "backend.main:app",
                "--host", "0.0.0.0",
                "--port", str(port),
                # pas --reload : plus rapide et evite watchfiles en conflit
            ],
            cwd=str(APP_ROOT),
            env=env,
            stdout=log_fh,
            stderr=log_fh,
        )

        procs.append((proc, log_fh, workspace))
        instances.append({"user": user, "port": port, "workspace": workspace})
        time.sleep(0.2)

    # Attente parallele : tous les backends doivent etre prets
    import threading

    ready_flags: dict[str, bool] = {}
    threads = []

    def _wait(inst: dict) -> None:
        ok = _wait_backend_ready(inst["port"], WAIT_TIMEOUT)
        ready_flags[inst["user"]] = ok

    for inst in instances:
        t = threading.Thread(target=_wait, args=(inst,), daemon=True)
        t.start()
        threads.append(t)

    for t in threads:
        t.join()

    ready_instances = [i for i in instances if ready_flags.get(i["user"])]
    not_ready = [i["user"] for i in instances if not ready_flags.get(i["user"])]

    if not_ready:
        print(f"\n[conftest] ATTENTION : backends pas prets dans le delai : {not_ready}")

    if not ready_instances:
        for proc, fh, _ in procs:
            proc.kill()
            fh.close()
        pytest.fail("Aucun backend n'a demarre correctement dans le delai imparti.")

    # Yield vers les tests
    yield ready_instances

    # ---- Teardown -----------------------------------------------------------

    for proc, fh, _ in procs:
        try:
            proc.terminate()
        except Exception:
            pass

    deadline = time.time() + 10
    while time.time() < deadline:
        if all(p.poll() is not None for p, _, _ in procs):
            break
        time.sleep(0.3)

    for proc, fh, _ in procs:
        try:
            proc.kill()
        except Exception:
            pass
        try:
            fh.close()
        except Exception:
            pass

    if not KEEP_WS:
        for _, _, workspace in procs:
            shutil.rmtree(workspace, ignore_errors=True)


@pytest.fixture(scope="session")
def dataset_dir() -> Path:
    """
    Chemin du dossier d'images de test.
    Skip les tests si le dossier n'existe pas.
    """
    if not DATASET_DIR.exists():
        pytest.skip(
            f"Dossier dataset absent : {DATASET_DIR}. "
            "Definissez TEST_DATASET_DIR dans l'environnement."
        )
    return DATASET_DIR
