---
app: suite
doc_type: user-guide
audience: user
lang: en
title: User guide
order: 10
tags: [catalog, tiles, tabs, layouts, ports, settings, launches, documentation window, tutorial]
sources: [desktop/ui/catalog.html, desktop/ui/i18n.js, desktop/ui/docs.html, desktop/ui/tour.js, desktop/src/main.ts, desktop/src/catalog.ts, desktop/src/settings.ts]
---

# User guide

## The VisionNexus window at a glance

The VisionNexus window has a header bar and a body. From left to right the header holds the logo, the title, the **Tutorial** button, the **File** and **Help** menus, the tab strip, and on the right the four view-layout buttons followed by **Ports**, **Panel**, **Logs** and **Documentation**. The tab strip always starts with the **VisionNexus** tab, which shows the launcher home; every application you open adds a tab after it.

The home tab is split in two. On the left, from top to bottom: the application diagram, the **Compute resources** section and the **Launches** panel (which only appears after the first launch). On the right, the **Settings** panel is always visible. When you click an application tab, that application fills the whole body and the home content is hidden until you click the **VisionNexus** tab again.

The interface language of the launcher follows **Apps language** in the settings. Only one VisionNexus window can run at a time: starting the program a second time brings the existing window to the front instead of opening another one.

## The application diagram and its tiles



All tiles are greyed out and cannot be clicked while the settings are incomplete. A tile is also disabled while its own application is launching, so a double click never starts the same application twice. The **Docs Assistant** does not appear in the diagram: it is a compute resource with its own section below.

## Launch an application from a tile

Click a tile to launch the application. The **Launches** panel opens under the diagram on that application's tab and the tile dot turns blue. VisionNexus starts `launcher.py` on the target (your machine or the selected VM), reads the ports the launcher announces, opens SSH tunnels when a VM is selected, waits for the frontend and then for the backend to answer, and finally opens the application in a new tab.

The launch has time limits: the launcher must announce its ports within 60 seconds, the frontend must answer within 60 seconds and the backend within 120 seconds (loading models can take 10 to 40 seconds). If a limit is reached, or if the launcher exits early, the tile turns red and the **Launches** panel explains why.

Clicking the tile of an application that is already open does not start it a second time: VisionNexus switches to its tab, or brings its detached window to the front. Clicking a tile again after an error or after closing the application launches it again. Some names are refused as user names: `unknown`, `user`, `default`, `none`, `null`, `admin` and `test` open a warning called **Identifiant utilisateur non valable**, because the user name decides the workspace and the port reservations (see [Concepts](concepts.md#workspaces-and-users)).

## Application tabs, detaching and re-docking

Each open application has a tab in the strip, with a status dot, its icon and its name. An application that can read images from a share also shows a small tag: **SMB** (teal) when the native path is active, **HTTP** (amber) when it falls back to HTTP; hover the tag to read the reason. Click a tab to display the application; click the **VisionNexus** tab to go back to the launcher home.

- **Close**: the cross at the right of the tab stops the application and its tunnel. The launcher writes a closing line in the log.
- **Reorder**: drag a tab and drop it on another tab.
- **Detach**: drag a tab out of the strip. The application moves to its own window, with its own taskbar icon and a title ending with **Natif** or **HTTP (repli)** for applications that support the native path. The page is not reloaded.
- **Re-dock**: click the arrow button shown on the detached tab, or drag the detached window over the tab strip and pause for a moment.
- **Copy URL** and **Open in browser**: right-click a tab. Both give a one-time link to the local address (`http://127.0.0.1:<port>`) of the application. The link lets another browser of this computer in with the session token, then expires after one use or 120 seconds; copy it again for a new one. See [Security](security.md#opening-an-application-in-an-external-browser).

Closing the detached window stops the application, like the cross on a docked tab.

## Split layouts: two or four views

The four small buttons at the right of the header choose how many applications are visible at once: a single view, two views side by side, two views stacked, or four views in a 2x2 grid. Hover each button for its name (**Single view**, **2 views side by side (left/right)**, **2 views stacked (top/bottom)**, **4 views (2x2 grid)**).

Choosing a layout with several views opens a composition screen headed **Drag an app into each pane**. Each pane appears as a numbered square (**Pane 1**, **Pane 2**...). A tray at the bottom lists the docked applications: drag a thumbnail onto a square, or click a thumbnail and then click a square. A pane shows **remove** to empty it. Click **Apply** to validate or **Cancel** to keep the previous layout. If no application is open, the tray shows **No open app to place**.

Once a layout is active, drag the divider between panes to resize them; the ratio stays between 20 % and 80 %. An empty pane displays a hint asking you to use a layout button. Choosing the single view button returns to one application. Detached windows are never part of a layout.

## Menus, header buttons and shortcuts

- **File > Quit**: closes VisionNexus. Every application, tunnel and compute resource it launched is stopped first.
- **Help > Documentation**: opens the Documentation window, like the **Documentation** button.
- **Help > Logs folder** and the **Logs** button: open the folder that holds the launch log files.
- **Help > Developer tools**: toggles the developer tools of the focused window.
- **Panel** (or **Ctrl+B**): hides or shows the left sidebar of the displayed application, to win a few pixels on a small screen. A short message appears in the application. The button acts on the active docked tab.
- **Esc**: closes an open menu, the ports panel or a tab context menu.

The **Tutorial** button starts the guided tour of the launcher (see the last section of this page).

## The Orchestrator sub-app menu

The **Orchestrator** launches its own sub-applications (Annotation, Dataset Explorer...) itself. To make them reachable, its tab shows a small counter such as `2/7` with a caret: the number of running sub-applications out of the ones the Orchestrator knows. Click it to open a native menu.

The menu starts with **Launch all** and the same counter, then one line per sub-application. A running one offers **Open (tab)**, which opens it as a VisionNexus tab, and **Open (browser)**, which opens it in your default browser. One that is not running shows **Launch** and one that is starting is greyed out with `starting...`. The labels follow the interface language (**Lancer tout**, **Ouvrir (onglet)**, **Ouvrir (navigateur)**, **Lancer** and `demarrage...` in French). Sub-application tabs carry `(Orchestrator)` after the name; closing such a tab only hides it, and the application keeps running under the Orchestrator.

Links between apps that point to a local address of a known application are opened in the matching VisionNexus tab instead of the system browser.

## The Launches panel and the Stop button

The **Launches** panel shows what the launcher prints for each application and compute resource. It has one button per launched item, with a coloured pill (blue while launching, green when running, red on error, grey when closed). Under the buttons, the selected item shows its name, a **Stop** button, a status line such as `Annotation -- Running` and a log area.

The log lines show each launch phase: the command target, the path of the full log file, the real ports (`Ports reels : backend=... frontend=...`), the SSH client version, the tunnel, waiting messages, and `Pret -- ouverture de l'onglet.` when the tab opens. Errors are prefixed with `[erreur]` or `[timeout]`, tunnel messages with `[tunnel]`, and messages from the application tab with `[renderer ...]`. The panel keeps the last 800 lines per item; the complete log stays on disk (see [Configuration](configuration.md#settings-file-and-log-folders)).

**Stop** ends the selected item cleanly, in whatever state it is: it closes a docked tab, closes a detached window, aborts a launch in progress (the status becomes **Window closed**, not **Error**), or switches a compute resource off. The button is disabled when the item is idle or already closed.

## The Ports panel

The **Ports** button opens a panel listing the TCP ports currently listening, so you can spot a process left behind by a crash before ports pile up. It has one table for **Local (this machine)** and, when a VM is selected, one for **VM (name)**. The columns are **Port**, **Process**, **User** and **Status**. The panel refreshes every 10 seconds while it is open; **Refresh** forces a scan.

In the **Status** column, a port that belongs to an application VisionNexus drives shows its name and side, for example an application frontend or backend. A port found in the shared instance registry without a tab shows **active app**. Any other port shows **to check**: it is either unrelated to the suite or an orphan. Known ports are sorted first. Rows with a known process id have a **Kill** button, which stops that process and its whole process group, then checks that the port is free. When it is not, for example a process of another account, the reason shows at the top of the panel.

**Stop all** stops everything VisionNexus started: open tabs, detached windows, launches in progress, compute resources and the Orchestrator sub-applications, then it kills the known ports locally and on the VM, including the registry entries of your user name. A confirmation dialog first names what will be stopped, and the result, with the ports that could not be freed, shows at the top of the panel. **Clean up VM** stops your own suite servers on the VM (`vite`, `uvicorn`, `launcher.py`) running inside the repository root, without touching an IDE server or your other scripts; [Security](security.md#stopping-processes-and-cleaning-up-the-vm) details what it targets. Local scans use the Windows tools `netstat` and `tasklist`; VM scans need a working non-interactive SSH login (see [Configuration](configuration.md#linux-gpu-vm-prerequisites)). **Close**, **Esc** or a click outside the panel closes it.

## Settings: user, workspace, repository root and conda path

The **Settings** panel on the right holds the fields every launch needs. Four of them are required.

- **Apps language**: two buttons, **EN** and **FR**. Choosing one translates the launcher immediately and sets the starting language of the applications you launch afterwards. Each application keeps its own language button and can change it locally.
- **User**: your identifier in the suite. It names your workspace and your port reservations, and it is passed to every launch as `--user`. Use your real login, not a shared name.
- **Workspace** (the working folder): the folder where all applications write their data, for example `D:\ws` locally or `/data/ws` on a VM. Applications create `<app>_<user>` folders inside it.
- **Computer_Vision_App root**: the folder of the repository as seen by the machine that runs the applications. A hint under the field changes with the target: a Windows path such as `C:\...` when no VM is selected, a Linux path such as `/home/...` when a VM is selected.
- **Conda path**: the Python environment the applications run in. It accepts the environment folder, its `activate` script or its Python executable. It is required even though the field label does not say so.

## Settings: target VM and known VMs

Two fields choose where applications run.

- **Known VM(s)**: the list of machines you can target. Type one name, or several separated by commas (`vm-gpu-01, vm-gpu-02`). Each name is used as an SSH destination, so it can be a host alias from your `~/.ssh/config` or a `user@host` address.
- **Target VM**: a drop-down built from that list, with **(local, no VM)** as first entry. **(local, no VM)** runs everything on this machine; choosing a VM runs each launch on that VM over SSH. The choice is saved as soon as you change it.

Switching between local and VM mode changes the meaning of **Workspace**, **Computer_Vision_App root** and **Conda path**, which must then be paths on the new target. When you click **Save**, the selection is kept: local mode stays local, and a selected VM stays selected as long as it is still in the **Known VM(s)** list (otherwise the first VM of the list is selected). If applications start on a VM when you expected local mode, check that **Target VM** reads **(local, no VM)**.

## Settings: native network share

The **Native network share (optional)** field holds the host name of a network share already mounted on Windows, for example `share-host.example.net`. It only matters when working on a VM. When it is reachable, applications marked **SMB** read their images directly from the share instead of through the SSH tunnel, which is much faster on large datasets.

Click **Test** to check the host. The indicator shows **Not tested**, **Reachable** or **Unreachable**. VisionNexus considers the host reachable when its SMB port (445) answers. It then lists the share names it can enumerate under **Accessible shares**; the list can be empty when the server does not allow listing, which does not change the result. A small message confirms the test or explains the failure, for example that the host name or the VPN should be checked. The host is also tested automatically when the settings are loaded.

Leave the field empty if you are unsure: nothing breaks, applications simply use HTTP. In local mode the native path is always considered active, because files are read from the local disk.

## Saving settings and the status bar

Click **Save** to write the settings to your Windows profile. A bar above the fields reports the state: an orange bar reads **Fill in the fields below to be able to launch an app.**, a green bar reads **Settings complete -- apps can be launched.** The bar checks the four required fields (**User**, **Workspace**, **Computer_Vision_App root**, **Conda path**). Until it is green, tiles and compute resource switches stay disabled.

The language buttons and the **Target VM** drop-down save their own choice immediately; every other field needs **Save**. Settings are stored per Windows user and per machine, so they survive updates of the application. Their location is given in [Configuration](configuration.md#settings-file-and-log-folders).

## Compute resources

The **Compute resources** section sits under the diagram. It lists headless services, switched on when needed, that run on the target chosen in the settings (local or VM) and never open a tab. Each card shows the service icon and name, a chip with its target (**Local** or the VM name), a one-line description, its status and a switch.

Click the switch to turn a service on or off. It is disabled while the settings are incomplete and while the service is stopping. Start-up lines go to the **Launches** panel, under the service name, and **Stop** turns the service off. If the target you selected changes while a service runs, the card shows a notice that it still runs on the previous target; switch it off and on again to move it. Turning a service on does not open anything: other windows use it through VisionNexus. Closing VisionNexus stops every service.

The only compute resource today is the Docs Assistant; its card, states and messages are described in the [Docs Assistant user guide](../Docs_Assistant_App/docs/user-guide.md).

## The Documentation window

The **Documentation** button (or **Help > Documentation**) opens the Documentation window. It starts in the language of the launcher and has its own **EN** and **FR** buttons at the top right; changing the language reloads the pages in that language.

The window has two tabs. **Docs per app** shows the documentation: a list on the left with **VisionNexus** first, then every app, then **Docs Assistant**, each with its page count. Choose an entry, then a page in the row of tabs above the text (the README comes first). Links between pages of the same entry work inside the window; a link to a page of another app opens that page in the same window, and web links open in your browser. **Ask the docs** searches every page by question; it needs the Docs Assistant and is described in the [Docs Assistant user guide](../Docs_Assistant_App/docs/user-guide.md). Once the service runs, **Refresh index** next to its status picks up pages you edited without waiting for the next start.

The pages are read from the repository when VisionNexus finds it (local mode, through **Computer_Vision_App root**, or a repository next to the program), and from a copy embedded in the program otherwise. If an entry shows a message saying no documentation was found, check that **Computer_Vision_App root** is a local Windows path. Reopen the window or switch language to reload pages you edited. A bar under the title offers **Back** and **Forward** through the pages and searches you visited, described in the [Docs Assistant user guide](../Docs_Assistant_App/docs/user-guide.md).

## The interactive tutorial

The **Tutorial** button starts a guided tour of the launcher. The button glows orange until the tour has been started once on this computer. The tour dims the page, outlines each element in turn and explains it in a bubble with a progress bar, in four chapters: the settings field by field, the application grid, the top bar, and a real launch of Annotation that ends on the tab that appears.

Use **Next** and **Previous** or the right and left arrow keys to move, and **Quit**, the cross or **Esc** to leave at any time; the page stays usable during the tour. On the launch step, **Suivant** really clicks the **Annotation** tile if the settings are complete, so the application starts. The tour text and buttons follow the interface language. Whether the tour has been started or finished is saved in your settings, and you can relaunch it whenever you want. Annotation and Dataset Explorer have their own tours, started from an orange button on their home screen.
