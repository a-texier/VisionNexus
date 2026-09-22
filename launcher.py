#!/usr/bin/env python3
"""
launcher.py -- Unified launcher for all IA-Apps.

Launch one or several apps with a single command.
Both --user and --workspace are REQUIRED.
To launch the full CV stack, use the Orchestrator_App UI.

Usage:
  python launcher.py --app annotation --workspace D:/ws --user alice
  python launcher.py --app explorer       --workspace D:/ws --user vic
  python launcher.py --app annotation explorer compare --workspace D:/ws --user alice
  python launcher.py --app 3d meshy   --workspace D:/ws --user alice --backend-only
  python launcher.py --app annotation --workspace D:/ws --user alice --backend-port 8010 --frontend-port 5200

Available apps:
  CV MLOps   : orchestrator, dvc, mlflow, optuna

Workspace convention:
  Final workspace = <workspace>/<app_id>_<user>
  Example: --workspace D:/ws --user alice --app annotation  ->  D:/ws/annotation_alice
"""

import argparse
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _lib.launcher_engine import (
    APP_REGISTRY,
    launch_app,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="launcher.py",
        description="Unified IA-App launcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python launcher.py --app annotation --workspace D:/ws --user alice
  python launcher.py --app explorer       --workspace D:/ws --user vic
  python launcher.py --app annotation explorer compare --workspace D:/ws --user alice
  python launcher.py --app 3d --workspace D:/ws --user alice --backend-only
  python launcher.py --app annotation --workspace D:/ws --user alice --backend-port 8010 --frontend-port 5200

Workspace convention: <workspace>/<app_id>_<user>  (e.g. D:/ws/annotation_alice)
        """,
    )

    p.add_argument(
        "--app", nargs="+", required=True,
        choices=list(APP_REGISTRY.keys()),
        metavar="APP",
        help="App(s) to launch",
    )
    p.add_argument("--workspace",     required=True,  help="Workspace base dir")
    p.add_argument("--user",          required=True,  help="Session username (required)")
    p.add_argument("--conda-env",     default="IA_env",    dest="conda_env")
    p.add_argument("--conda-path",    default=None,        dest="conda_path",
                   help="Chemin explicite de l'env conda (racine env, bin/activate "
                        "ou executable python). Prioritaire sur --conda-env. "
                        "Renseigne dans les settings VisionNexus.")
    p.add_argument("--backend-only",  action="store_true", dest="backend_only",
                   help="Start backends only (no npm frontend)")
    p.add_argument("--no-reload",     action="store_true", dest="no_reload",
                   help="Disable uvicorn --reload")
    p.add_argument("--backend-port",  type=int, default=None, dest="backend_port",
                   help="Override backend port (single --app only)")
    p.add_argument("--frontend-port", type=int, default=None, dest="frontend_port",
                   help="Override frontend port (single --app only)")
    p.add_argument("--native-share-host", default=None, dest="native_share_host",
                   help="Nom DNS/IP du partage natif vu par le client. Vide = HTTP uniquement.")
    return p.parse_args()


# ------------------------------------------------------------------ #
# Main                                                                #
# ------------------------------------------------------------------ #

def main() -> None:
    args = parse_args()

    if len(args.app) > 1 and (args.backend_port or args.frontend_port):
        print("[error] --backend-port / --frontend-port can only be used with a single --app.")
        sys.exit(1)

    sessions = []
    for app_id in args.app:
        session = launch_app(
            app_id=app_id,
            workspace=args.workspace,
            user=args.user,
            conda_env=args.conda_env,
            conda_path=args.conda_path,
            backend_only=args.backend_only,
            no_reload=args.no_reload,
            base_backend_port=args.backend_port,
            base_frontend_port=args.frontend_port,
            extra_env_overrides=(
                {"NATIVE_SHARE_HOST": args.native_share_host}
                if args.native_share_host else None
            ),
        )
        sessions.append(session)

    if not sessions:
        print("[error] No sessions started.")
        sys.exit(1)

    n = len(sessions)
    print(f"\n[launcher] {n} app(s) running. Press Ctrl+C to stop all.")

    def _shutdown(sig=None, frame=None):
        print("\n[launcher] Stopping all apps...")
        for s in sessions:
            s.shutdown()
        print("[launcher] All stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        while True:
            for s in sessions:
                if s.backend_proc.poll() is not None:
                    print(f"[launcher] {s.app_id} backend exited unexpectedly.")
                    _shutdown()
                if s.frontend_proc and s.frontend_proc.poll() is not None:
                    print(f"[launcher] {s.app_id} frontend exited unexpectedly.")
                    _shutdown()
            time.sleep(2)
    except KeyboardInterrupt:
        _shutdown()


if __name__ == "__main__":
    main()
