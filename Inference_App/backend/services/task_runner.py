# ============================================================
# task_runner.py -- lance des sous-process longs (export modele,
# build deploiement) en arriere-plan avec un journal en anneau.
# ============================================================

import subprocess
import threading
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class Task:
    id: str
    label: str
    status: str = "running"          # running | done | error
    returncode: Optional[int] = None
    artifact: Optional[str] = None
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    _log: deque = field(default_factory=lambda: deque(maxlen=400), repr=False)

    def public(self) -> dict:
        return {
            "id": self.id, "label": self.label, "status": self.status,
            "returncode": self.returncode, "artifact": self.artifact,
            "started_at": self.started_at, "log": list(self._log),
        }


class TaskRunner:
    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}

    def run(self, label: str, cmd: list[str], cwd: Path,
            env: Optional[dict] = None, artifact: Optional[Path] = None) -> Task:
        tid = uuid.uuid4().hex[:8]
        task = Task(id=tid, label=label)
        self._tasks[tid] = task
        threading.Thread(target=self._exec, args=(task, cmd, cwd, env, artifact),
                         daemon=True).start()
        return task

    def _exec(self, task: Task, cmd, cwd, env, artifact) -> None:
        task._log.append(f"$ {' '.join(str(c) for c in cmd)}  (cwd={cwd})")
        try:
            proc = subprocess.Popen(
                [str(c) for c in cmd], cwd=str(cwd), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
        except FileNotFoundError as exc:
            task.status = "error"
            task._log.append(f"[erreur] commande introuvable: {exc}")
            return
        for line in proc.stdout:               # type: ignore[union-attr]
            task._log.append(line.rstrip("\n"))
        proc.wait()
        task.returncode = proc.returncode
        if proc.returncode == 0:
            task.status = "done"
            if artifact and Path(artifact).exists():
                task.artifact = str(artifact)
        else:
            task.status = "error"

    def get(self, tid: str) -> Optional[Task]:
        return self._tasks.get(tid)


runner = TaskRunner()
