# ============================================================
# core/experiment_store.py
# Persistance des expériences (human-in-the-loop + tracking).
# Stockage : WORKSPACE/experiments.json
# ============================================================

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from backend.config import EXPERIMENTS_FILE


# ------------------------------------------------------------------ #
# Modèles                                                             #
# ------------------------------------------------------------------ #

class StepRecord(BaseModel):
    status: str = "pending"   # pending|running|success|failed|waiting
    output: dict = Field(default_factory=dict)


class Experiment(BaseModel):
    experiment_id: str
    pipeline_id: str
    run_id: str
    status: str = "running"   # running|waiting|done|failed
    current_step: str = ""
    steps: dict[str, StepRecord] = Field(default_factory=dict)
    artifacts: dict[str, str] = Field(default_factory=dict)
    metrics: dict[str, float] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ------------------------------------------------------------------ #
# I/O bas niveau                                                      #
# ------------------------------------------------------------------ #

def _load() -> dict[str, dict]:
    if not EXPERIMENTS_FILE.exists():
        return {}
    try:
        return json.loads(EXPERIMENTS_FILE.read_text("utf-8"))
    except Exception:
        return {}


def _save(data: dict[str, dict]) -> None:
    EXPERIMENTS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ #
# API publique                                                        #
# ------------------------------------------------------------------ #

def create_experiment(pipeline_id: str, run_id: str, step_ids: list[str]) -> Experiment:
    exp = Experiment(
        experiment_id=str(uuid.uuid4())[:8],
        pipeline_id=pipeline_id,
        run_id=run_id,
        steps={sid: StepRecord() for sid in step_ids},
    )
    data = _load()
    data[exp.experiment_id] = exp.model_dump()
    _save(data)
    return exp


def get_experiment(experiment_id: str) -> Optional[Experiment]:
    data = _load()
    raw = data.get(experiment_id)
    if not raw:
        return None
    return Experiment(**raw)


def get_experiment_by_run(run_id: str) -> Optional[Experiment]:
    for exp in list_experiments():
        if exp.run_id == run_id:
            return exp
    return None


def list_experiments() -> list[Experiment]:
    data = _load()
    result = []
    for raw in data.values():
        try:
            result.append(Experiment(**raw))
        except Exception:
            pass
    result.sort(key=lambda e: e.created_at, reverse=True)
    return result


def update_step(experiment_id: str, step_id: str, status: str, output: dict) -> None:
    data = _load()
    raw = data.get(experiment_id)
    if not raw:
        return
    raw.setdefault("steps", {})[step_id] = {"status": status, "output": output}
    raw["current_step"] = step_id
    raw["updated_at"] = _now()
    _save(data)


def set_waiting(experiment_id: str, step_id: str) -> None:
    data = _load()
    raw = data.get(experiment_id)
    if not raw:
        return
    raw["status"] = "waiting"
    raw["current_step"] = step_id
    raw.setdefault("steps", {})[step_id] = {"status": "waiting", "output": {}}
    raw["updated_at"] = _now()
    _save(data)


def complete_experiment(experiment_id: str, status: str = "done") -> None:
    data = _load()
    raw = data.get(experiment_id)
    if not raw:
        return
    raw["status"] = status
    raw["updated_at"] = _now()
    _save(data)


def interrupt_experiment(run_id: str, reason: str = "Exécution interrompue") -> Optional[Experiment]:
    """Finalise proprement une expérience perdue ou arrêtée.

    Les étapes déjà terminées restent intactes. Seules les étapes réellement en
    vol passent à ``interrupted`` ; les étapes futures restent ``pending`` afin
    que l'UI distingue ce qui a échoué de ce qui n'a jamais été exécuté.
    """
    data = _load()
    for experiment_id, raw in data.items():
        if raw.get("run_id") != run_id:
            continue
        for step in (raw.get("steps") or {}).values():
            if step.get("status") in ("running", "waiting"):
                step["status"] = "interrupted"
                step["output"] = {"error": reason, "interrupted": True}
        raw["status"] = "interrupted"
        raw["updated_at"] = _now()
        _save(data)
        return Experiment(**raw)
    return None


def update_metrics(experiment_id: str, metrics: dict[str, float]) -> None:
    data = _load()
    raw = data.get(experiment_id)
    if not raw:
        return
    raw.setdefault("metrics", {}).update(metrics)
    raw["updated_at"] = _now()
    _save(data)


def update_artifacts(experiment_id: str, artifacts: dict[str, str]) -> None:
    data = _load()
    raw = data.get(experiment_id)
    if not raw:
        return
    raw.setdefault("artifacts", {}).update(artifacts)
    raw["updated_at"] = _now()
    _save(data)
