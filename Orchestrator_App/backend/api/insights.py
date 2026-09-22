# ============================================================
# api/insights.py
# Insights par run de graph : liste, detail, plots, generation.
# Les fichiers vivent dans WORKSPACE/insights/{graph_id}/{run_id}/.
# ============================================================

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from backend.core import insights as ins
from backend.core import graph_store

router = APIRouter(prefix="/api/insights", tags=["insights"])


class GenerateBody(BaseModel):
    run_id: Optional[str] = None   # defaut : dernier run du graph


@router.get("")
def list_insights():
    return ins.list_all()


@router.get("/{graph_id}/{run_id}")
def get_insights(graph_id: str, run_id: str):
    data = ins.load(graph_id, run_id)
    if not data:
        raise HTTPException(404, "Insights introuvables pour ce run — generez-les d'abord")
    return data


@router.get("/{graph_id}/{run_id}/plot/{name}")
def get_plot(graph_id: str, run_id: str, name: str):
    p = ins.plot_path(graph_id, run_id, name)
    if not p:
        raise HTTPException(404, "Fichier introuvable")
    media = "image/png" if p.suffix == ".png" else "text/plain; charset=utf-8"
    return FileResponse(p, media_type=media)


@router.delete("/{graph_id}/{run_id}", status_code=204)
def delete_insights(graph_id: str, run_id: str):
    if not ins.delete(graph_id, run_id):
        raise HTTPException(404, "Insights introuvables")


@router.post("/{graph_id}/generate", status_code=202)
async def generate_insights(graph_id: str, body: GenerateBody):
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")

    run_id = body.run_id or g.get("active_run_id")
    if not run_id:
        history = g.get("run_history", [])
        run_id = history[0]["run_id"] if history else None
    if not run_id:
        raise HTTPException(400, "Aucun run connu pour ce graphe")

    data = await ins.generate(graph_id, run_id)
    return {
        "ok":       True,
        "graph_id": graph_id,
        "run_id":   run_id,
        "plots":    data.get("plots", []),
    }
