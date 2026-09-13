# ============================================================
# routers/orchestrator.py -- noeud Inference du pipeline MLOps.
# Variante DETERMINISTE : session headless (MOT auto) ou command
# (rejeu de clics), bloquante, -> video annotee + benchmark.
# (La variante interactive est une human_gate cote orchestrateur.)
# ============================================================

import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import config as C
from backend.services import tracker_bridge as tb
from backend.services import settings_service as S
from backend.services.eval_service import manager as eval_manager
from backend.services.acquisition_service import manager as acq_manager
from backend.services.mlflow_logging import start_run


# ── Tracabilite : nom de run deterministe + tags graph/node ──────────────────
class TraceFields(BaseModel):
    graph_id: Optional[str] = None     # graphe d'origine (reproductible)
    graph_name: Optional[str] = None   # nom lisible du graphe (= experiment projet)
    node_id: Optional[str] = None      # noeud d'origine dans le graphe
    node_label: Optional[str] = None   # libelle lisible du noeud
    run_id: Optional[str] = None       # id du run orchestrateur
    experiment: Optional[str] = None   # experiment MLflow = projet (regroupe les stages)
    run_type: Optional[str] = None     # role du run (evaluation/inference) pour le code couleur
    fork_parent_run: Optional[str] = None  # run orchestrateur parent (branches fork MLflow)


def _run_meta(trace: "TraceFields | None", fallback: str) -> tuple[str, dict, Optional[str]]:
    """(run_name deterministe, tags de tracabilite, experiment). Interdit les noms
    opaques. Convention MLOps : un experiment par projet (nom du graphe), un tag
    `run_type` pour distinguer/colorer les roles."""
    t = trace or TraceFields()
    gname = t.graph_name or t.graph_id
    if gname and t.node_label:
        run_name = f"{gname}/{t.node_label}"
    elif t.node_label:
        run_name = t.node_label
    else:
        run_name = fallback
    tags = {k: v for k, v in {
        "graph_id": t.graph_id, "graph_name": t.graph_name, "node_id": t.node_id,
        "node_label": t.node_label, "orch_run_id": t.run_id,
        "run_type": t.run_type, "fork_parent_run": t.fork_parent_run,
    }.items() if v}
    return run_name, tags, t.experiment


def _flatten_benchmark(b: dict) -> dict:
    out: dict = {}
    for k in ("fps_proc", "fps_total", "n_frames", "mota", "idf1", "tp", "fp", "fn", "n_gt"):
        if isinstance(b.get(k), (int, float, bool)):
            out[k] = float(b[k])
    for scope in ("mot", "sot"):
        sc = b.get(scope)
        if isinstance(sc, dict):
            for m in ("mota", "idf1", "tp", "fp", "fn", "n_gt", "idsw"):
                if isinstance(sc.get(m), (int, float, bool)):
                    out[f"{scope}_{m}"] = float(sc[m])
    return out

router = APIRouter(prefix="/api/orchestrator", tags=["Orchestrator"])


def _latest_training_best() -> Optional[str]:
    """best.pt du run d'entrainement le plus recent (sibling training_<user>/runs)."""
    runs = C.WORKSPACE.parent / f"training_{C.CURRENT_USER}" / "runs"
    if not runs.is_dir():
        return None
    cands = sorted(runs.rglob("weights/best.pt"), key=lambda p: p.stat().st_mtime, reverse=True)
    return str(cands[0]) if cands else None


class InferRequest(BaseModel):
    sequence_dir: str                         # dossier .optional/images, video, ...
    model_path: Optional[str] = None          # best.pt derive de l'ancetre training
    mode: str = "headless"                    # "headless" (MOT auto) | "command" (rejeu)
    clicks: Optional[str] = None              # fichier de rejeu (mode command)
    tracker_mot: str = "botsort"
    tracker_sot: str = "tracking_tophat"
    n_targets: int = 1
    compute_metrics: bool = False
    annotation_file: Optional[str] = None
    overrides: dict = {}                       # params yaml avances (rendu/save/fenetre/device/yolo)
    trace: Optional[TraceFields] = None       # tracabilite graph/node (reproductible)


@router.post("/infer")
def orchestrator_infer(body: InferRequest):
    """Bloquant : lance une session deterministe et attend la fin (B12)."""
    seq = Path(body.sequence_dir)
    if not seq.exists():
        raise HTTPException(404, f"sequence_dir introuvable: {seq}")
    if body.mode not in ("headless", "command"):
        raise HTTPException(400, "mode doit etre 'headless' ou 'command'")
    if body.mode == "command" and not body.clicks:
        raise HTTPException(400, "mode 'command' requiert 'clicks' (fichier de rejeu)")

    st = S.load()
    m = st["metrics"]
    ann_file = body.annotation_file or m["default_annotation_file"] or None
    cfg = tb.load_base_config()
    cfg.update({
        "sequence_dir": str(seq),
        "mode": body.mode,
        "tracker_mot": body.tracker_mot,
        "tracker_sot": body.tracker_sot,
        "n_targets": body.n_targets,
        "local_display": False,
        "stream_mode": "none",
        "save_video": True,                    # produit une video annotee
        "metrics_iou_threshold": m["iou_threshold"],
        "compute_metrics": bool(body.compute_metrics and ann_file),
    })
    model_path = body.model_path or _latest_training_best()
    if model_path:
        cfg["weights_yolo"] = model_path
        cfg["detector_mot"] = "yolo"
    if body.clicks:
        cfg["clicks"] = body.clicks
    if ann_file:
        cfg["annotation_file"] = ann_file

    # Overrides yaml avances (rendu/save/fenetre/device/yolo). Le sous-dict 'yolo'
    # est fusionne (pas remplace). Les valeurs critiques de securite headless sont
    # RE-FORCEES apres, pour qu'un override ne casse pas l'execution orchestrateur.
    if isinstance(body.overrides, dict) and body.overrides:
        ovr = dict(body.overrides)
        yolo_ovr = ovr.pop("yolo", None)
        cfg.update(ovr)
        if isinstance(yolo_ovr, dict):
            cfg.setdefault("yolo", {}).update(yolo_ovr)
        cfg["local_display"] = False           # jamais de fenetre locale cote orchestrateur
        cfg["mode"] = body.mode                 # ne pas laisser un override changer le mode

    run_dir = C.RUNS_DIR / f"orch_{datetime.now():%Y%m%d_%H%M%S}"
    run_dir.mkdir(parents=True, exist_ok=True)

    try:
        run_session = tb.get_run_session()
        benchmark = run_session(cfg, run_dir)   # bloquant (threadpool FastAPI)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"echec inference: {type(exc).__name__}: {exc}")

    # MLflow : log du benchmark tracker (store workspace serverless, 100 % defensif)
    mlflow_run_id = ""
    if isinstance(benchmark, dict):
        run_name, trace_tags, _exp = _run_meta(
            body.trace, fallback=f"tracker_{Path(model_path).stem if model_path else 'dummy'}")
        ml = start_run(
            C.WORKSPACE, C.CURRENT_USER, experiment=_exp or "inference", run_name=run_name,
            params={"model": model_path or "", "sequence": str(seq),
                    "tracker_mot": body.tracker_mot, "tracker_sot": body.tracker_sot,
                    "mode": body.mode, "n_targets": body.n_targets,
                    "compute_metrics": cfg["compute_metrics"]},
            tags={"app": "Inference_App", "user": C.CURRENT_USER, "stage": "inference", **trace_tags},
        )
        ml.log_metrics(_flatten_benchmark(benchmark))
        bj = run_dir / "benchmark" / "benchmark.json"
        if bj.exists():
            ml.log_artifact(str(bj), artifact_path="benchmark")
        try:
            mlflow_run_id = ml._mlflow.active_run().info.run_id if ml.ok else ""
        except Exception:
            mlflow_run_id = ""
        ml.finish("FINISHED")

    videos = [p.name for p in run_dir.glob("*.mp4")] + [p.name for p in run_dir.glob("*.avi")]
    return {
        "status": "done",
        "run_dir": str(run_dir),
        "video": videos[0] if videos else None,
        "benchmark_path": str(run_dir / "benchmark" / "benchmark.json"),
        "benchmark": benchmark if isinstance(benchmark, dict) else None,
        "mlflow_run_id": mlflow_run_id,
    }


# ── Evaluation (app unifiee : detection model.val OU tracker MOTA/IDF1) ───────
class EvaluateRequest(BaseModel):
    kind: str = "detection"                   # "detection" | "tracker"
    model_path: Optional[str] = None          # derive du training si vide
    data_yaml: Optional[str] = None           # detection
    sequence_dir: Optional[str] = None        # tracker
    annotation_file: Optional[str] = None     # tracker (GT -> MOTA/IDF1 ; sinon benchmark seul)
    overrides: dict = {}
    timeout_s: int = 3600
    trace: Optional[TraceFields] = None


@router.post("/evaluate")
def orchestrator_evaluate(body: EvaluateRequest):
    if body.kind not in ("detection", "tracker"):
        raise HTTPException(400, "kind doit etre 'detection' ou 'tracker'")
    model_path = body.model_path or _latest_training_best() or ""
    run_name, trace_tags, _exp = _run_meta(body.trace, fallback=f"eval_{body.kind}")
    trace = {"run_name": run_name, "tags": trace_tags, "experiment": _exp}

    if body.kind == "detection":
        if not body.data_yaml or not Path(body.data_yaml).exists():
            raise HTTPException(400, "detection requiert un data_yaml existant")
        ev = eval_manager.start_detection(model_path, body.data_yaml, body.overrides, trace=trace)
    else:
        if not body.sequence_dir or not Path(body.sequence_dir).exists():
            raise HTTPException(400, "tracker requiert un sequence_dir existant")
        ev = eval_manager.start_tracker(model_path, body.sequence_dir, body.annotation_file,
                                        body.overrides, trace=trace)

    deadline = time.monotonic() + max(30, body.timeout_s)
    while ev.status == "running" and time.monotonic() < deadline:
        time.sleep(1.0)
    if ev.status == "error":
        raise HTTPException(500, f"echec evaluation: {ev.error}")
    if ev.status == "running":
        raise HTTPException(504, "evaluation non terminee dans le delai imparti")

    return {"status": "done", "kind": ev.kind, "run_dir": str(ev.run_dir),
            "metrics": ev.metrics, "mlflow_run_id": ev.mlflow_run_id}


# ── Acquisition (noeud FREE : capture un flux -> dataset d'images a annoter) ──
class AcquireRequest(BaseModel):
    source: str                       # .optional / dossier / video / http://.../stream / tcp
    name: str = ""
    max_frames: int = 200
    every: int = 1
    fmt: str = "png"
    camera_name: str = ""
    timeout_s: int = 1800


@router.post("/acquire")
def orchestrator_acquire(body: AcquireRequest):
    """Bloquant : capture le flux, sauve les images, renvoie le dossier dataset."""
    aq = acq_manager.start(body.source, body.name, body.max_frames, body.every,
                           body.fmt, body.camera_name)
    deadline = time.monotonic() + max(30, body.timeout_s)
    while aq.status == "running" and time.monotonic() < deadline:
        time.sleep(1.0)
    if aq.status == "error":
        raise HTTPException(500, f"echec acquisition: {aq.error}")
    # dataset_path = sortie consommable par Dataset_Explorer_App / Annotation_App (import chemin)
    return {"status": aq.status, "name": aq.name, "dataset_path": str(aq.out_dir),
            "n_saved": aq.n_saved}
