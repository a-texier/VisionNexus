# ============================================================
# core/graph_runner.py
# Convertit un sandgraph en PipelineDef et l'exécute.
# Convention step_id : "{node_id}__{action}" (double underscore)
# → node_id = step_id.split("__")[0]
# ============================================================

from backend.core.pipeline_store import PipelineDef, PipelineStep, save_pipeline
from backend.core import graph_store, pipeline_runner


# ── Best params Optuna → hyperparams Training ─────────────────────────────────

def _parse_best_params(raw) -> dict:
    """Parse le champ best_params d'un noeud Optuna. Accepte un dict, du JSON,
    ou une chaine 'lr0=0.02, mosaic=0.4'. Renvoie {} si vide/illisible."""
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    s = str(raw).strip()
    if not s:
        return {}
    try:
        import json
        v = json.loads(s)
        if isinstance(v, dict):
            return v
    except Exception:
        pass
    out: dict = {}
    for part in s.replace(";", ",").split(","):
        if "=" not in part and ":" not in part:
            continue
        k, _, val = part.replace(":", "=").partition("=")
        k, val = k.strip(), val.strip()
        if not k:
            continue
        try:
            out[k] = int(val) if val.isdigit() else float(val)
        except ValueError:
            out[k] = val
    return out


def _export_key(pd: dict) -> str:
    """Nom à utiliser pour retrouver un export sur disque. `export_name` (choisi à la
    main, mode Manuel/FREE — voir NodeConfigPanel) prime sur `project_name` (l'identité
    du projet d'annotation, PAS forcément la même chose que l'export voulu en aval —
    ex: un projet "essai_2" dont on veut réutiliser l'export "essai_1-yolo")."""
    return pd.get("export_name") or pd.get("project_name") or pd.get("subset_name", "")


# ── Résolution du dataset YOLO exporté ────────────────────────────────────────

def _resolve_yolo_dataset(project_name: str, ann_exp: str) -> str:
    """Chemin du dataset YOLO exporté pour un projet d'annotation.

    TOLÉRANT AU NOMMAGE (fix step 9) : l'orchestrateur exportait/attendait
    ``{projet}-yolo`` alors qu'un export MANUEL depuis l'Annotation App peut être
    nommé autrement (``{projet}_2026-…``, nom de séquence, etc.). On accepte donc :
      1. ``{projet}-yolo`` (nom canonique) s'il existe ;
      2. sinon le dossier le plus récent nommé ``{projet}*`` contenant un data.yaml ;
      3. sinon un ``{projet}*.zip`` ;
      4. à défaut, on renvoie le nom canonique (l'app avale ensuite un message
         d'erreur clair « data.yaml introuvable » plutôt qu'un blocage silencieux).
    """
    from pathlib import Path
    if not (project_name and ann_exp):
        return ""
    base = Path(ann_exp)
    canonical = base / f"{project_name}-yolo"
    if canonical.exists():
        return str(canonical)
    if not base.exists():
        return str(canonical)

    def _matches(name: str) -> bool:
        return (name == project_name
                or name.startswith(f"{project_name}-")
                or name.startswith(f"{project_name}_"))

    def _zip_has_data_yaml(path: Path) -> bool:
        try:
            import zipfile
            with zipfile.ZipFile(path, "r") as archive:
                return any(Path(name).name == "data.yaml" for name in archive.namelist())
        except (OSError, zipfile.BadZipFile):
            return False

    dirs, zips = [], []
    for p in base.iterdir():
        if not _matches(p.name):
            continue
        if p.is_dir() and ((p / "data.yaml").exists() or list(p.rglob("data.yaml"))):
            dirs.append(p)
        elif p.suffix.lower() == ".zip" and _zip_has_data_yaml(p):
            zips.append(p)
    pool = dirs or zips
    if pool:
        return str(max(pool, key=lambda x: x.stat().st_mtime))
    return str(canonical)


def _dataset_path_from_ancestors(parent_nodes: list, ctx: dict) -> str:
    """Dérive le dossier dataset YOLO depuis un ancêtre annotation (résolution tolérante)."""
    for pn in parent_nodes or []:
        pd = pn.get("data", {})
        if (pd.get("node_type") or pn.get("type", "")) == "annotation":
            project_name = _export_key(pd)
            ann_exp = (ctx or {}).get("annotation_exports_path", "")
            return _resolve_yolo_dataset(project_name, ann_exp)
    return ""


def _annotation_yolo_ref(parent_nodes: list) -> str:
    """Référence runtime vers l'export YOLO exact de l'annotation amont.

    Le chemin est porté par la sortie de l'étape, jamais redécouvert par nom ou date.
    """
    for pn in parent_nodes or []:
        ptype = pn.get("data", {}).get("node_type") or pn.get("type", "")
        if ptype == "annotation":
            return "${STEP:" + f"{pn.get('id')}__exportyolo" + ".export_path}"
    return ""


def _annotation_ver_output_ref(parent_nodes: list) -> str:
    """Référence runtime vers le fichier .ver exact produit par Annotation."""
    for pn in parent_nodes or []:
        ptype = pn.get("data", {}).get("node_type") or pn.get("type", "")
        if ptype == "annotation":
            return "${STEP:" + f"{pn.get('id')}__exportver" + ".export_path}"
    return ""


def _annotation_split_ref(parent_nodes: list, ctx: dict, split: str) -> dict:
    """(images_dir, labels_dir) d'un SPLIT (train/val/test) exporté par un ancêtre
    annotation. Training consomme le data.yaml COMPLET (les 3 splits), mais Inference
    (détection/tracking) veut une séquence d'images + un GT ponctuel — d'où le besoin
    de choisir un split unique quand Annotation est branchée directement sur Inference.
    Renvoie {} si aucun ancêtre annotation ou export introuvable."""
    from pathlib import Path
    for pn in parent_nodes or []:
        pd = pn.get("data", {})
        if (pd.get("node_type") or pn.get("type", "")) == "annotation":
            project_name = _export_key(pd)
            ann_exp = (ctx or {}).get("annotation_exports_path", "")
            ds_dir = _resolve_yolo_dataset(project_name, ann_exp)
            if not ds_dir:
                return {}
            base = Path(ds_dir) / split
            return {"images": str(base / "images"), "labels": str(base / "labels")}
    return {}


def _annotation_ver_ref(parent_nodes: list, ctx: dict) -> str:
    """Chemin d'un export .ver (format texte natif, natif Inference_App) pour le projet d'un
    ancêtre annotation, si Annotation_App en a exporté un (output_format='ver' côté
    Annotation_App). C'est le format PRÉFÉRÉ pour le GT d'Inference/Éval (voir
    _annotation_split_ref pour le repli YOLO si aucun .ver n'existe)."""
    from pathlib import Path
    for pn in parent_nodes or []:
        pd = pn.get("data", {})
        if (pd.get("node_type") or pn.get("type", "")) == "annotation":
            project_name = _export_key(pd)
            ann_exp = (ctx or {}).get("annotation_exports_path", "")
            if not (project_name and ann_exp):
                return ""
            base = Path(ann_exp)
            if not base.exists():
                return ""
            cands = [p for p in base.iterdir() if p.suffix.lower() == ".ver" and (
                p.stem == project_name
                or p.stem.startswith(f"{project_name}-")
                or p.stem.startswith(f"{project_name}_")
            )]
            return str(max(cands, key=lambda x: x.stat().st_mtime)) if cands else ""
    return ""


def _optuna_best_ref(parent_nodes: list) -> str:
    """Si un nœud Optuna en mode AUTO figure parmi les ancêtres, renvoie un placeholder
    ``${STEP:<optid>__hpo.best_params}`` que le pipeline_runner résout au run-time par
    les best params réels produits par l'étude. Sinon ""."""
    for pn in parent_nodes or []:
        pd = pn.get("data", {})
        if (pd.get("node_type") or pn.get("type", "")) == "optuna" and bool(pd.get("full_auto", True)):
            return "${STEP:" + f"{pn.get('id')}__hpo" + ".best_params}"
    return ""


# Moteur d'entrainement (Training_App) : "yolox" integre, ou moteur de plugin.
# Les poids d'un moteur ne se relisent qu'avec ce moteur : il est porte par
# les noeuds Model / Training / Optuna et verifie a la construction du graphe.
DEFAULT_ENGINE = "yolox"


class GraphConfigError(ValueError):
    """Graphe incoherent, refuse avant tout lancement (-> HTTP 400)."""


def _node_type(n: dict) -> str:
    return n.get("data", {}).get("node_type") or n.get("type", "")


def _engine_of(data: dict) -> str:
    return str(data.get("engine") or DEFAULT_ENGINE).strip().lower()


def _training_engine(node: dict, parent_nodes: list) -> str:
    """Moteur d'un noeud Training : un noeud Model amont l'impose (ses poids
    ne se chargent qu'avec leur moteur) ; une etude Optuna amont doit avoir
    optimise ce meme moteur, sinon ses best params n'ont pas de sens."""
    data = node.get("data", {})
    engine = _engine_of(data)
    for pn in parent_nodes or []:
        if _node_type(pn) == "model":
            engine = _engine_of(pn.get("data", {}))
            break
    for pn in parent_nodes or []:
        if _node_type(pn) == "optuna" and _engine_of(pn.get("data", {})) != engine:
            raise GraphConfigError(
                f'"{data.get("label") or node.get("id")}" trains with engine \'{engine}\' '
                f'but the upstream Optuna study "{pn.get("data", {}).get("label") or pn.get("id")}" '
                f"optimizes '{_engine_of(pn.get('data', {}))}': use the same engine on both nodes."
            )
    return engine


def _check_inference_engine(node: dict, parent_nodes: list) -> None:
    """Le moteur voyage avec le checkpoint ; le backend valide sa disponibilité.

    La cohérence moteur/taille de la lignée reste contrôlée par
    ``_model_lineage_spec``. Les moteurs optionnels sont résolus par plugin dans
    Inference_App, donc l'Orchestrator ne maintient pas une seconde liste.
    """
    return None


_MODEL_LINEAGE_TYPES = {"model", "optuna", "training", "inference"}


def _model_lineage_spec(node: dict, parent_nodes: list) -> tuple[str, str]:
    """Valide puis résout le moteur et l'architecture d'une lignée modèle.

    Un checkpoint n'est compatible qu'avec le moteur *et* la taille qui l'ont
    produit. Le contrôle est fait pendant la construction du pipeline, avant
    de lancer la première étape coûteuse. Les champs absents des anciens
    graphes restent compatibles : le moteur historique est appliqué et la
    taille non renseignée hérite de l'unique taille déclarée en amont.
    """
    lineage = [node, *(parent_nodes or [])]
    aware = [n for n in lineage if _node_type(n) in _MODEL_LINEAGE_TYPES]

    engine_nodes: dict[str, list[str]] = {}
    for n in aware:
        data = n.get("data", {})
        engine_nodes.setdefault(_engine_of(data), []).append(
            str(data.get("label") or n.get("id") or _node_type(n))
        )
    if len(engine_nodes) > 1:
        details = "; ".join(
            f"{', '.join(labels)} = {engine}" for engine, labels in sorted(engine_nodes.items())
        )
        raise GraphConfigError(
            "Blocking pre-check: nodes in this lineage do not use the same "
            f"engine ({details}). Align the engine parameter on all nodes."
        )

    engine = next(iter(engine_nodes), DEFAULT_ENGINE)
    sizes: dict[str, list[str]] = {}
    for n in aware:
        data = n.get("data", {})
        size = str(data.get("model_size") or "").strip().lower()
        if size:
            sizes.setdefault(size, []).append(str(data.get("label") or n.get("id") or _node_type(n)))
    if len(sizes) > 1:
        details = "; ".join(
            f"{', '.join(labels)} = {size}" for size, labels in sorted(sizes.items())
        )
        raise GraphConfigError(
            "Blocking pre-check: nodes in this lineage do not use the same "
            f"architecture ({details}). A checkpoint must be reloaded with its original size."
        )

    return engine, next(iter(sizes), "")


def _model_input_ref(parent_nodes: list) -> str:
    """Chemin .pt d'un nœud d'entrée `model` parmi les ancêtres (input manuel), sinon ""."""
    for pn in parent_nodes or []:
        ptype = pn.get("data", {}).get("node_type") or pn.get("type", "")
        if ptype == "model":
            from backend.utils.native_share import normalize_input_path
            return normalize_input_path(pn.get("data", {}).get("model_path", "") or "")
    return ""


def _dataset_source_ref(parent_nodes: list) -> dict:
    """(name, path) d'un nœud d'entrée `dataset_source` parmi les ancêtres, sinon {}."""
    for pn in parent_nodes or []:
        ptype = pn.get("data", {}).get("node_type") or pn.get("type", "")
        if ptype == "dataset_source":
            pd = pn.get("data", {})
            from backend.utils.native_share import normalize_input_path
            return {"name": pd.get("dataset_name", ""),
                    "path": normalize_input_path(pd.get("dataset_path", ""))}
    return {}


def _train_model_ref(parent_nodes: list) -> str:
    """Si un nœud Training figure parmi les ancêtres, renvoie un placeholder
    ``${STEP:<trainid>__train.best_model_path}`` que le pipeline_runner résout au
    run-time par le best.pt RÉEL produit par ce training (modèle déterministe porté
    par l'arête). Sinon "" (→ le backend retombe sur le best.pt le plus récent)."""
    for pn in parent_nodes or []:
        ptype = pn.get("data", {}).get("node_type") or pn.get("type", "")
        if ptype == "training":
            return "${STEP:" + f"{pn.get('id')}__train" + ".best_model_path}"
    return ""


def _train_data_yaml_ref(parent_nodes: list) -> str:
    """Si un Training figure parmi les ancêtres, renvoie ``${STEP:<id>__train.data_yaml}``
    résolu au run-time par le data.yaml RÉEL utilisé par ce training. Indispensable pour
    l'éval Détection : l'export annotation est un .zip que Training a déjà DÉCOMPRESSÉ —
    le dossier ``{export}-yolo/`` n'existe pas, seul le data.yaml dézippé (dans les runs
    du Training) est valide. Sinon "" (repli sur le chemin dérivé de l'annotation)."""
    for pn in parent_nodes or []:
        ptype = pn.get("data", {}).get("node_type") or pn.get("type", "")
        if ptype == "training":
            return "${STEP:" + f"{pn.get('id')}__train" + ".data_yaml}"
    return ""


# ── Topological sort (Kahn) ───────────────────────────────────────────────────

def _topo_sort(nodes: list, edges: list) -> list:
    adj = {n["id"]: [] for n in nodes}
    in_deg = {n["id"]: 0 for n in nodes}
    for e in edges:
        src, tgt = e["source"], e["target"]
        if src in adj:
            adj[src].append(tgt)
        in_deg[tgt] = in_deg.get(tgt, 0) + 1

    queue = [n for n in nodes if in_deg[n["id"]] == 0]
    result = []
    node_by_id = {n["id"]: n for n in nodes}

    while queue:
        node = queue.pop(0)
        result.append(node)
        for child_id in adj.get(node["id"], []):
            in_deg[child_id] -= 1
            if in_deg[child_id] == 0 and child_id in node_by_id:
                queue.append(node_by_id[child_id])
    return result


# ── FREE node detection ───────────────────────────────────────────────────────

def _is_free_node(node: dict, edges: list) -> bool:
    """
    Un node est FREE s'il n'a pas d'arête entrante ET n'est pas dataset_source.
    En mode FREE le node expose des outputs existants du workspace — aucune étape pipeline.
    """
    ntype = node.get("data", {}).get("node_type") or node.get("type", "")
    if ntype == "dataset_source":
        return False
    return not any(e["target"] == node["id"] for e in edges)


# ── Node → steps conversion ───────────────────────────────────────────────────

# run_type : role MLflow du run, derive du type de node. Permet a MLflow_App de
# colorer/grouper les runs par role (training / evaluation / hpo) au lieu de melanger.
_RUN_TYPE_BY_NODE = {"training": "training", "inference": "evaluation", "optuna": "hpo"}


def _trace_of(node: dict, ctx: dict | None) -> dict:
    """Tracabilite d'un run : {graph_id, graph_name, node_id, node_label, run_id,
    experiment, run_type}. Permet aux apps de :
      - nommer les runs MLflow de facon deterministe ({graph}/{node}),
      - les RASSEMBLER dans UN experiment par projet (`experiment` = nom du graphe,
        au lieu d'un experiment par stage -> fini les "4 experiences sans relation"),
      - les distinguer par role (`run_type` : training/evaluation/hpo) pour le code
        couleur.
    `run_id` est un placeholder ${RUN_ID} resolu au RUN-TIME par pipeline_runner
    -> tag MLflow `orch_run_id` = lien exact Run <-> run MLflow."""
    data = node.get("data", {})
    ntype = data.get("node_type") or node.get("type", "")
    c = ctx or {}
    graph_id = c.get("graph_id", "")
    graph_name = c.get("graph_name") or graph_id
    return {
        "graph_id":   graph_id,
        "graph_name": graph_name,
        "node_id":    node.get("id", ""),
        "node_label": data.get("label") or data.get("run_label") or node.get("id", ""),
        "run_id":     "${RUN_ID}",
        # 1 experiment MLflow par projet MLOps (regroupe training/eval/hpo du meme graphe).
        "experiment": graph_name,
        "run_type":   _RUN_TYPE_BY_NODE.get(ntype, ntype or "run"),
        # Filiation de fork : run orchestrateur PARENT (si ce graphe est un fork) ->
        # permet a MLflow_App d'afficher les branches (comme le Lineage orchestrateur).
        "fork_parent_run": c.get("fork_parent_run") or "",
    }


# Champs de node qui portent un chemin saisi/depose par l'utilisateur. Un chemin
# UNC (\\hote\partage\...) est parfaitement legitime cote Windows mais n'existe
# pas pour un backend Linux : il est traduit ICI, une fois, avant de partir vers
# les sous-apps (sinon chaque app doit le refaire, et Dataset_Explorer_App
# repondait "Chemin introuvable" sur /load-dataset).
_PATH_FIELDS = ("dataset_path", "model_path", "sequence_dir", "annotation_file")


def _normalized_data(data: dict) -> dict:
    from backend.utils.native_share import normalize_input_path
    if not any(data.get(k) for k in _PATH_FIELDS):
        return data
    out = dict(data)
    for k in _PATH_FIELDS:
        v = out.get(k)
        if isinstance(v, str) and v:
            out[k] = normalize_input_path(v)
    return out


def _steps_for_node(node: dict, deps: list[str], ctx: dict | None = None,
                    parent_nodes: list[dict] | None = None, has_input: bool = True) -> list[dict]:
    nid = node["id"]
    data = _normalized_data(node.get("data", {}))
    # node type is stored in data.node_type or as the ReactFlow node `type` key
    ntype = data.get("node_type") or node.get("type", "")

    def sid(action: str) -> str:
        return f"{nid}__{action}"

    if ntype == "dataset_source":
        return [
            {
                "id": sid("load"),
                "label": f"Charger dataset \"{data.get('dataset_name', '')}\"",
                "app": "Dataset_Explorer_App", "method": "POST",
                "endpoint": "/api/orchestrator/load-dataset",
                "params": {
                    "name":            data.get("dataset_name", "dataset"),
                    "root_path":       data.get("dataset_path", ""),
                    "n_clusters":      data.get("n_clusters", 15),
                    "wait_for_scan":   True,
                    # Coché sur le node après avertissement de doublon (même root_path
                    # déjà connu sous un autre nom, cf. check-dataset-path côté frontend) —
                    # sans ça /load-dataset réutilise silencieusement l'existant.
                    "allow_duplicate": bool(data.get("allow_duplicate", False)),
                },
                # Suivi live (step 4) : /load-dataset bloque jusqu'à fin du scan
                # (wait_for_scan) → poll /api/datasets, match par NOM (l'id n'est pas
                # encore connu tant que load n'a pas répondu) → barre de scan sous le node.
                "progress": {
                    "app": "Dataset_Explorer_App", "poll": "/api/datasets", "kind": "scan",
                    "match": ["name", data.get("dataset_name", "dataset")],
                },
                "depends_on": deps, "type": "task",
                "hint": "", "app_link": "Dataset_Explorer_App",
            },
            {
                "id": sid("embed"),
                "label": "Lancer embedding CLIP",
                "app": "Dataset_Explorer_App", "method": "POST",
                "endpoint": "/api/orchestrator/start-embed",
                # dataset_id (pas juste le nom) vient du résultat RÉEL de "load" : Dataset_Explorer_App
                # n'impose pas l'unicité du nom (deux datasets peuvent s'appeler pareil, ex.
                # deux dossiers importés séparément sous "IR") — /start-embed cherchant par
                # nom seul pouvait silencieusement tomber sur le MAUVAIS dataset (constaté :
                # embed lancé sur un dataset id=1/82 images au lieu du id=2/160 images visé).
                # dataset_id lève toute ambiguïté ; dataset_name reste envoyé en fallback.
                "params": {
                    "dataset_name": f"${{STEP:{sid('load')}.name}}",
                    "dataset_id":   f"${{STEP:{sid('load')}.dataset_id}}",
                },
                # Suivi live (step 4) : pendant l'embedding (long), poll GET /api/datasets et
                # relaie embed_progress/embed_total/embed_phase → barre d'avancement sous le node.
                "progress": {
                    "app": "Dataset_Explorer_App", "poll": "/api/datasets", "kind": "embed",
                    "match": ["id", f"${{STEP:{sid('load')}.dataset_id}}"],
                },
                "depends_on": [sid("load")], "type": "task",
                "hint": "", "app_link": "Dataset_Explorer_App",
            },
        ]

    if ntype == "explorer":
        dataset_name = data.get("dataset_name", "")
        subset_name  = data.get("subset_name", "subset")
        full_auto    = bool(data.get("full_auto", True))  # default True = comportement CLIP existant

        # Detect parent explorer node for subset-of-subset chaining, and direct parent
        # Dataset Source (pour référencer son résultat "load" réel ci-dessous).
        parent_visu = None
        parent_source = None
        if parent_nodes:
            for pn in parent_nodes:
                pd = pn.get("data", {})
                ptype = pd.get("node_type") or pn.get("type", "")
                if ptype == "explorer" and parent_visu is None:
                    parent_visu = pn
                elif ptype == "dataset_source" and parent_source is None:
                    parent_source = pn

        # Inherit dataset_name from parent explorer if not set locally
        if parent_visu and not dataset_name:
            dataset_name = parent_visu.get("data", {}).get("dataset_name", "")

        source_subset_name = parent_visu.get("data", {}).get("subset_name", "") if parent_visu else ""

        export_step = {
            "id": sid("export"),
            "label": f"Exporter \"{subset_name}\" vers Annotation_App",
            "app": "Dataset_Explorer_App", "method": "POST",
            "endpoint": "/api/orchestrator/export-subset",
            "params": {
                "subset_name": subset_name,
                "subset_id": f"${{STEP:{sid('subset')}.subset_id}}" if full_auto else None,
                "dataset_id": f"${{STEP:{sid('subset')}.dataset_id}}" if full_auto else None,
                **({"annotation_imports_path": (ctx or {}).get("annotation_imports_path")}
                   if (ctx or {}).get("annotation_imports_path") else {}),
            },
            "type": "task", "hint": "", "app_link": "Dataset_Explorer_App",
        }

        if not full_auto:
            # Mode Manuel : l'utilisateur cree le subset lui-meme dans l'app
            export_step["depends_on"] = [sid("manual_create")]
            return [
                {
                    "id": sid("manual_create"),
                    "label": f"Creer subset \"{subset_name}\" manuellement",
                    "app": "Dataset_Explorer_App", "method": "GET",
                    "endpoint": "/health",
                    "params": {},
                    "depends_on": deps, "type": "human_gate",
                    "hint": (
                        f"Entrez dans Dataset Explorer pour creer le subset \"{subset_name}\" manuellement. "
                        f"Selectionnez vos images dans le Playground ou via les filtres, "
                        f"creez le subset, puis revenez ici et cliquez Continuer."
                    ),
                    "app_link": "Dataset_Explorer_App",
                },
                export_step,
            ]

        # Mode Full Auto : pipeline CLIP complet (4 etapes)
        # dataset_name : si un Dataset Source alimente DIRECTEMENT ce nœud, on référence
        # le résultat RÉEL de son étape "load" plutôt que la config figée du nœud — même
        # correction que pour l'étape "embed" (voir _steps_for_node/dataset_source) :
        # /load-dataset peut retrouver un dataset déjà connu sous un autre nom pour ce
        # root_path, et /create-subset chercherait sinon par un nom qui n'existe plus.
        create_subset_params: dict = {
            "dataset_name": f"${{STEP:{parent_source['id']}__load.name}}" if parent_source else dataset_name,
            "dataset_id": f"${{STEP:{parent_source['id']}__load.dataset_id}}" if parent_source else None,
            "subset_name":  subset_name,
            "query":        data.get("query", ""),
            "top_k":        data.get("top_k", 50),
        }
        if source_subset_name:
            create_subset_params["source_subset_name"] = source_subset_name

        export_step["depends_on"] = [sid("validatesubset")]
        return [
            {
                "id": sid("verifyembed"),
                "label": "Check CLIP embedding",
                "app": "Dataset_Explorer_App", "method": "GET",
                "endpoint": "/health",
                "params": {},
                "depends_on": deps, "type": "human_gate",
                "hint": (
                    f"CLIP embedding DONE on \"{dataset_name}\" (clusters ready). "
                    f"The dataset is already pinned in Dataset_Explorer_App -> Playground: "
                    f"take a quick look at the clusters, then click Continue "
                    f"(or edit the semantic query on the node before continuing)."
                ),
                "app_link": "Dataset_Explorer_App",
            },
            {
                "id": sid("subset"),
                "label": f"Create subset \"{subset_name}\"",
                "app": "Dataset_Explorer_App", "method": "POST",
                "endpoint": "/api/orchestrator/create-subset",
                "params": create_subset_params,
                "depends_on": [sid("verifyembed")], "type": "task",
                "hint": "", "app_link": "Dataset_Explorer_App",
            },
            {
                "id": sid("validatesubset"),
                "label": f"Validate subset \"{subset_name}\"",
                "app": "Dataset_Explorer_App", "method": "GET",
                "endpoint": "/health",
                "params": {},
                "depends_on": [sid("subset")], "type": "human_gate",
                "hint": (
                    f"Open Dataset_Explorer_App -> Subsets -> \"{subset_name}\". "
                    f"Check the selected images, adjust the query if needed, "
                    f"then click Continue to export to Annotation_App."
                ),
                "app_link": "Dataset_Explorer_App",
            },
            export_step,
        ]

    if ntype == "annotation":
        # Entree `dataset_source` directe (dossier d'images) au lieu d'un subset explorer :
        # le nom du dataset sert de subset/projet ET on importe depuis son dossier.
        _ds = _dataset_source_ref(parent_nodes)
        _ds_name = _ds.get("name", "")
        project_name = data.get("project_name") or data.get("subset_name") or _ds_name or "annotation"
        subset_name  = data.get("subset_name") or _ds_name or "subset"
        full_auto    = bool(data.get("full_auto", False))
        ai_model     = data.get("ai_model", "sam3")
        ai_text      = data.get("ai_text", "")
        ai_threshold = float(data.get("ai_threshold", 0.5))

        _create_params = {
            "subset_name":   subset_name,
            "project_name":  project_name,
            "label_classes": data.get("label_classes", [{"name": "object", "color": "#FF6B6B"}]),
            "mode":          data.get("annotation_mode", "sequence"),
        }
        if _ds.get("path"):
            _create_params["import_path"] = _ds["path"]   # zero-copie depuis le dossier source

        steps = [
            {
                "id": sid("project"),
                "label": f"Create project \"{project_name}\"",
                "app": "Annotation_App", "method": "POST",
                "endpoint": "/api/orchestrator/create-project",
                "params": _create_params,
                # Scan live de l'import d'images (create-project) → barre sous le node
                # Annotation (poll project-status → import_current/import_total).
                "progress": {
                    "app": "Annotation_App", "kind": "annotation_import",
                    "poll": f"/api/orchestrator/project-status?project_name={project_name}",
                },
                "depends_on": deps, "type": "task",
                "hint": "", "app_link": "Annotation_App",
            },
        ]

        if full_auto:
            steps.append({
                "id": sid("auto_annotate"),
                "label": f"Automatic annotation ({ai_model.upper()})",
                "app": "Annotation_App", "method": "POST",
                "endpoint": "/api/orchestrator/auto-annotate",
                "params": {
                    "project_name": project_name,
                    "model":        ai_model,
                    "text_prompt":  ai_text,
                    "threshold":    ai_threshold,
                },
                # Suivi live (step 4) : poll project-status → barre frames annotées/total sous le node.
                "progress": {
                    "app": "Annotation_App", "kind": "annotation",
                    "poll": f"/api/orchestrator/project-status?project_name={project_name}",
                },
                "depends_on": [sid("project")], "type": "task",
                "hint": "", "app_link": "Annotation_App",
            })
            exportdep = sid("auto_annotate")
            # Relecture humaine optionnelle apres l'annotation auto : en Full Auto
            # la chaine enchaine directement sur l'export, sans aucun point d'arret
            # pour verifier ce que l'IA a produit. Coche sur le node.
            if bool(data.get("review_before_export", False)):
                steps.append({
                    "id": sid("review"),
                    "label": "Check auto annotations",
                    "app": "Annotation_App", "method": "GET",
                    "endpoint": "/health",
                    "params": {},
                    "depends_on": [sid("auto_annotate")], "type": "human_gate",
                    "hint": (
                        f"Automatic annotation done on \"{project_name}\". "
                        f"Open Annotation_App to check/fix the boxes, "
                        f"then click Continue to export."
                    ),
                    "app_link": "Annotation_App",
                })
                exportdep = sid("review")
        else:
            steps.append({
                "id": sid("annotate"),
                "label": "Annotate images manually",
                "app": "Annotation_App", "method": "GET",
                "endpoint": "/health",
                "params": {},
                "depends_on": [sid("project")], "type": "human_gate",
                "hint": (
                    f"Open Annotation_App -> project \"{project_name}\". "
                    f"Annotate all images (SAM, Grounding DINO or manual drawing). "
                    f"Come back here when done and click Continue."
                ),
                "app_link": "Annotation_App",
            })
            exportdep = sid("annotate")

        # step 6 (orchestrateur) — Locked+Manuel : l'utilisateur peut choisir, au gate
        # "annoter", un export DÉJÀ PRODUIT pour ce projet (AnnotationWaitingChoice,
        # SandgraphPage.tsx) → `data["export_name"]` est alors posé AVANT la reprise
        # (resume_graph_run reconstruit le pipeline depuis le graphe courant à CHAQUE
        # resume, cf. Orchestrator_App/backend/api/graphs.py, donc cette valeur fraîche
        # est bien celle utilisée ici). export-yolo (Annotation_App) réutilise cet
        # export tel quel s'il existe déjà sur disque, sans relancer de job — sinon
        # (full_auto, ou aucun choix fait) comportement inchangé : export frais.
        reuse_export = data.get("export_name", "") if not full_auto else ""
        steps.append({
            "id": sid("exportyolo"),
            "label": "Exporter annotations YOLO",
            "app": "Annotation_App", "method": "POST",
            "endpoint": "/api/orchestrator/export-yolo",
            "params": {
                "project_name": project_name,
                "subset_name":  subset_name,
                "split_train":  data.get("split_train", 0.8),
                "split_val":    data.get("split_val", 0.2),
                "reuse_if_exists": reuse_export,
            },
            "depends_on": [exportdep], "type": "task",
            "hint": "", "app_link": "Annotation_App",
        })
        # Export .ver (GT texte natif) TOUJOURS produit en plus du YOLO : des que
        # l'annotation a tourne, les DEUX formats existent sur disque et sont donc
        # cochables/versionnables dans le node DVC (meme si out_ver n'est pas branche).
        # Peu couteux (fichiers texte, aucune copie d'image).
        steps.append({
            "id": sid("exportver"),
            "label": "Exporter annotations GT (.ver)",
            "app": "Annotation_App", "method": "POST",
            "endpoint": "/api/orchestrator/export-ver",
            "params": {"project_name": project_name},
            "depends_on": [exportdep], "type": "task",
            "hint": "", "app_link": "Annotation_App",
        })
        return steps

    if ntype == "dvc":
        # step6 (Bob 2026-07-25) : DVC = OBSERVATEUR (comme MLflow). Ce n'est PLUS une
        # étape de pipeline branchée. Il n'est pas connecté à un « artefact » ambigu :
        # il OBSERVE tout le graphe et l'utilisateur CHOISIT, depuis le hub DVC (node),
        # ce qui va dedans (dataset, annotations, best model, params Optuna, métriques
        # Inférence) puis versionne / télécharge à la demande (cf. DvcNodeSummary +
        # GET /api/graphs/{id}/artifacts + POST /api/graphs/{id}/dvc-commit). dvc-app
        # reste auto-lancée (cf _needed_app_keys) pour le hub. → aucune étape générée.
        return []

    if ntype == "mlflow":
        # SUPERVISOR : MLflow n'est PAS une etape de pipeline. C'est un observateur
        # qui lit en continu le store du workspace (mlflow_<user>/mlflow_data). Il ne
        # se branche pas (aucune arete entrante) et ne genere aucune etape. MLflow_App
        # est neanmoins auto-lancee (cf _needed_app_keys) pour la consultation.
        return []

    if ntype == "optuna":
        # AUTO : lance l'étude (TPE, pruning désactivé) via l'endpoint orchestrateur -> best params.
        # MANUEL : human_gate (l'utilisateur lance l'étude dans l'app et saisit les params).
        if bool(data.get("full_auto", True)):
            dataset_path = (data.get("dataset_path", "")
                            or _annotation_yolo_ref(parent_nodes)
                            or _dataset_path_from_ancestors(parent_nodes, ctx))
            return [{
                "id": sid("hpo"),
                "label": "Optuna study (auto HPO - TPE)",
                "app": "optuna-app", "method": "POST", "endpoint": "/api/orchestrator/hpo",
                "params": {
                    "dataset_path": dataset_path,
                    # Vide = hyperparametres HPO par defaut du moteur.
                    "optimize":     data.get("optimize") or [],
                    "n_trials":     int(data.get("n_trials", 20)),
                    "direction":    data.get("direction", "maximize"),
                    "metric":       data.get("metric", "map50"),
                    "engine":       _engine_of(data),
                    "model_size":   data.get("model_size") or "",
                    "epochs":       int(data.get("trial_epochs", 10)),
                    "stop_on_failure": bool(data.get("stop_on_failure", True)),
                    "trace":        _trace_of(node, ctx),
                },
                "depends_on": deps, "type": "task",
                "hint": "Optuna study -> best params merged into the downstream Training.",
                "app_link": "optuna-app",
            }]
        return [{
            "id": sid("hpo"),
            "label": "Optimize hyperparameters (manual)",
            "app": "optuna-app", "method": "GET", "endpoint": "/health",
            "params": {},
            "depends_on": deps, "type": "human_gate",
            "hint": ("Run an Optuna study in Optuna_App, get the best "
                     "parameters and enter them on the node (best_params), then Continue."),
            "app_link": "optuna-app",
        }]

    if ntype == "training":
        engine, lineage_size = _model_lineage_spec(node, parent_nodes)
        # Garde la validation historique Optuna/Training (et la résolution
        # Model -> Training), après le pré-contrôle global plus explicite.
        engine       = _training_engine(node, parent_nodes)
        # Vide = taille par defaut du moteur (resolue par Training_App).
        model_size   = data.get("model_size") or lineage_size or ""
        # Un noeud d'entree `model` branche FIGE l'architecture (poids = telle taille).
        for _pn in parent_nodes or []:
            if _node_type(_pn) == "model":
                model_size = _pn.get("data", {}).get("model_size") or model_size
                break
        epochs       = int(data.get("epochs", 100))
        batch        = int(data.get("batch", 16))
        imgsz        = int(data.get("imgsz", 640))
        full_auto    = bool(data.get("full_auto", True))

        # dataset_path: explicite dans node.data, ou dérivé automatiquement depuis ancêtre annotation
        dataset_path = data.get("dataset_path", "") or _annotation_yolo_ref(parent_nodes)
        if not dataset_path and parent_nodes:
            for pn in parent_nodes:
                pd    = pn.get("data", {})
                ptype = pd.get("node_type") or pn.get("type", "")
                if ptype == "annotation":
                    project_name = _export_key(pd)
                    dataset_path = _resolve_yolo_dataset(
                        project_name, (ctx or {}).get("annotation_exports_path", ""))
                    break

        run_label = data.get("run_label", "") or model_size or engine

        # ── Mode Manuel : human_gate ─────────────────────────────────────────
        if not full_auto:
            return [
                {
                    "id": sid("train"),
                    "label": f"[Manual] Train {run_label}",
                    "app": "Training_App", "method": "POST",
                    "endpoint": "/api/orchestrator/train",
                    "params": {},
                    "depends_on": deps, "type": "human_gate",
                    "hint": (
                        f"Open Training App and manually start training "
                        f"({engine} {model_size} - {epochs} epochs). "
                        f"Set the hyperparameters as needed. "
                        f"Once training is done, come back here and click "
                        f"Done -> Continue."
                    ),
                    "app_link": "Training_App",
                },
            ]

        # ── Mode Automatique : task REST ─────────────────────────────────────
        # Hyperparametres du moteur : dict `hyperparams` du noeud (ecrit par
        # le panneau, cles du catalogue du moteur) ; les anciens graphes les
        # stockaient a plat (cles YOLOX ci-dessous), toujours relus.
        # Training_App ignore (et signale) les cles inconnues du moteur, et
        # traduit epochs/batch/imgsz vers les cles du moteur.
        _LEGACY_FLAT_KEYS = {
            "basic_lr_per_img", "min_lr_ratio", "momentum", "weight_decay",
            "warmup_epochs", "warmup_lr", "no_aug_epochs", "eval_interval",
            "print_interval", "data_num_workers", "device", "fp16", "ema",
            "degrees", "translate", "shear", "perspective",
            "hsv_prob", "flip_prob", "mosaic_prob", "mixup_prob", "enable_mixup",
        }
        hyperparams = {k: data[k] for k in _LEGACY_FLAT_KEYS if k in data}
        if isinstance(data.get("hyperparams"), dict):
            hyperparams.update(data["hyperparams"])

        # ── best params d'un parent Optuna : transitent par l'arete Optuna -> Training ──
        #   MANUEL : best_params ecrits sur le noeud optuna -> fusionnes au BUILD.
        #   AUTO   : best_params produits par l'etape /hpo -> resolus au RUN-TIME via
        #            le placeholder ${STEP:<optid>__hpo.best_params} (param optuna_best).
        optuna_best_ref = _optuna_best_ref(parent_nodes)
        if not optuna_best_ref and parent_nodes:
            for pn in parent_nodes:
                pd = pn.get("data", {})
                if (pd.get("node_type") or pn.get("type", "")) == "optuna":
                    bp = _parse_best_params(pd.get("best_params"))
                    if bp:
                        hyperparams.update(bp)
                    break

        _params = {
            "dataset_path":  dataset_path,
            "engine":        engine,
            "model_size":    model_size,
            "epochs":        epochs,
            "batch":         batch,
            "imgsz":         imgsz,
            "hyperparams":   hyperparams,
            "trace":         _trace_of(node, ctx),
        }
        # Modele de depart fourni par un noeud d'entree `model` (fine-tuning / poids custom).
        _mw = data.get("model_weights", "") or _model_input_ref(parent_nodes)
        if _mw:
            _params["model_weights"] = _mw
        if optuna_best_ref:
            _params["optuna_best"] = optuna_best_ref  # dict resolu au run-time
        return [
            {
                "id": sid("train"),
                "label": f"Train {run_label} ({epochs} epochs)",
                "app": "Training_App", "method": "POST",
                "endpoint": "/api/orchestrator/train",
                "params": _params,
                # Suivi live (step 4) : poll la liste des runs, prend celui « running »,
                # relaie current_epoch/total_epochs (+ mAP50) → barre d'avancement sous le node.
                "progress": {
                    "app": "Training_App", "kind": "training",
                    "poll": "/api/training/runs", "match": ["status", "running"],
                },
                "depends_on": deps, "type": "task",
                "hint": (
                    f"Automatic training: {engine} {model_size} - {epochs} epochs. "
                    f"Dataset: {dataset_path or '(derived from the parent annotation node)'}. "
                    f"Follow the progress in Training App."
                ),
                "app_link": "Training_App",
            },
        ]

    if ntype == "inference":
        # Noeud léger : inférence fichier, évaluation détection et tracking.
        #   FREE  (aucune entrée) : ouverture de l'app en mode manuel
        #   LOCKED (entrée)       : évaluation ou inférence selon data.task
        task         = data.get("task", "track")
        engine, model_size = _model_lineage_spec(node, parent_nodes)
        if has_input:
            _check_inference_engine(node, parent_nodes)
        # Modele : explicite, sinon noeud d'entree `model` (.pt literal), sinon Training amont (arete).
        model_path   = data.get("model_path", "") or _model_input_ref(parent_nodes) \
            or _train_model_ref(parent_nodes)   # ${STEP:...best_model_path} ou ""
        # Sequence : explicite, sinon dossier d'un noeud d'entree `dataset_source`.
        _ds = _dataset_source_ref(parent_nodes)
        seq_input    = data.get("sequence_dir", "") or _ds.get("path", "")
        trace        = _trace_of(node, ctx)

        # ── FREE = ouverture manuelle de l'application ──────────────────────────
        if not has_input:
            return [{
                "id": sid("open"), "label": "Interactive Inference session",
                "app": "Inference_App", "method": "GET", "endpoint": "/health", "params": {},
                "depends_on": deps, "type": "human_gate",
                "hint": "Open Inference App, choose a media file and a weights file.",
                "app_link": "Inference_App",
            }]

        # ── LOCKED : deux tâches -> Détection (YOLO) et Tracking (unifié MOT/SOT) ──
        #   full_auto=False -> MANUEL (interactif) : ouvre l'app, SOT/MOT dans l'app (gate).
        #   full_auto=True  -> AUTO (headless) selon data.task :
        #       'detection' : model.val() -> mAP (MLflow)
        #       'tracking'  : YOLO pur ou YOLO + ByteTrack, avec benchmark global.
        full_auto = bool(data.get("full_auto", True))

        # ── MANUEL = interactif : ouvre l'app (aucune option ici, SOT/MOT dans l'app) ──
        if not full_auto:
            return [{
                "id": sid("track"), "label": "[Manuel] Session interactive (SOT/MOT dans l'app)",
                "app": "Inference_App", "method": "GET", "endpoint": "/health", "params": {},
                "depends_on": deps, "type": "human_gate",
                "hint": ("Ouvrez l'Inference App, lancez la session et faites le SOT/MOT en direct "
                         "(clic gauche = cible 1, droit = cible 2). Puis revenez et Continuer."),
                "app_link": "Inference_App",
            }]

        # Overrides yaml (rendu / sauvegarde / fenêtre / device) -> passés au backend.
        _OVR_KEYS = ("light_render", "save_video", "save_frames", "frame_ext", "trail",
                     "start_frame_idx", "stop_frame_idx", "device", "fps",
                     "debug_dialog_on_frames", "show_hud", "show_legend", "show_tracks", "show_gt")
        overrides = {k: data[k] for k in _OVR_KEYS if k in data}
        _yolo = {k: data[k] for k in ("conf_thresh", "iou_thresh", "img_size") if k in data}
        if _yolo:
            overrides["yolo"] = _yolo
        if isinstance(data.get("overrides"), dict):
            overrides.update(data["overrides"])
        # step4-C : config.yaml complet édité sur le node (panneau « config.yaml complet »).
        # Toutes les clés éditées (prérempli depuis le template) sont fusionnées ici → aucun
        # oubli. Les clés branchées (weights_yolo/sequence_dir/annotation_file) sont gérées
        # séparément (dérivées du branchement) et exclues côté UI, mais on les ignore ici par
        # sécurité pour ne pas écraser la résolution amont.
        _full = data.get("full_config")
        if isinstance(_full, dict):
            overrides.update({k: v for k, v in _full.items()
                              if k not in ("weights_yolo", "sequence_dir", "annotation_file")})
        # Echappatoire : n'importe quelle cle yaml en JSON brut (tous les params, sans oubli).
        _raw = data.get("overrides_json")
        if _raw:
            try:
                import json as _json
                _parsed = _json.loads(_raw)
                if isinstance(_parsed, dict):
                    overrides.update(_parsed)
            except Exception:
                pass

        # GT : explicite, sinon .ver (format natif Inference_App, PRÉFÉRÉ — c'est le
        # port "GT (.ver)" de l'Annotation branchée), sinon repli sur un SPLIT
        # (train/val/test) de l'export YOLO (dossier .txt) si aucun .ver n'existe.
        # Annotation sort un data.yaml COMPLET (3 splits) pour le Training ; Inference
        # n'en veut qu'UN (séquence + GT ponctuels) — d'où le sélecteur `gt_split`.
        gt_split = data.get("gt_split", "val")
        _ver = _annotation_ver_output_ref(parent_nodes) or _annotation_ver_ref(parent_nodes, ctx)
        _gt = _annotation_split_ref(parent_nodes, ctx, gt_split)
        if not seq_input and _gt.get("images"):
            seq_input = _gt["images"]
        annotation_file = data.get("annotation_file") or _ver or _gt.get("labels") or None

        # ── DÉTECTION = « YOLO évalué only » (Bob 2026-07-25) ──────────────────────
        # Mode classique : le détecteur YOLO est « plugué » directement à l'évaluation
        # (`kind="detection"` = validation du modèle), AUCUN tracker (MOT/SOT = none).
        # → métriques détection standard : mAP50 / mAP50-95 / P / R / courbe PR / F1 /
        #   matrice de confusion. (La tâche TRACKING garde `kind="tracker"` + séquence+.ver.)
        # Le data.yaml (avec ses splits) vient de l'ancêtre annotation, comme le Training.
        if task == "detection":
            # data.yaml : explicite > data.yaml RÉEL du Training amont (dézippé, résolu au
            # run-time) > repli chemin dérivé de l'annotation. Le training ref est PRÉFÉRÉ
            # car l'export annotation est un .zip (le dossier {export}-yolo/ n'existe pas).
            _ds_dir = _dataset_path_from_ancestors(parent_nodes, ctx)
            data_yaml = (data.get("data_yaml", "")
                         or _train_data_yaml_ref(parent_nodes)
                         or (f"{_ds_dir}/data.yaml" if _ds_dir else ""))
            det_overrides = {k: v for k, v in {
                "imgsz": data.get("img_size"),
                "conf":  data.get("conf_thresh"),
                "iou":   data.get("iou_thresh"),
                "split": data.get("gt_split", "val"),   # split évalué (val par défaut)
            }.items() if v is not None}
            # step4-C : clés pertinentes du config.yaml complet édité (model.val ignore le reste).
            _full_det = data.get("full_config")
            if isinstance(_full_det, dict):
                for _k in ("imgsz", "conf", "iou", "device", "split", "batch"):
                    if _full_det.get(_k) is not None:
                        det_overrides[_k] = _full_det[_k]
            return [{
                "id": sid("evaluate"), "label": "YOLO detection (model.val - YOLO only)",
                "app": "Inference_App", "method": "POST", "endpoint": "/api/orchestrator/evaluate",
                "params": {"kind": "detection", "model_path": model_path,
                           "data_yaml": data_yaml, "engine": engine,
                           "model_size": model_size,
                           "overrides": det_overrides, "trace": trace},
                "depends_on": deps, "type": "task",
                "hint": ("Standard YOLO evaluation (model.val) on the "
                         f"'{data.get('gt_split', 'val')}' split of data.yaml - mAP50/mAP50-95, "
                         "precision/recall, PR curve, F1, confusion matrix. No tracker."),
                "app_link": "Inference_App",
            }]

        # ── TRACKING : YOLO pur ou association ByteTrack optionnelle ────────────
        tracker_mot = data.get("tracker_mot", "bytetrack")
        tracker_sot = data.get("tracker_sot", "csrt")
        return [{
            "id": sid("infer"), "label": "YOLO inference" + (" + ByteTrack" if tracker_mot == "bytetrack" else " only"),
            "app": "Inference_App", "method": "POST", "endpoint": "/api/orchestrator/infer",
            "params": {
                "sequence_dir": seq_input, "model_path": model_path,
                "engine": engine, "model_size": model_size,
                "mode": "headless", "clicks": None,
                "tracker_mot": tracker_mot, "tracker_sot": tracker_sot,
                "n_targets": int(data.get("n_targets", 1)),
                "compute_metrics": bool(data.get("compute_metrics", False)),
                "annotation_file": annotation_file,
                "overrides": overrides, "trace": trace,
            },
            "depends_on": deps, "type": "task",
            "hint": f"Deterministic tracking on {data.get('sequence_dir') or '(sequence to be defined)'}.",
            "app_link": "Inference_App",
        }]

    return []


# ── Graph → PipelineDef ───────────────────────────────────────────────────────

def graph_to_pipeline(graph: dict) -> tuple[PipelineDef, dict]:
    """
    Convert a sandgraph to a PipelineDef.
    Returns (pipeline, step_node_map) where step_node_map = {step_id: node_id}.
    """
    from pathlib import Path
    nodes = graph["nodes"]
    edges = graph["edges"]
    graph_id = graph["graph_id"]

    # Build context — annotation paths derived from workspace structure
    from backend.config import WORKSPACE, CURRENT_USER
    ann_ws = WORKSPACE / f"annotation_{CURRENT_USER}"
    ctx: dict = {
        "annotation_imports_path": str(ann_ws / "imports"),
        "annotation_exports_path": str(ann_ws / "exports"),
        "graph_id": graph_id,
        "graph_name": graph.get("name", "") or graph_id,
        "fork_parent_run": (graph.get("forked_from") or {}).get("run_id") or "",
        "edges": edges,   # utilise par le builder annotation pour detecter le port out_ver branche
        # Snapshot complet du graphe -> versionne par le noeud DVC (repro totale).
        "graph_snapshot": {"graph_id": graph_id, "name": graph.get("name", ""),
                           "nodes": nodes, "edges": edges},
    }

    ordered = _topo_sort(nodes, edges)
    node_by_id = {n["id"]: n for n in nodes}
    step_node_map: dict[str, str] = {}
    node_last_step: dict[str, str] = {}  # node_id → last step_id of that node

    # Build parent-edge lookup: node_id → list of ancestor node_ids (all depths)
    def _all_ancestors(nid: str) -> list:
        """Return all ancestor nodes (BFS) for a given node id."""
        visited, queue = set(), [nid]
        while queue:
            cur = queue.pop()
            for e in edges:
                if e["target"] == cur and e["source"] not in visited:
                    visited.add(e["source"])
                    queue.append(e["source"])
        return [node_by_id[a] for a in visited if a in node_by_id]

    all_steps_raw = []
    for node in ordered:
        nid = node["id"]
        ntype0 = node.get("data", {}).get("node_type") or node.get("type", "")
        has_input = any(e["target"] == nid for e in edges)
        # Mode FREE : node sans input → expose l'app ou les sorties existantes.
        # Inference génère un human gate afin d'ouvrir sa session fichier manuelle.
        if _is_free_node(node, edges) and ntype0 != "inference":
            continue
        parent_ids = [e["source"] for e in edges if e["target"] == nid]
        deps = [node_last_step[pid] for pid in parent_ids if pid in node_last_step]
        # For training nodes pass ALL ancestors so dataset_path can be derived
        # even when the direct parent is not an annotation node (e.g. Optuna → Training)
        ntype = node.get("data", {}).get("node_type") or node.get("type", "")
        # Training / Inference / DVC / Optuna : ancetres complets pour deriver le dataset
        # (annotation), les best params (optuna) ET le modele porte par l'arete (training).
        if ntype in ("training", "inference", "dvc", "optuna"):
            parent_nodes = _all_ancestors(nid)
        else:
            parent_nodes = [node_by_id[pid] for pid in parent_ids if pid in node_by_id]
        node_steps = _steps_for_node(node, deps, ctx, parent_nodes, has_input)
        for s in node_steps:
            step_node_map[s["id"]] = nid
        all_steps_raw.extend(node_steps)
        if node_steps:
            node_last_step[nid] = node_steps[-1]["id"]

    # step1 : sur chaque human_gate, aperçu de « la prochaine étape » = le libellé du/des
    # step(s) qui dépendent directement de ce gate (ex. gate « Vérifier embedding » → ensuite
    # « Créer subset … »). Affiché à droite du bouton Continuer côté frontend.
    for s in all_steps_raw:
        if s.get("type") == "human_gate":
            nxt = next((o.get("label", "") for o in all_steps_raw if s["id"] in o.get("depends_on", [])), "")
            if nxt:
                s["next_label"] = nxt

    pipeline_steps = [PipelineStep(**s) for s in all_steps_raw]

    pipeline = PipelineDef(
        id=f"graph__{graph_id}",
        name=graph.get("name", "Graph Experiment"),
        steps=pipeline_steps,
    )
    return pipeline, step_node_map


# ── App reachability check ────────────────────────────────────────────────────

import asyncio
import logging
import time as _time

logger = logging.getLogger(__name__)

_KEY_TO_APP_ID = {
    "Dataset_Explorer_App":   "explorer",
    "Annotation_App": "annotation",
    "Training_App":   "training",
    "Inference_App":  "inference",
    "dvc-app":        "dvc",
    "mlflow-app":     "mlflow",
    "optuna-app":     "optuna",
}


async def _check_app_reachable(url: str, timeout: float = 2.0) -> bool:
    try:
        import httpx
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(f"{url}/health")
            return r.status_code < 500
    except Exception:
        return False


def _needed_app_keys(graph: dict) -> set[str]:
    needed: set[str] = set()
    edges = graph.get("edges", [])
    for node in graph.get("nodes", []):
        ntype = node.get("data", {}).get("node_type") or node.get("type", "")
        # MLflow = SUPERVISOR : toujours lance (observateur du store), meme sans arete.
        if ntype == "mlflow":
            needed.add("mlflow-app")
            continue
        # step6 : DVC = OBSERVATEUR (comme MLflow) — toujours lancé pour alimenter le hub
        # (récup/versionnage des artefacts), même sans aucune arête entrante.
        if ntype == "dvc":
            needed.add("dvc-app")
            continue
        # Inference peut être ouverte manuellement même sans arête.
        if ntype == "inference":
            needed.add("Inference_App")
            continue
        # Les autres nodes FREE n'exécutent aucune étape → leur app n'a pas besoin d'être lancée
        if _is_free_node(node, edges):
            continue
        if ntype in ("dataset_source", "explorer"):
            needed.add("Dataset_Explorer_App")
        elif ntype == "annotation":
            needed.add("Annotation_App")
        elif ntype == "training":
            needed.add("Training_App")
        elif ntype == "inference":
            needed.add("Inference_App")
        elif ntype == "dvc":
            needed.add("dvc-app")
        elif ntype == "optuna":
            needed.add("optuna-app")
    return needed


async def _preflight_check(graph: dict) -> list[str]:
    """
    Return list of app names required by this graph that need to be launched.

    Strategy: trust only sessions registered by THIS orchestrator process (stored
    in app_launcher._sessions / STATE_FILE).  If a registered session is alive we
    update APP_URLS to its URL and skip it.  If no session exists we mark the app
    as unavailable — even if some other process happens to answer at the default URL
    (e.g. another user's orchestrator sitting on the default DVC port).
    Resetting the URL to a dummy value prevents _wait_for_app from falsely succeeding
    on the foreign app before _auto_launch_and_wait updates it to the real URL.
    """
    from backend.config import APP_URLS
    from backend.core import app_launcher
    needed = _needed_app_keys(graph)
    unavailable = []
    for app_key in needed:
        app_id = _KEY_TO_APP_ID.get(app_key)
        if app_id:
            session = app_launcher.get_session(app_id)
            if (session and session.backend_pid
                    and app_launcher._pid_alive(session.backend_pid)):
                APP_URLS[app_key] = session.backend_url
                continue  # owned and alive — no launch needed

        # No registered/alive session: must launch.
        # Reset to a non-listening address so _wait_for_app doesn't succeed on a
        # foreign app while _auto_launch_and_wait is still bringing ours up.
        APP_URLS[app_key] = "http://localhost:1"
        unavailable.append(app_key)
    return unavailable


def _ordered_app_keys(graph: dict) -> list[str]:
    """App keys needed by the graph, dans l'ordre topologique des nœuds (l'app de
    la 1re étape en premier). Sert à lancer les apps dans l'ordre où le pipeline
    en a besoin → la 1re étape n'attend jamais une app lancée en dernier."""
    ntype_to_key = {
        "dataset_source": "Dataset_Explorer_App", "explorer": "Dataset_Explorer_App",
        "annotation": "Annotation_App", "training": "Training_App",
        "inference": "Inference_App", "dvc": "dvc-app",
        "mlflow": "mlflow-app", "optuna": "optuna-app",
    }
    ordered: list[str] = []
    for node in _topo_sort(graph.get("nodes", []), graph.get("edges", [])):
        ntype = node.get("data", {}).get("node_type") or node.get("type", "")
        key = ntype_to_key.get(ntype)
        if key and key not in ordered:
            ordered.append(key)
    return ordered


async def _launch_sequence(app_keys: list[str]) -> None:
    """Lance les apps une par une (attend que chacune réponde avant la suivante)."""
    for k in app_keys:
        try:
            await _auto_launch_and_wait(k, timeout=240.0)
        except Exception as exc:
            logger.error("Auto-launch %s failed: %s", k, exc)


async def _auto_launch_and_wait(app_key: str, timeout: float = 240.0) -> bool:
    """
    Auto-launch a sub-app if not already running, then wait up to `timeout` seconds
    for its /health endpoint to respond.  Returns True if reachable.
    """
    from backend.config import APP_URLS, APP_FRONTEND_URLS, WORKSPACE, CURRENT_USER
    from backend.core import app_launcher

    app_id = _KEY_TO_APP_ID.get(app_key)
    if not app_id:
        return False

    # Lancer si : pas de session, session stoppée, OU session « vivante » dont le
    # port backend n'écoute plus (worker zombie après un reload uvicorn) — sinon on
    # pollait localhost:1 (posé par le preflight) jusqu'au timeout sans jamais relancer.
    session = app_launcher.get_session(app_id)

    # Part A (Bob 2026-07-25) — instance FIGÉE : le port écoute (uvicorn up) mais /health
    # reste MUET. Cas vécu : instance stale d'un ancien run (launcher_state) ou worker
    # zombie. Avant, `_port_listening` la voyait « vivante » → on la réutilisait et on
    # pollait /health 240s pour rien (« Inference_App non accessible après 240s »).
    # Désormais on sonde /health : sain immédiatement → OK ; muet → on laisse ~40s de
    # grâce (démarrage à froid légitime) puis, si toujours muet, on la TUE et on respawn.
    if session and session.status != "stopped" and app_launcher._port_listening(session.backend_url):
        healthy = await _check_app_reachable(session.backend_url, timeout=3.0)
        if not healthy:
            for _ in range(13):                       # ~40s
                await asyncio.sleep(3)
                if await _check_app_reachable(session.backend_url, timeout=3.0):
                    healthy = True
                    break
            if not healthy:
                logger.warning("%s : port ouvert mais /health muet ~40s → instance figée, kill + respawn", app_id)
                try:
                    app_launcher.stop_app(app_id)
                except Exception as exc:
                    logger.error("stop_app(%s) a échoué: %s", app_id, exc)
                session = None

    if (not session or session.status == "stopped"
            or not app_launcher._port_listening(session.backend_url)):
        try:
            logger.info("Auto-launching %s (%s)...", app_id, app_key)
            annotation_imports = None
            if app_id == "explorer":
                from pathlib import Path
                ann = app_launcher.get_session("annotation")
                if ann and ann.workspace:
                    annotation_imports = str(Path(ann.workspace) / "imports")
                else:
                    # Annotation not yet launched — compute from expected workspace structure
                    annotation_imports = str(Path(WORKSPACE) / f"annotation_{CURRENT_USER or 'user'}" / "imports")
            session = app_launcher.launch_app(
                app_id=app_id,
                base_workspace=str(WORKSPACE),
                user=CURRENT_USER or "user",
                annotation_imports=annotation_imports,
            )
            # Update live APP_URLS and APP_FRONTEND_URLS
            APP_URLS[app_key] = session.backend_url
            APP_FRONTEND_URLS[app_key] = session.frontend_url
        except Exception as exc:
            logger.error("Failed to auto-launch %s: %s", app_id, exc)
            return False
    elif session and app_launcher._port_listening(session.backend_url):
        # Session déjà vivante : le preflight a pu poser localhost:1 → on restaure
        # l'URL réelle pour ne pas poller une adresse morte.
        APP_URLS[app_key] = session.backend_url
        APP_FRONTEND_URLS[app_key] = session.frontend_url

    url = APP_URLS.get(app_key, "")
    if not url or url == "http://localhost:1":
        return False

    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        if await _check_app_reachable(url):
            logger.info("%s is now reachable at %s", app_id, url)
            return True
        await asyncio.sleep(2)

    logger.warning("%s still not reachable after %.0fs", app_id, timeout)
    return False


# ── Run ───────────────────────────────────────────────────────────────────────

async def run_graph(graph_id: str) -> dict:
    """
    Start execution of a sandgraph.
    Returns {run_id, pipeline_id, step_node_map}.
    """
    graph = graph_store.get_graph(graph_id)
    if not graph:
        raise ValueError(f"Graph {graph_id} not found")

    # Launch needed apps in the background — le pipeline démarre tout de suite et
    # chaque étape attend son app via _wait_for_app() (timeout large, cold start).
    #
    # IMPORTANT (fix stalemate 1er lancement) : on lance les apps SÉQUENTIELLEMENT
    # (1 par 1), dans l'ordre du pipeline. Lancer 4-5 apps en parallèle (chacune =
    # uvicorn + npm + torch) sature le CPU/disque → aucune ne répond avant 60s →
    # la 1re étape échouait, alors qu'au 2e lancement (apps déjà chaudes) tout
    # marchait. Le lancement en série évite ce thrashing.
    unavailable = await _preflight_check(graph)
    if unavailable:
        ordered = [k for k in _ordered_app_keys(graph) if k in unavailable]
        ordered += [k for k in unavailable if k not in ordered]
        logger.info("Auto-launching sequentially: %s", ordered)
        asyncio.create_task(_launch_sequence(ordered))

    pipeline, step_node_map = graph_to_pipeline(graph)
    save_pipeline(pipeline)

    run_id = await pipeline_runner.start_run(pipeline)

    graph_store.start_run(graph_id, run_id, pipeline.id, step_node_map)

    return {
        "run_id":        run_id,
        "pipeline_id":   pipeline.id,
        "step_node_map": step_node_map,
        # Apps hors-ligne en cours de lancement (séquentiel) → écran « démarrage » (step 3).
        "launching":     unavailable,
    }
