# ============================================================
# routers/convert.py
# Page utilitaire « Convert » (S10) : conversions d'images et
# d'annotations, indépendantes des projets.
#   POST /api/convert/optional_format-to-png     (async : task_id)
#   POST /api/convert/png-to-optional_format     (async : task_id)
#   POST /api/convert/ver-to-yolo    (sync)
#   POST /api/convert/yolo-to-ver    (sync)
# ============================================================

import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.services import convert_service as cv

router = APIRouter(tags=["Convert"])


class OtiToPngRequest(BaseModel):
    path: str
    out_dir: str | None = None


class PngToOtiRequest(BaseModel):
    dir: str
    out_path: str | None = None


class VerToYoloRequest(BaseModel):
    ver_path: str
    out_dir: str
    width: int
    height: int


class YoloToVerRequest(BaseModel):
    yolo_dir: str
    out_path: str
    width: int
    height: int


def _run_async(label: str, fn) -> str:
    """Lance fn(on_progress) dans un thread + task_registry. Retourne task_id."""
    from backend.services.task_registry import create_task, update_task
    task_id = str(uuid.uuid4())
    create_task(task_id, label)
    update_task(task_id, "running", 0, "Démarrage…")

    def _bg():
        try:
            def on_progress(cur, tot):
                pct = min(99, int(cur / max(tot, 1) * 100))
                update_task(task_id, "running", pct, f"{cur}/{tot}")
            res = fn(on_progress)
            update_task(task_id, "completed", 100, str(res))
        except Exception as exc:  # noqa: BLE001
            update_task(task_id, "error", 0, "", error=str(exc))

    threading.Thread(target=_bg, daemon=True).start()
    return task_id


@router.post("/api/convert/optional_format-to-png", response_model=dict)
def convert_optional_format_to_png(body: OtiToPngRequest):
    if not Path(body.path).exists():
        raise HTTPException(400, "Fichier .optional introuvable")
    tid = _run_async(
        f"optional_format → PNG : {Path(body.path).name}",
        lambda op: cv.optional_format_to_png_folder(body.path, body.out_dir, on_progress=op),
    )
    return {"task_id": tid}


@router.post("/api/convert/png-to-optional_format", response_model=dict)
def convert_png_to_optional_format(body: PngToOtiRequest):
    if not Path(body.dir).is_dir():
        raise HTTPException(400, "Dossier d'images introuvable")
    tid = _run_async(
        f"PNG → optional_format : {Path(body.dir).name}",
        lambda op: cv.png_folder_to_optional_format(body.dir, body.out_path, on_progress=op),
    )
    return {"task_id": tid}


@router.post("/api/convert/ver-to-yolo", response_model=dict)
def convert_ver_to_yolo(body: VerToYoloRequest):
    if not Path(body.ver_path).exists():
        raise HTTPException(400, "Fichier .ver introuvable")
    try:
        return cv.ver_to_yolo(body.ver_path, body.out_dir, body.width, body.height)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Conversion échouée : {exc}")


@router.post("/api/convert/yolo-to-ver", response_model=dict)
def convert_yolo_to_ver(body: YoloToVerRequest):
    if not Path(body.yolo_dir).exists():
        raise HTTPException(400, "Dossier YOLO introuvable")
    try:
        return cv.yolo_to_ver(body.yolo_dir, body.out_path, body.width, body.height)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Conversion échouée : {exc}")
