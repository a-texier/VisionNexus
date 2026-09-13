# ============================================================
# api/graphs.py
# CRUD sandgraph + lancement d'exécution.
# ============================================================

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from backend.core import graph_store, graph_runner, pipeline_runner, proxy_client, experiment_store
from backend.core.pipeline_store import get_pipeline
from backend.config import APP_FRONTEND_URLS
from backend.utils.debug_logger import dbg

router = APIRouter(prefix="/api/graphs", tags=["graphs"])


# ── Filet de sécurité : re-synchronise graph_store depuis pipeline_runner ──────
# event_generator() (plus bas) est la voie NORMALE de mise à jour de graph_store —
# mais elle ne s'exécute que tant qu'un client consomme activement le flux SSE
# /run/{run_id}/stream. Si cette connexion échoue au tout premier essai (503
# transitoire, tab fermé, proxy dev qui rate le premier hit...) et n'est jamais
# retentée côté frontend (fetch() brut, pas d'auto-reconnect comme EventSource),
# graph_store reste bloqué au dernier état vu POUR TOUJOURS — alors que le
# pipeline, lui, continue de tourner correctement en mémoire (pipeline_runner est
# la source de vérité, PAS le flux SSE qui n'est qu'un relais). Symptôme observé :
# le graphe reste affiché "running" indéfiniment après qu'un human_gate a été
# atteint et est passé en attente, sans qu'aucun banner n'apparaisse — un vrai
# "stalemate" alors que le backend a fini son travail il y a longtemps.
# Appelée à chaque poll de list_graphs()/get_graph() (déjà pollés en continu par
# le frontend) : rattrape l'état réel en un cycle de poll (~5s) même si le SSE
# n'a JAMAIS réussi à se connecter — indépendant de tout flux actif.
def _sync_graph_from_run(graph_id: str, g: dict) -> None:
    run_id = g.get("active_run_id")
    if not run_id:
        return
    state = pipeline_runner.get_run_state(run_id)
    if not state:
        # Run introuvable en mémoire alors que le graphe le référence encore :
        # le backend a redémarré PENDANT un run (ou le run a été purgé). Sans ça le
        # graphe restait « running » À VIE → UI figée « tout gris », bouton Lancer
        # caché, aucun SSE, aucun tray (bug remonté par Bob 2026-07-24). Il ne faut
        # toutefois PAS faire un simple reset : cela efface active_run_id sans écrire
        # l'historique et laisse le manifeste du run à « running ». On finalise donc
        # explicitement l'exécution perdue comme interrompue. Le graphe devient
        # « stopped » (relançable), le run reste visible dans le lineage et son
        # manifeste reçoit un statut terminal cohérent.
        if g.get("status") in ("running", "waiting"):
            graph_store.stop_execution(graph_id, run_id)
        return
    step_node_map = g.get("step_node_map", {})
    pipeline = get_pipeline(state.pipeline_id)
    step_defs = {s.id: s for s in pipeline.steps} if pipeline else {}
    for step_id, ss in state.steps.items():
        if ss.status == "pending":
            continue
        node_id = step_node_map.get(step_id)
        if not node_id:
            continue
        node_status = _map_step_to_node_status(ss.status, step_id, g)
        result = {"step_id": step_id, "status": ss.status}
        if ss.status == "waiting":
            step_def = step_defs.get(step_id)
            result["hint"] = (step_def.hint if step_def else "") or ss.output
            result["app_link"] = step_def.app_link if step_def else ""
            result["next_label"] = step_def.next_label if step_def else ""   # step1
        elif ss.status in ("failed", "warning"):
            result["hint"] = getattr(ss, "hint", "") or ss.output
        graph_store.update_node_exec(graph_id, node_id, node_status, result)
        # Persiste les best_params de l'auto-HPO sur le node Optuna AUSSI via ce
        # fallback de poll : le write-back cote SSE (event_generator) ne se declenche
        # que si le flux est activement consomme — sinon best_params restait vide et
        # non cochable dans le node DVC (bug step4). Idempotent.
        if ss.status == "success" and step_id.endswith("__hpo"):
            try:
                import json as _json
                out = ss.output
                parsed = _json.loads(out) if isinstance(out, str) else out
                bp = parsed.get("best_params") if isinstance(parsed, dict) else None
                if bp:
                    graph_store.set_node_data(graph_id, node_id, {"best_params": bp})
            except Exception:
                pass
    # Statut au niveau du graphe : pipeline_runner est la source de vérité. On RELIT
    # l'état frais après la boucle — NE PAS se fier au snapshot `g` d'entrée : pour une
    # étape déjà "done"/"running", update_node_exec ci-dessus a pu rebasculer un graphe
    # "waiting" vers "running" (cf. graph_store.update_node_exec, downgrade waiting→
    # running). Décider avec le `g` périmé faisait alterner waiting↔running à chaque
    # poll → banner "Intervention requise" qui clignote toutes les ~2s (bug observé).
    # En relisant `fresh`, chaque requête se termine sur le bon statut, stable.
    fresh = graph_store.get_graph(graph_id)
    if not fresh:
        return
    if state.done:
        if fresh.get("status") not in ("done", "failed", "stopped"):
            graph_store.finish_run(graph_id, run_id, state.status)
    elif state.status == "waiting" and fresh.get("status") != "waiting":
        graph_store.set_graph_waiting(graph_id)


class CreateGraphBody(BaseModel):
    name: str
    nodes: list = []
    edges: list = []


class UpdateGraphBody(BaseModel):
    name: Optional[str] = None
    nodes: Optional[list] = None
    edges: Optional[list] = None


# ── CRUD ──────────────────────────────────────────────────────────────────────

# Champ calcule (jamais persiste) ajoute a chaque reponse graphe : le type MLOps
# derive des nodes (mlops = MLflow + DVC). Le frontend s'en sert pour le badge, le
# couplage MLflow/DVC et la carte d'identite du Run — une seule source de verite.
def _with_mlops(g: dict) -> dict:
    if g is not None:
        g["mlops"] = graph_store.mlops_status(g)
    return g


@router.get("")
def list_graphs():
    for g in graph_store.list_graphs():
        if g.get("active_run_id"):
            _sync_graph_from_run(g["graph_id"], g)
    return [_with_mlops(g) for g in graph_store.list_graphs()]


@router.post("", status_code=201)
def create_graph(body: CreateGraphBody):
    return graph_store.create_graph(body.name, body.nodes, body.edges)


@router.get("/{graph_id}")
def get_graph(graph_id: str):
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    if g.get("active_run_id"):
        _sync_graph_from_run(graph_id, g)
        g = graph_store.get_graph(graph_id)
    return _with_mlops(g)


@router.put("/{graph_id}")
def update_graph(graph_id: str, body: UpdateGraphBody):
    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    g = graph_store.update_graph(graph_id, **kwargs)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    return g


@router.delete("/{graph_id}", status_code=204)
def delete_graph(graph_id: str):
    if not graph_store.delete_graph(graph_id):
        raise HTTPException(404, "Graphe introuvable")


@router.post("/{graph_id}/duplicate")
def duplicate_graph(graph_id: str):
    g = graph_store.duplicate_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    return g


class ForkRunBody(BaseModel):
    run_id: str


# Params "reglables" retenus par type de node pour le snapshot de fork. Sert a
# afficher la DIVERGENCE avant relance (ce qui reste identique vs ce qui change).
_FORK_SNAPSHOT_KEYS = {
    "dataset_source": ["dataset_name", "dataset_path", "n_clusters"],
    "explorer":           ["subset_name", "query", "top_k"],
    "annotation":     ["project_name", "subset_name", "annotation_mode", "ai_model", "ai_threshold"],
    "training":       ["yolo_version", "model_size", "epochs", "batch", "imgsz", "lr0"],
    "inference":      ["task", "tracker_mot", "tracker_sot", "n_targets", "threshold"],
    "optuna":         ["n_trials", "optimize", "stop_on_failure"],
    "model":          ["model_path", "yolo_version", "model_size"],
}


def _fork_param_snapshot(graph: dict) -> list[dict]:
    """Snapshot ordonne des params reglables du graphe (par node), pour comparer une
    relance forkee a sa base. On ne garde que les cles pertinentes par type."""
    snap: list[dict] = []
    for n in graph.get("nodes", []) or []:
        data = n.get("data") or {}
        ntype = data.get("node_type") or n.get("type", "")
        keys = _FORK_SNAPSHOT_KEYS.get(ntype)
        if not keys:
            continue
        params = {k: data.get(k) for k in keys if data.get(k) not in (None, "")}
        snap.append({
            "node_id": n.get("id", ""),
            "node_type": ntype,
            "label": data.get("label") or ntype,
            "params": params,
        })
    return snap


@router.post("/{graph_id}/fork-run")
def fork_run(graph_id: str, body: ForkRunBody):
    """Fork d'un run : duplique le graphe (memes noeuds dataset/annotation = meme
    subset + memes annotations, pret a re-parametrer l'entrainement) et grave la
    provenance du run source dans g["forked_from"]. NE declenche PAS de dvc pull /
    re-telechargement : le bloc forked_from ne sert qu'a la tracabilite (quelle
    version a servi de base). L'utilisateur ajuste ses params puis relance."""
    orig = graph_store.get_graph(graph_id)
    if not orig:
        raise HTTPException(404, "Graphe introuvable")

    new = graph_store.duplicate_graph(graph_id)
    if not new:
        raise HTTPException(404, "Graphe introuvable")

    lineage = graph_store.get_run_lineage(graph_id, body.run_id)
    forked_from = {
        "parent_graph_id": graph_id,
        "parent_graph_name": orig.get("name", ""),
        "run_id":          body.run_id,
        "git_commit":      lineage.get("git_commit"),
        "dataset":         lineage.get("dataset"),
        "dvc_version":     lineage.get("dvc_version") or lineage.get("dataset_version"),
        "map50":           lineage.get("map50"),
        # Snapshot des params du parent -> diff de divergence avant relance.
        "snapshot":        _fork_param_snapshot(orig),
    }
    graph_store.set_forked_from(new["graph_id"], forked_from)

    new_name = f"{orig.get('name', 'Graphe')} - fork de {body.run_id}"
    graph_store.update_graph(new["graph_id"], name=new_name)

    dbg.step("graphs", "fork_run", "Fork cree",
             parent=graph_id, run=body.run_id, new_graph=new["graph_id"])
    return {"graph_id": new["graph_id"], "name": new_name, "forked_from": forked_from}


# Node free par defaut a injecter pour rendre un graphe "mlops" (paire couplee).
# Miroir des defaults du TOOLBOX frontend (SandgraphPage.tsx) : MLflow et DVC sont
# des superviseurs FREE (aucune arete), donc on ajoute juste le node + data.
_MLOPS_NODE_DEFAULTS = {
    "mlflow": {"node_type": "mlflow", "label": "MLflow"},
    "dvc":    {"node_type": "dvc", "label": "DVC Commit",
               "commit_message": "feat: version dataset + modele"},
}


@router.post("/{graph_id}/track-mlops")
def track_mlops(graph_id: str):
    """Promeut un graphe "experimental" en "mlops" en injectant la PAIRE couplee
    MLflow + DVC manquante (nodes FREE, aucune arete). Idempotent : n'ajoute que ce
    qui manque. Ne lance rien, ne versionne rien — l'utilisateur committe ensuite via
    le node DVC. Renvoie le graphe mis a jour avec son type derive recalcule."""
    import uuid as _uuid

    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")

    present = graph_store.graph_node_types(g)
    nodes = list(g.get("nodes", []) or [])

    # Position : on empile les nouveaux superviseurs sous le graphe existant.
    base_y = 0
    min_x = 0
    for n in nodes:
        pos = n.get("position") or {}
        base_y = max(base_y, int(pos.get("y", 0)))
        min_x = min(min_x, int(pos.get("x", 0)))
    base_y += 160

    added: list[str] = []
    for i, ntype in enumerate(("mlflow", "dvc")):
        if ntype in present:
            continue
        nid = f"{ntype}_{_uuid.uuid4().hex[:6]}"
        nodes.append({
            "id":       nid,
            "type":     ntype,
            "position": {"x": min_x + i * 240, "y": base_y},
            "data":     dict(_MLOPS_NODE_DEFAULTS[ntype]),
        })
        added.append(ntype)

    if added:
        graph_store.update_graph(graph_id, nodes=nodes)

    g = graph_store.get_graph(graph_id)
    dbg.step("graphs", "track_mlops", "Suivi MLOps active",
             graph=graph_id, added=",".join(added) or "rien")
    return {"ok": True, "added": added, **_with_mlops(g)}


@router.post("/{graph_id}/reset")
def reset_graph(graph_id: str):
    graph_store.reset_graph_execution(graph_id)
    return {"ok": True}


@router.post("/{graph_id}/stop")
async def stop_graph(graph_id: str):
    """Arrête un run en cours (ou coincé sur un gate). Garde-fou anti-blocage :
    fonctionne même si le run n'est plus en mémoire (serveur redémarré) — le
    graphe est alors juste remis dans un état terminal 'stopped'."""
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")

    run_id = g.get("active_run_id")
    stopped = False
    if run_id and pipeline_runner.run_in_memory(run_id):
        stopped = await pipeline_runner.stop_run(run_id)

    # Toujours finaliser côté graphe (terminal 'stopped') pour débloquer l'UI,
    # même si le run était fantôme (perdu après un redémarrage). stop_execution
    # (≠ finish_run) reset aussi les nœuds encore running/waiting à idle, sinon
    # ils restent affichés "running" indéfiniment (execution[] jamais nettoyé).
    graph_store.stop_execution(graph_id, run_id or "")
    dbg.step("graphs", "stop_graph", "Graphe arrêté",
             graph=graph_id, run=run_id, in_memory=stopped)
    return {"ok": True, "stopped": stopped, "run_id": run_id}


# ── Exécution ─────────────────────────────────────────────────────────────────

@router.post("/{graph_id}/run", status_code=202)
async def run_graph(graph_id: str):
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    if g.get("status") == "running":
        raise HTTPException(409, "Ce graphe est déjà en cours d'exécution")

    result = await graph_runner.run_graph(graph_id)
    return result


@router.get("/{graph_id}/run/{run_id}/stream")
async def stream_graph_run(graph_id: str, run_id: str):
    """SSE stream identique à /api/pipelines/{pid}/run/{run_id}/stream."""
    import asyncio
    import json as _json

    async def event_generator():
        saw_waiting = False
        async for evt in pipeline_runner.stream_events(run_id):
            # Update graph node execution state from SSE events
            step_id = evt.get("step_id")
            status  = evt.get("status")
            if step_id and status:
                g = graph_store.get_graph(graph_id)
                if g:
                    node_id = g.get("step_node_map", {}).get(step_id)
                    if node_id:
                        node_status = _map_step_to_node_status(status, step_id, g)
                        result = {"step_id": step_id, "status": status}
                        # Stocke hint et app_link pour waiting ET failed (affiché sur le nœud)
                        if status in ("waiting", "failed", "warning"):
                            result["hint"]     = evt.get("hint", "")
                            result["app_link"] = evt.get("app_link", "")
                            result["next_label"] = evt.get("next_label", "")   # step1
                        graph_store.update_node_exec(graph_id, node_id, node_status, result)
                        # step6 : à la fin de l'auto-HPO, PERSISTE les best_params sur le
                        # node Optuna → visibles + récupérables dans le hub DVC (qui lit le
                        # graphe sauvegardé). L'auto-HPO ne les écrivait pas avant.
                        if status == "success" and step_id.endswith("__hpo"):
                            try:
                                out = evt.get("output")
                                parsed = _json.loads(out) if isinstance(out, str) else out
                                bp = parsed.get("best_params") if isinstance(parsed, dict) else None
                                if bp:
                                    graph_store.set_node_data(graph_id, node_id, {"best_params": bp})
                            except Exception:
                                pass
                        dbg.sse("graphs", "event_generator",
                                f"node {node_status}",
                                step=step_id, node=node_id, graph=graph_id)
                        # Génération PROGRESSIVE des insights : après chaque étape
                        # significative réussie (training, export, commit, hpo), on
                        # régénère en tâche de fond → les plots se construisent au fur
                        # et à mesure du pipeline (pas seulement à la fin).
                        if status == "success" and step_id.rsplit("__", 1)[-1] in (
                            "train", "exportyolo", "commit", "hpo", "export", "subset"
                        ):
                            try:
                                from backend.core import insights as _insights
                                asyncio.create_task(_insights.generate(graph_id, run_id))
                            except Exception:
                                pass

            evt_type = evt.get("type")
            if evt_type == "done":
                graph_store.finish_run(graph_id, run_id, evt.get("status", "done"))
                dbg.step("graphs", "event_generator", "Pipeline terminé",
                         graph=graph_id, run=run_id, result=evt.get("status"))
                # Genere les insights du run (plots + journal) en tache de fond
                try:
                    from backend.core import insights as _insights
                    asyncio.create_task(_insights.generate(graph_id, run_id))
                except Exception as _exc:
                    dbg.error("graphs", "event_generator", f"Insights non generes: {_exc}")
            if evt_type == "waiting":
                saw_waiting = True
                dbg.gate("graphs", "event_generator", "Gate SSE reçu — en attente fin stream",
                         graph=graph_id, step=step_id)

            yield f"data: {_json.dumps(evt)}\n\n"
            # Do NOT exit here on "waiting" — stream_events controls the lifecycle.
            # Exiting early on historical "waiting" events (during SSE replay after
            # resume) caused the infinite-loop bug where the same gate reappeared.
            if evt_type == "done":
                return

        # Stream ended without "done" — the pipeline stopped at a current gate.
        # Only set graph to "waiting" HERE so historical replays never trigger the banner.
        if saw_waiting:
            graph_store.set_graph_waiting(graph_id)
            dbg.gate("graphs", "event_generator", "Graph mis en WAITING (gate courant)",
                     graph=graph_id, run=run_id)
        yield f"data: {_json.dumps({'type': 'end'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _map_step_to_node_status(step_status: str, step_id: str, graph: dict) -> str:
    """Convert a pipeline step status to a node execution status."""
    if step_status == "waiting":
        return "waiting"
    if step_status == "running":
        return "running"
    # For success: check if ALL steps for this node are done
    # Simplified: use step status directly mapped
    mapping = {"success": "done", "failed": "failed", "pending": "idle"}
    return mapping.get(step_status, step_status)


# ── Resume human gate ─────────────────────────────────────────────────────────

@router.post("/{graph_id}/resume", status_code=202)
async def resume_graph_run(graph_id: str):
    from backend.core.pipeline_store import save_pipeline
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")

    run_id = g.get("active_run_id")
    if not run_id:
        raise HTTPException(400, "Aucun run actif sur ce graphe")

    # If the run is not in memory the server was restarted — pipeline state is lost.
    # Auto-reset the graph to idle so the user can simply re-run it.
    if not pipeline_runner.run_in_memory(run_id):
        graph_store.reset_graph_execution(graph_id)
        raise HTTPException(
            410,
            "État du pipeline perdu (serveur redémarré). Le graphe a été réinitialisé — relancez le pipeline.",
        )

    # Rebuild pipeline from current graph state (may include new nodes added while waiting)
    pipeline, step_node_map = graph_runner.graph_to_pipeline(g)
    save_pipeline(pipeline)
    pipeline_runner.extend_run(run_id, pipeline.steps)
    pipeline_runner.update_run_pipeline(run_id, pipeline.id)
    graph_store.update_graph(graph_id, step_node_map=step_node_map, status="running")

    ok = await pipeline_runner.resume_run(run_id)
    if not ok:
        raise HTTPException(409, "Le run est en mémoire mais n'est plus en attente (déjà terminé ou repris).")

    return {"ok": True, "run_id": run_id, "step_node_map": step_node_map}


# ── App frontend URLs (pour les boutons "Ouvrir") ─────────────────────────────

@router.get("/meta/app-urls")
def get_app_urls():
    return APP_FRONTEND_URLS


# ── config.yaml complet d'Inference_App (step4-C) ─────────────────────────────
# Lu DIRECTEMENT sur disque (pas besoin qu'Inference_App tourne) pour préremplir le
# panneau de settings du node Inference avec TOUS les champs, groupés. Les champs
# fournis par un branchement (modèle, séquence, GT) sont marqués « override » côté UI.
_INFERENCE_GROUPS = [
    ("Source", ["sequence_dir", "weights_yolo", "annotation_file", "camera_name",
                "compute_metrics", "metadata_csv", "output_dir", "run_name", "log_level"]),
    ("Pipeline (détecteur / trackers)", ["detector_mot", "detector_roi", "tracker_mot",
                "tracker_sot", "n_targets", "mot_background", "device", "fps", "vram_threshold_gb"]),
    ("Fenêtre & frames", ["mode", "slice_size", "start_frame_idx", "stop_frame_idx",
                "local_display", "frame_ext", "codec"]),
    ("Rendu & affichage", ["light_render", "save_video", "save_frames", "trail",
                "debug_dialog_on_frames", "show_raw_det", "show_comp_det", "show_gt",
                "show_tracks", "show_hud", "show_legend", "show_dets_in_sot", "render"]),
    ("Métriques", ["metrics_iou_threshold", "metrics_nfai_xlim"]),
    ("Stream (ZMQ / MJPEG)", ["stream_mode", "stream_host", "stream_port", "stream_quality",
                "stream_every", "zmq_recv_timeout_ms", "zmq_ring_size", "zmq_catchup_threshold",
                "zmq_anno_n_boxes"]),
    ("SOT / homographie / commandes", ["sot_loss_threshold", "sot_click_max_dist_px",
                "max_delay_frames", "min_inliers", "homography_method_image", "use_ldv_cmc",
                "clicks", "command_delta"]),
    ("Chemins des trackers", ["bytetrack_root", "botsort_root", "boosttrack_root",
                "pytracking_root", "ostrack_root", "sam2_root"]),
    ("Réglages trackers & détecteurs (avancé)", ["kalman_mot_custom", "bytetrack", "botsort",
                "boosttrack", "sot_kalman", "csrt", "dummy_sot", "dimp", "ostrack", "sam2",
                "tracking_tophat", "yolo", "tophat_mot", "tophat_roi", "debug_tracking"]),
]
# Enums connus (rendu en select côté UI)
_INFERENCE_ENUMS = {
    "tracker_mot": ["custom_kalman", "bytetrack", "botsort", "boosttrack", "none"],
    "tracker_sot": ["dummy", "csrt", "tracking_tophat", "dimp", "ostrack", "sam2"],
    "detector_mot": ["yolo", "tophat", "none", "dummy"],
    "detector_roi": ["tophat", "none"],
    "device": ["cuda", "cpu"],
    "mode": ["headless", "command", "interactive"],
    "frame_ext": ["png", "jpg"],
    "stream_mode": ["none", "mjpeg", "zmq"],
    "camera_name": ["", "multi_csv", "single_csv"],
    "n_targets": [1, 2],
}


@router.get("/meta/inference-config")
def get_inference_config():
    """config.yaml complet d'Inference_App (défauts + groupes + enums + clés branchées)."""
    import yaml
    from backend.core.app_launcher import _CV_ROOT
    path = _CV_ROOT / "Inference_App" / "tracker" / "config" / "config.yaml"
    try:
        defaults = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "error": str(exc), "defaults": {}, "groups": [], "enums": {}, "branched_keys": []}
    grouped_keys = {k for _, keys in _INFERENCE_GROUPS for k in keys}
    others = [k for k in defaults if k not in grouped_keys]
    groups = [{"title": t, "keys": [k for k in keys if k in defaults]} for t, keys in _INFERENCE_GROUPS]
    if others:
        groups.append({"title": "Autres champs", "keys": others})
    return {
        "available": True,
        "defaults": defaults,
        "groups": groups,
        "enums": _INFERENCE_ENUMS,
        # fournis par un branchement → verrouillés dans l'UI (override)
        "branched_keys": ["weights_yolo", "sequence_dir", "annotation_file"],
    }


@router.get("/meta/explorer-subsets")
async def get_explorer_subsets():
    """Proxy: list subsets from Dataset_Explorer_App."""
    import json as _json
    result = await proxy_client.request("Dataset_Explorer_App", "GET", "/api/subsets", {})
    if result.get("ok"):
        try:
            data = _json.loads(result["data"])
            if isinstance(data, list):
                return [{"id": s.get("id"), "name": s.get("name"), "image_count": s.get("image_count", 0)} for s in data]
        except Exception:
            pass
    return []


@router.get("/meta/mlflow-summary")
async def get_mlflow_summary():
    """SUPERVISOR : resume live du store MLflow (via MLflow_App). Le noeud mlflow
    n'est PAS branche : il observe. Renvoie experiments + derniers runs + meilleure metrique."""
    import json as _json
    exp_res = await proxy_client.request("mlflow-app", "GET", "/api/experiments", {})
    if not exp_res.get("ok"):
        return {"available": False, "experiments": []}
    try:
        experiments = _json.loads(exp_res["data"])
    except Exception:
        return {"available": False, "experiments": []}

    out = []
    for e in (experiments if isinstance(experiments, list) else []):
        eid = e.get("experiment_id") or e.get("id")
        name = e.get("name", "")
        runs_res = await proxy_client.request(
            "mlflow-app", "GET", "/api/runs", {"experiment_id": str(eid), "limit": "5"})
        runs = []
        try:
            rd = _json.loads(runs_res["data"]) if runs_res.get("ok") else []
            runs = rd if isinstance(rd, list) else rd.get("runs", [])
        except Exception:
            runs = []
        out.append({"name": name, "experiment_id": eid, "n_runs": len(runs),
                    "latest": [{"run_name": r.get("run_name") or r.get("name", ""),
                                "metrics": r.get("metrics", {})} for r in runs[:3]]})
    return {"available": True, "experiments": out}


@router.get("/meta/check-dataset-path")
async def check_dataset_path(path: str = ""):
    """Proxy : demande à Dataset_Explorer_App si ce chemin correspond DÉJÀ à un dataset connu
    (sous un autre nom potentiellement) — avertissement de doublon dès la config du
    nœud Dataset Source, avant même de lancer le graphe. Renvoie [] si l'app n'est
    pas encore lancée ou ne répond pas — un check indisponible n'est pas une erreur
    bloquante, juste "rien à signaler pour l'instant"."""
    if not path.strip():
        return []
    import json as _json
    from backend.utils.native_share import normalize_input_path
    path = normalize_input_path(path.strip())
    result = await proxy_client.request("Dataset_Explorer_App", "GET", "/api/datasets/check-path", {"root_path": path})
    if result.get("ok"):
        try:
            data = _json.loads(result["data"])
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []


@router.get("/meta/check-annotation-source")
async def check_annotation_source(subset_name: str = "", project_name: str = ""):
    """Proxy : demande à Annotation_App si ce subset a DÉJÀ été importé dans un
    projet d'annotation (sous un autre nom potentiellement) — avertissement dès la
    config du nœud Annotation, avant même de lancer le graphe. Même logique que
    check-dataset-path (best-effort, [] si l'app ne répond pas).

    `project_name` = le projet que CE nœud va (ré)utiliser : il est exclu du
    résultat. Sans ce filtre, un nœud se signalait lui-même — « déjà annoté »
    juste après avoir créé le projet, y compris sur un fork qui réutilise
    volontairement son propre projet."""
    if not subset_name.strip():
        return []
    import json as _json
    result = await proxy_client.request("Annotation_App", "GET", "/api/orchestrator/check-source", {"subset_name": subset_name})
    if result.get("ok"):
        try:
            data = _json.loads(result["data"])
            if isinstance(data, list):
                own = project_name.strip()
                return [m for m in data if not (own and m.get("name") == own)]
        except Exception:
            pass
    return []


@router.get("/meta/annotation-exports")
async def get_annotation_exports(project_name: str = ""):
    """Proxy: list YOLO exports from Annotation_App for a given project."""
    import json as _json
    params = {"project_name": project_name} if project_name else {}
    result = await proxy_client.request("Annotation_App", "GET", "/api/exports", params)
    if result.get("ok"):
        try:
            data = _json.loads(result["data"])
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []


# ── Workspace scan — existing outputs even without running ────────────────────

@router.get("/meta/workspace-outputs")
def get_workspace_outputs():
    """Scan workspace dirs for existing subsets (explorer) and YOLO exports (annotation)."""
    from backend.config import WORKSPACE, CURRENT_USER
    from pathlib import Path
    from datetime import datetime

    IMG_EXT = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp'}
    subsets: list[dict] = []
    exports: list[dict] = []

    # explorer subsets — each subdirectory of explorer_{user}/subsets/ is a subset
    subsets_dir = WORKSPACE / f"explorer_{CURRENT_USER}" / "subsets"
    if subsets_dir.exists():
        for d in sorted(subsets_dir.iterdir()):
            if d.is_dir():
                count = sum(1 for f in d.iterdir() if f.suffix.lower() in IMG_EXT)
                subsets.append({"name": d.name, "image_count": count})

    # Annotation exports — ZIP/dirs (YOLO) et fichiers .ver (natif) dans annotation_{user}/exports/.
    # Format détecté par item (pas de tri unique) : Training/Optuna ne veulent QUE le
    # YOLO (data.yaml), Inference/Éval ne veut QUE le .ver — les mélanger dans une seule
    # liste forçait l'utilisateur à deviner. Le frontend les affiche en 2 blocs distincts.
    exports_dir = WORKSPACE / f"annotation_{CURRENT_USER}" / "exports"
    if exports_dir.exists():
        seen: set[str] = set()
        items = sorted(exports_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        for item in items:
            if item.suffix.lower() == ".ver":
                fmt, name = "ver", item.stem
            elif item.suffix.lower() == ".zip":
                # Le suffixe ZIP ne décrit pas le format. Les exports .ver sont
                # également empaquetés, mais ne contiennent jamais data.yaml.
                try:
                    import zipfile
                    with zipfile.ZipFile(item, "r") as archive:
                        is_yolo = any(Path(member).name == "data.yaml" for member in archive.namelist())
                except (OSError, zipfile.BadZipFile):
                    is_yolo = False
                fmt, name = ("yolo" if is_yolo else "ver"), item.stem
            elif item.is_dir() and ((item / "data.yaml").exists() or any(item.rglob("data.yaml"))):
                fmt, name = "yolo", item.name
            elif item.is_dir() and any(item.rglob("*.ver")):
                fmt, name = "ver", item.name
            else:
                continue  # ni .ver ni YOLO reconnu (ex: dossier COCO) — pas encore branché ici
            key = (fmt, name)
            if key in seen:
                continue
            seen.add(key)
            mtime = item.stat().st_mtime
            exports.append({
                "name": name,
                "format": fmt,
                "created_at": datetime.fromtimestamp(mtime).isoformat(),
            })

    return {"subsets": subsets, "exports": exports}


# ── step6 : DVC OBSERVATEUR — hub artefacts (récup / download / commit) ───────

def _gather_graph_artifacts(g: dict, requested_run_id: str | None = None) -> list[dict]:
    """Artefacts recuperables/versionnables pour UN run precis.

    Une ancienne implementation retombait sur le fichier le plus recent du
    workspace quand le graphe n'avait pas encore de run. Un fork vierge
    affichait alors les sorties de son parent comme si elles venaient de lui.
    Ici chaque chemin provient exclusivement des sorties de l'experiment du run,
    de son run_lineage, ou de son dossier Insights exact.
    """
    from backend.config import WORKSPACE, CURRENT_USER
    import json as _json
    from pathlib import Path
    from urllib.parse import quote

    nodes = g.get("nodes", [])
    types = {(n.get("data", {}).get("node_type") or n.get("type", "")) for n in nodes}

    def fileinfo(path):
        if path and Path(path).exists():
            p = Path(path)
            if p.is_dir():
                files = [item for item in p.rglob("*") if item.is_file()]
                logical_size = sum(item.stat().st_size for item in files)
                physical_size = sum(item.lstat().st_size for item in files if not item.is_symlink())
            else:
                logical_size = physical_size = p.stat().st_size
            return {"path": str(p), "exists": True,
                    "size_mb": round(logical_size / 1e6, 2),
                    "storage_mb": round(physical_size / 1e6, 2),
                    "download": f"/api/graphs/meta/download?path={quote(str(p))}"}
        return {"path": str(path) if path else None, "exists": False, "download": None}

    # Le run doit être explicite. Sans `run_id`, on renvoie seulement le plan
    # (exists=false), même si le graphe possède un ancien run ou un run actif.
    # Ainsi aucune requête incomplète ne peut retomber sur un contexte différent.
    run_id = requested_run_id
    lineage = (g.get("run_lineage") or {}).get(run_id, {}) if run_id else {}
    experiment = experiment_store.get_experiment_by_run(run_id) if run_id else None

    def step_payload(suffix: str) -> dict:
        if not experiment:
            return {}
        for step_id, rec in experiment.steps.items():
            if not step_id.endswith(suffix) or rec.status != "success":
                continue
            raw = rec.output.get("output", rec.output) if isinstance(rec.output, dict) else rec.output
            if isinstance(raw, dict):
                return raw
            try:
                parsed = _json.loads(str(raw))
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                # Compatibilité avec les runs historiques dont la réponse proxy
                # était coupée à 4 Ko. On récupère les chemins complets présents
                # avant la coupure, sans jamais chercher un artefact global.
                import re
                text = str(raw)
                recovered: dict = {}
                for key in ("best_model_path", "zip_path", "export_path"):
                    match = re.search(rf'"{key}"\s*:\s*("(?:\\.|[^"\\])*")', text)
                    if match:
                        try:
                            recovered[key] = _json.loads(match.group(1))
                        except Exception:
                            pass
                return recovered
        return {}

    yolo = step_payload("__exportyolo")
    ver = step_payload("__exportver")
    train = step_payload("__train")
    hpo = step_payload("__hpo")
    hpo_error = hpo.get("error")
    if not hpo_error and hpo.get("ok") is True and hpo.get("n_trials") and not (hpo.get("best_params") or hpo.get("params")):
        hpo_error = (
            f"ÉCHEC HPO — 0/{hpo.get('n_trials')} trial abouti. Aucun best_params Optuna produit. "
            "Le Training historique a continué avec les paramètres configurés/défauts, sans optimisation Optuna."
        )

    dataset_path = yolo.get("zip_path") or yolo.get("export_path")
    if not dataset_path and lineage.get("dataset"):
        candidate = WORKSPACE / f"annotation_{CURRENT_USER}" / "exports" / f"{lineage['dataset']}.zip"
        dataset_path = str(candidate) if candidate.exists() else None

    annotations_path = ver.get("export_path")
    if annotations_path and Path(annotations_path).is_dir():
        exact_ver_files = sorted(Path(annotations_path).rglob("*.ver"))
        annotations_path = str(exact_ver_files[0]) if exact_ver_files else None

    model_path = train.get("best_model_path") or lineage.get("model_path")
    best_params = hpo.get("best_params") or hpo.get("params")
    if not best_params:
        opt = next((n for n in nodes if (n.get("data", {}).get("node_type") or n.get("type", "")) == "optuna"), None)
        opt_data = (opt or {}).get("data", {})
        # Un fork duplique la configuration visuelle du parent, y compris le
        # best_params affiché sur son node. En mode AUTO, cette valeur n'est pas
        # une production du nouveau run : seul le payload __hpo réussi fait foi.
        # Le fallback node reste légitime uniquement en mode manuel, où les
        # paramètres sont explicitement fournis par l'utilisateur.
        best_params = opt_data.get("best_params") if run_id and opt_data.get("full_auto") is False else None

    metrics_json = WORKSPACE / "insights" / str(g.get("graph_id", "")) / str(run_id) / "metrics.json" if run_id else None
    has_run = bool(run_id)

    arts: list[dict] = []
    # `present` decrit le plan du graphe ; `exists` dit si CE run l'a produit.
    arts.append({"kind": "dataset", "label": "Dataset YOLO (images + labels)",
                 "artifact_type": "dataset", "format": "yolo", "schema": "yolo-dataset-v1",
                 "producer_step_id": next((sid for sid in (experiment.steps if experiment else {}) if sid.endswith("__exportyolo")), None),
                 "present": bool(types & {"annotation", "explorer", "dataset_source"}),
                 **fileinfo(dataset_path if has_run else None)})
    arts.append({"kind": "annotations", "label": "Annotations GT (.ver)",
                 "artifact_type": "annotations", "format": "ver", "schema": "vision-ver-v1",
                 "producer_step_id": next((sid for sid in (experiment.steps if experiment else {}) if sid.endswith("__exportver")), None),
                 "present": "annotation" in types, **fileinfo(annotations_path if has_run else None)})
    arts.append({"kind": "model", "label": "Best model (.pt)",
                 "present": "training" in types, **fileinfo(model_path if has_run else None)})
    arts.append({"kind": "optuna", "label": "Meilleurs params Optuna",
                 "present": "optuna" in types, "value": best_params or None,
                 "exists": bool(has_run and best_params), "download": None,
                 "error": hpo_error})
    arts.append({"kind": "metrics", "label": "Métriques finales (metrics.json)",
                 "present": bool(types & {"inference", "training", "optuna"}),
                 **(fileinfo(metrics_json) if has_run else {"path": None, "exists": False, "download": None})})
    arts.append({"kind": "graph", "label": "Snapshot du graphe (JSON)",
                 "present": True, "exists": has_run,
                 "download": f"/api/graphs/{g.get('graph_id')}/download-graph" if has_run else None})
    for art in arts:
        art["run_id"] = run_id
        art["state"] = "failed" if art.get("error") else ("produced" if art.get("exists") else "planned")
    return arts


@router.get("/{graph_id}/artifacts")
def get_graph_artifacts(graph_id: str, run_id: str | None = None):
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    known_runs = {h.get("run_id") for h in (g.get("run_history") or []) if isinstance(h, dict)}
    known_runs.update((g.get("run_lineage") or {}).keys())
    if g.get("active_run_id"):
        known_runs.add(g["active_run_id"])
    if run_id and run_id not in known_runs:
        raise HTTPException(404, "Run introuvable pour ce graphe")
    return {"available": True, "run_id": run_id, "artifacts": _gather_graph_artifacts(g, run_id)}


@router.get("/{graph_id}/runs/{run_id}/manifest")
def get_run_manifest(graph_id: str, run_id: str):
    """Index canonique d'un run, sans aucun fallback vers un autre run."""
    from backend.core import run_manifest
    manifest = run_manifest.load(run_id)
    if not manifest or str(manifest.get("graph_id")) != graph_id:
        raise HTTPException(404, "Manifeste de run introuvable pour ce graphe")
    return manifest


@router.get("/meta/download")
def download_file(path: str):
    """Sert un artefact du workspace ; les dossiers sont zippés temporairement."""
    from backend.config import WORKSPACE
    from pathlib import Path
    from fastapi.responses import FileResponse
    p = Path(path).resolve()
    try:
        p.relative_to(WORKSPACE.resolve())   # lève si hors workspace
    except ValueError:
        raise HTTPException(403, "Chemin hors du workspace")
    if not p.exists():
        raise HTTPException(404, "Artefact introuvable")
    if p.is_file():
        return FileResponse(str(p), filename=p.name)
    if p.is_dir():
        import shutil
        import tempfile
        from fastapi.background import BackgroundTask
        temp_root = Path(tempfile.mkdtemp(prefix="orchestrator_artifact_"))
        archive = Path(shutil.make_archive(str(temp_root / p.name), "zip", root_dir=p.parent, base_dir=p.name))
        return FileResponse(
            str(archive),
            filename=f"{p.name}.zip",
            media_type="application/zip",
            background=BackgroundTask(shutil.rmtree, temp_root, ignore_errors=True),
        )
    raise HTTPException(404, "Artefact non téléchargeable")


@router.get("/{graph_id}/download-graph")
def download_graph(graph_id: str):
    import json as _json, io
    from fastapi.responses import StreamingResponse
    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    buf = io.BytesIO(_json.dumps(g, ensure_ascii=False, indent=2).encode("utf-8"))
    return StreamingResponse(buf, media_type="application/json",
                             headers={"Content-Disposition": f'attachment; filename="graph_{graph_id}.json"'})


# ── Lineage : helpers MLflow (GET direct httpx, pas proxy_client qui tronque à 4000) ──

async def _mlflow_get(endpoint: str, params: dict | None = None):
    import httpx
    from backend.config import APP_URLS
    base = APP_URLS.get("mlflow-app")
    if not base:
        return None
    if not endpoint.startswith("/api"):
        endpoint = f"/api{endpoint}" if endpoint.startswith("/") else f"/api/{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(f"{base}{endpoint}", params=params or None)
            if r.status_code < 400:
                return r.json()
    except Exception:
        pass
    return None


async def _mlflow_runs_for_orch_run(run_id: str) -> list[dict]:
    """Runs MLflow taggués `orch_run_id == run_id` (lien exact Run <-> run MLflow)."""
    if not run_id:
        return []
    exps = await _mlflow_get("/api/experiments") or []
    out: list[dict] = []
    for exp in exps if isinstance(exps, list) else []:
        eid = exp.get("experiment_id") or exp.get("id")
        if eid is None:
            continue
        runs = await _mlflow_get("/api/runs", {"experiment_id": str(eid)}) or []
        for r in runs if isinstance(runs, list) else []:
            if (r.get("tags") or {}).get("orch_run_id") == run_id:
                out.append(r)
    return out


def _extract_map50(runs: list[dict]):
    """mAP50 finale la plus fiable parmi les runs (evite le 50-95)."""
    for r in runs:
        m = r.get("metrics") or {}
        for key in ("final_mAP50", "metrics/mAP50B", "mAP50"):
            if key in m:
                return m[key]
        for k, v in m.items():
            kl = k.lower()
            if "map50" in kl and "50-95" not in kl and "5095" not in kl:
                return v
    return None


async def _backfill_mlflow_tags(run_ids: list[str], tags: dict) -> None:
    """Boucle le lineage cote MLflow : pose git_commit / dataset_version sur les runs
    du run. 100 % best-effort (le commit reste valide meme si MLflow est indispo)."""
    tags = {k: v for k, v in tags.items() if v}
    if not tags:
        return
    for rid in run_ids or []:
        try:
            await proxy_client.request("mlflow-app", "POST", f"/api/runs/{rid}/tags",
                                       {"tags": tags}, timeout=15.0)
        except Exception:
            pass


class DvcCommitBody(BaseModel):
    run_id: str
    kinds: list[str] = []
    message: str = "feat: version artifacts"


@router.post("/{graph_id}/dvc-commit")
async def dvc_commit_selected(graph_id: str, body: DvcCommitBody):
    """Versionne dans DVC les artefacts SÉLECTIONNÉS (hub observateur, step6) et
    ENREGISTRE le lineage : trailers git dans le commit (Run-Id/Graph-Id/Dataset/
    mAP50/MLflow-Run), persistance cote graphe (run_lineage), et back-fill des tags
    git_commit/dataset_version sur les runs MLflow du run."""
    import json as _json
    from pathlib import Path
    from datetime import datetime, timezone

    g = graph_store.get_graph(graph_id)
    if not g:
        raise HTTPException(404, "Graphe introuvable")
    run_id = body.run_id
    completed = {
        h.get("run_id") for h in (g.get("run_history") or [])
        if isinstance(h, dict) and h.get("status") in ("done", "success")
    }
    if run_id not in completed:
        raise HTTPException(409, "Le run doit être terminé avant de créer une version DVC")
    arts = {a["kind"]: a for a in _gather_graph_artifacts(g, run_id)}

    dataset_name = None
    if arts.get("dataset", {}).get("path"):
        dataset_name = Path(arts["dataset"]["path"]).stem  # ex. Annot_voiture_demo-yolo

    # Runs MLflow du run (pour trailers + back-fill) — best-effort.
    ml_runs = await _mlflow_runs_for_orch_run(run_id) if run_id else []
    ml_run_ids = [r.get("run_id") for r in ml_runs if r.get("run_id")]
    map50 = _extract_map50(ml_runs)

    # Message enrichi de trailers git (lineage lisible ET machine-readable).
    trailers: list[str] = []
    if run_id:
        trailers.append(f"Run-Id: {run_id}")
    trailers.append(f"Graph-Id: {graph_id}")
    trailers.append(f"Graph-Name: {g.get('name') or graph_id}")
    parent_run_id = (g.get("forked_from") or {}).get("run_id")
    if parent_run_id:
        trailers.append(f"Parent-Run: {parent_run_id}")
    if dataset_name:
        trailers.append(f"Dataset: {dataset_name}")
    if map50 is not None:
        try:
            trailers.append(f"mAP50: {float(map50):.4f}")
        except (TypeError, ValueError):
            pass
    for rid in ml_run_ids:
        trailers.append(f"MLflow-Run: {rid}")
    message = body.message + ("\n\n" + "\n".join(trailers) if trailers else "")

    params: dict = {"message": message}
    if "dataset" in body.kinds and arts.get("dataset", {}).get("exists"):
        params["dataset_path"] = arts["dataset"]["path"]
    if "model" in body.kinds and arts.get("model", {}).get("exists"):
        params["model_path"] = arts["model"]["path"]
    if "annotations" in body.kinds and arts.get("annotations", {}).get("exists"):
        params["annotations_path"] = arts["annotations"]["path"]
    if "metrics" in body.kinds and arts.get("metrics", {}).get("exists"):
        params["metrics_path"] = arts["metrics"]["path"]
    if "optuna" in body.kinds and arts.get("optuna", {}).get("value"):
        params["params_json"] = _json.dumps(arts["optuna"]["value"], ensure_ascii=False)
    if "graph" in body.kinds:
        params["graph_json"] = _json.dumps(g, ensure_ascii=False)
    if len(params) == 1:  # rien de versionnable sélectionné (que "message")
        return {"ok": False, "error": "Aucun artefact existant sélectionné à versionner."}

    result = await proxy_client.request("dvc-app", "POST", "/api/orchestrator/commit", params, timeout=600.0)
    if not result.get("ok"):
        return {"ok": False, "error": str(result.get("data", "échec commit"))[:300]}

    # Reponse commit (JSON string) -> hash + fichiers versionnes.
    commit_hash, dvc_versioned = "", []
    try:
        d = _json.loads(result.get("data") or "{}")
        commit_hash = d.get("commit_hash", "") or ""
        dvc_versioned = d.get("dvc_versioned", []) or []
    except Exception:
        d = {}

    # Persistance du lineage cote graphe (lu par les insights) + back-fill MLflow.
    if run_id:
        graph_store.set_run_lineage(graph_id, run_id, {
            "git_commit":     commit_hash or None,
            "dvc_versioned":  dvc_versioned or None,
            "dataset":        dataset_name,
            "model_path":     arts.get("model", {}).get("path"),
            "map50":          map50,
            "mlflow_run_ids": ml_run_ids or None,
            "committed_at":   datetime.now(timezone.utc).isoformat(),
        })
        await _backfill_mlflow_tags(ml_run_ids, {
            "git_commit":      commit_hash,
            "dataset_version": dataset_name,
        })
        # Regenere l'insight du run APRES le commit : sinon la carte d'identite /
        # reproductibilite reste figee sur l'etat pre-commit (git_commit absent,
        # modele absent...) alors que le lineage vient d'etre renseigne (bug fork).
        try:
            from backend.core import insights as _insights
            await _insights.generate(graph_id, run_id)
        except Exception as exc:
            dbg.warning("graphs", "dvc_commit", "regeneration insight echouee", error=str(exc)[:200])

    return {"ok": True,
            "message": f"Commit DVC : {', '.join(k for k in body.kinds)}",
            "commit_hash": commit_hash,
            "run_id": run_id}


# ── Webhook: called by Annotation_App when user exports ───────────────────────

@router.post("/{graph_id}/webhook/annotation-exported", status_code=202)
async def annotation_exported_webhook(graph_id: str):
    """
    Annotation_App calls this endpoint when the user completes an export.
    Auto-resumes the graph pipeline if it is waiting at the annotation human gate.
    """
    g = graph_store.get_graph(graph_id)
    if not g or g.get("status") != "waiting":
        return {"ok": False, "reason": "graph not waiting"}

    run_id = g.get("active_run_id")
    if not run_id or not pipeline_runner.run_in_memory(run_id):
        return {"ok": False, "reason": "run not in memory"}

    ok = await pipeline_runner.resume_run(run_id)
    if ok:
        graph_store.update_graph(graph_id, status="running")
    return {"ok": ok}
