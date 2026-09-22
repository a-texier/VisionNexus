from __future__ import annotations

import os
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent
CV_ROOT = APP_ROOT.parent
DEFAULT_CONFIG_FILE = APP_ROOT / "config" / "defaults.yaml"
WORKSPACE = Path(os.environ.get("INFERENCE_APP_WORKSPACE", APP_ROOT / "data")).resolve()
RUNS_DIR = WORKSPACE / "runs"
UPLOADS_DIR = WORKSPACE / "uploads"
CURRENT_USER = os.environ.get("INFERENCE_APP_USER", "unknown")
USER_CONFIG_FILE = WORKSPACE / "config.yaml"
FRONTEND_PORT = int(os.environ.get("INFERENCE_APP_FRONTEND_PORT", "5177"))

for directory in (WORKSPACE, RUNS_DIR, UPLOADS_DIR):
    directory.mkdir(parents=True, exist_ok=True)

CORS_ORIGINS = [
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
]
