# ============================================================
# api/studies.py
# CRUD études Optuna + gestion runs background
# ============================================================

import json
import csv
import logging
import math
import os
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import optuna
import yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.config import OPTUNA_STORAGE, WORKSPACE
from backend.core.optuna_runner import (
    get_state, start_optimization, stop_optimization, stream_logs,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["studies"])

optuna.logging.set_verbosity(optuna.logging.WARNING)


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _get_client() -> optuna.storages.RDBStorage:
    return optuna.storages.RDBStorage(OPTUNA_STORAGE)


def _is_active_here(study_name: str) -> bool:
    try:
        from backend.api.orchestrator import ACTIVE_HPO_STUDIES
        return study_name in ACTIVE_HPO_STUDIES or get_state(study_name).status == "running"
    except Exception:
        return get_state(study_name).status == "running"


def _is_stale_running(trial, study_name: str, stale_after_s: int = 1800) -> bool:
    """Détecte un RUNNING abandonné sans modifier le storage Optuna.

    Un état historique ne doit jamais être réécrit au simple chargement d'une
    page. ``INTERRUPTED`` est donc une qualification de lecture, calculée depuis
    l'absence de processus local et l'âge du trial.
    """
    if trial.state.name != "RUNNING" or not trial.datetime_start:
        return False
    if _is_active_here(study_name):
        return False
    started = trial.datetime_start
    if started.tzinfo is None:
        # SQLite/Optuna stocke ici une date locale naïve. La marquer UTC décale
        # artificiellement son âge (ex. +2 h Europe/Paris) et laisse un processus
        # mort affiché RUNNING. Comparer naïf avec naïf préserve l'horloge source.
        now = datetime.now()
    else:
        now = datetime.now(timezone.utc).astimezone(started.tzinfo)
    return (now - started).total_seconds() >= stale_after_s


def _effective_state(trial, attrs: dict, study_name: str = "") -> str:
    if attrs.get("execution_state") == "interrupted" or attrs.get("failure_code") == "interrupted_stale":
        return "INTERRUPTED"
    if study_name and _is_stale_running(trial, study_name):
        return "INTERRUPTED"
    if trial.state.name == "PRUNED" and not trial.intermediate_values:
        return "LEGACY_PRUNED_UNKNOWN"
    return trial.state.name


def _legacy_log_diagnostic(trial, logs_root: Path | None = None) -> dict | None:
    """Récupère une preuve dans les logs pour un ancien PRUNED sans attributs."""
    if trial.state.name != "PRUNED" or trial.intermediate_values or not trial.datetime_complete:
        return None
    timestamp = trial.datetime_complete.strftime("%Y-%m-%d %H:%M:%S")
    for log_path in sorted((logs_root or WORKSPACE / "logs").glob("optuna_backend_*.log"), reverse=True):
        try:
            content = log_path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        marker = f"{timestamp}"
        start = content.find(marker)
        while start >= 0:
            excerpt = content[start:start + 900]
            if re.search(rf"trial\s+{trial.number}\b", excerpt, re.IGNORECASE) and (
                "get_dataset" in excerpt or "check_det_dataset" in excerpt
            ):
                return {
                    "code": "legacy_dataset_load_failure",
                    "title": "Chargement du dataset Ultralytics impossible",
                    "reason": (
                        "Le log historique montre que le trial a échoué dans "
                        "ultralytics.trainer.get_dataset/check_det_dataset avant toute métrique. "
                        f"Preuve : {log_path.name}, horodatage {timestamp}."
                    ),
                    "action": (
                        "Vérifiez le data.yaml et ses chemins train/val, puis ouvrez le log indiqué. "
                        "Ce trial n'a pas été pruné par l'algorithme."
                    ),
                }
            start = content.find(marker, start + len(marker))
    return None


def _stale_trial_evidence(trial, study_name: str) -> dict:
    """Décrit uniquement les fichiers observables d'un trial abandonné."""
    trial_dir = WORKSPACE / "hpo_runs" / study_name / f"trial_{trial.number:04d}"
    args_file = trial_dir / "args.yaml"
    args = {}
    if args_file.exists():
        try:
            args = yaml.safe_load(args_file.read_text(encoding="utf-8")) or {}
        except Exception:
            args = {}
    expected = {
        "args.yaml": args_file.exists(),
        "results.csv": (trial_dir / "results.csv").exists(),
        "result.json": (trial_dir / "result.json").exists(),
        "stdout.log": (trial_dir / "stdout.log").exists(),
        "stderr.log": (trial_dir / "stderr.log").exists(),
        "best.pt": (trial_dir / "weights" / "best.pt").exists(),
    }
    workers = args.get("workers")
    only_setup = expected["args.yaml"] and not any(
        expected[name] for name in ("results.csv", "result.json", "stdout.log", "stderr.log", "best.pt")
    )
    facts = (
        f"Faits observés dans {trial_dir} : "
        f"args.yaml={'présent' if expected['args.yaml'] else 'absent'}, "
        f"results.csv={'présent' if expected['results.csv'] else 'absent'}, "
        f"result.json={'présent' if expected['result.json'] else 'absent'}, "
        f"poids best.pt={'présents' if expected['best.pt'] else 'absents'}"
        + (f", workers={workers}." if workers is not None else ".")
    )
    interpretation = ""
    action = "Inspectez les artefacts partiels puis lancez un nouvel attempt ; ce trial ne constitue pas un résultat scientifique."
    if os.name == "nt" and isinstance(workers, int) and workers > 0 and only_setup:
        interpretation = (
            " Interprétation probabiliste : ce profil est compatible avec un blocage du DataLoader "
            "multiprocessus Windows avant la première époque ; les fichiers seuls ne permettent pas "
            "d'en faire une causalité certaine."
        )
        action = (
            "Relancez dans un nouvel attempt avec workers=0. Le backend actuel applique désormais "
            "workers=0 par défaut sous Windows et limite aussi la durée de chaque trial."
        )
    return {
        "reason": facts + interpretation,
        "action": action,
        "evidence": {"trial_dir": str(trial_dir), "files": expected, "workers": workers},
    }


def _diagnostic_for_trial(trial, study_name: str = "") -> dict:
    attrs = dict(trial.user_attrs or {})
    recovered = _legacy_log_diagnostic(trial)
    recovered_artifacts = _recover_legacy_artifacts(trial)
    legacy_unknown = trial.state.name == "PRUNED" and not trial.intermediate_values
    stale = bool(study_name and _is_stale_running(trial, study_name))
    stale_evidence = _stale_trial_evidence(trial, study_name) if stale else {}
    transport_failure = bool(
        attrs.get("failure_code") == "metric_parse"
        and recovered_artifacts.get("recovery_status") == "recovered_unofficial"
    )
    return {
        "trial": trial.number,
        "state": "LEGACY_FAILURE_RECOVERED" if recovered else _effective_state(trial, attrs, study_name),
        "code": "metric_transport_lost" if transport_failure else attrs.get("failure_code") or (recovered or {}).get("code") or ("interrupted_stale" if stale else "legacy_pruned_unknown" if legacy_unknown else None),
        "title": "Training terminé, métrique perdue au transport" if transport_failure else attrs.get("failure_title") or (recovered or {}).get("title") or ("Trial interrompu" if stale else "Erreur historique classée PRUNED" if legacy_unknown else "Trial en échec"),
        "reason": (f"results.csv et les poids existent dans {recovered_artifacts.get('artifact_dir')}; l'ancienne capture stdout n'a pas enregistré la valeur dans Optuna." if transport_failure else attrs.get("failure_reason") or (recovered or {}).get("reason") or (stale_evidence.get("reason") if stale else "Aucune métrique intermédiaire ni décision de pruner n'est enregistrée. Ce statut historique ne prouve donc pas un pruning algorithmique." if legacy_unknown else "Cause non conservée par cette ancienne version.")),
        "action": ("Utilisez ces métriques comme preuve historique informative uniquement ; lancez un nouvel attempt pour produire un COMPLETE officiel." if transport_failure else attrs.get("failure_action") or (recovered or {}).get("action") or (stale_evidence.get("action") if stale else "Consultez le log technique et les artefacts du trial avant de décider d'une relance.")),
        "evidence": stale_evidence.get("evidence") if stale else None,
    }


def _recover_legacy_artifacts(trial, runs_root: Path | None = None) -> dict:
    """Rapproche un ancien FAIL de son dossier Ultralytics sans modifier la DB.

    Le rapprochement exige les mêmes hyperparamètres dans args.yaml. Le timestamp
    ne sert qu'à départager plusieurs candidats. Le résultat reste explicitement
    "recovered_unofficial" car l'objectif exact Python n'a pas été enregistré.
    """
    if trial.state.name not in ("FAIL", "PRUNED") or not trial.params:
        return {}
    root = runs_root or Path(__file__).resolve().parents[2] / "runs" / "detect"
    if not root.exists():
        return {}
    candidates: list[tuple[float, Path]] = []
    completed_ts = trial.datetime_complete.timestamp() if trial.datetime_complete else None
    for args_file in root.glob("*/args.yaml"):
        results_csv = args_file.parent / "results.csv"
        if not results_csv.exists():
            continue
        try:
            args = yaml.safe_load(args_file.read_text(encoding="utf-8")) or {}
            matches = True
            for key, expected in trial.params.items():
                actual = args.get(key)
                if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
                    if abs(float(actual) - float(expected)) > max(1e-9, abs(float(expected)) * 1e-7):
                        matches = False
                        break
                elif str(actual) != str(expected):
                    matches = False
                    break
            if not matches:
                continue
            delta = abs(results_csv.stat().st_mtime - completed_ts) if completed_ts else 0.0
            candidates.append((delta, args_file.parent))
        except Exception:
            continue
    if not candidates:
        return {}
    candidates.sort(key=lambda item: item[0])
    # Un candidat très éloigné temporellement peut partager les mêmes params par
    # hasard : au-delà de 30 minutes, on préfère ne rien affirmer.
    delta, run_dir = candidates[0]
    if completed_ts and delta > 1800:
        return {}
    try:
        with (run_dir / "results.csv").open("r", encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.DictReader(fh))
        last = {str(k).strip(): v for k, v in (rows[-1] if rows else {}).items()}
        def number(*names):
            for name in names:
                if last.get(name) not in (None, ""):
                    return float(last[name])
            return None
        return {
            "artifact_dir": str(run_dir),
            "results_csv": str(run_dir / "results.csv"),
            "best_weights": str(run_dir / "weights" / "best.pt") if (run_dir / "weights" / "best.pt").exists() else None,
            "metrics": {
                "map50": number("metrics/mAP50(B)", "metrics/mAP50"),
                "map5095": number("metrics/mAP50-95(B)", "metrics/mAP50-95"),
            },
            "metric_source": "recovered_unofficial_results_csv",
            "recovery_status": "recovered_unofficial",
        }
    except Exception:
        return {}


def _trial_to_dict(trial, study_name: str = "") -> dict:
    attrs = dict(trial.user_attrs or {})
    recovered = {} if attrs.get("artifact_dir") else _recover_legacy_artifacts(trial)
    recovered_diagnostic = _legacy_log_diagnostic(trial)
    return {
        "number":        trial.number,
        "state":         trial.state.name,
        "effective_state": "LEGACY_FAILURE_RECOVERED" if recovered_diagnostic else _effective_state(trial, attrs, study_name),
        "value":         trial.value,
        "params":        dict(trial.params),
        "duration_s":    (
            (trial.datetime_complete - trial.datetime_start).total_seconds()
            if trial.datetime_complete and trial.datetime_start else None
        ),
        "datetime_start":    trial.datetime_start.isoformat() if trial.datetime_start else None,
        "datetime_complete": trial.datetime_complete.isoformat() if trial.datetime_complete else None,
        "failure_code":   attrs.get("failure_code"),
        "failure_title":  attrs.get("failure_title"),
        "failure_reason": attrs.get("failure_reason"),
        "failure_action": attrs.get("failure_action"),
        "return_code":    attrs.get("return_code"),
        "artifact_dir":   attrs.get("artifact_dir") or recovered.get("artifact_dir"),
        "results_csv":    attrs.get("results_csv") or recovered.get("results_csv"),
        "best_weights":   attrs.get("best_weights") or recovered.get("best_weights"),
        "metrics":        attrs.get("metrics") or recovered.get("metrics") or {},
        "metric_source":  attrs.get("metric_source") or recovered.get("metric_source"),
        "recovery_status": recovered.get("recovery_status"),
    }


def _distribution_contract(name: str, distribution, best_params: dict) -> dict:
    """Sérialise une distribution Optuna sans dépendre de son JSON interne."""
    base = {
        "name": name,
        "type": "unknown",
        "low": None,
        "high": None,
        "log": False,
        "step": None,
        "choices": None,
        "distribution": type(distribution).__name__,
        "best_value": best_params.get(name),
    }
    if isinstance(distribution, optuna.distributions.FloatDistribution):
        base.update(type="float", low=distribution.low, high=distribution.high,
                    log=distribution.log, step=distribution.step)
    elif isinstance(distribution, optuna.distributions.IntDistribution):
        base.update(type="int", low=distribution.low, high=distribution.high,
                    log=distribution.log, step=distribution.step)
    elif isinstance(distribution, optuna.distributions.CategoricalDistribution):
        base.update(type="categorical", choices=list(distribution.choices))
    return base


def _study_search_space(study: optuna.Study, best_params: dict) -> list[dict]:
    distributions: dict[str, Any] = {}
    for trial in study.get_trials(deepcopy=False):
        for name, distribution in trial.distributions.items():
            distributions.setdefault(name, distribution)
    return [
        _distribution_contract(name, distributions[name], best_params)
        for name in sorted(distributions)
    ]


def _parameter_importance_contract(study: optuna.Study) -> tuple[dict[str, float] | None, str | None, str]:
    """Calcule une importance exploratoire, jamais présentée comme causale."""
    complete = [
        t for t in study.trials
        if t.state == optuna.trial.TrialState.COMPLETE
        and t.value is not None and math.isfinite(float(t.value))
    ]
    method = "fANOVA (Optuna FanovaImportanceEvaluator, seed=0)"
    if len(complete) < 5:
        return None, "Au moins 5 trials COMPLETE avec une valeur finie sont requis pour une estimation exploratoire.", method
    if len({float(t.value) for t in complete}) < 2:
        return None, "Toutes les valeurs objectif COMPLETE sont identiques ; aucune importance statistique n'est identifiable.", method
    try:
        from optuna.importance import FanovaImportanceEvaluator, get_param_importances
        raw = get_param_importances(study, evaluator=FanovaImportanceEvaluator(seed=0))
        if not raw:
            return None, "Aucun paramètre commun exploitable n'a été trouvé dans les trials COMPLETE.", method
        return {name: float(value) for name, value in raw.items()}, None, method
    except Exception as exc:
        return None, f"Importance indisponible : {type(exc).__name__}: {exc}", method


def _study_summary_to_dict(s) -> dict:
    # La liste ne doit pas résumer un HPO totalement échoué par un simple « — ».
    # On expose l'état réel et les compteurs dès l'accueil de l'application.
    study = optuna.load_study(study_name=s.study_name, storage=OPTUNA_STORAGE)
    attrs = dict(study.user_attrs or {})
    counts = {"complete": 0, "failed": 0, "pruned": 0, "running": 0, "waiting": 0, "interrupted": 0}
    for trial in study.trials:
        if _effective_state(trial, dict(trial.user_attrs or {}), study.study_name) == "INTERRUPTED":
            counts["interrupted"] += 1
            continue
        key = {"FAIL": "failed"}.get(trial.state.name, trial.state.name.lower())
        if key in counts:
            counts[key] += 1
    in_progress = counts["running"] + counts["waiting"] > 0
    counts.update({
        "planned": len(study.trials),
        "finalized": counts["complete"] + counts["failed"] + counts["pruned"] + counts["interrupted"],
        "succeeded": counts["complete"],
    })
    status = ("running" if in_progress else "finished" if counts["complete"] > 0
              else "error" if study.trials else "idle")
    return {
        "study_id":   s._study_id,
        "study_name": s.study_name,
        "direction":  s.direction.name,
        "n_trials":   s.n_trials,
        "best_value": s.best_trial.value if s.best_trial else None,
        "datetime_start": s.datetime_start.isoformat() if s.datetime_start else None,
        "status": status,
        "counts": counts,
        "graph_id": attrs.get("graph_id"),
        "run_id": attrs.get("run_id"),
        "node_label": attrs.get("node_label"),
        "metric": attrs.get("metric"),
        "stop_on_failure": attrs.get("stop_on_failure"),
        "attempt_id": attrs.get("attempt_id"),
    }


def _load_study(study_name: str) -> optuna.Study:
    try:
        return optuna.load_study(study_name=study_name, storage=OPTUNA_STORAGE)
    except Exception as exc:
        raise HTTPException(404, f"Étude introuvable : {exc}")


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class StudyCreate(BaseModel):
    study_name: str
    direction:  str = "minimize"

class ParamSpec(BaseModel):
    name:     str
    type:     str                     # float | int | categorical
    low:      float | None = None
    high:     float | None = None
    log:      bool         = False
    choices:  list[Any]    = []

class StartBody(BaseModel):
    script_path:  str
    n_trials:     int = 10
    metric_name:  str = "loss"
    direction:    str = "minimize"
    param_space:  list[ParamSpec] = []


# ------------------------------------------------------------------ #
# Endpoints                                                           #
# ------------------------------------------------------------------ #

@router.get("/studies")
def list_studies():
    try:
        summaries = optuna.get_all_study_summaries(storage=OPTUNA_STORAGE)
        return [_study_summary_to_dict(s) for s in summaries]
    except Exception as exc:
        logger.exception("list_studies error")
        raise HTTPException(500, str(exc))


@router.post("/studies", status_code=201)
def create_study(body: StudyCreate):
    if body.direction not in ("minimize", "maximize"):
        raise HTTPException(400, "direction doit être 'minimize' ou 'maximize'")
    try:
        study = optuna.create_study(
            study_name=body.study_name,
            storage=OPTUNA_STORAGE,
            direction=body.direction,
            load_if_exists=False,
        )
        return {"study_name": study.study_name, "direction": study.direction.name}
    except Exception as exc:
        logger.exception("create_study error")
        raise HTTPException(409, str(exc))


@router.delete("/studies/{study_name}")
def delete_study(study_name: str):
    try:
        optuna.delete_study(study_name=study_name, storage=OPTUNA_STORAGE)
        _study_states_cleanup(study_name)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(500, str(exc))


def _study_states_cleanup(study_name: str):
    from backend.core.optuna_runner import _study_states
    _study_states.pop(study_name, None)


@router.get("/studies/{study_name}/trials")
def list_trials(study_name: str):
    study = _load_study(study_name)
    return [_trial_to_dict(t, study.study_name) for t in study.trials]


@router.get("/studies/{study_name}/analysis")
def study_analysis(study_name: str):
    """Données factuelles destinées au dashboard d'analyse HPO.

    Les importances fANOVA décrivent une association modélisée dans les trials
    observés. Elles ne prouvent jamais qu'un paramètre cause la variation de la
    métrique et sont accompagnées de limites explicites.
    """
    study = _load_study(study_name)
    attrs = dict(study.user_attrs or {})
    complete = [
        t for t in study.trials
        if t.state == optuna.trial.TrialState.COMPLETE
        and t.value is not None and math.isfinite(float(t.value))
    ]
    best_trial = None
    best_params: dict[str, Any] = {}
    if complete:
        try:
            best_trial = study.best_trial
            best_params = dict(best_trial.params)
        except Exception:
            pass

    search_space = _study_search_space(study, best_params)
    importances, importance_error, importance_method = _parameter_importance_contract(study)
    startup = int(attrs.get("n_startup_trials") or 10)

    raw_counts = {"COMPLETE": 0, "PRUNED": 0, "RUNNING": 0, "FAIL": 0, "WAITING": 0}
    effective_counts = {**raw_counts, "INTERRUPTED": 0, "LEGACY_PRUNED_UNKNOWN": 0,
                        "LEGACY_FAILURE_RECOVERED": 0}
    for trial in study.trials:
        if trial.state.name in raw_counts:
            raw_counts[trial.state.name] += 1
        effective = _effective_state(trial, dict(trial.user_attrs or {}), study.study_name)
        if effective in effective_counts:
            effective_counts[effective] += 1

    values = [float(t.value) for t in complete]
    durations = [
        (t.datetime_complete - t.datetime_start).total_seconds()
        for t in study.trials if t.datetime_start and t.datetime_complete
    ]
    intermediate_report_count = sum(len(t.intermediate_values) for t in study.trials)
    evidenced_pruned_count = sum(
        1 for t in study.trials
        if t.state == optuna.trial.TrialState.PRUNED and bool(t.intermediate_values)
    )

    warnings = [
        "Les importances décrivent une association dans cet échantillon de trials ; elles ne démontrent aucune causalité."
    ]
    if len(complete) < 20:
        warnings.append(
            f"Seulement {len(complete)} trials COMPLETE : le classement des paramètres est exploratoire et potentiellement instable."
        )
    if len(complete) < startup:
        warnings.append(
            f"Le sampler est encore en phase startup ({len(complete)}/{startup} COMPLETE) ; aucune décision TPE adaptative n'est démontrée."
        )
    if values and max(values) - min(values) < 0.02:
        warnings.append(
            f"Faible dispersion de l'objectif ({max(values) - min(values):.6g}) : de petites variations peuvent fortement changer les importances."
        )

    return {
        "configuration": {
            "dataset": attrs.get("dataset_path") or attrs.get("data_yaml"),
            "data_yaml": attrs.get("data_yaml"),
            "n_trials": int(attrs.get("requested_n_trials") or len(study.trials)),
            "observed_trials": len(study.trials),
            "direction": study.direction.name.lower(),
            "objective_metric": attrs.get("metric") or "value",
            "sampler": attrs.get("sampler") or type(study.sampler).__name__,
            "pruner": attrs.get("pruner") or type(study.pruner).__name__,
            "graph_id": attrs.get("graph_id"),
            "run_id": attrs.get("run_id"),
            "node_id": attrs.get("node_id"),
            "attempt_id": attrs.get("attempt_id"),
        },
        "search_space": search_space,
        "parameter_importances": importances,
        "importance_error": importance_error,
        "importance_method": importance_method,
        "importance_trial_count": len(complete),
        "importance_warning": " ".join(warnings),
        "state_counts": effective_counts,
        "raw_state_counts": raw_counts,
        "sampler_analysis": {
            "phase": "adaptive" if len(complete) >= startup else "startup",
            "n_startup_trials": startup,
            "complete_trials": len(complete),
            "adaptive_decisions_observed": max(0, len(complete) - startup),
        },
        "pruner_analysis": {
            "configured": attrs.get("pruner") or type(study.pruner).__name__,
            "reason": attrs.get("pruner_reason"),
            "intermediate_report_count": intermediate_report_count,
            "pruned_with_intermediate_evidence": evidenced_pruned_count,
            "algorithmic_pruning_demonstrated": evidenced_pruned_count > 0,
        },
        "objective_summary": {
            "count": len(values),
            "best_trial": best_trial.number if best_trial else None,
            "best_value": float(best_trial.value) if best_trial and best_trial.value is not None else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
            "mean": statistics.fmean(values) if values else None,
            "median": statistics.median(values) if values else None,
            "standard_deviation": statistics.pstdev(values) if len(values) > 1 else 0.0 if values else None,
            "distinct_values": len(set(values)),
        },
        "duration_summary_s": {
            "count": len(durations),
            "min": min(durations) if durations else None,
            "max": max(durations) if durations else None,
            "mean": statistics.fmean(durations) if durations else None,
            "median": statistics.median(durations) if durations else None,
        },
    }


@router.get("/studies/{study_name}/best")
def best_trial(study_name: str):
    study = _load_study(study_name)
    if not study.trials:
        raise HTTPException(404, "Aucun trial terminé")
    try:
        t = study.best_trial
        return _trial_to_dict(t, study.study_name)
    except Exception:
        raise HTTPException(404, "Aucun meilleur trial disponible")


@router.post("/studies/{study_name}/start")
def start_study(study_name: str, body: StartBody):
    param_space = [p.model_dump() for p in body.param_space]
    ok = start_optimization(
        study_name=study_name,
        script_path=body.script_path,
        n_trials=body.n_trials,
        metric_name=body.metric_name,
        direction=body.direction,
        param_space=param_space,
    )
    if not ok:
        raise HTTPException(409, "Optimisation déjà en cours pour cette étude")
    return {"ok": True, "study_name": study_name}


@router.post("/studies/{study_name}/stop")
def stop_study(study_name: str):
    ok = stop_optimization(study_name)
    if not ok:
        raise HTTPException(409, "Aucune optimisation en cours pour cette étude")
    return {"ok": True}


@router.get("/studies/{study_name}/status")
def study_status(study_name: str):
    state = get_state(study_name)
    out = {
        "study_name":  study_name,
        "status":      state.status,
        "n_trials":    state.n_trials,
        "completed":   state.completed,
        "best_value":  state.best_value,
        "direction":   None,
        "error_msg":   state.error_msg,
        "progress_pct": (
            int(state.completed / state.n_trials * 100)
            if state.n_trials > 0 else 0
        ),
        "counts": {"complete": 0, "failed": 0, "pruned": 0, "running": 0, "waiting": 0, "interrupted": 0,
                   "planned": 0, "finalized": 0, "succeeded": 0},
        "context": {},
        "diagnostics": [],
        "diagnostic_groups": [],
        "sampler_phase": "unknown",
        "adaptive_decisions": 0,
        "pruner_status": "unknown",
        "recovered_candidate": None,
    }
    # Complète depuis la DB : direction toujours, compteurs/best si aucun run
    # en mémoire (ex. backend redémarré) — l'UI ne doit rien cacher.
    try:
        study = optuna.load_study(study_name=study_name, storage=OPTUNA_STORAGE)
        out["direction"] = study.direction.name
        out["context"] = dict(study.user_attrs or {})
        counts = {"complete": 0, "failed": 0, "pruned": 0, "running": 0, "waiting": 0, "interrupted": 0}
        for trial in study.trials:
            if _effective_state(trial, dict(trial.user_attrs or {}), study.study_name) == "INTERRUPTED":
                counts["interrupted"] += 1
                continue
            key = {"FAIL": "failed"}.get(trial.state.name, trial.state.name.lower())
            if key in counts:
                counts[key] += 1
        counts.update({
            "planned": len(study.trials),
            "finalized": counts["complete"] + counts["failed"] + counts["pruned"] + counts["interrupted"],
            "succeeded": counts["complete"],
        })
        out["counts"] = counts
        out["n_trials"] = len(study.trials)
        out["completed"] = counts["complete"]
        out["progress_pct"] = int(counts["finalized"] / counts["planned"] * 100) if counts["planned"] else 0
        out["diagnostics"] = [
            _diagnostic_for_trial(t, study.study_name)
            for t in study.trials
            if t.state.name in ("FAIL", "PRUNED")
            or _is_stale_running(t, study.study_name)
            or t.user_attrs.get("failure_reason")
        ]
        groups: dict[str, dict] = {}
        for diag in out["diagnostics"]:
            fingerprint = f"{diag.get('code')}|{diag.get('title')}"
            group = groups.setdefault(fingerprint, {**diag, "trials": [], "count": 0})
            group["trials"].append(diag["trial"])
            group["count"] += 1
        out["diagnostic_groups"] = list(groups.values())
        # Les anciennes versions pouvaient terminer YOLO puis perdre la valeur
        # objective pendant le décodage de stdout. On ne transforme pas ces
        # FAIL en COMPLETE, mais on expose le meilleur résultat physique
        # retrouvé afin que l'utilisateur voie ce qui a réellement été produit.
        recovered_trials = [_trial_to_dict(t, study.study_name) for t in study.trials]
        recovered_trials = [
            t for t in recovered_trials
            if t.get("recovery_status") == "recovered_unofficial"
            and (t.get("metrics") or {}).get("map50") is not None
        ]
        if recovered_trials:
            reverse = study.direction.name == "MAXIMIZE"
            metric_name = str(out["context"].get("metric") or "map50").lower()
            metric_key = "map5095" if "5095" in metric_name or "50-95" in metric_name else "map50"
            usable = [t for t in recovered_trials if (t.get("metrics") or {}).get(metric_key) is not None]
            if usable:
                candidate = sorted(
                    usable,
                    key=lambda t: float(t["metrics"][metric_key]),
                    reverse=reverse,
                )[0]
                best_recovered_value = float(candidate["metrics"][metric_key])
                tied_trials = [
                    t["number"] for t in usable
                    if abs(float(t["metrics"][metric_key]) - best_recovered_value) <= 1e-12
                ]
                out["recovered_candidate"] = {
                    "trial": candidate["number"],
                    "metric": metric_key,
                    "value": candidate["metrics"][metric_key],
                    "metrics": candidate["metrics"],
                    "params": candidate["params"],
                    "artifact_dir": candidate["artifact_dir"],
                    "best_weights": candidate["best_weights"],
                    "status": "informative_not_optuna_complete",
                    "tied_trials": tied_trials,
                }
        startup = int(out["context"].get("n_startup_trials") or 10)
        out["sampler_phase"] = "adaptive" if counts["complete"] >= startup else "startup"
        out["adaptive_decisions"] = max(0, counts["complete"] - startup)
        out["pruner_status"] = str(out["context"].get("pruner") or "not_recorded")
        if state.status == "idle":
            completed = [t for t in study.trials if t.state.name == "COMPLETE"]
            out["completed"] = len(completed)
            if completed:
                out["best_value"] = study.best_value
                out["status"] = "finished"
            elif study.trials and not any(
                _effective_state(t, dict(t.user_attrs or {}), study.study_name) in ("RUNNING", "WAITING")
                for t in study.trials
            ):
                out["status"] = "error"
                recovered_count = len(recovered_trials)
                suffix = (
                    f" {recovered_count} entraînement(s) terminé(s) ont toutefois été récupérés depuis leurs artefacts."
                    if recovered_count else ""
                )
                out["error_msg"] = "ÉCHEC HPO officiel — aucun trial COMPLETE, aucun best_params Optuna disponible." + suffix
    except Exception:
        pass
    return out


@router.get("/studies/{study_name}/logs")
def study_logs(study_name: str, from_index: int = 0):
    return StreamingResponse(
        stream_logs(study_name, from_index),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
