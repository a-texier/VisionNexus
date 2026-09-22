# ============================================================
# core/plan_store.py
# Persistence des "Experiment Plans" : une suite ordonnee d'etapes,
# chaque etape = un graphe de base a dupliquer + des overrides.
# Stockage: WORKSPACE/plans/plans.json
# ============================================================

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import WORKSPACE

PLANS_DIR = WORKSPACE / "plans"
PLANS_DIR.mkdir(parents=True, exist_ok=True)


def _file() -> Path:
    return PLANS_DIR / "plans.json"


def _load() -> dict[str, dict]:
    f = _file()
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text("utf-8"))
    except Exception:
        return {}


def _save(data: dict[str, dict]) -> None:
    _file().write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_steps(steps: list) -> list:
    out = []
    for s in steps or []:
        out.append({
            "id":            s.get("id") or str(uuid.uuid4())[:8],
            "label":         s.get("label", "etape"),
            "base_graph_id": s.get("base_graph_id", ""),
            "overrides":     s.get("overrides", {}) or {},
        })
    return out


def create_plan(name: str, steps: list) -> dict:
    p = {
        "plan_id":    str(uuid.uuid4())[:8],
        "name":       name,
        "created_at": _now(),
        "updated_at": _now(),
        "steps":      _norm_steps(steps),
        "last_run":   None,   # {status, started_at, finished_at, current, total, results:[...]}
    }
    data = _load()
    data[p["plan_id"]] = p
    _save(data)
    return p


def get_plan(plan_id: str) -> Optional[dict]:
    return _load().get(plan_id)


def list_plans() -> list[dict]:
    return sorted(_load().values(), key=lambda p: p.get("updated_at", ""), reverse=True)


def update_plan(plan_id: str, name: Optional[str] = None, steps: Optional[list] = None) -> Optional[dict]:
    data = _load()
    p = data.get(plan_id)
    if not p:
        return None
    if name is not None:
        p["name"] = name
    if steps is not None:
        p["steps"] = _norm_steps(steps)
    p["updated_at"] = _now()
    _save(data)
    return p


def delete_plan(plan_id: str) -> bool:
    data = _load()
    if plan_id not in data:
        return False
    del data[plan_id]
    _save(data)
    return True


def set_run_state(plan_id: str, state: dict) -> None:
    """Ecrit l'etat d'execution courant du plan (progression). Appele par plan_runner."""
    data = _load()
    p = data.get(plan_id)
    if not p:
        return
    p["last_run"] = state
    p["updated_at"] = _now()
    _save(data)
