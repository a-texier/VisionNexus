# ============================================================
# api/lineage.py
# Graphe de lineage inter-experiences ("fork tree") construit a
# partir de TOUS les graphes : datasets -> runs -> modeles, plus
# les aretes de fork entre graphes parents et enfants.
# Lecture seule, defensif : un run sans lineage apparait quand meme
# (marque "non versionne"). Aucune URL resolue cote serveur — le
# frontend deep-linke via /api/graphs/meta/app-urls.
# ============================================================

import hashlib
import json
from pathlib import Path

from fastapi import APIRouter, Query

from backend.core import graph_store
from backend.core import insights as insights_mod
from backend.core import experiment_store

router = APIRouter(prefix="/api/lineage", tags=["lineage"])
# (dedup dataset via dvc_version resolu depuis l'insight — cf. boucle plus bas)


def _short(s: str, n: int = 8) -> str:
    return s[:n] if isinstance(s, str) else ""


def _mlflow_run_ids(lineage: dict) -> list[str]:
    """Extrait la liste des run_id MLflow, quel que soit le format stocke
    (`mlflow_run_ids` = liste de str, ou `mlflow_runs` = liste de dicts)."""
    ids: list[str] = []
    raw = lineage.get("mlflow_run_ids")
    if isinstance(raw, list):
        for r in raw:
            if isinstance(r, str) and r:
                ids.append(r)
            elif isinstance(r, dict) and r.get("run_id"):
                ids.append(r["run_id"])
    runs = lineage.get("mlflow_runs")
    if isinstance(runs, list):
        for r in runs:
            if isinstance(r, dict) and r.get("run_id") and r["run_id"] not in ids:
                ids.append(r["run_id"])
    return ids


def _dataset_key(name: str, git_commit, dvc_version) -> str:
    """Cle de dedup d'une version de dataset : nom + (dvc_version ou git_commit)."""
    ver = dvc_version or git_commit or "novers"
    raw = f"{name}::{ver}"
    return "dataset:" + hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]


def _source_key(path: str | None, name: str | None) -> str:
    raw = str(path or name or "dataset-source").replace("\\", "/").lower()
    return "source:" + hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]


def _decoded_step_output(insight: dict, suffix: str) -> dict:
    """Retour structuré d'une étape précise du run, depuis son Insight figé."""
    for step in insight.get("steps") or []:
        if not isinstance(step, dict) or not str(step.get("step_id", "")).endswith(suffix):
            continue
        raw = step.get("output") or {}
        if isinstance(raw, dict) and "output" in raw:
            raw = raw.get("output")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                return {}
        return raw if isinstance(raw, dict) else {}
    return {}


def _decoded_run_step_output(run_id: str, suffix: str) -> dict:
    """Fallback exact sur le journal d'exécution quand l'Insight n'a pas été figé."""
    experiment = experiment_store.get_experiment_by_run(run_id)
    if not experiment:
        return {}
    for step_id, record in experiment.steps.items():
        if not str(step_id).endswith(suffix):
            continue
        raw = record.output.get("output", record.output) if isinstance(record.output, dict) else record.output
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                return {}
        return raw if isinstance(raw, dict) else {}
    return {}


def _artifact_dataset_name(insight: dict) -> str | None:
    for artifact in insight.get("artifacts") or []:
        if not isinstance(artifact, dict) or artifact.get("kind") != "dataset" or not artifact.get("exists"):
            continue
        path = str(artifact.get("path") or "").replace("\\", "/").rstrip("/")
        if path:
            name = Path(path).name
            return name[:-4] if name.lower().endswith(".zip") else name
    return None


def _dataset_context(graph: dict, run_id: str, insight: dict, lineage: dict) -> dict:
    """Identité du dataset réellement utilisé par CE run.

    Le commit du parent n'est jamais un fallback pour un fork. Le subset vient de
    l'Insight du run (sortie __subset), puis des paramètres du graphe concerné.
    """
    source_node = next((n for n in graph.get("nodes", []) if (n.get("data") or {}).get("node_type") == "dataset_source"), {})
    explorer_node = next((n for n in graph.get("nodes", []) if (n.get("data") or {}).get("node_type") == "explorer"), {})
    source_data = source_node.get("data") or {}
    explorer_data = explorer_node.get("data") or {}
    loaded = _decoded_step_output(insight, "__load") or _decoded_run_step_output(run_id, "__load")
    subset = _decoded_step_output(insight, "__subset") or _decoded_run_step_output(run_id, "__subset")
    source_path = loaded.get("root_path") or source_data.get("dataset_path")
    source_name = loaded.get("name") or source_data.get("dataset_name") or "Dataset source"
    source_count = loaded.get("image_count")
    subset_name = subset.get("subset_name") or explorer_data.get("subset_name")
    subset_count = subset.get("image_count")
    query = subset.get("query") or explorer_data.get("query")
    dataset_export = _artifact_dataset_name(insight) or lineage.get("dataset")
    if not subset_name and dataset_export:
        subset_name = str(dataset_export).removeprefix("Annot_").removesuffix("-yolo")
    return {
        "source_dataset": source_name,
        "source_path": source_path,
        "source_image_count": source_count,
        "subset_name": subset_name or dataset_export or "Subset non identifié",
        "subset_image_count": subset_count,
        "subset_query": query,
        "dataset_export": dataset_export,
    }


def _node_data(graph: dict, node_type: str) -> dict:
    node = next(
        (n for n in graph.get("nodes", []) if (n.get("data") or {}).get("node_type") == node_type),
        {},
    )
    return dict(node.get("data") or {})


def _comparison_snapshot(
    graph: dict,
    dataset_ctx: dict,
    artifacts: list[dict],
    mlflow_runs: list[dict],
    *,
    model_path,
    map50,
) -> dict:
    """Configuration logique stable utilisée par les trois interfaces de diff."""
    source = _node_data(graph, "dataset_source")
    annotation = _node_data(graph, "annotation")
    optuna_cfg = _node_data(graph, "optuna")
    training = _node_data(graph, "training")
    annotations = next((a for a in artifacts if a.get("kind") == "annotations" and a.get("exists")), {})
    hpo_artifact = next((a for a in artifacts if a.get("kind") == "optuna" and a.get("exists")), {})
    produced = [
        {
            "kind": a.get("kind"),
            "label": a.get("label"),
            "state": a.get("state"),
            "path": a.get("path"),
        }
        for a in artifacts if isinstance(a, dict) and a.get("exists")
    ]
    training_keys = (
        "yolo_version", "model_size", "epochs", "batch", "imgsz", "lr0", "lrf",
        "momentum", "weight_decay", "patience", "device", "workers",
    )
    return {
        "dataset_source": {
            "name": dataset_ctx.get("source_dataset"),
            "path": dataset_ctx.get("source_path"),
            "image_count": dataset_ctx.get("source_image_count"),
            "clusters": source.get("n_clusters"),
        },
        "subset": {
            "name": dataset_ctx.get("subset_name"),
            "image_count": dataset_ctx.get("subset_image_count"),
            "query": dataset_ctx.get("subset_query"),
        },
        "annotations_yolo": {
            "export": dataset_ctx.get("dataset_export"),
            "project": annotation.get("project_name"),
            "mode": annotation.get("annotation_mode"),
            "model": annotation.get("ai_model"),
            "prompt": annotation.get("ai_text"),
            "classes": annotation.get("label_classes") or [],
        },
        "annotations_ver": {
            "path": annotations.get("path"),
            "name": Path(str(annotations.get("path") or "")).name or None,
        },
        "hpo": {
            "trials": optuna_cfg.get("n_trials"),
            "optimize": optuna_cfg.get("optimize") or [],
            "stop_on_failure": optuna_cfg.get("stop_on_failure"),
            # Le node contient la configuration visuelle du graphe et peut avoir
            # été dupliqué depuis le parent lors d'un fork. Seul l'artefact HPO
            # explicitement produit par CE run prouve l'existence de best_params.
            "best_params": hpo_artifact.get("value") or None,
        },
        "training": {key: training.get(key) for key in training_keys if training.get(key) is not None},
        "model": {
            "path": model_path,
            "name": Path(str(model_path or "")).name or None,
        },
        "mlflow": {
            "run_ids": [r.get("run_id") for r in mlflow_runs if r.get("run_id")],
            "stages": [
                {
                    "run_id": r.get("run_id"),
                    "name": r.get("run_name"),
                    "type": (r.get("tags") or {}).get("run_type"),
                    "metrics": r.get("metrics") or {},
                }
                for r in mlflow_runs
            ],
        },
        "artifacts": produced,
        "metrics": {"map50": map50},
    }


@router.get("")
def get_lineage(
    include_failed: bool = Query(
        False,
        description="Inclure les runs techniques failed/interrupted dans la réponse d'audit",
    ),
):
    """Nodes + edges du lineage a travers TOUS les graphes.

    Types de node : "source_dataset" | "dataset" | "run" | "model" |
    "stage" | "artifact".
    Chaque node porte les champs bruts necessaires aux deep-links
    (mlflow_run_ids, git_commit, dataset, graph_id, run_id, dvc_version,
    model_path). Les URLs sont resolues cote frontend.
    """
    # Parent d'abord : si un fork réutilise exactement le même dataset, le node
    # partagé conserve les métadonnées DVC versionnées du parent.
    graphs = sorted(graph_store.list_graphs(), key=lambda graph: bool(graph.get("forked_from")))

    nodes: list[dict] = []
    edges: list[dict] = []
    seen_nodes: set[str] = set()
    seen_edges: set[str] = set()
    # run_id -> node_id, pour relier les aretes de fork (le parent peut etre
    # reference sans que son run soit encore parcouru).
    run_node_by_run: dict[str, str] = {}
    insight_runs_by_graph: dict[str, list[str]] = {}
    for item in insights_mod.list_all():
        gid, rid = item.get("graph_id"), item.get("run_id")
        if gid and rid:
            insight_runs_by_graph.setdefault(gid, []).append(rid)

    def add_node(node: dict) -> None:
        if node["id"] in seen_nodes:
            return
        seen_nodes.add(node["id"])
        nodes.append(node)

    def add_edge(source: str, target: str, kind: str) -> None:
        eid = f"{source}->{target}:{kind}"
        if eid in seen_edges:
            return
        seen_edges.add(eid)
        edges.append({"id": eid, "source": source, "target": target, "kind": kind})

    excluded_runs: list[dict] = []

    for g in graphs:
        graph_id = g.get("graph_id", "")
        graph_name = g.get("name", graph_id)
        run_lineage = g.get("run_lineage") or {}
        run_history = g.get("run_history") or []

        # Statut connu par run (depuis l'historique) pour colorer / informer.
        status_by_run = {
            h.get("run_id"): h.get("status")
            for h in run_history
            if isinstance(h, dict) and h.get("run_id")
        }
        active_run_id = g.get("active_run_id")
        if active_run_id:
            status_by_run[active_run_id] = g.get("status") or "running"

        # Ensemble des runs a afficher : historique + tout run ayant du lineage.
        run_ids: list[str] = []
        for h in run_history:
            rid = h.get("run_id") if isinstance(h, dict) else None
            if rid and rid not in run_ids:
                run_ids.append(rid)
        for rid in run_lineage.keys():
            if rid and rid not in run_ids:
                run_ids.append(rid)
        if active_run_id and active_run_id not in run_ids:
            run_ids.append(active_run_id)
        # Un arrêt d'app ou un redémarrage peut nettoyer active_run_id avant
        # d'écrire run_history. L'Insight du run reste alors la seule preuve de
        # son exécution partielle : il ne faut surtout pas le remplacer par un
        # faux fork « non lancé ».
        for rid in insight_runs_by_graph.get(graph_id, []):
            if rid not in run_ids:
                run_ids.append(rid)

        for run_id in run_ids:
            lineage = run_lineage.get(run_id) or {}
            insight = insights_mod.load(graph_id, run_id) or {}
            from backend.core import run_manifest
            manifest = run_manifest.load(run_id) or {}
            insight_only = run_id not in status_by_run and run_id not in run_lineage
            if insight_only:
                step_statuses = [str(n.get("status") or "") for n in (insight.get("nodes") or []) if isinstance(n, dict)]
                status_by_run[run_id] = str(manifest.get("status") or (
                    "failed" if "failed" in step_statuses
                    else "interrupted" if any(s in ("running", "waiting", "interrupted") for s in step_statuses)
                    else "partial"
                ))
            run_status = str(status_by_run.get(run_id) or manifest.get("status") or "").lower()
            published = run_status in {"done", "success", "completed"}
            # Les très anciens runs versionnés n'avaient pas tous de statut terminal,
            # mais leur commit DVC constitue un contrat de publication explicite.
            if not run_status and lineage.get("git_commit"):
                published = True
            if not include_failed and not published:
                excluded_runs.append({
                    "graph_id": graph_id,
                    "run_id": run_id,
                    "status": run_status or "unknown",
                })
                continue
            git_commit = lineage.get("git_commit")
            dataset = lineage.get("dataset")
            dvc_version = lineage.get("dvc_version") or lineage.get("dataset_version")
            # run_lineage ne stocke pas le md5 du dataset -> on le recupere depuis
            # l'insight du run (qui l'a resolu). Indispensable pour DEDUP : deux runs
            # sur la MEME version (ex. reutilisation) doivent partager le node dataset,
            # sinon ils apparaissent comme deux versions distinctes (clef = git commit).
            if not dvc_version:
                dvc_version = (insight.get("lineage") or {}).get("dvc_version")
            insight_lineage = insight.get("lineage") or {}
            model_path = lineage.get("model_path") or insight_lineage.get("model_path")
            map50 = lineage.get("map50")
            if map50 is None and not insight_only:
                map50 = insight_lineage.get("map50")
            dataset_ctx = _dataset_context(g, run_id, insight, lineage)
            # Le nom du dataset produit doit venir du run courant. Sur un fork non
            # committé, lineage.dataset peut encore refléter le snapshot parent.
            dataset = dataset_ctx.get("dataset_export") or dataset
            ml_ids = _mlflow_run_ids(lineage)
            versioned = bool(git_commit or dvc_version or ml_ids)
            mlflow_runs = (insight.get("lineage") or {}).get("mlflow_runs") or []
            if not isinstance(mlflow_runs, list):
                mlflow_runs = []
            artifacts = manifest.get("outputs") or insight.get("artifacts") or []
            if not artifacts:
                try:
                    from backend.api.graphs import _gather_graph_artifacts
                    artifacts = _gather_graph_artifacts(g, run_id)
                except Exception:
                    artifacts = []
            comparison = _comparison_snapshot(
                g, dataset_ctx, artifacts if isinstance(artifacts, list) else [], mlflow_runs,
                model_path=model_path, map50=map50,
            )

            run_node_id = f"run:{graph_id}:{run_id}"
            run_node_by_run[run_id] = run_node_id

            map_txt = f" mAP50 {float(map50):.3f}" if isinstance(map50, (int, float)) else ""
            label = f"{graph_name} · {_short(run_id, 6)}{map_txt}"

            add_node({
                "id":       run_node_id,
                "type":     "run",
                "label":    label,
                "versioned": versioned,
                "data": {
                    "graph_id":       graph_id,
                    "graph_name":     graph_name,
                    "run_id":         run_id,
                    "status":         status_by_run.get(run_id),
                    "published":      published,
                    "git_commit":     git_commit,
                    "dataset":        dataset,
                    "dvc_version":    dvc_version,
                    "model_path":     model_path,
                    "map50":          map50,
                    "mlflow_run_ids": ml_ids,
                    "committed_at":   lineage.get("committed_at"),
                    "versioned":      versioned,
                    "is_fork":        bool(g.get("forked_from")),
                    "parent_run_id":  (g.get("forked_from") or {}).get("run_id"),
                    "insight_only":   insight_only,
                    "comparison":     comparison,
                    **dataset_ctx,
                },
            })

            # Dataset source commun -> run -> subset réellement extrait.
            source_id = _source_key(dataset_ctx.get("source_path"), dataset_ctx.get("source_dataset"))
            source_count = dataset_ctx.get("source_image_count")
            source_count_txt = f" · {source_count} images" if source_count is not None else ""
            add_node({
                "id": source_id,
                "type": "source_dataset",
                "label": f"{dataset_ctx.get('source_dataset') or 'Dataset source'}{source_count_txt}",
                "versioned": bool(dvc_version or git_commit),
                "data": {
                    "source_dataset": dataset_ctx.get("source_dataset"),
                    "source_path": dataset_ctx.get("source_path"),
                    "source_image_count": source_count,
                    "dvc_version": dvc_version,
                },
            })
            add_edge(source_id, run_node_id, "source")

            if dataset or dataset_ctx.get("subset_name"):
                subset_name = str(dataset_ctx.get("subset_name") or dataset)
                # Une version DVC identique est partagée. Avant commit, l'identité
                # repose sur la source + le subset + sa requête/contenu, jamais sur
                # le commit du parent.
                fingerprint = "::".join(str(dataset_ctx.get(k) or "") for k in (
                    "source_path", "subset_name", "subset_image_count", "subset_query"
                )) or dvc_version
                ds_id = _dataset_key(subset_name, None, fingerprint)
                ds_ver = dvc_version or (git_commit and _short(git_commit)) or None
                count_txt = f" · {dataset_ctx.get('subset_image_count')} images" if dataset_ctx.get("subset_image_count") is not None else ""
                ds_label = f"{subset_name}{count_txt}"
                add_node({
                    "id":       ds_id,
                    "type":     "dataset",
                    "label":    ds_label,
                    "versioned": bool(dvc_version or git_commit),
                    "data": {
                        "dataset":     dataset,
                        **dataset_ctx,
                        "git_commit":  git_commit,
                        "dvc_version": dvc_version,
                    },
                })
                add_edge(run_node_id, ds_id, "subset")

            # Run -> modele (dedup par chemin de modele).
            if model_path:
                mdl_id = "model:" + hashlib.md5(str(model_path).encode("utf-8")).hexdigest()[:10]
                mdl_label = str(model_path).replace("\\", "/").rstrip("/").split("/")[-1] or str(model_path)
                add_node({
                    "id":       mdl_id,
                    "type":     "model",
                    "label":    mdl_label,
                    "versioned": True,
                    "data": {
                        "model_path": model_path,
                        "graph_id":   graph_id,
                        "run_id":     run_id,
                        "map50":      map50,
                    },
                })
                add_edge(run_node_id, mdl_id, "model")

            # Etapes MLflow regroupees sous le run pipeline canonique.
            for ml_run in mlflow_runs if isinstance(mlflow_runs, list) else []:
                ml_id = ml_run.get("run_id") if isinstance(ml_run, dict) else None
                if not ml_id:
                    continue
                tags = ml_run.get("tags") or {}
                stage_id = f"stage:{ml_id}"
                add_node({
                    "id": stage_id,
                    "type": "stage",
                    "label": ml_run.get("run_name") or f"MLflow {_short(ml_id)}",
                    "versioned": True,
                    "data": {
                        "run_id": run_id,
                        "mlflow_run_id": ml_id,
                        "run_type": tags.get("run_type") or "run",
                        "metrics": ml_run.get("metrics") or {},
                    },
                })
                add_edge(run_node_id, stage_id, "mlflow")

            # Bundle logique : references exactes ecrites dans Insights. Pour les
            # anciens Insights, le resolver strict reconstruit depuis le run sans
            # jamais chercher le dernier fichier global du workspace.
            for artifact in artifacts if isinstance(artifacts, list) else []:
                if not isinstance(artifact, dict) or not artifact.get("exists"):
                    continue
                kind = artifact.get("kind") or "artifact"
                # Dataset et modele ont deja leurs noeuds dedies au-dessus.
                if kind in ("dataset", "model"):
                    continue
                artifact_id = f"artifact:{graph_id}:{run_id}:{kind}"
                versioned_paths = [str(p).lower() for p in (lineage.get("dvc_versioned") or [])]
                versioned = any(
                    (kind == "annotations" and "annotation" in p)
                    or (kind == "metrics" and "metric" in p)
                    or (kind == "graph" and "graph" in p)
                    or (kind == "optuna" and ("param" in p or "optuna" in p))
                    for p in versioned_paths
                )
                add_node({
                    "id": artifact_id,
                    "type": "artifact",
                    "label": artifact.get("label") or kind,
                    "versioned": versioned,
                    "data": {
                        "graph_id": graph_id,
                        "run_id": run_id,
                        "artifact_kind": kind,
                        "path": artifact.get("path"),
                        "state": artifact.get("state") or "produced",
                        "download": artifact.get("download"),
                    },
                })
                add_edge(run_node_id, artifact_id, "artifact")

    # Aretes de fork : un graphe enfant reference son parent via `forked_from`.
    # Defensif : on ne relie que si le run parent existe reellement comme node.
    for g in graphs:
        forked = g.get("forked_from")
        if not isinstance(forked, dict):
            continue
        parent_graph_id = forked.get("parent_graph_id")
        parent_run_id = forked.get("run_id")
        if not parent_graph_id or not parent_run_id:
            continue
        parent_node_id = f"run:{parent_graph_id}:{parent_run_id}"
        if parent_node_id not in seen_nodes:
            continue
        graph_id = g.get("graph_id", "")
        run_lineage = g.get("run_lineage") or {}
        run_history = g.get("run_history") or []
        child_run_ids: list[str] = []
        for h in run_history:
            rid = h.get("run_id") if isinstance(h, dict) else None
            if rid and rid not in child_run_ids:
                child_run_ids.append(rid)
        for rid in run_lineage.keys():
            if rid and rid not in child_run_ids:
                child_run_ids.append(rid)
        active_run_id = g.get("active_run_id")
        if active_run_id and active_run_id not in child_run_ids:
            child_run_ids.append(active_run_id)
        for rid in insight_runs_by_graph.get(graph_id, []):
            if rid not in child_run_ids:
                child_run_ids.append(rid)
        for rid in child_run_ids:
            child_node_id = f"run:{graph_id}:{rid}"
            if child_node_id in seen_nodes:
                add_edge(parent_node_id, child_node_id, "fork")
        # Un fork existe avant son premier run : il doit apparaitre comme une
        # branche 'non lancee', sans artefacts herites du parent.
        if not child_run_ids:
            draft_id = f"draft:{graph_id}"
            add_node({
                "id": draft_id,
                "type": "run",
                "label": f"{g.get('name', graph_id)} · non lancé",
                "versioned": False,
                "data": {
                    "graph_id": graph_id,
                    "graph_name": g.get("name", graph_id),
                    "run_id": None,
                    "status": "not_started",
                    "draft": True,
                    "parent_run_id": parent_run_id,
                    "versioned": False,
                },
            })
            add_edge(parent_node_id, draft_id, "fork")

    return {
        "nodes": nodes,
        "edges": edges,
        "view": "audit" if include_failed else "published",
        "excluded_runs": excluded_runs,
    }
