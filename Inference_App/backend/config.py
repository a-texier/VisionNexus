# ============================================================
# config.py -- Inference_App
# Wrap du tracker VisionNexus (MOT/SOT) en IHM web + noeud orchestrateur.
# Workspace configurable via INFERENCE_APP_WORKSPACE.
# ============================================================

import os
from pathlib import Path

# ---- Racines ----
APP_ROOT     = Path(__file__).parent.parent.resolve()   # Inference_App/
TRACKER_ROOT = APP_ROOT / "tracker"                     # copie VisionNexus

# ---- Workspace ----
_default_workspace = APP_ROOT / "data"
WORKSPACE = Path(os.environ.get("INFERENCE_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

DATA_DIR = WORKSPACE

# ---- Sous-dossiers (routent les sorties du tracker vers le workspace) ----
RUNS_DIR         = WORKSPACE / "runs"          # run_dir de chaque session (benchmark, profiling...)
EXPORTS_DIR      = WORKSPACE / "exports"       # modeles exportes (.onnx, .engine) + bundles deploy
SEQUENCES_DIR    = WORKSPACE / "sequences"     # sequences locales de l'utilisateur
CMD_SEND_DIR     = WORKSPACE / "cmd_send"      # fichiers de clics enregistres (rejeu)
ACQUISITIONS_DIR = WORKSPACE / "acquisitions"  # datasets d'images captures depuis un flux (mode FREE)

for _d in (RUNS_DIR, EXPORTS_DIR, SEQUENCES_DIR, CMD_SEND_DIR, ACQUISITIONS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ---- Utilisateur ----
CURRENT_USER = os.environ.get("INFERENCE_APP_USER", "unknown")

# ---- Reseau ----
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",                 "8065"))
FRONTEND_PORT = int(os.environ.get("INFERENCE_APP_FRONTEND_PORT",  "5177"))

# Plage d'allocation des ports du serveur MJPEG (un par session concurrente).
STREAM_PORT_BASE = int(os.environ.get("INFERENCE_STREAM_PORT_BASE", "8090"))

# ---- CORS ----
_cors_origins: set[str] = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    "http://localhost:5177", "http://127.0.0.1:5177",
    "http://localhost:3000", "http://127.0.0.1:3000",
}
CORS_ORIGINS: list[str] = list(_cors_origins)
