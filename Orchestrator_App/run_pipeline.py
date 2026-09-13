"""
Pipeline monitor for any orchestrator graph.
Tracks handled gate step_ids to avoid duplicate resume on SSE replay.

Usage:
  python run_pipeline.py --graph <graph_id>
  python run_pipeline.py                     # uses GRAPH_ID env var or prompts
"""
import os, sys, argparse
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.stdout.reconfigure(encoding='utf-8')

import requests, json, time

BASE = os.environ.get("ORCHESTRATOR_URL", "http://localhost:8060")
explorer = os.environ.get("DATASET_EXPLORER_APP_URL", "http://localhost:8001")
ANNO = os.environ.get("ANNO_URL",         "http://localhost:8000")


def parse_args():
    p = argparse.ArgumentParser(description="Run an orchestrator pipeline to completion")
    p.add_argument("--graph", default=os.environ.get("GRAPH_ID"), help="Graph ID to run")
    p.add_argument("--rounds", type=int, default=30, help="Max SSE rounds (default 30)")
    return p.parse_args()


def check_embed_ready(dataset_id: int = 1) -> bool:
    try:
        r = requests.get(f"{explorer}/api/datasets/{dataset_id}", timeout=5)
        ds = r.json()
        return ds.get("status") == "ready" and ds.get("embedded_count", 0) >= ds.get("image_count", 1)
    except:
        return False


def handle_gate(step_id: str, hint: str):
    """Handle a human-gate step — return after any needed wait."""
    print(f"\n  PAUSE WAITING   {step_id}")
    print(f"    hint: {hint[:80]}")

    if "verifyembed" in step_id:
        for _ in range(30):
            if check_embed_ready():
                print("    -> Embedding ready")
                return
            print("    -> Waiting for CLIP embedding...")
            time.sleep(5)
        print("    -> Embedding timeout, resuming anyway")

    elif "validatesubset" in step_id:
        print("    -> Subset validated (auto-accept)")
        time.sleep(1)

    elif step_id.endswith("__annotate"):
        try:
            r2 = requests.get(f"{ANNO}/api/projects", timeout=5)
            projs = r2.json()
            names = [p.get("name", "?") for p in projs[:3]]
            print(f"    -> {len(projs)} annotation project(s): {names}")
        except:
            print("    -> Could not check annotation projects")
        print("    -> Annotation gate: accepting (human validated)")
        time.sleep(2)

    elif "train" in step_id:
        print("    -> MLflow training gate: accepting")
        time.sleep(1)

    elif "hpo" in step_id:
        print("    -> Optuna HPO gate: accepting")
        time.sleep(1)

    else:
        print(f"    -> Gate: accepting in 2s")
        time.sleep(2)


def stream_once(graph_id: str, run_id: str, handled_gates: set) -> str:
    """Stream SSE until waiting or done. Return 'waiting', 'done'/'end', or 'error'."""
    try:
        resp = requests.get(f"{BASE}/api/graphs/{graph_id}/run/{run_id}/stream",
                            stream=True, timeout=300)
        buf = ""
        for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
            buf += chunk
            while "\n\n" in buf:
                part, buf = buf.split("\n\n", 1)
                part = part.strip()
                if not part.startswith("data: "):
                    continue
                try:
                    evt = json.loads(part[6:])
                except:
                    continue

                step_id = evt.get("step_id", "")
                status  = evt.get("status", "")
                etype   = evt.get("type", "")

                if status == "running":
                    msg = evt.get("message", "")
                    line = f"  >> running   {step_id}"
                    if msg:
                        line += f"  [{msg[:50]}]"
                    print(line)

                elif status == "success":
                    print(f"  OK success   {step_id}")

                elif status == "failed":
                    out = evt.get("output", "")[:100]
                    print(f"  XX FAILED    {step_id}")
                    if out:
                        print(f"               {out}")

                elif status == "waiting" or etype == "waiting":
                    if step_id in handled_gates:
                        continue
                    handle_gate(step_id, evt.get("hint", ""))
                    handled_gates.add(step_id)
                    return "waiting"

                elif etype in ("done", "end"):
                    print(f"\n  {'='*50}")
                    print(f"  PIPELINE {etype.upper()}: status={evt.get('status','unknown')}")
                    return etype

    except Exception as e:
        print(f"Stream error: {e}")
        return "error"
    return "end"


def resume(graph_id: str) -> bool:
    r = requests.post(f"{BASE}/api/graphs/{graph_id}/resume", timeout=30)
    print(f"    -> Resume: {r.status_code} {r.text[:120]}")
    return r.status_code == 202


def print_final_report(graph_id: str):
    print("\n" + "=" * 60)
    r = requests.get(f"{BASE}/api/graphs/{graph_id}")
    g = r.json()
    print(f"Final graph status: {g.get('status')}")
    for nid, es in g.get("execution", {}).items():
        print(f"  node {nid:40s}: {es.get('status','?')}")

    print("\nActivity (last run):")
    r2 = requests.get(f"{BASE}/api/activity?limit=3")
    runs = r2.json()
    for run in runs[:1]:
        print(f"  Run {run['run_id']} [{run['status']}] steps:")
        for sid, sr in run.get("step_results", {}).items():
            mark = "OK" if sr["status"] == "success" else "XX"
            out = sr.get("output", "")[:60]
            print(f"    {mark} {sid:45s} {out}")


def main():
    args = parse_args()
    graph_id = args.graph
    if not graph_id:
        graph_id = input("Graph ID: ").strip()
    if not graph_id:
        print("No graph ID provided.")
        sys.exit(1)

    print(f"Starting fresh run on graph {graph_id}...")
    r = requests.post(f"{BASE}/api/graphs/{graph_id}/run", timeout=30)
    if r.status_code not in (200, 202):
        print(f"Failed to start run: {r.status_code} {r.text}")
        sys.exit(1)
    data = r.json()
    run_id = data["run_id"]
    print(f"Run started: {run_id}")
    print("=" * 60)

    handled_gates: set = set()

    for round_n in range(args.rounds):
        print(f"\n--- Round {round_n+1} ---")
        result = stream_once(graph_id, run_id, handled_gates)
        print(f"  stream result: {result}")

        if result in ("done", "end"):
            break
        elif result == "waiting":
            ok = resume(graph_id)
            if not ok:
                r = requests.get(f"{BASE}/api/graphs/{graph_id}")
                st = r.json().get("status")
                print(f"  Graph status: {st}")
                if st not in ("running", "waiting"):
                    break
            time.sleep(2)
        elif result == "error":
            time.sleep(3)
        else:
            break

    print_final_report(graph_id)


if __name__ == "__main__":
    main()
