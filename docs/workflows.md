---
app: suite
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [first launch, local, vm, ssh, network share, pipeline, stop all, language]
sources: [desktop/src/main.ts, desktop/src/sshLauncher.ts, desktop/ui/catalog.html, launcher.py, _lib/launcher_engine.py, rebuild_all.py]
---

# Workflows

## Set up VisionNexus for the first time

This workflow fills in the settings once so that every application can be launched.

*Prerequisites*: the repository `Computer_Vision_App/` is on the machine that will run the applications, with Python 3.11 or later and a conda environment holding the application dependencies, and Node.js 20 or later with the frontends built (`python rebuild_all.py` from the repository root does it). See [Configuration](configuration.md#prerequisites).

1. Start `VisionNexusElectron.exe`, or run `npm start` in `desktop/`. The **Settings** panel on the right shows an orange bar.
2. In **User**, type your real login. Avoid `unknown`, `user`, `default`, `none`, `null`, `admin` and `test`: they are refused.
3. In **Workspace**, type a folder for your data, for example `D:\ws`. It is created on first use.
4. In **Computer_Vision_App root**, type the repository folder, for example `C:\Vision\Computer_Vision_App`.
5. In **Conda path**, type the folder of the conda environment (or its Python executable).
6. Leave **Target VM** on **(local, no VM)**, then click **Save**.

*Result*: the bar turns green (**Settings complete -- apps can be launched.**) and the tiles of the diagram become clickable. Click **Tutorial** if you want a guided tour.

## Launch an application on your own machine

This workflow starts one application locally and opens it in a tab.

*Prerequisites*: the settings are complete with **Target VM** on **(local, no VM)**.

1. Click a tile, for example **Dataset Explorer**. Its dot turns blue and the **Launches** panel opens.
2. Watch the log. You should see `Ports reels : backend=... frontend=...`, then a waiting message while the backend loads its models, then `Pret -- ouverture de l'onglet.`
3. When the tab appears next to **VisionNexus**, work in the application as usual.
4. To end the session, click the cross of the tab (or **Stop** in the **Launches** panel).

*Result*: the application ran on free ports chosen by the launcher, wrote its data under `<workspace>\explorer_<user>`, and its processes were stopped when you closed the tab. Launching the same application twice is not possible: a second click on its tile only switches to the open tab.

## Run the suite on a Linux GPU VM over SSH

This workflow runs the applications on a remote Linux machine and displays them on your Windows machine.

*Prerequisites*: you can open `ssh <vm>` from a Windows terminal without typing a password (key or agent); the repository, a conda environment and Node.js are installed on the VM; `python` is found by the shell that `ssh` starts for a remote command. See [Configuration](configuration.md#linux-gpu-vm-prerequisites).

1. Type `ssh <vm>` in a terminal to check the connection.
2. In **Known VM(s)**, type the VM name as `ssh` understands it, for example `vm-gpu-01`. Separate several names with commas.
3. Click **Save**, then choose the VM in **Target VM**.
4. Change **Workspace**, **Computer_Vision_App root** and **Conda path** to Linux paths on the VM, for example `/data/ws`, `/home/<user>/Computer_Vision_App` and `/home/<user>/miniconda3/envs/IA_env`. Click **Save**.
5. Click a tile. In the **Launches** panel you should see `Lancement de ... sur <vm>`, the real ports, `Client ssh : ...`, then `Tunnel ouvert (local <port> + <port> -> <vm>).`
6. The tab opens on `127.0.0.1` through the tunnel; the computation runs on the VM.

*Result*: the application runs on the VM's hardware and you use it as if it were local. The same port numbers must be free on your Windows machine: if the log says a local port is already in use, see [Troubleshooting](troubleshooting.md#a-local-port-is-already-in-use-and-the-tunnel-is-refused).

## Read images from a network share with the native path


*Prerequisites*: a VM is selected, and the storage that holds your images is exposed as a share (SMB or similar) that your Windows machine can reach, for example through a VPN.

1. In **Native network share (optional)**, type the host name of the share server, for example `share-host.example.net`.
2. Click **Test**. Wait for **Reachable**; if you read **Unreachable**, check the host name and the VPN.
3. Click **Save**.
5. Check the tab: an **SMB** tag in teal means images are read from the share. An amber **HTTP** tag means the application fell back to HTTP; hover it for the reason.

*Result*: images are read directly from the share and the tunnel only carries the interface and the API calls. If the share fails at any moment, images are fetched over HTTP instead, and nothing breaks. The host is passed to the applications so they can convert Linux paths to share paths (see [Concepts](concepts.md#the-native-network-path)).

## Chain an end-to-end pipeline through the apps

This workflow runs the whole chain, from a dataset of images to a trained and evaluated model, through the Orchestrator.

*Prerequisites*: the settings are complete, local or VM mode as you prefer.

1. Click the **Orchestrator** tile and wait for its tab.
2. In the Orchestrator, choose or build a graph and click **Run**. The Orchestrator launches the sub-applications the graph needs; you do not have to click their tiles.
3. Watch the counter on the Orchestrator tab, such as `3/7`. Click it and choose **Ouvrir (onglet)** to open a running sub-application as a tab, for instance **Annotation** when the pipeline waits for you to annotate.
4. Finish the manual step in the sub-application, return to the Orchestrator tab and continue the run.
5. Open **DVC** and **MLflow** from the same menu to inspect the versions and the experiments the run produced.

*Result*: each application ran under your user and workspace, and the pipeline outputs are in the workspace folders of the applications. The graph editor, the templates and the human gates are documented in the [Orchestrator workflows](../Orchestrator_App/docs/workflows.md); each app has its own pages in the **Documentation** window. To chain apps by hand instead, launch them one by one with the same **User** and **Workspace** and pass the exported folders from one to the next.

## Search the documentation with the Docs Assistant

This workflow points to the pages that describe how to turn the documentation search on and use it. The service is a compute resource, so it is switched on from the **Compute resources** section of the home tab or from the **Ask the docs** tab of the **Documentation** window. The complete steps, including refreshing the index after you edit documentation pages, are in the [Docs Assistant workflows](../Docs_Assistant_App/docs/workflows.md).

## Stop everything and free the ports

This workflow closes every process started by VisionNexus and clears the ones left behind by a crash.

*Prerequisites*: none.

1. Click **Ports**. The panel lists local ports and, if a VM is selected, the VM ports.
2. Click **Stop all** and read the confirmation, which names the open applications. Confirm.
3. When the button shows how many items were stopped, check the table: known ports of the suite should be gone.
4. For a port still marked **to check** that you recognize as a leftover, click **Kill** on its row. On a shared VM, check the **User** column first: only kill your own processes.
5. Click **Close**.

*Result*: no application, tunnel or compute resource of VisionNexus remains, locally or on the VM.

## Switch the interface language

This workflow changes the language of the launcher and of the applications launched afterwards.

*Prerequisites*: none.

1. In the **Settings** panel, click **EN** or **FR** next to **Apps language**. The launcher is translated at once and the choice is saved.
2. Launch applications from now on: each starts in that language.
3. For an application that is already open, use its own language button; it keeps its own preference and does not follow the launcher.
4. Reopen the **Documentation** window if you want it in the new language, or use the **EN** and **FR** buttons at its top right.

*Result*: the launcher and newly launched applications use the language you chose. The guided tour stays in French.
