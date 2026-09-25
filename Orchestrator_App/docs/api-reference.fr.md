---
app: orchestrator
doc_type: api-reference
audience: dev
lang: fr
title: Référence API
order: 70
tags: [rest api, sse, graphs, insights, lineage, plans, launcher]
sources: [Orchestrator_App/backend/main.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/backend/api/launcher_api.py, Orchestrator_App/backend/api/insights.py, Orchestrator_App/backend/api/lineage.py, Orchestrator_App/backend/api/plans.py, Orchestrator_App/backend/api/engines.py, Orchestrator_App/backend/api/docs.py, Orchestrator_App/backend/api/health.py, Orchestrator_App/backend/api/settings.py, Orchestrator_App/backend/api/activity.py, Orchestrator_App/backend/api/pipelines.py, Orchestrator_App/backend/api/experiments.py]
---

# Référence API

## Conventions de l'API Orchestrator

Le backend Orchestrator App expose une API REST JSON sous `/api`, un flux Server-Sent Events pour l'execution des runs, et une documentation interactive (Swagger) sur `/docs` au port du backend (8060 par defaut, voir [Configuration](configuration.fr.md)). Via le frontend Vite, les memes chemins sont proxifies, si bien que le frontend appelle toujours des URLs relatives, sauf le flux SSE d'execution, qui utilise sa propre URL relative de meme origine pour eviter la mise en tampon du proxy.

Regles generales :

- **Erreurs** au format FastAPI `{"detail": "..."}` avec 400 (graphe incoherent, par exemple une incoherence de moteur de modele), 404 (graphe, run ou plan inconnu), 409 (un graphe deja en cours, ou un run qui n'attend plus) ou 410 (une reprise contre un run perdu apres un redemarrage du backend). Les messages de detail melangent anglais et francais selon le module qui les leve.
- **Operations longues** (un run de graphe) renvoient immediatement un `run_id` ; suivez-le avec `GET /api/graphs/{id}/run/{run_id}/stream` (SSE). Il n'y a pas d'endpoint d'interrogation separe pour le statut d'un run de graphe au-dela de relire le graphe lui-meme, qui est resynchronise depuis l'etat de run en memoire a chaque lecture.
- **L'ordre des routes compte** pour le routeur `graphs` : ses routes `/meta/*` sont declarees avant la route parametree `/{graph_id}`, pour qu'un chemin litteral comme `/api/graphs/meta/app-urls` ne soit jamais capture comme un id de graphe.
- Les reponses de plus de 1 Ko ne sont pas compressees en gzip par ce backend (contrairement a certaines sous-applications) ; les appels proxifies vers les sous-applications passent par `proxy_client`, qui tronque les corps de reponse a 100 000 caracteres.

## Endpoints du Sandgraph : CRUD, exécution et scan du workspace

Le routeur graphs (`/api/graphs`) est le point d'entree principal : il gere les graphes dans leur ensemble et pilote leur execution.

- `GET /api/graphs` liste les graphes (chaque entree resynchronisee depuis son etat de run live d'abord si elle en a un) ; `POST /api/graphs` en cree un (`name`, `nodes`, `edges`). `GET/PUT/DELETE /api/graphs/{id}` lisent, modifient ou suppriment un graphe. `POST /api/graphs/{id}/duplicate` copie un graphe, en reinitialisant son historique d'execution.
- `POST /api/graphs/{id}/run` convertit le graphe en pipeline et le lance en arriere-plan, en auto-lancant d'abord toute sous-application manquante ; `POST /api/graphs/{id}/resume` continue un run en pause a un point d'arret humain, en reconstruisant le pipeline depuis l'etat courant du graphe ; `POST /api/graphs/{id}/stop` annule un run en cours ou en attente ; `POST /api/graphs/{id}/reset` efface l'etat d'execution sans toucher aux nœuds ni aux aretes.
- `GET /api/graphs/{id}/run/{run_id}/stream` est l'endpoint SSE decrit dans [Architecture](architecture.fr.md#architecture-sse) : il diffuse des objets `RunEvent` et met a jour l'etat d'execution des nœuds et la generation progressive d'Insight au fur et a mesure qu'il les transmet.
- `POST /api/graphs/{id}/fork-run` duplique le graphe et enregistre la provenance `forked_from` depuis l'un de ses runs termines ; `POST /api/graphs/{id}/track-mlops` ajoute de facon idempotente le ou les nœuds observateurs MLflow et/ou DVC manquants.
- `GET /api/graphs/meta/workspace-outputs` scanne le systeme de fichiers du workspace (ne demande jamais a une sous-application) pour les subsets Dataset Explorer et les exports Annotation existants, utilise pour remplir les selecteurs du mode FREE. `GET /api/graphs/meta/app-urls` renvoie les URLs frontend des sous-applications pour les liens "Ouvrir l'application". `GET /api/graphs/meta/explorer-subsets`, `/meta/mlflow-summary`, `/meta/check-dataset-path`, `/meta/check-annotation-source` et `/meta/annotation-exports` proxifient des donnees live depuis Dataset_Explorer_App, mlflow-app et Annotation_App, tous en best-effort (une application inaccessible renvoie un resultat vide, pas une erreur). `GET /api/graphs/meta/inference-config` lit directement sur disque le `config/defaults.yaml` d'Inference_App pour prereplir son panneau de configuration sans exiger que l'application tourne.
- `GET /api/graphs/{id}/artifacts` et `POST /api/graphs/{id}/dvc-commit` sont le hub du nœud DVC : lister les sorties versionnables d'un run precis et creer une version a partir de celles que vous cochez. `GET /api/graphs/meta/download` diffuse (et zippe, pour un dossier) tout fichier du workspace sous la liste d'artefacts d'un graphe. `GET /api/graphs/{id}/download-graph` telecharge le JSON brut du graphe. `GET /api/graphs/{id}/runs/{run_id}/manifest` renvoie le manifeste de run canonique.
- `POST /api/graphs/{id}/webhook/annotation-exported` est appele par Annotation_App elle-meme quand un utilisateur termine un export manuel, reprenant automatiquement le graphe s'il attend exactement a ce point d'arret.

## Endpoints du lanceur : cycle de vie des sous-applications

Le routeur lanceur (`/api/apps`) gere les processus de sous-applications, utilise par la page **Applications** et en interne par l'auto-lancement de `graph_runner`.

- `GET /api/apps` liste chaque sous-application connue avec son statut live, en sondant `/health` pour les sessions pas deja confirmees `running` et en les promouvant ou en les mettant en echec selon le resultat et depuis combien de temps elles demarrent.
- `POST /api/apps/launch` lance une application (`app_id`, `base_workspace` optionnel, `user`, `conda_env`) ; `POST /api/apps/{id}/stop` en arrete une. `POST /api/apps/launch-all` et `POST /api/apps/stop-all` font de meme pour chaque application pas deja en cours ou pas deja arretee.

## Endpoints Insights : collecte et récupération du Run Insight

Le routeur insights (`/api/insights`) gere le Run Insight decrit dans [Concepts](concepts.fr.md#run-insight--ce-quun-run-a-laissé-derrière-lui).

- `GET /api/insights` liste chaque Insight genere a travers tous les graphes et runs. `GET /api/insights/{graph_id}/{run_id}` renvoie le paquet complet (404 si pas encore genere). `GET /api/insights/{graph_id}/{run_id}/plot/{name}` sert un PNG de plot (protege contre le path-traversal). `DELETE /api/insights/{graph_id}/{run_id}` supprime les fichiers de l'Insight, ce qui n'est qu'un cache d'affichage ; le lineage sous-jacent, les versions DVC et les runs MLflow ne sont pas touches et l'Insight peut etre regenere.
- `POST /api/insights/{graph_id}/generate` (re)genere l'Insight pour un `run_id` donne, ou le run connu le plus recent du graphe si omis.

## Endpoint Lineage : graphe cross-expériences

`GET /api/lineage` (`include_failed: bool`, defaut false) construit le graphe de lineage `{nodes, edges}` a travers tous les graphes du workspace, decrit dans [Concepts](concepts.fr.md#lineage--relier-les-runs-à-travers-tout-le-workspace) et [Architecture](architecture.fr.md#run-insight-et-lineage-git--dvc--mlflow). Aucune URL n'est resolue cote serveur ; les liens profonds vers les frontends des sous-applications sont construits par le client depuis `GET /api/graphs/meta/app-urls`.

## Endpoints Plans : Plans d'expériences

Le routeur plans (`/api/plans`) gere les Plans d'experiences, decrits dans [Concepts](concepts.fr.md#plans-dexpériences).

- `GET /api/plans` liste les plans ; `POST /api/plans` en cree un (`name`, `steps`). `GET/PUT/DELETE /api/plans/{id}` lisent, modifient ou suppriment un plan.
- `POST /api/plans/{id}/run` demarre l'execution en tache de fond, renvoyant `{"ok": false, "message": "..."}` (pas une erreur HTTP) si le plan tourne deja. `GET /api/plans/{id}/status` renvoie l'etat d'execution courant, ou `{"status": "idle"}` s'il n'a jamais tourne.

## Endpoint Engines : catalogue des moteurs d'entraînement

`GET /api/engines` renvoie les moteurs d'entrainement disponibles pour les nœuds `model`, `training` et `optuna`, chacun avec son catalogue de tailles et d'hyperparametres. Il essaie d'abord le propre `GET /api/capabilities` de Training_App ; si cette application n'est pas accessible ou renvoie un catalogue vide, il retombe sur l'import direct du registre local de plugins de Training_App (best-effort, fonctionne meme sans sous-application en cours, pour qu'un graphe puisse etre edite hors ligne).

## Endpoints Docs : documentation intégrée

`GET /api/docs` liste les pages de documentation disponibles dans une langue, triees par l'ordre du manifeste. `GET /api/docs/{name}` renvoie le frontmatter et le corps markdown d'une page, avec repli sur l'autre langue si celle demandee manque. `GET /api/docs/assets/{path}` sert une image referencee depuis une page. Ces endpoints alimentent le sous-onglet **Guide** decrit dans le [Guide utilisateur](user-guide.fr.md).

## Endpoints santé, paramètres et activité

`GET /api/health` sonde simultanement chaque sous-application configuree et renvoie la latence et l'accessibilite par application ; il alimente les points de sante de la page Applications. `GET/PUT /api/settings` lit et ecrit le petit enregistrement `AppSettings` (`theme`, `ui_language`) ; `workspace_path` et `user_name` sont toujours ecrases par les `CURRENT_USER`/`WORKSPACE` live a la lecture, jamais pris depuis le fichier stocke. `GET /api/activity` renvoie les N dernieres entrees (defaut 50, max 200) du journal d'execution en ajout seul, aussi montre dans le sous-onglet **Activité**.

## Endpoints historiques de pipeline et d'expérience

`pipelines`, `experiments` et une partie de `graphs` sont anterieurs a l'editeur Sandgraph et sont conserves seulement pour les pages accessibles a `/library`, `/pipeline/{id}` et `/dashboard`, decrites comme historiques dans le [Guide utilisateur](user-guide.fr.md). `/api/pipelines` est un CRUD simple plus `POST /{id}/run` et son propre flux SSE, fonctionnellement identique dans sa forme a celui du Sandgraph mais operant sur un `PipelineDef` construit a la main au lieu d'un graphe converti. `/api/experiments` expose les memes enregistrements de run que le run du Sandgraph cree aussi, avec `POST /{id}/resume` et `POST /{id}/restart` comme autres moyens d'interagir avec le pipeline sous-jacent d'un run.

## Index des endpoints

Les tableaux d'endpoints ci-dessous sont generes depuis le code ; les sections ci-dessus expliquent chaque domaine.

<!-- generated:start -->
### activity

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/activity` | Activity | `Orchestrator_App/backend/api/activity.py:12` |

### docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `Orchestrator_App/backend/api/docs.py:163` |
| GET | `/api/docs/assets/{asset_path}` | Get Doc Asset |  |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `Orchestrator_App/backend/api/docs.py:197` |

### Engines

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/engines` | List Engines | `Orchestrator_App/backend/api/engines.py:61` |

### experiments

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/experiments` | List Experiments | `Orchestrator_App/backend/api/experiments.py:14` |
| DELETE | `/api/experiments/{experiment_id}` | Delete Experiment | `Orchestrator_App/backend/api/experiments.py:42` |
| GET | `/api/experiments/{experiment_id}` | Get Experiment | `Orchestrator_App/backend/api/experiments.py:19` |
| POST | `/api/experiments/{experiment_id}/restart` | Relance un run pour le même pipeline que cette expérience. | `Orchestrator_App/backend/api/experiments.py:51` |
| POST | `/api/experiments/{experiment_id}/resume` | Resume Experiment | `Orchestrator_App/backend/api/experiments.py:27` |

### graphs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/graphs` | List Graphs | `Orchestrator_App/backend/api/graphs.py:126` |
| POST | `/api/graphs` | Create Graph | `Orchestrator_App/backend/api/graphs.py:134` |
| GET | `/api/graphs/meta/annotation-exports` | Proxy: list YOLO exports from Annotation_App for a given project. | `Orchestrator_App/backend/api/graphs.py:641` |
| GET | `/api/graphs/meta/app-urls` | Get App Urls | `Orchestrator_App/backend/api/graphs.py:497` |
| GET | `/api/graphs/meta/check-annotation-source` | Proxy : demande à Annotation_App si ce subset a DÉJÀ été importé dans un projet d'annotation (sous un autre nom potentiellement) - avertissement dès la config du nœud Annotation, avant même de lancer le graphe. Même logique que check-dataset-path (best-effort, [] si l'app ne répond pas). | `Orchestrator_App/backend/api/graphs.py:615` |
| GET | `/api/graphs/meta/check-dataset-path` | Proxy : demande à Dataset_Explorer_App si ce chemin correspond DÉJÀ à un dataset connu (sous un autre nom potentiellement) - avertissement de doublon dès la config du nœud Dataset Source, avant même de lancer le graphe. Renvoie [] si l'app n'est pas encore lancée ou ne répond pas - un check indisponible n'est pas une erreur bloquante, juste "rien à signaler pour l'instant". | `Orchestrator_App/backend/api/graphs.py:592` |
| GET | `/api/graphs/meta/download` | Sert un artefact du workspace ; les dossiers sont zippés temporairement. | `Orchestrator_App/backend/api/graphs.py:878` |
| GET | `/api/graphs/meta/explorer-subsets` | Proxy: list subsets from Dataset_Explorer_App. | `Orchestrator_App/backend/api/graphs.py:546` |
| GET | `/api/graphs/meta/inference-config` | config.yaml complet d'Inference_App (défauts + groupes + enums + clés branchées). | `Orchestrator_App/backend/api/graphs.py:521` |
| GET | `/api/graphs/meta/mlflow-summary` | SUPERVISOR : resume live du store MLflow (via MLflow_App). Le noeud mlflow n'est PAS branche : il observe. Renvoie experiments + derniers runs + meilleure metrique. | `Orchestrator_App/backend/api/graphs.py:561` |
| GET | `/api/graphs/meta/workspace-outputs` | Scan workspace dirs for existing subsets (explorer) and YOLO exports (annotation). | `Orchestrator_App/backend/api/graphs.py:659` |
| DELETE | `/api/graphs/{graph_id}` | Delete Graph | `Orchestrator_App/backend/api/graphs.py:159` |
| GET | `/api/graphs/{graph_id}` | Get Graph | `Orchestrator_App/backend/api/graphs.py:139` |
| PUT | `/api/graphs/{graph_id}` | Update Graph | `Orchestrator_App/backend/api/graphs.py:150` |
| GET | `/api/graphs/{graph_id}/artifacts` | Get Graph Artifacts | `Orchestrator_App/backend/api/graphs.py:854` |
| GET | `/api/graphs/{graph_id}/download-graph` | Download Graph | `Orchestrator_App/backend/api/graphs.py:908` |
| POST | `/api/graphs/{graph_id}/duplicate` | Duplicate Graph | `Orchestrator_App/backend/api/graphs.py:165` |
| POST | `/api/graphs/{graph_id}/dvc-commit` | Versionne dans DVC les artefacts SÉLECTIONNÉS (hub observateur, step6) et ENREGISTRE le lineage : trailers git dans le commit (Run-Id/Graph-Id/Dataset/ mAP50/MLflow-Run), persistance cote graphe (run_lineage), et back-fill des tags git_commit/dataset_version sur les runs MLflow du run. | `Orchestrator_App/backend/api/graphs.py:991` |
| POST | `/api/graphs/{graph_id}/fork-run` | Fork d'un run : duplique le graphe (memes noeuds dataset/annotation = meme subset + memes annotations, pret a re-parametrer l'entrainement) et grave la provenance du run source dans g["forked_from"]. NE declenche PAS de dvc pull / re-telechargement : le bloc forked_from ne sert qu'a la tracabilite (quelle version a servi de base). L'utilisateur ajuste ses params puis relance. | `Orchestrator_App/backend/api/graphs.py:210` |
| POST | `/api/graphs/{graph_id}/reset` | Reset Graph | `Orchestrator_App/backend/api/graphs.py:303` |
| POST | `/api/graphs/{graph_id}/resume` | Resume Graph Run | `Orchestrator_App/backend/api/graphs.py:458` |
| POST | `/api/graphs/{graph_id}/run` | Run Graph | `Orchestrator_App/backend/api/graphs.py:335` |
| GET | `/api/graphs/{graph_id}/run/{run_id}/stream` | SSE stream identique à /api/pipelines/{pid}/run/{run_id}/stream. | `Orchestrator_App/backend/api/graphs.py:350` |
| GET | `/api/graphs/{graph_id}/runs/{run_id}/manifest` | Index canonique d'un run, sans aucun fallback vers un autre run. | `Orchestrator_App/backend/api/graphs.py:868` |
| POST | `/api/graphs/{graph_id}/stop` | Arrête un run en cours (ou coincé sur un gate). Garde-fou anti-blocage : fonctionne même si le run n'est plus en mémoire (serveur redémarré) - le graphe est alors juste remis dans un état terminal 'stopped'. | `Orchestrator_App/backend/api/graphs.py:309` |
| POST | `/api/graphs/{graph_id}/track-mlops` | Promeut un graphe "experimental" en "mlops" en injectant la PAIRE couplee MLflow + DVC manquante (nodes FREE, aucune arete). Idempotent : n'ajoute que ce qui manque. Ne lance rien, ne versionne rien - l'utilisateur committe ensuite via le node DVC. Renvoie le graphe mis a jour avec son type derive recalcule. | `Orchestrator_App/backend/api/graphs.py:257` |
| POST | `/api/graphs/{graph_id}/webhook/annotation-exported` | Annotation_App calls this endpoint when the user completes an export. Auto-resumes the graph pipeline if it is waiting at the annotation human gate. | `Orchestrator_App/backend/api/graphs.py:1103` |

### health

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/health` | Health | `Orchestrator_App/backend/api/health.py:12` |

### insights

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/insights` | List Insights | `Orchestrator_App/backend/api/insights.py:23` |
| POST | `/api/insights/{graph_id}/generate` | Generate Insights | `Orchestrator_App/backend/api/insights.py:51` |
| DELETE | `/api/insights/{graph_id}/{run_id}` | Delete Insights | `Orchestrator_App/backend/api/insights.py:45` |
| GET | `/api/insights/{graph_id}/{run_id}` | Get Insights | `Orchestrator_App/backend/api/insights.py:28` |
| GET | `/api/insights/{graph_id}/{run_id}/plot/{name}` | Get Plot | `Orchestrator_App/backend/api/insights.py:36` |

### launcher

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/apps` | Status de toutes les sous-apps (connues + sessions actives). | `Orchestrator_App/backend/api/launcher_api.py:45` |
| POST | `/api/apps/launch` | Launch App | `Orchestrator_App/backend/api/launcher_api.py:117` |
| POST | `/api/apps/launch-all` | Lance toutes les sous-apps qui ne sont pas encore actives. | `Orchestrator_App/backend/api/launcher_api.py:166` |
| POST | `/api/apps/stop-all` | Arrête toutes les sous-apps actives. | `Orchestrator_App/backend/api/launcher_api.py:199` |
| POST | `/api/apps/{app_id}/stop` | Stop App | `Orchestrator_App/backend/api/launcher_api.py:156` |

### lineage

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/lineage` | Nodes + edges du lineage a travers TOUS les graphes. | `Orchestrator_App/backend/api/lineage.py:231` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `Orchestrator_App/backend/main.py:168` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur OS. path optionnel = dossier specifique. | `Orchestrator_App/backend/main.py:145` |
| GET | `/api/workspace/users` | Workspace Users | `Orchestrator_App/backend/main.py:120` |
| GET | `/health` | Root Health | `Orchestrator_App/backend/main.py:115` |

### pipelines

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/pipelines` | List Pipelines | `Orchestrator_App/backend/api/pipelines.py:33` |
| POST | `/api/pipelines` | Create Pipeline | `Orchestrator_App/backend/api/pipelines.py:38` |
| DELETE | `/api/pipelines/{pid}` | Delete Pipeline | `Orchestrator_App/backend/api/pipelines.py:62` |
| GET | `/api/pipelines/{pid}` | Get Pipeline | `Orchestrator_App/backend/api/pipelines.py:46` |
| PUT | `/api/pipelines/{pid}` | Update Pipeline | `Orchestrator_App/backend/api/pipelines.py:54` |
| POST | `/api/pipelines/{pid}/run` | Start Run | `Orchestrator_App/backend/api/pipelines.py:73` |
| GET | `/api/pipelines/{pid}/run/{run_id}/stream` | Stream Run | `Orchestrator_App/backend/api/pipelines.py:84` |
| GET | `/api/pipelines/{pid}/status/{run_id}` | Get Run Status | `Orchestrator_App/backend/api/pipelines.py:103` |

### plans

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/plans` | List Plans | `Orchestrator_App/backend/api/plans.py:28` |
| POST | `/api/plans` | Create Plan | `Orchestrator_App/backend/api/plans.py:33` |
| DELETE | `/api/plans/{plan_id}` | Delete Plan | `Orchestrator_App/backend/api/plans.py:54` |
| GET | `/api/plans/{plan_id}` | Get Plan | `Orchestrator_App/backend/api/plans.py:38` |
| PUT | `/api/plans/{plan_id}` | Update Plan | `Orchestrator_App/backend/api/plans.py:46` |
| POST | `/api/plans/{plan_id}/run` | Run Plan | `Orchestrator_App/backend/api/plans.py:60` |
| GET | `/api/plans/{plan_id}/status` | Plan Status | `Orchestrator_App/backend/api/plans.py:72` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | Get Settings | `Orchestrator_App/backend/api/settings.py:55` |
| PUT | `/api/settings` | Update Settings | `Orchestrator_App/backend/api/settings.py:60` |
<!-- generated:end -->
