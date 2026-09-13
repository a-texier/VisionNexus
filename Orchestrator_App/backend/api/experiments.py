# ============================================================
# api/experiments.py
# CRUD expériences + resume human-in-the-loop.
# ============================================================

from fastapi import APIRouter, HTTPException

from backend.core import experiment_store, pipeline_runner

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


@router.get("")
def list_experiments():
    return experiment_store.list_experiments()


@router.get("/{experiment_id}")
def get_experiment(experiment_id: str):
    exp = experiment_store.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(404, "Expérience introuvable")
    return exp


@router.post("/{experiment_id}/resume", status_code=202)
async def resume_experiment(experiment_id: str):
    exp = experiment_store.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(404, "Expérience introuvable")
    if exp.status != "waiting":
        raise HTTPException(400, f"L'expérience n'est pas en attente (status={exp.status})")

    ok = await pipeline_runner.resume_run(exp.run_id)
    if not ok:
        raise HTTPException(409, "Run introuvable en mémoire ou déjà terminé")

    return {"ok": True, "run_id": exp.run_id, "experiment_id": experiment_id}


@router.delete("/{experiment_id}", status_code=204)
def delete_experiment(experiment_id: str):
    data = experiment_store._load()
    if experiment_id not in data:
        raise HTTPException(404, "Expérience introuvable")
    del data[experiment_id]
    experiment_store._save(data)


@router.post("/{experiment_id}/restart", status_code=202)
async def restart_experiment(experiment_id: str):
    """Relance un run pour le même pipeline que cette expérience."""
    from backend.core.pipeline_store import get_pipeline
    exp = experiment_store.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(404, "Expérience introuvable")
    pipeline = get_pipeline(exp.pipeline_id)
    if not pipeline:
        raise HTTPException(404, f"Pipeline {exp.pipeline_id} introuvable")
    run_id = await pipeline_runner.start_run(pipeline)
    return {"ok": True, "run_id": run_id, "pipeline_id": pipeline.id}
