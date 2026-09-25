# ============================================================
# core/app_launcher.py
# Lance les sous-apps CV depuis l'Orchestrator.
# Lit la config depuis APP_REGISTRY de launcher_engine.
# ============================================================

import json
import os
import subprocess
import sys
import time
import socket
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import WORKSPACE, BACKEND_PORT, FRONTEND_PORT

# ── Paths ─────────────────────────────────────────────────────────────────────
_ORCH_BACKEND = Path(__file__).parent.parent           # Orchestrator_App/backend/
_CV_ROOT      = _ORCH_BACKEND.parent.parent            # Computer_Vision_App/
# (l'orchestrateur lance les sous-apps directement via uvicorn, cf. _APP_CONFIG —
#  il n'utilise PAS le launcher global ; l'ancienne réf Launchers/ est supprimée.)

STATE_FILE = WORKSPACE / "launcher_state.json"

# Registre d'instances + verrou d'allocation de ports PARTAGES avec tous les
# launcher.py du repo (Computer_Vision_App/.run/). L'orchestrateur allouait ses
# ports dans son coin (simple connect_ex + son propre launcher_state.json) : sur
# une VM multi-utilisateur, deux orchestrateurs pouvaient viser le meme port au
# meme instant, et rien ne l'empechait de marcher sur un port deja reserve par
# un lancement standalone pas encore a l'ecoute. On passe par les memes
# primitives que le reste du repo -- verrou fichier tenu pendant TOUTE
# l'allocation, ports deja reserves lus dans .instances.json, et is_port_free()
# qui fait un vrai bind (un connect_ex rate les listeners lies a une interface
# precise).
if str(_CV_ROOT) not in sys.path:
    sys.path.insert(0, str(_CV_ROOT))
try:
    from _lib.launcher_engine import (
        _LOCK_FILE as _SHARED_LOCK_FILE,
        _acquire_port_lock,
        _release_port_lock,
        find_free_port as _shared_find_free_port,
        is_port_free as _shared_is_port_free,
        load_instances as _shared_load_instances,
        register_instance as _shared_register_instance,
        unregister_instance as _shared_unregister_instance,
    )
    _SHARED_REGISTRY = True
except Exception:   # zip ancien sans _lib : on garde l'ancien comportement
    _SHARED_REGISTRY = False
try:
    from _lib import session_auth
except ImportError:
    session_auth = None

# ── Fallback de compatibilité ─────────────────────────────────────────────────
# Le registre effectif est reconstruit plus bas depuis _lib.launcher_engine.
# Ce fallback permet encore de lancer un zip ancien qui n'embarquerait pas _lib.
_APP_CONFIG = {
    "annotation": {
        "app_root":         str(_CV_ROOT / "Annotation_App"),
        "backend_module":   "backend.main:app",
        "workspace_env":    "ANNOTATION_WORKSPACE",
        "user_env":         "ANNOTATION_USER",
        "frontend_port_env": "ANNOTATION_FRONTEND_PORT",
        "base_backend_port": 8000,
        "base_frontend_port": 5173,
        "api_url_env":      "ANNOTATION_APP_URL",
        "frontend_url_env": "ANNOTATION_APP_FRONTEND_URL",
        "label":            "Annotation_App",
    },
    "explorer": {
        "app_root":         str(_CV_ROOT / "Dataset_Explorer_App"),
        "backend_module":   "backend.main:app",
        "workspace_env":    "EXPLORER_WORKSPACE",
        "user_env":         "EXPLORER_USER",
        "frontend_port_env": "EXPLORER_FRONTEND_PORT",
        "base_backend_port": 8001,
        "base_frontend_port": 5174,
        "api_url_env":      "DATASET_EXPLORER_APP_URL",
        "frontend_url_env": "DATASET_EXPLORER_APP_FRONTEND_URL",
        "label":            "Dataset_Explorer_App",
    },
    "dvc": {
        "app_root":         str(_CV_ROOT / "DVC_App"),
        "backend_module":   "backend.main:app",
        "workspace_env":    "DVC_APP_WORKSPACE",
        "user_env":         "DVC_APP_USER",
        "frontend_port_env": "DVC_APP_FRONTEND_PORT",
        "base_backend_port": 8061,
        "base_frontend_port": 3002,
        "api_url_env":      "DVC_APP_URL",
        "frontend_url_env": "DVC_APP_FRONTEND_URL",
        "label":            "DVC_App",
    },
    "mlflow": {
        "app_root":         str(_CV_ROOT / "MLflow_App"),
        "backend_module":   "backend.main:app",
        "workspace_env":    "MLFLOW_APP_WORKSPACE",
        "user_env":         "MLFLOW_APP_USER",
        "frontend_port_env": "MLFLOW_APP_FRONTEND_PORT",
        "base_backend_port": 8062,
        "base_frontend_port": 3001,
        "api_url_env":      "MLFLOW_APP_URL",
        "frontend_url_env": "MLFLOW_APP_FRONTEND_URL",
        "label":            "MLflow_App",
    },
    "optuna": {
        "app_root":         str(_CV_ROOT / "Optuna_App"),
        "backend_module":   "backend.main:app",
        "workspace_env":    "OPTUNA_APP_WORKSPACE",
        "user_env":         "OPTUNA_APP_USER",
        "frontend_port_env": "OPTUNA_APP_FRONTEND_PORT",
        "base_backend_port": 8063,
        "base_frontend_port": 3003,
        "api_url_env":      "OPTUNA_APP_URL",
        "frontend_url_env": "OPTUNA_APP_FRONTEND_URL",
        "label":            "Optuna_App",
    },
    "training": {
        "app_root":          str(_CV_ROOT / "Training_App"),
        "backend_module":    "backend.main:app",
        "workspace_env":     "TRAINING_APP_WORKSPACE",
        "user_env":          "TRAINING_APP_USER",
        "frontend_port_env": "TRAINING_APP_FRONTEND_PORT",
        "base_backend_port": 8064,
        "base_frontend_port": 5176,
        "api_url_env":       "TRAINING_APP_URL",
        "frontend_url_env":  "TRAINING_APP_FRONTEND_URL",
        "label":             "Training_App",
    },
    "inference": {
        "app_root":          str(_CV_ROOT / "Inference_App"),
        "backend_module":    "backend.main:app",
        "workspace_env":     "INFERENCE_APP_WORKSPACE",
        "user_env":          "INFERENCE_APP_USER",
        "frontend_port_env": "INFERENCE_APP_FRONTEND_PORT",
        "base_backend_port": 8065,
        "base_frontend_port": 5177,
        "api_url_env":       "INFERENCE_APP_URL",
        "frontend_url_env":  "INFERENCE_APP_FRONTEND_URL",
        "label":             "Inference_App",
    },
}

def _canonical_app_config() -> dict:
    """Adapte le registre central au format attendu par l'Orchestrator."""
    try:
        if str(_CV_ROOT) not in sys.path:
            sys.path.insert(0, str(_CV_ROOT))
        from _lib.launcher_engine import APP_REGISTRY
        ids = ("annotation", "explorer", "dvc", "mlflow", "optuna", "training", "inference")
        api_env = {
            "annotation": "ANNOTATION_APP_URL", "explorer": "DATASET_EXPLORER_APP_URL",
            "dvc": "DVC_APP_URL", "mlflow": "MLFLOW_APP_URL",
            "optuna": "OPTUNA_APP_URL", "training": "TRAINING_APP_URL",
            "inference": "INFERENCE_APP_URL",
        }
        frontend_env = {k: v.replace("_URL", "_FRONTEND_URL") for k, v in api_env.items()}
        return {
            app_id: {
                "app_root": str(APP_REGISTRY[app_id]["app_root"]),
                "backend_module": APP_REGISTRY[app_id]["backend_module"],
                "workspace_env": APP_REGISTRY[app_id]["workspace_env"],
                "user_env": APP_REGISTRY[app_id]["user_env"],
                "frontend_port_env": APP_REGISTRY[app_id]["frontend_port_env"],
                "base_backend_port": APP_REGISTRY[app_id]["base_backend_port"],
                "base_frontend_port": APP_REGISTRY[app_id]["base_frontend_port"],
                "api_url_env": api_env[app_id],
                "frontend_url_env": frontend_env[app_id],
                "label": APP_REGISTRY[app_id]["label"],
            }
            for app_id in ids
        }
    except Exception:
        return _APP_CONFIG


_APP_CONFIG = _canonical_app_config()
AVAILABLE_APP_IDS = list(_APP_CONFIG.keys())


@dataclass
class AppSession:
    app_id: str
    label: str
    backend_port: int
    frontend_port: int
    workspace: str
    backend_pid: Optional[int]
    frontend_pid: Optional[int]
    backend_url: str
    frontend_url: str
    status: str        # starting|running|stopped|error
    launched_at: str
    # Necessaire pour unregister_instance() a l'arret : la cle du registre
    # partage est "<app_id>:<user>". Default pour les launcher_state.json ecrits
    # avant l'ajout de ce champ.
    user: str = ""
    # Fichiers de log des sous-process (stdout+stderr redirige). Exposes via
    # /api/apps pour que VisionNexus puisse les tailer dans l'onglet natif de la
    # sous-app (sinon aucun log cote VisionNexus : l'app "vit" via l'orchestrator).
    # Defaults None : compat avec les anciennes entrees launcher_state.json.
    backend_log: Optional[str] = None
    frontend_log: Optional[str] = None
    failure_reason: Optional[str] = None
    backend_exit_code: Optional[int] = None
    frontend_exit_code: Optional[int] = None


_sessions: dict[str, AppSession] = {}
_processes: dict[str, tuple[subprocess.Popen, subprocess.Popen]] = {}
_loaded = False


# ── Port helpers ──────────────────────────────────────────────────────────────

def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _local_claimed_ports() -> set[int]:
    """Ports reserves par les sessions vivantes de CET orchestrateur.

    Les sessions STOPPED ne reservent PAS leur port : sinon un redemarrage propre
    repart sur des ports decales (8002/8065... au lieu de 8000/8064) car l'ancien
    launcher_state.json garde des sessions mortes aux ports par defaut.
    """
    _load_state()
    live = [x for x in _sessions.values() if x.status != "stopped"]
    claimed = {x.backend_port for x in live}
    claimed.update(x.frontend_port for x in live if x.frontend_port)
    return claimed


def _allocate_ports(app_id: str, user: str, workspace: str, cfg: dict) -> tuple[int, int]:
    """Reserve (backend, frontend) sous le verrou de ports PARTAGE du repo.

    Le verrou est tenu de la recherche jusqu'a l'enregistrement dans
    .instances.json : entre les deux, aucun autre launcher (standalone, autre
    orchestrateur, autre utilisateur) ne peut choisir les memes ports. C'est ce
    qui manquait -- l'ancien code sondait puis lancait plus tard, laissant une
    fenetre de course, et ignorait completement les reservations des autres.
    """
    if not _SHARED_REGISTRY:
        claimed = _local_claimed_ports()
        bp = _fallback_find_free_port(cfg["base_backend_port"], claimed)
        claimed.add(bp)
        fp = _fallback_find_free_port(cfg["base_frontend_port"], claimed)
        return bp, fp

    fd = _acquire_port_lock(_SHARED_LOCK_FILE)
    try:
        claimed = _local_claimed_ports()
        for entry in _shared_load_instances():
            if entry.get("key") == f"{app_id}:{user}":
                continue        # notre propre entree d'un lancement precedent
            for key in ("backend_port", "frontend_port"):
                port = entry.get(key)
                if port:
                    claimed.add(port)
        bp = _shared_find_free_port(cfg["base_backend_port"], claimed)
        claimed.add(bp)
        fp = _shared_find_free_port(cfg["base_frontend_port"], claimed)
        _shared_register_instance(app_id, user, bp, fp, workspace)
        return bp, fp
    finally:
        _release_port_lock(fd, _SHARED_LOCK_FILE)


def _fallback_find_free_port(start: int, claimed: set[int]) -> int:
    """Repli sans _lib (zip ancien) : ancien comportement, sonde simple."""
    for p in range(start, start + 100):
        if p not in claimed and _is_port_free(p):
            return p
    raise RuntimeError(f"No free port near {start}")


# ── Persistence ───────────────────────────────────────────────────────────────

def _save_state() -> None:
    STATE_FILE.write_text(
        json.dumps({k: asdict(v) for k, v in _sessions.items()}, indent=2),
        encoding="utf-8",
    )


def _load_state() -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True
    if not STATE_FILE.exists():
        return
    try:
        raw = json.loads(STATE_FILE.read_text("utf-8"))
        for app_id, d in raw.items():
            if app_id == "visu":
                app_id = "explorer"
                d["app_id"] = app_id
                d["label"] = "Dataset_Explorer_App"
                d["workspace"] = d.get("workspace", "").replace("visu_", "explorer_")
            session = AppSession(**d)
            # Normalise les anciennes sessions persistées avec localhost (piège IPv6)
            session.backend_url = session.backend_url.replace(
                "http://localhost:", "http://127.0.0.1:")
            # Mark as stopped if process is gone
            if session.backend_pid and not _pid_alive(session.backend_pid):
                session.status = "stopped"
                session.backend_pid = None
                session.frontend_pid = None
            _sessions[app_id] = session
    except Exception:
        pass


def _pid_alive(pid: int) -> bool:
    try:
        if sys.platform == "win32":
            import ctypes
            h = ctypes.windll.kernel32.OpenProcess(0x400, False, pid)
            if h:
                ctypes.windll.kernel32.CloseHandle(h)
                return True
            return False
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _log_tail(path: Optional[str], lines: int = 12) -> str:
    if not path:
        return ""
    try:
        content = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(content[-lines:])
    except OSError:
        return ""


# ── Public API ────────────────────────────────────────────────────────────────

def launch_app(
    app_id: str,
    base_workspace: str,
    user: str,
    conda_env: str = "IA_env",
    annotation_imports: str = None,
) -> AppSession:
    """Spawn backend + frontend for a sub-app."""
    _load_state()

    cfg = _APP_CONFIG.get(app_id)
    if not cfg:
        raise ValueError(f"Unknown app_id: {app_id}")

    ws_path = Path(base_workspace) / f"{app_id}_{user}"
    if app_id == "explorer":
        legacy_ws = Path(base_workspace) / f"visu_{user}"
        if legacy_ws.exists() and not ws_path.exists():
            legacy_ws.rename(ws_path)
        legacy_db = ws_path / ("visu" + "_bdd.db")
        current_db = ws_path / "dataset_explorer.db"
        if legacy_db.exists() and not current_db.exists():
            legacy_db.rename(current_db)
    ws = str(ws_path)
    ws_path.mkdir(parents=True, exist_ok=True)

    # Apres la resolution du workspace : l'enregistrement dans le registre
    # partage a besoin du chemin definitif.
    bp, fp = _allocate_ports(app_id, user, ws, cfg)

    env = os.environ.copy()
    env[cfg["workspace_env"]] = ws
    env[cfg["user_env"]] = user
    env["BACKEND_PORT"] = str(bp)
    env["LAUNCHED_BY_ORCHESTRATOR"] = "1"
    env[cfg["frontend_port_env"]] = str(fp)
    env["VITE_BACKEND_PORT"] = str(bp)
    # Cache de pre-bundling Vite propre a CETTE instance (cf. cacheDir dans les
    # vite.config.ts). Sans ca, l'instance lancee ici et celle lancee en direct
    # par VisionNexus partagent node_modules/.vite : la seconde a demarrer
    # regenere le browserHash des deps et l'onglet deja ouvert sur la premiere
    # se retrouve avec des 504 "Outdated Optimize Dep" (ecran noir de l'overlay
    # Vite au lieu de l'app).
    env["VITE_CACHE_DIR"] = str(ws_path / ".vite_cache")
    # Les vues Lineage DVC/MLflow consomment le lineage canonique de CETTE
    # instance Orchestrator (ports dynamiques possibles, multi-utilisateur).
    env["VITE_ORCHESTRATOR_BACKEND_PORT"] = str(BACKEND_PORT)
    env["VITE_ORCHESTRATOR_FRONTEND_PORT"] = str(FRONTEND_PORT)
    # Chaque sous-app a son propre jeton de session. Pas d'annonce ici : le
    # sous-backend le publie dans le fichier prive de l'utilisateur, d'ou
    # /api/apps le relit pour VisionNexus et d'ou nos appels httpx le prennent.
    # Retirer d'abord le jeton de l'Orchestrator lui-meme, herite de os.environ.
    env.pop("CV_SESSION_TOKEN", None)
    env.pop("CV_BOOTSTRAP_CODE", None)
    if session_auth is not None:
        env.update(session_auth.new_session_env())

    if annotation_imports:
        env["ANNOTATION_APP_IMPORTS"] = annotation_imports

    python_exe = _get_python(conda_env)
    app_root = Path(cfg["app_root"])

    # Redirige stdout+stderr de chaque sous-process vers un fichier log (le
    # stdout etait avant herite -> perdu cote VisionNexus). VisionNexus tail
    # ces fichiers dans l'onglet natif de la sous-app.
    log_dir = Path(ws) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backend_log_path = log_dir / f"{app_id}_backend_{stamp}.log"
    frontend_log_path = log_dir / f"{app_id}_frontend_{stamp}.log"
    backend_log_f = open(backend_log_path, "w", encoding="utf-8")
    frontend_log_f = open(frontend_log_path, "w", encoding="utf-8")

    # Launch backend
    # PAS de --reload sur les sous-apps (Bob 2026-07-25) : le reloader uvicorn StatReload
    # est un piège documenté ici — sur Windows/spawn il fait (1) MOURIR le parent reloader
    # en laissant le worker enfant orpheliner le port (sockets zombies, ports « occupés »
    # au redémarrage) et (2) parfois traîner/bloquer le démarrage (health jamais prêt →
    # step load qui attend 200s+). Les sous-apps ne sont pas éditées pendant un run, donc
    # --reload n'apporte rien. Sans lui : démarrage propre (~14s, CLIP chargé) et arrêt net.
    # start_new_session=True (POSIX) : isole chaque sous-app dans sa PROPRE
    # session/groupe de process plutot que d'heriter de celui d'Orchestrator.
    # Sans ca, os.getpgid(pid) dans stop_app() renvoie le groupe d'Orchestrator
    # lui-meme (aucun setsid n'a jamais ete demande) -- killpg dessus est donc
    # soit inoffensif (le vrai enfant npm/vite est dans un autre groupe et
    # survit, orphelin -- observe le 2026-08-23 : node.exe qui restait apres
    # fermeture de VisionNexus) soit dangereux (tape sur le groupe d'Orchestrator
    # lui-meme s'il n'a pas divergé). Avec start_new_session, killpg cible
    # exactement l'arbre de cette sous-app, rien d'autre.
    # Bind loopback (backend ET frontend) : en 0.0.0.0 les sous-apps etaient
    # joignables par tout le LAN sur l'IP de la VM (rapport 2026-09-24).
    # VisionNexus y accede par tunnel ssh, qui cible 127.0.0.1.
    bind_host = os.environ.get("CV_BIND_HOST", "127.0.0.1")
    backend_proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", cfg["backend_module"],
         "--host", bind_host, "--port", str(bp)],
        cwd=str(app_root),
        env=env,
        stdout=backend_log_f,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
        start_new_session=sys.platform != "win32",
    )

    # Launch frontend
    frontend_dir = app_root / "frontend"
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev", "--", "--port", str(fp), "--host", bind_host],
        cwd=str(frontend_dir),
        env=env,
        stdout=frontend_log_f,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
        start_new_session=sys.platform != "win32",
    )

    session = AppSession(
        app_id=app_id,
        label=cfg["label"],
        backend_port=bp,
        frontend_port=fp,
        workspace=ws,
        user=user,
        backend_pid=backend_proc.pid,
        frontend_pid=frontend_proc.pid,
        # 127.0.0.1 côté backend (jamais localhost : piège ::1/IPv6 Windows)
        backend_url=f"http://127.0.0.1:{bp}",
        frontend_url=f"http://localhost:{fp}",
        status="starting",
        launched_at=datetime.now(timezone.utc).isoformat(),
        backend_log=str(backend_log_path),
        frontend_log=str(frontend_log_path),
    )
    _sessions[app_id] = session
    _processes[app_id] = (backend_proc, frontend_proc)
    _save_state()
    return session


def _kill_port(port: int) -> None:
    """Tue ce qui tient encore `port`, avec son arbre. Silencieux et best-effort.

    Complement de killpg : le port est la seule preuve fiable qu'un serveur est
    encore debout, quel que soit l'etat de nos pids enregistres.
    """
    # is_port_free() de _lib fait un vrai bind (detecte les listeners lies a
    # une interface precise, qu'un connect_ex rate) ; _is_port_free est le
    # repli quand _lib n'est pas embarque.
    free = _shared_is_port_free(port) if _SHARED_REGISTRY else _is_port_free(port)
    if free:
        return
    try:
        if sys.platform == "win32":
            # errors="replace" obligatoire : la sortie de netstat n'est pas
            # decodable en cp1252 sur une Windows localisee (plantage constate).
            out = subprocess.run(
                ["netstat", "-ano", "-p", "TCP"],
                capture_output=True, timeout=10,
            ).stdout.decode("utf-8", errors="replace")
            pids = set()
            for line in out.splitlines():
                parts = line.split()
                # On ne filtre PAS sur le mot d'etat ("LISTENING"), traduit selon
                # la locale : une socket en ecoute se reconnait a son adresse
                # distante nulle (*:0 / 0.0.0.0:0), independamment de la langue.
                if len(parts) < 5 or parts[0].upper() != "TCP":
                    continue
                if parts[1].rsplit(":", 1)[-1] != str(port):
                    continue
                if parts[2].rsplit(":", 1)[-1] != "0":
                    continue
                if parts[-1].isdigit():
                    pids.add(parts[-1])
            for pid in pids:
                subprocess.run(["taskkill", "/F", "/T", "/PID", pid],
                               capture_output=True, timeout=10)
        else:
            # Meme logique que killPortRemote cote VisionNexus : on vise le
            # groupe de process, pas le seul detenteur de la socket.
            script = (
                f'pids=$(lsof -ti:{port} 2>/dev/null); '
                f'[ -z "$pids" ] && pids=$(fuser {port}/tcp 2>/dev/null | tr -d " "); '
                'for pid in $pids; do '
                '  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d " "); '
                '  if [ -n "$pgid" ] && [ "$pgid" != "1" ]; then kill -KILL -"$pgid" 2>/dev/null; '
                '  else kill -KILL "$pid" 2>/dev/null; fi; '
                'done; true'
            )
            subprocess.run(["sh", "-c", script], capture_output=True, timeout=10)
    except Exception:
        pass


def stop_app(app_id: str) -> bool:
    _load_state()
    session = _sessions.get(app_id)
    if not session:
        return False
    for pid in [session.backend_pid, session.frontend_pid]:
        if pid:
            try:
                if sys.platform == "win32":
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        capture_output=True,
                    )
                else:
                    import signal
                    pgid = os.getpgid(pid)
                    os.killpg(pgid, signal.SIGTERM)
                    # SIGTERM laisse une chance a un arret propre (vite/uvicorn
                    # gerent le signal) mais rien ne garantit qu'ils l'ecoutent --
                    # sans ce filet, un process qui l'ignore reste en vie pour
                    # toujours (jamais retente ensuite). On attend un court delai
                    # puis on force si le groupe existe encore.
                    for _ in range(10):
                        time.sleep(0.2)
                        try:
                            os.killpg(pgid, 0)  # signal 0 = juste teste l'existence
                        except ProcessLookupError:
                            break
                    else:
                        try:
                            os.killpg(pgid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            except Exception:
                pass
    # Balayage final par PORT. killpg/taskkill ne couvrent que ce qui descend du
    # pid enregistre : apres un redemarrage de l'orchestrateur (_processes vide,
    # pids relus depuis launcher_state.json), ou si un enfant s'est detache de
    # son groupe, il restait des node/python vivants tenant toujours le port --
    # invisibles pour nous mais bien la dans la liste des ports de VisionNexus.
    for port in (session.backend_port, session.frontend_port):
        if port:
            _kill_port(port)
    if _SHARED_REGISTRY:
        _shared_unregister_instance(app_id, session.user or "")
    session.status = "stopped"
    session.backend_pid = None
    session.frontend_pid = None
    _processes.pop(app_id, None)
    _save_state()
    # Meme regle que le launcher CLI : a l'arret d'Annotation_App, on regenere le
    # rapport d'usage de la racine partagee. Sans ca, un utilisateur passant par
    # l'orchestrator n'aurait jamais de rapport.
    _generate_annotation_monitoring(app_id, session.workspace)
    return True


def _generate_annotation_monitoring(app_id: str, workspace: str) -> None:
    """Rapport d'usage a l'arret d'Annotation_App. Non bloquant et silencieux."""
    if app_id != "annotation" or not workspace:
        return
    try:
        base = Path(workspace).parent
        script = (Path(__file__).resolve().parents[3]
                  / "Annotation_App" / "tools" / "monitoring_report.py")
        if not script.exists():
            return
        outdir = base / "monitoring"
        subprocess.run(
            [sys.executable, str(script), str(base), "--outdir", str(outdir)],
            capture_output=True, timeout=120,
        )
        print(f"[monitoring] rapport d'usage : {outdir / 'annot_monitoring.html'}")
    except Exception as exc:
        print(f"[monitoring] rapport non genere : {exc}")


def get_all_sessions() -> dict[str, dict]:
    _load_state()
    result = {}
    for app_id, session in _sessions.items():
        # Check if process is still alive
        handles = _processes.get(app_id)
        if handles:
            backend_rc, frontend_rc = handles[0].poll(), handles[1].poll()
            session.backend_exit_code = backend_rc
            session.frontend_exit_code = frontend_rc
        else:
            backend_rc = None if session.backend_pid and _pid_alive(session.backend_pid) else -1
            frontend_rc = None if session.frontend_pid and _pid_alive(session.frontend_pid) else -1
        if session.status in ("starting", "running") and (backend_rc is not None or frontend_rc is not None):
            session.status = "error"
            failed_part = "backend" if backend_rc is not None else "frontend"
            failed_code = backend_rc if backend_rc is not None else frontend_rc
            log_path = session.backend_log if backend_rc is not None else session.frontend_log
            tail = _log_tail(log_path)
            session.failure_reason = f"Le {failed_part} s'est arrêté (code {failed_code})."
            if tail:
                session.failure_reason += f"\n{tail}"
            if backend_rc is not None:
                session.backend_pid = None
            if frontend_rc is not None:
                session.frontend_pid = None
        d = asdict(session)
        d["alive"] = session.status == "running" or (
            session.status == "starting" and session.backend_pid is not None
        )
        result[app_id] = d
    _save_state()
    return result


def get_session(app_id: str) -> Optional[AppSession]:
    _load_state()
    return _sessions.get(app_id)


def set_status(app_id: str, status: str, failure_reason: Optional[str] = None) -> None:
    """Met à jour le statut d'une session (ex. starting → running après /health OK)."""
    _load_state()
    session = _sessions.get(app_id)
    if session and (session.status != status or failure_reason != session.failure_reason):
        session.status = status
        session.failure_reason = failure_reason if status == "error" else None
        _save_state()


_ID_TO_URLKEY = {
    "annotation": "Annotation_App", "explorer": "Dataset_Explorer_App", "training": "Training_App",
    "inference": "Inference_App",
    "dvc": "dvc-app", "mlflow": "mlflow-app", "optuna": "optuna-app",
}


def _port_listening(url: str) -> bool:
    """True si un serveur écoute sur le port du backend_url. On NE se fie PAS au
    backend_pid : c'est le pid du process parent du reloader uvicorn, qui MEURT
    alors que le worker enfant sert toujours (piège --reload, test Fable 2026-07)."""
    try:
        host_port = url.split("//", 1)[-1]
        host, _, port = host_port.partition(":")
        port_i = int(port.split("/")[0]) if port else 80
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            return s.connect_ex((host or "127.0.0.1", port_i)) == 0
    except Exception:
        return False


def repatch_app_urls() -> dict[str, str]:
    """Réinjecte APP_URLS/APP_FRONTEND_URLS depuis les sessions du
    launcher_state.json dont le port backend écoute réellement. INDISPENSABLE
    après un reload uvicorn de l'orchestrateur : sinon APP_URLS revient aux ports
    par défaut et le proxy ne trouve plus les sous-apps (bug B14, test Fable 2026-07)."""
    from backend import config as cfg
    _load_state()
    patched: dict[str, str] = {}
    for app_id, session in _sessions.items():
        if session.status == "stopped" or not session.backend_url:
            continue
        if not _port_listening(session.backend_url):
            continue
        key = _ID_TO_URLKEY.get(app_id)
        if key:
            cfg.APP_URLS[key] = session.backend_url
            cfg.APP_FRONTEND_URLS[key] = session.frontend_url
            patched[key] = session.backend_url
    return patched


def _get_python(conda_env: str) -> str:
    if sys.platform == "win32":
        # Try to find conda env python
        base = Path(sys.executable).parent.parent  # e.g. miniconda3/
        candidate = base / "envs" / conda_env / "python.exe"
        if candidate.exists():
            return str(candidate)
        # Also try sibling to current python
        base2 = Path(sys.executable).parent.parent.parent
        candidate2 = base2 / "envs" / conda_env / "python.exe"
        if candidate2.exists():
            return str(candidate2)
    return sys.executable
