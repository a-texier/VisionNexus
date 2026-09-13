# ============================================================
# backend/tests/integration/conftest.py — Annotation App
#
# Fixtures partagees pour les tests d'integration multiuser.
#
# Variables d'environnement configurables :
#   MULTIUSER_N_USERS   nombre d'utilisateurs (defaut 10, min 2)
#   MULTIUSER_BASE_PORT port de depart (defaut 8020)
#   MULTIUSER_TIMEOUT   secondes d'attente par backend (defaut 30)
#   MULTIUSER_KEEP_WS   si "1", conserve les workspaces apres test
#
# Note : base port 8020 pour eviter conflit avec Dataset Explorer (8010-8019)
# ============================================================

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import threading
from pathlib import Path

import pytest

# ---- Chemins ----------------------------------------------------------------

APP_ROOT = Path(__file__).parent.parent.parent.parent   # Annotation_App/
WS_BASE  = APP_ROOT.parent / "workspaces"               # ../workspaces/

# ---- Configuration ----------------------------------------------------------

ALL_USERS = ["alice", "bob", "carol", "david", "eve",
             "frank", "grace", "henry", "iris", "jack"]

N_USERS      = min(max(int(os.environ.get("MULTIUSER_N_USERS", "10")), 2), 10)
BASE_PORT    = int(os.environ.get("MULTIUSER_BASE_PORT", "8020"))
WAIT_TIMEOUT = int(os.environ.get("MULTIUSER_TIMEOUT", "30"))
KEEP_WS      = os.environ.get("MULTIUSER_KEEP_WS", "0") == "1"

USERS  = ALL_USERS[:N_USERS]
PYTHON = sys.executable


# ---- Helpers reseau ---------------------------------------------------------

def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _wait_backend_ready(port: int, timeout: int = WAIT_TIMEOUT) -> bool:
    """Poll GET /health jusqu'a reponse 200."""
    from urllib import request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with request.urlopen(f"http://localhost:{port}/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


# ---- Fixture principale -----------------------------------------------------

@pytest.fixture(scope="session")
def multiuser_instances():
    """
    Demarre N backends Annotation App (uvicorn) en parallele.

    Chaque backend :
    - a son propre workspace (annotation.db distinct)
    - ecoute sur BASE_PORT + i
    - demarre avec TRANSFORMERS_OFFLINE=1 (pas de telechargement SAM2)

    Yield :
        list[dict] — {"user", "port", "workspace"} uniquement pour les
        backends qui ont repondu OK.

    Teardown : SIGTERM + nettoyage workspaces.
    """

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
        workspace = WS_BASE / f"workspace_{user}_annot_itest"

        for sub in ["projects", "exports", "backup"]:
            (workspace / sub).mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["ANNOTATION_WORKSPACE"]     = str(workspace)
        env["BACKEND_PORT"]             = str(port)
        env["ANNOTATION_FRONTEND_PORT"] = str(port + 1000)
        # Desactiver le chargement des modeles IA (SAM2, Grounding DINO)
        # pour un demarrage rapide en mode test
        env["TRANSFORMERS_OFFLINE"]     = "1"
        env["HF_HUB_OFFLINE"]           = "1"

        log_path = workspace / "backend.log"
        log_fh   = open(log_path, "w", encoding="utf-8")

        proc = subprocess.Popen(
            [
                PYTHON, "-m", "uvicorn",
                "backend.main:app",
                "--host", "0.0.0.0",
                "--port", str(port),
                # pas de --reload en mode test
            ],
            cwd=str(APP_ROOT),
            env=env,
            stdout=log_fh,
            stderr=log_fh,
        )

        procs.append((proc, log_fh, workspace))
        instances.append({"user": user, "port": port, "workspace": workspace})
        time.sleep(0.1)

    # Attente parallele
    ready_flags: dict[str, bool] = {}

    def _wait(inst: dict) -> None:
        ready_flags[inst["user"]] = _wait_backend_ready(inst["port"], WAIT_TIMEOUT)

    threads = [threading.Thread(target=_wait, args=(i,), daemon=True) for i in instances]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    ready_instances = [i for i in instances if ready_flags.get(i["user"])]
    not_ready = [i["user"] for i in instances if not ready_flags.get(i["user"])]

    if not_ready:
        print(f"\n[conftest] ATTENTION : backends pas prets : {not_ready}")

    if not ready_instances:
        for proc, fh, _ in procs:
            proc.kill()
            fh.close()
        pytest.fail("Aucun backend Annotation App n'a demarre correctement.")

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
