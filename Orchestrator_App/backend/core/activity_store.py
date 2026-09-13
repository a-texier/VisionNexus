# ============================================================
# core/activity_store.py
# Log append-only des exécutions de pipelines.
# ============================================================

import json
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from backend.config import ACTIVITY_FILE

MAX_ACTIVITY = 200


class StepResult(BaseModel):
    status: str
    output: str = ""


class ActivityRun(BaseModel):
    pipeline_id: str
    pipeline_name: str
    run_id: str
    status: str  # running | success | failed
    start_time: str  # ISO UTC
    duration_s: Optional[float] = None
    step_count: int
    step_results: dict[str, StepResult] = Field(default_factory=dict)


def record_run(run: ActivityRun) -> None:
    runs = _load_raw()
    # Update existing entry if already present (e.g. status update)
    for i, r in enumerate(runs):
        if r.get("run_id") == run.run_id:
            runs[i] = run.model_dump()
            _save_raw(runs)
            return
    runs.insert(0, run.model_dump())
    _save_raw(runs[:MAX_ACTIVITY])


def get_activity(limit: int = 50) -> list[ActivityRun]:
    return [ActivityRun(**r) for r in _load_raw()[:limit]]


def _load_raw() -> list[dict]:
    if not ACTIVITY_FILE.exists():
        return []
    try:
        return json.loads(ACTIVITY_FILE.read_text("utf-8"))
    except Exception:
        return []


def _save_raw(runs: list[dict]) -> None:
    ACTIVITY_FILE.write_text(
        json.dumps(runs, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
