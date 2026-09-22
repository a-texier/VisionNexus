# ============================================================
# core/pipeline_runner.py
# Moteur d'exécution DAG — respecte depends_on,
# exécute les étapes parallèles avec asyncio.gather,
# supporte human_gate (pause + resume) et experiment tracking.
# ============================================================

import asyncio
import json as _json
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from backend.core import proxy_client
from backend.core.pipeline_store import PipelineDef, get_pipeline, mark_run
from backend.core import activity_store, experiment_store
from backend.core.activity_store import ActivityRun, StepResult
from backend.utils.debug_logger import dbg


# ------------------------------------------------------------------ #
# State                                                               #
# ------------------------------------------------------------------ #

@dataclass
class StepState:
    step_id: str
    label: str
    status: str = "pending"   # pending|running|success|warning|failed|waiting
    output: str = ""
    hint: str = ""
    started_at: Optional[float] = None
    finished_at: Optional[float] = None


@dataclass
class RunState:
    run_id: str
    pipeline_id: str
    pipeline_name: str
    experiment_id: str = ""
    status: str = "running"   # running|success|failed|waiting|stopped
    steps: dict[str, StepState] = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    done: bool = False
    waiting_at_step: Optional[str] = None
    started_at: float = field(default_factory=time.monotonic)
    started_iso: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    # Handle de la coroutine _execute en cours — permet de STOPPER le run (annulation).
    task: "Optional[asyncio.Task]" = None


# Module-level run registry — survit aux re-renders React
_active_runs: dict[str, RunState] = {}


# ------------------------------------------------------------------ #
# Public API                                                          #
# ------------------------------------------------------------------ #

async def start_run(pipeline: PipelineDef) -> str:
    run_id = str(uuid.uuid4())[:8]
    state = RunState(
        run_id=run_id,
        pipeline_id=pipeline.id,
        pipeline_name=pipeline.name,
    )
    for step in pipeline.steps:
        state.steps[step.id] = StepState(step_id=step.id, label=step.label)

    # Créer l'expérience liée à ce run
    exp = experiment_store.create_experiment(
        pipeline_id=pipeline.id,
        run_id=run_id,
        step_ids=[s.id for s in pipeline.steps],
    )
    state.experiment_id = exp.experiment_id

    _active_runs[run_id] = state
    dbg.step("pipeline_runner", "start_run", "Run créé",
             run_id=run_id, pipeline=pipeline.name,
             steps=len(pipeline.steps), exp=state.experiment_id)

    activity_store.record_run(ActivityRun(
        pipeline_id=pipeline.id,
        pipeline_name=pipeline.name,
        run_id=run_id,
        status="running",
        start_time=state.started_iso,
        step_count=len(pipeline.steps),
    ))

    state.task = asyncio.create_task(_execute(pipeline, state))
    return run_id


def get_run_state(run_id: str) -> Optional[RunState]:
    return _active_runs.get(run_id)


def run_in_memory(run_id: str) -> bool:
    """Returns True if the run is tracked in memory (not lost after a server restart)."""
    return run_id in _active_runs


async def resume_run(run_id: str) -> bool:
    """Reprend un run en attente sur un human_gate."""
    state = _active_runs.get(run_id)
    if not state or state.status != "waiting":
        return False

    # Valider l'étape en attente
    if state.waiting_at_step and state.waiting_at_step in state.steps:
        ss = state.steps[state.waiting_at_step]
        ss.status = "success"
        ss.output = "Validé par l'utilisateur"
        ss.finished_at = time.monotonic()
        _emit(state, {
            "step_id": state.waiting_at_step,
            "status": "success",
            "output": ss.output,
            "ts": time.time(),
        })
        experiment_store.update_step(
            state.experiment_id, state.waiting_at_step,
            "success", {"validated_by": "user"},
        )

    state.waiting_at_step = None
    state.status = "running"
    state.done = False

    pipeline = get_pipeline(state.pipeline_id)
    if not pipeline:
        dbg.error("pipeline_runner", "resume_run", "Pipeline introuvable", run_id=run_id)
        return False

    dbg.gate("pipeline_runner", "resume_run", "Reprise après gate",
             run_id=run_id, pipeline=pipeline.name)
    state.task = asyncio.create_task(_execute(pipeline, state))
    return True


async def stop_run(run_id: str) -> bool:
    """Arrête immédiatement un run en cours (ou en attente sur un gate).

    Annule la coroutine `_execute`, marque le run comme `stopped`, émet un event
    terminal `done/stopped` (pour que le stream SSE se referme proprement) et
    consigne l'activité. Garde-fou anti-blocage : donne TOUJOURS un moyen de sortir
    d'un graphe coincé (app qui tourne à l'infini, gate bloquant, etc.)."""
    state = _active_runs.get(run_id)
    if not state:
        return False

    # Annule la tâche d'exécution en cours (les étapes en vol s'arrêtent au
    # prochain point d'attente : proxy httpx, asyncio.sleep, gather…).
    task = state.task
    if task and not task.done():
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    # Marque les étapes non terminées comme "stopped" (traçabilité).
    for ss in state.steps.values():
        if ss.status in ("pending", "running", "waiting"):
            ss.status = "stopped"
            ss.output = "Arrêté par l'utilisateur"
            if not ss.finished_at:
                ss.finished_at = time.monotonic()

    state.status = "stopped"
    state.waiting_at_step = None
    state.done = True
    _emit(state, {"type": "done", "status": "stopped",
                  "output": "Pipeline arrêté par l'utilisateur", "ts": time.time()})

    try:
        mark_run(state.pipeline_id, "stopped")
        experiment_store.complete_experiment(state.experiment_id, "stopped")
    except Exception:
        pass

    elapsed = round(time.monotonic() - state.started_at, 1)
    activity_store.record_run(ActivityRun(
        pipeline_id=state.pipeline_id,
        pipeline_name=state.pipeline_name,
        run_id=state.run_id,
        status="stopped",
        start_time=state.started_iso,
        duration_s=elapsed,
        step_count=len(state.steps),
        step_results={
            sid: StepResult(status=ss.status, output=ss.output)
            for sid, ss in state.steps.items()
        },
    ))
    dbg.step("pipeline_runner", "stop_run", "Run arrêté", run_id=run_id)
    return True


def extend_run(run_id: str, new_steps: list) -> None:
    """Add new pipeline steps to an existing run without overriding completed ones."""
    state = _active_runs.get(run_id)
    if not state:
        return
    for step in new_steps:
        if step.id not in state.steps:
            state.steps[step.id] = StepState(step_id=step.id, label=step.label)


def update_run_pipeline(run_id: str, pipeline_id: str) -> None:
    """Update the pipeline_id of an existing run (used when graph is rebuilt on resume)."""
    state = _active_runs.get(run_id)
    if not state:
        return
    state.pipeline_id = pipeline_id


async def stream_events(run_id: str):
    """Async generator — yields SSE event dicts, polling the events list."""
    state = _active_runs.get(run_id)
    if not state:
        yield {"type": "error", "message": "Run not found"}
        return

    cursor = 0
    while True:
        if cursor < len(state.events):
            evt = state.events[cursor]
            cursor += 1
            yield evt
            if evt.get("type") in ("done", "waiting"):
                # Only close if no more events follow: distinguishes the current
                # stopping point from a historical event being replayed after resume.
                if cursor >= len(state.events):
                    return
        elif state.done:
            return
        else:
            await asyncio.sleep(0.25)


# ------------------------------------------------------------------ #
# Internal execution engine                                           #
# ------------------------------------------------------------------ #

def _compute_depths(pipeline: PipelineDef) -> dict[str, int]:
    step_by_id = {s.id: s for s in pipeline.steps}
    depths: dict[str, int] = {}

    def depth(sid: str) -> int:
        if sid in depths:
            return depths[sid]
        s = step_by_id.get(sid)
        if not s or not s.depends_on:
            depths[sid] = 0
        else:
            depths[sid] = max(depth(d) for d in s.depends_on) + 1
        return depths[sid]

    for s in pipeline.steps:
        depth(s.id)
    return depths


def _emit(state: RunState, event: dict) -> None:
    state.events.append(event)


async def _execute(pipeline: PipelineDef, state: RunState) -> None:
    depths = _compute_depths(pipeline)
    max_depth = max(depths.values(), default=0)
    step_by_id = {s.id: s for s in pipeline.steps}

    failed_early = False

    for level in range(max_depth + 1):
        level_step_ids = [s.id for s in pipeline.steps if depths[s.id] == level]

        # Ignorer les niveaux déjà traités (reprise après human_gate)
        if all(state.steps[sid].status in ("success", "warning", "failed") for sid in level_step_ids):
            continue

        # Vérifier les dépendances en échec
        runnable = []
        for sid in level_step_ids:
            if state.steps[sid].status in ("success", "warning", "failed"):
                continue  # déjà traité
            step = step_by_id[sid]
            dep_failed = any(
                state.steps[dep].status == "failed"
                for dep in step.depends_on
                if dep in state.steps
            )
            if dep_failed:
                ss = state.steps[sid]
                ss.status = "failed"
                ss.output = "Skipped: un prérequis a échoué"
                _emit(state, {
                    "step_id": sid, "status": "failed",
                    "output": ss.output, "ts": time.time(),
                })
                experiment_store.update_step(state.experiment_id, sid, "failed", {"reason": ss.output})
                failed_early = True
            else:
                runnable.append(sid)

        if not runnable:
            continue

        await asyncio.gather(*[_run_step(step_by_id[sid], state) for sid in runnable])

        # Pause si un human_gate est en attente
        if state.status == "waiting":
            return

        # Abort si échec
        if any(state.steps[sid].status == "failed" for sid in runnable):
            for remaining in pipeline.steps:
                if state.steps[remaining.id].status == "pending":
                    state.steps[remaining.id].status = "failed"
                    state.steps[remaining.id].output = "Annulé: une étape précédente a échoué"
                    _emit(state, {
                        "step_id": remaining.id, "status": "failed",
                        "output": state.steps[remaining.id].output, "ts": time.time(),
                    })
            failed_early = True
            break

    # Ne finaliser que si pas en waiting
    if state.status == "waiting":
        return

    overall = "failed" if failed_early or any(
        ss.status == "failed" for ss in state.steps.values()
    ) else "success"

    state.status = overall
    state.done = True
    _emit(state, {"type": "done", "status": overall, "ts": time.time()})

    mark_run(pipeline.id, overall)

    exp_status = "done" if overall == "success" else "failed"
    experiment_store.complete_experiment(state.experiment_id, exp_status)

    elapsed = round(time.monotonic() - state.started_at, 1)
    activity_store.record_run(ActivityRun(
        pipeline_id=pipeline.id,
        pipeline_name=pipeline.name,
        run_id=state.run_id,
        status=overall,
        start_time=state.started_iso,
        duration_s=elapsed,
        step_count=len(pipeline.steps),
        step_results={
            sid: StepResult(status=ss.status, output=ss.output)
            for sid, ss in state.steps.items()
        },
    ))


async def _wait_for_app(app_name: str, max_wait: float = 240.0,
                        state: "RunState | None" = None, step_id: str = "") -> bool:
    """Attend qu'une sous-app réponde sur /health. True dès qu'elle est joignable.

    Timeout large par défaut (240 s) : au 1er lancement, une app démarre à froid
    (uvicorn + npm + torch/CLIP) et peut mettre >60 s, surtout si plusieurs apps
    montent en même temps. Émet un ping de progression toutes ~12 s pour montrer
    que l'attente est active (fini le « rien ne se passe »)."""
    from backend.config import APP_URLS
    import httpx
    start = time.monotonic()
    deadline = start + max_wait
    last_ping = -999.0
    while time.monotonic() < deadline:
        url = APP_URLS.get(app_name, "")
        if url and url != "http://localhost:1":
            try:
                async with httpx.AsyncClient(timeout=2.0) as c:
                    r = await c.get(f"{url}/health")
                if r.status_code < 500:
                    return True
            except Exception:
                pass
        elapsed = time.monotonic() - start
        if state and elapsed - last_ping >= 12:
            last_ping = elapsed
            _emit(state, {
                "step_id": step_id, "status": "running",
                "message": f"Démarrage de {app_name}… ({int(elapsed)} s)",
                "ts": time.time(),
            })
        await asyncio.sleep(2)
    return False


# ── Résolution runtime des paramètres portés par une arête ────────────────────
# Un paramètre "${STEP:<step_id>.<field>}" est remplacé, au moment de l'exécution,
# par le champ <field> du résultat JSON de l'étape amont <step_id>. Sert au modèle
# porté par l'arête : Inference/DVC lisent le best_model_path RÉEL du Training amont
# (déterministe, plus de « best.pt le plus récent » ambigu).
_STEP_PLACEHOLDER = re.compile(r"^\$\{STEP:([^.}]+)\.([^}]+)\}$")


def _resolve_step_params(params, state: RunState):
    def _lookup(step_id: str, field_name: str):
        ss = state.steps.get(step_id)
        if not ss or not ss.output:
            return None
        try:
            data = _json.loads(ss.output) if isinstance(ss.output, str) else ss.output
            return data.get(field_name) if isinstance(data, dict) else None
        except Exception:
            return None

    def _res(v):
        if isinstance(v, str):
            s = v.strip()
            # ${RUN_ID} -> run_id orchestrateur (inconnu au BUILD, resolu au RUN-TIME).
            # Permet aux sous-apps de taguer leur run MLflow avec l'id du run reel
            # (lien exact Run <-> run MLflow, cf. trace.run_id).
            if s == "${RUN_ID}":
                return state.run_id
            m = _STEP_PLACEHOLDER.match(s)
            if m:
                val = _lookup(m.group(1), m.group(2))
                return val if val is not None else ""
            return v
        if isinstance(v, dict):
            return {k: _res(x) for k, x in v.items()}
        if isinstance(v, list):
            return [_res(x) for x in v]
        return v

    return _res(params)


def _extract_progress(item: dict, kind: str) -> Optional[dict]:
    """Extrait {current,total,phase} d'un item de sous-app selon le type d'étape suivie.

    Chaque sous-app expose sa progression différemment ; cette fonction normalise
    tout vers {current,total,phase} → barre d'avancement unique sous le node.
      embed/scan  : Dataset_Explorer_App    GET /api/datasets       (embed_*/scan_*)
      training    : Training_App    GET /api/training/runs  (current_epoch/total_epochs, +mAP)
      annotation  : Annotation_App  GET /project-status     (annotated_count/frame_count)
    """
    if not isinstance(item, dict):
        return None
    if kind == "embed":
        cur, tot = int(item.get("embed_progress", 0) or 0), int(item.get("embed_total", 0) or 0)
        if tot > 0:
            return {"current": min(cur, tot), "total": tot, "phase": item.get("embed_phase") or "embedding"}
    if kind == "scan":
        cur, tot = int(item.get("scan_progress", 0) or 0), int(item.get("scan_total", 0) or 0)
        if tot > 0:
            return {"current": min(cur, tot), "total": tot, "phase": "scan"}
    if kind == "training":
        cur, tot = int(item.get("current_epoch", 0) or 0), int(item.get("total_epochs", 0) or 0)
        if tot > 0:
            phase = f"epoch {cur}/{tot}"
            m50 = item.get("best_map50")
            if m50 is not None:
                try:
                    phase += f" · mAP50 {float(m50):.3f}"
                except (TypeError, ValueError):
                    pass
            return {"current": min(cur, tot), "total": tot, "phase": phase}
    if kind == "annotation":
        cur, tot = int(item.get("annotated_count", 0) or 0), int(item.get("frame_count", 0) or 0)
        if tot > 0:
            return {"current": min(cur, tot), "total": tot, "phase": "annotation auto"}
    if kind == "annotation_import":
        cur, tot = int(item.get("import_current", 0) or 0), int(item.get("import_total", 0) or 0)
        if tot > 0:
            return {"current": min(cur, tot), "total": tot, "phase": "import images"}
    return None


async def _relay_progress(step, state: RunState, probe: dict, req_task) -> None:
    """Suivi live (step 4) : tant que `req_task` (appel bloquant de l'étape) tourne, poll
    l'endpoint `probe['poll']` de la sous-app, retrouve l'entité via match [field, value],
    et émet des events SSE {progress:{current,total,phase}} → barre d'avancement sous le node.
    Best-effort : toute erreur de poll est avalée (le suivi ne doit JAMAIS casser le run)."""
    import httpx
    from backend.config import APP_URLS
    base = APP_URLS.get(probe.get("app", ""), "")
    if not base or base == "http://localhost:1":
        return
    match = probe.get("match") or [None, None]
    mf, mv = (match + [None, None])[:2]
    mv = "" if mv is None else str(mv)
    kind = probe.get("kind", "embed")
    last_msg = None
    while not req_task.done():
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"{base}{probe['poll']}")
            payload = r.json() if r.status_code < 400 else None
            item = None
            if isinstance(payload, list) and mf is not None:
                item = next((it for it in payload if str(it.get(mf)) == mv), None)
            elif isinstance(payload, dict):
                item = payload
            prog = _extract_progress(item, kind) if item else None
            if prog:
                msg = f"{prog['phase']} — {prog['current']}/{prog['total']}"
                if msg != last_msg:
                    last_msg = msg
                    _emit(state, {"step_id": step.id, "status": "running",
                                  "progress": prog, "message": msg, "ts": time.time()})
        except Exception:
            pass
        # Poll rapide : lisse la barre d'embedding ET attrape les étapes courtes
        # (le scan de qq centaines d'images se termine en <1s).
        await asyncio.sleep(0.5)


async def _run_step(step, state: RunState) -> None:
    ss = state.steps[step.id]

    # Déjà traité (reprise après human_gate)
    if ss.status in ("success", "failed"):
        return

    # Human gate — pause et attente validation
    if getattr(step, "type", "task") == "human_gate":
        ss.status = "waiting"
        ss.output = "En attente de validation humaine"
        ss.started_at = time.monotonic()
        state.status = "waiting"
        state.waiting_at_step = step.id
        _emit(state, {
            "type": "waiting",
            "step_id": step.id,
            "status": "waiting",
            "hint": getattr(step, "hint", ""),
            "app_link": getattr(step, "app_link", ""),
            "next_label": getattr(step, "next_label", ""),   # step1 : aperçu prochaine étape
            "output": ss.output,
            "ts": time.time(),
        })
        dbg.gate("pipeline_runner", "_run_step", "Human gate — en attente",
                 step=step.id, label=step.label,
                 hint=getattr(step, "hint", "")[:80])
        experiment_store.set_waiting(state.experiment_id, step.id)
        return

    ss.status = "running"
    ss.started_at = time.monotonic()
    _emit(state, {"step_id": step.id, "status": "running", "output": "", "ts": time.time()})
    dbg.step("pipeline_runner", "_run_step", "Étape démarrée",
             step=step.id, app=step.app, method=step.method, endpoint=step.endpoint)
    experiment_store.update_step(state.experiment_id, step.id, "running", {})

    # Wait for the target app to be reachable (it may still be auto-launching)
    if not await _wait_for_app(step.app, max_wait=240.0, state=state, step_id=step.id):
        ss.status = "failed"
        ss.output = (
            f"{step.app} non accessible après 240s (démarrage à froid trop long).\n"
            f"→ Vérifiez que l'application est lancée (onglet Applications).\n"
            f"→ Relancez le pipeline une fois l'app affichée « running ».\n"
            f"→ Étape : {step.label}"
        )
        ss.finished_at = time.monotonic()
        _emit(state, {
            "step_id": step.id, "status": "failed",
            "output": ss.output, "hint": ss.output, "ts": time.time(),
        })
        dbg.error("pipeline_runner", "_run_step", "App inaccessible", step=step.id, app=step.app)
        experiment_store.update_step(state.experiment_id, step.id, "failed", {"error": ss.output})
        return

    # Résout les paramètres portés par une arête (${STEP:id.field}) juste avant l'appel,
    # une fois que les étapes amont ont produit leur résultat.
    _params = _resolve_step_params(step.params, state)

    # Etapes synchrones longues (attente fin de run cote sous-app) : timeout large
    # pour ne pas couper un run long. Les autres etapes gardent 600s.
    #   /train   -> Training_App   (entrainement)
    #   /infer   -> Inference_App  (tracking sur une sequence)
    #   /evaluate-> Evaluation_App (val multi-modeles)
    #   /auto-annotate   -> Annotation_App (SAM3/Grounding DINO frame par frame :
    #                       250 frames sur VM depassent regulierement 600 s, et
    #                       le node restait "en cours" avec sa barre a 100 %
    #                       jusqu'au ReadTimeout, sans jamais aboutir)
    #   /create-project  -> Annotation_App (import + symlink de milliers d'images)
    _LONG = ("/train", "/infer", "/evaluate", "/hpo", "/start-embed", "/load-dataset",
             "/auto-annotate", "/create-project")
    _timeout = 3600.0 if step.endpoint.endswith(_LONG) else 600.0
    if step.endpoint.endswith("/hpo"):
        # /hpo reste synchrone aujourd'hui. Son enveloppe HTTP doit couvrir tous
        # les trials, alors que chaque child possède sa propre borne anti-gel.
        # Avant : 1 h pour l'étude mais jusqu'à 2 h par trial, contradiction qui
        # garantissait un abandon Orchestrator avant le diagnostic Optuna.
        n_trials = max(1, int(_params.get("n_trials") or 1))
        per_trial = max(60, int(_params.get("trial_timeout_s") or 1200))
        _timeout = max(3600.0, float(n_trials * (per_trial + 120) + 300))
    # Suivi live (step 4) : l'appel bloquant part en tâche, et si l'étape déclare un
    # `progress`, on POLL la sous-app en parallèle pour relayer la barre d'avancement
    # (scan/embedding…) sous le node, en SSE, jusqu'à la fin de l'appel.
    _req = asyncio.create_task(
        proxy_client.request(step.app, step.method, step.endpoint, _params, timeout=_timeout))
    _probe = _resolve_step_params(getattr(step, "progress", {}) or {}, state)
    if _probe.get("app") and _probe.get("poll"):
        await _relay_progress(step, state, _probe, _req)
    result = await _req

    ok       = result.get("ok", False)
    raw_data = result.get("data", "")

    # Contrat applicatif : plusieurs sous-apps repondent HTTP 200 avec un corps
    # {"ok": false, "error": ...} en cas d'echec METIER (ex. Optuna /hpo quand le
    # data.yaml est introuvable, DVC /commit rate). Le `ok` ci-dessus n'est que le
    # succes TRANSPORT (l'appel HTTP a abouti). Sans inspecter le corps, une etape
    # metier en echec passait pour un succes : node vert, best_params vides, etape
    # aval sur des defauts, aucun signal a l'utilisateur -> on retrograde en echec.
    app_error = None
    app_warning = None
    _body = None
    if ok and raw_data:
        import json as _json
        try:
            _body = _json.loads(raw_data) if isinstance(raw_data, str) else raw_data
        except Exception:
            _body = None
        if isinstance(_body, dict) and _body.get("ok") is False:
            ok = False
            app_error = _body.get("error") or _body.get("detail") or _body.get("message")
        elif (isinstance(_body, dict) and _body.get("hpo_succeeded") is False
              and _body.get("fallback_to_training_defaults") is True):
            # HPO réellement échoué, mais politique explicite « continuer » : la
            # dépendance Training reste exécutable. Ne surtout pas peindre Optuna en
            # vert : le statut warning conserve l'échec et le fallback dans le graphe.
            app_warning = "\n".join(filter(None, [
                _body.get("error"), _body.get("warning"),
                f"Cause : {_body.get('failure_reason')}" if _body.get("failure_reason") else None,
                f"À faire : {_body.get('failure_action')}" if _body.get("failure_action") else None,
            ]))

    ss.status = "warning" if ok and app_warning else ("success" if ok else "failed")
    ss.hint = app_warning or ""
    ss.finished_at = time.monotonic()

    # Parse error detail for clear failure messages
    if not ok:
        import json as _json
        detail = app_error or raw_data
        if not app_error:
            try:
                parsed = _json.loads(raw_data) if isinstance(raw_data, str) else raw_data
                if isinstance(parsed, dict):
                    detail = parsed.get("detail") or parsed.get("message") or parsed.get("error") or raw_data
            except Exception:
                pass
        ss.output = (
            f"Échec de l'étape « {step.label} »\n"
            f"App : {step.app} {step.method} {step.endpoint}\n"
            f"Erreur : {detail}\n"
            f"→ Corrigez le problème (voir logs) et relancez le pipeline."
        )
    else:
        ss.output = raw_data

    dbg.http("pipeline_runner", "_run_step", f"Réponse {step.app}",
             step=step.id, ok=ok, status=ss.status,
             output=str(ss.output)[:120])

    _emit(state, {
        "step_id": step.id,
        "status": ss.status,
        "output": ss.output,
        # hint reprend le message d'erreur pour l'afficher sur le nœud
        "hint": app_warning or (ss.output if not ok else getattr(step, "hint", "")),
        "ts": time.time(),
    })
    experiment_store.update_step(
        state.experiment_id, step.id, ss.status,
        # Conserve les sorties structurées nécessaires au lineage (best.pt,
        # best_params, exports exacts). Le journal visuel applique son propre cap.
        {"output": str(ss.output)[:100_000]},
    )
