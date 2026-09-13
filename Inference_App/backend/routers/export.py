# ============================================================
# routers/export.py -- export modele (ONNX/TensorRT) + bouton
# "pret au deploiement" (build autonome pour calculateur embarque).
# Cible actuelle : x86_64 + GPU NVIDIA recent (scripts deploy/ existants).
# ============================================================

import os
import sys
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend import config as C
from backend.services import settings_service as S
from backend.services.task_runner import runner

router = APIRouter(prefix="/api", tags=["Export/Deploy"])

_CONVERT   = C.TRACKER_ROOT / "tools" / "convert_pt_onnx_engine.py"
_EXPORTZIP = C.TRACKER_ROOT / "export_zip.py"


# ---- Ou vont les exports (rien de cache) -----------------------------------
@router.get("/export/info")
def export_info():
    """Explique OU sont ecrits chaque type d'artefact + les scripts appeles."""
    return {
        "model_export": {
            "dir": str(C.EXPORTS_DIR),
            "tool": str(_CONVERT),
            "note": "Les .onnx/.engine sont ecrits dans exports/ (nom = <poids>.onnx).",
        },
        "tracker_zip": {
            "dir": str(C.EXPORTS_DIR),
            "tool": str(_EXPORTZIP),
            "note": "ZIP autonome du code tracker (sans outputs/sequences/caches).",
        },
        "deploy": {
            "standalone": {
                "script": "deploy/natif/build_standalone_zip.sh",
                "artifact": "tracker/deploy/natif/dist/visionnexus_inference_export_standalone.zip",
                "note": "conda-pack -> zip autonome (Ubuntu 22.04 x86_64 + GPU NVIDIA, via WSL sur Windows).",
            },
            "container": {
                "script": "deploy/conteneur/build_and_export_image.sh",
                "artifact": "image Podman exportee (voir logs du script)",
                "note": "Image conteneur pour cible x86_64 + NVIDIA.",
            },
            "target": "x86_64 + GPU NVIDIA (Ubuntu 22.04). Pas de chemin Jetson/aarch64 pour l'instant.",
        },
        "runs_dir": str(C.RUNS_DIR),
    }


def _wsl_path(p: Path) -> str:
    """C:\\x\\y -> /mnt/c/x/y (pour lancer les scripts bash via WSL sur Windows)."""
    s = str(p.resolve())
    drive, rest = s[0].lower(), s[2:].replace("\\", "/")
    return f"/mnt/{drive}{rest}"


# ---- Export modele ---------------------------------------------------------
class ExportModelReq(BaseModel):
    weights_path: str
    fmt: str = "onnx"           # "onnx" | "engine" (TensorRT)
    imgsz: int | None = None    # None -> defaut des reglages (export.onnx_imgsz)


@router.post("/export/model")
def export_model(req: ExportModelReq):
    src = Path(req.weights_path)
    if not src.exists():
        raise HTTPException(404, f"poids introuvable: {src}")
    if req.fmt not in ("onnx", "engine"):
        raise HTTPException(400, "fmt doit etre 'onnx' ou 'engine'")

    imgsz = req.imgsz if req.imgsz else int(S.load()["export"]["onnx_imgsz"])
    req.imgsz = imgsz
    out_stem = C.EXPORTS_DIR / src.stem
    cmd = [sys.executable, str(_CONVERT), str(src),
           "--imgsz", str(req.imgsz), "--out", str(out_stem)]
    if req.fmt == "onnx":
        cmd.append("--onnx")
        artifact = out_stem.with_suffix(".onnx")
    else:
        # builder configurable (defaut python = API TensorRT, air-gap, pas de trtexec)
        builder = str(S.load()["export"].get("trt_builder", "python"))
        cmd += ["--engine", "--builder", builder]
        artifact = out_stem.with_suffix(".engine")

    task = runner.run(f"export {req.fmt} {src.name}", cmd, cwd=C.TRACKER_ROOT,
                      env={**os.environ}, artifact=artifact)
    return {"task_id": task.id}


# ---- Bouton deploiement ----------------------------------------------------
class DeployReq(BaseModel):
    target: str = "standalone"     # "standalone" (conda-pack zip) | "container" (image Podman)


_DEPLOY_SCRIPTS = {
    "standalone": ("deploy/natif/build_standalone_zip.sh",
                   "deploy/natif/dist/visionnexus_inference_export_standalone.zip"),
    "container":  ("deploy/conteneur/build_and_export_image.sh", None),
}


@router.post("/deploy/build")
def deploy_build(req: DeployReq):
    if req.target not in _DEPLOY_SCRIPTS:
        raise HTTPException(400, "target doit etre 'standalone' ou 'container'")
    script, artifact_rel = _DEPLOY_SCRIPTS[req.target]
    script_abs = C.TRACKER_ROOT / script
    if not script_abs.exists():
        raise HTTPException(404, f"script de deploiement absent: {script}")

    # Les scripts sont bash + Ubuntu 22.04 (x86_64 + GPU NVIDIA). Sur Windows -> WSL.
    if sys.platform == "win32":
        cmd = ["wsl", "bash", "-c",
               f"cd {_wsl_path(C.TRACKER_ROOT)} && bash {script}"]
    else:
        cmd = ["bash", str(script_abs)]

    artifact = (C.TRACKER_ROOT / artifact_rel) if artifact_rel else None
    task = runner.run(f"deploy {req.target}", cmd, cwd=C.TRACKER_ROOT,
                      env={**os.environ}, artifact=artifact)
    return {
        "task_id": task.id,
        "note": ("Build bash Ubuntu 22.04 x86_64 + driver NVIDIA (via WSL sur Windows). "
                 "Cible GPU NVIDIA recent ; pas de chemin Jetson/aarch64 pour l'instant."),
    }


# ---- Export ZIP rapide du tracker (export_zip.py) --------------------------
@router.post("/export/tracker-zip")
def export_tracker_zip():
    """Cree un ZIP autonome et propre du code tracker (sans outputs/sequences/
    caches) dans exports/. Enveloppe directement tracker/export_zip.py."""
    if not _EXPORTZIP.exists():
        raise HTTPException(404, "export_zip.py introuvable dans le tracker")
    out = C.EXPORTS_DIR / f"tracker_export_{datetime.now():%Y%m%d_%H%M%S}.zip"
    cmd = [sys.executable, str(_EXPORTZIP), "--output", str(out)]
    task = runner.run("export tracker (zip)", cmd, cwd=C.TRACKER_ROOT,
                      env={**os.environ}, artifact=out)
    return {"task_id": task.id, "output": str(out)}


# ---- Suivi + telechargement ------------------------------------------------
@router.get("/tasks/{tid}")
def task_status(tid: str):
    task = runner.get(tid)
    if not task:
        raise HTTPException(404, "tache inconnue")
    return task.public()


@router.get("/tasks/{tid}/download")
def task_download(tid: str):
    task = runner.get(tid)
    if not task or not task.artifact or not Path(task.artifact).exists():
        raise HTTPException(404, "artefact indisponible")
    return FileResponse(task.artifact, filename=Path(task.artifact).name)
