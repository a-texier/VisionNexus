# ============================================================
# api/plans.py
# Experiment Plans : CRUD + lancement sequentiel + statut.
# ============================================================

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from backend.core import plan_store, plan_runner

router = APIRouter(prefix="/api/plans", tags=["plans"])


class Step(BaseModel):
    id: str = ""
    label: str
    base_graph_id: str
    overrides: dict = {}


class PlanBody(BaseModel):
    name: str
    steps: list[Step] = []


@router.get("")
def list_plans():
    return plan_store.list_plans()


@router.post("", status_code=201)
def create_plan(body: PlanBody):
    return plan_store.create_plan(body.name, [s.model_dump() for s in body.steps])


@router.get("/{plan_id}")
def get_plan(plan_id: str):
    p = plan_store.get_plan(plan_id)
    if not p:
        raise HTTPException(404, "Plan introuvable")
    return p


@router.put("/{plan_id}")
def update_plan(plan_id: str, body: PlanBody):
    p = plan_store.update_plan(plan_id, name=body.name, steps=[s.model_dump() for s in body.steps])
    if not p:
        raise HTTPException(404, "Plan introuvable")
    return p


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: str):
    if not plan_store.delete_plan(plan_id):
        raise HTTPException(404, "Plan introuvable")


@router.post("/{plan_id}/run", status_code=202)
async def run_plan(plan_id: str):
    # async : start_plan fait asyncio.create_task, qui exige la boucle d'evenements
    # en cours (indisponible depuis un endpoint sync execute dans le threadpool).
    if not plan_store.get_plan(plan_id):
        raise HTTPException(404, "Plan introuvable")
    started = plan_runner.start_plan(plan_id)
    if not started:
        return {"ok": False, "message": "Plan deja en cours d'execution"}
    return {"ok": True, "plan_id": plan_id}


@router.get("/{plan_id}/status")
def plan_status(plan_id: str):
    if not plan_store.get_plan(plan_id):
        raise HTTPException(404, "Plan introuvable")
    return plan_runner.get_run_state(plan_id) or {"status": "idle"}
