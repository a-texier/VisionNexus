# ============================================================
# routers/acquisition.py -- MODE FREE : capture d'un flux -> dataset d'images.
# ============================================================

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services.acquisition_service import manager

router = APIRouter(prefix="/api", tags=["Acquisition"])


class AcquireReq(BaseModel):
    source: str                     # .optional / dossier / video / http://host/stream / tcp[://host]
    name: str = ""
    max_frames: int = 200           # 0 = jusqu'a la fin du flux
    every: int = 1                  # 1 image sur N
    fmt: str = "png"
    camera_name: str = ""
    start_frame: int = 0


@router.post("/acquire")
def acquire_start(req: AcquireReq):
    aq = manager.start(req.source, req.name, req.max_frames, req.every,
                       req.fmt, req.camera_name, req.start_frame)
    return {"acq_id": aq.id, "name": aq.name, "out_dir": str(aq.out_dir), "status": aq.status}


@router.post("/acquire/{aid}/stop")
def acquire_stop(aid: str):
    if not manager.stop(aid):
        raise HTTPException(404, "acquisition inconnue")
    return {"ok": True}


@router.get("/acquire/{aid}")
def acquire_status(aid: str):
    aq = manager.get(aid)
    if not aq:
        raise HTTPException(404, "acquisition inconnue")
    return aq.public()


@router.get("/acquisitions")
def acquisitions_list():
    return manager.list()


@router.get("/acquisitions/datasets")
def acquisition_datasets():
    """Datasets deja captures dans le workspace (mode FREE expose l'existant)."""
    return manager.list_datasets()
