---
app: dvc
doc_type: code-map
audience: dev
lang: fr
title: Carte du code
order: 80
tags: [navigation code, backend, frontend, lineage, extension]
sources: [DVC_App/backend/main.py, DVC_App/backend/core/dvc_runner.py, DVC_App/frontend/src/App.tsx, DVC_App/frontend/src/pages/LineagePage.tsx, DVC_App/frontend/src/i18n/translate.ts]
---

# Carte du code

## Par ou commencer a lire le code backend

Le backend de DVC App est dans `DVC_App/backend/`. Lisez ces fichiers dans cet ordre pour le comprendre :

1. `main.py` : le point d'entree. Le lifespan journalise si le repository existe au demarrage ; les routeurs sont montes ici ; `/health` et les auxiliaires de workspace sont definis ici.
2. `config.py` : le workspace, `DVC_REPO_PATH`, les ports et les origines CORS.
3. `core/dvc_runner.py` : chaque appel subprocess `git`/`dvc` passe par `_run()` ici ; lisez ce fichier pour comprendre ce que l'app peut vraiment faire a un repository.
4. `api/orchestrator.py` : `commit_data()`, la seule fonction qui cree des commits, y compris la logique de copie d'artefacts et de message de trailer.
5. `api/datasets.py`, `api/commits.py`, `api/sync.py` : les routeurs majoritairement en lecture pour les pages Datasets, Historique/Diff et Sync, chacun une fine couche au-dessus de `dvc_runner.py`.

Hors de `backend/`, `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()` est le code qui construit reellement le `message` avec trailers de lineage que l'endpoint de commit de cette app recoit ; lisez-le en parallele de `api/orchestrator.py` pour comprendre le flux de commit complet de bout en bout.

## Par ou commencer a lire le code frontend

Le frontend est une app Vite/React dans `DVC_App/frontend/src/`. Commencez par `App.tsx` pour la liste des routes, le statut de repository de la barre laterale, et les deux routes orphelines (`/datasets`, `/history`) qui existent sans lien dans la barre laterale, puis `pages/LineagePage.tsx` (la page d'accueil, enveloppee dans sa propre error boundary, combinant le propre historique de commits de cette app avec le graphe canonique de l'Orchestrator), et `pages/DiffPage.tsx`/`pages/SyncPage.tsx` pour les deux pages restantes de la barre laterale. `api/client.ts` est l'unique endroit qui appelle le propre backend de cette app ; `types/api.ts` reflete ses formes de reponse Pydantic, y compris `CommitLineage` pour les champs de trailer analyses.

## Ou changer le format des trailers de lineage

Les cles de trailer ecrites dans un message de commit (`Run-Id`, `Graph-Id`, `Graph-Name`, `Parent-Run`, `Dataset`, `mAP50`, `MLflow-Run`) sont assemblees dans `Orchestrator_App/backend/api/graphs.py::dvc_commit_selected()`, pas dans cette app. L'analyseur qui les relit est `DVC_App/backend/core/dvc_runner.py::_parse_trailers()` ; les deux cotes doivent s'accorder sur l'orthographe exacte des cles (insensible a la casse, mais les caracteres separateurs `_RS`/`_US`/`_GS` utilises par le format `git log` personnalise de `get_git_log()` sont fixes et ne doivent pas entrer en collision avec des caracteres pouvant apparaitre dans une valeur de trailer). Ajoutez un nouveau trailer en l'ajoutant des deux cotes et au type TypeScript `CommitLineage`.

## Ou changer ce qui est versionne depuis l'Orchestrator

La liste `_copies` de `backend/api/orchestrator.py::commit_data()` (construite depuis `body.dataset_path`, `body.model_path`, `body.annotations_path`, `body.metrics_path`) est l'endroit ou un nouveau type d'artefact serait ajoute, chaque entree une paire `(nom_sous_dossier, chemin_source)` copiee dans le repository puis `dvc add`-ee. `graph_json` et `params_json` sont geres separement puisqu'ils sont ecrits comme JSON brut plutot que via `dvc add` ; suivez ce meme motif JSON brut pour un nouveau type d'artefact qui devrait rester diffable par un humain dans Git plutot que suivi comme contenu binaire. Mettez a jour le format de trailer en parallele d'un nouveau type s'il doit aussi etre tracable jusqu'a un run sur les pages Lineage et Diff.

## Ou changer la disposition du graphe Lineage

Tout est dans `frontend/src/pages/LineagePage.tsx::build()` : il transforme le payload `{nodes, edges}` de l'Orchestrator plus la propre liste de commits de cette app en tableaux `nodes`/`edges` ReactFlow, associant les commits aux runs via `commitByRun` (indexe par le trailer `lineage.run_id` de chaque commit). Ajoutez un nouveau type de noeud en etendant l'union `Kind` et l'enregistrement `META` (titre, classe CSS, couleur de la minimap) en haut du fichier, puis un cas dans `build()` qui pousse un noeud positionne pour lui. La vue en liste rendue quand le bascule graphe/liste est desactive lit la meme structure de donnees `flow.runs`, donc un nouveau type de noeud a generalement besoin d'un petit ajout la aussi.

## Ou changer le comportement du cache

`configure_cache_links()`, `relink_cache()` et `get_disk_usage()` dans `backend/core/dvc_runner.py` sont les trois fonctions qui touchent la configuration et la mesure du cache de DVC. Changer la valeur `cache.type` passee a `dvc config` change quelle strategie de lien DVC prefere (`reflink,hardlink,copy` essaie chacun dans l'ordre) ; gardez `cache.protected true` avec tout changement, puisque c'est ce qui empeche les entrees de cache a inode partage d'etre modifiees via l'un de leurs liens. Les deux fonctions sont idempotentes et sures a appeler sur un repository qui a deja des liens configures, c'est pourquoi `configure_cache_links()` tourne inconditionnellement a chaque commit plutot que seulement une fois a la creation du repository.

## Ou changer l'aide et les traductions

Les pages de cette documentation vivent dans `DVC_App/docs/`, servies par `backend/api/docs.py` et rendues par `frontend/src/components/docs/MarkdownDoc.tsx` sur `frontend/src/pages/DocPage.tsx` (distinct du contenu explicatif propre a la suite aussi nomme `DocPage.tsx` avant l'existence de ce jeu de documentation ; la route `/doc` sert desormais ce markdown rendu a la place). Les chaines francaises sont la source de verite dans le code ; ajoutez leur traduction anglaise au dictionnaire `EXACT_EN` de `frontend/src/i18n/translate.ts` (correspondance exacte) ou a `PHRASE_EN` (sous-chaine, pour les chaines construites dynamiquement). Le contenu explicatif d'origine reste dans le git history si besoin de le retrouver.

## Outils de debogage

- `GET /health` et `GET /api/orchestrator/status` sont les deux verifications les plus rapides de l'etat du repository sans ouvrir de terminal sur la machine backend.
- `.dvc/config` et `.dvc/config.local`, lus directement par `get_remotes()`, peuvent aussi etre inspectes a la main pour debugger un remote qui n'apparait pas dans la page Sync.
- La commande `git log --format=... --name-only` construite par `get_git_log()` peut etre executee directement dans le repository pour debugger un probleme d'analyse de trailer independamment du code Python de cette app.
- `GET /api/disk-usage` est une bonne verification pour savoir si la liaison du cache est active avant de supposer qu'un gros dossier de travail utilise vraiment tout cet espace disque.

## Carte des modules

<!-- generated:start -->
### backend

| File | Description | Exports |
|---|---|---|
| `config.py` |  |  |
| `main.py` |  | `lifespan`, `health`, `workspace_users`, `workspace_open`, `workspace_history` |

### backend/api

| File | Description | Exports |
|---|---|---|
| `commits.py` |  | `list_commits`, `dvc_diff`, `CheckoutBody`, `dvc_checkout` |
| `datasets.py` |  | `list_datasets`, `dvc_status`, `current_branch` |
| `docs.py` |  | `parse_frontmatter`, `load_doc_set`, `doc_path`, `read_doc`, `safe_asset_path`, `list_docs`, `get_doc_asset`, `get_doc` |
| `orchestrator.py` |  | `CommitRequest`, `commit_data`, `get_status` |
| `settings.py` |  | `AppSettings`, `load_settings`, `get_settings`, `update_settings` |
| `sync.py` |  | `list_remotes`, `AddRemoteBody`, `create_remote`, `disk_usage`, `relink`, `dvc_push`, `dvc_pull` |

### backend/core

| File | Description | Exports |
|---|---|---|
| `dvc_runner.py` |  | `repo_exists`, `get_status`, `get_git_log`, `configure_cache_links`, `relink_cache`, `add_remote`, `get_disk_usage`, `get_remotes`, `get_diff`, `checkout`, `list_tracked_files`, `get_current_branch` |

### frontend/src

| File | Description | Exports |
|---|---|---|
| `App.tsx` | App.tsx - Routing + sidebar avec indicateur repo + branche | `App` |
| `main.tsx` |  |  |

### frontend/src/api

| File | Description | Exports |
|---|---|---|
| `client.ts` | api/client.ts - axios + SSE helper | `BACKEND_BASE`, `datasetsAPI`, `repoAPI`, `commitsAPI`, `settingsAPI`, `startSync`, `docsAPI` |

### frontend/src/components

| File | Description | Exports |
|---|---|---|
| `UserBadge.tsx` |  | `UserBadge` |

### frontend/src/components/common

| File | Description | Exports |
|---|---|---|
| `LanguageToggle.tsx` |  | `LanguageToggle` |

### frontend/src/components/docs

| File | Description | Exports |
|---|---|---|
| `markdown.ts` | Rendu markdown -> HTML des pages de docs/ et liens vers la page | `DOCS_ROUTE`, `docLink`, `renderMarkdown` |
| `MarkdownDoc.tsx` | Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres | `MarkdownDoc` |

### frontend/src/hooks

| File | Description | Exports |
|---|---|---|
| `useCommits.ts` |  | `useCommits`, `useInvalidateCommits` |
| `useDatasets.ts` |  | `useDatasets`, `useDVCStatus`, `useBranch`, `useInvalidateDatasets` |

### frontend/src/i18n

| File | Description | Exports |
|---|---|---|
| `translate.ts` | Traduction FR -> EN a l'affichage. Le francais reste la source de | `getLang`, `setLang`, `subscribeLang`, `isDesktopPiloted`, `initWorkspaceLanguage`, `setLangAndMaybePersist`, `t` |
| `useLang.ts` |  | `useLang`, `useT` |

### frontend/src/pages

| File | Description | Exports |
|---|---|---|
| `DatasetsPage.tsx` | Fichiers DVC trackés avec taille, statut badge. | `DatasetsPage` |
| `DiffPage.tsx` | Sélection de 2 versions, diff DVC affiché. | `DiffPage` |
| `DocPage.tsx` | Page Doc : rend les pages markdown de DVC_App/docs/ servies | `DocPage` |
| `HistoryPage.tsx` | Historique git-style des commits touchant des fichiers DVC. | `HistoryPage` |
| `LineagePage.tsx` |  | `LineagePage` |
| `SyncPage.tsx` | Push/pull DVC avec log SSE en temps réel. | `SyncPage` |

### frontend/src/types

| File | Description | Exports |
|---|---|---|
| `api.ts` | types/api.ts - miroir exact des schémas Pydantic backend |  |
<!-- generated:end -->
