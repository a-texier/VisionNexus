---
app: suite
doc_type: readme
audience: both
lang: en
title: VisionNexus
order: 0
tags: [visionnexus, launcher, suite, catalog, ssh, apps]
sources: [launcher.py, _lib/launcher_engine.py, desktop/src/main.ts, desktop/src/catalog.ts, desktop/ui/catalog.html]
---

# VisionNexus

## What VisionNexus and the suite are

VisionNexus is the desktop launcher of a modular computer vision suite. The suite is a set of independent applications for exploring, annotating, training, evaluating and versioning image datasets; each application has its own backend (FastAPI), its own frontend (React and Vite) and its own per-user workspace. VisionNexus is the window from which you start them, watch them and switch between them.

- **One catalog, one click per app**: the catalog shows every application as a tile on a flow diagram. A click starts the application on your machine or on a remote Linux GPU machine, waits until it answers, and opens it in a tab of the VisionNexus window.
- **Local or remote, same gesture**: with no VM selected everything runs on your Windows machine; with a VM selected, the applications run on the VM (over SSH, on its GPU) and only their interface is displayed on your machine, through automatic SSH tunnels.
- **Settings entered once**: user name, workspace, repository root and conda environment are saved in your Windows profile and reused by every launch.
- **Compute resources**: headless services, such as the Docs Assistant that searches this documentation, are switched on and off from the same catalog.
- **Built-in documentation**: the **Documentation** window shows the pages of every app and of the suite, and answers questions typed in natural language.

The launcher itself is a small Electron program (the `desktop/` folder) that drives the Python launcher `launcher.py` of the repository. Nothing about the applications changes: each one can still be started from the command line.

## The apps of the suite and how they chain

The catalog groups the applications in a frame named **Orchestrator + 7 applications**, plus one standalone application below it.

| App | Role in the suite |
|---|---|
| **Orchestrator** | Visual pipeline editor that chains the other apps over HTTP and starts them automatically |
| **Dataset Explorer** | Explores an image dataset with CLIP embeddings and selects subsets |
| **Annotation** | Annotates images and sequences, by hand or with AI assistance, and exports datasets |
| **Optuna** | Searches the best hyperparameters of a training |
| **Training** | Trains detection models |
| **Inference** | Runs a trained model on media and evaluates it |
| **MLflow** | Tracks experiments and models |
| **DVC** | Versions datasets and outputs with Git and DVC |

The typical chain is Dataset Explorer, then Annotation, then Optuna and Training, then Inference, with DVC and MLflow observing the results. The Orchestrator draws that chain as a graph and runs it; each app also works alone. The Docs Assistant is not an app but a compute resource: it has no tab and no diagram tile. The roles, the workspaces and the way apps talk to each other are explained in [Concepts](concepts.md).

## Quick start in five steps

This quick start assumes the repository is present on the machine that will run the applications and that Python and Node.js are installed there. Requirements are listed in [Configuration](configuration.md).

1. Start `VisionNexusElectron.exe` (or run `npm start` in `desktop/`).
2. In the **Settings** panel on the right, fill in **User**, **Workspace**, **Computer_Vision_App root** and **Conda path**, then click **Save**. The orange bar turns green.
3. Leave **Target VM** on **(local, no VM)** to work on this machine, or pick a VM to work over SSH.
4. Click a tile of the diagram, for example **Annotation**. The **Launches** panel shows the start-up log.
5. When the application answers, its tab appears next to the **VisionNexus** tab. Click **Tutorial** at any time for a guided tour of the launcher.

## Documentation pages for VisionNexus

The suite documentation is split into nine pages. Each application has its own set of nine pages, reachable from the **Documentation** window.

- [User guide](user-guide.md): the VisionNexus window screen by screen, from the diagram and the tabs to the ports panel, the settings and the Documentation window.
- [Workflows](workflows.md): complete tasks in numbered steps: first launch, running locally, working on a Linux GPU VM, reading images from a network share, chaining a pipeline, stopping everything.
- [Concepts](concepts.md): roles of the apps, workspaces and users, local and VM execution, ports and tunnels, the native network path, plugins and offline weights.
- [Configuration](configuration.md): prerequisites, the launcher command line, environment variables, ports, workspace layout, VM prerequisites, model weights, building the desktop app.
- [Troubleshooting](troubleshooting.md): problems described by their symptom, with cause and solution.
- [Security](security.md): who can reach a running application, servers bound to the loopback interface, SSH tunnels, the session token of each instance, opening an application in an external browser, and the limits of these protections.
- [Architecture](architecture.md): the Electron process model, the launch flow, tunnels, the service manager, the launcher engine, the plugin mechanism and the documentation pipeline.
- [API reference](api-reference.md): the launcher command line, the standard output contract, the backend contract and the IPC channels of the desktop app.
- [Code map](code-map.md): where each feature lives and where to change it, and the checklist to add a new app to the suite.
