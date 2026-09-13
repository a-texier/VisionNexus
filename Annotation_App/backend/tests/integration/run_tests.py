#!/usr/bin/env python3
# ============================================================
# backend/tests/integration/run_tests.py — Annotation App
#
# Usage :
#   python backend/tests/integration/run_tests.py
#   python backend/tests/integration/run_tests.py --fast      # 3 users
#   python backend/tests/integration/run_tests.py --keep-ws   # conserver workspaces
# ============================================================

import os
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).parent
ROOT_DIR = THIS_DIR.parent.parent.parent  # Annotation_App/
PYTHON   = sys.executable

FAST    = "--fast"    in sys.argv
KEEP_WS = "--keep-ws" in sys.argv

n_users = "3" if FAST else "10"

env = os.environ.copy()
env["MULTIUSER_N_USERS"]   = n_users
env["MULTIUSER_BASE_PORT"] = "8020"   # 8020-8029 (evite conflit avec Dataset Explorer 8010-8019)
env["MULTIUSER_TIMEOUT"]   = "30"     # Annotation App demarre plus vite (pas de CLIP)
env["MULTIUSER_KEEP_WS"]   = "1" if KEEP_WS else "0"

cmd = [
    PYTHON, "-m", "pytest",
    str(THIS_DIR),     # uniquement les tests integration
    "-v",
    "--tb=short",
    "-m", "multiuser",
    "--no-header",
]

print("=" * 62)
print(f"  Tests multiuser Annotation App — {n_users} users")
print(f"  Ports        : 8020 - {8020 + int(n_users) - 1}")
print(f"  Timeout      : {env['MULTIUSER_TIMEOUT']}s par backend")
print(f"  Keep workspaces : {KEEP_WS}")
print("=" * 62 + "\n")

result = subprocess.run(cmd, cwd=str(ROOT_DIR), env=env)
sys.exit(result.returncode)
