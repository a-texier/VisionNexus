---
app: suite
doc_type: code-map
audience: dev
lang: en
title: Code map
order: 80
tags: [code navigation, desktop, launcher, registry, add an app, checklist]
sources: [desktop/src, desktop/ui, desktop/scripts, launcher.py, _lib/launcher_engine.py, _lib/plugin_registry.py, rebuild_all.py, docs/docs_manifest.json]
---

# Code map

## Where to start reading the desktop code

Read these files in this order to understand the launcher:

1. `desktop/src/catalog.ts`: the `APPS` and `SERVICES` lists, the two data structures everything else iterates over.
2. `desktop/src/settings.ts`: the settings file, its defaults and `isValid()`.
3. `desktop/src/sshLauncher.ts`: how a launch command is built, how ports are read, how a tunnel is opened and watched.
4. `desktop/src/main.ts`: the main process. Read it by feature, in this order: process killing and logs at the top, ports and native path, tabs and layouts, sub-apps of the Orchestrator, services, then the IPC handlers, `cv:launch` and the start-up and quit hooks at the end.
5. `desktop/ui/catalog.html`: the launcher home, a single page of HTML, CSS and script with no build step.
6. `desktop/src/services.ts` and `desktop/src/docFiles.ts`: the pure logic of compute resources and of documentation pages, both unit tested.

## Where to change the launch flow, ports or tunnels

The launch sequence is the `cv:launch` handler in `main.ts`; the command line it spawns and the port and readiness helpers are in `sshLauncher.ts` (`launchApp`, `waitForPorts`, `openTunnel`, `watchTunnel`, `waitUntilReady`, `waitUntilBackendReady`, `findBusyLocalPorts`). Tunnel message rules are in `tunnelClassify.ts`, with tests in `tunnelClassify.test.ts`: add a test line for every new ssh message you classify. Time limits are literals at the call sites in `cv:launch` (60 s, 60 s, 120 s) and constants for services (`SERVICE_START_TIMEOUT_MS`). To change what the launcher prints or how ports are chosen, edit the Python engine instead (see below).

## Where to change the catalog, tiles or settings

A tile comes from an entry of `APPS` in `catalog.ts` (id, label, icon, ports, position `x` and `y`, colour, `supportsNativeMount`, `standalone`), built by `buildTiles()` in `catalog.html`. The arrows between tiles and the frame around them are drawn by hand in the SVG at the top of the page body, and the frame text is the `suiteFrameLabel` key of `ui/i18n.js`. Settings fields are the `#right` panel of `catalog.html`, saved by the `saveBtn` handler; add a new setting in `LauncherSettings` and `DEFAULTS` (`settings.ts`), in the panel, in the launch command if it must reach the launcher, and in `isValid()` if it is required. Every visible string goes through `ui/i18n.js` (`CV_I18N`, keys with `fr` and `en` values).

## Where to change tabs, layouts or detached windows

Tabs, panes and detached windows are in `main.ts`: `createAppTab`, `closeTab`, `detachTab`, `dockTab`, `applyLayout`, `slotBoundsFor`, `setLayoutMode` and the `cv:*dock*` handlers. Their renderer side is in `catalog.html`: `renderTabStrip`, the composition functions (`enterCompose`, `renderComposeSquares`), `renderSplitHandles` and `slotRects`, which mirrors `slotBoundsFor` and must stay identical to it. Keyboard shortcuts installed in each app view (Ctrl+B, reload on stale Vite dependencies, reload after a failed load) are in `installAppViewShortcuts()`. Popup and link handling is `denyPopupsOpenExternal()` and `openLocalUrlInVisionNexus()`.

## Where to change compute resources

The list of resources is `SERVICES` in `catalog.ts`. Their state machine and message builders are in `services.ts` with tests in `services.test.ts`; the process handling (`startService`, `stopService`, `failService`, `pollServiceIndex`) is in `main.ts`. The card is `buildServiceCard()` and `updateServiceCard()` in `catalog.html`, the description text is the i18n key named by `descKey`. The bridge used by the Documentation window is `docsSearch`, `docsIndexStatus` and `docsSync` in `main.ts`, exposed by `preloadDocs.ts`.

## Where to change the Documentation window

The window is `ui/docs.html`: tabs, application list, page tabs and the `openDoc()` entry point used by links and search results. Markdown rendering and heading anchors are in `ui/doc-render.js` (with the vendored `ui/vendor/marked.min.js`, refreshed by `npm run vendor-marked`), the **Ask the docs** tab is `ui/ask.js` with its pure helpers in `ui/ask-render.js`. The list of entries and the reading of pages are `cv:list-app-docs`, `readAppDocs`, `readBundledDocs` in `main.ts` and `docFiles.ts`. The build-time copy is `scripts/copy-docs.js`. Changing how headings are numbered means changing `docs_lib.py`, `doc-render.js` and the Docs Assistant chunker together, then the fixture in `tools/docs/fixtures/`.

## Where to change the launcher engine and the registry

Everything about a target machine is in `_lib/launcher_engine.py`: `APP_REGISTRY` (one entry per key), `_WS_SUBDIRS`, port allocation (`find_free_port`, `_acquire_port_lock`), the instance registry (`register_instance`, `load_instances`), Python resolution (`find_python`, `find_python_from_conda_path`), process handling (`_kill_tree`, `_popen_kwargs`) and `launch_app()`, which sequences them. The command-line front end is `launcher.py`. Plugin discovery is `_lib/plugin_registry.py`, with tests in `_lib/tests/`. The Orchestrator builds its own launcher table from `APP_REGISTRY`, so a registry change reaches it without further edit.

## Where to change the tutorial

The tour of the launcher is `ui/tour.js`: a small engine (`CvTour`: spotlight, bubble, keyboard) and the step list `NEXUS_STEPS` (French, each step naming a CSS selector to highlight) with its English texts `EN_STEPS`, keyed by step id. Steps target elements by id or `data-` attribute, so renaming one in `catalog.html` breaks its step. Progress is stored through `cv:get-tutorial` and `cv:set-tutorial` under the key `nexus`. Applications have their own tours; their engine is a separate portable copy in their frontends, and it reads the same state through `__CV_NATIVE_MOUNT__`.

## Module map

The tables list every source file with its role. This page is maintained by hand; update it when a file is added, moved or removed.

### desktop/src

| File | Role |
|---|---|
| `main.ts` | Main process: windows, tabs, layouts, launch, ports, services, Orchestrator sub-apps, documentation list, IPC, shutdown |
| `catalog.ts` | `APPS` and `SERVICES` definitions |
| `settings.ts` | Settings file, tutorials state, `isValid()` |
| `sshLauncher.ts` | Launch command, port reading, tunnel, readiness probes |
| `tunnelClassify.ts` | Verdict for one line of ssh tunnel stderr |
| `services.ts` | Compute resource state machine, IPC validation, response mapping, HTTP forwarding |
| `imageProtocol.ts` | The `app-image://` protocol, cache and HTTP fallback |
| `workspacePaths.ts` | Linux to Windows or share path mapping for "open in file manager" |
| `docFiles.ts` | Manifest loading, frontmatter, page choice by language, sorting |
| `preloadCatalog.ts`, `preloadDocs.ts`, `preloadApp.ts` | The three `contextBridge` surfaces |
| `*.test.ts` | Unit tests run by `npm test` (`node --test`) |

### desktop/ui, scripts and assets

| File | Role |
|---|---|
| `ui/catalog.html` | Launcher home, tab strip, ports panel, settings, compute resources |
| `ui/docs.html` | Documentation window |
| `ui/i18n.js` | French and English dictionary of the shell |
| `ui/tour.js` | Interactive tutorial engine and script |
| `ui/ask.js`, `ui/ask-render.js` | **Ask the docs** tab and its highlighting helpers |
| `ui/doc-render.js`, `ui/vendor/marked.min.js` | Markdown rendering with `h-<n>` anchors |
| `scripts/copy-docs.js` | Copies manifest and pages into `docs-bundle/` before packaging |
| `scripts/check-heading-ids.js` | Checks the viewer against the shared heading fixture |
| `assets/` | Icons `icon_<app>.png`, `logo.png`, `app.ico` |

### Launcher and tools

| File | Role |
|---|---|
| `launcher.py` | Command-line front end of the launcher |
| `_lib/launcher_engine.py` | Registry, ports, workspaces, processes, `launch_app()` |
| `_lib/plugin_registry.py` | Discovery and loading of plugins in `plugins/` |
| `rebuild_all.py` | Installs and builds every frontend and the desktop app |
| `docs/docs_manifest.json` | Documented sources and the nine-page set |
| `tools/docs/` | Documentation lint (`lint_docs.py`), generators (`gen_api_docs.py`, `gen_code_map.py`) and authoring rules (`DOC_STYLE.md`) |

## Add a new app to the suite

Adding an app touches four places: the app itself, the launcher registry, the desktop catalog and the documentation. The Orchestrator wiring is optional and separate. Use an existing small app as the reference: `Optuna_App` or `DVC_App` show every file mentioned below. The steps are ordered so the app is launchable after step 3.

### Prepare the app

Create `<Name>_App/` at the repository root with a `backend/` (FastAPI, module `backend.main:app`) and a `frontend/` (Vite and React). Follow the [backend contract](api-reference.md#backend-contract-expected-from-every-app):

- `backend/config.py` reads `BACKEND_PORT`, the workspace and user variables you will name in the registry, and builds its CORS origins from the frontend port variable.
- `backend/main.py` exposes `GET /health` and includes its routers; optional routers are `/api/workspace/users` and `/api/docs`.
- `frontend/vite.config.ts` reads `VITE_BACKEND_PORT` and `VITE_FRONTEND_PORT`, proxies `/api`, and sets `host` and `allowedHosts` so the tunnel works.
- Store data only under the workspace folder, never in the app folder.
- Read `?lang=` for the starting language.
- Add a `launcher.py` only if you want standalone use; VisionNexus does not need it.

### Register the app in the launcher

In `_lib/launcher_engine.py`, add an entry to `APP_REGISTRY` under a short unique key (this key is the workspace prefix, the `--app` value and the tile id):

```python
"myapp": {
    "label": "MyApp_App",
    "app_root": _CV / "MyApp_App",
    "backend_module": "backend.main:app",
    "backend_cwd": None,
    "frontend_dir": "frontend",
    "base_backend_port": 8069,
    "base_frontend_port": 5181,
    "default_workspace": str(_WS_DEFAULT / "default_myapp"),
    "workspace_env": "MYAPP_WORKSPACE",
    "user_env": "MYAPP_USER",
    "frontend_port_env": "MYAPP_FRONTEND_PORT",
    "extra_env": {},
},
```

Choose base ports not used in the [ports table](configuration.md#base-ports-of-every-application), add the key to `_WS_SUBDIRS` (with the subfolders the launcher should create, or an empty list), and add the frontend folder to `FRONTENDS` in `rebuild_all.py`. For a backend-only service, set `frontend_dir` and `base_frontend_port` to `None`. Test it with `python launcher.py --app myapp --workspace <dir> --user <name>`: the `[config]` lines must show both ports and `/health` must answer.

### Add the app to the catalog

In `desktop/src/catalog.ts`, add an `AppDef` to `APPS` with the same key as `id`, the same ports as the registry, a `label`, an `icon` (a 256 px PNG named `icon_myapp.png` in `desktop/assets/`), a position `x` and `y` and a colour. Set `supportsNativeMount: true` only if the app implements the native path. In `ui/catalog.html`, draw the arrows for the new position in the diagram SVG, and update `suiteFrameLabel` in `ui/i18n.js` if the number of suite apps in the frame changes. Rebuild and check the tile with `npm run build` and `npm start`. The Documentation window and the **Ask the docs** filters take the new entry from `APPS` automatically.

### Document the app

Create `MyApp_App/docs/` with the nine pages in English and French, following the authoring rules of `tools/docs/DOC_STYLE.md`, then add the source to `docs/docs_manifest.json`:

```json
{ "id": "myapp", "dir": "MyApp_App", "indexed": true }
```

Generate the endpoint tables and the module map with `python tools/docs/gen_api_docs.py --app myapp --static` and `python tools/docs/gen_code_map.py --app myapp`, and check the result with `python tools/docs/lint_docs.py --app myapp`. The Docs Assistant indexes the pages on its next synchronization, `copy-docs.js` embeds them in the next build, and the golden questions of `Docs_Assistant_App/tests/golden.json` can be extended to cover them.

### Connect the app to the Orchestrator

This step is optional: an app works and is documented without it. To let a graph drive the app, add the `/api/orchestrator/` endpoints to it (see `Optuna_App/backend/api/orchestrator.py`), its URL in `APP_URLS` (`Orchestrator_App/backend/config.py`), an entry in `_KEY_TO_APP_ID` (`graph_runner.py`) so it can be auto-launched from the registry, and a node type as described in the [Orchestrator code map](../Orchestrator_App/docs/code-map.md). An app must never depend on the Orchestrator being present.

### Verify the result

Before merging, check each point:

- [ ] `python launcher.py --app myapp ...` prints two `[config]` lines and `/health` answers.
- [ ] The tile is clickable once settings are complete, and the tab opens after launch.
- [ ] Two users can launch the app at once without a port collision.
- [ ] The tab shows the right language when the launcher is set to `fr`.
- [ ] `python tools/docs/lint_docs.py --all` reports no error.
- [ ] `npm run build` and `npm test` pass in `desktop/`.

## Add a compute resource to the suite

A compute resource is a backend-only service switched on from the catalog. Register it in `APP_REGISTRY` with `frontend_dir`, `base_frontend_port` and `frontend_port_env` set to `None`, add its workspace key to `_WS_SUBDIRS`, and add a `ServiceDef` to `SERVICES` in `desktop/src/catalog.ts` (id, label, icon, indicative `backendPort` and an i18n `descKey` defined in `ui/i18n.js`). The card, the switch, the state machine and the log tab come for free. A window that needs the service must go through a dedicated IPC bridge in `main.ts`, as the Documentation window does for `docs`, because the renderer must never know the port. Its documentation source is added to `docs/docs_manifest.json` like an app.
