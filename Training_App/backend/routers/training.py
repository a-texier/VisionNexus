# ============================================================
# routers/training.py
# Endpoints REST + SSE pour le lancement et le suivi
# des runs d'entrainement YOLO.
# ============================================================

import asyncio
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.training_run import TrainingRun
from backend.services import training_service as ts

router = APIRouter(prefix="/api", tags=["Training"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class StartTrainingRequest(BaseModel):
    yolo_version:  str = "yolov8"
    model_size:    str = "n"
    model_weights: str = ""       # chemin .pt personnalise (vide = pretrained)
    data_yaml:     str = ""       # chemin vers data.yaml YOLO
    dataset_name:  str = ""
    hyperparams:   Dict[str, Any] = {}


class TrainingRunOut(BaseModel):
    id:               int
    run_name:         str
    yolo_version:     str
    model_size:       str
    model_weights:    str
    data_yaml:        str
    dataset_name:     str
    hyperparams:      Dict[str, Any]
    status:           str
    progress_pct:     float
    current_epoch:    int
    total_epochs:     int
    best_map50:       Optional[float]
    best_map5095:     Optional[float]
    best_model_path:  Optional[str]
    error_message:    Optional[str]
    created_at:       datetime
    started_at:       Optional[datetime]
    finished_at:      Optional[datetime]

    @classmethod
    def from_orm(cls, run: TrainingRun) -> "TrainingRunOut":
        return cls(
            id=run.id,
            run_name=run.run_name,
            yolo_version=run.yolo_version,
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

    # Merge hyperparams avec les defauts
    merged = dict(ts.DEFAULT_HYPERPARAMS)
    merged.update(body.hyperparams)

    run_name = f"train_{uuid.uuid4().hex[:8]}"
    weights = body.model_weights or ts.get_model_weights(body.yolo_version, body.model_size)

    run = TrainingRun(
        run_name=run_name,
        yolo_version=body.yolo_version,
        model_size=body.model_size,
        model_weights=weights,
        data_yaml=body.data_yaml,
        dataset_name=body.dataset_name,
        total_epochs=int(merged.get("epochs", 100)),
    )
    run.hyperparams = merged
    session.add(run)
    session.commit()
    session.refresh(run)

    background_tasks.add_task(ts.start_training, run_name)

    return {"run_name": run_name, "run_id": run.id, "status": "pending"}


# ── GET /api/training/runs ────────────────────────────────────────────────────

@router.get("/training/runs", response_model=List[TrainingRunOut])
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
    """Historique par epoch lu dans le results.csv Ultralytics du run.
    Retourne {epochs: [{epoch, map50, map5095, precision, recall, box_loss, cls_loss}]}."""
    import csv
    from backend.config import RUNS_DIR

    csv_path = RUNS_DIR / run_name / "results.csv"
    if not csv_path.exists():
        found = list((RUNS_DIR / run_name).rglob("results.csv")) if (RUNS_DIR / run_name).exists() else []
        if not found:
            return {"epochs": []}
        csv_path = found[0]

    COLS = {
        "map50":     "metrics/mAP50(B)",
        "map5095":   "metrics/mAP50-95(B)",
        "precision": "metrics/precision(B)",
        "recall":    "metrics/recall(B)",
        "box_loss":  "train/box_loss",
        "cls_loss":  "train/cls_loss",
    }
    epochs: list[dict] = []
    try:
        with csv_path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row = {k.strip(): v for k, v in row.items() if k}
                entry: dict = {"epoch": int(float(row.get("epoch", len(epochs) + 1)))}
                for out_key, col in COLS.items():
                    try:
                        entry[out_key] = float(row[col])
                    except (KeyError, TypeError, ValueError):
                        entry[out_key] = None
                epochs.append(entry)
    except Exception:
        return {"epochs": []}
    return {"epochs": epochs}


# ── GET /api/training/{run_name}/artifacts ───────────────────────────────────

# Catégories d'images produites par Ultralytics dans le dossier du run.
_ARTIFACT_CATALOG = {
    "confusion":   ["confusion_matrix.png", "confusion_matrix_normalized.png"],
    "curves":      ["PR_curve.png", "P_curve.png", "R_curve.png", "F1_curve.png",
                    "BoxPR_curve.png", "BoxP_curve.png", "BoxR_curve.png", "BoxF1_curve.png"],
    "results":     ["results.png"],
    "labels":      ["labels.jpg", "labels_correlogram.jpg"],
}


def _run_dir(run_name: str):
    from backend.config import RUNS_DIR
    d = RUNS_DIR / run_name
    if (d / "results.csv").exists() or d.exists():
        return d
    found = list(RUNS_DIR.rglob(f"{run_name}")) if RUNS_DIR.exists() else []
    return found[0] if found else d


@router.get("/training/{run_name}/artifacts")
def list_artifacts(run_name: str):
    """Liste les images d'analyse Ultralytics disponibles pour ce run,
    groupées : confusion matrix, courbes (PR/ROC/F1/P/R), results, labels,
    et aperçus val (ground-truth vs prédictions)."""
    from backend.config import RUNS_DIR
    d = _run_dir(run_name)
    if not d.exists():
        # cherche results.csv en profondeur pour trouver le vrai dossier
        found = list(RUNS_DIR.rglob("results.csv"))
        d = next((f.parent for f in found if run_name in str(f)), d)

    def _exists(names: list[str]) -> list[str]:
        out = []
        for n in names:
            if (d / n).exists():
                out.append(n)
            else:
                # certains suffixes varient (Box*) → glob
                for m in d.glob(n.replace(".png", "*.png").replace(".jpg", "*.jpg")):
                    if m.name not in out:
                        out.append(m.name)
        return out

    result = {cat: _exists(names) for cat, names in _ARTIFACT_CATALOG.items()}
    # Aperçus val : ground-truth et prédictions
    val_labels = sorted(p.name for p in d.glob("val_batch*_labels.jpg"))
    val_preds  = sorted(p.name for p in d.glob("val_batch*_pred.jpg"))
    train_batches = sorted(p.name for p in d.glob("train_batch*.jpg"))[:3]
    result["val_ground_truth"] = val_labels
    result["val_predictions"]  = val_preds
    result["train_batches"]    = train_batches
    result["run_dir"] = str(d)
    return result


@router.get("/training/{run_name}/artifact/{name:path}")
def get_artifact(run_name: str, name: str):
    from fastapi.responses import FileResponse
    from backend.config import RUNS_DIR
    # Garde-fou anti-traversal ; on autorise UNIQUEMENT le sous-dossier
    # inference_cases/ (best/worst générés par l'endpoint inference-cases).
    if "\\" in name or ".." in name:
        raise HTTPException(400, "nom invalide")
    if "/" in name and not name.startswith("inference_cases/"):
        raise HTTPException(400, "nom invalide")
    d = _run_dir(run_name)
    p = d / name
    if not p.exists():
        base = name.split("/")[-1]
        found = [f for f in RUNS_DIR.rglob(base) if run_name in str(f)] if RUNS_DIR.exists() else []
        if not found:
            raise HTTPException(404, "artefact introuvable")
        p = found[0]
    media = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(p, media_type=media)


# ── GET /api/training/{run_name}/inference-cases ─────────────────────────────

@router.get("/training/{run_name}/inference-cases")
def inference_cases(run_name: str, top_k: int = 4, session: Session = Depends(get_session)):
    """Lance l'inférence du meilleur modèle sur les images de validation et
    renvoie les **meilleurs** et **pires** cas (par confiance moyenne des
    détections). Les images annotées sont sauvegardées dans le dossier du run
    (sous-dossier `inference_cases/`) et servies via /artifact/…"""
    run = session.exec(select(TrainingRun).where(TrainingRun.run_name == run_name)).first()
    if not run:
        raise HTTPException(404, "Run introuvable")
    if not run.best_model_path or not Path(run.best_model_path).exists():
        raise HTTPException(400, "Modèle best.pt introuvable — run pas encore terminé ?")

    d = _run_dir(run_name)
    out_dir = d / "inference_cases"
    cache = out_dir / "cases.json"
    # Cache : si déjà calculé, on renvoie directement
    if cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Résoudre le dossier d'images de validation depuis le data.yaml
    import yaml as _yaml
    val_dir = None
    try:
        dy = _yaml.safe_load(Path(run.data_yaml).read_text(encoding="utf-8"))
        base = Path(dy.get("path", Path(run.data_yaml).parent))
        if not base.is_absolute():
            base = Path(run.data_yaml).parent / base
        val_rel = dy.get("val") or dy.get("test") or "images/val"
        val_dir = (base / val_rel)
        if val_dir.suffix:  # au cas où val pointe un fichier .txt
            val_dir = val_dir.parent
    except Exception as exc:
        raise HTTPException(500, f"Lecture data.yaml échouée : {exc}")

    IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
    images = [p for p in val_dir.rglob("*") if p.suffix.lower() in IMG_EXT] if val_dir and val_dir.exists() else []
    if not images:
        raise HTTPException(404, f"Aucune image de validation trouvée ({val_dir})")

    try:
        from ultralytics import YOLO
        import cv2
        model = YOLO(run.best_model_path)
        out_dir.mkdir(parents=True, exist_ok=True)
        scored = []
        for img_path in images[:200]:  # cap pour rester rapide
            res = model.predict(str(img_path), verbose=False, conf=0.15)[0]
            confs = [float(c) for c in res.boxes.conf.tolist()] if res.boxes is not None else []
            n = len(confs)
            mean_conf = sum(confs) / n if n else 0.0
            scored.append({"img": img_path, "n": n, "mean_conf": mean_conf, "res": res})

        # Meilleurs = beaucoup de détections & haute confiance ; pires = 0 détection ou faible conf
        best = sorted(scored, key=lambda s: (s["n"] > 0, s["mean_conf"], s["n"]), reverse=True)[:top_k]
        worst = sorted(scored, key=lambda s: (s["n"] == 0, -s["mean_conf"], -s["n"]), reverse=True)[:top_k]

        def _save(items, prefix):
            names = []
            for i, s in enumerate(items):
                plotted = s["res"].plot()  # BGR ndarray avec boîtes
                fname = f"{prefix}_{i}.jpg"
                cv2.imwrite(str(out_dir / fname), plotted)
                names.append({"file": f"inference_cases/{fname}",
                              "source": s["img"].name,
                              "detections": s["n"],
                              "mean_conf": round(s["mean_conf"], 4)})
            return names

        payload = {
            "run_name": run_name,
            "val_dir": str(val_dir),
            "n_images_scored": len(scored),
            "best": _save(best, "best"),
            "worst": _save(worst, "worst"),
        }
        cache.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Inférence échouée : {exc}")


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
def list_models():
    """Retourne les versions et tailles YOLO supportees."""
    return {
        "versions": ts.SUPPORTED_VERSIONS,
        "sizes":    ts.SIZES_FOR_VERSION,
        "defaults": ts.DEFAULT_HYPERPARAMS,
    }
