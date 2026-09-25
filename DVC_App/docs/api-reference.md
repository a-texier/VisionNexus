---
app: dvc
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [rest api, fastapi, git, dvc, sse, orchestrator]
sources: [DVC_App/backend/main.py, DVC_App/backend/api/datasets.py, DVC_App/backend/api/commits.py, DVC_App/backend/api/sync.py, DVC_App/backend/api/orchestrator.py, DVC_App/backend/api/settings.py, DVC_App/backend/api/docs.py]
---

# API reference

## Conventions of the DVC App API

The DVC App backend exposes a JSON REST API under `/api`, an SSE log stream on the push/pull endpoints, and interactive documentation (Swagger) at `/docs` on the backend port (8002 in standalone mode, see [Configuration](configuration.md)). Through the Vite frontend, `/api` is proxied to this backend and `/orchestrator-api` is proxied to the Orchestrator's own backend (used only by the Lineage page).

General rules:

- **Errors** use FastAPI's format `{"detail": "..."}`. Every endpoint that requires an existing repository returns 503 "Repo DVC non trouvé à : <path>" when `repo_exists()` is false; `POST /api/orchestrator/commit` is the one exception, since it creates the repository itself if needed.
- **Paths in requests** (`dataset_path`, `model_path`, ...) are server paths, read by the backend process; they are not uploaded through the request body.
- **Long-running commands** (`push`, `pull`) stream their output over `text/event-stream` rather than blocking until completion, unlike the single blocking response of most other endpoints here.

The endpoint tables of the section *Endpoint index* are generated from the code; the sections below explain each domain.

## Datasets and status endpoints

- `GET /api/datasets` lists every file or folder tracked by DVC with its size, hash and status (`unchanged`/`modified`/`missing`), backing the Datasets page.
- `GET /api/status` returns `dvc status --json` parsed into `{changes, repo_path}`, or `{error, changes: {}}` if the repository is missing; unlike most endpoints here, it never raises an HTTP error, so the frontend can show a status banner even when nothing else works yet.
- `GET /api/branch` returns the current Git branch name, shown next to the repository status in the sidebar.

## Commits, diff and checkout endpoints

- `GET /api/commits?n=` returns up to `n` (default 50, max 200) Git commits that touched a `.dvc` file, each with its parsed lineage trailers, backing the History page.
- `GET /api/diff?rev_a=&rev_b=` returns `dvc diff --json` between two revisions (`added`, `deleted`, `modified`, `renamed`), or `{error}`.
- `POST /api/checkout` runs `git checkout <rev>` then `dvc checkout`, bringing the working directory to exactly that commit's state; used by the History page's **Restaurer** button.
- None of these three endpoints write to the repository except `checkout`, which is the only place outside `POST /api/orchestrator/commit` that changes the working directory's content.

## Sync endpoints: remotes, disk usage, push and pull

- `GET /api/remotes` lists configured remotes, parsed directly from `.dvc/config`/`.dvc/config.local`; an empty list means push and pull have no destination. `POST /api/remotes` adds one (`name`, `url`, `default`), creating a local folder destination automatically if `url` is not a recognized remote URL scheme.
- `GET /api/disk-usage` computes real cache and working-directory byte sizes on demand (can be slow on large repositories); `POST /api/relink` re-materializes the working directory as links to the cache for content added before linking was configured.
- `POST /api/push` and `POST /api/pull` stream `dvc push`/`dvc pull` output as SSE (`start`, `log`, `done`/`error` events); both pre-flight-check for at least one configured remote and emit a clear `error` event instead of starting the subprocess when none exists.

## Orchestrator integration endpoints

- `POST /api/orchestrator/commit` initializes the repository (Git and, if any artifact is given, DVC) if needed, copies the requested artifacts (`dataset_path`, `model_path`, `annotations_path`, `metrics_path`, auto-extracting a `.zip` source) into the repository and `dvc add`s them, writes `graph_json`/`params_json` directly as plain JSON files, and commits everything with `message` (expected to already contain any lineage trailers). Returns `{"ok": true, "skipped": true, ...}` without error if nothing changed.
- `GET /api/orchestrator/status` returns `{repo_exists, repo_path, git_initialized, dvc_initialized, remotes}`, used by the Orchestrator's own DVC node hub to show repository state without duplicating this app's logic.

## Settings and documentation endpoints

- `GET`/`PUT /api/settings`: the app's own settings file, including `dvc_repo_path` for display purposes only (changing it here does not change the backend's actual `DVC_REPO_PATH`, fixed at process start from the environment).
- `GET /api/docs`, `GET /api/docs/{name}` and `GET /api/docs/assets/{path}`: this documentation set, served to the frontend's Doc page.
- Neither group of endpoints touches the Git or DVC repository at all; both can be used even when `repo_exists()` is false. Changing `mlflow_tracking_uri`-style settings in other apps has the same display-only limitation; only the environment controls what the backend actually connects to.

## Health and workspace endpoints

- `GET /health` returns `{"status": "ok", "repo_exists": bool, "repo_path": "..."}`. VisionNexus polls it before opening the app's tab.
- `GET /api/workspace/users`, `POST /api/workspace/open`, `GET /api/workspace/history`: shared workspace helpers used by the user badge, identical in source to the other apps of the suite; none of them require a repository to exist.
- These three endpoints work even before the first commit is made, since they read the shared instance registry rather than the repository itself.

## Endpoint index

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
