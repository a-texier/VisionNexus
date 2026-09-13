# ============================================================
# core/graph_store.py
# Persistence des expériences sandgraph (nodes + edges + état).
# Stockage: GRAPHS_DIR/experiments.json
# ============================================================

import copy
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import GRAPHS_DIR


def _file() -> Path:
    return GRAPHS_DIR / "experiments.json"


def _load() -> dict[str, dict]:
    f = _file()
    if not f.exists():
        return {}
    try:
        data = json.loads(f.read_text("utf-8"))
        changed = False
        for graph in data.values():
            for node in graph.get("nodes", []) or []:
                node_data = node.get("data") or {}
                if node.get("type") == "visu":
                    node["type"] = "explorer"
                    changed = True
                if node_data.get("node_type") == "visu":
                    node_data["node_type"] = "explorer"
                    changed = True
                if node_data.get("label") in ("Visu", "Visu - subset", "Visu — subset"):
                    node_data["label"] = "Dataset Explorer"
                    changed = True
            for execution in (graph.get("execution") or {}).values():
                result = execution.get("result") or {}
                if result.get("app_link") == "Visu" + "_BDD_App":
                    result["app_link"] = "Dataset_Explorer_App"
                    changed = True
        if changed:
            _save(data)
        return data
    except Exception:
        return {}


def _save(data: dict[str, dict]) -> None:
    _file().write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Type derive MLOps (jamais persiste) ────────────────────────────────────────
# Un graphe n'a PAS de champ de type stocke : son type est DERIVE de ses nodes.
# Regle produit (decidee avec l'utilisateur) : un Sandgraph est "mlops" (suivi
# DVC + MLflow + Insight + Lineage) des qu'il contient A LA FOIS un node MLflow ET
# un node DVC. MLflow seul (ou DVC seul) = suivi INCOMPLET : la paire est couplee,
# on ne verse dans le tracking qu'avec les deux. Sinon "experimental" (jetable).

def graph_node_types(graph: dict) -> set:
    """Ensemble des node_type presents dans un graphe (data.node_type ou type)."""
    out: set[str] = set()
    for n in graph.get("nodes", []) or []:
        nt = (n.get("data") or {}).get("node_type") or n.get("type", "")
        if nt:
            out.add(nt)
    return out


def mlops_status(graph: dict) -> dict:
    """Statut MLOps derive d'un graphe. Ne lit que les nodes, ne persiste rien.

    graph_type : "mlops" si (MLflow ET DVC) sinon "experimental".
    tracking_complete : les deux supervises presents (paire couplee).
    tracking_partial : un seul des deux -> suivi incomplet a corriger.
    """
    types = graph_node_types(graph)
    has_mlflow = "mlflow" in types
    has_dvc = "dvc" in types
    is_mlops = has_mlflow and has_dvc
    return {
        "graph_type":        "mlops" if is_mlops else "experimental",
        "is_mlops":          is_mlops,
        "has_mlflow":        has_mlflow,
        "has_dvc":           has_dvc,
        "tracking_complete": is_mlops,
        "tracking_partial":  (has_mlflow or has_dvc) and not is_mlops,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_graph(name: str, nodes: list, edges: list) -> dict:
    g = {
        "graph_id":          str(uuid.uuid4())[:8],
        "name":              name,
        "created_at":        _now(),
        "updated_at":        _now(),
        "status":            "idle",   # idle|running|waiting|done|failed
        "active_run_id":     None,
        "active_pipeline_id": None,
        "nodes":             nodes,
        "edges":             edges,
        "execution":         {},       # node_id → {status, result, started_at, finished_at}
        "run_history":       [],       # [{run_id, started_at, status, duration_s}]
        "step_node_map":     {},       # step_id → node_id (populated on run start)
    }
    data = _load()
    data[g["graph_id"]] = g
    _save(data)
    return g


def get_graph(graph_id: str) -> Optional[dict]:
    return _load().get(graph_id)


def list_graphs() -> list[dict]:
    data = _load()
    result = sorted(data.values(), key=lambda g: g.get("updated_at", ""), reverse=True)
    return result


def update_graph(graph_id: str, **kwargs) -> Optional[dict]:
    """Update name, nodes, edges or any top-level field."""
    data = _load()
    g = data.get(graph_id)
    if not g:
        return None
    for k, v in kwargs.items():
        if k in g or k in ("name", "nodes", "edges"):
            g[k] = v
    g["updated_at"] = _now()
    _save(data)
    return g


def delete_graph(graph_id: str) -> bool:
    data = _load()
    if graph_id not in data:
        return False
    del data[graph_id]
    _save(data)
    return True


def duplicate_graph(graph_id: str) -> Optional[dict]:
    data = _load()
    orig = data.get(graph_id)
    if not orig:
        return None
    new = copy.deepcopy(orig)
    new["graph_id"] = str(uuid.uuid4())[:8]
    new["name"] = f"{orig['name']} (copie)"
    new["created_at"] = _now()
    new["updated_at"] = _now()
    new["status"] = "idle"
    new["active_run_id"] = None
    new["active_pipeline_id"] = None
    new["execution"] = {}
    new["run_history"] = []
    new["step_node_map"] = {}
    # Un graphe dupliqué/forké NE conserve PAS le lineage des runs du parent
    # (sinon les runs du parent apparaissent en fantômes sous l'enfant dans le
    # graphe de lineage) ni un ancien `forked_from` (re-défini par l'appelant).
    new["run_lineage"] = {}
    new.pop("forked_from", None)
    data[new["graph_id"]] = new
    _save(data)
    return new


# ── Run state helpers ──────────────────────────────────────────────────────────

def start_run(graph_id: str, run_id: str, pipeline_id: str, step_node_map: dict) -> None:
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    g["status"] = "running"
    g["active_run_id"] = run_id
    g["active_pipeline_id"] = pipeline_id
    g["step_node_map"] = step_node_map
    g["execution"] = {nid: {"status": "idle", "result": {}} for nid in set(step_node_map.values())}
    g["updated_at"] = _now()
    _save(data)
    # Cree l'identite persistante avant toute etape : meme un run interrompu
    # avant le premier Insight reste un run reel, jamais un brouillon "non lance".
    try:
        from backend.core import run_manifest
        run_manifest.start(g, run_id, pipeline_id, step_node_map)
    except Exception:
        pass


def update_node_exec(graph_id: str, node_id: str, status: str, result: dict = None) -> None:
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    exec_state = g.setdefault("execution", {})
    node_exec = exec_state.setdefault(node_id, {})
    prev = node_exec.get("status", "idle")

    # waiting(4) > done(2) so a new human_gate can override a completed sub-step
    # (e.g. annotation node: project→done, annotate→waiting must show the gate).
    # allow_downgrade handles the reverse: running/done can clear a waiting state
    # (multi-step nodes starting the next step, or resuming after a gate).
    # Graph-level "waiting" status is NOT set here — it is set exclusively by
    # event_generator after the SSE stream ends at the current gate, which prevents
    # historical SSE replay from flipping the graph back to "waiting".
    STATUS_RANK = {"idle": 0, "running": 1, "done": 2, "warning": 2, "failed": 3, "waiting": 4}
    allow_downgrade = status in ("running", "done", "warning") and prev in ("done", "warning", "waiting")
    should_update = (
        allow_downgrade
        or STATUS_RANK.get(status, 0) >= STATUS_RANK.get(prev, 0)
        or status == "failed"
    )
    if should_update:
        node_exec["status"] = status

    if result:
        node_exec.setdefault("result", {}).update(result)
    if status == "running" and not node_exec.get("started_at"):
        node_exec["started_at"] = _now()
    if status in ("done", "warning", "failed") and not node_exec.get("finished_at"):
        node_exec["finished_at"] = _now()

    g["updated_at"] = _now()
    if should_update:
        # Resume execution after a gate: flip graph back to running
        if status in ("running", "done", "warning") and g.get("status") == "waiting":
            g["status"] = "running"
        elif status == "failed":
            g["status"] = "failed"
    _save(data)


def set_node_data(graph_id: str, node_id: str, patch: dict) -> None:
    """Fusionne `patch` dans le `data` d'un node (persisté). step6 : sert à écrire
    les best_params de l'auto-HPO sur le node Optuna à la fin du run → le hub DVC
    (qui lit le graphe sauvegardé) peut les récupérer, même sans save manuel."""
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    for n in g.get("nodes", []):
        if n.get("id") == node_id:
            n.setdefault("data", {}).update(patch)
            g["updated_at"] = _now()
            _save(data)
            return


def set_graph_waiting(graph_id: str) -> None:
    """Mark the graph as waiting at a human gate. Called by event_generator ONLY
    when the SSE stream ends at the current gate (not during historical replay)."""
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    g["status"] = "waiting"
    g["updated_at"] = _now()
    _save(data)


def finish_run(graph_id: str, run_id: str, status: str, duration_s: float = None) -> None:
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    final = "done" if status in ("success", "done") else status
    g["status"] = final
    g["active_run_id"] = None
    g["active_pipeline_id"] = None
    history = g.setdefault("run_history", [])
    history.insert(0, {
        "run_id": run_id,
        "started_at": _now(),
        "status": final,
        "duration_s": duration_s,
    })
    g["run_history"] = history[:20]
    g["updated_at"] = _now()
    _save(data)
    try:
        from backend.core import run_manifest
        manifest = run_manifest.load(run_id)
        if manifest:
            manifest["status"] = final
            manifest["duration_s"] = duration_s
            run_manifest.write(manifest)
    except Exception:
        pass


def stop_execution(graph_id: str, run_id: str) -> None:
    """Finalise un run ARRÊTÉ : statut de graphe 'stopped' + reset des nœuds encore
    en vol (pending/running/waiting) à 'idle'. `finish_run` ne touchait QUE le statut
    de graphe, jamais `execution[node_id]` — un nœud resté 'running' au moment du
    Stop restait donc 'running' pour toujours dans le JSON persisté. Au prochain
    refetch de /api/graphs, le frontend redérive exec_status depuis ce JSON et
    écrasait le fix local optimiste (stopMut passait bien les nœuds à 'idle' côté
    client, mais le refetch qui suit le ramenait à 'running')."""
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    exec_state = g.setdefault("execution", {})
    for node_exec in exec_state.values():
        if node_exec.get("status") in ("pending", "running", "waiting"):
            node_exec["status"] = "idle"
            node_exec["finished_at"] = _now()
    g["status"] = "stopped"
    g["active_run_id"] = None
    g["active_pipeline_id"] = None
    history = g.setdefault("run_history", [])
    history.insert(0, {"run_id": run_id, "started_at": _now(), "status": "stopped", "duration_s": None})
    g["run_history"] = history[:20]
    g["updated_at"] = _now()
    _save(data)
    try:
        from backend.core import experiment_store, run_manifest
        reason = "Exécution interrompue : processus absent ou arrêt demandé."
        experiment = experiment_store.interrupt_experiment(run_id, reason)
        manifest = run_manifest.load(run_id)
        if manifest:
            manifest["status"] = "interrupted"
            if experiment:
                manifest["steps"] = [
                    {"step_id": step_id, "status": record.status, "output": record.output}
                    for step_id, record in experiment.steps.items()
                ]
            step_status = {
                step.get("step_id"): step.get("status")
                for step in (manifest.get("steps") or [])
                if isinstance(step, dict)
            }
            producer_by_kind = {
                "dataset": "__exportyolo",
                "annotations": "__exportver",
                "optuna": "__hpo",
                "model": "__train",
                "metrics": "__evaluate",
            }
            for artifact in manifest.get("outputs") or []:
                kind = artifact.get("kind")
                suffix = producer_by_kind.get(kind)
                if not suffix:
                    continue
                producer_status = next(
                    (status for step_id, status in step_status.items() if str(step_id).endswith(suffix)),
                    None,
                )
                if producer_status == "success":
                    continue
                artifact["exists"] = False
                artifact["state"] = "failed" if producer_status in ("failed", "interrupted") else "planned"
                artifact["source_run_id"] = None
                artifact["download"] = None
                if kind == "optuna":
                    artifact["value"] = None
                    artifact["error"] = reason
                elif kind in ("model", "metrics"):
                    artifact["path"] = None
            run_manifest.write(manifest)
    except Exception:
        pass


# ── Lineage par run (Git/DVC/MLflow) ───────────────────────────────────────────
# Renseigne au moment du commit DVC (le seul instant ou l'on connait le hash git
# reel + les artefacts versionnes). Lu par les insights pour construire le lineage
# et la checklist de reproductibilite. Stocke sous g["run_lineage"][run_id].

def set_run_lineage(graph_id: str, run_id: str, lineage: dict) -> None:
    """Fusionne un dict lineage sur un run (git_commit, dvc_versioned, dataset,
    dataset_version, model_md5, mlflow_runs...). Additif : ne rien ecraser en None."""
    if not run_id:
        return
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    store = g.setdefault("run_lineage", {})
    cur = store.setdefault(run_id, {})
    for k, v in lineage.items():
        if v is not None:
            cur[k] = v
    cur["updated_at"] = _now()
    g["updated_at"] = _now()
    _save(data)


def get_run_lineage(graph_id: str, run_id: str) -> dict:
    g = _load().get(graph_id)
    if not g:
        return {}
    return (g.get("run_lineage") or {}).get(run_id, {})


def set_forked_from(graph_id: str, info: dict) -> Optional[dict]:
    """Enregistre la provenance d'un fork sur le NOUVEAU graphe. Additif : ecrit
    g["forked_from"] = info (parent_graph_id, run_id, git_commit, dataset,
    dvc_version — champs None tolerables). Trace uniquement quelle version a servi
    de base : ne declenche AUCUN dvc pull ni re-telechargement."""
    data = _load()
    g = data.get(graph_id)
    if not g:
        return None
    g["forked_from"] = info
    g["updated_at"] = _now()
    _save(data)
    return g


def reset_graph_execution(graph_id: str) -> None:
    data = _load()
    g = data.get(graph_id)
    if not g:
        return
    g["status"] = "idle"
    g["active_run_id"] = None
    g["active_pipeline_id"] = None
    g["execution"] = {}
    g["step_node_map"] = {}
    g["updated_at"] = _now()
    _save(data)
