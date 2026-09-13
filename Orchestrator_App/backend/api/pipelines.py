# ============================================================
# api/pipelines.py
# CRUD pipelines + démarrage et streaming des exécutions.
# ============================================================

import json
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.core import pipeline_store, pipeline_runner

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])


# ------------------------------------------------------------------ #
# Schemas                                                             #
# ------------------------------------------------------------------ #

class PipelineBody(BaseModel):
    name: str
    steps: list[dict] = Field(default_factory=list)


# ------------------------------------------------------------------ #
# CRUD                                                                #
# ------------------------------------------------------------------ #

@router.get("")
def list_pipelines():
    return pipeline_store.list_pipelines()


@router.post("", status_code=201)
def create_pipeline(body: PipelineBody):
    try:
        return pipeline_store.create_pipeline(body.name, body.steps)
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.get("/{pid}")
def get_pipeline(pid: str):
    p = pipeline_store.get_pipeline(pid)
    if not p:
        raise HTTPException(404, "Pipeline introuvable")
    return p


@router.put("/{pid}")
def update_pipeline(pid: str, body: PipelineBody):
    p = pipeline_store.update_pipeline(pid, body.name, body.steps)
    if not p:
        raise HTTPException(404, "Pipeline introuvable")
    return p


@router.delete("/{pid}")
def delete_pipeline(pid: str):
    if not pipeline_store.delete_pipeline(pid):
        raise HTTPException(404, "Pipeline introuvable")
    return {"ok": True}


# ------------------------------------------------------------------ #
# Exécution                                                           #
# ------------------------------------------------------------------ #

@router.post("/{pid}/run", status_code=202)
async def start_run(pid: str):
    p = pipeline_store.get_pipeline(pid)
    if not p:
        raise HTTPException(404, "Pipeline introuvable")
    if not p.steps:
        raise HTTPException(400, "Ce pipeline n'a pas d'étapes")
    run_id = await pipeline_runner.start_run(p)
    return {"run_id": run_id, "pipeline_id": pid}


@router.get("/{pid}/run/{run_id}/stream")
async def stream_run(pid: str, run_id: str):
    async def generator():
        async for event in pipeline_runner.stream_events(run_id):
            yield f"data: {json.dumps(event)}\n\n"
        # Ensure the stream closes cleanly
        yield "data: {\"type\":\"end\"}\n\n"

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{pid}/status/{run_id}")
def get_run_status(pid: str, run_id: str):
    state = pipeline_runner.get_run_state(run_id)
    if not state:
        raise HTTPException(404, "Exécution introuvable")
    elapsed = round(time.monotonic() - state.started_at, 1)
    return {
        "run_id": run_id,
        "pipeline_id": pid,
        "status": state.status,
        "elapsed_s": elapsed,
        "steps_done": sum(1 for ss in state.steps.values() if ss.status in ("success", "failed")),
        "steps_total": len(state.steps),
        "steps": {
            sid: {"status": ss.status, "label": ss.label, "output": ss.output}
            for sid, ss in state.steps.items()
        },
    }
