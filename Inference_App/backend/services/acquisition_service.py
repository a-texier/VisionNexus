# ============================================================
# acquisition_service.py -- MODE FREE de l'Inference_App.
#
# Capture un flux (dossier .optional, video, dossier d'images, http/MJPEG,
# tcp/ZMQ) et SAUVE les images brutes dans un dossier dataset :
#   <workspace>/acquisitions/<name>/frame_000000.png ...
#
# Ce dossier est directement consommable par Dataset_Explorer_App et Annotation_App
# (import par chemin serveur) pour annoter puis fine-tuner. C'est la "sortie"
# produite quand le noeud Inference n'a PAS d'entree (FREE).
# ============================================================

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend import config as C
from backend.services import tracker_bridge as tb


@dataclass
class Acquisition:
    id: str
    name: str
    source: str
    out_dir: Path
    target: int                       # nb d'images visees (0 = illimite jusqu'a fin de flux)
    status: str = "running"           # running | done | error | stopped
    n_saved: int = 0
    error: str = ""
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    _stop: threading.Event = field(default_factory=threading.Event, repr=False)
    thread: Optional[threading.Thread] = field(default=None, repr=False)

    def public(self) -> dict:
        return {"id": self.id, "name": self.name, "source": self.source,
                "out_dir": str(self.out_dir), "status": self.status,
                "n_saved": self.n_saved, "target": self.target,
                "error": self.error, "started_at": self.started_at}


class AcquisitionManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Acquisition] = {}
        self._lock = threading.Lock()

    def start(self, source: str, name: str = "", max_frames: int = 200,
              every: int = 1, fmt: str = "png",
              camera_name: str = "", start_frame: int = 0) -> Acquisition:
        safe = "".join(c for c in (name or datetime.now().strftime("acq_%Y%m%d_%H%M%S"))
                       if c.isalnum() or c in "-_")
        out_dir = C.ACQUISITIONS_DIR / safe
        out_dir.mkdir(parents=True, exist_ok=True)
        with self._lock:
            aid = uuid.uuid4().hex[:8]
            aq = Acquisition(id=aid, name=safe, source=source, out_dir=out_dir,
                             target=int(max_frames))
            self._jobs[aid] = aq
        aq.thread = threading.Thread(
            target=self._run, args=(aq, every, fmt, camera_name, start_frame), daemon=True)
        aq.thread.start()
        return aq

    @staticmethod
    def _to_8bit(frame):
        """Normalise en 8 bits (2-98 percentiles) si l'image n'est pas deja uint8
        (frames IR 16 bits / float) -> images annotables propres, pas de troncature."""
        import numpy as np
        if frame is None:
            return frame
        if frame.dtype == np.uint8:
            return frame
        f = frame.astype(np.float32)
        lo, hi = np.percentile(f, 2), np.percentile(f, 98)
        f = np.clip((f - lo) / max(hi - lo, 1e-6) * 255.0, 0, 255)
        return f.astype(np.uint8)

    def _run(self, aq: Acquisition, every: int, fmt: str,
             camera_name: str, start_frame: int) -> None:
        import cv2
        try:
            cfg = tb.load_base_config()
            cfg.update({
                "sequence_dir": aq.source,
                "mode": "headless", "local_display": False, "stream_mode": "none",
                "start_frame_idx": int(start_frame),
                "stop_frame_idx": -1,   # borne par target cote boucle
            })
            if camera_name:
                cfg["camera_name"] = camera_name

            build_loader = tb.get_build_loader()
            loader = build_loader(cfg)
            ext = "png" if fmt not in ("png", "jpg") else fmt
            manifest = []
            try:
                for frame_id, frame, _meta in loader:
                    if aq._stop.is_set():
                        aq.status = "stopped"
                        break
                    if aq.target and aq.n_saved >= aq.target:
                        break
                    if every > 1 and (frame_id % every != 0):
                        continue
                    fname = f"frame_{aq.n_saved:06d}.{ext}"
                    cv2.imwrite(str(aq.out_dir / fname), self._to_8bit(frame))
                    manifest.append({"file": fname, "src_frame_id": int(frame_id)})
                    aq.n_saved += 1
            finally:
                try:
                    loader.close()
                except Exception:
                    pass

            (aq.out_dir / "acquisition.json").write_text(
                json.dumps({"name": aq.name, "source": aq.source, "n_saved": aq.n_saved,
                            "frames": manifest}, ensure_ascii=False, indent=2), encoding="utf-8")
            if aq.status != "stopped":
                aq.status = "done"
        except Exception as exc:  # noqa: BLE001
            aq.status = "error"
            aq.error = f"{type(exc).__name__}: {exc}"

    def stop(self, aid: str) -> bool:
        aq = self._jobs.get(aid)
        if not aq:
            return False
        aq._stop.set()
        return True

    def get(self, aid: str) -> Optional[Acquisition]:
        return self._jobs.get(aid)

    def list(self) -> list[dict]:
        return [a.public() for a in self._jobs.values()]

    def list_datasets(self) -> list[dict]:
        """Datasets d'acquisition existants dans le workspace (mode FREE = expose l'existant)."""
        out = []
        if C.ACQUISITIONS_DIR.is_dir():
            for d in sorted(C.ACQUISITIONS_DIR.iterdir()):
                if not d.is_dir():
                    continue
                imgs = list(d.glob("*.png")) + list(d.glob("*.jpg"))
                out.append({"name": d.name, "path": str(d), "n_images": len(imgs)})
        return out


manager = AcquisitionManager()
