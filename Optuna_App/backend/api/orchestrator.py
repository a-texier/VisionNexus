# ============================================================
# api/orchestrator.py
# Endpoint HPO piloté par l'Orchestrateur : lance une étude Optuna
# (TPE, pruning désactivé tant qu'il n'existe pas de métriques par epoch)
# qui entraîne un modèle par trial, avec le moteur demandé (Training_App),
# et renvoie les meilleurs hyperparamètres (best_params) — fusionnés
# ensuite dans le nœud Training aval.
# ============================================================

import json
import logging
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

import optuna
from fastapi import APIRouter
from pydantic import BaseModel

from backend.config import OPTUNA_STORAGE, WORKSPACE
from backend.core.diagnostics import diagnose_failure

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

_TRIAL_SCRIPT = str(Path(__file__).resolve().parent.parent / "hpo_trial.py")
ACTIVE_HPO_STUDIES: set[str] = set()


def _decoded_output(value: str | bytes | None) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value or ""

# Moteurs de Training_App (catalogues : plages HPO, cles, tailles), importes
# via sys.path comme le fait hpo_trial.py.
_TRAINING_APP_BACKEND = Path(__file__).resolve().parents[3] / "Training_App" / "backend"


def engine_catalog(engine: str) -> dict:
    """Catalogue du moteur ; RuntimeError si Training_App ou le moteur manque."""
    if str(_TRAINING_APP_BACKEND) not in sys.path:
        sys.path.insert(0, str(_TRAINING_APP_BACKEND))
    try:
        from services import trainer_backend
    except ImportError as exc:
        raise RuntimeError(f"Training_App introuvable ({_TRAINING_APP_BACKEND}) : {exc}") from exc
    return trainer_backend.engine_catalog(engine)


def describe_engines() -> list[dict]:
    if str(_TRAINING_APP_BACKEND) not in sys.path:
        sys.path.insert(0, str(_TRAINING_APP_BACKEND))
    from services import trainer_backend

    return trainer_backend.describe_backends(with_catalog=True)


class HpoRequest(BaseModel):
    dataset_path: str = ""                 # dossier dataset YOLO (data.yaml auto-détecté)
    data_yaml:    str = ""                 # ou chemin data.yaml explicite
    optimize:     list[str] = []                 # vide = hpo_default_optimize du moteur
    n_trials:     int = 20
    direction:    str = "maximize"
    metric:       str = "map50"            # map50 | map5095
    engine:       str = "yolox"               # moteur des trials = moteur du Training aval
    model_size:   str = ""                    # vide = taille par defaut du moteur
    epochs:       int = 10                 # epochs par trial (léger)
    trace:        dict[str, Any] | None = None
    stop_on_failure: bool = True           # sinon Training continue avec ses defaults
    workers: int | None = None           # défaut sûr: 0 Windows, 2 ailleurs
    trial_timeout_s: int = 1200             # borne anti-gel par trial (20 min)


def _resolve_data_yaml(dataset_path: str, data_yaml: str) -> str:
    """Localise le data.yaml. yolox_dataset.load_data_yaml resout deja
    ``path:`` relatif au dossier du yaml lui-meme, donc aucune reecriture
    n'est necessaire ici (contrairement a l'ancien contournement Ultralytics,
    qui resolvait path: depuis le cwd du serveur)."""
    if data_yaml and Path(data_yaml).exists():
        return str(Path(data_yaml))
    dp = Path(dataset_path)
    # 1. dataset_path est un dossier deja extrait
    if dp.is_dir():
        cand = dp / "data.yaml"
        if cand.exists():
            return str(cand)
        found = list(dp.rglob("data.yaml"))
        if found:
            return str(found[0])
    # 2. Les exports Annotation sont des .zip : l'orchestrateur passe le dossier
    #    logique SANS suffixe alors que seul {path}.zip existe sur disque. On extrait
    #    une fois (meme logique que Training_App/routers/orchestrator.py) puis on
    #    cherche le data.yaml -- sans ca, l'HPO echouait "data.yaml introuvable" la
    #    ou le Training aval, lui, savait deja gerer le zip (best_params jamais
    #    produits, node Optuna vide, artefact DVC non versionnable).
    zip_path = dp if dp.suffix == ".zip" else Path(str(dp) + ".zip")
    if zip_path.exists():
        extract_dir = WORKSPACE / "hpo_datasets" / zip_path.stem
        if not extract_dir.exists():
            extract_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                zf.extractall(extract_dir)
        found = list(extract_dir.rglob("data.yaml"))
        if found:
            return str(found[0])
    # 3. Fallback : rglob sur le chemin original s'il existe partiellement
    if dp.exists():
        found = list(dp.rglob("data.yaml"))
        if found:
            return str(found[0])
    return ""


def _suggest(trial: optuna.Trial, name: str, spec: dict):
    if spec["type"] == "float":
        return trial.suggest_float(name, spec["low"], spec["high"], log=spec.get("log", False))
    if spec["type"] == "int":
        return trial.suggest_int(name, spec["low"], spec["high"])
    return trial.suggest_categorical(name, spec["choices"])


@router.get("/engines")
def engines():
    """Moteurs utilisables par les trials, avec leurs plages HPO par defaut.

    `trial_script` et `runs_dir` permettent a l'UI de preremplir une etude
    manuelle qui entraine un de ces moteurs (hpo_trial.py).
    """
    base = {"trial_script": _TRIAL_SCRIPT, "runs_dir": str(WORKSPACE / "hpo_runs")}
    try:
        return {"engines": describe_engines(), **base}
    except Exception as exc:  # Training_App absent d'un deploiement partiel
        return {"engines": [], "error": str(exc), **base}


@router.post("/hpo")
def run_hpo(body: HpoRequest):
    """Lance une étude Optuna BLOQUANTE (TPE) et renvoie les best params.

    Chaque trial entraîne un modèle (moteur ``engine``) via hpo_trial.py sur
    le dataset dérivé de l'annotation amont. Renvoie ``best_params`` (fusionné
    dans le Training aval, qui doit utiliser le même moteur).
    """
    def preparation_failure(message: str, action: str) -> dict:
        """Applique aussi la politique du nœud aux erreurs avant le 1er trial."""
        return {
            "ok": not body.stop_on_failure,
            "hpo_succeeded": False,
            "error": f"ÉCHEC HPO — {message}",
            "warning": ("Training autorisé avec les paramètres configurés dans son nœud."
                        if not body.stop_on_failure else "Pipeline arrêté avant Training."),
            "failure_reason": message,
            "failure_action": action,
            "best_params": {},
            "best_value": None,
            "n_trials": 0,
            "fallback_to_training_defaults": not body.stop_on_failure,
        }

    data_yaml = _resolve_data_yaml(body.dataset_path, body.data_yaml)
    if not data_yaml:
        return preparation_failure(
            f"data.yaml introuvable pour dataset_path={body.dataset_path!r}.",
            "Sélectionnez le dataset YOLO exporté par Annotation, puis vérifiez data.yaml et ses chemins path/train/val.",
        )

    try:
        catalog = engine_catalog(body.engine)
    except Exception as exc:
        return preparation_failure(
            f"moteur d'entrainement {body.engine!r} indisponible : {exc}",
            "Choisissez un moteur listé par GET /api/orchestrator/engines, ou installez sa bibliothèque.",
        )
    ranges: dict[str, dict] = catalog["hpo_ranges"]
    optimize = body.optimize or list(catalog["hpo_default_optimize"])
    space = {k: ranges[k] for k in optimize if k in ranges}
    if not space:
        return preparation_failure(
            f"aucun hyperparamètre du moteur {body.engine!r} dans la sélection {optimize!r}.",
            f"Choisissez au moins un paramètre supporté : {', '.join(ranges)}.",
        )
    model_size = body.model_size or catalog["default_size"]

    _t = body.trace or {}
    attempt_id = uuid.uuid4().hex[:8]
    # Un attempt est immuable. Une reprise doit être un choix explicite et ne
    # doit jamais ajouter silencieusement des trials a un ancien run.
    if _t.get("graph_id") and _t.get("run_id"):
        study_name = "__".join(filter(None, [
            str(_t.get("graph_id")), str(_t.get("run_id")),
            str(_t.get("node_id") or "hpo"), attempt_id,
        ]))
    else:
        study_name = f"hpo_{Path(data_yaml).parent.name}__{attempt_id}"

    study = optuna.create_study(
        study_name=study_name, storage=OPTUNA_STORAGE,
        direction=body.direction, load_if_exists=False,
        sampler=optuna.samplers.TPESampler(),
        # Pas de faux pruning : le child ne publie pas encore de métriques par
        # epoch. Un pruner sans trial.report/should_prune est purement décoratif.
        pruner=optuna.pruners.NopPruner(),
    )
    study.set_user_attr("source", "orchestrator")
    study.set_user_attr("graph_id", _t.get("graph_id"))
    study.set_user_attr("run_id", _t.get("run_id"))
    study.set_user_attr("node_id", _t.get("node_id"))
    study.set_user_attr("node_label", _t.get("node_label"))
    study.set_user_attr("attempt_id", attempt_id)
    study.set_user_attr("dataset_path", body.dataset_path)
    study.set_user_attr("data_yaml", data_yaml)
    study.set_user_attr("metric", body.metric)
    study.set_user_attr("direction", body.direction)
    study.set_user_attr("optimize", list(space))
    study.set_user_attr("engine", body.engine)
    study.set_user_attr("model_size", model_size)
    study.set_user_attr("stop_on_failure", body.stop_on_failure)
    study.set_user_attr("sampler", "TPESampler")
    study.set_user_attr("n_startup_trials", 10)
    study.set_user_attr("requested_n_trials", body.n_trials)
    effective_workers = body.workers if body.workers is not None else (0 if sys.platform.startswith("win") else 2)
    study.set_user_attr("workers", effective_workers)
    study.set_user_attr("trial_timeout_s", body.trial_timeout_s)
    study.set_user_attr("pruner", "disabled")
    study.set_user_attr("pruner_reason", "Aucune métrique intermédiaire publiée par epoch")

    def objective(trial: optuna.Trial) -> float:
        params = {name: _suggest(trial, name, spec) for name, spec in space.items()}
        trial_dir = WORKSPACE / "hpo_runs" / study_name / f"trial_{trial.number:04d}"
        trial_dir.mkdir(parents=True, exist_ok=True)
        result_json = trial_dir / "result.json"
        stdout_log = trial_dir / "stdout.log"
        stderr_log = trial_dir / "stderr.log"
        cmd = [sys.executable, _TRIAL_SCRIPT, "--data_yaml", data_yaml,
               "--engine", body.engine, "--model_size", model_size,
               "--epochs", str(body.epochs), "--metric", body.metric,
               "--result_json", str(result_json), "--trial_dir", str(trial_dir),
               "--workers", str(effective_workers)]
        for k, v in params.items():
            cmd += [f"--{k}", str(v)]
        trial.set_user_attr("attempt_id", attempt_id)
        trial.set_user_attr("graph_id", _t.get("graph_id"))
        trial.set_user_attr("run_id", _t.get("run_id"))
        trial.set_user_attr("node_id", _t.get("node_id"))
        trial.set_user_attr("command", cmd)
        trial.set_user_attr("cwd", str(Path(_TRIAL_SCRIPT).parent))
        trial.set_user_attr("data_yaml", data_yaml)
        trial.set_user_attr("result_json", str(result_json))
        trial.set_user_attr("stdout_log", str(stdout_log))
        trial.set_user_attr("stderr_log", str(stderr_log))
        try:
            # Encodage explicite : Windows ne doit jamais retomber sur CP1252 et
            # perdre stdout à cause d'un octet émis par Ultralytics/progress bars.
            r = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=max(60, body.trial_timeout_s),
            )
        except subprocess.TimeoutExpired as exc:
            stdout_log.write_text(_decoded_output(exc.stdout), encoding="utf-8")
            stderr_log.write_text(_decoded_output(exc.stderr), encoding="utf-8")
            diag = diagnose_failure(f"Trial timeout après {exc.timeout} secondes")
            for key, value in diag.items():
                trial.set_user_attr(f"failure_{key}", value)
            raise RuntimeError(diag["title"]) from exc
        stdout = r.stdout or ""
        stderr = r.stderr or ""
        stdout_log.write_text(stdout, encoding="utf-8")
        stderr_log.write_text(stderr, encoding="utf-8")
        trial.set_user_attr("return_code", r.returncode)
        if r.returncode != 0:
            diag = diagnose_failure(stderr or stdout or f"Exit code {r.returncode}")
            for key, value in diag.items():
                trial.set_user_attr(f"failure_{key}", value)
            trial.set_user_attr("return_code", r.returncode)
            logger.warning("trial %s échoué [%s]: %s", trial.number, diag["code"], diag["reason"][-1200:])
            raise RuntimeError(diag["title"])
        try:
            payload = json.loads(result_json.read_text(encoding="utf-8"))
            if payload.get("status") != "completed":
                raise ValueError(payload.get("error") or f"statut résultat={payload.get('status')}")
            value = float(payload["objective_value"])
            trial.set_user_attr("metric_source", "result_json")
            trial.set_user_attr("artifact_dir", payload.get("artifact_dir"))
            trial.set_user_attr("results_csv", payload.get("results_csv"))
            trial.set_user_attr("best_weights", payload.get("best_weights"))
            trial.set_user_attr("metrics", payload.get("metrics") or {})
            return value
        except Exception as exc:
            diag = diagnose_failure(
                f"Résultat JSON absent ou invalide ({result_json}): {exc}. "
                f"Dernière sortie: {stdout[-1200:]}"
            )
            for key, value in diag.items():
                trial.set_user_attr(f"failure_{key}", value)
            raise RuntimeError(diag["title"]) from exc

    try:
        ACTIVE_HPO_STUDIES.add(study_name)
        study.optimize(objective, n_trials=body.n_trials, catch=(RuntimeError,))
    except Exception as exc:
        logger.exception("étude HPO échouée")
        return {"ok": False, "error": str(exc), "study_name": study_name, "attempt_id": attempt_id}
    finally:
        ACTIVE_HPO_STUDIES.discard(study_name)

    try:
        best_params = dict(study.best_params)
        best_value = float(study.best_value)
    except Exception:
        best_params, best_value = {}, None

    completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    if not completed or not best_params or best_value is None:
        failures = [{"trial": t.number, **{k.removeprefix("failure_"): v for k, v in t.user_attrs.items() if k.startswith("failure_")}}
                    for t in study.trials if t.state == optuna.trial.TrialState.FAIL]
        first = failures[-1] if failures else {}
        payload = {
            "ok": not body.stop_on_failure,
            "hpo_succeeded": False,
            "error": "ÉCHEC HPO — aucun trial Optuna n'a abouti. Aucun best_params produit.",
            "warning": ("Training autorisé avec ses paramètres configurés/défauts."
                        if not body.stop_on_failure else "Pipeline arrêté avant Training."),
            "study_name": study_name,
            "attempt_id": attempt_id,
            "best_params": {},
            "best_value": None,
            "metric": body.metric,
            "n_trials": len(study.trials),
            "failed_trials": failures,
            "failure_reason": first.get("reason"),
            "failure_action": first.get("action"),
            "fallback_to_training_defaults": not body.stop_on_failure,
        }
        return payload

    logger.info("HPO '%s' terminé : best=%s (%s)", study_name, best_params, best_value)
    return {
        "ok": True,
        "hpo_succeeded": True,
        "study_name": study_name,
        "attempt_id": attempt_id,
        "best_params": best_params,   # <- résolu par l'orchestrateur -> Training aval
        "engine": body.engine,
        "best_value": best_value,
        "metric": body.metric,
        "n_trials": len(study.trials),
        "failed_trials": len([t for t in study.trials if t.state == optuna.trial.TrialState.FAIL]),
        "fallback_to_training_defaults": False,
    }
