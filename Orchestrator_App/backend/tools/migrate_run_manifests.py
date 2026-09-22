r"""Migre les anciens Insights vers des manifestes stricts par run.

Cet outil travaille hors ligne : il ne contacte aucune sous-application. Il
filtre uniquement les objets déjà présents dont l'identité ``run_id`` est
prouvée, reconstruit les snapshots et laisse les fichiers physiques en place.

Usage::

    set ORCHESTRATOR_WORKSPACE=C:\...\orchestrator_bob
    python -m backend.tools.migrate_run_manifests
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from backend.config import WORKSPACE
from backend.core import experiment_store, graph_store, insights, run_manifest


def _training_names(experiment) -> set[str]:
    names: set[str] = set()
    for step_id, record in experiment.steps.items():
        if not step_id.endswith("__train"):
            continue
        output = record.output if isinstance(record.output, dict) else {}
        match = re.search(r'"run_name"\s*:\s*"([^"]+)"', str(output.get("output", "")))
        if match:
            names.add(match.group(1))
    return names


def _status(experiment) -> str:
    if experiment.status == "done":
        return "done"
    states = {record.status for record in experiment.steps.values()}
    if states & {"running", "waiting"}:
        return "interrupted"
    if states & {"failed", "error"}:
        return "failed"
    return str(experiment.status or "idle")


def _dataset_from_artifacts(artifacts: list[dict]) -> str | None:
    for artifact in artifacts:
        if artifact.get("kind") != "dataset" or not artifact.get("exists"):
            continue
        path = artifact.get("path")
        if path:
            return Path(path).stem
    return None


def _map50(runs: list[dict]):
    for run in runs:
        metrics = run.get("metrics") or {}
        for key in ("final_mAP50", "metrics/mAP50B", "mAP50"):
            if metrics.get(key) is not None:
                return metrics[key]
    return None


def _optuna_studies(run_id: str, fallback: list[dict]) -> list[dict]:
    """Lit la DB locale si Optuna est disponible, sinon garde le snapshot filtré."""
    db_path = WORKSPACE / "optuna_bob" / "optuna.db"
    if not db_path.exists():
        return fallback
    try:
        import optuna

        storage = f"sqlite:///{db_path.as_posix()}"
        result = []
        for summary in optuna.study.get_all_study_summaries(storage=storage):
            study = optuna.load_study(study_name=summary.study_name, storage=storage)
            attrs = dict(study.user_attrs or {})
            if str(attrs.get("run_id") or "") != run_id:
                continue
            counts = {"complete": 0, "failed": 0, "pruned": 0, "running": 0, "waiting": 0, "interrupted": 0}
            trials = []
            for trial in study.trials:
                trial_attrs = dict(trial.user_attrs or {})
                effective = "INTERRUPTED" if trial_attrs.get("execution_state") == "interrupted" else trial.state.name
                key = "interrupted" if effective == "INTERRUPTED" else {"FAIL": "failed"}.get(trial.state.name, trial.state.name.lower())
                if key in counts:
                    counts[key] += 1
                trials.append({
                    "number": trial.number,
                    "state": trial.state.name,
                    "effective_state": effective,
                    "value": trial.value,
                    "params": dict(trial.params),
                    "datetime_start": trial.datetime_start.isoformat() if trial.datetime_start else None,
                    "datetime_complete": trial.datetime_complete.isoformat() if trial.datetime_complete else None,
                    "failure_code": trial_attrs.get("failure_code"),
                    "failure_title": trial_attrs.get("failure_title"),
                    "failure_reason": trial_attrs.get("failure_reason"),
                    "failure_action": trial_attrs.get("failure_action"),
                    "return_code": trial_attrs.get("return_code"),
                })
            complete = [trial for trial in study.trials if trial.state.name == "COMPLETE"]
            result.append({
                "study_id": getattr(summary, "study_id", getattr(summary, "_study_id", None)),
                "study_name": study.study_name,
                "direction": study.direction.name,
                "n_trials": len(study.trials),
                "best_value": study.best_value if complete else None,
                "datetime_start": summary.datetime_start.isoformat() if summary.datetime_start else None,
                "status": "finished" if complete else "error",
                "counts": counts,
                **attrs,
                "trials": trials,
            })
        return result
    except Exception:
        return fallback


def _repair_bundle(graph: dict, experiment, bundle: dict) -> dict:
    run_id = experiment.run_id
    graph_id = graph["graph_id"]
    status = _status(experiment)
    names = _training_names(experiment)

    bundle["graph_status"] = status
    bundle["trainings"] = [t for t in bundle.get("trainings", []) if t.get("run_name") in names]
    filtered_optuna = [
        study for study in bundle.get("optuna", [])
        if str(study.get("run_id") or "") == run_id
        or (not study.get("run_id") and str(study.get("study_name") or "").startswith(f"{graph_id}__"))
    ]
    bundle["optuna"] = _optuna_studies(run_id, filtered_optuna)
    mlflow_runs = [
        run for run in (bundle.get("mlflow") or {}).get("runs", [])
        if str((run.get("tags") or {}).get("orch_run_id") or "") == run_id
    ]
    experiment_ids = {str(run.get("experiment_id")) for run in mlflow_runs}
    mlflow_experiments = [
        item for item in (bundle.get("mlflow") or {}).get("experiments", [])
        if str(item.get("experiment_id") if item.get("experiment_id") is not None else item.get("id")) in experiment_ids
    ]
    bundle["mlflow"] = {"experiments": mlflow_experiments, "runs": mlflow_runs}
    dvc_commits = [
        commit for commit in (bundle.get("dvc") or {}).get("commits", [])
        if str((commit.get("lineage") or {}).get("run_id") or "") == run_id
    ]
    bundle["dvc"] = {"commits": dvc_commits}

    for node in bundle.get("nodes", []):
        if status == "interrupted" and node.get("status") in {"running", "waiting"}:
            node["status"] = "interrupted"
    for step in bundle.get("steps", []):
        if status == "interrupted" and step.get("status") in {"running", "waiting"}:
            step["status"] = "interrupted"

    artifacts = bundle.get("artifacts") or []
    lineage = dict(bundle.get("lineage") or {})
    lineage.update({
        "run_id": run_id,
        "git_commit": (dvc_commits[0].get("short") if dvc_commits else None),
        "dataset": _dataset_from_artifacts(artifacts),
        "dvc_version": None if not dvc_commits else lineage.get("dvc_version"),
        "model_path": next((
            (training.get("status") or {}).get("best_model_path")
            for training in bundle["trainings"]
            if (training.get("status") or {}).get("best_model_path")
        ), None),
        "map50": _map50(mlflow_runs),
        "mlflow_runs": mlflow_runs,
        "committed_at": None if not dvc_commits else lineage.get("committed_at"),
    })
    bundle["lineage"] = lineage
    return bundle


def migrate() -> list[dict]:
    migrated: list[dict] = []
    for graph in graph_store.list_graphs():
        graph_id = graph.get("graph_id")
        if not graph_id:
            continue
        for experiment in experiment_store.list_experiments():
            if experiment.pipeline_id != f"graph__{graph_id}":
                continue
            bundle = insights.load(graph_id, experiment.run_id)
            if not bundle:
                continue
            bundle = _repair_bundle(graph, experiment, bundle)
            out_dir = WORKSPACE / "insights" / graph_id / experiment.run_id
            # Les anciens plots pouvaient eux aussi représenter un autre run.
            for path in out_dir.glob("*.png"):
                path.unlink()
            plots = insights._make_plots(bundle, out_dir)
            bundle["plots"] = plots
            bundle["analysis_plots"] = []
            (out_dir / "insights.json").write_text(
                json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            (out_dir / "metrics.json").write_text(
                json.dumps(insights._stable_metrics(bundle), ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            (out_dir / "insights.md").write_text(
                insights._make_markdown(bundle, plots), encoding="utf-8"
            )

            step_map = {step_id: step_id.split("__", 1)[0] for step_id in experiment.steps}
            if not run_manifest.load(experiment.run_id):
                run_manifest.start(graph, experiment.run_id, experiment.pipeline_id, step_map)
            manifest = run_manifest.finalize(
                graph,
                experiment.run_id,
                status=_status(experiment),
                experiment=experiment,
                artifacts=bundle.get("artifacts") or [],
                lineage=bundle.get("lineage") or {},
                optuna=bundle.get("optuna") or [],
            )
            migrated.append({
                "graph_id": graph_id,
                "run_id": experiment.run_id,
                "status": manifest["status"],
                "outputs": len(manifest.get("outputs") or []),
                "mlflow_runs": len(manifest.get("mlflow_run_ids") or []),
                "optuna_attempts": len(manifest.get("optuna_attempt_ids") or []),
            })
    return migrated


if __name__ == "__main__":
    print(json.dumps(migrate(), ensure_ascii=False, indent=2))
