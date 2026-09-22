#!/usr/bin/env python3
"""
hpo_trial.py — script de trial Optuna pour l'orchestrateur.

Entraîne un modèle avec le moteur demandé (--engine, "yolox" par défaut)
et les hyperparamètres passés en arguments, puis écrit un résultat JSON
atomique. Stdout reste informatif mais n'est plus la source de vérité.

Appelé par l'endpoint /api/orchestrator/hpo :
    python hpo_trial.py --data_yaml D:/.../data.yaml --engine yolox \
        --model_size yolox-s --epochs 10 --metric map50 --degrees 5.0 ...

Réutilise les moteurs de Training_App (services.trainer_backend) via
sys.path -- même pattern que Inference_App/backend/services/tracker_bridge.py
pour traverser une frontière d'app. Les hyperparamètres libres
(--<clé> <val>) sont filtrés par le catalogue du moteur : une clé qu'il ne
connaît pas est ignorée et listée dans le résultat.
"""

import argparse
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_TRAINING_APP_BACKEND = Path(__file__).resolve().parent.parent.parent / "Training_App" / "backend"
if str(_TRAINING_APP_BACKEND) not in sys.path:
    sys.path.insert(0, str(_TRAINING_APP_BACKEND))


def _write_result(path: str, payload: dict) -> None:
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = {"schema_version": 2, "written_at": datetime.now(timezone.utc).isoformat(), **payload}
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
    parser.add_argument("--engine", default="yolox", help="moteur d'entrainement (voir /api/capabilities)")
    parser.add_argument("--model_size", default="", help="taille du catalogue du moteur (vide = defaut)")
    parser.add_argument("--weights", default="", help="poids de depart au format du moteur (optionnel)")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--metric", default="map50")   # map50 | map5095
    parser.add_argument(
        "--workers", type=int, default=0 if os.name == "nt" else 2,
        help="Workers DataLoader. 0 par défaut sous Windows pour éviter les gels multiprocessing.",
    )
    parser.add_argument("--result_json", default="")
    parser.add_argument("--trial_dir", default="")
    parser.add_argument(
        "--runs_dir", default="",
        help="Sans --trial_dir : chaque trial ecrit dans un sous-dossier unique de ce dossier.",
    )
    # Les hyperparametres restants sont libres (--degrees 5.0 ...).
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

    try:
        from services.trainer_backend import engine_catalog, merge_hyperparams, resolve_engine
    except Exception as exc:  # pragma: no cover
        print(f"moteur d'entrainement (Training_App) indisponible: {exc}", file=sys.stderr)
        return 2

    def fail(exc: Exception) -> None:
        _write_result(args.result_json, {
            "status": "failed", "error_type": type(exc).__name__, "error": str(exc),
            "data_yaml": args.data_yaml, "engine": args.engine, "model_size": args.model_size,
            "params": hp, "artifact_dir": args.trial_dir or None,
        })

    # Un trial doit optimiser le meme moteur que l'entrainement final : pas
    # de repli sur un autre moteur si celui-ci est indisponible.
    try:
        EngineCls = resolve_engine(args.engine)
        catalog = engine_catalog(args.engine)
    except Exception as exc:
        fail(exc)
        raise

    model_size = args.model_size or catalog["default_size"]
    workers_key = catalog["keys"].get("workers")
    if workers_key and workers_key not in hp:
        hp[workers_key] = args.workers
    hyperparams, ignored = merge_hyperparams(catalog, hp, epochs=args.epochs, imgsz=args.imgsz)

    if args.trial_dir:
        trial_dir = Path(args.trial_dir)
    elif args.runs_dir:
        # Etude manuelle : aucun appelant ne fournit de dossier par trial.
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        trial_dir = Path(args.runs_dir) / f"trial_{stamp}_{os.getpid()}"
    else:
        trial_dir = Path(args.result_json or ".").parent
    run_name = trial_dir.name or "trial"
    output_dir = trial_dir.parent

    last_payload: dict = {}
    try:
        trainer = EngineCls(
            model_size=model_size,
            data_yaml=args.data_yaml,
            run_name=run_name,
            output_dir=str(output_dir),
            hyperparams=hyperparams,
            model_weights=args.weights,
            on_epoch_end=last_payload.update,
        )
        result = trainer.train() or {}
    except Exception as exc:
        fail(exc)
        raise

    # Revalidation des poids finaux si le moteur en fait une, sinon derniere epoque.
    metrics = result.get("metrics") or last_payload.get("metrics", {})
    map50 = metrics.get("metrics/mAP50(B)")
    map5095 = metrics.get("metrics/mAP50-95(B)")
    value = map5095 if args.metric == "map5095" else map50

    if value is None or not math.isfinite(value):
        _write_result(args.result_json, {
            "status": "failed", "error_type": "MetricExtractionError",
            "error": f"Métrique {args.metric!r} absente ou non finie: {value}",
            "engine": args.engine, "params": hp, "artifact_dir": args.trial_dir or None,
        })
        print(f"métrique {args.metric!r} absente ou non finie: {value}", file=sys.stderr)
        return 3

    save_dir = Path(result.get("run_dir") or trial_dir)
    _write_result(args.result_json, {
        "status": "completed",
        "objective_name": args.metric,
        "objective_value": value,
        "metrics": {"map50": map50, "map5095": map5095},
        "params": hp,
        "ignored_params": ignored,
        "data_yaml": args.data_yaml,
        "engine": args.engine,
        "model_size": model_size,
        "artifact_dir": str(save_dir),
        "results_csv": str(save_dir / "results.csv"),
        "best_weights": result.get("best_model_path") or None,
        "last_weights": result.get("last_model_path") or None,
    })

    # Compatibilite humaine/anciens appelants (contrat CLAUDE.md : derniere ligne
    # stdout = float brut). Un moteur peut rediriger sys.stdout vers son propre
    # logger (YOLOX : yolox.utils.logger.setup_logger) ; on ecrit donc
    # explicitement sur le vrai stdout du process (sys.__stdout__), sinon ces
    # lignes sont avalees par le logger et n'atteignent jamais le pipe que lit
    # le parent (subprocess.run).
    real_stdout = sys.__stdout__ or sys.stdout
    print(f"{args.metric}={value}", file=real_stdout)
    print(value, file=real_stdout)
    # sys.stdout ne pointe plus vers real_stdout : le flush d'interpreteur a la
    # sortie du process n'y touchera pas, il faut le faire explicitement.
    real_stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
