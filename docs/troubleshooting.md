---
app: suite
doc_type: troubleshooting
audience: both
lang: en
title: Troubleshooting
order: 50
tags: [launch, ssh, tunnel, ports, settings, native path, documentation window, orphan processes]
sources: [desktop/src/main.ts, desktop/src/sshLauncher.ts, desktop/src/tunnelClassify.ts, desktop/src/services.ts, desktop/ui/catalog.html, desktop/ui/i18n.js, _lib/launcher_engine.py, launcher.py]
---

# Troubleshooting

Messages quoted below are shown as the launcher prints them, in French for the most part. Open the **Launches** panel, or the log file behind the **Logs** button, before anything else: the cause is almost always written there.

## All tiles are greyed out and cannot be clicked

**Symptom**: the orange bar reads **Fill in the fields below to be able to launch an app.** and no tile reacts. The switch of the Docs Assistant is disabled too, with the tooltip **Fill in Settings before switching a resource on.**

**Cause**: at least one of the four required settings is empty: **User**, **Workspace**, **Computer_Vision_App root** or **Conda path**. **Conda path** is the one people forget, because its label does not say it is required.

**Solution**: fill in the four fields and click **Save**. The bar turns green. If a launch was attempted anyway, the message reads `Renseigne Utilisateur / Workspace / Racine / Conda dans Parametres avant de lancer une app.`

## A warning says the user identifier is not valid

**Symptom**: clicking a tile opens a dialog titled **Identifiant utilisateur non valable**, and the launch does not start.

**Cause**: the **User** value is one of `unknown`, `user`, `default`, `none`, `null`, `admin` or `test`. These generic names would make several people share one workspace and one set of databases.

**Solution**: enter your real login in **User**, click **Save**, and launch again.

## The launcher never announces its ports

**Symptom**: the tile turns red and the log ends with `launcher.py n'a jamais annonce ses ports (verifie la connexion/les identifiants).`, sometimes preceded by `[launcher.py] termine prematurement (code N) avant d'annoncer ses ports`.

**Cause**: `launcher.py` did not start or stopped before printing its `[config]` lines. Typical reasons: the SSH connection failed or asks for a password, **Computer_Vision_App root** does not exist on the target, `python` is not found by the remote shell, or the launcher raised an error visible just above in the log. Nothing is announced within 60 seconds otherwise.

**Solution**: read the lines above the error. In VM mode, run `ssh <vm>` in a terminal and check it needs no password. Check that **Computer_Vision_App root** is a path of the target (Windows path in local mode, Linux path in VM mode) and that `python launcher.py --help` works there.

## A local port is already in use and the tunnel is refused

**Symptom**: the log says `Port(s) local/locaux deja occupe(s) sur ce poste : <ports>` and the launch stops before opening the tunnel.

**Cause**: the VM picked port numbers that are already taken on your Windows machine. The usual culprit is an orphan `ssh.exe` tunnel from a previous session, or another instance of the launcher, or any Windows program listening on that port. The tunnel must reuse the same numbers, so it cannot start.

**Solution**: open the **Ports** panel, find the port in the **Local (this machine)** table, and click **Kill** if it is a leftover; or end the `ssh.exe` processes in the Windows task manager. Then click the tile again.

## The SSH tunnel fails with a network, key or host error

**Symptom**: the log shows `Tunnel SSH en echec : <ssh message>` or `Tunnel SSH termine prematurement (code N) : forward non etabli`, and the application does not open.

**Cause**: the second SSH connection, the tunnel, could not be established. The launcher treats these ssh messages as fatal: `address already in use`, `cannot listen`, `bind:`, `permission denied`, `could not resolve`, `connection refused`, `connection closed`, `connection timed out` and `host key verification failed`. A code 255 is an ssh error (name resolution, authentication, refused forward); another code comes from a `ProxyCommand` or `ProxyJump` in your ssh configuration, from a wrapper around `ssh`, or from a process killed from outside. The log also prints the ssh version in use, since Windows can have several.

**Solution**: apply the fix that matches the message: correct the VM name, load your key in the agent, accept the host key once with a manual `ssh <vm>`, or restore the VPN. Messages such as `channel N: open failed: connect failed` are normal while the backend is still loading and are not errors.

## The launch times out waiting for the server or the backend

**Symptom**: the log ends with `[timeout] le serveur ne repond pas apres 60s.` or `[timeout] le backend ne repond pas apres 120s.`, and the tile turns red.

**Cause**: the frontend dev server did not answer within 60 seconds (dependencies not installed or not built, a crashed Vite), or the backend did not answer `/health` within 120 seconds (model loading on a slow disk or GPU, a Python import error).

**Solution**: read the launcher lines above for a Python or Node error. Make sure the frontend dependencies are installed (`python rebuild_all.py`). If the backend is only slow, launch again once the first start has warmed the disk cache. **Stop** cancels a launch that is still waiting.

## A tab stays blank, shows an error page or shows another application

**Symptom**: an application tab is empty, displays a Chromium error page, or shows something that is not the application you launched. The log may print `[renderer] chargement echoue ...` and `nouvelle tentative n/5`.

**Cause**: the local port answers but not through this launch's tunnel, for example an orphan tunnel from a previous session still holds it; or the dev server restarted and the page failed to load. A tab retries up to five times, with a growing delay of 1.5 to 7.5 seconds, before giving up. When the tunnel of a launch reports a fatal error, the launcher refuses to open the tab rather than show another server.

**Solution**: close the tab, use **Ports** to kill the leftover local `ssh.exe` or process on that port, and launch again. Right-click the tab and choose **Copy URL** or **Open in browser** to test the address outside VisionNexus.

## Applications start on the VM although local mode was chosen

**Symptom**: after clicking **Save**, the **Target VM** drop-down shows a VM again and launches go over SSH.

**Cause**: **Target VM** does not read **(local, no VM)**. **Save** keeps the current selection, but if the selected VM was removed from **Known VM(s)**, the first VM of the list is selected instead.

**Solution**: choose **(local, no VM)** in **Target VM**. The selection is saved as soon as you change it. Empty **Known VM(s)** when you do not need VM mode.

## The native path stays on HTTP


**Cause**: the tag tooltip gives the reason: `Aucun hote de partage reseau configure (Parametres)` when the field is empty; `Hote "<host>" injoignable -- repli HTTP` when the last test failed, meaning the SMB port 445 of the host did not answer within 3 seconds; or the share does not contain the path of the image, so each image falls back individually.

**Solution**: fill in **Native network share (optional)**, click **Test** and fix the host name or the VPN until **Reachable** appears, then save and launch the application again. If the host answers but the tag stays amber, the share does not expose the folder that holds your images: check the mapping on the file server.

## The Documentation window shows no pages

**Symptom**: an entry displays `Pas de documentation trouvee pour cette entree depuis ce poste...` (or its English version).

**Cause**: VisionNexus found neither the repository nor its embedded copy of the pages. In VM mode the **Computer_Vision_App root** field holds a Linux path, which the Windows program cannot read, so it looks for the repository next to itself and then falls back on the copy embedded in the program.

**Solution**: in local mode, set **Computer_Vision_App root** to the local Windows path of the repository. In VM mode, keep a copy of the repository next to the program, or use a build that embeds the documentation. Reopen the window afterwards.

## The Docs Assistant does not turn on

**Symptom**: the card of the Docs Assistant turns red with **Error** and a message, or stays on **Starting...**.

**Cause**: the start-up messages come from the launcher and depend on the phase. `Le service ne repond pas apres 90 s.`: the backend did not answer `/health` in time. `Le service s'est arrete (code N). Voir le journal du lancement.`: the process exited. `launcher.py n'a jamais annonce son port ...`, `Port local deja occupe sur ce poste : <port>` and tunnel messages have the same causes as for an application. `Arret en cours, reessaie dans un instant.` means the previous stop is not finished.

**Solution**: read the **Launches** panel under **Docs Assistant**, fix the cause as for an application, and switch the service on again. Problems with the model or the index once the service runs are covered in the [Docs Assistant troubleshooting](../Docs_Assistant_App/docs/troubleshooting.md).

## The Ports panel marks processes as "to check" or shows no VM table

**Symptom**: many rows carry the **to check** badge, a row shows `? (droits insuffisants sur la VM)` as process, or the **VM** table is empty or missing.

**Cause**: **to check** only means the port is not tied to an application VisionNexus drives or to the shared registry: it may be a leftover, or a program unrelated to the suite. Insufficient rights means the VM did not let `ss` name the owning process. An empty VM table means the SSH scan failed: it runs without any prompt and gives up after 5 seconds.

**Solution**: only kill rows you recognize; on a shared VM look at the **User** column first. For the VM table, check that `ssh <vm>` works without a password from a terminal.

## An Orchestrator sub-app refuses to open

**Symptom**: choosing **Ouvrir (onglet)** shows `Orchestrator n'est plus lance.`, `<app> n'est pas prete (statut : ...)` or `Le frontend de <app> n'a pas repondu (port N)...`.

**Cause**: the Orchestrator tab was closed, the sub-application is not in the running state yet, or its frontend dev server is still starting. In VM mode, the same busy-port message as for a normal launch can appear when its local port is taken.

**Solution**: keep the Orchestrator tab open, launch the sub-application with **Lancer** from the same menu and wait for its counter to increase, then open it again a few seconds later.

## The launcher stops with a port or lock error

**Symptom**: the log shows `Cannot acquire port lock (...). Remove the file if no launcher is starting.` or `No free port found between N and M.`

**Cause**: the lock file `.run/.port_lock` was left by a launcher that crashed while allocating ports, or all 200 ports after the base port are busy.

**Solution**: for the lock, delete the file named in the message once you are sure no launcher is starting. For the ports, free some with the **Ports** panel.

## The wrong Python environment is used

**Symptom**: the log prints `[warning] --conda-path '<path>' invalide (python introuvable), repli sur la recherche par nom d'env 'IA_env'` or `[warning] Conda env 'IA_env' not found, using sys.executable`, then imports fail.

**Cause**: **Conda path** does not lead to a Python interpreter on the target, and the fallback search did not find an environment named `IA_env`.

**Solution**: set **Conda path** to the environment folder (the one that holds `bin/python` on Linux or `python.exe` on Windows), its `bin/activate` script, or the interpreter itself, as seen by the target machine.

## VisionNexus does not open a second window

**Symptom**: starting the program again does nothing visible.

**Cause**: only one launcher can run at a time. The second start ends immediately and brings the existing window to the front. This prevents two launchers from fighting for the same ports.

**Solution**: use the existing window. If it is not visible, look in the taskbar; if the program seems frozen, end its process in the task manager and start it again.

## Processes remain on the VM after closing an application

**Symptom**: after closing a tab or the window, the **Ports** panel still lists the application ports on the VM.

**Cause**: closing ends the local `ssh` processes. The application processes on the VM stop when their launcher exits cleanly, but a dropped connection or a crash can leave them running.

**Solution**: click **Kill** on their rows in the **VM** table, or use **Stop all**, which also kills the known ports on the VM and the registry entries of your user name. If ports remain, **Clean up VM** stops all your suite servers on the VM at once. These actions only reach your own processes: a process of another account is reported as a failure at the top of the panel.

## An application opens without data and its requests return 401

**Symptom**: a tab or a browser shows the interface of an application but no project, no image and no list; the browser console or the backend log shows `401` answers with the message "Jeton de session manquant ou invalide.".

**Cause**: every backend requires the session token of its instance. The page was opened without it: the plain address pasted in a browser, a bookmark, a link kept from an earlier session, or a backend restarted with a new token while the page stayed open.

**Solution**: in VisionNexus, right-click the tab and choose **Open in browser** or **Copy URL**: both give a fresh one-time link. For a tab that stays empty after its backend restarted, close it and launch the application again. Outside VisionNexus, use the `[auth] navigateur` link printed by the launcher at start-up. [Security](security.md) describes the token and the link.

## A browser link says it is invalid or already used

**Symptom**: opening a link copied from VisionNexus shows the message "Lien de connexion invalide ou deja utilise." instead of the application.

**Cause**: a one-time link works once and for 120 seconds; the link printed by a launcher in a terminal works once and for 30 minutes. A second use, an expired link, or a link from before the application restarted is refused.

**Solution**: right-click the tab again and choose **Copy URL** or **Open in browser** to get a new link, and open it right away in a browser of the same computer. A browser that already opened the application once keeps its session cookie until the application stops, so it does not need a new link in the meantime.

