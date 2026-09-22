# ============================================================
# core/plan_runner.py
# Moteur d'execution d'un Experiment Plan. Rejoue, en tache de fond, la
# meme sequence que le driver E2E, mais VIA LES ENDPOINTS INTERNES de l'app
# (dupliquer un graphe de base + overrides -> lancer + auto-resume des gates
# -> commit DVC + insights). Reutilise donc toute la logique existante.
# Progression ecrite dans plan_store.last_run (poll par le frontend).
# ============================================================

import asyncio
import logging
from datetime import datetime, timezone

import httpx

from backend.config import BACKEND_PORT
from backend.core import plan_store

logger = logging.getLogger(__name__)

BASE = f"http://127.0.0.1:{BACKEND_PORT}"
_active: dict[str, asyncio.Task] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get(c: httpx.AsyncClient, p: str):
    r = await c.get(BASE + p)
    r.raise_for_status()
    return r.json()


async def _post(c: httpx.AsyncClient, p: str, body=None):
    r = await c.post(BASE + p, json=body)
    r.raise_for_status()
    return r.json()


async def _put(c: httpx.AsyncClient, p: str, body):
    r = await c.put(BASE + p, json=body)
    r.raise_for_status()
    return r.json()


def _apply_overrides(graph: dict, ov: dict) -> None:
    """Applique les overrides nommes sur les noeuds standard (v1 explorer, a1 annotation,
    t1 training). Silencieux si un noeud n'existe pas (graphe reuse = a1 + t1 seulement)."""
    by_id = {n["id"]: n for n in graph.get("nodes", [])}

    def d(nid):
        n = by_id.get(nid)
        return n.setdefault("data", {}) if n else None

    v = d("v1")
    if v is not None:
        if ov.get("subset"):        v["subset_name"] = ov["subset"]
        if ov.get("top_k"):         v["top_k"] = int(ov["top_k"])
    a = d("a1")
    if a is not None:
        if ov.get("subset"):        a["subset_name"] = ov["subset"]
        if ov.get("project"):       a["project_name"] = ov["project"]
        if ov.get("export_name"):   a["export_name"] = ov["export_name"]
        if ov.get("threshold") is not None:
            a["ai_threshold"] = float(ov["threshold"])
    t = d("t1")
    if t is not None:
        if ov.get("epochs"):        t["epochs"] = int(ov["epochs"])
        if ov.get("batch"):         t["batch"] = int(ov["batch"])
        if ov.get("run_label"):     t["run_label"] = ov["run_label"]
        if ov.get("basic_lr_per_img") is not None:
            # Champ plat, comme epochs/batch/run_label ci-dessus : graph_runner
            # lit data["basic_lr_per_img"] directement (_HP_KEYS), jamais un
            # sous-dict "hyperparams" -- l'ancienne cle lr0 nichee ici n'etait
            # jamais lue nulle part (bug pre-existant, corrige au passage).
            t["basic_lr_per_img"] = float(ov["basic_lr_per_img"])


async def _run_graph_with_gates(c: httpx.AsyncClient, gid: str, max_minutes: int = 40):
    """Lance un graphe et auto-resume les human gates (plan = execution planifiee)."""
    r = await _post(c, f"/api/graphs/{gid}/run")
    run_id = r.get("run_id")
    if not run_id:
        return None, "no_run_id"
    deadline = asyncio.get_event_loop().time() + max_minutes * 60
    while asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(3)
        try:
            g = await _get(c, f"/api/graphs/{gid}")
        except Exception:
            continue
        status = g.get("status")
        if status == "waiting":
            await _post(c, f"/api/graphs/{gid}/resume")
            continue
        if status in ("done", "failed", "stopped"):
            return run_id, status
    return run_id, "timeout"


async def run_plan(plan_id: str) -> None:
    plan = plan_store.get_plan(plan_id)
    if not plan:
        return
    steps = plan.get("steps", [])
    results: list[dict] = []
    state = {"status": "running", "started_at": _now(), "finished_at": None,
             "current": 0, "total": len(steps), "results": results}
    plan_store.set_run_state(plan_id, state)

    async with httpx.AsyncClient(timeout=120.0) as c:
        for i, step in enumerate(steps):
            state["current"] = i + 1
            res = {"step_id": step["id"], "label": step["label"], "status": "running"}
            results.append(res)
            plan_store.set_run_state(plan_id, dict(state))
            try:
                dup = await _post(c, f"/api/graphs/{step['base_graph_id']}/duplicate")
                gid = dup.get("graph_id")
                if not gid:
                    raise RuntimeError("graphe de base introuvable")
                g = await _get(c, f"/api/graphs/{gid}")
                _apply_overrides(g, step.get("overrides", {}))
                await _put(c, f"/api/graphs/{gid}",
                           {"name": step["label"], "nodes": g["nodes"], "edges": g["edges"]})
                run_id, status = await _run_graph_with_gates(c, gid)
                res.update(graph_id=gid, run_id=run_id, status=status)
                if status == "done":
                    # DVC reste volontairement manuel : les sorties exactes de ce
                    # run sont proposées dans le hub, puis l'utilisateur choisit
                    # lesquelles versionner. Un plan ne doit jamais créer de commit.
                    await _post(c, f"/api/insights/{gid}/generate", {"run_id": run_id})
                    try:
                        ins = await _get(c, f"/api/insights/{gid}/{run_id}")
                        lin = ins.get("lineage", {}) or {}
                        res.update(dvc_version=lin.get("dvc_version"),
                                   git_commit=lin.get("git_commit"), map50=lin.get("map50"))
                    except Exception:
                        pass
            except Exception as exc:
                res.update(status="error", error=str(exc)[:200])
                logger.warning("plan %s etape %s echouee: %s", plan_id, step.get("label"), exc)
            plan_store.set_run_state(plan_id, dict(state))

    state["status"] = "done"
    state["finished_at"] = _now()
    plan_store.set_run_state(plan_id, dict(state))


def start_plan(plan_id: str) -> bool:
    """Demarre l'execution en tache de fond. False si deja en cours."""
    t = _active.get(plan_id)
    if t and not t.done():
        return False
    _active[plan_id] = asyncio.create_task(run_plan(plan_id))
    return True


def get_run_state(plan_id: str) -> dict | None:
    p = plan_store.get_plan(plan_id)
    return (p or {}).get("last_run")
