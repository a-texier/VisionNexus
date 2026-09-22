#!/usr/bin/env python3
# ============================================================
# backend/tests/integration/run_tests.py
#
# Lanceur pratique pour les tests d'integration multiuser.
# Equivalent a appeler pytest directement, mais avec les
# bonnes options et variables d'environnement pre-configurees.
#
# Usage :
#   python backend/tests/integration/run_tests.py
#   python backend/tests/integration/run_tests.py --fast      # 3 users
#   python backend/tests/integration/run_tests.py --keep-ws   # conserver workspaces
#   python backend/tests/integration/run_tests.py --dataset "C:\chemin\imgs"
# ============================================================

import os
import subprocess
import sys
from pathlib import Path

THIS_DIR  = Path(__file__).parent
ROOT_DIR  = THIS_DIR.parent.parent.parent  # Dataset_Explorer_App/
PYTHON    = sys.executable

# --- Arguments personnalises ---
FAST     = "--fast"     in sys.argv   # 3 users au lieu de 10
KEEP_WS  = "--keep-ws"  in sys.argv
DATASET  = next(
    (sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--dataset"),
    None,
)

n_users = "3" if FAST else "10"

env = os.environ.copy()
env["MULTIUSER_N_USERS"]  = n_users
env["MULTIUSER_BASE_PORT"] = "8010"
env["MULTIUSER_TIMEOUT"]  = "90"
env["MULTIUSER_KEEP_WS"]  = "1" if KEEP_WS else "0"

if DATASET:
    env["TEST_DATASET_DIR"] = DATASET

# --- Construire la commande pytest ---
cmd = [
    PYTHON, "-m", "pytest",
    str(THIS_DIR),           # uniquement les tests integration
    "-v",
    "--tb=short",
    "-m", "multiuser",
    "--no-header",
]

print("=" * 62)
print(f"  Tests multiuser — {n_users} users en parallele")
print(f"  Dataset : {env.get('TEST_DATASET_DIR', '(non defini)')}")
print(f"  Timeout : {env['MULTIUSER_TIMEOUT']}s par backend")
print(f"  Keep workspaces : {KEEP_WS}")
print("=" * 62 + "\n")

result = subprocess.run(cmd, cwd=str(ROOT_DIR), env=env)
sys.exit(result.returncode)
