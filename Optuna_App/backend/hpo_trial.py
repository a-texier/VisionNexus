#!/usr/bin/env python3
"""
hpo_trial.py — script de trial Optuna pour l'orchestrateur.

Entraîne un YOLO (Ultralytics) avec les hyperparamètres passés en arguments et
écrit un résultat JSON atomique. Stdout reste informatif mais n'est plus la source
de vérité du moteur HPO.

Appelé par l'endpoint /api/orchestrator/hpo :
    python hpo_trial.py --data_yaml D:/.../data.yaml --model yolov8n.pt \
        --epochs 10 --metric map50 --lr0 0.01 --mosaic 0.4 ...

Tout hyperparamètre inconnu (--<clé> <val>) est passé tel quel à model.train().
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def _write_result(path: str, payload: dict) -> None:
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = {"schema_version": 1, "written_at": datetime.now(timezone.utc).isoformat(), **payload}
    tmp = target.with_suffix(f".json.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, target)


def _coerce(v: str):
    try:
        if v.lower() in ("true", "false"):
            return v.lower() == "true"
        return int(v) if v.lstrip("-").isdigit() else float(v)
    except (ValueError, AttributeError):
        return v


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_yaml", required=True)
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--metric", default="map50")   # map50 | map5095
    parser.add_argument(
        "--workers", type=int, default=0 if os.name == "nt" else 2,
        help="Workers DataLoader. 0 par défaut sous Windows pour éviter les gels multiprocessing.",
    )
    parser.add_argument("--result_json", default="")
    parser.add_argument("--trial_dir", default="")
    # Les hyperparamètres restants sont libres (--lr0 0.01 ...).
    args, extra = parser.parse_known_args()

    hp: dict = {}
    i = 0
    while i < len(extra):
        tok = extra[i]
        if tok.startswith("--") and i + 1 < len(extra):
            hp[tok[2:]] = _coerce(extra[i + 1])
            i += 2
        else:
            i += 1

    # Ultralytics active son callback MLflow des que la lib mlflow est installee, et
    # son on_pretrain_routine_end appelle mlflow.set_experiment() HORS de son
    # try/except. Depuis MLflow 3.x, un store FICHIER (le defaut d'Ultralytics :
    # runs/mlflow) leve MlflowException "filesystem tracking backend ... maintenance
    # mode" -> le trial entier mourait avant le 1er epoch, et l'etude HPO renvoyait
    # "aucun trial abouti" pour une raison qui n'a rien a voir avec le training.
    # Le suivi des trials est deja assure par Optuna (study.db + result.json) : on
    # se contente donc de rendre ce store fichier inoffensif, cantonne au dossier
    # du trial (jete avec lui) plutot qu'au cache global d'Ultralytics.
    os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")
    if args.trial_dir and not os.environ.get("MLFLOW_TRACKING_URI"):
        os.environ["MLFLOW_TRACKING_URI"] = (Path(args.trial_dir).resolve() / "mlflow").as_uri()

    try:
        from ultralytics import YOLO
    except Exception as exc:  # pragma: no cover
        print(f"ultralytics indisponible: {exc}", file=sys.stderr)
        return 2

    model = YOLO(args.model)
    train_kwargs = {}
    if args.trial_dir:
        trial_dir = Path(args.trial_dir)
        train_kwargs = {"project": str(trial_dir.parent), "name": trial_dir.name, "exist_ok": True}
    try:
        # Sous Windows, plusieurs workers Ultralytics peuvent rester bloqués juste
        # après la création des caches (aucun epoch, processus UserRequest). Le
        # choix explicite reste surchargeable mais le défaut HPO doit être sûr.
        workers = int(hp.pop("workers", args.workers))
        results = model.train(
            data=args.data_yaml,
            epochs=args.epochs,
            imgsz=args.imgsz,
            verbose=False,
            plots=False,
            workers=workers,
            **train_kwargs,
            **hp,
        )
    except Exception as exc:
        _write_result(args.result_json, {
            "status": "failed", "error_type": type(exc).__name__, "error": str(exc),
            "data_yaml": args.data_yaml, "model": args.model, "params": hp,
            "artifact_dir": args.trial_dir or None,
        })
        raise

    # Extraction de la métrique objectif (défensif selon versions Ultralytics).
    value = None
    map50 = None
    map5095 = None
    try:
        box = results.box
        map50, map5095 = float(box.map50), float(box.map)
        value = map5095 if args.metric == "map5095" else map50
    except Exception:
        try:
            rd = getattr(results, "results_dict", {}) or {}
            key = "metrics/mAP50-95(B)" if args.metric == "map5095" else "metrics/mAP50(B)"
            map50 = float(rd["metrics/mAP50(B)"])
            map5095 = float(rd["metrics/mAP50-95(B)"])
            value = map5095 if args.metric == "map5095" else map50
        except Exception as exc:
            _write_result(args.result_json, {
                "status": "failed", "error_type": "MetricExtractionError",
                "error": f"Métrique {args.metric!r} absente ou illisible: {exc}",
                "params": hp, "artifact_dir": args.trial_dir or None,
            })
            print(f"métrique {args.metric!r} absente ou illisible: {exc}", file=sys.stderr)
            return 3

    if value is None or not math.isfinite(value):
        _write_result(args.result_json, {
            "status": "failed", "error_type": "MetricExtractionError",
            "error": f"Métrique {args.metric!r} non finie: {value}",
            "params": hp, "artifact_dir": args.trial_dir or None,
        })
        print(f"métrique {args.metric!r} non finie: {value}", file=sys.stderr)
        return 3

    save_dir = Path(str(getattr(results, "save_dir", args.trial_dir or "")))
    _write_result(args.result_json, {
        "status": "completed",
        "objective_name": args.metric,
        "objective_value": value,
        "metrics": {"map50": map50, "map5095": map5095},
        "params": hp,
        "data_yaml": args.data_yaml,
        "model": args.model,
        "artifact_dir": str(save_dir) if str(save_dir) else None,
        "results_csv": str(save_dir / "results.csv") if save_dir else None,
        "best_weights": str(save_dir / "weights" / "best.pt") if save_dir else None,
        "last_weights": str(save_dir / "weights" / "last.pt") if save_dir else None,
    })

    # Compatibilité humaine/anciens appelants uniquement.
    print(f"{args.metric}={value}")
    print(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
