# ============================================================
# session_manager.py -- pilote les sessions du tracker VisionNexus.
# Construit le cfg, lance run_session(cfg, run_dir) sur un thread,
# force mode/stream, alloue un port MJPEG par session, et relaie
# clics/touches via le serveur MJPEG interne du tracker.
# ============================================================

import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import httpx

from backend import config as C
from backend.services import tracker_bridge as tb
from backend.services import settings_service as S


@dataclass
class Session:
    id: str
    cfg: dict
    run_dir: Path
    stream_port: int
    mode: str
    status: str = "starting"        # starting | running | done | error | stopped
    error: str = ""
    benchmark: Optional[dict] = None
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    thread: Optional[threading.Thread] = field(default=None, repr=False)

    def public(self) -> dict:
        b = self.benchmark or {}
        summary = {}
        if isinstance(b, dict):
            # remonte quelques chiffres cles du benchmark natif si presents
            for k in ("fps_proc", "fps_total"):
                if k in b:
                    summary[k] = b[k]
            for scope in ("mot", "sot", "global"):
                if isinstance(b.get(scope), dict):
                    summary[scope] = {m: b[scope][m] for m in ("MOTA", "IDF1") if m in b[scope]}
        return {
            "id": self.id,
            "status": self.status,
            "mode": self.mode,
            "stream_port": self.stream_port,
            "run_dir": str(self.run_dir),
            "started_at": self.started_at,
            "error": self.error,
            "benchmark_summary": summary,
        }


def _free_port(start: int, claimed: set[int]) -> int:
    for p in range(start, start + 300):
        if p in claimed:
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    raise RuntimeError(f"aucun port MJPEG libre a partir de {start}")


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    # -- cycle de vie ------------------------------------------------------
    def start(
        self,
        overrides: Optional[dict] = None,
        scenario: Optional[str] = None,
        mode: str = "interactive",
    ) -> Session:
        cfg = tb.load_base_config()
        if scenario:
            cfg = tb.deep_merge(cfg, tb.load_scenario(scenario))

        # Reglages utilisateur (workspace) : metriques + rendu. Appliques comme
        # defauts APRES le scenario, mais un override explicite reste prioritaire.
        st = S.load()
        m, r = st["metrics"], st["render"]
        cfg.setdefault("metrics_iou_threshold", m["iou_threshold"])
        cfg["compute_metrics"] = bool(m["compute_metrics"])
        if not cfg.get("annotation_file") and m["default_annotation_file"]:
            cfg["annotation_file"] = m["default_annotation_file"]
        cfg.setdefault("light_render", r["light_render"])
        cfg.setdefault("trail", r["trail"])
        cfg.setdefault("stream_quality", r["stream_quality"])

        if overrides:
            cfg.update({k: v for k, v in overrides.items() if v is not None})

        with self._lock:
            claimed = {s.stream_port for s in self._sessions.values()}
            stream_port = _free_port(C.STREAM_PORT_BASE, claimed)

            sid = uuid.uuid4().hex[:8]
            run_dir = C.RUNS_DIR / f"run_{datetime.now():%Y%m%d_%H%M%S}_{sid}"
            run_dir.mkdir(parents=True, exist_ok=True)

            # -- forcages IHM web (pas de GUI locale, flux MJPEG) --
            cfg["mode"] = mode                       # interactive | command | headless
            cfg["local_display"] = False
            cfg["stream_mode"] = "mjpeg"
            cfg["stream_host"] = "127.0.0.1"
            cfg["stream_port"] = stream_port
            cfg.setdefault("save_video", True)       # garde une trace video dans run_dir
            # route les clics enregistres (rejeu) vers le workspace
            cfg["record_dir"] = str(C.CMD_SEND_DIR)

            sess = Session(id=sid, cfg=cfg, run_dir=run_dir,
                           stream_port=stream_port, mode=mode)
            self._sessions[sid] = sess

        sess.thread = threading.Thread(target=self._run, args=(sess,), daemon=True)
        sess.thread.start()
        # laisse le serveur MJPEG se lier avant de rendre la main
        self._await_stream(sess, timeout=8.0)
        return sess

    def _run(self, sess: Session) -> None:
        try:
            sess.status = "running"
            run_session = tb.get_run_session()
            sess.benchmark = run_session(sess.cfg, sess.run_dir)
            if sess.status != "stopped":
                sess.status = "done"
        except Exception as exc:  # noqa: BLE001 -- on veut tout remonter a l'UI
            sess.status = "error"
            sess.error = f"{type(exc).__name__}: {exc}"

    def _await_stream(self, sess: Session, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        url = f"http://127.0.0.1:{sess.stream_port}/info"
        while time.monotonic() < deadline:
            if sess.status in ("error", "done", "stopped"):
                return
            try:
                httpx.get(url, timeout=0.5)
                return
            except Exception:
                time.sleep(0.25)

    def stop(self, sid: str) -> bool:
        sess = self._sessions.get(sid)
        if not sess:
            return False
        sess.status = "stopped"
        # 'q' reseau -> KeyboardInterrupt dans la boucle -> arret propre + benchmark
        try:
            httpx.post(f"http://127.0.0.1:{sess.stream_port}/key",
                       json={"key": "q"}, timeout=2.0)
        except Exception:
            pass
        return True

    # -- pont MJPEG (clics / touches) --------------------------------------
    def post_click(self, sid: str, x: int, y: int, button: int) -> bool:
        sess = self._sessions.get(sid)
        if not sess:
            return False
        try:
            httpx.post(f"http://127.0.0.1:{sess.stream_port}/click",
                       json={"x": x, "y": y, "button": button}, timeout=2.0)
            return True
        except Exception:
            return False

    def post_key(self, sid: str, key: str) -> bool:
        sess = self._sessions.get(sid)
        if not sess:
            return False
        try:
            httpx.post(f"http://127.0.0.1:{sess.stream_port}/key",
                       json={"key": key}, timeout=2.0)
            return True
        except Exception:
            return False

    def stream_base(self, sid: str) -> Optional[str]:
        sess = self._sessions.get(sid)
        return f"http://127.0.0.1:{sess.stream_port}" if sess else None

    # -- lecture -----------------------------------------------------------
    def get(self, sid: str) -> Optional[Session]:
        return self._sessions.get(sid)

    def list(self) -> list[dict]:
        return [s.public() for s in self._sessions.values()]


# singleton
manager = SessionManager()
