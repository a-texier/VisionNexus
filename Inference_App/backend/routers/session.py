# ============================================================
# routers/session.py -- IHM web du tracker VisionNexus.
# Pilote les sessions + proxifie le pont MJPEG (stream/clics/touches).
# ============================================================

from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse, FileResponse
from pydantic import BaseModel

from backend import config as C
from backend.services import tracker_bridge as tb
from backend.services.session_manager import manager

router = APIRouter(prefix="/api", tags=["Session"])


# ---- Schema du formulaire de config (params exposes + enums) --------------
CONFIG_SCHEMA = {
    "groups": [
        {"title": "Source", "fields": [
            {"key": "sequence_dir", "type": "path",
             "help": "dossier .optional / images, video, http://host/stream, ou tcp"},
            {"key": "weights_yolo", "type": "path", "help": "poids YOLO .pt/.onnx/.engine (vide = Dummy)"},
            {"key": "camera_name", "type": "enum", "choices": ["", "multi_csv", "single_csv"]},
            {"key": "annotation_file", "type": "path", "help": "GT .ver / YOLO .txt (vide = pas de metriques)"},
            {"key": "compute_metrics", "type": "bool"},
        ]},
        {"title": "Pipeline", "fields": [
            {"key": "tracker_mot", "type": "enum",
             "choices": ["custom_kalman", "bytetrack", "botsort", "boosttrack", "none"]},
            {"key": "tracker_sot", "type": "enum",
             "choices": ["dummy", "csrt", "tracking_tophat", "dimp", "ostrack", "sam2"]},
            {"key": "detector_mot", "type": "enum", "choices": ["yolo", "tophat", "none", "dummy"]},
            {"key": "detector_roi", "type": "enum", "choices": ["tophat", "none"]},
            {"key": "n_targets", "type": "enum", "choices": [1, 2]},
            {"key": "mot_background", "type": "bool"},
            {"key": "device", "type": "enum", "choices": ["cuda", "cpu"]},
            {"key": "fps", "type": "number"},
        ]},
        {"title": "Rendu", "fields": [
            {"key": "save_video", "type": "bool"},
            {"key": "save_frames", "type": "bool"},
            {"key": "trail", "type": "number"},
            {"key": "light_render", "type": "bool"},
            {"key": "stream_quality", "type": "number"},
            {"key": "stream_every", "type": "number"},
        ]},
    ]
}


@router.get("/scenarios")
def scenarios():
    return tb.list_scenarios()


@router.get("/config-schema")
def config_schema():
    base = tb.load_base_config()
    return {"schema": CONFIG_SCHEMA, "defaults": base}


@router.get("/sources")
def sources():
    """Sequences locales + poids disponibles (workspace + runs training + tracker)."""
    seqs = []
    if C.SEQUENCES_DIR.is_dir():
        for p in sorted(C.SEQUENCES_DIR.iterdir()):
            seqs.append({"name": p.name, "path": str(p),
                         "type": "dir" if p.is_dir() else p.suffix.lower()})

    weights: list[dict] = []

    def _add_weights(root: Path, label: str):
        if not root.is_dir():
            return
        for ext in ("*.pt", "*.onnx", "*.engine"):
            for w in sorted(root.rglob(ext)):
                weights.append({"name": w.name, "path": str(w), "source": label})

    _add_weights(C.TRACKER_ROOT / "weights", "tracker")
    _add_weights(C.EXPORTS_DIR, "exports")
    # poids issus des runs d'entrainement (sibling training_<user>/runs/*/weights/)
    training_runs = C.WORKSPACE.parent / f"training_{C.CURRENT_USER}" / "runs"
    _add_weights(training_runs, "training")

    return {"sequences": seqs, "weights": weights}


# ---- cycle de vie session --------------------------------------------------
class StartReq(BaseModel):
    scenario: Optional[str] = None
    mode: str = "interactive"           # interactive | command | headless
    overrides: dict = {}


@router.post("/session/start")
def session_start(req: StartReq):
    try:
        sess = manager.start(overrides=req.overrides, scenario=req.scenario, mode=req.mode)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Echec du demarrage: {exc}")
    return {"session_id": sess.id, "stream_port": sess.stream_port, "status": sess.status}


@router.post("/session/{sid}/stop")
def session_stop(sid: str):
    if not manager.stop(sid):
        raise HTTPException(404, "session inconnue")
    return {"ok": True}


@router.get("/session/{sid}/status")
def session_status(sid: str):
    sess = manager.get(sid)
    if not sess:
        raise HTTPException(404, "session inconnue")
    return sess.public()


@router.get("/sessions")
def sessions_list():
    return manager.list()


# ---- pont MJPEG (proxifie pour single-origin + CORS) -----------------------
def _base_or_404(sid: str) -> str:
    base = manager.stream_base(sid)
    if not base:
        raise HTTPException(404, "session inconnue")
    return base


@router.get("/session/{sid}/info")
def session_info(sid: str):
    base = _base_or_404(sid)
    try:
        r = httpx.get(f"{base}/info", timeout=2.0)
        return Response(content=r.content, media_type="application/json")
    except Exception:
        raise HTTPException(503, "flux non disponible")


@router.get("/session/{sid}/snapshot")
def session_snapshot(sid: str):
    base = _base_or_404(sid)
    try:
        r = httpx.get(f"{base}/snapshot", timeout=3.0)
        return Response(content=r.content, media_type="image/jpeg")
    except Exception:
        raise HTTPException(503, "flux non disponible")


@router.get("/session/{sid}/stream")
def session_stream(sid: str):
    base = _base_or_404(sid)

    def _gen():
        with httpx.stream("GET", f"{base}/stream", timeout=None) as r:
            for chunk in r.iter_raw():
                yield chunk

    return StreamingResponse(
        _gen(), media_type="multipart/x-mixed-replace; boundary=--mjpeg_boundary")


class ClickReq(BaseModel):
    x: int
    y: int
    button: int = 0     # 0=SOT1, 2=SOT2, 1=kill


@router.post("/session/{sid}/click")
def session_click(sid: str, req: ClickReq):
    if not manager.post_click(sid, req.x, req.y, req.button):
        raise HTTPException(404, "session inconnue")
    return {"ok": True}


class KeyReq(BaseModel):
    key: str            # "m" | "r" | "q" | "space"


@router.post("/session/{sid}/key")
def session_key(sid: str, req: KeyReq):
    if not manager.post_key(sid, req.key):
        raise HTTPException(404, "session inconnue")
    return {"ok": True}


@router.post("/session/{sid}/record")
def session_record(sid: str):
    """Toggle l'enregistrement des clics (rejeu) via la touche 'r'."""
    if not manager.post_key(sid, "r"):
        raise HTTPException(404, "session inconnue")
    return {"ok": True}


# ---- rejeu / mode command (fichier .txt cmd_send) --------------------------
@router.get("/replays")
def replays():
    """Fichiers de commandes (.txt) du workspace cmd_send/.
    Format (cf. config.yaml `clicks`) : lignes CSV/TAB/espaces
      clic SOT (4 champs)     : frame_emit,frame_click,x,y
      controle MOT (3 champs) : frame_emit,frame_real,mot_state  (0=off,1=on)
    """
    out = []
    if C.CMD_SEND_DIR.is_dir():
        for f in sorted(C.CMD_SEND_DIR.glob("*.txt")):
            out.append({"name": f.name, "path": str(f),
                        "lines": sum(1 for _ in f.open(encoding="utf-8", errors="ignore"))})
    return out


@router.post("/replays/upload")
async def replays_upload(file: UploadFile = File(...), name: Optional[str] = Form(None)):
    """Depose un fichier de commandes .txt dans cmd_send/ (mode command headless)."""
    stem = Path(name or file.filename or "commandes").stem
    dest = C.CMD_SEND_DIR / f"{stem}.txt"
    data = await file.read()
    dest.write_bytes(data)
    return {"name": dest.name, "path": str(dest),
            "lines": sum(1 for _ in dest.open(encoding="utf-8", errors="ignore"))}


# ---- artefacts d'un run ----------------------------------------------------
_ARTIFACTS = {
    "profiling": "profiling.html",
    "dashboard": "benchmark/metrics_dashboard.html",
    "benchmark": "benchmark/benchmark.json",
}


@router.get("/session/{sid}/artifacts")
def session_artifacts(sid: str):
    sess = manager.get(sid)
    if not sess:
        raise HTTPException(404, "session inconnue")
    present = {k: (sess.run_dir / rel).exists() for k, rel in _ARTIFACTS.items()}
    videos = [p.name for p in sess.run_dir.glob("*.mp4")] + [p.name for p in sess.run_dir.glob("*.avi")]
    return {"run_dir": str(sess.run_dir), "artifacts": present, "videos": videos}


@router.get("/session/{sid}/artifact/{name}")
def session_artifact(sid: str, name: str):
    sess = manager.get(sid)
    if not sess:
        raise HTTPException(404, "session inconnue")
    rel = _ARTIFACTS.get(name)
    target = (sess.run_dir / rel) if rel else (sess.run_dir / name)
    # anti-traversal
    target = target.resolve()
    if not str(target).startswith(str(sess.run_dir.resolve())) or not target.exists():
        raise HTTPException(404, "artefact introuvable")
    return FileResponse(str(target))
