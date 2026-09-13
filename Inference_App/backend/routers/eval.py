# ============================================================
# routers/evaluation.py -- lancement + suivi des evaluations.
# ============================================================

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend import config as C
from backend.services.eval_service import manager

router = APIRouter(prefix="/api", tags=["Evaluation"])


@router.get("/eval/sources")
def eval_sources():
    """Modeles (.pt/.onnx/.engine) + data.yaml disponibles (pour l'onglet Evaluation)."""
    weights: list[dict] = []

    def _add_weights(root: Path, label: str):
        if not root.is_dir():
            return
        for ext in ("*.pt", "*.onnx", "*.engine"):
            for w in sorted(root.rglob(ext)):
                weights.append({"name": w.name, "path": str(w), "source": label})

    _add_weights(C.TRACKER_ROOT / "weights", "tracker")
    _add_weights(C.WORKSPACE.parent / f"training_{C.CURRENT_USER}" / "runs", "training")
    _add_weights(C.WORKSPACE.parent / f"inference_{C.CURRENT_USER}" / "exports", "inference-exports")

    data_yamls: list[dict] = []
    ann_root = C.WORKSPACE.parent / f"annotation_{C.CURRENT_USER}" / "exports"
    if ann_root.is_dir():
        for y in sorted(ann_root.rglob("data.yaml")):
            data_yamls.append({"name": str(y.relative_to(ann_root)), "path": str(y)})

    return {"weights": weights, "data_yamls": data_yamls}


# ---- lancement -------------------------------------------------------------
class DetectionReq(BaseModel):
    model_path: str
    data_yaml: str
    overrides: dict = {}


@router.post("/eval/detection")
def eval_detection(req: DetectionReq):
    ev = manager.start_detection(req.model_path, req.data_yaml, req.overrides)
    return {"eval_id": ev.id, "status": ev.status}


class TrackerReq(BaseModel):
    model_path: str = ""
    sequence_dir: str
    annotation_file: Optional[str] = None
    overrides: dict = {}


@router.post("/eval/tracker")
def eval_tracker(req: TrackerReq):
    seq = Path(req.sequence_dir)
    if not seq.exists():
        raise HTTPException(404, f"sequence introuvable: {seq}")
    ev = manager.start_tracker(req.model_path, req.sequence_dir, req.annotation_file, req.overrides)
    return {"eval_id": ev.id, "status": ev.status}


# ---- suivi -----------------------------------------------------------------
@router.get("/evals")
def evals_list():
    return manager.list()


@router.get("/eval/{eid}")
def eval_status(eid: str):
    ev = manager.get(eid)
    if not ev:
        raise HTTPException(404, "evaluation inconnue")
    return ev.public()


@router.get("/eval/{eid}/artifacts")
def eval_artifacts(eid: str):
    ev = manager.get(eid)
    if not ev or not ev.run_dir:
        raise HTTPException(404, "evaluation inconnue")
    art_dir = ev.run_dir / "artifacts"
    names = [p.name for p in art_dir.glob("*.png")] if art_dir.is_dir() else []
    bench = (ev.run_dir / "benchmark" / "benchmark.json").exists()
    return {"run_dir": str(ev.run_dir), "plots": names, "benchmark": bench}


@router.get("/eval/{eid}/artifact/{name}")
def eval_artifact(eid: str, name: str):
    ev = manager.get(eid)
    if not ev or not ev.run_dir:
        raise HTTPException(404, "evaluation inconnue")
    if name == "benchmark.json":
        target = ev.run_dir / "benchmark" / "benchmark.json"
    else:
        target = ev.run_dir / "artifacts" / name
    target = target.resolve()
    if not str(target).startswith(str(ev.run_dir.resolve())) or not target.exists():
        raise HTTPException(404, "artefact introuvable")
    return FileResponse(str(target))
