#!/usr/bin/env python3
"""
launcher.py — Annotation_App
==============================
Lancement autonome (sans Launchers/).

Usage :
    python launcher.py --user alice --workspace /ws/alice
    python launcher.py --user alice --workspace /ws/alice --backend-only
    python launcher.py --user alice --workspace /ws/alice --no-reload

Workspace final : <workspace>/annotation_alice/
"""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

APP_ID   = "annotation"
APP_ROOT = Path(__file__).parent.resolve()
APP_BASE = APP_ROOT.parent.parent  # Computer_Vision_App/../ = App/

# Registre partagé des instances + verrou d'allocation de ports, commun à TOUTES
# les apps sous Computer_Vision_App (coordination inter-users/apps). Doit rester
# identique à _lib/launcher_engine.py, utils/free_ports.py et Orchestrator_App/
# run_all_scenarios.py, sinon la coordination des ports casse.
_CV_ROOT = next((p for p in [APP_ROOT, *APP_ROOT.parents] if p.name == "Computer_Vision_App"), APP_ROOT)
_INSTANCES_FILE = _CV_ROOT / ".run" / ".instances.json"
_HISTORY_FILE   = APP_ROOT / "data" / ".history.json"
_LOCK_FILE      = _CV_ROOT / ".run" / ".port_lock"

BASE_BACKEND_PORT  = 8000
BASE_FRONTEND_PORT = 5173


# ------------------------------------------------------------------ #
# Process-tree kill (cross-platform)                                  #
# ------------------------------------------------------------------ #

def _kill_tree(proc) -> None:
    """Kill process and all its children (cross-platform)."""
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True, timeout=10,
            )
        else:
            import os as _os, signal as _signal
            pgid = _os.getpgid(proc.pid)
            _os.killpg(pgid, _signal.SIGTERM)
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


# ------------------------------------------------------------------ #
# Port helpers                                                        #
# ------------------------------------------------------------------ #

def is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _acquire_lock(timeout: float = 20.0) -> int:
    _LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            return os.open(str(_LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            time.sleep(0.1)
    raise RuntimeError(f"Cannot acquire lock: {_LOCK_FILE}")


def _release_lock(fd: int) -> None:
    try: os.close(fd)
    except Exception: pass
    try: _LOCK_FILE.unlink()
    except Exception: pass


# ------------------------------------------------------------------ #
# Instance registry                                                   #
# ------------------------------------------------------------------ #

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


def _load_instances() -> list:
    try:
        if _INSTANCES_FILE.exists():
            data = json.loads(_INSTANCES_FILE.read_text(encoding="utf-8"))
            return [e for e in data if _pid_alive(e.get("pid", 0))]
    except Exception:
        pass
    return []


def _save_instances(entries: list) -> None:
    try:
        _INSTANCES_FILE.parent.mkdir(parents=True, exist_ok=True)
        _INSTANCES_FILE.write_text(
            json.dumps(entries, ensure_ascii=False, indent=2, default=str),
            encoding="utf-8",
        )
    except Exception:
        pass


def _register(user: str, bp: int, fp: int, ws: str) -> None:
    key = f"{APP_ID}:{user}"
    entries = [e for e in _load_instances() if e.get("key") != key]
    entries.append({
        "key": key, "app": APP_ID, "user": user,
        "backend_port": bp, "frontend_port": fp,
        "workspace": ws, "pid": os.getpid(),
        "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })
    _save_instances(entries)


def _unregister(user: str) -> None:
    key = f"{APP_ID}:{user}"
    _save_instances([e for e in _load_instances() if e.get("key") != key])


def _append_history(ws: str, user: str) -> None:
    try:
        _HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        existing: list = []
        if _HISTORY_FILE.exists():
            try:
                existing = json.loads(_HISTORY_FILE.read_text(encoding="utf-8"))
                if not isinstance(existing, list): existing = []
            except Exception: pass
        normalized = [{"path": e, "user": "?"} if isinstance(e, str) else e
                      for e in existing if isinstance(e, (str, dict))]
        normalized = [e for e in normalized if e.get("path") != ws]
        normalized.insert(0, {"path": ws, "user": user})
        _HISTORY_FILE.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


# ------------------------------------------------------------------ #
# Python / npm helpers                                                #
# ------------------------------------------------------------------ #

def find_python(conda_env: str) -> str:
    home = Path.home()
    candidates = [
        home / "miniconda3"  / "envs" / conda_env / "python.exe",
        home / "AppData" / "Local" / "miniconda3" / "envs" / conda_env / "python.exe",
        home / "anaconda3"   / "envs" / conda_env / "python.exe",
        home / "miniconda3"  / "envs" / conda_env / "bin" / "python",
        home / "anaconda3"   / "envs" / conda_env / "bin" / "python",
        Path("/opt/conda")   / "envs" / conda_env / "bin" / "python",
    ]
    for p in candidates:
        if p.exists(): return str(p)
    return sys.executable


def _bundled_node_bin() -> "str | None":
    """Node.js embarque du bundle : <Computer_Vision_App>/node-v20.20.2-linux-x64/bin.
    Cherche en remontant depuis APP_ROOT (marche en bundle ; None sinon)."""
    p = APP_ROOT
    for _ in range(6):
        cand = p / "node-v20.20.2-linux-x64" / "bin"
        if (cand / "node").exists() or (cand / "npm").exists():
            return str(cand)
        p = p.parent
    return None


def npm_cmd(port: int, node_bin: "str | None" = None) -> list:
    if sys.platform == "win32":
        return ["cmd", "/c", "npm", "run", "dev", "--", "--port", str(port)]
    npm = str(Path(node_bin) / "npm") if node_bin and Path(node_bin, "npm").exists() else "npm"
    return [npm, "run", "dev", "--", "--port", str(port)]


# ------------------------------------------------------------------ #
# Main                                                                #
# ------------------------------------------------------------------ #

def main() -> None:
    parser = argparse.ArgumentParser(description=f"Launch {APP_ID} app")
    parser.add_argument("--user",      required=True,  help="Session username (required)")
    parser.add_argument("--workspace", required=True,  help="Workspace base dir. Final = <workspace>/<app>_<user>/")
    parser.add_argument("--conda-env",    default="IA_env")
    parser.add_argument("--backend-port", type=int, default=None)
    parser.add_argument("--frontend-port",type=int, default=None)
    parser.add_argument("--backend-only", action="store_true")
    parser.add_argument("--no-reload",    action="store_true")
    parser.add_argument("--access-log",   action="store_true", help="Enable uvicorn per-request access logs")
    parser.add_argument("--native-share-host", default=None,
                        help="Nom DNS/IP du partage natif vu par le client")
    args = parser.parse_args()

    # Resolve workspace
    ws_base = Path(args.workspace)
    if not ws_base.is_absolute():
        ws_base = Path.cwd() / ws_base
    ws = str(ws_base / f"{APP_ID}_{args.user}")

    Path(ws).mkdir(parents=True, exist_ok=True)
    _append_history(ws, args.user)

    # Port allocation
    fd = _acquire_lock()
    try:
        if args.backend_port and args.frontend_port:
            bp, fp = args.backend_port, args.frontend_port
        else:
            claimed: set = {e.get("backend_port") for e in _load_instances()} | \
                           {e.get("frontend_port") for e in _load_instances()}
            def _free(start: int) -> int:
                for p in range(start, start + 200):
                    if p not in claimed and is_port_free(p): return p
                raise RuntimeError(f"No free port from {start}")
            bp = args.backend_port or _free(BASE_BACKEND_PORT)
            claimed.add(bp)
            fp = args.frontend_port or _free(BASE_FRONTEND_PORT)
        _register(args.user, bp, fp, ws)
    finally:
        _release_lock(fd)

    python_exe = find_python(args.conda_env)
    node_bin = _bundled_node_bin()
    env = {
        **os.environ,
        "ANNOTATION_WORKSPACE": ws,
        "ANNOTATION_USER":      args.user,
        "ANNOTATION_FRONTEND_PORT": str(fp),
        "BACKEND_PORT":         str(bp),
        "VITE_BACKEND_PORT":    str(bp),
        "VITE_FRONTEND_PORT":   str(fp),
        "VITE_IA_USER":         args.user,
        "IA_USER":              args.user,
        "IA_APP_ID":            APP_ID,
        "IA_INSTANCES_FILE":    str(_INSTANCES_FILE),
        "IA_WORKSPACE_HISTORY_FILE": str(_HISTORY_FILE),
    }
    if args.native_share_host:
        env["NATIVE_SHARE_HOST"] = args.native_share_host
    if node_bin:
        env["PATH"] = node_bin + os.pathsep + env.get("PATH", os.environ.get("PATH", ""))

    print("=" * 60)
    print(f"  Annotation_App — {args.user}")
    print("=" * 60)
    print(f"[config] workspace = {ws}")
    print(f"[config] backend   = http://localhost:{bp}")
    print(f"[config] frontend  = http://localhost:{fp}")
    print(f"[config] python    = {python_exe}")

    backend_cmd = [python_exe, "-m", "uvicorn", "backend.main:app",
                   "--host", "0.0.0.0", "--port", str(bp)]
    if not args.access_log:
        backend_cmd.append("--no-access-log")
    if not args.no_reload: backend_cmd.append("--reload")

    backend_proc = subprocess.Popen(backend_cmd, cwd=str(APP_ROOT), env=env)
    for _ in range(60):
        time.sleep(1)
        if not is_port_free(bp): break
    else:
        print("[backend] Still starting, continuing anyway...")

    frontend_proc = None
    if not args.backend_only:
        frontend_proc = subprocess.Popen(
            npm_cmd(fp, node_bin), cwd=str(APP_ROOT / "frontend"), env=env
        )
        time.sleep(2)

    print(f"\n  Backend  : http://localhost:{bp}")
    if frontend_proc: print(f"  Frontend : http://localhost:{fp}")
    print(f"  API docs : http://localhost:{bp}/docs")
    print(f"  Ctrl+C pour arreter")
    print("=" * 60 + "\n")

    def _stop(sig=None, frame=None):
        print(f"\n[{APP_ID}/{args.user}] Arret...")
        _unregister(args.user)
        for p in filter(None, [backend_proc, frontend_proc]):
            _kill_tree(p)
        sys.exit(0)

    signal.signal(signal.SIGINT,  _stop)
    signal.signal(signal.SIGTERM, _stop)
    try:
        while True:
            if backend_proc.poll() is not None: _stop()
            if frontend_proc and frontend_proc.poll() is not None: _stop()
            time.sleep(2)
    except KeyboardInterrupt:
        _stop()


if __name__ == "__main__":
    main()
