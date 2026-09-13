# ============================================================
# eval_service.py -- coeur de l'Evaluation_App.
#
# Deux types d'evaluation, tous deux loggues dans MLflow (store
# workspace serverless, cf mlflow_logging) :
#   - detection : Ultralytics model.val() -> mAP50/mAP50-95/P/R + plots
#   - tracker   : run_session headless compute_metrics -> MOTA/IDF1/fps
#
# Chaque eval tourne sur un thread ; l'etat est suivi dans un registre.
# ============================================================

import shutil
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend import config as C
from backend.services import tracker_bridge as tb
from backend.services import settings_service as S
from backend.services.mlflow_logging import start_run


@dataclass
class Eval:
    id: str
    kind: str                       # "detection" | "tracker"
    status: str = "running"         # running | done | error
    run_dir: Optional[Path] = None
    metrics: dict = field(default_factory=dict)
    error: str = ""
    params: dict = field(default_factory=dict)
    mlflow_run_id: str = ""
    trace: dict = field(default_factory=dict)      # {run_name, tags} tracabilite graph/node
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    thread: Optional[threading.Thread] = field(default=None, repr=False)

    def public(self) -> dict:
        return {
            "id": self.id, "kind": self.kind, "status": self.status,
            "run_dir": str(self.run_dir) if self.run_dir else None,
            "metrics": self.metrics, "error": self.error,
            "params": self.params, "mlflow_run_id": self.mlflow_run_id,
            "started_at": self.started_at,
        }


# key plots produits par Ultralytics model.val() qu'on remonte comme artefacts
_VAL_PLOTS = [
    "confusion_matrix.png", "confusion_matrix_normalized.png",
    "PR_curve.png", "P_curve.png", "R_curve.png", "F1_curve.png",
]


class EvalManager:
    def __init__(self) -> None:
        self._evals: dict[str, Eval] = {}
        self._lock = threading.Lock()

    # -- API publique ------------------------------------------------------
    def start_detection(self, model_path: str, data_yaml: str, overrides: Optional[dict] = None,
                        trace: Optional[dict] = None) -> Eval:
        ev = self._new("detection", {"model_path": model_path, "data_yaml": data_yaml, **(overrides or {})})
        ev.trace = trace or {}
        ev.thread = threading.Thread(target=self._run_detection, args=(ev, overrides or {}), daemon=True)
        ev.thread.start()
        return ev

    def start_tracker(self, model_path: str, sequence_dir: str,
                      annotation_file: Optional[str] = None, overrides: Optional[dict] = None,
                      trace: Optional[dict] = None) -> Eval:
        ev = self._new("tracker", {"model_path": model_path, "sequence_dir": sequence_dir,
                                   "annotation_file": annotation_file, **(overrides or {})})
        ev.trace = trace or {}
        ev.thread = threading.Thread(target=self._run_tracker, args=(ev, overrides or {}), daemon=True)
        ev.thread.start()
        return ev

    def get(self, eid: str) -> Optional[Eval]:
        return self._evals.get(eid)

    def list(self) -> list[dict]:
        return [e.public() for e in self._evals.values()]

    # -- interne -----------------------------------------------------------
    def _new(self, kind: str, params: dict) -> Eval:
        with self._lock:
            eid = uuid.uuid4().hex[:8]
            run_dir = C.RUNS_DIR / f"eval_{kind}_{datetime.now():%Y%m%d_%H%M%S}_{eid}"
            run_dir.mkdir(parents=True, exist_ok=True)
            ev = Eval(id=eid, kind=kind, run_dir=run_dir, params=params)
            self._evals[eid] = ev
        return ev

    # -- detection (Ultralytics model.val) ---------------------------------
    def _run_detection(self, ev: Eval, overrides: dict) -> None:
        try:
            det = S.load()["detection"]
            imgsz = int(overrides.get("imgsz", det["imgsz"]))
            conf  = float(overrides.get("conf", det["conf"]))
            iou   = float(overrides.get("iou", det["iou"]))
            split = str(overrides.get("split", det["split"]))
            model_path = ev.params["model_path"]
            data_yaml  = ev.params["data_yaml"]
            if not Path(model_path).exists():
                raise FileNotFoundError(f"modele introuvable: {model_path}")
            if not Path(data_yaml).exists():
                raise FileNotFoundError(f"data.yaml introuvable: {data_yaml}")

            from ultralytics import YOLO  # type: ignore
            model = YOLO(model_path)
            res = model.val(data=data_yaml, imgsz=imgsz, conf=conf, iou=iou,
                            split=split, project=str(ev.run_dir), name="val", exist_ok=True,
                            plots=True, verbose=False)

            metrics = {}
            try:
                metrics = {k.strip(): float(v) for k, v in res.results_dict.items() if v is not None}
            except Exception:
                pass
            ev.metrics = metrics

            # remonte les plots dans run_dir/artifacts
            art_dir = ev.run_dir / "artifacts"
            art_dir.mkdir(exist_ok=True)
            val_dir = ev.run_dir / "val"
            for name in _VAL_PLOTS:
                src = val_dir / name
                if src.exists():
                    shutil.copy2(src, art_dir / name)

            # MLflow
            run_name = ev.trace.get("run_name") or f"detection_{Path(model_path).stem}"
            ml = start_run(C.WORKSPACE, C.CURRENT_USER, experiment=ev.trace.get("experiment") or S.load()["mlflow"]["experiment"],
                           run_name=run_name,
                           params={"model": model_path, "data_yaml": data_yaml,
                                   "imgsz": imgsz, "conf": conf, "iou": iou, "split": split},
                           tags={"app": "Inference_App", "user": C.CURRENT_USER,
                                 "stage": "evaluation", "eval_kind": "detection",
                                 **(ev.trace.get("tags") or {})})
            ml.log_metrics(metrics)
            for name in _VAL_PLOTS:
                ml.log_artifact(str(art_dir / name), artifact_path="plots")
            ev.mlflow_run_id = self._run_id(ml)
            ml.finish("FINISHED")

            ev.status = "done"
        except Exception as exc:  # noqa: BLE001
            ev.status = "error"
            ev.error = f"{type(exc).__name__}: {exc}"

    # -- tracker (run_session headless + GT) -------------------------------
    def _run_tracker(self, ev: Eval, overrides: dict) -> None:
        try:
            if not tb.tracker_available():
                raise RuntimeError(f"tracker introuvable (TRACKER_ROOT={C.TRACKER_ROOT})")
            trk = S.load()["tracker"]
            model_path = ev.params["model_path"]
            seq = Path(ev.params["sequence_dir"])
            ann = ev.params.get("annotation_file")
            if not seq.exists():
                raise FileNotFoundError(f"sequence introuvable: {seq}")

            cfg = tb.load_base_config()
            cfg.update({
                "sequence_dir": str(seq),
                "mode": "headless",
                "local_display": False,
                "stream_mode": "none",
                "save_video": bool(overrides.get("save_video", False)),
                "tracker_mot": overrides.get("tracker_mot", trk["tracker_mot"]),
                "tracker_sot": overrides.get("tracker_sot", trk["tracker_sot"]),
                "metrics_iou_threshold": trk["iou_threshold"],
            })
            if model_path and Path(model_path).exists():
                cfg["weights_yolo"] = model_path
                cfg["detector_mot"] = "yolo"
            ann_ok = bool(ann and Path(ann).exists())
            cfg["compute_metrics"] = bool(trk["compute_metrics"] and ann_ok)
            if ann_ok:
                cfg["annotation_file"] = ann
            # Fenetre d'evaluation : soit une zone explicite [start_frame, stop_frame]
            # ("retest sur la zone"), soit un simple plafond max_frames depuis 0.
            start_frame = overrides.get("start_frame")
            stop_frame  = overrides.get("stop_frame")
            max_frames  = int(overrides.get("max_frames", trk["max_frames"]))
            if start_frame is not None or stop_frame is not None:
                cfg["start_frame_idx"] = int(start_frame or 0)
                cfg["stop_frame_idx"] = int(stop_frame) if stop_frame is not None else -1
            elif max_frames and max_frames > 0:
                cfg["start_frame_idx"] = 0
                cfg["stop_frame_idx"] = max_frames

            run_session = tb.get_run_session()
            benchmark = run_session(cfg, ev.run_dir)   # bloquant (thread)

            metrics = self._flatten_benchmark(benchmark if isinstance(benchmark, dict) else {})
            ev.metrics = metrics

            run_name = ev.trace.get("run_name") or f"tracker_{Path(model_path).stem if model_path else 'dummy'}"
            ml = start_run(C.WORKSPACE, C.CURRENT_USER, experiment=ev.trace.get("experiment") or S.load()["mlflow"]["experiment"],
                           run_name=run_name,
                           params={"model": model_path, "sequence": str(seq),
                                   "annotation_file": ann or "", "tracker_mot": cfg["tracker_mot"],
                                   "tracker_sot": cfg["tracker_sot"], "max_frames": max_frames,
                                   "compute_metrics": cfg["compute_metrics"]},
                           tags={"app": "Inference_App", "user": C.CURRENT_USER,
                                 "stage": "evaluation", "eval_kind": "tracker",
                                 **(ev.trace.get("tags") or {})})
            ml.log_metrics(metrics)
            bench_json = ev.run_dir / "benchmark" / "benchmark.json"
            ml.log_artifact(str(bench_json), artifact_path="benchmark")
            ev.mlflow_run_id = self._run_id(ml)
            ml.finish("FINISHED")

            ev.status = "done"
        except Exception as exc:  # noqa: BLE001
            ev.status = "error"
            ev.error = f"{type(exc).__name__}: {exc}"

    # -- helpers -----------------------------------------------------------
    # cle du benchmark natif (schema reel : minuscules, top-level + mot/ + sot/)
    _TOP_KEYS = ("fps_proc", "fps_total", "fps_min", "fps_sequence", "duration_s",
                 "n_frames", "mota", "idf1", "idsw", "tp", "fp", "fn", "n_gt")
    _SCOPE_KEYS = ("mota", "idf1", "idsw", "tp", "fp", "fn", "n_gt", "n_frames",
                   "n_decrochages", "id_frags", "n_losses")

    @classmethod
    def _flatten_benchmark(cls, b: dict) -> dict:
        out: dict = {}
        for k in cls._TOP_KEYS:
            if isinstance(b.get(k), (int, float, bool)):
                out[k] = float(b[k])
        if isinstance(b.get("has_gt"), bool):
            out["has_gt"] = 1.0 if b["has_gt"] else 0.0
        for scope in ("mot", "sot"):
            sc = b.get(scope)
            if isinstance(sc, dict):
                for m in cls._SCOPE_KEYS:
                    if isinstance(sc.get(m), (int, float, bool)):
                        out[f"{scope}_{m}"] = float(sc[m])
        return out

    @staticmethod
    def _run_id(ml) -> str:
        try:
            return ml._mlflow.active_run().info.run_id if ml.ok else ""
        except Exception:
            return ""


manager = EvalManager()
