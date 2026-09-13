# ============================================================
# core/insights.py
# Genere, pour chaque run de graph, un dossier d'insights dans
# le workspace orchestrateur : WORKSPACE/insights/{graph_id}/{run_id}/
#   - insights.json  (donnees brutes agregees depuis les sous-apps)
#   - insights.md    (journal de comprehension lisible, rien de cache)
#   - *.png          (plots matplotlib : courbes training, gains,
#                     historique Optuna, timeline des noeuds)
# Appele automatiquement a la fin d'un run (event "done") et
# regenerable a la demande via POST /api/insights/{graph_id}/generate.
# ============================================================

import asyncio
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from backend.config import WORKSPACE
from backend.core import graph_store, experiment_store, proxy_client

logger = logging.getLogger(__name__)

INSIGHTS_DIR = WORKSPACE / "insights"


def _dir_for(graph_id: str, run_id: str) -> Path:
    d = INSIGHTS_DIR / graph_id / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json(raw):
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return None


# ── Collecte ──────────────────────────────────────────────────────────────────

async def _proxy_json(app: str, endpoint: str, params: dict | None = None):
    """Requête GET DIRECTE vers l'app (httpx), SANS passer par proxy_client qui
    tronque les réponses à 4000 caractères — ce qui cassait la collecte des
    listes de runs et des historiques par epoch (bug collecte, test Fable 2026-07)."""
    import httpx
    from backend.config import APP_URLS
    base = APP_URLS.get(app)
    if not base:
        return None
    if not endpoint.startswith("/api"):
        endpoint = f"/api{endpoint}" if endpoint.startswith("/") else f"/api/{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.get(f"{base}{endpoint}", params=params or None)
            if r.status_code < 400:
                return r.json()
    except Exception as exc:
        logger.warning("insights: GET %s %s a echoue: %s", app, endpoint, exc)
    return None


def _extract_training_run_names(experiment) -> list[str]:
    """Retrouve les run_name Training_App dans les outputs des steps __train."""
    names: list[str] = []
    if not experiment:
        return names
    for step_id, rec in experiment.steps.items():
        if not step_id.endswith("__train"):
            continue
        out = rec.output.get("output", "") if isinstance(rec.output, dict) else str(rec.output)
        m = re.search(r'"run_name"\s*:\s*"([^"]+)"', str(out))
        if m and m.group(1) not in names:
            names.append(m.group(1))
    return names


async def collect(graph_id: str, run_id: str) -> dict:
    """Agrege tout ce que les sous-apps savent sur ce run de graph."""
    graph = graph_store.get_graph(graph_id) or {}
    experiment = experiment_store.get_experiment_by_run(run_id)

    node_by_id = {n["id"]: n for n in graph.get("nodes", [])}
    execution = graph.get("execution", {})

    # ── Noeuds : label, type, statut, timings ────────────────────────────────
    nodes: list[dict] = []
    for nid, ex in execution.items():
        node = node_by_id.get(nid, {})
        data = node.get("data", {})
        nodes.append({
            "node_id":     nid,
            "type":        data.get("node_type") or node.get("type", ""),
            "label":       data.get("label", nid),
            "status":      ex.get("status", "idle"),
            "started_at":  ex.get("started_at"),
            "finished_at": ex.get("finished_at"),
        })

    # ── Steps : journal brut du pipeline ─────────────────────────────────────
    steps: list[dict] = []
    if experiment:
        for step_id, rec in experiment.steps.items():
            steps.append({
                "step_id": step_id,
                "status":  rec.status,
                "output":  rec.output,
            })

    # ── Training : metriques finales + historique par epoch ─────────────────
    # Source unique : les outputs __train de CET experiment. Ajouter les runs
    # globaux du workspace contamine les forks avec les courbes de leur parent.
    run_names = list(_extract_training_run_names(experiment))
    trainings: list[dict] = []
    for rn in run_names:
        status = await _proxy_json("Training_App", f"/api/training/{rn}/status")
        history = await _proxy_json("Training_App", f"/api/training/{rn}/metrics-history")
        artifacts = await _proxy_json("Training_App", f"/api/training/{rn}/artifacts")
        trainings.append({
            "run_name":    rn,
            "status":      status or {},
            "history":     (history or {}).get("epochs", []),
            "artifacts":   artifacts or {},
        })

    # ── Optuna : etudes + trials ─────────────────────────────────────────────
    studies_raw = await _proxy_json("optuna-app", "/api/studies") or []
    studies: list[dict] = []
    for s in studies_raw:
        # L'app Optuna expose le run_id stocke dans les user_attrs de l'etude.
        # Sans identite exacte, l'etude n'appartient pas a ce run et reste hors
        # de son Insight (aucun fallback par graph_id ou date).
        if str(s.get("run_id") or "") != run_id:
            continue
        name = s.get("study_name", "")
        trials = await _proxy_json("optuna-app", f"/api/studies/{name}/trials") or []
        studies.append({**s, "trials": trials})

    # ── MLflow + DVC ─────────────────────────────────────────────────────────
    # /api/runs exige un experiment_id → on liste les experiments puis on agrège
    # les runs de chacun (sinon 422 → 0 run capté, bug collecte test Fable 2026-07).
    mlflow_experiments = await _proxy_json("mlflow-app", "/api/experiments") or []
    mlflow_runs: list = []
    if isinstance(mlflow_experiments, list):
        for exp in mlflow_experiments:
            eid = exp.get("experiment_id") or exp.get("id")
            if eid is None:
                continue
            runs = await _proxy_json("mlflow-app", "/api/runs", {"experiment_id": str(eid)})
            if isinstance(runs, list):
                mlflow_runs.extend(runs)
    # Ne conserver dans le bundle brut que les objets de CE run. Les pages
    # globales Lineage utilisent /api/lineage, pas ce snapshot d'Insight.
    mlflow_runs = [
        r for r in mlflow_runs
        if isinstance(r, dict) and str((r.get("tags") or {}).get("orch_run_id") or "") == run_id
    ]
    used_experiment_ids = {str(r.get("experiment_id")) for r in mlflow_runs if r.get("experiment_id") is not None}
    mlflow_experiments = [
        e for e in mlflow_experiments
        if str(e.get("experiment_id") if e.get("experiment_id") is not None else e.get("id")) in used_experiment_ids
    ]
    all_dvc_commits = await _proxy_json("dvc-app", "/api/commits") or []
    dvc_commits = [
        c for c in all_dvc_commits if isinstance(c, dict)
        and str((c.get("lineage") or {}).get("run_id") or "") == run_id
    ]

    # ── Lineage PRECIS de CE run + reproductibilite ──────────────────────────
    # On ne "vide" plus les listes globales : on relie l'objet REEL de ce run.
    lineage, reproducibility = await _build_lineage(
        graph_id, run_id, trainings, mlflow_runs, dvc_commits)

    # Bundle logique du run : on reutilise le resolver strict de l'Orchestrator.
    # L'import tardif evite une dependance circulaire au chargement des routeurs.
    from backend.api.graphs import _gather_graph_artifacts
    run_artifacts = _gather_graph_artifacts(graph, run_id)

    return {
        "graph_id":     graph_id,
        "graph_name":   graph.get("name", graph_id),
        "run_id":       run_id,
        "generated_at": _now(),
        "graph_status": graph.get("status", ""),
        "run_history":  graph.get("run_history", []),
        "nodes":        nodes,
        "steps":        steps,
        "trainings":    trainings,
        "optuna":       studies,
        "mlflow":       {"experiments": mlflow_experiments, "runs": mlflow_runs},
        "dvc":          {"commits": dvc_commits if isinstance(dvc_commits, list) else []},
        "artifacts":    run_artifacts,
        "lineage":      lineage,
        "reproducibility": reproducibility,
    }


def _map50_from_runs(runs: list[dict]):
    for r in runs:
        m = r.get("metrics") or {}
        for key in ("final_mAP50", "metrics/mAP50B", "mAP50"):
            if key in m:
                return m[key]
        for k, v in m.items():
            kl = k.lower()
            if "map50" in kl and "50-95" not in kl and "5095" not in kl:
                return v
    return None


async def _build_lineage(graph_id: str, run_id: str, trainings: list[dict],
                         mlflow_runs: list[dict], dvc_commits: list) -> tuple[dict, dict]:
    """Assemble le lineage reel du run (Git/DVC/MLflow) + une checklist de
    reproductibilite calculee de l'etat REEL. Aucun 'vert' par defaut."""
    run_lineage = graph_store.get_run_lineage(graph_id, run_id) or {}

    # Runs MLflow de CE run precis (tag orch_run_id) — plus de dump global.
    my_ml_runs = [
        {"run_id": r.get("run_id"), "run_name": r.get("run_name"),
         "experiment_id": r.get("experiment_id"), "metrics": r.get("metrics") or {},
         "tags": r.get("tags") or {}}
        for r in mlflow_runs
        if isinstance(r, dict) and (r.get("tags") or {}).get("orch_run_id") == run_id
    ]

    dataset = run_lineage.get("dataset")
    # Version DVC (md5) du dataset via les fichiers trackes.
    dvc_datasets = await _proxy_json("dvc-app", "/datasets") or []
    dvc_version = None
    if isinstance(dvc_datasets, list) and dataset:
        for f in dvc_datasets:
            blob = f"{f.get('path','')} {f.get('dvc_file','')}"
            if dataset in blob:
                dvc_version = f.get("md5")
                break

    # Remote DVC configure ? (etat honnete pour la repro)
    dvc_stat = await _proxy_json("dvc-app", "/orchestrator/status") or {}
    dvc_remotes = dvc_stat.get("remotes") or []

    git_commit = run_lineage.get("git_commit") or None
    model_path = run_lineage.get("model_path")
    model_ok = bool(model_path and Path(model_path).exists())
    map50 = run_lineage.get("map50")
    if map50 is None:
        map50 = _map50_from_runs(my_ml_runs)
    if map50 is None:
        for t in trainings:
            st = t.get("status") or {}
            if st.get("best_map50") is not None:
                map50 = st.get("best_map50")
                break

    artifacts_ok = any((t.get("artifacts") or {}) for t in trainings)

    lineage = {
        "run_id":       run_id,
        "git_commit":   git_commit,
        "dataset":      dataset,
        "dvc_version":  dvc_version,
        "model_path":   model_path,
        "map50":        map50,
        "mlflow_runs":  my_ml_runs,
        "committed_at": run_lineage.get("committed_at"),
    }

    def _item(key, label, ok, detail):
        return {"key": key, "label": label, "ok": bool(ok), "detail": detail}

    checks = [
        _item("git_code", "Code / config (Git)", bool(git_commit),
              f"commit {git_commit}" if git_commit else "aucun commit DVC pour ce run"),
        _item("config", "Snapshot du graphe", bool(git_commit),
              "versionne dans le commit" if git_commit else "graphe non versionne (pas de commit)"),
        _item("dataset", "Dataset (DVC)", bool(dvc_version),
              f"version {dvc_version}" if dvc_version else "dataset non versionne dans DVC"),
        _item("mlflow_run", "Run MLflow", len(my_ml_runs) > 0,
              f"{len(my_ml_runs)} run(s) lie(s)" if my_ml_runs else "aucun run MLflow tague pour ce run"),
        _item("model", "Modele (best.pt)", model_ok,
              model_path if model_ok else "fichier modele absent"),
        _item("artifacts", "Artefacts d'analyse", artifacts_ok,
              "plots/metriques presents" if artifacts_ok else "aucun artefact d'analyse"),
        _item("dvc_remote", "Remote DVC", len(dvc_remotes) > 0,
              ", ".join(r.get("name", "") for r in dvc_remotes) if dvc_remotes
              else "aucun remote configure (donnees non recuperables ailleurs)"),
    ]
    reproducibility = {
        "reproducible": all(c["ok"] for c in checks),
        "checks": checks,
    }
    return lineage, reproducibility


# ── Plots matplotlib (sync, appele via to_thread) ─────────────────────────────

def _make_plots(data: dict, out_dir: Path) -> list[str]:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
    except Exception as exc:
        logger.warning("insights: matplotlib indisponible (%s) — pas de plots", exc)
        return []

    plt.rcParams.update({
        "figure.facecolor": "#0b1220", "axes.facecolor": "#111827",
        "axes.edgecolor": "#374151", "axes.labelcolor": "#d1d5db",
        "xtick.color": "#9ca3af", "ytick.color": "#9ca3af",
        "text.color": "#e5e7eb", "grid.color": "#1f2937",
        "font.size": 9, "axes.grid": True,
    })
    plots: list[str] = []
    COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#a78bfa", "#ef4444", "#06b6d4"]

    # 1) Courbes training — evolution mAP par epoch, tous les runs superposes
    trainings = [t for t in data.get("trainings", []) if t.get("history")]
    if trainings:
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4))
        for i, t in enumerate(trainings):
            ep  = [e["epoch"] for e in t["history"]]
            m50 = [e.get("map50") for e in t["history"]]
            m95 = [e.get("map5095") for e in t["history"]]
            c = COLORS[i % len(COLORS)]
            ax1.plot(ep, m50, color=c, label=t["run_name"][:30])
            ax2.plot(ep, m95, color=c, label=t["run_name"][:30])
        ax1.set_title("mAP50 par epoch"); ax1.set_xlabel("epoch"); ax1.legend(fontsize=7)
        ax2.set_title("mAP50-95 par epoch"); ax2.set_xlabel("epoch"); ax2.legend(fontsize=7)
        fig.tight_layout()
        fig.savefig(out_dir / "training_curves.png", dpi=110)
        plt.close(fig)
        plots.append("training_curves.png")

    # 2) Gains — barres mAP50 finale par run (mise en avant du delta)
    finals = [
        (t["run_name"], (t.get("status") or {}).get("best_map50"))
        for t in data.get("trainings", [])
        if (t.get("status") or {}).get("best_map50") is not None
    ]
    if len(finals) >= 1:
        fig, ax = plt.subplots(figsize=(7, 3.6))
        names = [f[0][:28] for f in finals]
        vals  = [f[1] for f in finals]
        bars = ax.bar(names, vals, color=[COLORS[i % len(COLORS)] for i in range(len(vals))])
        base = vals[0]
        for b, v in zip(bars, vals):
            delta = v - base
            label = f"{v:.4f}" + (f"\n({delta:+.4f})" if delta and v != base else "")
            ax.text(b.get_x() + b.get_width() / 2, v, label, ha="center", va="bottom", fontsize=8)
        lo = min(vals); ax.set_ylim(max(0, lo - 0.05), max(vals) + 0.03)
        ax.set_title("mAP50 finale par entrainement (gain vs premier run)")
        ax.tick_params(axis="x", labelrotation=10)
        fig.tight_layout()
        fig.savefig(out_dir / "gains.png", dpi=110)
        plt.close(fig)
        plots.append("gains.png")

    # 3) Optuna — historique des trials + best-so-far par etude
    studies = [s for s in data.get("optuna", []) if s.get("trials")]
    if studies:
        fig, axes = plt.subplots(1, len(studies), figsize=(5.5 * len(studies), 3.6), squeeze=False)
        for ax, s in zip(axes[0], studies):
            done = [t for t in s["trials"] if t.get("state") == "COMPLETE" and t.get("value") is not None]
            done.sort(key=lambda t: t["number"])
            if not done:
                continue
            xs = [t["number"] for t in done]
            ys = [t["value"] for t in done]
            maximize = str(s.get("direction", "")).upper() == "MAXIMIZE"
            best, bests = (None, [])
            for v in ys:
                best = v if best is None else (max(best, v) if maximize else min(best, v))
                bests.append(best)
            ax.plot(xs, ys, "o-", color="#6366f1", ms=4, lw=1, label="valeur trial")
            ax.plot(xs, bests, "--", color="#22c55e", lw=2, label="meilleure")
            ax.set_title(f"Optuna — {s.get('study_name','')[:34]}")
            ax.set_xlabel("trial"); ax.legend(fontsize=7)
        fig.tight_layout()
        fig.savefig(out_dir / "optuna_history.png", dpi=110)
        plt.close(fig)
        plots.append("optuna_history.png")

    # 4) Timeline — Gantt des noeuds du graph
    nodes = [n for n in data.get("nodes", []) if n.get("started_at")]
    if nodes:
        def _ts(s):
            try:
                return datetime.fromisoformat(s.replace("Z", "+00:00"))
            except Exception:
                return None
        rows = []
        for n in nodes:
            t0 = _ts(n["started_at"])
            t1 = _ts(n.get("finished_at") or "") or t0
            if t0:
                rows.append((n["label"][:34], n["status"], t0, t1))
        rows.sort(key=lambda r: r[2])
        if rows:
            fig, ax = plt.subplots(figsize=(9, 0.5 * len(rows) + 1.6))
            status_color = {"done": "#22c55e", "failed": "#ef4444", "running": "#3b82f6", "waiting": "#f59e0b"}
            for i, (label, status, t0, t1) in enumerate(rows):
                width = max((t1 - t0).total_seconds() / 86400, 2e-5)
                ax.barh(i, width, left=mdates.date2num(t0), height=0.5,
                        color=status_color.get(status, "#6b7280"))
                dur = (t1 - t0).total_seconds()
                ax.text(mdates.date2num(t1), i, f"  {dur:.0f}s", va="center", fontsize=8)
            ax.set_yticks(range(len(rows)), [r[0] for r in rows])
            ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M:%S"))
            ax.invert_yaxis()
            ax.set_title("Timeline du run — duree par noeud")
            fig.tight_layout()
            fig.savefig(out_dir / "timeline.png", dpi=110)
            plt.close(fig)
            plots.append("timeline.png")

    return plots


# ── Markdown journal ──────────────────────────────────────────────────────────

def _make_markdown(data: dict, plots: list[str]) -> str:
    L: list[str] = []
    L.append(f"# Insights — {data.get('graph_name')} · run `{data.get('run_id')}`")
    L.append("")
    L.append(f"- Genere : {data.get('generated_at')}")
    L.append(f"- Statut du graph : **{data.get('graph_status')}**")
    L.append("")

    L.append("## Chronologie des noeuds")
    L.append("")
    L.append("| Noeud | Type | Statut | Debut | Fin |")
    L.append("|---|---|---|---|---|")
    for n in data.get("nodes", []):
        L.append(f"| {n['label']} | {n['type']} | {n['status']} | {n.get('started_at') or '—'} | {n.get('finished_at') or '—'} |")
    L.append("")

    L.append("## Journal des etapes (outputs bruts, rien de cache)")
    L.append("")
    for s in data.get("steps", []):
        L.append(f"### `{s['step_id']}` — {s['status']}")
        out = s.get("output")
        if out:
            L.append("```json")
            L.append(json.dumps(out, ensure_ascii=False, indent=2)[:2000])
            L.append("```")
        L.append("")

    if data.get("trainings"):
        L.append("## Entrainements")
        L.append("")
        L.append("| Run | Statut | mAP50 | mAP50-95 | Epochs |")
        L.append("|---|---|---|---|---|")
        for t in data["trainings"]:
            st = t.get("status") or {}
            L.append(
                f"| {t['run_name']} | {st.get('status','?')} "
                f"| {st.get('best_map50') if st.get('best_map50') is not None else '—'} "
                f"| {st.get('best_map5095') if st.get('best_map5095') is not None else '—'} "
                f"| {st.get('total_epochs','—')} |"
            )
        L.append("")

    for s in data.get("optuna", []):
        done = [t for t in s.get("trials", []) if t.get("state") == "COMPLETE"]
        L.append(f"## Optuna — {s.get('study_name')}")
        L.append("")
        L.append(f"- Direction : {s.get('direction')}")
        L.append(f"- Trials complets : {len(done)} / {len(s.get('trials', []))}")
        if s.get("best_value") is not None:
            L.append(f"- Meilleure valeur : **{s['best_value']}**")
        best = None
        maximize = str(s.get("direction", "")).upper() == "MAXIMIZE"
        for t in done:
            if t.get("value") is None:
                continue
            if best is None or (t["value"] > best["value"] if maximize else t["value"] < best["value"]):
                best = t
        if best:
            L.append(f"- Meilleurs parametres (trial {best['number']}) : `{json.dumps(best.get('params', {}))}`")
        L.append("")

    ml = data.get("mlflow", {})
    if ml.get("runs"):
        L.append(f"## MLflow — {len(ml.get('experiments', []))} experience(s), {len(ml['runs'])} run(s) traces")
        L.append("")

    dvc = data.get("dvc", {}).get("commits", [])
    if dvc:
        L.append("## DVC — commits")
        L.append("")
        for c in dvc[:10]:
            sha = c.get("short") or str(c.get("hash", ""))[:8]
            L.append(f"- `{sha}` {c.get('subject', '')}")
        L.append("")

    if plots:
        L.append("## Plots generes")
        L.append("")
        for p in plots:
            L.append(f"![{p}]({p})")
        L.append("")

    return "\n".join(L)


# ── API principale ────────────────────────────────────────────────────────────

# Artefacts d'analyse Ultralytics à rapatrier par training (bundlés dans l'insight)
_ANALYSIS_WANTED = [
    ("confusion",        "confusion_matrix_normalized.png", "confusion"),
    ("confusion",        "confusion_matrix.png",            "confusion_raw"),
    ("curves",           "BoxPR_curve.png",                 "pr_curve"),
    ("curves",           "PR_curve.png",                    "pr_curve"),
    ("curves",           "BoxF1_curve.png",                 "f1_curve"),
    ("curves",           "F1_curve.png",                    "f1_curve"),
    ("results",          "results.png",                     "results"),
    ("val_predictions",  None,                              "val_pred"),
]


async def _fetch_analysis_images(data: dict, out_dir: Path) -> list[str]:
    """Télécharge (httpx direct) les plots d'analyse de chaque training dans le
    dossier d'insight → bundlés et servis par l'orchestrateur (pas de cross-origin).
    Retourne la liste des fichiers écrits (analysis_{run}_{kind}.png)."""
    import httpx
    from backend.config import APP_URLS
    base = APP_URLS.get("Training_App")
    if not base:
        return []
    written: list[str] = []
    async with httpx.AsyncClient(timeout=20.0) as c:
        for t in data.get("trainings", []):
            rn = t.get("run_name")
            arts = t.get("artifacts") or {}
            if not rn:
                continue
            seen_kinds: set[str] = set()
            for cat, fname, kind in _ANALYSIS_WANTED:
                if kind in seen_kinds:
                    continue
                names = arts.get(cat) or []
                target = fname if (fname and fname in names) else (names[0] if names else None)
                if not target:
                    continue
                try:
                    r = await c.get(f"{base}/api/training/{rn}/artifact/{target}")
                    if r.status_code < 400 and r.content:
                        ext = ".png" if target.lower().endswith(".png") else ".jpg"
                        out_name = f"analysis_{rn}_{kind}{ext}"
                        (out_dir / out_name).write_bytes(r.content)
                        written.append(out_name)
                        seen_kinds.add(kind)
                except Exception:
                    continue
    return written


def _stable_metrics(data: dict) -> dict:
    """Metriques FINALES deterministes (sans timestamp ni volatil) -> fichier
    metrics.json versionne par DVC. But : ne PAS churner a chaque re-commit (le
    insights.json complet contient generated_at et change a chaque generation)."""
    lineage = data.get("lineage") or {}
    trainings = []
    for t in data.get("trainings", []):
        st = t.get("status") or {}
        trainings.append({
            "run_name":     t.get("run_name"),
            "best_map50":   st.get("best_map50"),
            "best_map5095": st.get("best_map5095"),
            "total_epochs": st.get("total_epochs"),
        })
    trainings.sort(key=lambda x: x.get("run_name") or "")
    optuna = []
    for s in data.get("optuna", []):
        optuna.append({
            "study_name": s.get("study_name"),
            "direction":  s.get("direction"),
            "best_value": s.get("best_value"),
        })
    optuna.sort(key=lambda x: x.get("study_name") or "")
    return {
        "graph_id":   data.get("graph_id"),
        "graph_name": data.get("graph_name"),
        "run_id":     data.get("run_id"),
        "map50":      lineage.get("map50"),
        "dataset":    lineage.get("dataset"),
        "trainings":  trainings,
        "optuna":     optuna,
    }


async def generate(graph_id: str, run_id: str) -> dict:
    """Collecte + ecrit insights.json / insights.md / metrics.json / plots. Retourne le resume."""
    data = await collect(graph_id, run_id)
    # Une regeneration doit aussi retirer les anciens PNG. Sinon un fork corrige
    # garde visuellement les courbes parentales deja presentes sur disque.
    out_dir = INSIGHTS_DIR / graph_id / run_id
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    plots = await asyncio.to_thread(_make_plots, data, out_dir)
    analysis = await _fetch_analysis_images(data, out_dir)
    all_plots = plots + analysis
    data["plots"] = plots
    data["analysis_plots"] = analysis

    (out_dir / "insights.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "insights.md").write_text(_make_markdown(data, all_plots), encoding="utf-8")
    # metrics.json STABLE (versionne par DVC, sans churn de timestamp).
    (out_dir / "metrics.json").write_text(
        json.dumps(_stable_metrics(data), ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")

    from backend.core import run_manifest
    graph = graph_store.get_graph(graph_id) or {}
    experiment = experiment_store.get_experiment_by_run(run_id)
    run_status = next((h.get("status") for h in graph.get("run_history", []) if h.get("run_id") == run_id), None)
    if not run_status and graph.get("active_run_id") == run_id:
        run_status = graph.get("status") or "running"
    run_manifest.finalize(
        graph, run_id, status=run_status or "partial", experiment=experiment,
        artifacts=data.get("artifacts") or [], lineage=data.get("lineage") or {},
        optuna=data.get("optuna") or [],
    )

    logger.info("insights: generes pour graph=%s run=%s (%d plots + %d analyse) -> %s",
                graph_id, run_id, len(plots), len(analysis), out_dir)
    return data


def delete(graph_id: str, run_id: str) -> bool:
    """Supprime le dossier d'insights d'un run."""
    import shutil
    d = INSIGHTS_DIR / graph_id / run_id
    if not d.exists():
        return False
    shutil.rmtree(d, ignore_errors=True)
    return True


def list_all() -> list[dict]:
    """Liste tous les dossiers d'insights existants (plus recents d'abord)."""
    result: list[dict] = []
    if not INSIGHTS_DIR.exists():
        return result
    for gdir in INSIGHTS_DIR.iterdir():
        if not gdir.is_dir():
            continue
        for rdir in gdir.iterdir():
            f = rdir / "insights.json"
            if not f.exists():
                continue
            try:
                raw = json.loads(f.read_text(encoding="utf-8"))
                result.append({
                    "graph_id":     raw.get("graph_id", gdir.name),
                    "graph_name":   raw.get("graph_name", gdir.name),
                    "run_id":       raw.get("run_id", rdir.name),
                    "generated_at": raw.get("generated_at", ""),
                    "plots":        raw.get("plots", []) + raw.get("analysis_plots", []),
                })
            except Exception:
                continue
    result.sort(key=lambda r: r.get("generated_at", ""), reverse=True)
    return result


def load(graph_id: str, run_id: str) -> dict | None:
    f = INSIGHTS_DIR / graph_id / run_id / "insights.json"
    if not f.exists():
        return None
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None


def plot_path(graph_id: str, run_id: str, name: str) -> Path | None:
    # garde-fou : pas de traversal
    if "/" in name or "\\" in name or ".." in name:
        return None
    p = INSIGHTS_DIR / graph_id / run_id / name
    return p if p.exists() and p.suffix in (".png", ".md", ".json") else None
