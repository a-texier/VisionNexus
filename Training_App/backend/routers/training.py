# ============================================================
# routers/training.py
# Endpoints REST + SSE pour le lancement et le suivi
# des runs d'entrainement, tous moteurs confondus.
# ============================================================

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.training_run import TrainingRun
from backend.services import training_service as ts
from backend.services.run_artifacts import collect_artifacts
from backend.services.trainer_backend import engine_catalog, normalize_engine, resolve_engine

router = APIRouter(prefix="/api", tags=["Training"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class StartTrainingRequest(BaseModel):
    engine:        str = ""         # moteur (GET /api/capabilities) ; vide = "active"
    model_size:    str = ""         # taille du catalogue du moteur (vide = sa taille par defaut)
    model_weights: str = ""         # poids de depart au format du moteur (vide = defaut du moteur)
    data_yaml:     str = ""         # chemin vers data.yaml (YOLO .txt ou .ver, voir yolox_dataset.py)
    dataset_name:  str = ""
    hyperparams:   dict[str, Any] = {}


class TrainingRunOut(BaseModel):
    id:               int
    run_name:         str
    yolo_version:     str
    engine:           str
    model_size:       str
    model_weights:    str
    data_yaml:        str
    dataset_name:     str
    hyperparams:      dict[str, Any]
    status:           str
    progress_pct:     float
    current_epoch:    int
    total_epochs:     int
    best_map50:       float | None
    best_map5095:     float | None
    best_model_path:  str | None
    error_message:    str | None
    created_at:       datetime
    started_at:       datetime | None
    finished_at:      datetime | None

    @classmethod
    def from_orm(cls, run: TrainingRun) -> "TrainingRunOut":
        return cls(
            id=run.id,
            run_name=run.run_name,
            yolo_version=run.yolo_version,
            engine=run.engine or "yolox",
            model_size=run.model_size,
            model_weights=run.model_weights,
            data_yaml=run.data_yaml,
            dataset_name=run.dataset_name,
            hyperparams=run.hyperparams,
            status=run.status,
            progress_pct=run.progress_pct,
            current_epoch=run.current_epoch,
            total_epochs=run.total_epochs,
            best_map50=run.best_map50,
            best_map5095=run.best_map5095,
            best_model_path=run.best_model_path,
            error_message=run.error_message,
            created_at=run.created_at,
            started_at=run.started_at,
            finished_at=run.finished_at,
        )


# ── POST /api/training/start ──────────────────────────────────────────────────

@router.post("/training/start")
def start_training(
    body: StartTrainingRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """
    Cree un TrainingRun en DB, puis demarre l'entrainement en background.
    """
    if not body.data_yaml or not Path(body.data_yaml).exists():
        raise HTTPException(400, f"data.yaml introuvable : {body.data_yaml!r}")
    try:
        cfg = ts.build_run_config(body.engine, body.model_size, body.model_weights, body.hyperparams)
    except ts.RunConfigError as exc:
        raise HTTPException(400, str(exc)) from exc

    run_name = f"train_{uuid.uuid4().hex[:8]}"

    run = TrainingRun(
        run_name=run_name,
        yolo_version=cfg["engine"],
        engine=cfg["engine"],
        model_size=cfg["model_size"],
        model_weights=body.model_weights,
        data_yaml=body.data_yaml,
        dataset_name=body.dataset_name,
        total_epochs=cfg["total_epochs"],
    )
    run.hyperparams = cfg["hyperparams"]
    session.add(run)
    session.commit()
    session.refresh(run)

    background_tasks.add_task(ts.start_training, run_name)

    return {
        "run_name": run_name,
        "run_id": run.id,
        "status": "pending",
        "engine": cfg["engine"],
        "ignored_hyperparams": cfg["ignored"],
    }


# ── GET /api/training/runs ────────────────────────────────────────────────────

@router.get("/training/runs", response_model=list[TrainingRunOut])
def list_runs(session: Session = Depends(get_session)):
    runs = session.exec(
        select(TrainingRun).order_by(TrainingRun.created_at.desc())
    ).all()
    return [TrainingRunOut.from_orm(r) for r in runs]


# ── GET /api/training/{run_name}/status ───────────────────────────────────────

@router.get("/training/{run_name}/status", response_model=TrainingRunOut)
def get_status(run_name: str, session: Session = Depends(get_session)):
    run = session.exec(
        select(TrainingRun).where(TrainingRun.run_name == run_name)
    ).first()
    if not run:
        raise HTTPException(404, "Run introuvable")
    return TrainingRunOut.from_orm(run)


# ── GET /api/training/{run_name}/metrics-history ─────────────────────────────

@router.get("/training/{run_name}/metrics-history")
def metrics_history(run_name: str):
    """Historique par epoch lu dans le results.csv du run.
    Retourne {epochs: [{epoch, map50, map5095, precision, recall, box_loss, cls_loss}]}.
    Chaque cle accepte plusieurs noms de colonne selon le moteur : iou_loss
    (YOLOX) et train/box_loss jouent le meme role (erreur de localisation)."""
    import csv

    from backend.config import RUNS_DIR

    csv_path = RUNS_DIR / run_name / "results.csv"
    if not csv_path.exists():
        found = list((RUNS_DIR / run_name).rglob("results.csv")) if (RUNS_DIR / run_name).exists() else []
        if not found:
            return {"epochs": []}
        csv_path = found[0]

    COLS = {
        "map50":     ("metrics/mAP50(B)",),
        "map5095":   ("metrics/mAP50-95(B)",),
        "precision": ("metrics/precision(B)",),
        "recall":    ("metrics/recall(B)",),
        "box_loss":  ("iou_loss", "train/box_loss"),
        "cls_loss":  ("cls_loss", "train/cls_loss"),
    }
    epochs: list[dict] = []
    try:
        with csv_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row = {k.strip(): v for k, v in row.items() if k}
                entry: dict = {"epoch": int(float(row.get("epoch", len(epochs) + 1)))}
                for out_key, cols in COLS.items():
                    entry[out_key] = None
                    for col in cols:
                        try:
                            entry[out_key] = float(row[col])
                            break
                        except (KeyError, TypeError, ValueError):
                            continue
                epochs.append(entry)
    except Exception:
        return {"epochs": []}
    return {"epochs": epochs}


# ── GET /api/training/{run_name}/artifacts ───────────────────────────────────

def _run_dir(run_name: str):
    from backend.config import RUNS_DIR
    d = RUNS_DIR / run_name
    if (d / "results.csv").exists() or d.exists():
        return d
    found = list(RUNS_DIR.rglob(f"{run_name}")) if RUNS_DIR.exists() else []
    return found[0] if found else d


def _run_engine(run_name: str, session: Session) -> str:
    run = session.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
    return run.engine if run and run.engine else "yolox"


@router.get("/training/{run_name}/artifacts")
def list_artifacts(run_name: str, session: Session = Depends(get_session)):
    """Plots d'analyse du run, tels que declares par SON moteur
    (CATALOG["artifacts"]) : confusion, courbes, labels, batches, etc.
    Si le moteur n'est plus disponible (plugin retire), la liste est vide et
    `engine_error` dit pourquoi."""
    engine = _run_engine(run_name, session)
    d = _run_dir(run_name)
    try:
        result: dict[str, Any] = collect_artifacts(d, engine_catalog(engine))
    except RuntimeError as exc:
        result = {"engine_error": str(exc)}
    result["run_dir"] = str(d)
    result["engine"] = engine
    return result


_IMAGE_MEDIA = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


@router.get("/training/{run_name}/artifact/{name:path}")
def get_artifact(run_name: str, name: str):
    from fastapi.responses import FileResponse

    # Garde-fou anti-traversal : chemin relatif, image, et contenu dans le
    # dossier du run (chaque moteur range ses plots ou il veut dessous).
    if "\\" in name or ".." in name or name.startswith("/"):
        raise HTTPException(400, "nom invalide")
    media = _IMAGE_MEDIA.get(Path(name).suffix.lower())
    if media is None:
        raise HTTPException(400, "seules les images sont servies")
    d = _run_dir(run_name).resolve()
    p = (d / name).resolve()
    if d not in p.parents or not p.is_file():
        raise HTTPException(404, "artefact introuvable")
    return FileResponse(p, media_type=media)


# ── GET /api/training/{run_name}/inference-cases ─────────────────────────────

@router.get("/training/{run_name}/inference-cases")
def inference_cases(run_name: str, top_k: int = 4, session: Session = Depends(get_session)):
    """Lance l'inférence du meilleur modèle (moteur du run) sur les images de validation
    et renvoie les **meilleurs** et **pires** cas (par confiance moyenne des
    détections). Les images annotées sont sauvegardées dans le dossier du run
    (sous-dossier `inference_cases/`) et servies via /artifact/…"""
    run = session.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
    if not run:
        raise HTTPException(404, "Run introuvable")
    if not run.best_model_path or not Path(run.best_model_path).exists():
        raise HTTPException(400, "Modèle introuvable — run pas encore terminé ?")

    d = _run_dir(run_name)
    out_dir = d / "inference_cases"
    cache = out_dir / "cases.json"
    if cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            pass

    from backend.services.yolox_dataset import load_data_yaml
    try:
        spec = load_data_yaml(run.data_yaml, "val")
    except Exception as exc:
        raise HTTPException(500, f"Lecture data.yaml échouée : {exc}") from exc
    images = spec.image_paths
    if not images:
        raise HTTPException(404, "Aucune image de validation trouvée")

    try:
        import cv2

        EngineCls = resolve_engine(run.engine or "yolox")
        load_predictor = getattr(EngineCls, "load_predictor", None)
        if load_predictor is None:
            raise HTTPException(501, f"Le moteur '{run.engine}' ne fournit pas de prédicteur")
        imgsz = int(run.hyperparams.get("imgsz", 640) or 640)
        predict = load_predictor(run.best_model_path, run.model_size, spec.class_names, imgsz)

        out_dir.mkdir(parents=True, exist_ok=True)
        scored = []
        for img_path in images[:200]:  # cap pour rester rapide
            frame = cv2.imread(str(img_path))
            if frame is None:
                continue
            boxes = predict(frame)
            confs = [b[4] for b in boxes]
            n = len(confs)
            mean_conf = sum(confs) / n if n else 0.0
            scored.append({"img": img_path, "n": n, "mean_conf": mean_conf, "boxes": boxes, "frame": frame})

        best = sorted(scored, key=lambda s: (s["n"] > 0, s["mean_conf"], s["n"]), reverse=True)[:top_k]
        worst = sorted(scored, key=lambda s: (s["n"] == 0, -s["mean_conf"], -s["n"]), reverse=True)[:top_k]

        def _save(items, prefix):
            names = []
            for i, s in enumerate(items):
                plotted = s["frame"].copy()
                for x1, y1, x2, y2, conf, cls_id in s["boxes"]:
                    label = spec.class_names[int(cls_id)] if 0 <= int(cls_id) < len(spec.class_names) else str(int(cls_id))
                    cv2.rectangle(plotted, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                    cv2.putText(
                        plotted, f"{label} {float(conf):.2f}",
                        (int(x1), max(int(y1) - 4, 0)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1,
                    )
                fname = f"{prefix}_{i}.jpg"
                cv2.imwrite(str(out_dir / fname), plotted)
                names.append({"file": f"inference_cases/{fname}",
                              "source": s["img"].name,
                              "detections": s["n"],
                              "mean_conf": round(s["mean_conf"], 4)})
            return names

        payload = {
            "run_name": run_name,
            "n_images_scored": len(scored),
            "best": _save(best, "best"),
            "worst": _save(worst, "worst"),
        }
        cache.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Inférence échouée : {exc}") from exc


# ── POST /api/training/{run_name}/stop ───────────────────────────────────────

@router.post("/training/{run_name}/stop")
def stop_run(run_name: str):
    ok = ts.stop_training(run_name)
    return {"ok": ok}


# ── DELETE /api/training/{run_name} ──────────────────────────────────────────

@router.delete("/training/{run_name}")
def delete_run(run_name: str, session: Session = Depends(get_session)):
    run = session.exec(
        select(TrainingRun).where(TrainingRun.run_name == run_name)
    ).first()
    if not run:
        raise HTTPException(404, "Run introuvable")
    session.delete(run)
    session.commit()
    return {"ok": True}


# ── GET /api/training/{run_name}/events (SSE) ────────────────────────────────

@router.get("/training/{run_name}/events")
async def stream_events(run_name: str):
    """
    SSE stream des evenements de progression.
    Le frontend se connecte ici et recoit des events:
      { type: "epoch", epoch, total_epochs, progress_pct, metrics }
      { type: "done", best_model_path, map50, map5095 }
      { type: "error", message }
      { type: "stopped" }
    """
    async def generator():
        cursor = 0
        try:
            while True:
                events = ts.get_events(run_name, cursor)
                for evt in events:
                    yield f"data: {json.dumps(evt)}\n\n"
                    cursor += 1
                    if evt.get("type") in ("done", "error", "stopped"):
                        return
                await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── GET /api/training/models ──────────────────────────────────────────────────

@router.get("/training/models")
def list_models(engine: str = ""):
    """Catalogue d'un moteur (tailles, defauts, formulaire, plages HPO, plots).
    `sizes`/`defaults` restent a la racine pour les anciens clients."""
    name = normalize_engine(engine)
    try:
        catalog = engine_catalog(name)
    except RuntimeError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"engine": name, **catalog}
