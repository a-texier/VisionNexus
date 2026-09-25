---
app: orchestrator
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation du code, backend, frontend, modules]
sources: [Orchestrator_App/backend, Orchestrator_App/frontend/src]
---

# Carte du code

## Où commencer à lire le code backend

Lisez ces fichiers dans cet ordre pour comprendre le backend :

1. `config.py` : le workspace (`ORCHESTRATOR_WORKSPACE`), la resolution de l'utilisateur courant, les ports, `APP_URLS`/`APP_FRONTEND_URLS`, le CORS.
2. `main.py` : l'application FastAPI, le lifespan (init du logger de debug, `repatch_app_urls()`), le montage des routeurs, les endpoints directs de workspace.
3. `api/graphs.py` : le routeur sandgraph, le plus gros fichier du backend ; CRUD, run/resume/stop, le flux SSE, le scan workspace-outputs, le hub d'artefacts DVC.
4. `core/graph_runner.py` : convertit un graphe en `PipelineDef` ; c'est la que le comportement de chaque type de nœud est defini.
5. `core/pipeline_runner.py` : l'executeur DAG async qui appelle reellement les sous-applications.
6. `core/graph_store.py`, `core/app_launcher.py` : persistance des graphes et gestion des processus de sous-applications.

## Où commencer à lire le code frontend

1. `App.tsx` : la mise en page de la barre laterale et la table des routes, y compris les routes imbriquees `/mlops/*`.
2. `pages/SandgraphPage.tsx` : l'editeur principal, de loin le plus gros fichier frontend ; lisez-le par fonctionnalite (barre d'outils, client SSE, validation, propagation d'aretes) plutot que de haut en bas.
3. `nodes/ports.ts` : le schema de ports type que chaque type de nœud declare.
4. `components/NodeConfigPanel.tsx` : un formulaire de configuration par type de nœud.
5. `api/client.ts` : chaque appel backend, groupe par domaine (`graphsAPI`, `launcherAPI`, `insightsAPI`, `plansAPI`, `docsAPI`, ...).

## Où changer le comportement de pipeline d'un type de nœud

Les etapes de chaque type de nœud sont construites par une branche de `_steps_for_node()` dans `backend/core/graph_runner.py`. Pour changer ce qu'un nœud produit, editez cette branche ; pour changer quel endpoint de sous-application il appelle, editez le champ `endpoint` du dict d'etape qu'il renvoie. Le formulaire de configuration visuel du nœud vit dans une fonction correspondante de `frontend/src/components/NodeConfigPanel.tsx` (par exemple `AnnotationConfig`, `TrainingConfig`), et son texte d'aide contextuelle dans `frontend/src/nodes/nodeHelp.ts` (`NODE_HELP`).

## Où ajouter un nouveau type de nœud

1. Ajoutez le type a `NODE_PORTS` dans `frontend/src/nodes/ports.ts` (entrees, sorties, `accepts`, `required`/`exclusiveWith`/`requiresPeer` selon le besoin).
2. Ajoutez une entree par defaut a `TOOLBOX_NODES` dans `frontend/src/pages/SandgraphPage.tsx` pour qu'il puisse etre glisse sur le canvas, et enregistrez son type dans `frontend/src/nodes/index.ts` (`nodeTypes`), en reutilisant `AppNode.tsx` sauf si le nouveau type a besoin d'un visuel tres different (comme `DatasetNode.tsx` ou `ModelNode.tsx`).
3. Ajoutez une branche de formulaire de configuration dans `NodeConfigPanel.tsx` et une entree d'aide dans `nodeHelp.ts`.
4. Ajoutez une branche a `_steps_for_node()` dans `backend/core/graph_runner.py` qui renvoie la ou les etapes de pipeline pour ce type, et enregistrez la sous-application dont il a besoin dans `_needed_app_keys()` et `_ordered_app_keys()` si ce n'est pas deja couvert.
5. Si le nœud participe au mode FREE/LOCKED, ajoutez-le a la logique d'exclusion de `_is_free_node()` et a la condition de saut de `graph_to_pipeline()` ; la plupart des nouveaux types de nœud ne devraient pas opter pour le mode FREE sauf s'ils exposent reellement des sorties de workspace preexistantes.

## Où changer la logique d'auto-lancement ou de SSE

Auto-lancement : `_preflight_check()`, `_auto_launch_and_wait()` et `_launch_sequence()` dans `backend/core/graph_runner.py` ; le lancement de processus lui-meme est dans `backend/core/app_launcher.py`. SSE : `event_generator()` dans `backend/api/graphs.py` (cote serveur) et le client `fetch()` brut dans `_openSSE()` dans `frontend/src/pages/SandgraphPage.tsx` (cote client) ; le generateur de relecture sous-jacent est `stream_events()` dans `backend/core/pipeline_runner.py`. Lisez les invariants dans [Architecture](architecture.fr.md#invariants-à-ne-pas-casser) avant de toucher a l'un ou l'autre.

## Où changer le Run Insight, le Lineage ou les Plans d'expériences

Generation d'Insight : `backend/core/insights.py` (`collect()`, `_build_lineage()`, `generate()`) et son API dans `backend/api/insights.py`. Graphe de Lineage : `backend/api/lineage.py`. Plans d'experiences : `backend/core/plan_store.py` (persistance), `backend/core/plan_runner.py` (moteur d'execution), `backend/api/plans.py` (API), et l'interface d'edition dans `frontend/src/pages/PlansPage.tsx`.

## Où changer la documentation intégrée

Les pages markdown vivent dans `docs/` a la racine de l'application (la propre source de cette page). Le routeur qui les sert est `backend/api/docs.py` ; les composants de rendu sont `frontend/src/components/docs/markdown.ts` et `MarkdownDoc.tsx` ; la page qui les affiche est `frontend/src/pages/GuidePage.tsx`. Regenerez les tableaux ci-dessous avec `python tools/docs/gen_code_map.py --app orchestrator` apres avoir deplace ou renomme des fichiers backend ou frontend.

## Carte des modules

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  | `UnknownUserError` |
| `main.py` |  | `lifespan`, `root_health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `activity.py` |  | `activity` |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `engines.py` |  | `list_engines` |
| `experiments.py` |  | `list_experiments`, `get_experiment`, `resume_experiment`, `delete_experiment`, `restart_experiment` |
| `graphs.py` |  | `CreateGraphBody`, `UpdateGraphBody`, `list_graphs`, `create_graph`, `get_graph`, `update_graph`, `delete_graph`, `duplicate_graph`, `ForkRunBody`, `fork_run`, `track_mlops`, `reset_graph` (+19) |
| `health.py` |  | `health` |
| `insights.py` |  | `GenerateBody`, `list_insights`, `get_insights`, `get_plot`, `delete_insights`, `generate_insights` |
| `launcher_api.py` |  | `LaunchBody`, `list_apps`, `launch_app`, `stop_app`, `launch_all_apps`, `stop_all_apps` |
| `lineage.py` |  | `get_lineage` |
| `pipelines.py` |  | `PipelineBody`, `list_pipelines`, `create_pipeline`, `get_pipeline`, `update_pipeline`, `delete_pipeline`, `start_run`, `stream_run`, `get_run_status` |
| `plans.py` |  | `Step`, `PlanBody`, `list_plans`, `create_plan`, `get_plan`, `update_plan`, `delete_plan`, `run_plan`, `plan_status` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `activity_store.py` |  | `StepResult`, `ActivityRun`, `record_run`, `get_activity` |
| `app_launcher.py` |  | `AppSession`, `launch_app`, `stop_app`, `get_all_sessions`, `get_session`, `set_status`, `repatch_app_urls` |
| `experiment_store.py` |  | `StepRecord`, `Experiment`, `create_experiment`, `get_experiment`, `get_experiment_by_run`, `list_experiments`, `update_step`, `set_waiting`, `complete_experiment`, `interrupt_experiment`, `update_metrics`, `update_artifacts` |
| `graph_runner.py` |  | `GraphConfigError`, `graph_to_pipeline`, `run_graph` |
| `graph_store.py` |  | `graph_node_types`, `mlops_status`, `create_graph`, `get_graph`, `list_graphs`, `update_graph`, `delete_graph`, `duplicate_graph`, `start_run`, `update_node_exec`, `set_node_data`, `set_graph_waiting` (+6) |
| `insights.py` |  | `collect`, `generate`, `delete`, `list_all`, `load`, `plot_path` |
| `pipeline_runner.py` |  | `StepState`, `RunState`, `start_run`, `get_run_state`, `run_in_memory`, `resume_run`, `stop_run`, `extend_run`, `update_run_pipeline`, `stream_events` |
| `pipeline_store.py` |  | `PipelineStep`, `PipelineDef`, `list_pipelines`, `get_pipeline`, `save_pipeline`, `create_pipeline`, `update_pipeline`, `mark_run`, `delete_pipeline` |
| `plan_runner.py` |  | `run_plan`, `start_plan`, `get_run_state` |
| `plan_store.py` |  | `create_plan`, `get_plan`, `list_plans`, `update_plan`, `delete_plan`, `set_run_state` |
| `proxy_client.py` |  | `ping`, `ping_all`, `request` |
| `run_manifest.py` | Manifeste canonique d'une execution Orchestrator. | `load`, `write`, `start`, `finalize` |

### backend/tools

| File | Description | Exports |
|---|---|---|
| `__init__.py` | Outils de maintenance explicites de l'Orchestrator. |  |
| `migrate_run_manifests.py` | Migre les anciens Insights vers des manifestes stricts par run. | `migrate` |

### backend/utils

| File | Description | Exports |
|---|---|---|
| `debug_logger.py` |  | `DebugLogger` |
| `native_share.py` |  | `from_native_share_path`, `normalize_input_path` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - layout principal avec sidebar | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` |  | `BACKEND_BASE`, `healthAPI`, `pipelinesAPI`, `activityAPI`, `settingsAPI`, `experimentsAPI`, `enginesAPI`, `docsAPI`, `graphsAPI`, `insightsAPI`, `plansAPI`, `launcherAPI` (+1) |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `NodeConfigPanel.tsx` | NodeConfigPanel - panneau de configuration d'un nœud sélectionné | `NodeConfigPanel` |
| `Plot.tsx` | Plot.tsx - wrapper React minimal autour de plotly.js (bundle min). | `Plot`, `buildHtmlReport` |
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page Guide. | `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useActivity.ts` |  | `useActivity`, `useInvalidateActivity` |
| `useEngines.ts` |  | `useEngines`, `shortSize` |
| `useHealth.ts` |  | `useHealth` |
| `usePipelines.ts` |  | `usePipelines`, `usePipeline`, `useInvalidatePipelines` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/nodes

| File | Description | Exports |
|---|---|---|
| `AppNode.tsx` | AppNode - nœud générique pour chaque sous-app CV | `NodeActivity`, `NodeProgress` |
| `DatasetNode.tsx` | DatasetNode - nœud source de dataset |  |
| `index.ts` |  | `nodeTypes` |
| `ModelNode.tsx` | ModelNode - nœud d'ENTRÉE : des poids d'un moteur d'entraînement, fournis manuellement. |  |
| `nodeHelp.ts` | nodeHelp.ts - contenu du panneau d'AIDE (bouton HELP rouge du NodeConfigPanel). | `NODE_HELP` |
| `NodePorts.tsx` | nodes/NodePorts.tsx - section « blueprint » partagée par tous les nœuds. | `NodePorts` |
| `OrthogonalEdge.tsx` | nodes/OrthogonalEdge.tsx - arête unique « Blueprint style » utilisée pour | `OrthogonalEdge` |
| `ports.ts` | nodes/ports.ts - schéma de branchement « blueprint » des nœuds. | `PORT_COLOR`, `PORT_EMPTY_HANDLE`, `PORT_STROKE`, `NODE_PORTS`, `resolveHandles`, `inputAccepts`, `wouldViolateExclusivity`, `validatePortRules`, `compatibleNodeTypes` |
| `routing.ts` | nodes/routing.ts - moteur de routage orthogonal « Blueprint style ». | `ROW_BAND`, `CORRIDOR_MARGIN`, `LANE_SPACING`, `STUB`, `CORNER_RADIUS`, `xRangeOf`, `decideMode`, `assignLanes`, `buildPoints`, `svgPathFromPoints`, `estimatePillWidth`, `LABEL_EDGE_MARGIN` (+2) |
| `shared.ts` |  | `STATUS_DOT`, `STATUS_RING` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `AboutPage.tsx` | Présentation de la plateforme MLOps Computer Vision. | `AboutPage` |
| `ActivityPage.tsx` | Timeline complète des exécutions passées. | `ActivityPage` |
| `AppsPage.tsx` | AppsPage.tsx - Lancement et statut des sous-apps CV | `AppsPage` |
| `DashboardPage.tsx` | Cards de statut des 5 apps + widget run actif + feed activité. | `DashboardPage` |
| `ExperimentsPage.tsx` | Liste des expériences sandgraph + templates prédéfinis. | `ExperimentsPage` |
| `GuidePage.tsx` | Sous-onglet MLOps > Guide : documentation integree. Rend les pages | `GuidePage` |
| `InsightsPage.tsx` | Insights par run de template : plots d'evolution (training, | `InsightsPage` |
| `LibraryPage.tsx` | Grille des pipelines sauvegardés + templates prédéfinis. | `LibraryPage` |
| `LineageGraphPage.tsx` |  | `LineageGraphPage` |
| `MLOpsPage.tsx` | MLOpsPage.tsx - onglet parent "MLOps" : monitoring + tracabilite. | `MLOpsPage` |
| `PipelinePage.tsx` | Éditeur de pipeline + DAG SVG + exécution avec SSE. | `PipelinePage` |
| `PlansPage.tsx` | PlansPage.tsx - Experiment Plans : construire une suite d'etapes | `PlansPage` |
| `SandgraphPage.tsx` | SandgraphPage.tsx - Éditeur de graphe interactif (ReactFlow) | `LogBlocks`, `SandgraphPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - miroir exact des schémas Pydantic backend | `deriveMlops` |

### frontend/src/utils

| File | Description | Exports |
|---|---|---|
| `time.ts` |  | `formatDistanceToNow`, `formatDuration`, `formatDateTime` |
| `workspaceStorage.ts` |  | `workspaceStorageScope`, `workspaceStorageKey`, `useWorkspaceStorageScope` |
<!-- generated:end -->
