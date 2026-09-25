---
app: dvc
doc_type: api-reference
audience: dev
lang: fr
title: Reference API
order: 70
tags: [rest api, fastapi, git, dvc, sse, orchestrator]
sources: [DVC_App/backend/main.py, DVC_App/backend/api/datasets.py, DVC_App/backend/api/commits.py, DVC_App/backend/api/sync.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/settings.py, DVC_App/backend/api/docs.py]
---

# Reference API

## Conventions de l'API DVC App

Le backend de DVC App expose une API REST JSON sous `/api`, un flux de logs SSE sur les endpoints push/pull, et une documentation interactive (Swagger) sur `/docs` au port du backend (8002 en mode autonome, voir [Configuration](configuration.fr.md)). A travers le frontend Vite, `/api` est redirige vers ce backend et `/orchestrator-api` vers le propre backend de l'Orchestrator (utilise seulement par la page Lineage).

Regles generales :

- **Les erreurs** utilisent le format de FastAPI `{"detail": "..."}`. Chaque endpoint qui necessite un repository existant retourne 503 "Repo DVC non trouvé à : <chemin>" quand `repo_exists()` est faux ; `POST /api/orchestrator/commit` est la seule exception, puisqu'il cree le repository lui-meme au besoin.
- **Les chemins dans les requetes** (`dataset_path`, `model_path`, ...) sont des chemins serveur, lus par le processus backend ; ils ne sont pas televerses via le corps de la requete.
- **Les commandes longues** (`push`, `pull`) diffusent leur sortie en `text/event-stream` plutot que de bloquer jusqu'a la fin, contrairement a la reponse bloquante unique de la plupart des autres endpoints ici.

Les tableaux d'endpoints de la section *Index des endpoints* sont generes depuis le code ; les sections ci-dessous expliquent chaque domaine.

## Endpoints Datasets et statut

- `GET /api/datasets` liste chaque fichier ou dossier suivi par DVC avec sa taille, son hash et son statut (`unchanged`/`modified`/`missing`), alimentant la page Datasets.
- `GET /api/status` retourne `dvc status --json` analyse en `{changes, repo_path}`, ou `{error, changes: {}}` si le repository est manquant ; contrairement a la plupart des endpoints ici, il ne leve jamais d'erreur HTTP, pour que le frontend puisse montrer une banniere de statut meme quand rien d'autre ne fonctionne encore.
- `GET /api/branch` retourne le nom de la branche Git courante, montre a cote du statut du repository dans la barre laterale.

## Endpoints de commits, diff et checkout

- `GET /api/commits?n=` retourne jusqu'a `n` (defaut 50, max 200) commits Git qui ont touche un fichier `.dvc`, chacun avec ses trailers de lineage analyses, alimentant la page Historique.
- `GET /api/diff?rev_a=&rev_b=` retourne `dvc diff --json` entre deux revisions (`added`, `deleted`, `modified`, `renamed`), ou `{error}`.
- `POST /api/checkout` execute `git checkout <rev>` puis `dvc checkout`, ramenant le dossier de travail exactement a l'etat de ce commit ; utilise par le bouton **Restaurer** de la page Historique.
- Aucun de ces trois endpoints n'ecrit dans le repository sauf `checkout`, le seul endroit hors de `POST /api/orchestrator/commit` qui change le contenu du dossier de travail.

## Endpoints Sync : remotes, usage disque, push et pull

- `GET /api/remotes` liste les remotes configures, analyses directement depuis `.dvc/config`/`.dvc/config.local` ; une liste vide signifie que push et pull n'ont aucune destination. `POST /api/remotes` en ajoute un (`name`, `url`, `default`), creant automatiquement une destination de dossier local si `url` n'est pas un schema d'URL de remote reconnu.
- `GET /api/disk-usage` calcule les tailles reelles en octets du cache et du dossier de travail a la demande (peut etre lent sur de gros repositories) ; `POST /api/relink` re-materialise le dossier de travail en liens vers le cache pour le contenu ajoute avant que la liaison soit configuree.
- `POST /api/push` et `POST /api/pull` diffusent la sortie de `dvc push`/`dvc pull` en SSE (evenements `start`, `log`, `done`/`error`) ; les deux verifient en amont l'existence d'au moins un remote configure et emettent un evenement `error` clair plutot que de demarrer le subprocess si aucun n'existe.

## Endpoints d'integration Orchestrator

- `POST /api/orchestrator/commit` initialise le repository (Git et, si un artefact est donne, DVC) au besoin, copie les artefacts demandes (`dataset_path`, `model_path`, `annotations_path`, `metrics_path`, en auto-extrayant une source `.zip`) dans le repository et les `dvc add`-e, ecrit `graph_json`/`params_json` directement comme fichiers JSON bruts, et commit le tout avec `message` (censee deja contenir tout trailer de lineage). Retourne `{"ok": true, "skipped": true, ...}` sans erreur si rien n'a change.
- `GET /api/orchestrator/status` retourne `{repo_exists, repo_path, git_initialized, dvc_initialized, remotes}`, utilise par le propre hub du noeud DVC de l'Orchestrator pour montrer l'etat du repository sans dupliquer la logique de cette app.

## Endpoints de parametres et de documentation

- `GET`/`PUT /api/settings` : le fichier de parametres propre a l'app, incluant `dvc_repo_path` a titre d'affichage seulement (le changer ici ne change pas le `DVC_REPO_PATH` reel du backend, fixe au demarrage du processus depuis l'environnement).
- `GET /api/docs`, `GET /api/docs/{name}` et `GET /api/docs/assets/{path}` : ce jeu de documentation, servi a la page Doc du frontend.
- Aucun des deux groupes d'endpoints ne touche le repository Git ou DVC ; les deux peuvent etre utilises meme quand `repo_exists()` est faux. Changer des parametres du meme genre que `mlflow_tracking_uri` dans d'autres apps a la meme limitation d'affichage seulement ; seul l'environnement controle a quoi le backend se connecte reellement.

## Endpoints de sante et de workspace

- `GET /health` retourne `{"status": "ok", "repo_exists": bool, "repo_path": "..."}`. VisionNexus le sonde avant d'ouvrir l'onglet de l'app.
- `GET /api/workspace/users`, `POST /api/workspace/open`, `GET /api/workspace/history` : auxiliaires de workspace partages utilises par le badge utilisateur, identiques en source aux autres apps de la suite ; aucun ne necessite qu'un repository existe.
- Ces trois endpoints fonctionnent meme avant le premier commit, puisqu'ils lisent le registre d'instances partage plutot que le repository lui-meme.

## Index des endpoints

<!-- generated:start -->
### commits

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/checkout` | `dvc_checkout()` | `DVC_App/backend/api/commits.py:52` |
| GET | `/api/commits` | `list_commits()` | `DVC_App/backend/api/commits.py:28` |
| GET | `/api/diff` | `dvc_diff()` | `DVC_App/backend/api/commits.py:38` |

### datasets

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/branch` | `current_branch()` | `DVC_App/backend/api/datasets.py:50` |
| GET | `/api/datasets` | `list_datasets()` | `DVC_App/backend/api/datasets.py:31` |
| GET | `/api/status` | `dvc_status()` | `DVC_App/backend/api/datasets.py:41` |

### docs

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/docs` | Pages du jeu de docs, triees par `order`, avec les langues disponibles. | `DVC_App/backend/api/docs.py:141` |
| GET | `/api/docs/assets/{asset_path:path}` | `get_doc_asset()` | `DVC_App/backend/api/docs.py:163` |
| GET | `/api/docs/{name}` | Une page : frontmatter + corps markdown, avec repli de langue. | `DVC_App/backend/api/docs.py:173` |

### main

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/workspace/history` | Retourne l'historique des workspaces (seulement les dossiers encore existants). Chaque entree: {"path": str, "user": str}. | `DVC_App/backend/main.py:129` |
| POST | `/api/workspace/open` | Ouvre un dossier dans l'explorateur OS. path optionnel = dossier specifique. | `DVC_App/backend/main.py:106` |
| GET | `/api/workspace/users` | `workspace_users()` | `DVC_App/backend/main.py:81` |
| GET | `/health` | `health()` | `DVC_App/backend/main.py:72` |

### orchestrator

| Method | Path | Summary | Source |
|---|---|---|---|
| POST | `/api/orchestrator/commit` | `commit_data()` | `DVC_App/backend/api/orchestrator.py:73` |
| GET | `/api/orchestrator/status` | `get_status()` | `DVC_App/backend/api/orchestrator.py:273` |

### settings

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/settings` | `get_settings()` | `DVC_App/backend/api/settings.py:67` |
| PUT | `/api/settings` | `update_settings()` | `DVC_App/backend/api/settings.py:72` |

### sync

| Method | Path | Summary | Source |
|---|---|---|---|
| GET | `/api/disk-usage` | Usage disque reel : cache vs working dir + type de cache (copy vs liens). Calcul a la demande (peut etre lent sur gros datasets). | `DVC_App/backend/api/sync.py:65` |
| POST | `/api/pull` | `dvc_pull()` | `DVC_App/backend/api/sync.py:127` |
| POST | `/api/push` | `dvc_push()` | `DVC_App/backend/api/sync.py:117` |
| POST | `/api/relink` | Re-materialise le working dir en liens vers le cache (de-duplique retroactivement l'existant apres activation des liens). | `DVC_App/backend/api/sync.py:72` |
| GET | `/api/remotes` | Remotes DVC configures. Liste vide = aucune destination push/pull possible. | `DVC_App/backend/api/sync.py:45` |
| POST | `/api/remotes` | Ajoute un remote DVC depuis l'UI (0 CLI). Un chemin de dossier = remote local (le dossier est cree au besoin). | `DVC_App/backend/api/sync.py:58` |
<!-- generated:end -->
