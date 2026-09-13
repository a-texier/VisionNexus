# ============================================================
# core/pipeline_store.py
# CRUD pour les pipelines stockés comme fichiers JSON locaux.
# ============================================================

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field

from backend.config import PIPELINES_DIR


class PipelineStep(BaseModel):
    id: str
    label: str
    app: str
    endpoint: str
    method: str = "POST"
    params: dict = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    type: str = "task"   # "task" | "human_gate"
    hint: str = ""        # Instructions shown to user on human_gate
    app_link: str = ""    # App name for "Open App" button (e.g. "Dataset_Explorer_App")
    next_label: str = ""  # step1 : libellé de la prochaine étape (aperçu sur un human_gate)
    # Suivi live (barre de progression sous le node) : pendant que l'étape (appel bloquant)
    # tourne, l'orchestrateur POLL cet endpoint de la sous-app et relaie la progression en SSE.
    # Forme : {"app","poll","match":[field, value|${STEP:...}],"kind":"embed"|"scan"}. Vide = pas
    # de suivi (comportement inchangé). Les valeurs ${STEP:...} sont résolues à l'exécution.
    progress: dict = Field(default_factory=dict)


class PipelineDef(BaseModel):
    id: str
    name: str
    steps: list[PipelineStep]
    created_at: Optional[str] = None
    last_run: Optional[str] = None
    last_run_status: Optional[str] = None


def _file(pid: str) -> Path:
    return PIPELINES_DIR / f"{pid}.json"


def list_pipelines() -> list[PipelineDef]:
    result: list[PipelineDef] = []
    for f in sorted(PIPELINES_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            result.append(PipelineDef(**json.loads(f.read_text("utf-8"))))
        except Exception:
            pass
    return result


def get_pipeline(pid: str) -> Optional[PipelineDef]:
    f = _file(pid)
    if not f.exists():
        return None
    try:
        return PipelineDef(**json.loads(f.read_text("utf-8")))
    except Exception:
        return None


def save_pipeline(p: PipelineDef) -> None:
    _file(p.id).write_text(p.model_dump_json(indent=2), encoding="utf-8")


def create_pipeline(name: str, steps: list[dict]) -> PipelineDef:
    p = PipelineDef(
        id=str(uuid.uuid4()),
        name=name,
        steps=[PipelineStep(**s) for s in steps],
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    save_pipeline(p)
    return p


def update_pipeline(pid: str, name: str, steps: list[dict]) -> Optional[PipelineDef]:
    p = get_pipeline(pid)
    if not p:
        return None
    p.name = name
    p.steps = [PipelineStep(**s) for s in steps]
    save_pipeline(p)
    return p


def mark_run(pid: str, run_status: str) -> None:
    p = get_pipeline(pid)
    if not p:
        return
    p.last_run = datetime.now(timezone.utc).isoformat()
    p.last_run_status = run_status
    save_pipeline(p)


def delete_pipeline(pid: str) -> bool:
    f = _file(pid)
    if f.exists():
        f.unlink()
        return True
    return False
