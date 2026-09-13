#!/usr/bin/env python3
"""
run_all_scenarios.py
Lancement automatique de SC1, SC2, SC3, SC4 pour Bob et Alice.

Ordre d'execution par user :
  1. SC3 (pipeline complet, full_auto=True, SAM3) -> cree le subset + export annotation
  2. SC4, SC1, SC2 en parallele (SC1/SC2 reutilisent les donnees de SC3)

Isolation : chaque user a son propre orchestrateur + ses propres instances
             Dataset_Explorer_App / Annotation_App / DVC_App / MLflow_App.

Usage : python run_all_scenarios.py
"""

import asyncio
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx


# -- Configuration -------------------------------------------------------------

# Chemins relatifs (aucun chemin en dur) : ce fichier vit dans
#   <base>/Computer_Vision_App/Orchestrator_App/run_all_scenarios.py
# donc <base> = parents[2]. Launchers/ et All_workspaces/ sont freres de
# Computer_Vision_App/ sous <base> — robuste au deplacement du dossier.
_BASE        = Path(__file__).resolve().parents[2]
# launcher global désormais dans Computer_Vision_App/ (= parents[1])
_LAUNCHER    = Path(__file__).resolve().parents[1] / "launcher.py"
_WS          = _BASE / "All_workspaces"        # workspaces users (inchangé)
# Registre partagé unifié : Computer_Vision_App/.run/ (= parents[1]/.run).
# Doit correspondre aux launchers + _lib/launcher_engine.py + utils/free_ports.py.
_INSTANCES   = Path(__file__).resolve().parents[1] / ".run" / ".instances.json"
_SCREENSHOTS = str(Path.home() / "Pictures" / "Screenshots")
_CONDA_ENV   = "IA_env"

USERS = {
    "bob":   {"dataset_name": "screen", "embed_wait_s": 60},
    "alice": {"dataset_name": "screen", "embed_wait_s": 120},
}

# Alice's run starts ALICE_START_DELAY seconds after Bob's.
# This ensures Bob's sub-apps (explorer on 8001, Annotation on 8000) are already
# listening before Alice's auto-launcher scans for free ports.
ALICE_START_DELAY = 60.0


# -- Python executable ---------------------------------------------------------

def _python() -> str:
    home = Path.home()
    for p in [
        home / "miniconda3" / "envs" / _CONDA_ENV / "python.exe",
        home / "AppData" / "Local" / "miniconda3" / "envs" / _CONDA_ENV / "python.exe",
        home / "anaconda3" / "envs" / _CONDA_ENV / "python.exe",
    ]:
        if p.exists():
            return str(p)
    return sys.executable


PYTHON = _python()


# -- Instance helpers ----------------------------------------------------------

def _is_port_free(port: int) -> bool:
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0


def _pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x400, False, pid)
        if h:
            ctypes.windll.kernel32.CloseHandle(h)
            return True
        return False
    try:
        import os
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _load_instances() -> list:
    try:
        if _INSTANCES.exists():
            entries = json.loads(_INSTANCES.read_text(encoding="utf-8"))
            return [e for e in entries if _pid_alive(e.get("pid", 0))]
    except Exception:
        pass
    return []


def _find_running_orchestrator(user: str) -> dict | None:
    for e in _load_instances():
        if e.get("app") == "orchestrator" and e.get("user") == user:
            return e
    return None


# -- Launch helpers ------------------------------------------------------------

def start_orchestrator(user: str) -> subprocess.Popen:
    """Spawn launcher.py in background for the given user. Returns Popen handle."""
    log = open(f"logs_{user}.txt", "w", encoding="utf-8")
    cmd = [
        PYTHON, str(_LAUNCHER),
        "--app", "orchestrator",
        "--user", user,
        "--workspace", str(_WS),
        "--backend-only",
        "--no-reload",
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=log,
        stderr=log,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )
    return proc


def get_port(user: str, timeout: float = 90.0) -> int:
    """Poll .instances.json until orchestrator:{user} is registered."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        e = _find_running_orchestrator(user)
        if e:
            return int(e["backend_port"])
        time.sleep(0.5)
    raise RuntimeError(f"Port for orchestrator:{user} not found after {timeout}s")


def kill_proc(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True, timeout=10,
            )
        else:
            proc.terminate()
    except Exception:
        pass


# -- Graph node / edge builders ------------------------------------------------

def _n(nid: str, ntype: str, rf_type: str, x: int, y: int, **kw) -> dict:
    return {
        "id": nid, "type": rf_type,
        "position": {"x": x, "y": y},
        "data": {"node_type": ntype, **kw},
    }


def _e(src: str, tgt: str) -> dict:
    return {"id": f"e_{src}_{tgt}", "source": src, "target": tgt}


def graph_sc3(dataset_name: str, subset_name: str, project_name: str) -> dict:
    """Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto=True, SAM3) -> MLflow -> DVC"""
    return {
        "name": "SC3 -- Pipeline auto avec gates humaines",
        "nodes": [
            _n("ds1", "dataset_source", "datasetSourceNode", 50,   200,
               dataset_name=dataset_name, dataset_path=_SCREENSHOTS, n_clusters=15),
            _n("v1",  "explorer",           "appNode",           350,  200,
               dataset_name=dataset_name,
               subset_name=subset_name, query="screen capture interface"),
            _n("a1",  "annotation",     "appNode",           650,  200,
               subset_name=subset_name, project_name=project_name,
               annotation_mode="sequence", full_auto=True,
               ai_model="sam3", ai_text="window", ai_threshold=0.2,
               split_train=0.8, split_val=0.2),
            _n("m1",  "mlflow",         "appNode",           950,  200),
            _n("d1",  "dvc",            "appNode",           1250, 200,
               commit_message="feat: sc3 auto pipeline"),
        ],
        "edges": [_e("ds1","v1"), _e("v1","a1"), _e("a1","m1"), _e("m1","d1")],
    }


def graph_sc4(dataset_name: str, subset_name: str, project_name: str) -> dict:
    """Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto=False) -> MLflow -> DVC"""
    return {
        "name": "SC4 -- Pipeline entierement manuel",
        "nodes": [
            _n("ds1", "dataset_source", "datasetSourceNode", 50,   200,
               dataset_name=dataset_name, dataset_path=_SCREENSHOTS, n_clusters=15),
            _n("v1",  "explorer",           "appNode",           350,  200,
               dataset_name=dataset_name,
               subset_name=subset_name, query="screen capture interface"),
            _n("a1",  "annotation",     "appNode",           650,  200,
               subset_name=subset_name, project_name=project_name,
               annotation_mode="sequence", full_auto=False,
               split_train=0.8, split_val=0.2),
            _n("m1",  "mlflow",         "appNode",           950,  200),
            _n("d1",  "dvc",            "appNode",           1250, 200,
               commit_message="feat: sc4 manual pipeline"),
        ],
        "edges": [_e("ds1","v1"), _e("v1","a1"), _e("a1","m1"), _e("m1","d1")],
    }


def graph_sc1(subset_name: str, project_name: str) -> dict:
    """explorer FREE (no incoming edge) -> Annotation LOCKED -> DVC"""
    return {
        "name": "SC1 -- Exploration depuis subset existant",
        "nodes": [
            _n("v1", "explorer",       "appNode", 50,  200, subset_name=subset_name),
            _n("a1", "annotation", "appNode", 350, 200,
               subset_name=subset_name, project_name=project_name,
               annotation_mode="sequence", full_auto=False,
               split_train=0.8, split_val=0.2),
            _n("d1", "dvc",       "appNode", 650, 200,
               commit_message="feat: sc1 from existing subset"),
        ],
        "edges": [_e("v1","a1"), _e("a1","d1")],
    }


def graph_sc2(project_name: str, subset_name: str) -> dict:
    """Annotation FREE (no incoming edge) -> MLflow LOCKED -> DVC"""
    return {
        "name": "SC2 -- Training depuis annotation existante",
        "nodes": [
            _n("a1", "annotation", "appNode", 50,  200,
               project_name=project_name, subset_name=subset_name),
            _n("m1", "mlflow",     "appNode", 350, 200),
            _n("d1", "dvc",       "appNode", 650, 200,
               commit_message="feat: sc2 from existing annotation"),
        ],
        "edges": [_e("a1","m1"), _e("m1","d1")],
    }


# -- API helpers ---------------------------------------------------------------

async def wait_healthy(url: str, max_wait: int = 120) -> bool:
    deadline = time.time() + max_wait
    async with httpx.AsyncClient(timeout=5) as c:
        while time.time() < deadline:
            try:
                r = await c.get(f"{url}/health")
                if r.status_code < 500:
                    return True
            except Exception:
                pass
            await asyncio.sleep(2)
    return False


async def create_graph(base_url: str, g: dict) -> str:
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{base_url}/api/graphs", json=g)
        r.raise_for_status()
        return r.json()["graph_id"]


async def run_and_resume(
    base_url: str,
    gid: str,
    label: str,
    verifyembed_delay: float = 5.0,
    resume_delay: float = 3.0,
    max_wait: int = 1200,
) -> str:
    """
    Start graph gid then consume its SSE stream, auto-resuming every human gate.

    Strategy: graph_store status is only updated via SSE side-effects, so polling
    GET /api/graphs alone never sees 'waiting'/'done'. Instead we read the SSE
    stream directly; 'waiting' + 'end' events trigger a resume+reconnect loop.

    Returns: "done" | "failed" | "timeout" | "start_error(N)".
    """
    # -- Start the run ---------------------------------------------------------
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{base_url}/api/graphs/{gid}/run")
        if r.status_code >= 400:
            msg = f"start_error({r.status_code})"
            print(f"  [{label}] {msg}: {r.text[:200]}")
            return msg
        run_id = r.json()["run_id"]
    print(f"  [{label}] Run started (run_id={run_id}).")

    stream_url      = f"{base_url}/api/graphs/{gid}/run/{run_id}/stream"
    deadline        = time.time() + max_wait
    verifyembed_done = False
    gates_resumed   = 0

    while time.time() < deadline:
        waiting_step = None   # step_id of the most recent 'waiting' event
        waiting_delay = 0.0

        try:
            remaining = int(deadline - time.time())
            async with httpx.AsyncClient(timeout=remaining + 10) as c:
                async with c.stream("GET", stream_url, timeout=remaining + 10) as resp:
                    async for raw in resp.aiter_lines():
                        if not raw.startswith("data:"):
                            continue
                        payload = raw[5:].strip()
                        if not payload:
                            continue
                        try:
                            evt = json.loads(payload)
                        except Exception:
                            continue

                        evt_type  = evt.get("type", "")
                        step_id   = evt.get("step_id", "")
                        status    = evt.get("status", "")

                        # Terminal: pipeline finished
                        if evt_type == "done":
                            final = "done" if status in ("success", "done") else "failed"
                            print(f"  [{label}] {final.upper()} (gates={gates_resumed})")
                            return final

                        # Human gate encountered
                        if evt_type == "waiting":
                            is_ve = step_id.endswith("__verifyembed")
                            waiting_step  = step_id
                            waiting_delay = (
                                verifyembed_delay if (is_ve and not verifyembed_done)
                                else resume_delay
                            )
                            if is_ve and not verifyembed_done and waiting_delay > 10:
                                print(f"  [{label}] Gate '{step_id}' -- "
                                      f"waiting {waiting_delay:.0f}s for embedding...")
                            else:
                                print(f"  [{label}] Gate '{step_id}' -- "
                                      f"resuming in {waiting_delay:.0f}s...")

                        # Stream closed (after 'waiting' or 'done')
                        if evt_type == "end":
                            break

        except Exception as ex:
            print(f"  [{label}] SSE error: {ex}")
            await asyncio.sleep(5)
            continue

        # After 'end': if we were at a gate, sleep + resume + reconnect
        if waiting_step:
            await asyncio.sleep(waiting_delay)
            try:
                async with httpx.AsyncClient(timeout=30) as c2:
                    r2 = await c2.post(f"{base_url}/api/graphs/{gid}/resume")
                    if r2.status_code == 202:
                        gates_resumed += 1
                        if waiting_step.endswith("__verifyembed"):
                            verifyembed_done = True
                        print(f"  [{label}] Resumed gate #{gates_resumed} ('{waiting_step}').")
                        # Reconnect SSE to continue
                        continue
                    elif r2.status_code == 410:
                        print(f"  [{label}] Server restart -- resetting and re-running...")
                        await c2.post(f"{base_url}/api/graphs/{gid}/reset")
                        await asyncio.sleep(3)
                        r3 = await c2.post(f"{base_url}/api/graphs/{gid}/run")
                        if r3.status_code == 202:
                            run_id     = r3.json()["run_id"]
                            stream_url = f"{base_url}/api/graphs/{gid}/run/{run_id}/stream"
                        continue
                    else:
                        print(f"  [{label}] Resume {r2.status_code}: {r2.text[:120]}")
            except Exception as ex:
                print(f"  [{label}] Resume error: {ex}")
                await asyncio.sleep(5)
                continue
        else:
            # Stream ended without a waiting event and without 'done' --
            # either the run already finished before we connected, or a glitch.
            await asyncio.sleep(3)
            # Check graph state directly as fallback
            try:
                async with httpx.AsyncClient(timeout=10) as c3:
                    rg = await c3.get(f"{base_url}/api/graphs/{gid}")
                    gs = rg.json().get("status", "")
                    if gs == "done":
                        print(f"  [{label}] DONE (detected via fallback poll)")
                        return "done"
                    if gs == "failed":
                        print(f"  [{label}] FAILED (detected via fallback poll)")
                        return "failed"
            except Exception:
                pass

    print(f"  [{label}] TIMEOUT after {max_wait}s")
    return "timeout"


# -- Per-user orchestration ----------------------------------------------------

async def run_user(user: str, base_url: str, cfg: dict, start_delay: float = 0) -> dict:
    if start_delay > 0:
        print(f"[{user}] Staggering start by {start_delay:.0f}s...")
        await asyncio.sleep(start_delay)

    dname      = cfg["dataset_name"]
    embed_wait = float(cfg["embed_wait_s"])
    results    = {}

    # Unique scenario names -- isolated per-user via separate sub-app workspaces
    SC3_SUBSET   = "auto_subset"
    SC3_PROJECT  = "sc3_project"
    SC4_SUBSET   = "manual_subset"
    SC4_PROJECT  = "sc4_project"
    SC1_PROJECT  = "sc1_project"

    print(f"\n[{user}] Creating SC3 and SC4 graphs...")
    gid_sc3 = await create_graph(base_url, graph_sc3(dname, SC3_SUBSET, SC3_PROJECT))
    gid_sc4 = await create_graph(base_url, graph_sc4(dname, SC4_SUBSET, SC4_PROJECT))
    print(f"[{user}]  SC3={gid_sc3}  SC4={gid_sc4}")

    # -- Step 1: SC3 (provides auto_subset + sc3_project export for SC1/SC2) ---
    print(f"[{user}] === Running SC3 ===")
    sc3_status = await run_and_resume(
        base_url, gid_sc3, f"{user}/SC3",
        verifyembed_delay=embed_wait,
        resume_delay=3.0,
        max_wait=1800,  # SAM3 annotation can be slow
    )
    results["SC3"] = sc3_status

    # -- Step 2: Create SC1/SC2 (use data from SC3) ----------------------------
    print(f"[{user}] Creating SC1 and SC2 graphs (using SC3 data)...")
    gid_sc1 = await create_graph(base_url, graph_sc1(SC3_SUBSET, SC1_PROJECT))
    gid_sc2 = await create_graph(base_url, graph_sc2(SC3_PROJECT, SC3_SUBSET))
    print(f"[{user}]  SC1={gid_sc1}  SC2={gid_sc2}")

    # -- Step 3: SC4, SC1, SC2 concurrently ------------------------------------
    # Dataset is already loaded/embedded after SC3 -> verifyembed gate can be
    # resumed quickly.
    print(f"[{user}] === Running SC4 + SC1 + SC2 in parallel ===")
    sc4_s, sc1_s, sc2_s = await asyncio.gather(
        run_and_resume(base_url, gid_sc4, f"{user}/SC4",
                       verifyembed_delay=5.0, max_wait=900),
        run_and_resume(base_url, gid_sc1, f"{user}/SC1",
                       resume_delay=3.0,     max_wait=600),
        run_and_resume(base_url, gid_sc2, f"{user}/SC2",
                       resume_delay=3.0,     max_wait=600),
    )
    results["SC4"] = sc4_s
    results["SC1"] = sc1_s
    results["SC2"] = sc2_s
    return results


# -- Main ----------------------------------------------------------------------

async def main() -> None:
    hr = "=" * 66
    print(hr)
    print("  run_all_scenarios.py -- SC1-SC4 ? Bob + Alice")
    print(hr)

    # -- Check that launcher exists --------------------------------------------
    if not _LAUNCHER.exists():
        print(f"[FATAL] Launcher not found: {_LAUNCHER}")
        return

    # -- Reuse or start orchestrators ------------------------------------------
    procs: dict[str, subprocess.Popen | None] = {"bob": None, "alice": None}
    urls:  dict[str, str] = {}

    for user in ("bob", "alice"):
        existing = _find_running_orchestrator(user)
        if existing:
            port = existing["backend_port"]
            print(f"[launch] Found running orchestrator:{user} on port {port} -- reusing.")
            urls[user] = f"http://localhost:{port}"
        else:
            print(f"[launch] Starting orchestrator:{user}...")
            procs[user] = start_orchestrator(user)
            time.sleep(1)  # small gap so port-lock file doesn't collide

    # Read ports for freshly started instances
    for user in ("bob", "alice"):
        if user not in urls:
            port = get_port(user)
            urls[user] = f"http://localhost:{port}"
            print(f"[launch] {user} -> {urls[user]}")

    # -- Wait for backends to be healthy ---------------------------------------
    print("[health] Waiting for orchestrator backends...")
    bob_ok, alice_ok = await asyncio.gather(
        wait_healthy(urls["bob"],   max_wait=120),
        wait_healthy(urls["alice"], max_wait=120),
    )
    for user, ok in [("bob", bob_ok), ("alice", alice_ok)]:
        if not ok:
            print(f"[FATAL] {user}'s orchestrator did not become healthy.")
            for p in procs.values():
                if p:
                    kill_proc(p)
            return
    print("[health] Both backends ready OK")

    # -- Run scenarios ---------------------------------------------------------
    print(f"\n[run] Bob starts immediately; Alice staggered by {ALICE_START_DELAY:.0f}s.")
    bob_task   = asyncio.create_task(
        run_user("bob",   urls["bob"],   USERS["bob"],   start_delay=0))
    alice_task = asyncio.create_task(
        run_user("alice", urls["alice"], USERS["alice"], start_delay=ALICE_START_DELAY))

    bob_results, alice_results = await asyncio.gather(bob_task, alice_task)

    # -- Summary ---------------------------------------------------------------
    print("\n" + hr)
    print("  RESULTATS")
    print(hr)
    all_ok = True
    for user, results in [("bob", bob_results), ("alice", alice_results)]:
        for sc in ("SC3", "SC4", "SC1", "SC2"):
            s    = results.get(sc, "not_run")
            ok   = s == "done"
            all_ok = all_ok and ok
            icon = "OK" if ok else "FAIL"
            print(f"  {icon} {user}/{sc}: {s}")
    print(hr)
    print(f"  {'TOUS LES SCENARIOS OK OK' if all_ok else 'ECHECS DETECTES FAIL'}")
    print(hr + "\n")

    # -- Cleanup (only kill processes we started) ------------------------------
    for user, proc in procs.items():
        if proc is not None:
            print(f"[cleanup] Stopping orchestrator:{user}...")
            kill_proc(proc)
    print("[cleanup] Done.")


if __name__ == "__main__":
    asyncio.run(main())
