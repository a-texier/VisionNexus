*[Lire en francais](README.fr.md)*

# VisionNexusElectron — independent native launcher

Electron shell for the `Computer_Vision_App` apps. **Independent from
VisionNexus.exe**: zero shared code, zero shared settings (a deliberate
decision). The two tools can coexist on the same machine without ever
stepping on each other.

---

## 1. What this tool actually does, step by step

```
1. Catalog window (ui/catalog.html)
   -> app grid on the left, Settings ALWAYS visible on the right
   -> settings stored in %APPDATA%\VisionNexusElectron\settings.json

2. Click on an app
   -> sshLauncher.ts spawns ONE of the following two commands:

      A VM is selected:
        ssh -t <vm> "cd '<cvRoot>' && python launcher.py --app <id>
                     --user <user> --workspace '<ws>' --conda-path '<conda>'"

      No VM (local):
        cmd /c cd /d "<cvRoot>" && python launcher.py --app <id>
                     --user <user> --workspace "<ws>" --conda-path "<conda>"

   -> THIS IS THE EXACT SAME COMMAND that VisionNexus (AppRunner.cs,
      TryLaunch) builds. Same launcher.py, same _lib/launcher_engine.py,
      nothing different at this level. This launcher does not bypass or
      replace that mechanism — it calls it from Node instead of C#.

3. Reading the REAL ports from launcher.py's output
   -> _lib/launcher_engine.py dynamically allocates the ports
      (find_free_port(), see section 3) and always announces them on
      stdout:
        [config] backend   = http://localhost:XXXX
        [config] frontend  = http://localhost:XXXX
   -> sshLauncher.ts reads these two lines live (the same stream the
      terminal would show). Nothing else happens until they appear.

4. Tunnel (VM only)
   -> once the real ports are known, a SECOND ssh connection (a pure
      tunnel, `ssh -N -o ExitOnForwardFailure=yes -L port:localhost:port
      ... <vm>`) is opened. This is necessary because you cannot add a -L
      to an ssh connection that is already established — you can't tunnel
      ports you didn't yet know about when the first connection was opened.
   -> `ExitOnForwardFailure=yes` is NOT cosmetic: if the local port is
      already taken (an orphaned tunnel from a previous session, another
      instance of VisionNexus), ssh used to just print a "bind: Address
      already in use" to stderr and keep running. The port still responded
      — through the OLD tunnel — and the tab opened against a server that
      was not the one for this app, even though the same URL pointed
      directly at the VM was correct. The tunnel now exits with an error,
      `watchTunnel` surfaces it in the tab's log, and the tab is refused
      with that message instead of being opened against whatever happened
      to answer.

5. Waiting for the server to respond (polling http://127.0.0.1:<port>)

6. A native window dedicated to the app, loaded on that port.
   -> For Annotation App specifically: app-image:// (SMB path, see
      section 4) instead of the SSH tunnel for pixels. The other apps load
      their frontend over plain HTTP through the tunnel, as usual.

7. Closing the app window -> kills the associated ssh process(es)
   (launch + tunnel). The remote app then stops on the VM side (the
   `python launcher.py` process reacts to the ssh connection closing, the
   same mechanism as closing VisionNexus's terminal).
```

---

## 2. Difference from VisionNexus — table

| | VisionNexus.exe | VisionNexusElectron.exe |
|---|---|---|
| Language | C# / WPF | TypeScript / Electron |
| Triggers `launcher.py` | Yes | Yes (**same command**) |
| launcher.py output | Visible terminal (wt.exe/cmd.exe) | Log in its own window |
| Opening the app | **Manual** (you, in a browser) | **Automatic**, native window |
| SSH tunnel | Opened separately, by hand | Opened automatically (real ports read live) |
| Pixel path (Annotation) | Plain HTTP | SMB (see section 4) if the share responds, HTTP fallback otherwise |
| Settings | `%APPDATA%\VisionNexus\user_settings.json` | `%APPDATA%\VisionNexusElectron\settings.json` (separate) |
| Target machine prerequisite (Windows) | .NET 9 Desktop Runtime | None (Electron/Node runtime bundled in the exe) |

Neither tool replaces the other. Same end result (an app running,
reachable on `localhost`), different paths to get there.

---

## 3. Port management — yes, `_lib/launcher_engine.py` + `launcher.py`

Confirmed by reading `Computer_Vision_App/_lib/launcher_engine.py`:
`launch_app()` allocates ports via `find_free_port(base, claimed)` (the
"claimed" ports coming from the `.run/.instances.json` registry) **unless**
`--backend-port`/`--frontend-port` are passed explicitly — in which case
**no collision check is done at all** (lines 745-747).

**Direct consequence for this launcher's design**: `catalog.ts` does hold a
list of *default* ports (`backendPort`/`frontendPort` per app), but
**they are never sent as an argument** to `launcher.py`. They are only used
for display/reference in the catalog — the real port used at runtime is
**always** the one `launcher.py` itself announces on stdout (section 1,
step 3). This approach correctly supports several parallel instances (each
one gets a free port), exactly as `_lib/launcher_engine.py` already does
for any other client (a manual terminal, VisionNexus, or this launcher).

---

## 4. Electron — rationale and why this choice

**Principle**: Electron packages Chromium (the browser engine) plus a
Node.js runtime into a standalone executable. The "main" process (Node,
everything under `src/`) has system access (files, network, subprocesses).
The "renderer" process (what's displayed, here an app's React frontend)
runs inside a standard Chromium sandbox with no direct system access — the
security posture is the same as a normal browser tab
(`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
everywhere in this project).

**Why Electron rather than other options:**
- **Loads the existing React frontend as-is** — `main.ts` just calls
  `loadURL('http://127.0.0.1:<port>')`, like a browser tab. No rewrite of
  the Konva canvas, the Zustand stores, the timeline, or Annotation App's
  4 tracking tabs.
- **Tauri** (Rust) would add nothing here: the only two modules with real
  engineering value (`sshLauncher.ts` — dynamic port discovery + tunnel;
  `imageProtocol.ts` — custom protocol with HTTP fallback) are already
  written and working in TypeScript, the language the team already uses on
  the frontend. Rewriting them in Rust adds no capability, just translation
  work, for a binary-size gain (~10-20 MB instead of ~150 MB) with no real
  stakes for an internal tool.
- **Qt/PySide** (the way FrameViewer does it) would require either bundling
  `QWebEngineView` (= yet another full Chromium, no savings at all), or
  rewriting the entire UI in Qt widgets — several months of work, for a web
  frontend that already works.

**The concrete benefit for the user**: a "remote" app (VM + SSH tunnel)
behaves like a locally installed app — dedicated window, pinnable, its own
icon — without losing any of the richness of the existing web frontend.

### The SMB path (Annotation App only, for now)

`app-image://frame/{id}?tier=preview|display|full` (custom protocol
registered in `imageProtocol.ts`):
1. A small GET `/api/frames/{id}/image-path` over the already-open SSH
   tunnel — returns a UNC path (`\\<native_share_host>\...`), guaranteed to
   already be generated on disk server-side (the same cache/LUT logic as
   the normal HTTP endpoint, never duplicated on the client side).
2. Direct file read via that UNC path (`fs.readFile`), **outside** the SSH
   tunnel — that's the entire gain (see
   `Annotation_App/cours_2_multiplexage_natif_simulation.html` for the
   detail on "why SMB wins").
3. Automatic, silent fallback to the normal HTTP endpoint if either step
   fails (share not mounted, permission denied, backend unreachable) —
   never a broken image.

**Note: the native network share server on the VM side is not yet
configured in this repository.** The client code assumes a share is
already reachable (the same one VisionNexus's `/api/workspace/open` already
uses for "open in explorer"); if no share responds, the HTTP fallback takes
over automatically — the feature still works, just without the speed gain
until the share is set up on the VM side.

---

## 5. Do you need the whole repo, or just the exe?

**On the Windows machine that LAUNCHES the apps**: just
`VisionNexusElectron.exe` (portable, in `release/` after `npm run
dist:win`, or provided by `package_cv_bundle.py --full`). The
Electron/Node runtime is already bundled — no Node.js installation, no
`npm install` needed on this machine.

**On the launched target** (VM or local machine, depending on `cvRoot`):
the full `Computer_Vision_App/` repository must exist there (same as with
VisionNexus, this requirement is identical and unchanged) —
`launcher.py`, `_lib/`, and the app itself (Python backend + `frontend/`
with `node_modules`). Nothing different from what VisionNexus already
expects.

**To DEVELOP this launcher** (modify its code): the source repo
(`desktop/src/`, `desktop/ui/`) + Node.js installed + `npm install`.

---

## 6. Changes each app needs to benefit from the shell

**Without changing anything**: every app in the catalog already benefits
from (1) the automatic native window (no more manually opening a browser),
(2) the automatic SSH tunnel with real ports, (3) the launch log visible
without an external terminal.

**The SMB path (the real speed gain) is today specific to Annotation
App.** To extend it to another app (e.g. Dataset Explorer, if it also
serves a lot of images), you would need to replicate exactly the same
pattern:

- **App backend**: a `GET /api/.../image-path` endpoint that reuses the
  file-resolution logic of the existing image endpoint, but returns
  `{"native_path": to_native_share_path(str(chemin))}` instead of streaming
  the bytes (see `Annotation_App/backend/models/routers/dataset.py`,
  functions `resolve_frame_image_path` / `frame_image_path`, and
  `Annotation_App/backend/utils/native_share.py` for
  `to_native_share_path`, reusable as-is by any FastAPI app in the repo).
- **App frontend**: a helper equivalent to `frameImageUrl()`
  (`Annotation_App/frontend/src/pages/AnnotationPage.tsx`, lines ~149-157)
  that switches to `app-image://...` when `window.__ANNOTATION_APP_NATIVE__`
  is true, otherwise keeps the usual HTTP URL.
- **Shell (`desktop/`)**: `imageProtocol.ts` is already generic in its
  mechanics (call `/image-path` + SMB read + HTTP fallback) — it would just
  need to be made aware of the new app's backend port (today it only knows
  Annotation App's, cf. `annotationBackendPort` in `main.ts`), or turned
  into a variant parameterized per app.

Without this work, the other apps in the catalog stay at today's
performance level (HTTP through the tunnel) — but they still gain the
automatic native-window opening, which is already a real convenience
compared to VisionNexus.
