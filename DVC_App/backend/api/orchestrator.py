# ============================================================
# api/orchestrator.py
# Endpoint dédié à l'interconnexion avec l'Orchestrateur.
# ============================================================

import logging
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import os

from backend.config import DVC_REPO_PATH
from backend.core.dvc_runner import repo_exists, get_remotes, configure_cache_links, _run


def _linktree(src: Path, dest: Path) -> None:
    """copytree qui HARDLINK chaque fichier (aucune copie physique, meme volume)
    avec repli copy2 par fichier si hardlink impossible (cross-device, FS sans liens)."""
    def _copyfn(s: str, d: str) -> None:
        try:
            os.link(s, d)
        except OSError:
            shutil.copy2(s, d)
    shutil.copytree(src, dest, copy_function=_copyfn)


def _link_or_copy_file(src: Path, dest: Path) -> None:
    """HARDLINK d'un fichier (aucune copie) avec repli copy2."""
    if dest.exists():
        try:
            dest.unlink()
        except OSError:
            pass
    try:
        os.link(src, dest)
    except OSError:
        shutil.copy2(src, dest)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class CommitRequest(BaseModel):
    message: str = "feat: orchestrator pipeline commit"
    paths: Optional[List[str]] = None   # chemins à ajouter (défaut : tout)
    dvc_add: bool = False               # ajouter d'abord avec dvc add
    # Sources externes à VERSIONNER : copiées dans le repo puis dvc-add.
    # Sans ça le repo reste vide → "rien à committer" (bug B13, test Fable 2026-07).
    dataset_path: Optional[str] = None  # dossier dataset YOLO à versionner
    model_path:   Optional[str] = None  # fichier modèle (best.pt) à versionner
    annotations_path: Optional[str] = None  # annotations GT natives (.ver) à versionner
    metrics_path: Optional[str] = None  # fichier de métriques (insights.json du run) à versionner
    graph_json:   Optional[str] = None  # snapshot COMPLET du sandgraph (repro totale)
    params_json:  Optional[str] = None  # best params Optuna (JSON en clair, versionné)


# ------------------------------------------------------------------ #
# POST /api/orchestrator/commit                                       #
# Git add + git commit (+ dvc add si demandé).                       #
# Initialise le repo s'il n'existe pas encore.                       #
# ------------------------------------------------------------------ #

@router.post("/commit")
def commit_data(body: CommitRequest):
    # Initialiser le repo si nécessaire
    if not DVC_REPO_PATH.exists():
        DVC_REPO_PATH.mkdir(parents=True, exist_ok=True)

    # Repo git VALIDE ? On ne se fie pas a la seule presence de `.git` : un `.git`
    # partiel (ex. suppression concurrente ayant laisse `.git/objects` mais pas
    # HEAD/refs) passait ce test puis TOUS les commits echouaient en silence
    # (hash vide). On verifie que c'est un vrai repo, sinon on repare (re-init).
    def _git_valid() -> bool:
        if not (DVC_REPO_PATH / ".git").exists():
            return False
        r = _run(["git", "rev-parse", "--is-inside-work-tree"], check=False)
        return r.returncode == 0 and "true" in (r.stdout or "").lower()

    if not _git_valid():
        try:
            broken = DVC_REPO_PATH / ".git"
            if broken.exists():
                shutil.rmtree(broken, ignore_errors=True)
                logger.warning("Repo git casse detecte (.git incomplet) — re-init")
            _run(["git", "init"], check=True)
            _run(["git", "config", "user.email", "orchestrator@local"], check=False)
            _run(["git", "config", "user.name", "Orchestrator"], check=False)
            logger.info("Git repo initialise dans %s", DVC_REPO_PATH)
        except Exception as exc:
            logger.warning("Git init echoue: %s — commit ignore", exc)
            return {"ok": True, "skipped": True, "message": "Git non disponible — commit ignore"}

    # DVC init si nécessaire (pour dvc add)
    _need_dvc = body.dvc_add or body.dataset_path or body.model_path or body.annotations_path or body.metrics_path
    if _need_dvc and not (DVC_REPO_PATH / ".dvc").exists():
        try:
            _run(["dvc", "init"], check=False)
        except Exception as exc:
            logger.warning("dvc init échoué: %s", exc)
    # Cache en liens (aucune copie physique working<->cache). Idempotent, posé à
    # chaque commit -> vaut aussi pour les repos déjà initialisés sans ce réglage.
    if _need_dvc:
        configure_cache_links()

    # Copier + versionner les sources externes fournies (dataset, modèle)
    dvc_added: list[str] = []
    pointer_before: dict[str, str | None] = {}
    _copies = []
    if body.dataset_path:
        _copies.append(("datasets", Path(body.dataset_path)))
    if body.model_path:
        _copies.append(("models", Path(body.model_path)))
    if body.annotations_path:
        _copies.append(("annotations", Path(body.annotations_path)))
    if body.metrics_path:
        _copies.append(("metrics", Path(body.metrics_path)))
    import zipfile
    for sub, src in _copies:
        try:
            # Les exports Annotation_App sont des .zip : si le dossier n'existe pas
            # mais {src}.zip ou src.zip existe, on l'extrait (bug B13-bis, test Fable).
            zip_src = None
            if not src.exists():
                cand = src if src.suffix == ".zip" else Path(str(src) + ".zip")
                if cand.exists():
                    zip_src = cand
                else:
                    logger.warning("source à versionner introuvable: %s", src)
                    continue
            elif src.suffix == ".zip":
                zip_src = src

            dest_dir = DVC_REPO_PATH / sub
            dest_dir.mkdir(parents=True, exist_ok=True)
            if zip_src is not None:
                name = zip_src.stem
                dest = dest_dir / name
                if dest.exists():
                    shutil.rmtree(dest)
                dest.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(zip_src, "r") as zf:
                    zf.extractall(dest)
            else:
                name = src.name
                dest = dest_dir / name
                if src.is_dir():
                    # Dataset dossier : hardlink chaque image dans le repo (aucune
                    # copie physique) -> avec le cache en liens, source + working +
                    # cache partagent le meme inode = UNE seule copie sur disque.
                    if dest.exists():
                        shutil.rmtree(dest)
                    _linktree(src, dest)
                else:
                    _link_or_copy_file(src, dest)
            rel = f"{sub}/{name}"
            pointer = DVC_REPO_PATH / f"{rel}.dvc"
            pointer_before[rel] = pointer.read_text(encoding="utf-8") if pointer.exists() else None
            _run(["dvc", "add", rel], check=False)
            dvc_added.append(rel)
            logger.info("DVC: versionné %s", rel)
        except Exception as exc:
            logger.warning("copie/dvc add %s échoué: %s", src, exc)

    # Snapshot du graphe -> versionne en clair dans git (repro totale, sans perte).
    if body.graph_json:
        try:
            import json as _json
            gid = "graph"
            try:
                gid = (_json.loads(body.graph_json).get("graph_id") or "graph")
            except Exception:
                pass
            gdir = DVC_REPO_PATH / "graphs"
            gdir.mkdir(parents=True, exist_ok=True)
            (gdir / f"{gid}.json").write_text(body.graph_json, encoding="utf-8")
            logger.info("Snapshot graphe versionné: graphs/%s.json", gid)
        except Exception as exc:
            logger.warning("écriture graph_json échouée: %s", exc)

    # Best params Optuna -> versionnes en clair dans git (params/optuna.json).
    if body.params_json:
        try:
            pdir = DVC_REPO_PATH / "params"
            pdir.mkdir(parents=True, exist_ok=True)
            (pdir / "optuna_best.json").write_text(body.params_json, encoding="utf-8")
            logger.info("Best params Optuna versionnés: params/optuna_best.json")
        except Exception as exc:
            logger.warning("écriture params_json échouée: %s", exc)

    # DVC add des chemins explicites si demandé
    if body.dvc_add:
        dvc_paths = body.paths or ["."]
        for p in dvc_paths:
            try:
                _run(["dvc", "add", p], check=False)
            except Exception as exc:
                logger.warning("dvc add %s échoué: %s", p, exc)

    # Git add
    add_paths = body.paths or ["."]
    try:
        _run(["git", "add"] + add_paths, check=False)
    except Exception as exc:
        logger.warning("git add échoué: %s", exc)

    dvc_changed: list[str] = []
    dvc_reused: list[str] = []
    for rel in dvc_added:
        pointer = DVC_REPO_PATH / f"{rel}.dvc"
        after = pointer.read_text(encoding="utf-8") if pointer.exists() else None
        (dvc_reused if pointer_before.get(rel) == after else dvc_changed).append(rel)

    # Vérifier s'il y a des changements à committer
    try:
        status = _run(["git", "status", "--porcelain"], check=False)
        if not status.stdout.strip():
            return {
                "ok": True,
                "skipped": True,
                "message": "Rien à committer — working tree propre",
                "repo_path": str(DVC_REPO_PATH),
                "dvc_versioned": dvc_added,
                "dvc_changed": dvc_changed,
                "dvc_reused": dvc_reused,
            }
    except Exception:
        pass

    # Git commit
    try:
        result = _run(["git", "commit", "-m", body.message], check=False)
        success = result.returncode == 0
        output = result.stdout.strip() or result.stderr.strip()

        # Récupérer le hash du commit
        commit_hash = ""
        try:
            h = _run(["git", "rev-parse", "--short", "HEAD"], check=False)
            commit_hash = h.stdout.strip()
        except Exception:
            pass

        logger.info("Orchestrator: git commit '%s' — %s (DVC changés: %s, réutilisés: %s)", body.message, commit_hash, dvc_changed, dvc_reused)
        return {
            "ok": success,
            "commit_hash": commit_hash,
            "message": body.message,
            "dvc_versioned": dvc_added,
            "dvc_changed": dvc_changed,
            "dvc_reused": dvc_reused,
            "output": output[:500],
            "repo_path": str(DVC_REPO_PATH),
        }
    except Exception as exc:
        logger.warning("git commit échoué: %s", exc)
        return {"ok": False, "error": str(exc), "repo_path": str(DVC_REPO_PATH)}


# ------------------------------------------------------------------ #
# GET /api/orchestrator/status                                        #
# ------------------------------------------------------------------ #

@router.get("/status")
def get_status():
    return {
        "repo_exists": repo_exists(),
        "repo_path": str(DVC_REPO_PATH),
        "git_initialized": (DVC_REPO_PATH / ".git").exists() if DVC_REPO_PATH.exists() else False,
        "dvc_initialized": (DVC_REPO_PATH / ".dvc").exists() if DVC_REPO_PATH.exists() else False,
        "remotes": get_remotes(),
    }
