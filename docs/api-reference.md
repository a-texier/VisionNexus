---
app: suite
doc_type: api-reference
audience: dev
lang: en
title: API reference
order: 70
tags: [launcher cli, stdout contract, health, ipc, preload, events, backend contract]
sources: [launcher.py, _lib/launcher_engine.py, desktop/src/main.ts, desktop/src/preloadCatalog.ts, desktop/src/preloadDocs.ts, desktop/src/preloadApp.ts, desktop/src/services.ts, desktop/src/sshLauncher.ts]
---

# API reference

## Conventions

This page describes the interfaces of the launcher layer: the `launcher.py` command line, the lines it prints, the HTTP contract an application backend must honor, and the IPC channels of the desktop program. The HTTP endpoints of each application are in that application's own API reference.

IPC channels are named `cv:<action>`. Requests use `ipcRenderer.invoke` and are answered by `ipcMain.handle`; a channel that fails does not throw across IPC but returns `{ok: false, error}` or a `ServiceError`. Payload types below are TypeScript-style. `AppDef` and `ServiceDef` are defined in `desktop/src/catalog.ts`, `LauncherSettings` and `TutorialState` in `settings.ts`, `ServiceStatus`, `ServiceError` and `SearchResult` in `services.ts`, `AppDocEntry` in `preloadDocs.ts`.

## Launcher command line

```bash
python launcher.py --app <key> [<key> ...] --workspace <dir> --user <name> [options]
```

| Argument | Required | Meaning |
|---|---|---|
| `--workspace` | yes | Workspace root; the data folder is `<workspace>/<key>_<user>` (a relative path is resolved against the current folder) |
| `--user` | yes | Session user name |
| `--conda-env` | no | Environment name searched in the usual conda folders, default `IA_env` |
| `--conda-path` | no | Environment folder, `activate` script or Python executable; takes priority over `--conda-env` |
| `--backend-only` | no | Do not start the frontend (always implied for `docs`) |
| `--no-reload` | no | Start `uvicorn` without `--reload` |
| `--backend-port` | no | Fixed backend port, single app only; the launch fails if it is busy |
| `--frontend-port` | no | Fixed frontend port, single app only; the launch fails if it is busy |
| `--native-share-host` | no | Sets `NATIVE_SHARE_HOST` for the backends; empty means HTTP only |

The launcher exits with an error if a port option is combined with several apps. Once started, it checks its processes every two seconds and stops everything if one of them exits. Ctrl+C and SIGTERM stop all apps. The keys `compare`, `3d`, `meshy` and `recon3d` are registered but their application folders are not part of this repository.

## Launcher standard output contract

VisionNexus reads the output of `launcher.py` (stdout and stderr) line by line until it has the ports. Every line is flushed immediately, since a pipe would otherwise buffer it. The contract is these lines, in any order, matched case-insensitively:

| Line | Meaning |
|---|---|
| `[config] backend   = http://localhost:<port>` | Real backend port |
| `[config] frontend  = http://localhost:<port>` | Real frontend port |
| `[config] frontend  = none` | Backend-only service; accepted only when the caller allows it (compute resources) |

The launcher also prints `[config] app_id`, `workspace`, `conda`, `python`, `node` and `layout` (`DEV` or `BUNDLE`), then `[backend] Starting`, `[backend] Ready on :<port>` (or `Still starting, continuing anyway...` after 60 seconds), `[frontend] Starting`, and a final summary with the API documentation URL `http://localhost:<port>/docs`. These lines are informational. Nothing else may change the two `[config]` lines: the desktop program ignores any port it did not read there.

## Backend contract expected from every app

The launcher and the desktop program rely on a small contract; an app that follows it works with both without any change to them.

- **Entry point**: an ASGI module declared in the registry (`backend.main:app` for most apps, `main:app` with a `backend` working directory for a few). It is started with `python -m uvicorn <module> --host 127.0.0.1 --port <BACKEND_PORT>` in the app folder, with `--reload` unless `--no-reload` is given.
- **`GET /health`**: must answer as soon as the server accepts connections. VisionNexus polls it every 0.8 s and treats any HTTP status below 500 as ready. By convention it returns `{"status": "ok"}`.
- **Port and workspace**: read `BACKEND_PORT` and the app's workspace and user variables (see [Configuration](configuration.md#environment-variables-set-by-the-launcher)); never hardcode a port.
- **CORS**: allow the frontend origins `http://localhost:<frontend port>` and `http://127.0.0.1:<frontend port>`; the frontend port comes from the app's frontend port variable.
- **Session token**: call `_install_session_auth()` right after the CORS middleware in `backend/main.py`, which installs `install_session_auth()` from `_lib/session_auth.py`. It adds the routes `GET /api/_auth/bootstrap` (public, one-time code) and `POST /api/_auth/bootstrap-code` (requires the token), keeps `/health` and `/api/health` public, and rejects everything else without the `X-VN-Token` header or the `vn_<BACKEND_PORT>` cookie. A frontend that calls its backend on another port than the page must send credentials (`credentials: 'include'`). See [Security](security.md).
- **Connected users** (optional): `GET /api/workspace/users` returning `[{"user", "workspace"}]` for the entries of `IA_INSTANCES_FILE` whose `app` equals `IA_APP_ID`.
- **In-app documentation** (optional): a docs router under `/api/docs` that lists and serves the pages of the app's documentation set.
- **Native path** (optional): an endpoint returning `{"native_path": <path or null>}` for an image, as described in [Architecture](architecture.md#native-image-protocol).
- **Frontend**: a Vite project whose `dev` script accepts `--port` and `--host`, whose `vite.config.ts` reads `VITE_BACKEND_PORT` and `VITE_FRONTEND_PORT` to proxy `/api` to the backend, and which reads the `?lang=en|fr` query parameter for its starting language.
- **Backend-only services**: no frontend folder, `frontend_dir` set to `None` in the registry, and `frontend = none` in the launcher output.

## Catalog window channels

The catalog window (`ui/catalog.html`) calls these through `window.cvLauncher`. All are `invoke` requests.

### Launching and tabs

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `cv:list-apps` | none | `AppDef[]` | The catalog of apps |
| `cv:launch` | `appId: string` | `{ok, error?}` | Full launch flow; reuses an existing tab |
| `cv:switch-tab` | `appId: string \| null` | void | `null` shows the VisionNexus home; a detached app is focused |
| `cv:close-tab` | `appId` | void | Closes a docked tab and kills its processes |
| `cv:stop-app` | `appId` | void | Stops a tab, a detached window, a launch in progress or a compute resource |
| `cv:detach-tab` | `appId, screenX, screenY` | void | Moves the tab into its own window |
| `cv:dock-tab` | `appId` | void | Brings a detached window back |
| `cv:reorder-tabs` | `order: string[]` | void | Display order of docked tabs |
| `cv:get-tab-url` | `appId` | `string \| null` | `http://127.0.0.1:<frontend port>` |
| `cv:copy-tab-url` | `appId` | `boolean` | Copies that URL to the clipboard |
| `cv:open-tab-in-browser` | `appId` | `boolean` | Opens that URL in the system browser |
| `cv:open-docs` | none | void | Opens the Documentation window |
| `cv:open-logs-folder` | none | string | Opens the log folder; empty string on success |
| `cv:quit` | none | void | Quits after stopping everything |
| `cv:toggle-devtools` | none | void | Developer tools of the focused window |

### Layouts and composition

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `cv:report-content-bounds` | `{x, y, width, height}` | void | Rectangle of `#body`, sent on every resize |
| `cv:set-shell-overlay` | `open: boolean` | void | Hides or restores native views while HTML overlays are open |
| `cv:set-layout-mode` | `'single' \| 'v2' \| 'h2' \| 'grid4'` | void | Switches layout, filling panes with open tabs |
| `cv:begin-dock-compose` | `mode` | `Rect[]` | Hides views and returns the pane rectangles |
| `cv:apply-dock` | `mode, panes: (string \| null)[]` | void | Applies the composed layout |
| `cv:resize-dock` | `axis: 'x' \| 'y', ratio: number` | void | Ratio clamped to 0.2 to 0.8 |
| `cv:cancel-dock` | none | void | Restores the committed layout |
| `cv:toggle-active-sidebar` | none | `boolean` | Hides or shows the sidebar of the active app |
| `cv:set-subapps-flyout` | `open?: boolean` | void | Kept for compatibility: only ensures the active view is visible |

### Ports and processes

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `cv:scan-ports` | none | `{local: PortRow[], remote: {vm, rows} \| null, known: {port, label}[]}` | `PortRow` is `{port, pid, process, user?}` |
| `cv:kill-port` | `target: 'local' \| 'remote', port` | `{ok, failed, error?}` | Kills the listener and its process group, then checks the port |
| `cv:kill-all` | none | `{stopped, ports, failed, error?}` | Stops everything, then kills the known ports |
| `cv:cleanup-vm` | none | `{ok, killed, error?}` | Stops the user's suite servers on the selected VM |

### Settings, native path and tutorial

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `cv:get-settings` | none | `LauncherSettings` | |
| `cv:save-settings` | `LauncherSettings` | void | Merged with the stored file, so `tutorials` is never erased |
| `cv:check-mount` | `host: string` | `{ok, shares: string[], error?}` | Tests TCP 445, lists shares best effort, updates the native path status |
| `cv:get-tutorial` | `key: string` | `TutorialState` | `{launchedOnce, completed}` |
| `cv:set-tutorial` | `key, patch` | `TutorialState` | Partial merge |

### Compute resources and Orchestrator sub-apps

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `cv:list-services` | none | `ServiceDef[]` | |
| `cv:get-service-status` | `id` | `ServiceStatus` | |
| `cv:start-service` | `id` | `{ok, error?}` | Idempotent while starting or ready |
| `cv:stop-service` | `id` | void | |
| `cv:show-subapps-menu` | none | void | Native menu of the sub-apps |
| `cv:open-orchestrator-subapp` | `subAppId` | `{ok, error?}` | Opens as a tab, requires status `running` |
| `cv:open-orchestrator-subapp-browser` | `subAppId` | `{ok, error?}` | Opens in the system browser |
| `cv:launch-orchestrator-subapp` | `subAppId` | `{ok, error?}` | `POST /api/apps/launch` |
| `cv:launch-all-orchestrator-subapps` | none | `{ok, error?}` | `POST /api/apps/launch-all` |

## Documentation window channels

The Documentation window (`ui/docs.html`) calls these through `window.cvDocs`. The service is always `docs`; the renderer never passes an id or a port.

| Channel | Payload | Result | Notes |
|---|---|---|---|
| `cv:list-app-docs` | `lang?: 'fr' \| 'en'` | `AppDocEntry[]` | One entry per documented item, each with `files: AppDocFile[]` |
| `cv:docs-service-status` | none | `ServiceStatus` | |
| `cv:docs-service-start` | none | `{ok, error?}` | |
| `cv:docs-service-stop` | none | void | |
| `cv:docs-search` | `{q, lang?, apps?, audience?, k?, prefer?}` | `{ok: true, result: SearchResult} \| ServiceError` | Validated, then `POST /search` (10 s limit) |
| `cv:docs-index-status` | none | `{ok: true, index: IndexSummary} \| ServiceError` | `GET /index/status` |
| `cv:docs-sync` | none | `{ok: true, started: boolean} \| ServiceError` | `POST /index/sync`; used by the **Refresh index** button of the **Ask the docs** tab |

`SearchRequest` limits are enforced in `validateSearchRequest()`: `q` is 1 to 500 characters, `lang` is `fr`, `en` or `both`, `audience` is `user`, `dev` or `all`, `prefer` is `fr` or `en`, `k` is an integer from 1 to 30 (default 8), and `apps` is at most 20 identifiers matching `^[a-z0-9_-]{1,32}$`. A `ServiceError` is `{ok: false, error, message}` with `error` among `off`, `starting`, `stopping`, `error`, `unreachable`, `timeout`, `http` and `invalid`.

## Native bridge exposed to application tabs

Each application tab receives `window.__CV_NATIVE_MOUNT__` from `preloadApp.ts`, plus the boolean `window.__ANNOTATION_APP_NATIVE__` kept for Annotation. Frontends must treat the absence of the bridge (an application opened in a plain browser) as a fallback, never as an error.

| Member | Result | Notes |
|---|---|---|
| `supported` | `boolean` | This app can attempt the native path |
| `getPathForFile(file)` | `string` | Real OS path of a dropped file or folder |
| `openInNativeFileManager(path, mappings?)` | `{ok, path?, error?}` | `cv:open-native-path`; maps a Linux path to a Windows or share path with `{backendRoot, clientRoot}` pairs |
| `selectDirectory()` | `string \| null` | `cv:select-native-directory`, native folder dialog |
| `getTutorial(key)`, `setTutorial(key, patch)` | `TutorialState` | Same channels as the catalog |

## Events pushed to the renderers

The main process sends these messages; renderers subscribe through `on...` functions of their preload.

| Event | Arguments | Receiver |
|---|---|---|
| `cv:log` | `appId, line` | Catalog; ANSI codes already removed |
| `cv:app-status` | `appId, status, detail` | Catalog; `status` is `launching`, `running`, `error` or `closed` |
| `cv:tabs` | `tabs, activeId, layout` | Catalog; `layout` is `{mode, panes, ratioX, ratioY}` |
| `cv:dock-hint` | `appId \| null` | Catalog; a detached window hovers the tab strip |
| `cv:orchestrator-subapps` | `apps[]` | Catalog; `{app_id, label, launched, status, backend_url, frontend_url}` |
| `cv:service-status` | `ServiceStatus` | Catalog |
| `cv:docs-service-status` | `ServiceStatus` | Every open Documentation window |

## HTTP calls made by the desktop program

The desktop program itself calls a few HTTP endpoints, always on `127.0.0.1` through the local port (a tunnel in VM mode).

| Target | Call | Purpose |
|---|---|---|
| Any frontend | `GET /` every 0.8 s | Readiness, status below 500 |
| Any backend | `GET /health` every 0.8 s | Readiness, status below 500 |
| Orchestrator | `GET /api/apps` every second | List and status of sub-applications |
| Orchestrator | `POST /api/apps/launch`, `/api/apps/launch-all`, `/api/apps/stop-all` | Sub-application control |
| Docs Assistant | `GET /index/status`, `POST /index/sync`, `POST /search` | Index status and search, see the [Docs Assistant API reference](../Docs_Assistant_App/docs/api-reference.md) |
