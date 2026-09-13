# ============================================================
# core/optuna_runner.py
# Gestion des études Optuna + lancement d'optimisation en BG.
# ============================================================

import asyncio
import json
import logging
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import optuna

from backend.config import OPTUNA_STORAGE, LOGS_DIR
from backend.core.diagnostics import diagnose_failure

logger = logging.getLogger(__name__)


def _decoded_output(value: str | bytes | None) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value or ""

# Silence les logs Optuna par défaut (verbeux)
optuna.logging.set_verbosity(optuna.logging.WARNING)


# ------------------------------------------------------------------ #
# State                                                               #
# ------------------------------------------------------------------ #

@dataclass
class StudyRunState:
    status:     str = "idle"     # idle | running | finished | stopped | error
    n_trials:   int = 0
    completed:  int = 0
    best_value: float | None = None
    error_msg:  str | None = None
    logs:       list[str] = field(default_factory=list)
    _thread:    threading.Thread | None = field(default=None, repr=False)
    _stop_flag: bool = False

    def add_log(self, msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        self.logs.append(f"[{ts}] {msg}")
        if len(self.logs) > 500:
            self.logs = self.logs[-400:]


# Module-level state — survit aux navigations frontend
_study_states: dict[str, StudyRunState] = {}


def get_state(study_name: str) -> StudyRunState:
    if study_name not in _study_states:
        _study_states[study_name] = StudyRunState()
    return _study_states[study_name]


# ------------------------------------------------------------------ #
# Helpers Optuna                                                      #
# ------------------------------------------------------------------ #

def _get_storage() -> str:
    return OPTUNA_STORAGE


def _suggest_param(trial: optuna.Trial, param: dict) -> Any:
    """Applique trial.suggest_* selon la définition du paramètre."""
    name  = param["name"]
    ptype = param["type"]
    if ptype == "float":
        return trial.suggest_float(name, param["low"], param["high"],
                                   log=param.get("log", False))
    elif ptype == "int":
        return trial.suggest_int(name, param["low"], param["high"])
    elif ptype == "categorical":
        return trial.suggest_categorical(name, param["choices"])
    else:
        raise ValueError(f"Type de paramètre inconnu : {ptype}")


# ------------------------------------------------------------------ #
# Lancement optimisation en background                               #
# ------------------------------------------------------------------ #

def start_optimization(
    study_name: str,
    script_path: str,
    n_trials: int,
    metric_name: str,
    direction: str,
    param_space: list[dict],
) -> bool:
    """Lance l'optimisation dans un thread daemon. Retourne False si déjà en cours."""
    state = get_state(study_name)
    if state.status == "running":
        return False

    state.status    = "running"
    state.n_trials  = n_trials
    state.completed = 0
    state.best_value = None
    state.error_msg  = None
    state.logs       = []
    state._stop_flag = False
    state.add_log(f"Démarrage — {n_trials} trials, direction={direction}")

    def _run():
        try:
            storage = _get_storage()
            study = optuna.create_study(
                study_name=study_name,
                storage=storage,
                direction=direction,
                load_if_exists=True,
                sampler=optuna.samplers.TPESampler(),
                pruner=optuna.pruners.NopPruner(),
            )
            study.set_user_attr("source", "manual")
            study.set_user_attr("script_path", script_path)
            study.set_user_attr("metric", metric_name)
            study.set_user_attr("direction", direction)
            study.set_user_attr("param_space", param_space)
            study.set_user_attr("sampler", "TPESampler")
            study.set_user_attr("n_startup_trials", 10)
            study.set_user_attr("requested_n_trials", n_trials)
            study.set_user_attr("pruner", "disabled")
            study.set_user_attr("pruner_reason", "Le script manuel ne publie pas de métriques intermédiaires")
            state.add_log(f"Étude '{study_name}' chargée (storage SQLite)")

            def objective(trial: optuna.Trial) -> float:
                if state._stop_flag:
                    raise optuna.exceptions.TrialPruned()

                params = {p["name"]: _suggest_param(trial, p) for p in param_space}

                # Construire la commande : python script_path --param=val ...
                cmd = [sys.executable, script_path]
                for k, v in params.items():
                    cmd += [f"--{k}", str(v)]

                state.add_log(f"Trial {trial.number} : {json.dumps(params)}")

                try:
                    result = subprocess.run(
                        cmd, capture_output=True, text=True, encoding="utf-8",
                        errors="replace", timeout=3600,
                    )
                except subprocess.TimeoutExpired as exc:
                    diag = diagnose_failure(f"Trial timeout après {exc.timeout} secondes")
                    for key, value in diag.items():
                        trial.set_user_attr(f"failure_{key}", value)
                    state.add_log(f"  ÉCHEC [{diag['code']}] : {diag['title']}")
                    state.add_log(f"  Action : {diag['action']}")
                    raise RuntimeError(diag["title"]) from exc
                stdout = result.stdout or ""
                stderr = result.stderr or ""
                if result.returncode != 0:
                    diag = diagnose_failure(stderr or stdout or f"Exit code {result.returncode}")
                    for key, value in diag.items():
                        trial.set_user_attr(f"failure_{key}", value)
                    trial.set_user_attr("return_code", result.returncode)
                    state.add_log(f"  ÉCHEC [{diag['code']}] : {diag['title']}")
                    state.add_log(f"  Cause : {diag['reason'][-500:]}")
                    state.add_log(f"  Action : {diag['action']}")
                    raise RuntimeError(diag["title"])

                # Le script doit imprimer la valeur de la métrique sur la dernière ligne
                output = stdout.strip()
                if not output:
                    raise ValueError("Le script n'a rien retourné sur stdout")

                last_line = output.split("\n")[-1].strip()
                try:
                    value = float(last_line)
                except ValueError:
                    # Chercher metric_name=value dans l'output
                    for line in output.split("\n"):
                        if f"{metric_name}=" in line:
                            value = float(line.split("=")[-1].strip())
                            break
                    else:
                        diag = diagnose_failure(f"Impossible de parser la valeur : {last_line!r}")
                        for key, value in diag.items():
                            trial.set_user_attr(f"failure_{key}", value)
                        raise RuntimeError(diag["title"])

                state.add_log(f"  {metric_name} = {value:.6f}")
                state.completed += 1
                # IMPORTANT : study.best_trial LÈVE (ValueError / "Record does not
                # exist.") tant qu'aucun trial n'est COMPLETE — le trial courant ne
                # l'est pas encore ici. L'ancien code faisait échouer le 1er trial
                # et toute l'étude. (Bug corrigé lors du test complet Fable 2026-07.)
                try:
                    state.best_value = study.best_value
                except Exception:
                    state.best_value = value
                return value

            study.optimize(
                objective,
                n_trials=n_trials,
                callbacks=[lambda study, trial: None],
                catch=(RuntimeError,),
            )

            if state._stop_flag:
                state.status = "stopped"
                state.add_log("Optimisation arrêtée par l'utilisateur")
            else:
                completed = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
                if not completed:
                    state.status = "error"
                    state.error_msg = "Aucun trial n'a abouti"
                    state.add_log("ÉCHEC DE L'ÉTUDE — 0 trial COMPLETE, aucun best_params disponible")
                else:
                    state.status = "finished"
                    state.best_value = study.best_value
                    state.add_log(
                        f"Terminé — meilleure valeur : {study.best_value:.6f} "
                        f"(trial {study.best_trial.number})"
                    )

        except Exception as exc:
            state.status    = "error"
            state.error_msg = str(exc)
            state.add_log(f"ERREUR : {exc}")
            logger.exception("Optimisation Optuna échouée pour '%s'", study_name)

    t = threading.Thread(target=_run, daemon=True, name=f"optuna-{study_name}")
    state._thread = t
    t.start()
    return True


def stop_optimization(study_name: str) -> bool:
    state = get_state(study_name)
    if state.status != "running":
        return False
    state._stop_flag = True
    state.add_log("Signal d'arrêt envoyé…")
    return True


# ------------------------------------------------------------------ #
# SSE log generator                                                   #
# ------------------------------------------------------------------ #

async def stream_logs(study_name: str, from_index: int = 0):
    """Générateur SSE pour les logs d'une étude en cours."""
    import json as _json

    state = get_state(study_name)
    cursor = from_index

    while True:
        new_lines = state.logs[cursor:]
        for line in new_lines:
            yield f"data: {_json.dumps({'type': 'log', 'line': line})}\n\n"
            cursor += 1
        await asyncio.sleep(0)

        status_event = {
            "type":       "status",
            "status":     state.status,
            "completed":  state.completed,
            "n_trials":   state.n_trials,
            "best_value": state.best_value,
        }
        yield f"data: {_json.dumps(status_event)}\n\n"

        if state.status in ("finished", "stopped", "error"):
            yield f"data: {_json.dumps({'type': 'done'})}\n\n"
            break

        await asyncio.sleep(1)
