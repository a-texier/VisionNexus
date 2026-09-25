#!/usr/bin/env python3
"""
launcher_engine.py -- Shared engine for all IA-App launchers.

Provides:
  - APP_REGISTRY  : centralised config for every app
  - Port utilities, process utilities, instance registry
  - launch_app()  : start one app instance and return a LaunchSession
"""

import json
import os
import signal
import socket
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from _lib import session_auth

# ------------------------------------------------------------------ #
# Root paths — deux layouts supportes :                               #
#   DEV     : App/Launchers/_lib/launcher_engine.py                   #
#             → _CV = App/Computer_Vision_App                         #
#   BUNDLE  : <racine>/_lib/launcher_engine.py                        #
#             → _CV = <racine> (apps = freres de _lib)                #
#                                                                     #
# La racine est reconnue par son CONTENU, pas par son nom. Avant, le   #
# test etait `_PARENT.name == "Computer_Vision_App"` : des qu'on       #
# clonait le depot sous un autre nom (OLDD_Computer_Vision_App,        #
# Computer_Vision_App_v2...), ce test echouait et le `elif` suivant    #
# partait CHERCHER LATERALEMENT un dossier nomme exactement            #
# Computer_Vision_App a cote. Resultat : le launcher lance sous        #
# OLDD_Computer_Vision_App demarrait en realite les apps du dossier    #
# voisin (`uvicorn` annoncait ".../Computer_Vision_App/Annotation_App" #
# alors que la racine demandee etait OLDD_...), et ca ne se voyait     #
# qu'une fois le dossier voisin absent ou renomme. Le nom du dossier   #
# racine ne doit avoir aucune influence : seul compte le fait qu'il    #
# contienne les apps.                                                 #
# ------------------------------------------------------------------ #

_LIB_DIR = Path(__file__).resolve().parent             # .../_lib
_PARENT  = _LIB_DIR.parent                             # App/Launchers/  OU  <racine CV>/

# Dossiers d'app toujours presents a la racine du depot, quel que soit le
# nom de cette racine. Un seul suffit : un depot partiel reste utilisable.
_CV_ROOT_MARKERS = ("Annotation_App", "Orchestrator_App", "Dataset_Explorer_App")


def _is_cv_root(p: Path) -> bool:
    return any((p / marker).is_dir() for marker in _CV_ROOT_MARKERS)


if _is_cv_root(_PARENT):
    # BUNDLE / depot clone sous n'importe quel nom : _lib est a la racine CV,
    # les apps sont ses freres. Prioritaire sur toute recherche laterale.
    _CV       = _PARENT
    _APP_BASE = _PARENT
    _BUNDLE   = True
elif (_PARENT.parent / "Computer_Vision_App").is_dir():
    # DEV : _lib est dans App/Launchers/ ; Computer_Vision_App = frere de Launchers.
    # N'est atteint que si _PARENT ne contient AUCUNE app (donc n'est pas une racine).
    _APP_BASE = _PARENT.parent                         # App/
    _CV       = _APP_BASE / "Computer_Vision_App"
    _BUNDLE   = False
else:
    # Fallback : traiter le parent comme racine CV
    _CV       = _PARENT
    _APP_BASE = _PARENT
    _BUNDLE   = True

_WS_DEFAULT    = _APP_BASE / "All_workspaces"          # workspace par defaut


def _find_autonomous_base() -> Path:
    """Dossier ou vivent les apps AUTONOMES (Meshy, Recon3D...) = "App/".
    En layout bundle, _APP_BASE pointe DANS Computer_Vision_App/ ; on remonte
    jusqu'au vrai App/ en s'ancrant sur un dossier d'app autonome connu."""
    for p in [_APP_BASE, *_APP_BASE.parents]:
        if (p / "Recon3D_App").is_dir() or (p / "Meshy_App").is_dir():
            return p
    return _APP_BASE


_AUTONOMOUS_BASE = _find_autonomous_base()


def _embedded_node_bin() -> Optional[Path]:
    """Retourne le dossier bin/ du Node.js embarque (bundle Linux), sinon None.

    Le tarball node-v20.20.2-linux-x64.tar.xz est extrait par setup_linux.sh
    vers Computer_Vision_App/node-v20.20.2-linux-x64/. On prepend son bin/ au
    PATH pour que npm/node soient trouves sans installation systeme.
    """
    for name in ("node-v20.20.2-linux-x64", "node"):
        bindir = _CV / name / "bin"
        if (bindir / "node").exists() or (bindir / "npm").exists():
            return bindir
    return None

# ------------------------------------------------------------------ #
# App registry                                                        #
# ------------------------------------------------------------------ #

APP_REGISTRY: dict = {
    "annotation": {
        "label":              "Annotation_App",
        "app_root":           _CV / "Annotation_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,           # None = same as app_root
        "frontend_dir":       "frontend",     # relative to app_root
        "base_backend_port":  8000,
        "base_frontend_port": 5173,
        "default_workspace":  str(_WS_DEFAULT / "default_annotation"),
        "workspace_env":      "ANNOTATION_WORKSPACE",
        "user_env":           "ANNOTATION_USER",
        "frontend_port_env":  "ANNOTATION_FRONTEND_PORT",
        "extra_env":          {},
    },
    "explorer": {
        "label":              "Dataset_Explorer_App",
        "app_root":           _CV / "Dataset_Explorer_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8001,
        "base_frontend_port": 5174,
        "default_workspace":  str(_WS_DEFAULT / "default_explorer"),
        "workspace_env":      "EXPLORER_WORKSPACE",
        "user_env":           "EXPLORER_USER",
        "frontend_port_env":  "EXPLORER_FRONTEND_PORT",
        "extra_env":          {},
    },
    "compare": {
        "label":              "Compare_BDD_App",
        "app_root":           _CV / "Compare_BDD_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8002,
        "base_frontend_port": 5175,
        "default_workspace":  str(_WS_DEFAULT / "default_compare"),
        "workspace_env":      "COMPARE_WORKSPACE",
        "user_env":           "COMPARE_USER",
        "frontend_port_env":  "COMPARE_FRONTEND_PORT",
        "extra_env":          {},
    },
    "3d": {
        "label":              "3D_Connection_App",
        "app_root":           _APP_BASE / "3D_Connection_App",
        "backend_module":     "main:app",
        "backend_cwd":        "backend",      # relative to app_root
        "frontend_dir":       "frontend",
        "base_backend_port":  8003,
        "base_frontend_port": 3000,
        "default_workspace":  None,           # no workspace
        "workspace_env":      None,
        "user_env":           None,
        "frontend_port_env":  None,
        "extra_env":          {},
    },
    "meshy": {
        "label":              "Meshy_App",
        "app_root":           _APP_BASE / "Meshy_App",
        "backend_module":     "app.backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       str(_APP_BASE / "Meshy_App" / "app" / "frontend"),
        "base_backend_port":  8050,
        "base_frontend_port": 5180,
        "default_workspace":  str(_WS_DEFAULT / "default_meshy"),
        "workspace_env":      "MESHY_WORKSPACE",
        "user_env":           "MESHY_USER",
        "frontend_port_env":  None,
        "extra_env":          {"HOST": os.environ.get("CV_BIND_HOST", "127.0.0.1")},
    },
    # App AUTONOME (comme Meshy) : hors Computer_Vision_App, PAS dans le bundle
    # CV, PAS cablee a l'Orchestrator. Reconstruction 3D.
    "recon3d": {
        "label":              "Recon3D_App",
        "app_root":           _AUTONOMOUS_BASE / "Recon3D_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8066,
        "base_frontend_port": 5178,
        "default_workspace":  str(_WS_DEFAULT / "default_recon3d"),
        "workspace_env":      "RECON3D_WORKSPACE",
        "user_env":           "RECON3D_USER",
        "frontend_port_env":  "RECON3D_FRONTEND_PORT",
        "extra_env":          {},
    },

    # ── Computer-Vision MLOps stack ─────────────────────────────────
    "orchestrator": {
        "label":              "Orchestrator_App",
        "app_root":           _CV / "Orchestrator_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8060,
        "base_frontend_port": 3000,
        "default_workspace":  str(_WS_DEFAULT / "default_orchestrator"),
        "workspace_env":      "ORCHESTRATOR_WORKSPACE",
        "user_env":           "ORCHESTRATOR_USER",
        "frontend_port_env":  "ORCHESTRATOR_FRONTEND_PORT",
        "extra_env":          {},
    },
    "dvc": {
        "label":              "DVC_App",
        "app_root":           _CV / "DVC_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8061,
        "base_frontend_port": 3002,
        "default_workspace":  str(_WS_DEFAULT / "default_dvc"),
        "workspace_env":      "DVC_APP_WORKSPACE",
        "user_env":           "DVC_APP_USER",
        "frontend_port_env":  "DVC_APP_FRONTEND_PORT",
        "extra_env":          {},
    },
    "mlflow": {
        "label":              "MLflow_App",
        "app_root":           _CV / "MLflow_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8062,
        "base_frontend_port": 3001,
        "default_workspace":  str(_WS_DEFAULT / "default_mlflow"),
        "workspace_env":      "MLFLOW_APP_WORKSPACE",
        "user_env":           "MLFLOW_APP_USER",
        "frontend_port_env":  "MLFLOW_APP_FRONTEND_PORT",
        "extra_env":          {},
    },
    "optuna": {
        "label":              "Optuna_App",
        "app_root":           _CV / "Optuna_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8063,
        "base_frontend_port": 3003,
        "default_workspace":  str(_WS_DEFAULT / "default_optuna"),
        "workspace_env":      "OPTUNA_APP_WORKSPACE",
        "user_env":           "OPTUNA_APP_USER",
        "frontend_port_env":  "OPTUNA_APP_FRONTEND_PORT",
        "extra_env":          {},
    },
    "training": {
        "label":              "Training_App",
        "app_root":           _CV / "Training_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8064,
        "base_frontend_port": 5176,
        "default_workspace":  str(_WS_DEFAULT / "default_training"),
        "workspace_env":      "TRAINING_APP_WORKSPACE",
        "user_env":           "TRAINING_APP_USER",
        "frontend_port_env":  "TRAINING_APP_FRONTEND_PORT",
        "extra_env":          {},
    },
    "inference": {
        "label":              "Inference_App",
        "app_root":           _CV / "Inference_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       "frontend",
        "base_backend_port":  8065,
        "base_frontend_port": 5177,
        "default_workspace":  str(_WS_DEFAULT / "default_inference"),
        "workspace_env":      "INFERENCE_APP_WORKSPACE",
        "user_env":           "INFERENCE_APP_USER",
        "frontend_port_env":  "INFERENCE_APP_FRONTEND_PORT",
        "extra_env":          {},
    },
    # Service de calcul backend seul : pas de frontend (frontend_dir None), hors ligne.
    "docs": {
        "label":              "Docs_Assistant_App",
        "app_root":           _CV / "Docs_Assistant_App",
        "backend_module":     "backend.main:app",
        "backend_cwd":        None,
        "frontend_dir":       None,
        "base_backend_port":  8068,
        "base_frontend_port": None,
        "default_workspace":  str(_WS_DEFAULT / "default_docs"),
        "workspace_env":      "DOCS_ASSISTANT_WORKSPACE",
        "user_env":           "DOCS_ASSISTANT_USER",
        "frontend_port_env":  None,
        "extra_env": {
            "HF_HUB_OFFLINE":          "1",
            "TRANSFORMERS_OFFLINE":    "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "DO_NOT_TRACK":            "1",
        },
    },
}

# ------------------------------------------------------------------ #
# Workspace subdirs to create per app                                 #
# ------------------------------------------------------------------ #

_WS_SUBDIRS: dict = {
    "annotation":  [],
    "explorer":        ["thumbs", "faiss", "subsets"],
    "compare":     ["runs", "feature_cache", "thumbs",
                    "metrics_project/pair", "metrics_project/population"],
    "3d":          [],
    "meshy":       ["outputs", "models"],
    "recon3d":     ["datasets", "reconstructions", "exports"],
    "orchestrator": ["pipelines"],
    "dvc":          ["repo"],
    "mlflow":       ["mlflow_data"],
    "optuna":       ["logs"],
    "training":     ["runs", "exports"],
    "inference":    ["runs"],
    "docs":         [],
}

# ------------------------------------------------------------------ #
# Port utilities                                                      #
# ------------------------------------------------------------------ #

def is_port_free(port: int) -> bool:
    """Vérifie qu'un serveur peut réellement réserver ce port sur IPv4.

    Un simple connect_ex(127.0.0.1) ne voit pas certains listeners liés à une
    interface précise. Le bind sur 0.0.0.0 détecte ces collisions avant le
    lancement d'Uvicorn/Vite, y compris avec des processus hors VisionNexus.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def find_free_port(start: int, claimed: set, max_tries: int = 200) -> int:
    for port in range(start, start + max_tries):
        if port not in claimed and is_port_free(port):
            return port
    raise RuntimeError(
        f"No free port found between {start} and {start + max_tries - 1}."
    )


def _acquire_port_lock(lock_file: Path, timeout: float = 20.0) -> int:
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            return os.open(str(lock_file), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            time.sleep(0.1)
    raise RuntimeError(
        f"Cannot acquire port lock ({lock_file}). "
        "Remove the file if no launcher is starting."
    )


def _release_port_lock(fd: int, lock_file: Path) -> None:
    try:
        os.close(fd)
    except Exception:
        pass
    try:
        lock_file.unlink()
    except Exception:
        pass

# ------------------------------------------------------------------ #
# Instance registry                                                   #
# ------------------------------------------------------------------ #

# Registre + verrou UNIFIÉS dev/bundle dans Computer_Vision_App/.run/ (commun à
# TOUTES les apps). Doit correspondre aux launchers standalone (*/launcher.py),
# utils/free_ports.py et Orchestrator_App/run_all_scenarios.py.
_REGISTRY_FILE = _CV / ".run" / ".instances.json"
_LOCK_FILE     = _CV / ".run" / ".port_lock"


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


def load_instances() -> list:
    try:
        if _REGISTRY_FILE.exists():
            entries = json.loads(_REGISTRY_FILE.read_text(encoding="utf-8"))
            return [e for e in entries if e.get("pid") and _pid_alive(e["pid"])]
    except Exception:
        pass
    return []


def _save_instances(entries: list) -> None:
    try:
        _REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        _REGISTRY_FILE.write_text(
            json.dumps(entries, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
    except Exception:
        pass


def register_instance(
    app_id: str, user: str, backend_port: int, frontend_port: Optional[int], workspace: str
) -> None:
    key = f"{app_id}:{user}"
    entries = load_instances()
    entries = [e for e in entries if e.get("key") != key]
    entries.append({
        "key":           key,
        "app":           app_id,
        "user":          user,
        "backend_port":  backend_port,
        "frontend_port": frontend_port,
        "workspace":     workspace,
        "pid":           os.getpid(),
        "started_at":    datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })
    _save_instances(entries)


def unregister_instance(app_id: str, user: str) -> None:
    key = f"{app_id}:{user}"
    try:
        entries = [e for e in load_instances() if e.get("key") != key]
        _save_instances(entries)
    except Exception:
        pass


# ------------------------------------------------------------------ #
# Workspace history                                                   #
# ------------------------------------------------------------------ #

def _workspace_history_file(app_id: str) -> Path:
    """Return .history.json inside each app's own data/ folder.
    Stocke dans <app_root>/data/ — separé de All_workspaces/ qui n'accueille
    que les fichiers vraiment partagés (.instances.json, .port_lock).
    """
    return Path(APP_REGISTRY[app_id]["app_root"]) / "data" / ".history.json"


def _append_workspace_history(app_id: str, workspace: str, user: str = "default") -> None:
    """Append *workspace* to the per-app history file as {path, user} dict (deduplicated)."""
    if not workspace:
        return
    try:
        hist_file = _workspace_history_file(app_id)
        hist_file.parent.mkdir(parents=True, exist_ok=True)
        existing: list = []
        if hist_file.exists():
            try:
                existing = json.loads(hist_file.read_text(encoding="utf-8"))
                if not isinstance(existing, list):
                    existing = []
            except Exception:
                existing = []
        # Normalize old plain-string entries for backward compat
        normalized = [
            {"path": e, "user": "?"} if isinstance(e, str) else e
            for e in existing if isinstance(e, (str, dict))
        ]
        # Deduplicate by path (keep most recent at top)
        normalized = [e for e in normalized if e.get("path") != workspace]
        normalized.insert(0, {"path": workspace, "user": user})
        hist_file.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def print_instances() -> None:
    entries = load_instances()
    if not entries:
        print("[instances] No active instances.")
        return
    print("\n[instances] Active instances:")
    for e in entries:
        print(
            f"  {e.get('app','?'):12s}  {e.get('user','?'):12s}  "
            f"backend:{e.get('backend_port','?')}  "
            f"frontend:{e.get('frontend_port','?')}  "
            f"workspace: {e.get('workspace','?')}"
        )
    print()

# ------------------------------------------------------------------ #
# Process helpers                                                     #
# ------------------------------------------------------------------ #

def find_python_from_conda_path(conda_path: str) -> Optional[str]:
    """Resout l'executable python depuis un chemin conda explicite.

    Accepte indifferemment :
      - le dossier racine de l'env      : /home/<user>/miniconda3/envs/IA_env
      - le script d'activation          : /home/<user>/miniconda3/envs/IA_env/bin/activate
        (ou .../miniconda3/bin/activate IA_env — on prend le dossier env parent)
      - directement l'executable python : .../envs/IA_env/bin/python(.exe)

    Retourne None si aucun python n'est trouvable a partir du chemin donne.
    """
    if not conda_path:
        return None
    p = Path(conda_path.strip().strip('"').strip("'"))

    # Cas 1 : chemin direct vers python / python.exe
    if p.is_file() and p.stem.lower().startswith("python"):
        return str(p)

    # Cas 2 : script d'activation (…/bin/activate ou …/Scripts/activate.bat)
    if p.is_file() and p.stem.lower() == "activate":
        env_root = p.parent.parent          # bin/activate -> racine env
        p = env_root

    # Cas 3 : dossier racine de l'env conda
    if p.is_dir():
        for cand in (p / "bin" / "python", p / "python.exe", p / "bin" / "python3"):
            if cand.exists():
                return str(cand)
    return None


def find_python(conda_env: str, conda_path: Optional[str] = None) -> str:
    """Resout python : d'abord via conda_path explicite (settings VisionNexus),
    sinon recherche de l'env par nom dans les emplacements conda standards."""
    if conda_path:
        resolved = find_python_from_conda_path(conda_path)
        if resolved:
            return resolved
        print(f"[warning] --conda-path '{conda_path}' invalide (python introuvable), "
              f"repli sur la recherche par nom d'env '{conda_env}'")

    home = Path.home()
    candidates = [
        home / "miniconda3"  / "envs" / conda_env / "python.exe",
        home / "AppData" / "Local" / "miniconda3" / "envs" / conda_env / "python.exe",
        home / "anaconda3"   / "envs" / conda_env / "python.exe",
        home / "miniconda3"  / "envs" / conda_env / "bin" / "python",
        home / "anaconda3"   / "envs" / conda_env / "bin" / "python",
        Path("/opt/conda")   / "envs" / conda_env / "bin" / "python",
        Path("/usr/local/conda") / "envs" / conda_env / "bin" / "python",
    ]
    for p in candidates:
        if p.exists():
            return str(p)
    print(f"[warning] Conda env '{conda_env}' not found, using sys.executable")
    return sys.executable


def npm_command(frontend_port: int, node_bin: "Path | None" = None) -> list:
    if sys.platform == "win32":
        return ["cmd", "/c", "npm", "run", "dev", "--", "--port", str(frontend_port),
                "--host", "127.0.0.1"]
    if node_bin:
        node = node_bin / "node"
        npm_cli = node_bin.parent / "lib" / "node_modules" / "npm" / "bin" / "npm-cli.js"
        if node.is_file() and npm_cli.is_file():
            return [str(node), str(npm_cli), "run", "dev", "--", "--port", str(frontend_port),
                    "--host", "127.0.0.1"]
    return ["npm", "run", "dev", "--", "--port", str(frontend_port),
            "--host", "127.0.0.1"]


def _kill_tree(proc: "subprocess.Popen") -> None:
    """Kill a process and its entire child tree (cross-platform).

    On Windows: taskkill /F /T kills the process and all descendants.
    On POSIX: killpg sends SIGTERM to the whole process group (requires start_new_session=True).
    """
    if proc.poll() is not None:
        return  # already dead
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True, timeout=10,
            )
        else:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    try:
        proc.wait(timeout=6)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass


def _popen_kwargs() -> dict:
    """
    Isolate child processes from the parent terminal's Ctrl+C signal so that
    each user's launcher controls only its own subprocesses.

    Both flags achieve the same effect on their respective OS — the child
    process is placed in its own process group / session and will NOT receive
    a SIGINT/Ctrl+C that the user sends to the launcher terminal.
    The launcher itself catches SIGINT and calls shutdown() explicitly.
    """
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}

# ------------------------------------------------------------------ #
# LaunchSession                                                       #
# ------------------------------------------------------------------ #

def generate_annotation_monitoring(app_id: str, workspace: str) -> Optional[str]:
    """Regenere le rapport d'usage a la deconnexion d'un utilisateur annotation.

    Le rapport couvre TOUS les utilisateurs de la racine partagee, pas seulement
    celui qui part : le workspace est <racine>/annotation_<user>, donc on remonte
    d'un cran et on ecrit dans <racine>/monitoring/annot_monitoring.html.

    Silencieux et non bloquant : personne ne doit voir un arret d'app echouer
    parce qu'un graphique n'a pas pu etre produit.
    """
    if app_id != "annotation" or not workspace:
        return None
    try:
        ws = Path(workspace)
        base = ws.parent
        script = _APP_BASE / "Annotation_App" / "tools" / "monitoring_report.py"
        if not script.exists():
            return None
        outdir = base / "monitoring"
        subprocess.run(
            [sys.executable, str(script), str(base), "--outdir", str(outdir)],
            capture_output=True, timeout=120,
        )
        out = outdir / "annot_monitoring.html"
        if out.exists():
            print(f"[monitoring] rapport d'usage : {out}")
            return str(out)
    except Exception as exc:
        print(f"[monitoring] rapport non genere : {exc}")
    return None


@dataclass
class LaunchSession:
    app_id:        str
    user:          str
    workspace:     str
    backend_port:  int
    frontend_port: Optional[int]      # None = service backend seul
    backend_proc:  subprocess.Popen
    frontend_proc: Optional[subprocess.Popen] = None
    _shutdown_called: bool = field(default=False, init=False)

    def wait_backend_ready(self, timeout: int = 60) -> bool:
        for _ in range(timeout):
            time.sleep(1)
            if not is_port_free(self.backend_port):
                return True
        return False

    def shutdown(self) -> None:
        if self._shutdown_called:
            return
        self._shutdown_called = True
        unregister_instance(self.app_id, self.user)
        for proc in [self.backend_proc, self.frontend_proc]:
            if proc:
                _kill_tree(proc)
        # Rapport d'usage APRES l'arret du backend : la base n'est plus ecrite,
        # le snapshot est donc coherent.
        generate_annotation_monitoring(self.app_id, self.workspace)

    def watch(self) -> None:
        """Block until Ctrl-C or a process dies."""
        def _sig(sig=None, frame=None):
            print(f"\n[{self.app_id}/{self.user}] Stopping...")
            self.shutdown()
            print(f"[{self.app_id}/{self.user}] Done.")
            sys.exit(0)

        signal.signal(signal.SIGINT,  _sig)
        signal.signal(signal.SIGTERM, _sig)

        try:
            while True:
                if self.backend_proc.poll() is not None:
                    print(f"[{self.app_id}] Backend exited unexpectedly.")
                    _sig()
                if self.frontend_proc and self.frontend_proc.poll() is not None:
                    print(f"[{self.app_id}] Frontend exited unexpectedly.")
                    _sig()
                time.sleep(2)
        except KeyboardInterrupt:
            _sig()

# ------------------------------------------------------------------ #
# Core launch function                                                #
# ------------------------------------------------------------------ #

def launch_app(
    app_id:           str,
    workspace:        Optional[str] = None,
    user:             str           = "default",
    conda_env:        str           = "IA_env",
    conda_path:       Optional[str] = None,
    backend_only:     bool          = False,
    no_reload:        bool          = False,
    base_backend_port: Optional[int] = None,
    base_frontend_port: Optional[int] = None,
    fixed_backend_port: Optional[int] = None,
    fixed_frontend_port: Optional[int] = None,
    extra_env_overrides: Optional[dict] = None,
) -> LaunchSession:
    """
    Start one instance of an app.

    Returns a LaunchSession (backend_proc ready, frontend_proc starting).
    Call session.watch() to block, or session.shutdown() to stop.
    """
    if app_id not in APP_REGISTRY:
        raise ValueError(
            f"Unknown app '{app_id}'. Available: {list(APP_REGISTRY.keys())}"
        )

    cfg        = APP_REGISTRY[app_id]
    app_root   = Path(cfg["app_root"])
    label      = cfg["label"]

    # Resolve backend cwd
    if cfg["backend_cwd"]:
        backend_cwd = app_root / cfg["backend_cwd"]
    else:
        backend_cwd = app_root

    # Resolve frontend dir (None = service backend seul, sans frontend ni port frontend)
    fd_raw = cfg["frontend_dir"]
    if fd_raw is None:
        frontend_dir = None
        backend_only = True
    elif os.path.isabs(fd_raw):
        frontend_dir = Path(fd_raw)
    else:
        frontend_dir = app_root / fd_raw

    # Workspace — naming: {app_id}_{user}
    # Examples:
    #   --workspace All_ws --user alice --app annotation  →  All_ws/annotation_alice
    #   --workspace All_ws              --app annotation  →  All_ws/annotation_default
    #   (no --workspace)                --app annotation  →  All_workspaces/annotation_default
    if workspace:
        ws_base = Path(workspace.strip())
        if not ws_base.is_absolute():
            ws_base = Path.cwd() / ws_base
    else:
        ws_base = _WS_DEFAULT
    ws_path = ws_base / f"{app_id}_{user}"
    if app_id == "explorer":
        # Migration one-shot des workspaces crees avant le renommage de l'app.
        # Les donnees utilisateur restent isolees et aucun rescan n'est impose.
        legacy_ws = ws_base / f"visu_{user}"
        if legacy_ws.exists() and not ws_path.exists():
            legacy_ws.rename(ws_path)
            print(f"[migration] workspace Dataset Explorer: {legacy_ws} -> {ws_path}", flush=True)
        legacy_db = ws_path / ("visu" + "_bdd.db")
        current_db = ws_path / "dataset_explorer.db"
        if legacy_db.exists() and not current_db.exists():
            legacy_db.rename(current_db)
            print(f"[migration] base Dataset Explorer: {legacy_db.name} -> {current_db.name}", flush=True)
    ws = str(ws_path)

    # Create workspace subdirs
    if ws:
        for sub in _WS_SUBDIRS.get(app_id, []):
            (ws_path / sub).mkdir(parents=True, exist_ok=True)
        ws_path.mkdir(parents=True, exist_ok=True)

    # History tracking — append this workspace to .{app_id}_history.json
    _append_workspace_history(app_id, ws, user)

    # Port allocation
    fd = _acquire_port_lock(_LOCK_FILE)
    try:
        claimed: set = set()
        for e in load_instances():
            claimed.add(e.get("backend_port"))
            claimed.add(e.get("frontend_port"))

        bp_start = base_backend_port or cfg["base_backend_port"]
        fp_start = base_frontend_port or cfg["base_frontend_port"]

        if fixed_backend_port is not None:
            if fixed_backend_port in claimed or not is_port_free(fixed_backend_port):
                raise RuntimeError(f"Backend port {fixed_backend_port} is already in use.")
            backend_port = fixed_backend_port
        else:
            backend_port = find_free_port(bp_start, claimed)
        claimed.add(backend_port)

        frontend_port: Optional[int]
        if frontend_dir is None:
            frontend_port = None
        elif fixed_frontend_port is not None:
            if fixed_frontend_port in claimed or not is_port_free(fixed_frontend_port):
                raise RuntimeError(f"Frontend port {fixed_frontend_port} is already in use.")
            frontend_port = fixed_frontend_port
        else:
            frontend_port = find_free_port(fp_start, claimed)

        register_instance(app_id, user, backend_port, frontend_port, ws)
    finally:
        _release_port_lock(fd, _LOCK_FILE)

    # Build environment
    env = os.environ.copy()
    env["BACKEND_PORT"]      = str(backend_port)
    env["VITE_BACKEND_PORT"] = str(backend_port)
    if frontend_port is not None:
        env["VITE_FRONTEND_PORT"] = str(frontend_port)
    env["IA_USER"]           = user
    env["VITE_IA_USER"]      = user            # lisible côté frontend via import.meta.env.VITE_IA_USER
    env["IA_APP_ID"]              = app_id          # lu par /api/workspace/users pour filtrer par app
    env["IA_INSTANCES_FILE"]      = str(_REGISTRY_FILE)  # Computer_Vision_App/.run/.instances.json
    env["IA_WORKSPACE_HISTORY_FILE"] = str(_workspace_history_file(app_id))

    if cfg["workspace_env"] and ws:
        env[cfg["workspace_env"]] = ws
    if cfg["user_env"]:
        env[cfg["user_env"]] = user
    if cfg["frontend_port_env"] and frontend_port is not None:
        env[cfg["frontend_port_env"]] = str(frontend_port)
    for k, v in cfg.get("extra_env", {}).items():
        env[k] = v
    for k, v in (extra_env_overrides or {}).items():
        env[k] = v
    # Jeton de session de CETTE instance (cf. _lib/session_auth.py).
    session_env = session_auth.new_session_env()
    env.update(session_env)

    # Also set PORT for meshy
    if app_id == "meshy":
        env["PORT"] = str(backend_port)

    # Node.js embarque (bundle Linux) : prepend au PATH pour npm/node hors-ligne.
    node_bin = _embedded_node_bin()
    if node_bin:
        env["PATH"] = str(node_bin) + os.pathsep + env.get("PATH", "")

    python_exe = find_python(conda_env, conda_path)

    # flush=True partout ici : ce print() passe par le buffer stdout de
    # Python, BLOQUANT (~8 Ko) des que la sortie n'est pas un vrai terminal
    # (pipe -- exactement le cas quand un client comme le lanceur Electron
    # capture cette sortie pour y lire les ports). Sans flush explicite, ces
    # lignes restaient invisibles cote client pendant que celles d'uvicorn
    # (sous-process avec heritage direct du descripteur de fichier, hors
    # buffer Python) arrivaient normalement -- d'ou l'impression que rien ne
    # se passait alors que le backend/frontend tournaient deja.
    print("=" * 60, flush=True)
    print(f"  {label} -- {user}", flush=True)
    print("=" * 60, flush=True)
    # Avant les lignes [config] : le lanceur Electron considere l'app prete a
    # etre ouverte des qu'il a lu les deux ports, le jeton doit etre deja la.
    session_auth.announce(session_env, frontend_port)
    print(f"[config] app_id    = {app_id}", flush=True)
    print(f"[config] workspace = {ws}", flush=True)
    print(f"[config] backend   = http://localhost:{backend_port}", flush=True)
    if frontend_port is None:
        print("[config] frontend  = none", flush=True)
    else:
        print(f"[config] frontend  = http://localhost:{frontend_port}", flush=True)
    print(f"[config] conda     = {conda_path or f'(env par nom: {conda_env})'}", flush=True)
    print(f"[config] python    = {python_exe}", flush=True)
    print(f"[config] node      = {node_bin or 'systeme (PATH)'}", flush=True)
    print(f"[config] layout    = {'BUNDLE' if _BUNDLE else 'DEV'}", flush=True)

    # Start backend. Loopback par defaut comme le frontend : en 0.0.0.0 l'API
    # (qui lit les fichiers du user) etait joignable par tout le LAN.
    backend_cmd = [
        python_exe, "-m", "uvicorn",
        cfg["backend_module"],
        "--host", os.environ.get("CV_BIND_HOST", "127.0.0.1"),
        "--port", str(backend_port),
    ]
    if not no_reload:
        backend_cmd.append("--reload")

    print(f"[backend] Starting on port {backend_port}...")
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(backend_cwd),
        env=env,
        **_popen_kwargs(),
    )

    # Wait for backend
    print("[backend] Waiting for startup...")
    for _ in range(60):
        time.sleep(1)
        if not is_port_free(backend_port):
            print(f"[backend] Ready on :{backend_port}")
            break
    else:
        print("[backend] Still starting, continuing anyway...")

    # Start frontend
    frontend_proc = None
    if not backend_only:
        print(f"[frontend] Starting on port {frontend_port}...")
        frontend_proc = subprocess.Popen(
            npm_command(frontend_port, node_bin),
            cwd=str(frontend_dir),
            env=env,
            **_popen_kwargs(),
        )
        time.sleep(2)

    print(f"\n  Backend  : http://localhost:{backend_port}")
    if frontend_proc:
        print(f"  Frontend : http://localhost:{frontend_port}")
    print(f"  API docs : http://localhost:{backend_port}/docs")
    print("  Press Ctrl+C to stop")
    print("=" * 60 + "\n")

    return LaunchSession(
        app_id=app_id,
        user=user,
        workspace=ws,
        backend_port=backend_port,
        frontend_port=frontend_port,
        backend_proc=backend_proc,
        frontend_proc=frontend_proc,
    )
