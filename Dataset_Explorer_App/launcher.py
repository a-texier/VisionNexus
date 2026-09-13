#!/usr/bin/env python3
"""
launcher.py — Dataset_Explorer_App
============================
Usage :
    python launcher.py --user alice --workspace /ws/alice
    python launcher.py --user alice --workspace /ws/alice --backend-only --no-reload

Workspace final : <workspace>/explorer_alice/
"""
import argparse, json, os, signal, socket, subprocess, sys, time
from datetime import datetime
from pathlib import Path

APP_ID   = "explorer"
APP_ROOT = Path(__file__).parent.resolve()
# Stack complet : App/Computer_Vision_App/Dataset_Explorer_App/ → APP_BASE = App/
# Zip standalone : Dataset_Explorer_App/ seul → APP_BASE = Dataset_Explorer_App/ (instances locales)
_CV      = APP_ROOT.parent
APP_BASE = _CV.parent if _CV.name == "Computer_Vision_App" else APP_ROOT

# Registre partagé des instances + verrou d'allocation de ports, commun à TOUTES
# les apps sous Computer_Vision_App (coordination inter-users/apps). Doit rester
# identique à _lib/launcher_engine.py, utils/free_ports.py et Orchestrator_App/
# run_all_scenarios.py, sinon la coordination des ports casse.
_CV_ROOT = next((p for p in [APP_ROOT, *APP_ROOT.parents] if p.name == "Computer_Vision_App"), APP_ROOT)
_INSTANCES_FILE = _CV_ROOT / ".run" / ".instances.json"
_HISTORY_FILE   = APP_ROOT / "data" / ".history.json"
_LOCK_FILE      = _CV_ROOT / ".run" / ".port_lock"
BASE_BACKEND_PORT  = 8001
BASE_FRONTEND_PORT = 5174


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


def is_port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _acquire_lock(timeout=20.0):
    _LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try: return os.open(str(_LOCK_FILE), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError: time.sleep(0.1)
    raise RuntimeError(f"Cannot acquire lock: {_LOCK_FILE}")


def _release_lock(fd):
    try: os.close(fd)
    except Exception: pass
    try: _LOCK_FILE.unlink()
    except Exception: pass


def _pid_alive(pid):
    try:
        if sys.platform == "win32":
            import ctypes
            h = ctypes.windll.kernel32.OpenProcess(0x400, False, pid)
            if h: ctypes.windll.kernel32.CloseHandle(h); return True
            return False
        os.kill(pid, 0); return True
    except (OSError, ProcessLookupError): return False


def _load_instances():
    try:
        if _INSTANCES_FILE.exists():
            data = json.loads(_INSTANCES_FILE.read_text(encoding="utf-8"))
            return [e for e in data if _pid_alive(e.get("pid", 0))]
    except Exception: pass
    return []


def _save_instances(entries):
    try:
        _INSTANCES_FILE.parent.mkdir(parents=True, exist_ok=True)
        _INSTANCES_FILE.write_text(json.dumps(entries, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    except Exception: pass


def _register(user, bp, fp, ws):
    key = f"{APP_ID}:{user}"
    entries = [e for e in _load_instances() if e.get("key") != key]
    entries.append({"key": key, "app": APP_ID, "user": user, "backend_port": bp, "frontend_port": fp,
                    "workspace": ws, "pid": os.getpid(), "started_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    _save_instances(entries)


def _unregister(user):
    _save_instances([e for e in _load_instances() if e.get("key") != f"{APP_ID}:{user}"])


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
    except Exception: pass


def find_python(conda_env):
    home = Path.home()
    for p in [
        home / "miniconda3" / "envs" / conda_env / "python.exe",
        home / "AppData" / "Local" / "miniconda3" / "envs" / conda_env / "python.exe",
        home / "anaconda3" / "envs" / conda_env / "python.exe",
        home / "miniconda3" / "envs" / conda_env / "bin" / "python",
        home / "anaconda3" / "envs" / conda_env / "bin" / "python",
        Path("/opt/conda") / "envs" / conda_env / "bin" / "python",
    ]:
        if p.exists(): return str(p)
    return sys.executable


def _bundled_node_bin():
    """Node.js embarque du bundle : <Computer_Vision_App>/node-v20.20.2-linux-x64/bin.
    Cherche en remontant depuis APP_ROOT (marche en bundle ; None sinon)."""
    p = APP_ROOT
    for _ in range(6):
        cand = p / "node-v20.20.2-linux-x64" / "bin"
        if (cand / "node").exists() or (cand / "npm").exists():
            return str(cand)
        p = p.parent
    return None


def npm_cmd(port, node_bin=None):
    if sys.platform == "win32": return ["cmd", "/c", "npm", "run", "dev", "--", "--port", str(port)]
    npm = str(Path(node_bin) / "npm") if node_bin and Path(node_bin, "npm").exists() else "npm"
    return [npm, "run", "dev", "--", "--port", str(port)]


def main():
    parser = argparse.ArgumentParser(description="Launch Dataset_Explorer_App")
    parser.add_argument("--user",      required=True,  help="Session username (required)")
    parser.add_argument("--workspace", required=True,  help="Workspace base dir. Final = <workspace>/<app>_<user>/")
    parser.add_argument("--conda-env",     default="IA_env")
    parser.add_argument("--backend-port",  type=int, default=None)
    parser.add_argument("--frontend-port", type=int, default=None)
    parser.add_argument("--backend-only",  action="store_true")
    parser.add_argument("--no-reload",     action="store_true")
    parser.add_argument("--access-log",    action="store_true", help="Enable uvicorn per-request access logs")
    parser.add_argument("--native-share-host", default=None,
                        help="Nom DNS/IP du partage natif vu par le client")
    args = parser.parse_args()

    ws_base = Path(args.workspace)
    if not ws_base.is_absolute():
        ws_base = Path.cwd() / ws_base
    ws_path = ws_base / f"{APP_ID}_{args.user}"
    legacy_ws = ws_base / f"visu_{args.user}"
    if legacy_ws.exists() and not ws_path.exists():
        legacy_ws.rename(ws_path)
        print(f"[migration] workspace Dataset Explorer: {legacy_ws} -> {ws_path}", flush=True)
    legacy_db = ws_path / ("visu" + "_bdd.db")
    current_db = ws_path / "dataset_explorer.db"
    if legacy_db.exists() and not current_db.exists():
        legacy_db.rename(current_db)
        print(f"[migration] base Dataset Explorer: {legacy_db.name} -> {current_db.name}", flush=True)
    ws = str(ws_path)

    Path(ws).mkdir(parents=True, exist_ok=True)
    _append_history(ws, args.user)

    fd = _acquire_lock()
    try:
        if args.backend_port and args.frontend_port:
            bp, fp = args.backend_port, args.frontend_port
        else:
            inst = _load_instances()
            claimed: set = {e.get("backend_port") for e in inst} | \
                           {e.get("frontend_port") for e in inst}
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
    env = {**os.environ,
           "EXPLORER_WORKSPACE": ws, "EXPLORER_USER": args.user, "EXPLORER_FRONTEND_PORT": str(fp),
           "BACKEND_PORT": str(bp), "VITE_BACKEND_PORT": str(bp), "VITE_FRONTEND_PORT": str(fp),
           "VITE_IA_USER": args.user, "IA_USER": args.user, "IA_APP_ID": APP_ID,
           "IA_INSTANCES_FILE": str(_INSTANCES_FILE), "IA_WORKSPACE_HISTORY_FILE": str(_HISTORY_FILE)}
    if args.native_share_host:
        env["NATIVE_SHARE_HOST"] = args.native_share_host
    if node_bin:
        env["PATH"] = node_bin + os.pathsep + env.get("PATH", os.environ.get("PATH", ""))

    print("=" * 60); print(f"  Dataset_Explorer_App — {args.user}"); print("=" * 60)
    print(f"[config] workspace = {ws}")
    print(f"[config] backend   = http://localhost:{bp}")
    print(f"[config] frontend  = http://localhost:{fp}")
    print(f"[config] python    = {python_exe}")

    backend_cmd = [python_exe, "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", str(bp)]
    if not args.access_log: backend_cmd.append("--no-access-log")
    if not args.no_reload: backend_cmd.append("--reload")

    backend_proc = subprocess.Popen(backend_cmd, cwd=str(APP_ROOT), env=env)
    for _ in range(60):
        time.sleep(1)
        if not is_port_free(bp): break
    else: print("[backend] Still starting, continuing anyway...")

    frontend_proc = None
    if not args.backend_only:
        frontend_proc = subprocess.Popen(npm_cmd(fp, node_bin), cwd=str(APP_ROOT / "frontend"), env=env)
        time.sleep(2)

    print(f"\n  Backend  : http://localhost:{bp}")
    if frontend_proc: print(f"  Frontend : http://localhost:{fp}")
    print(f"  Ctrl+C pour arreter"); print("=" * 60 + "\n")

    def _stop(sig=None, frame=None):
        _unregister(args.user)
        for p in filter(None, [backend_proc, frontend_proc]):
            _kill_tree(p)
        sys.exit(0)

    signal.signal(signal.SIGINT, _stop); signal.signal(signal.SIGTERM, _stop)
    try:
        while True:
            if backend_proc.poll() is not None: _stop()
            if frontend_proc and frontend_proc.poll() is not None: _stop()
            time.sleep(2)
    except KeyboardInterrupt: _stop()


if __name__ == "__main__":
    main()
