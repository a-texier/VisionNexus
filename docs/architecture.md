---
app: suite
doc_type: architecture
audience: dev
lang: en
title: Architecture
order: 60
tags: [electron, launch flow, tunnels, service manager, launcher engine, plugins, documentation pipeline, ipc]
sources: [desktop/src/main.ts, desktop/src/sshLauncher.ts, desktop/src/tunnelClassify.ts, desktop/src/services.ts, desktop/src/imageProtocol.ts, desktop/src/docFiles.ts, desktop/src/preloadCatalog.ts, desktop/src/preloadDocs.ts, desktop/src/preloadApp.ts, desktop/scripts/copy-docs.js, _lib/launcher_engine.py, _lib/plugin_registry.py, launcher.py, docs/docs_manifest.json]
---

# Architecture

## Components overview

The suite has three layers: the desktop launcher, the Python launcher, and the applications.

```text
VisionNexus (Electron, desktop/)
  main process   src/main.ts, sshLauncher.ts, services.ts, imageProtocol.ts, docFiles.ts
  preload        preloadCatalog.ts, preloadApp.ts, preloadDocs.ts   (contextBridge)
  renderers      ui/catalog.html, ui/docs.html, one WebContentsView per application tab
        |
        |  cmd.exe /c  or  ssh -t <vm>       + a second ssh -N -L for the tunnel
        v
launcher.py -> _lib/launcher_engine.py  (registry, ports, workspaces, processes)
        |
        v
application: uvicorn backend (127.0.0.1:<port>)  +  Vite dev server (127.0.0.1:<port>)
```

The desktop program never contains application logic. It starts `launcher.py`, reads the ports the launcher prints, connects to them, and displays the frontends. The Python launcher owns everything that concerns the target machine: which interpreter runs the backend, which ports are free, where the workspace lives. Applications only need to be startable by the registry and to answer on `/health`. Compute resources go through the same chain with `--backend-only`.

Documentation is a fourth, cross-cutting piece: `docs/docs_manifest.json` lists the documented sources, the desktop program reads their pages for the Documentation window, and the Docs Assistant indexes them.

## Electron process model

The main process (`src/main.ts`) owns every system capability: child processes, files, sockets, dialogs and windows. Renderers are sandboxed (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`) and reach the main process only through the functions their preload script exposes with `contextBridge`. Three preload scripts define three surfaces:

- `preloadCatalog.ts` exposes `window.cvLauncher` to `ui/catalog.html`: launching, tabs, layouts, ports, settings, tutorials, compute resources.
- `preloadDocs.ts` exposes `window.cvDocs` to `ui/docs.html`: the list of documentation pages, and a narrow bridge to the Docs Assistant.
- `preloadApp.ts` runs in each application tab and exposes `__CV_NATIVE_MOUNT__` (native path support, file drop paths, tutorial state) and the legacy flag `__ANNOTATION_APP_NATIVE__`. It receives the native path status as a `--cv-native-status` command line argument, since no IPC is possible before the page loads.

All calls are `ipcRenderer.invoke` requests answered by `ipcMain.handle`, plus seven events pushed by the main process (listed in the [API reference](api-reference.md#events-pushed-to-the-renderers)). Handlers do not throw across IPC: the bridge to the Docs Assistant returns `{ok: false, error, message}` objects instead.

The catalog window is a frameless window on Windows, with a custom header drawn in HTML. Application tabs are `WebContentsView` objects stacked in that window, so an application keeps its state when hidden. A single-instance lock makes a second start focus the existing window.

## Launch flow of an application

`ipcMain.handle('cv:launch')` in `main.ts` runs one launch. It first reuses an existing tab, checks the settings with `isValid()` and refuses placeholder user names, then:

1. Opens a log file and notifies the catalog (`launching`).
2. Calls `launchApp()` (`sshLauncher.ts`), which spawns `cmd.exe /c cd /d "<root>" && python launcher.py --app <id> --user ... --workspace ... --conda-path ...` locally (with `windowsVerbatimArguments`, since `cmd.exe` parses quotes differently from Node) or `ssh -t <vm> "cd '<root>' && python launcher.py ..."`. `--native-share-host` is added when a host is configured.
3. Calls `waitForPorts()`, which scans stdout and stderr for the `[config] backend = http://localhost:N` and `[config] frontend = ...` lines and resolves when both are known (60 s limit, `null` on timeout or early exit). It also reads the `[token]` line the launcher prints before its ports and returns the session token with them; `redactLauncherLine()` replaces that line and the `[auth] navigateur` link with masked text before logging. `rememberToken()` (`sessionTokens.ts`) keeps the token for the frontend and backend ports, and `setSessionCookie()` sets the cookie `vn_<backend port>`; [Security](security.md) describes the whole token flow.
4. With a VM: `findBusyLocalPorts()` tests the two ports on `127.0.0.1`, `describeSshClient()` logs `ssh -V`, and `openTunnel()` starts `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L p:localhost:p ... <vm>`. `watchTunnel()` reports problems.
5. `waitUntilReady()` polls the frontend (60 s) and `waitUntilBackendReady()` polls `/health` on the backend (120 s, any answer below 500 counts). Both take an `AbortSignal` so **Stop** cancels the wait immediately.
6. A fatal tunnel problem recorded in `tunnelProblems` aborts the launch: the local port would answer, but not through this launch's tunnel.
7. `createAppTab()` creates the `WebContentsView` loading `http://127.0.0.1:<frontend>?lang=<uiLanguage>` and registers the tab. The status becomes `running`. Every request of the tab to a known port receives the `X-VN-Token` header from `installRendererAuth()`, a `webRequest.onBeforeSendHeaders` hook on the default session shared by all tabs.

Launch state is spread over a few maps: `launchingProcs` (processes alive before a tab exists, killed by **Stop**), `launchAbort` (abort signals), `userStoppedLaunch` (distinguishes a user stop, reported as `closed`, from a failure, reported as `error`), and `dockedTabs` / `detachedTabs` once running. The Orchestrator is special: after its tab opens, `main.ts` polls its `/api/apps` every second (see below).

## Tunnels and their classification

A tunnel is a plain `ssh -N -L` process opened after the ports are known, because a `-L` cannot be added to an existing connection. It runs with `ExitOnForwardFailure=yes`: without that option, a busy local port only prints `bind: Address already in use` and ssh keeps running, while the port keeps answering through an older tunnel that leads elsewhere.

`watchTunnel()` reads the tunnel's stderr and asks `classifyTunnelLine()` (`tunnelClassify.ts`) for a verdict per line: benign (host key added, pseudo-terminal, debug), transient, or fatal. The order matters. A `channel N: open failed` or `connect failed` line concerns one forwarded connection: it is expected while the backend still loads its models, and it also contains `connection refused`, so transient is tested before fatal and never aborts a launch. Fatal lines match a fixed list (address in use, cannot listen, bind, permission denied, could not resolve, connection refused, closed or timed out, host key verification failed). When the process exits with a non-zero code, the last unrecognized stderr lines are replayed, and code 255 is distinguished from other codes, which cannot come from ssh itself.

## Tabs, layouts and detached windows

`dockedTabs` maps an app id to a `DockedTab`: label, icon, view, processes, log stream, native path status, ports. `detachTab()` moves the same `WebContentsView` into a new `BrowserWindow`, without reloading, and `dockTab()` moves it back; a detached window watches its own `move` events and re-docks when its top centre rests over the catalog's tab strip for 220 ms. Detached windows get their own Windows AppUserModelID so each has its own taskbar button.

Layouts are computed in the main process. `layoutMode` is one of `single`, `v2`, `h2` and `grid4`, `paneTabs` holds the app id of each pane, and `slotBoundsFor()` derives the rectangles from the content bounds that the renderer reports (`cv:report-content-bounds`, measured on `#body`) and two split ratios limited to 0.2 to 0.8. `applyLayout()` removes every child view and adds back those assigned to a pane. Native views always draw above the window's HTML, which is why overlays (composition screen, menus, ports panel) call `cv:set-shell-overlay` to hide the views while they are open, and why the Orchestrator sub-app list is a native menu.

## Orchestrator sub-app integration

The Orchestrator starts its own sub-applications from its backend, outside `launchApp()`. To show them, `main.ts` polls `GET /api/apps` on the Orchestrator backend port every second while its tab is open, keeps the last answer in `lastSubApps` and pushes it to the catalog (`cv:orchestrator-subapps`). Opening a sub-application (`openOrchestratorSubApp`) requires status `running`, checks the local ports in VM mode, opens a tunnel on demand, waits for the frontend, and creates a tab whose id starts with `orch_`.

Closing such a tab only hides it. Closing the Orchestrator tab asks the backend to stop everything (`POST /api/apps/stop-all`, 15 s limit), then kills every port the launcher knows, locally and on the VM, as a safety net. Links opened from any app that target a known local frontend port are routed to the matching tab by `openLocalUrlInVisionNexus()`; other HTTP links go to the system browser and no new Electron window is ever created.

## Native image protocol

`imageProtocol.ts` registers the `app-image://` scheme. A request carries `imagePath` (URL returning `{native_path}`), `fallback` (the plain HTTP image URL) and optionally `nativePath` when the backend already knows the file. The handler tries, in order: the memory cache (LRU, 150 MB), the native read (`fs.readFile` of the UNC path, 1.5 s limit, after a 2 s limit on the `imagePath` request), then the HTTP fallback. It only tries the native path when `setNativeMountAvailable(true)` was called, which `main.ts` does after a successful **Test** and always for local launches. Provisional answers (a placeholder image marked `x-frame-missing` or `no-store`) are served but never cached.

The scheme is generic: it does not know which app calls it. An app takes part by exposing an endpoint that returns a native path, a frontend helper that builds `app-image://` URLs when `window.__CV_NATIVE_MOUNT__.supported` is true, and `supportsNativeMount: true` in its `AppDef`.

## Service manager

A compute resource is described by a `ServiceDef` in `catalog.ts` (`SERVICES`), separate from `APPS` so that it never gets a tile, a tab or a settings entry. The state machine in `services.ts` is pure and unit tested: `off` to `starting` to `ready` to `stopping` to `off`, with `error` reachable from `starting` and `ready`. An event that makes no sense in the current state leaves it unchanged, so a double click on the switch is harmless.

`startService()` in `main.ts` follows the launch flow, with `--backend-only` and one port to forward: settings check, `launchApp()`, `waitForPorts(..., allowNoFrontend=true)` (the launcher prints `frontend = none`), busy port check, tunnel, then `waitUntilBackendReady()` with a 90 s limit. It does not wait for the model or the index: once `/health` answers the service is `ready`. `failService()` turns any failure into an `error` state with a readable message built by `startFailureMessage()`, keeping the last two launcher lines to explain a crash.

While a service is `ready`, `pollServiceIndex()` reads `/index/status` every 1.5 s during a synchronization and every 15 s otherwise, summarizes it with `summarizeIndexStatus()` and broadcasts `cv:service-status`. The status is shared by the catalog card and the Documentation window, which only ask to start or stop. The renderer never reaches the service: `docsSearch()` validates the request (`validateSearchRequest`), forwards it to `POST /search` on the local port with a 10 s limit and maps the answer (`mapSearchResponse`). A service keeps the target it was started on until it is stopped.

## Shutdown and orphan cleanup

Killing a process tree is not automatic on Windows: `cmd.exe` and the `uvicorn --reload` reloader leave children behind. `killProcessTree()` uses `taskkill /T /F`, and the synchronous variant is used in `before-quit`, which is intercepted once to await the Orchestrator's `stop-all` before killing trees, then re-triggered. Log streams have an `error` handler and are never written after `end()`, so a logging failure cannot crash the main process. On exit, docked tabs, detached tabs, launches in progress and services are all killed.

The **Stop all** action (`cv:kill-all`) adds a port-based net: it snapshots `knownPorts()` (tabs, services, the Orchestrator's sub-apps and the shared registry), stops everything cleanly, then kills whatever still listens on those ports, with `taskkill` locally and process group signals on the VM (TERM, then KILL after one second, never group 1 or the ssh session's own group). On the VM it first rescans the shared registry and adds the entries of the current user name. `killPortsRemote()` sends all ports in one ssh session, takes the process ids from `ss` (with `lsof` or `fuser` as fallback) and prints `STILL <port>` for any port still listening; `killPortsLocal()` checks `netstat` again after `taskkill`. Both return `{ok, failed, error}`, which **Kill** and **Stop all** display. `cleanupRemoteSuite()`, behind **Clean up VM**, stops the user's `node` and `python` processes whose working directory is under the repository root and whose command line is a suite server. `scanLocalPorts()` uses `netstat` and `tasklist`; `scanRemotePorts()` runs one non-interactive ssh command that returns `ss`, `ps` and the registry file together.

## Launcher engine and registry

`launcher.py` parses the arguments and calls `launch_app()` from `_lib/launcher_engine.py` for each requested app. The engine detects its layout by content: a folder that contains one of the app folders is the repository root, whatever its name. `APP_REGISTRY` holds one entry per launcher key with the app root, the ASGI module, the working directory, the frontend folder (`None` for a backend-only service), the base ports, the workspace, user and frontend port variable names, and extra environment.

`launch_app()` then: builds `<workspace>/<key>_<user>` and its subfolders (`_WS_SUBDIRS`); appends the workspace to `<app>/data/.history.json`; under the file lock `.run/.port_lock` reads the registry, picks free ports (`find_free_port`: bind test on `0.0.0.0`, exclusive on Windows, 200 candidates) and registers the instance; builds the environment; resolves the interpreter with `find_python()`; starts `python -m uvicorn <module> --host 127.0.0.1 --port N [--reload]` in the backend folder; waits up to 60 s for the port to be taken; starts `npm run dev -- --port N --host 127.0.0.1` in the frontend folder unless backend-only; and prints the `[config]` block. Processes start in their own session or process group so a Ctrl+C in the launcher terminal does not kill them; the launcher shuts them down itself. On shutdown the instance is unregistered, and for `annotation` a usage report is regenerated under `<workspace root>/monitoring/`.

## Plugin mechanism

The core provides a YOLOX training engine (Apache-2.0). A plugin adds engines or detectors without any line of the core depending on it: interfaces only know the catalogs that plugins publish.

### How a plugin is discovered and what it declares

A plugin is an ordinary Python package under `plugins/` at the repository root (or in the folder named by `VISIONNEXUS_PLUGINS_DIR`). No pip installation is needed: its presence is enough. `_lib/plugin_registry.py` reads the `PLUGIN` dict of its `__init__.py`:

```python
PLUGIN = {
    "label": "My engine",
    "requires": ["my_library"],          # checked without importing (find_spec)
    "extensions": {
        "visionnexus.trainer_backends": {"my_engine": "my_plugin.trainer:MyEngine"},
    },
}
```

`__init__.py` must import nothing, since it is read at each discovery. A `module:attribute` target is imported only when requested, and the target module must stay light: its training library is imported inside `train()`. If a `requires` module is missing, the plugin stays listed but marked unavailable with the reason, and `load_extension()` raises a `RuntimeError` that says why rather than falling back silently. An installed package declaring an entry point of the same group is also accepted. The registry exposes `discover_plugins()`, `extensions_for()`, `load_extension()` and `describe()` (a serializable form for a `/api/capabilities` endpoint).

### Training engine extension

The group `visionnexus.trainer_backends` serves Training, Optuna (HPO trials) and the Orchestrator (Model, Training and Optuna nodes). The contract is `TrainingEngine` in `Training_App/backend/services/trainer_backend.py`; the reference implementation is the YOLOX engine (`yolox_engine.py`, `yolox_catalog.py` in the same folder).

```python
class MyEngine:
    CATALOG = {...}

    def __init__(self, *, model_size, data_yaml, run_name, output_dir, hyperparams,
                 model_weights="", stop_flag=None, on_epoch_end=None): ...

    def train(self) -> dict:
        """Blocking. Calls on_epoch_end({"epoch", "total_epochs", "progress_pct", "loss",
        "metrics"}) each epoch, with metrics named "metrics/mAP50(B)", "metrics/mAP50-95(B)",
        "metrics/precision(B)", "metrics/recall(B)". Returns {"run_dir", "best_model_path",
        "last_model_path"} and optionally "metrics"."""

    @staticmethod
    def load_predictor(weights, model_size, class_names, imgsz=640):
        """Optional: predict(frame_bgr) -> [(x1, y1, x2, y2, conf, cls_id)]."""
```

When `stop_flag` is set, the engine leaves `train()` as soon as possible, by any means; Training treats any exit after a stop as a clean stop. Training exposes `GET /api/capabilities` with the engines, their availability and their catalogs, and an interface offers an engine choice only when several are available. A run's engine travels with its weights (database, MLflow, Orchestrator answer), because weights only reload with their own engine.

### Engine catalog

Everything the interfaces show about an engine comes from its `CATALOG`, whose mandatory keys are `CATALOG_KEYS` in `trainer_backend.py`.

| Key | Role |
|---|---|
| `label` | Displayed name |
| `weights_suffixes` | Weight file extensions; other weights are refused before launch |
| `sizes`, `default_size`, `size_prefix` | Proposed sizes (the prefix is stripped from the buttons) |
| `defaults` | Hyperparameters and default values; a key absent here is ignored |
| `groups` | Form: groups of fields `{key, label, type, min, max, step, placeholder}` |
| `keys` | Translation of the generic fields `epochs`, `batch`, `imgsz`, `workers` |
| `hpo_ranges`, `hpo_default_optimize` | Optuna ranges and default selection |
| `artifacts`, `train_batches_glob` | Plots produced by category (`summary`, `confusion`, `curves`, `labels`, `val_labels`, `val_predictions`), paths relative to the run folder, preferred first |
| `pretrained_by_default` | Implicit starting weights (help text of the forms) |

Declared plots feed the Training gallery, the Orchestrator Insights and the MLflow run (under `plots/`): the engine must produce them under the names it declares.

### Detector extension

The group `visionnexus.detector_backends` serves Inference. The minimal contract is in `Inference_App/backend/inference_core/detectors.py`:

```python
class Detector(Protocol):
    class_names: list[str]

    def predict(self, frame) -> list[Detection]: ...
```

The plugin constructor receives `model_path`, `model_size`, `class_names`, `confidence`, `iou`, `imgsz` and `device`, and may return native `Detection` objects or tuples `(x1, y1, x2, y2, score, class_id, class_name)`. ByteTrack stays an option of the Inference pipeline and is not part of the detector plugin.

### Plugin documentation

A plugin documents what it adds to each app in `plugins/<plugin>/docs/<AppDir>/*.md`. The Documentation window and the Docs Assistant append these pages after the app's own pages, only where the plugin is present. The same rule is applied by `readPluginDocs()` in `main.ts`, by `copy-docs.js` and by `sources.py` of the Docs Assistant.

## Documentation pipeline

The list of documented sources is `docs/docs_manifest.json`: each source has an `id`, a `dir` (the app folder, `.` for the suite), an optional `docs_path` (the pages folder relative to the repository root, `docs` for the suite, otherwise `<dir>/docs`) and an `indexed` flag. The same file defines the nine-page set with each page's `doc_type`, `audience` and `order`. It is read by `tools/docs/` (lint and generators), by `docFiles.ts` and `main.ts`, by `copy-docs.js`, and by the Docs Assistant.

Pages are markdown files with a small frontmatter, in pairs `page.md` (English) and `page.fr.md` (French). Every heading gets an anchor `h-<n>` where `n` counts the ATX headings of the file from 0, code blocks excluded; `ui/doc-render.js`, `tools/docs/docs_lib.py` and the Docs Assistant chunker all apply this rule, and `npm test` runs `scripts/check-heading-ids.js` against a shared fixture to keep the viewer and the tools identical.


## Invariants to preserve

- Never pass fixed ports to `launcher.py` from the desktop program: it must read the announced ports, which makes several instances possible.
- Keep `ExitOnForwardFailure=yes` on tunnels, and check local ports before opening them.
- Test transient tunnel lines before fatal ones in `classifyTunnelLine()`.
- Never write to a log stream after `end()`, and keep the `error` handler on every stream.
- Use `taskkill /T` (or the process group on the VM) to stop a launch, never a plain `kill` of the wrapper process.
- Keep `APPS` (diagram, tabs, settings) separate from `SERVICES` (compute resources).
- The Documentation window never reaches the Docs Assistant or its port directly: everything goes through validated IPC.
- Keep the three heading-number implementations identical: `docs_lib.py`, `doc-render.js` and the Docs Assistant chunker.
