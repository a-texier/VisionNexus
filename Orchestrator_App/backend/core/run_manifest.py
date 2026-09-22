"""Manifeste canonique d'une execution Orchestrator.

Le manifeste est un index logique : les fichiers restent dans les workspaces des
sous-apps, mais chaque sortie est rattachee explicitement a un ``run_id``. Une
vue ne doit jamais chercher "le fichier le plus recent" pour completer ce document.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import WORKSPACE


RUNS_DIR = WORKSPACE / "runs"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _path(run_id: str) -> Path:
    return RUNS_DIR / run_id / "manifest.json"


def load(run_id: str) -> dict[str, Any] | None:
    path = _path(run_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def write(manifest: dict[str, Any]) -> dict[str, Any]:
    """Ecriture atomique pour ne jamais exposer un manifeste JSON partiel."""
    run_id = str(manifest.get("run_id") or "").strip()
    if not run_id:
        raise ValueError("run_id requis pour le manifeste")
    path = _path(run_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(manifest)
    payload.setdefault("schema_version", 1)
    payload.setdefault("created_at", _now())
    payload["updated_at"] = _now()
    tmp = path.with_suffix(f".json.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    return payload


def start(graph: dict[str, Any], run_id: str, pipeline_id: str, step_node_map: dict) -> dict:
    fork = graph.get("forked_from") or {}
    inherited_inputs = []
    if fork.get("run_id"):
        inherited_inputs.append({
            "kind": "fork_base",
            "state": "inherited_input",
            "source_run_id": fork.get("run_id"),
            "source_graph_id": fork.get("parent_graph_id"),
            "dataset": fork.get("dataset"),
            "git_commit": fork.get("git_commit"),
            "dvc_version": fork.get("dvc_version"),
        })
    return write({
        "schema_version": 1,
        "run_id": run_id,
        "graph_id": graph.get("graph_id"),
        "graph_name": graph.get("name"),
        "pipeline_id": pipeline_id,
        "parent_run_id": fork.get("run_id"),
        "status": "running",
        "step_node_map": step_node_map,
        "steps": [],
        "inputs": inherited_inputs,
        "outputs": [],
        "mlflow_run_ids": [],
        "optuna_attempt_ids": [],
        "dvc_commit": None,
    })


def finalize(
    graph: dict[str, Any],
    run_id: str,
    *,
    status: str,
    experiment: Any = None,
    artifacts: list[dict] | None = None,
    lineage: dict | None = None,
    optuna: list[dict] | None = None,
) -> dict:
    current = load(run_id) or {
        "run_id": run_id,
        "graph_id": graph.get("graph_id"),
        "graph_name": graph.get("name"),
        "parent_run_id": (graph.get("forked_from") or {}).get("run_id"),
    }
    steps = []
    if experiment:
        for step_id, record in experiment.steps.items():
            steps.append({"step_id": step_id, "status": record.status, "output": record.output})
    normalized_outputs = []
    for artifact in artifacts or []:
        item = dict(artifact)
        item.setdefault("artifact_id", f"{run_id}:{item.get('kind', 'artifact')}")
        item["run_id"] = run_id
        item.setdefault("state", "produced" if item.get("exists") else "planned")
        # Une sortie du run courant ne devient jamais implicitement une sortie du parent.
        item.setdefault("source_run_id", run_id if item.get("exists") else None)
        normalized_outputs.append(item)
    lin = lineage or {}
    current.update({
        "status": status,
        "steps": steps,
        "outputs": normalized_outputs,
        "mlflow_run_ids": lin.get("mlflow_run_ids") or [
            r.get("run_id") for r in lin.get("mlflow_runs", []) if isinstance(r, dict) and r.get("run_id")
        ],
        "optuna_attempt_ids": [
            s.get("attempt_id") or s.get("study_name") for s in (optuna or [])
            if s.get("attempt_id") or s.get("study_name")
        ],
        "dvc_commit": lin.get("git_commit"),
    })
    return write(current)
