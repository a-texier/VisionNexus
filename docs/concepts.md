---
app: suite
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [suite, workspace, user, ports, tunnel, native path, plugins, offline, compute resource]
sources: [_lib/launcher_engine.py, _lib/plugin_registry.py, desktop/src/catalog.ts, desktop/src/sshLauncher.ts, desktop/src/imageProtocol.ts, desktop/src/main.ts, docs/docs_manifest.json]
---

# Concepts

## The suite and the role of each app

The suite is made of independent applications that share nothing at run time except files and HTTP calls. Each one has its own FastAPI backend, its own React frontend and its own workspace folder, and each one starts and works alone. None of them knows the others exist, with one exception: the Orchestrator, which drives the rest.


Apps hand data to each other through files in the user workspace, for example an exported dataset that Training reads, and through the Orchestrator, which calls dedicated `/api/orchestrator/` endpoints on each app and shows the chain as a graph. That is why any app still works when the Orchestrator is not running. What each app does is documented in its own pages, available in the **Documentation** window.

## Apps and compute resources

VisionNexus launches two kinds of things. An **app** has a frontend and a backend: it gets a tile in the diagram, opens in a tab, and its lifetime is that of the tab. A **compute resource** has a backend only: it has a card with a switch in the **Compute resources** section, never opens a tab, and stays on until you switch it off or close VisionNexus. The Docs Assistant, which powers documentation search, is the only compute resource at the moment.

Both are started by the same launcher and follow the same start-up sequence: the launcher announces the real port, VisionNexus opens a tunnel if a VM is selected, and it waits for the backend to answer on `/health`. The difference is what happens next: for an app VisionNexus waits for the frontend and opens a tab, for a resource it only keeps the backend reachable so that other windows, such as **Ask the docs**, can call it through VisionNexus. A resource runs on the target selected when it was switched on and keeps it until it is switched off, even if you select another VM meanwhile.

## Workspaces and users

The **User** and **Workspace** settings decide where each application stores its data. For an application whose launcher key is `<app>`, the data folder is `<workspace>/<app>_<user>`, for example `D:/ws/annotation_alice`. The key is the launcher identifier, not the display name: Dataset Explorer uses `explorer_alice` and the Docs Assistant uses `docs_alice`.

This convention isolates people and applications: two users who share the same workspace root never write in the same folder, and a user running several applications gets one folder per application. The launcher creates the data folder and a few subfolders and the application creates the rest; the list is in [Configuration](configuration.md#workspace-layout).

The user name is also the key of the port reservations and appears in the list of connected users inside applications. That is why generic names such as `unknown`, `user`, `default`, `none`, `null`, `admin` and `test` are refused: two people using them would silently share a workspace and its databases. When no workspace is passed on the command line, the launcher falls back to an `All_workspaces` folder next to the repository; VisionNexus always passes the workspace of its settings.

## Local and VM execution

VisionNexus runs the same command in both modes: `python launcher.py --app <id> --user ... --workspace ... --conda-path ...`. Only where it runs changes. With **(local, no VM)** it runs in a `cmd.exe` on your Windows machine. With a VM selected it runs on that VM through `ssh`, and its output streams back to the **Launches** panel.

Every path in the settings is read by the machine that runs the command. In local mode, **Workspace**, **Computer_Vision_App root** and **Conda path** are Windows paths; in VM mode they are Linux paths on the VM. The application tabs always talk to `127.0.0.1`: with a VM, tunnels carry those local ports to the same port numbers on the VM.

VM mode is meant for GPU work on datasets too big for a laptop, while keeping a local interface. It also changes two things: images travel through the tunnel unless the native network path is available, and processes live on a machine you do not see, which is why the **Ports** panel can list and kill them there.

## Ports, dynamic allocation and tunnels

Each app has a base port for its backend and one for its frontend, listed in [Configuration](configuration.md#base-ports-of-every-application). They are starting points, not fixed values. At launch, the launcher scans upward from the base until it finds a port that is free on the machine and not claimed by another instance in the registry, up to 200 candidates, then announces the ports it picked. VisionNexus never assumes a port: it reads the announced ones. This is what lets several users, or several instances of the same app, share one machine.

With a VM, VisionNexus opens a second SSH connection as a pure tunnel (`ssh -N -L port:localhost:port`) for exactly those ports, using the same number locally and remotely. Before that, it checks that the numbers are free on your Windows machine, because a busy local port would send your tab to another server. The tunnel is opened with `ExitOnForwardFailure`, so a refused forward is reported instead of silently ignored, and it sends keep-alive messages so a dead connection is noticed.

## The shared instance registry

Every launch writes an entry in a small JSON file, `.run/.instances.json`, at the root of the repository on the target machine. An entry records the application, the user, the two ports, the workspace, the launcher process id and the start time. The launcher reads it to avoid ports claimed by other users on a shared VM, and drops entries whose process no longer exists.

A lock file next to it, `.run/.port_lock`, serializes port allocation so two launches at the same moment never pick the same port. Applications read the registry too, to list the users currently connected to them. VisionNexus reads it for the **Ports** panel: a port that belongs to an entry without any tab of yours is shown as **active app**.

## The native network path


For each image, the application frontend asks its own backend for the file's path on the share, then VisionNexus reads that file straight from the share, with short time limits and an in-memory cache of about 150 MB. If any step fails (share unreachable, file not found, backend not answering), the image is fetched over HTTP through the tunnel instead, so you never see a broken image. The tab tag shows **SMB** when the path is active and **HTTP** when the application fell back.

The path is considered active when the host answered the **Test** button, and always in local mode, where files are read from the local disk. The server side of the share, for example the folder of the VM exposed by a file server, is not created by VisionNexus and must already exist. Native reading is tried per request, so a share that goes away only slows the next images down.

## Plugins: training engines, detectors and extra pages

The core of the suite includes a YOLOX training engine. A plugin can add other engines or detectors without the core depending on it. A plugin is a Python package placed in the `plugins/` folder of the repository: its mere presence makes it visible, and removing the folder makes it invisible again, with no other change.

A plugin declares what it provides, such as a training engine for Training, Optuna and the Orchestrator, or a detector for Inference. If one of the libraries it needs is missing, the plugin stays listed but is marked unavailable, with the reason, and is offered nowhere. Interfaces show an engine choice only when more than one engine is available; without plugin, the choice does not appear. A plugin can also add documentation pages to an app, shown after the app's own pages, only where the plugin is present. The contracts are in [Architecture](architecture.md#plugin-mechanism).

## Model weights and offline operation

The applications do not download model weights while running. Weights are files you place in the folders of the apps that use them (SAM2, Grounding DINO, CLIP, the embedding model of the Docs Assistant...), as listed in [MODEL_WEIGHTS.md](../MODEL_WEIGHTS.md). This makes deployments on machines without internet access predictable, and a missing file produces a clear message instead of a silent download.


## Documentation sets and language twins


The two files of a page have the same sequence of headings, so each section has a twin in the other language. The **Documentation** window and the Docs Assistant use that link to offer the same section in the other language. The list of sources, of pages and of their audience is kept in `docs/docs_manifest.json`.
