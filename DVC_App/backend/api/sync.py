# ============================================================
# api/sync.py
# POST /api/push  — dvc push (SSE streaming)
# POST /api/pull  — dvc pull (SSE streaming)
# ============================================================

import asyncio
import json
import logging
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.config import DVC_REPO_PATH
from backend.core.dvc_runner import (
    repo_exists, get_remotes, get_disk_usage, relink_cache, add_remote,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sync"])


def _require_repo():
    if not repo_exists():
        raise HTTPException(503, f"Repo DVC non trouvé à : {DVC_REPO_PATH}")


def _emit(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _dvc_args(args: list[str]) -> list[str]:
    """`dvc ...` -> `python -m dvc ...` : le backend est lance sans le dossier
    Scripts/ de l'env conda dans le PATH, donc dvc.exe est introuvable (meme
    correctif que dvc_runner._run). Sans ca, push/pull echouent 'commande introuvable'."""
    if args and args[0] == "dvc":
        return [sys.executable, "-m", "dvc"] + args[1:]
    return args


@router.get("/remotes")
def list_remotes():
    """Remotes DVC configures. Liste vide = aucune destination push/pull possible."""
    return {"remotes": get_remotes(), "repo_path": str(DVC_REPO_PATH),
            "repo_exists": repo_exists()}


class AddRemoteBody(BaseModel):
    name: str
    url: str          # chemin de dossier (remote local) ou url (s3://, ssh://, ...)
    default: bool = True


@router.post("/remotes")
def create_remote(body: AddRemoteBody):
    """Ajoute un remote DVC depuis l'UI (0 CLI). Un chemin de dossier = remote local
    (le dossier est cree au besoin)."""
    return add_remote(body.name, body.url, body.default)


@router.get("/disk-usage")
def disk_usage():
    """Usage disque reel : cache vs working dir + type de cache (copy vs liens).
    Calcul a la demande (peut etre lent sur gros datasets)."""
    return get_disk_usage()


@router.post("/relink")
def relink():
    """Re-materialise le working dir en liens vers le cache (de-duplique
    retroactivement l'existant apres activation des liens)."""
    return relink_cache()


async def _run_and_stream(args: list[str]):
    """Générateur SSE pour une commande CLI."""
    args = _dvc_args(args)
    yield _emit({"type": "start", "cmd": " ".join(args)})
    # Pre-flight : sans remote configure, push/pull ne peuvent RIEN faire — on le
    # dit clairement plutot que de laisser dvc echouer avec un message obscur.
    if not get_remotes():
        yield _emit({"type": "error",
                     "message": "Aucun remote DVC configure. Ajoutez-en un : "
                                "`dvc remote add -d <nom> <url>`."})
        yield _emit({"type": "done", "returncode": 1})
        return
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            cwd=str(DVC_REPO_PATH),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        async for line in proc.stdout:
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                yield _emit({"type": "log", "line": text})
            await asyncio.sleep(0)

        await proc.wait()
        if proc.returncode == 0:
            yield _emit({"type": "done", "returncode": 0})
        else:
            yield _emit({"type": "error", "returncode": proc.returncode,
                         "message": f"Exit code {proc.returncode}"})
    except FileNotFoundError:
        yield _emit({"type": "error", "message": "Commande 'dvc' introuvable"})
    except Exception as exc:
        yield _emit({"type": "error", "message": str(exc)})


@router.post("/push")
def dvc_push():
    _require_repo()
    return StreamingResponse(
        _run_and_stream(["dvc", "push"]),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/pull")
def dvc_pull():
    _require_repo()
    return StreamingResponse(
        _run_and_stream(["dvc", "pull"]),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
