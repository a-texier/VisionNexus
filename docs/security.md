---
app: suite
doc_type: security
audience: both
lang: en
title: Security
order: 55
tags: [security, session token, loopback, ssh tunnel, cookie, multi-user vm, ports]
sources: [_lib/session_auth.py, _lib/launcher_engine.py, launcher.py, desktop/src/sessionTokens.ts, desktop/src/sshLauncher.ts, desktop/src/main.ts, desktop/src/imageProtocol.ts, Orchestrator_App/backend/core/app_launcher.py, Orchestrator_App/backend/api/launcher_api.py]
---

# Security

## Who can reach a running application

A running application is two servers: a FastAPI backend, which reads and writes your files, and a Vite frontend, which serves the interface. Both listen on a TCP port of the machine that runs them, your Windows workstation in local mode or the Linux VM in VM mode. Three groups of people could try to reach those ports.

- **Anyone on the company network.** A server that listens on every network interface (`0.0.0.0`) answers on the machine's network address, for example `http://<VM IP>:<port>`. No account and no password are needed: a browser is enough.
- **Other accounts on the same VM.** The loopback address `127.0.0.1` is shared by every account of a Linux machine. Linux does not check which user opens a TCP connection, so any account logged on the VM can run `curl http://127.0.0.1:<port>` or open its own `ssh -L` tunnel to your port.
- **You**, through the VisionNexus tab or a browser on your workstation.

The backend runs under your Unix account. Whoever reaches it reads your files with your rights, so the suite closes the first two paths with three layers: servers bound to the loopback interface, SSH tunnels to carry the traffic, and a session token per application instance. The sections below describe each layer, and the section [What these protections do not cover](#what-these-protections-do-not-cover) lists the limits.

## Servers bound to the loopback interface

Every backend (uvicorn) and every frontend (Vite) of the suite listens on `127.0.0.1` only. Nothing listens on the machine's network address, so a request to `http://<VM IP>:<port>` from another computer is refused before it reaches any application.

This applies to every way of starting an application:

- the global launcher (`launcher.py`, `_lib/launcher_engine.py`), used by VisionNexus;
- the per-application launchers (`<App>/launcher.py`) and the `start.sh` scripts;
- the sub-applications started by the Orchestrator (`Orchestrator_App/backend/core/app_launcher.py`), which pass `--host 127.0.0.1` to Vite;
- a manual `npm run dev`, because every `vite.config.ts` reads the host from `CV_BIND_HOST` with `127.0.0.1` as default.

VisionNexus also refuses to send a link that points to the network address of the VM to the system browser. A link such as `http://<VM IP>:<port>` opened from inside a tab is rewritten to `http://127.0.0.1:<port>` and routed to the matching tab, because the only legitimate path to an application goes through the tunnel.

Binding to the loopback interface closes the network. It does not separate the accounts of a shared VM: this is the job of the session token described in [Session token of each application instance](#session-token-of-each-application-instance).

## SSH tunnels between the workstation and the VM

In VM mode the application runs on the VM and the interface shows on your workstation. VisionNexus connects the two with SSH, which authenticates you with your key and encrypts everything it carries.

1. VisionNexus runs `ssh <vm> python launcher.py --app <id> ...`. The launcher starts the backend and the frontend on the VM, under your account, bound to `127.0.0.1`.
2. Once the launcher has announced its ports, VisionNexus opens a second connection, `ssh -N -L <port>:localhost:<port> <vm>`, for the backend and the frontend ports.
3. On your workstation, `ssh.exe` listens on `127.0.0.1:<port>`, which only your workstation can reach. The tab loads `http://127.0.0.1:<frontend port>`.
4. Each request enters the tunnel on your workstation, crosses the network encrypted on port 22, and the SSH server of the VM hands it to `localhost:<port>` on the VM.

The tunnel protects the path between your workstation and the VM: nobody on the network can read or alter the traffic, and nobody can open a tunnel without an account and a key on the VM. It does not protect the end of the path. On the VM, the application listens on the shared loopback address, where any other account of the VM can connect. The same holds for the port forwarding of an IDE over SSH: it protects the transport, not the application it forwards to.

## Session token of each application instance

Each time an application starts, its launcher draws a random secret of 43 characters, the session token. The backend rejects every request that does not carry it. Another account of the VM that reaches your port gets `401 Unauthorized` and no file is opened.

The token belongs to one instance: a new launch always draws a new token, and the token becomes useless when the application stops. It is not derived from your user name, the port, the workspace or any password.

The protection is implemented once, in `_lib/session_auth.py`, and installed by every backend of the suite (Annotation, Dataset Explorer, Training, Inference, DVC, MLflow, Optuna, Orchestrator and the Docs Assistant) right after its CORS configuration. The check is a constant-time comparison of two strings held in memory. It costs a few microseconds per request, without disk access, and does not change the speed of image loading, which is dominated by the network and the storage.

### How the token travels from the launcher to the tab

1. The launcher generates the token with `secrets.token_urlsafe(32)` and passes it to the backend in the environment variable `CV_SESSION_TOKEN`. It never goes on a command line, which every account of the machine can read with `ps`; the environment of a process is readable by its owner only.
2. Before announcing its ports, the launcher prints the line `[token] <token>` once. In VM mode this output reaches VisionNexus through your SSH connection, so it is encrypted.
3. VisionNexus keeps the token in memory and replaces the line with `[auth] jeton de session recu (masque)` in the launch log and in the log file. The token is never written to disk on the workstation.
4. VisionNexus adds the token as the `X-VN-Token` header to every request a tab sends to that instance, on its frontend port and on its backend port, including images and WebSocket connections. It also sets the cookie `vn_<backend port>` in the tabs' browser session.

The frontends of the applications need no change: the header is added by VisionNexus, the cookie is sent by the browser engine itself, and the Vite proxy forwards both to the backend.

### What the backend checks on each request

The middleware accepts a request when its `X-VN-Token` header equals the token, or when its cookie `vn_<backend port>` does. The cookie has one name per instance because a browser does not separate cookies by port: without the port in the name, two applications opened in the same browser would overwrite each other's token.

A few paths stay public because they return no data and must answer before the token is known:

- `/health` and `/api/health`, polled by VisionNexus and by the Orchestrator to know when a backend is ready;
- `/api/_auth/bootstrap`, the one-time link described in [Opening an application in an external browser](#opening-an-application-in-an-external-browser);
- the CORS preflight requests (`OPTIONS`), which a browser always sends without credentials.

Any other HTTP request without a valid token receives `401` with the message "Jeton de session manquant ou invalide.". A WebSocket connection without a valid token is closed before it is accepted.

### Calls between applications of the same user

Some backends call other backends: the Orchestrator drives its sub-applications, and an application sometimes calls its own API. These calls carry the token without any code change in the applications.

At startup, each protected backend writes its token to `~/.visionnexus/tokens/<host name>_<backend port>`, in a folder with mode `700` and a file with mode `600`: only its owner can read it. The host name in the file name keeps two VMs that share the same home directory apart. Every outgoing `httpx` call of a backend is then checked: when it targets `127.0.0.1` or `localhost` on a port that has a token file, the header `X-VN-Token` is added. A call to any other host is never modified.

The Orchestrator draws a separate token for each sub-application it starts and removes its own token from their environment. Its route `GET /api/apps`, protected by its own token, returns the `session_token` of each running sub-application, read from the same token files. VisionNexus uses it to open a sub-application in a tab. The token is kept in the main process and is not passed to the catalog page.

DVC and MLflow call the Orchestrator backend through their own Vite proxy (`/orchestrator-api`). The header added by VisionNexus is then the token of DVC or MLflow, not the Orchestrator's; the request is accepted through the Orchestrator's cookie `vn_<port>`, which VisionNexus sets when the Orchestrator starts.

## Opening an application in an external browser

An external browser such as Edge or Chrome does not share the session of VisionNexus and has no token: the plain address of an application shows the interface without any data, because every API call returns `401`. VisionNexus therefore opens it with a one-time link.

1. Right-click a tab and choose **Open in browser**, or **Copy URL** to paste the address yourself.
2. VisionNexus asks the backend for a code with `POST /api/_auth/bootstrap-code`, authenticated by the token. The code is valid for 120 seconds and for one use.
3. The browser opens `http://127.0.0.1:<port>/api/_auth/bootstrap?code=<code>&next=<page>`. The backend checks the code and deletes it, sets the cookie `vn_<backend port>` with the options `HttpOnly` and `SameSite=Strict`, then redirects to the requested page.

The URL left in the browser history contains no token, and the code in it is already spent. The cookie cannot be read by the JavaScript of the page (`HttpOnly`) and is not sent by requests coming from other websites (`SameSite=Strict`). The `next` parameter only accepts a path of the same site, so the link cannot redirect elsewhere.

When an application is started from a terminal without VisionNexus, the launcher prints a line `[auth] navigateur ... : http://127.0.0.1:<port>/api/_auth/bootstrap?code=<code>`. This first code is valid for 30 minutes and for one use; open it in the browser of the machine that holds the tunnel or runs the application.

The external browser reaches the application through the same `127.0.0.1` address, so it only works on the workstation that holds the SSH tunnel, or on the machine that runs the application in local mode.

## Configuration of the protections

Two environment variables, read by the launchers when an application starts, change the protections. Both are meant for exceptional cases.

| Variable | Default | Effect |
|---|---|---|
| `CV_BIND_HOST` | `127.0.0.1` | Address the backends and frontends listen on. `0.0.0.0` exposes the application to the whole network again. |
| `CV_AUTH` | `1` | `0` disables the session token: no token is drawn and the backends accept every request. |

Keep both defaults on a shared VM. With `CV_AUTH=0`, the launch log of VisionNexus shows `[auth] aucun jeton annonce : backend sans protection`, and any account of the VM can use your backend again.

A backend started by hand with `uvicorn`, without a launcher, has no token in its environment and keeps the unprotected behavior. It still listens on the address given to uvicorn: pass `--host 127.0.0.1`. A backend that finds `CV_SESSION_TOKEN` in its environment but cannot import `_lib/session_auth.py`, for example an application copied without the rest of the repository, refuses to start rather than run without protection.

## Stopping processes and cleaning up the VM

A process left behind after a crash keeps its port and, with it, its token file and its data access. The **Ports** panel of VisionNexus stops them; the [User guide](user-guide.md) describes its tables.

- **Kill** on a row stops the process that holds the port. On the VM, the process id comes from `ss`, the whole process group is stopped (`SIGTERM`, then `SIGKILL`), and the port is checked afterwards. When the port is still listening, the panel shows the reason at the top instead of doing nothing silently. A process of another account cannot be killed: Linux refuses it, and the panel reports it.
- **Stop all** stops every application VisionNexus started, then kills the known ports, locally and on the VM, in a single SSH session. On the VM it also uses the shared registry `.run/.instances.json`, but only for the entries of your user name.
- **Clean up VM** stops, in one SSH session, your own `node` and `python` processes whose working directory is inside the `Computer_Vision_App` root and whose command line is a server of the suite (`vite`, `uvicorn`, `launcher.py`, `esbuild`, multiprocessing workers). An IDE server, a notebook or your other scripts are not touched, even when they run in the same folder.

## What these protections do not cover

- **Root and administrators of the VM.** They can read any process memory, environment or file, token files included. The protections separate ordinary accounts, not administrators.
- **Your own Unix account.** Every process that runs under your account can read your token files, by design: it is what lets the Orchestrator call its sub-applications. A malicious program running as you is out of scope.
- **The Vite frontend server.** It serves the interface code, the same as in the repository, without checking the token. The data stays behind the backend, which the proxy of Vite only reaches with a valid token.
- **Other services on the VM.** A tracking server or any tool that is not a backend of the suite, for example an MLflow tracking server started separately, is not protected by this token.
- **Your workstation.** The tunnel end listens on `127.0.0.1` of your workstation. In local mode on a shared Windows machine, other sessions of that machine can reach it; the token still protects the backends.
- **Denial of service.** An account of the VM that reaches your port cannot read anything, but it can still send requests that are rejected.

## Checking the protections after an update

These checks confirm the three layers on a VM after an update or a change of configuration. Run them while at least one application is open.

1. On the VM, list the listening ports of the suite. Every address must be `127.0.0.1`, never `0.0.0.0` or the VM address.

   ```bash
   ss -tlnp | grep -E 'uvicorn|node|python'
   ```

2. From your workstation, the network address of the VM must refuse the connection: `curl http://<VM IP>:<backend port>/health` fails.
3. On the VM, a request without token must be rejected, and the health probe must answer:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<backend port>/api/settings
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:<backend port>/health
   ```

   The first command prints `401`, the second `200`.
4. The token files are private: `ls -la ~/.visionnexus/tokens` shows `drwx------` for the folder and `-rw-------` for each file.
5. In VisionNexus, the launch log shows `[auth] jeton de session recu (masque)` and never the token itself. **Open in browser** opens the application with its data.
