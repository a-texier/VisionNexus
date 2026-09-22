# ============================================================
# api/launcher_api.py
# Lance et arrête les sous-apps CV depuis l'Orchestrator.
# ============================================================

import os
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.core import app_launcher
from backend.config import CURRENT_USER, WORKSPACE, _PLACEHOLDER_USERS

router = APIRouter(prefix="/api/apps", tags=["launcher"])


class LaunchBody(BaseModel):
    app_id: str
    base_workspace: Optional[str] = None   # default: WORKSPACE parent
    user: Optional[str] = None             # default: CURRENT_USER
    conda_env: str = "IA_env"


def _base_ws(override: Optional[str]) -> str:
    if override:
        return override
    # Default: INSIDE the orchestrator workspace → sub-apps nested as {WORKSPACE}/{app_id}_{user}/
    return str(WORKSPACE)


def _user(override: Optional[str]) -> str:
    """Identifiant nominatif obligatoire (cf. config._resolve_current_user).

    Le repli "user" d'avant reintroduisait exactement le probleme que
    CURRENT_USER resout : un client qui envoyait user="" ou "unknown" faisait
    retomber toutes ses sous-apps dans un workspace partage entre utilisateurs.
    """
    candidate = (override or "").strip()
    if candidate and candidate.lower() not in _PLACEHOLDER_USERS:
        return candidate
    return CURRENT_USER


@router.get("")
async def list_apps():
    """Status de toutes les sous-apps (connues + sessions actives).

    Une session lancée reste "starting" tant que personne ne vérifie son
    /health — sans ce ping, l'UI affichait "offline" pour des apps vivantes
    (bug UX repéré lors du test E2E Fable 2026-07). On ping donc ici les
    sessions non stoppées et on promeut starting → running."""
    import asyncio
    import httpx

    sessions = app_launcher.get_all_sessions()

    async def _alive(url: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=1.5) as c:
                r = await c.get(f"{url}/health")
                return r.status_code < 500
        except Exception:
            return False

    to_check = {
        app_id: s for app_id, s in sessions.items()
        if s.get("status") in ("starting", "running", "error") and s.get("backend_url")
    }
    checks = await asyncio.gather(*[_alive(s["backend_url"]) for s in to_check.values()])
    from datetime import datetime, timezone
    startup_timeout_s = 60
    for (app_id, s), ok in zip(to_check.items(), checks):
        elapsed = 0.0
        try:
            launched = datetime.fromisoformat(str(s.get("launched_at") or ""))
            if launched.tzinfo is None:
                launched = launched.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - launched).total_seconds()
        except (TypeError, ValueError):
            pass
        timed_out = s["status"] == "starting" and elapsed >= startup_timeout_s
        reason = None
        if timed_out:
            reason = (
                f"Démarrage interrompu : /health ne répond pas après {startup_timeout_s} s. "
                f"Consultez {s.get('backend_log') or 'le log backend'}."
            )
        new_status = "running" if ok else ("error" if timed_out else s["status"])
        if new_status != s["status"]:
            app_launcher.set_status(app_id, new_status, reason)
            s["status"] = new_status
            s["failure_reason"] = reason

    result = {}
    for app_id in app_launcher.AVAILABLE_APP_IDS:
        cfg = app_launcher._APP_CONFIG[app_id]
        session = sessions.get(app_id)
        result[app_id] = {
            "app_id":    app_id,
            "label":     cfg["label"],
            "launched":  session is not None,
            "status":    session["status"] if session else "stopped",
            "backend_url":  session["backend_url"]  if session else None,
            "frontend_url": session["frontend_url"] if session else None,
            "workspace":    session["workspace"]    if session else None,
            # Chemins de log (stdout+stderr) pour tail cote VisionNexus.
            "backend_log":  session.get("backend_log")  if session else None,
            "frontend_log": session.get("frontend_log") if session else None,
            "failure_reason": session.get("failure_reason") if session else None,
            "backend_exit_code": session.get("backend_exit_code") if session else None,
            "frontend_exit_code": session.get("frontend_exit_code") if session else None,
        }
    return result


@router.post("/launch", status_code=202)
def launch_app(body: LaunchBody):
    if body.app_id not in app_launcher.AVAILABLE_APP_IDS:
        raise HTTPException(400, f"app_id inconnu: {body.app_id}")

    base_ws = _base_ws(body.base_workspace)
    user    = _user(body.user)

    # Set ANNOTATION_APP_IMPORTS for explorer once annotation is running
    annotation_imports = None
    if body.app_id == "explorer":
        ann = app_launcher.get_session("annotation")
        if ann:
            from pathlib import Path
            annotation_imports = str(Path(ann.workspace) / "imports")

    try:
        session = app_launcher.launch_app(
            app_id=body.app_id,
            base_workspace=base_ws,
            user=user,
            conda_env=body.conda_env,
            annotation_imports=annotation_imports,
        )
    except Exception as exc:
        raise HTTPException(500, str(exc))

    # Update orchestrator's live config with new backend URL
    _patch_orchestrator_url(body.app_id, session.backend_url, session.frontend_url)

    return {
        "ok":           True,
        "app_id":       body.app_id,
        "backend_url":  session.backend_url,
        "frontend_url": session.frontend_url,
        "workspace":    session.workspace,
    }


@router.post("/{app_id}/stop", status_code=202)
def stop_app(app_id: str):
    if app_id not in app_launcher.AVAILABLE_APP_IDS:
        raise HTTPException(400, f"app_id inconnu: {app_id}")
    ok = app_launcher.stop_app(app_id)
    if not ok:
        raise HTTPException(404, "Aucune session active pour cette app")
    return {"ok": True, "app_id": app_id}


@router.post("/launch-all", status_code=202)
def launch_all_apps(body: LaunchBody):
    """Lance toutes les sous-apps qui ne sont pas encore actives."""
    base_ws = _base_ws(body.base_workspace)
    user    = _user(body.user)
    launched = []
    errors   = []
    for app_id in app_launcher.AVAILABLE_APP_IDS:
        sessions = app_launcher.get_all_sessions()
        sess = sessions.get(app_id)
        if sess and sess.get("alive"):
            continue  # already running
        annotation_imports = None
        if app_id == "explorer":
            ann = app_launcher.get_session("annotation")
            if ann:
                from pathlib import Path
                annotation_imports = str(Path(ann.workspace) / "imports")
        try:
            session = app_launcher.launch_app(
                app_id=app_id,
                base_workspace=base_ws,
                user=user,
                conda_env=body.conda_env,
                annotation_imports=annotation_imports,
            )
            _patch_orchestrator_url(app_id, session.backend_url, session.frontend_url)
            launched.append(app_id)
        except Exception as exc:
            errors.append({"app_id": app_id, "error": str(exc)})
    return {"launched": launched, "errors": errors}


@router.post("/stop-all", status_code=202)
def stop_all_apps():
    """Arrête toutes les sous-apps actives."""
    stopped = []
    for app_id in app_launcher.AVAILABLE_APP_IDS:
        if app_launcher.stop_app(app_id):
            stopped.append(app_id)
    return {"stopped": stopped}


def _patch_orchestrator_url(app_id: str, backend_url: str, frontend_url: str) -> None:
    """Met à jour APP_URLS et APP_FRONTEND_URLS en mémoire."""
    try:
        from backend import config as cfg_module
        from backend.core import proxy_client
        cfg = app_launcher._APP_CONFIG.get(app_id, {})
        api_key  = cfg.get("label", app_id)

        # Map app_id → key used in APP_URLS
        _ID_TO_KEY = {
            "annotation": "Annotation_App",
            "explorer":       "Dataset_Explorer_App",
            "dvc":        "dvc-app",
            "mlflow":     "mlflow-app",
            "optuna":     "optuna-app",
            "training":   "Training_App",
            "inference":  "Inference_App",
        }
        key = _ID_TO_KEY.get(app_id, app_id)
        cfg_module.APP_URLS[key] = backend_url
        cfg_module.APP_FRONTEND_URLS[key] = frontend_url
    except Exception:
        pass
