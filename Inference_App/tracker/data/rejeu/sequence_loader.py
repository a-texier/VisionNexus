##########################################
# Project  : VisionNexus
# File     : sequence_loader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Generic sequence loader wrapping ImageReader with camera metadata and LDV support.
##########################################

import logging
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from .image_reader import ImageReader

log = logging.getLogger(__name__)

# Project root (data/rejeu/ is two levels below)
ROOT = Path(__file__).resolve().parent.parent.parent


class SequenceLoader:
    """
    Generic sequence loader - optional_format and PNG/JPG handled identically.

    Parameters
    ########
    path   : path to a *.optional file (optional_format mode) or an image folder (folder mode)
    config : dict - see module docstring for recognised keys
    """

    def __init__(self, path: str, config: dict):
        self._path = Path(path)
        self._config = config

        self._start = int(config.get("start_frame_idx", 0))
        self._stop = int(config.get("stop_frame_idx", -1))

        # -- Frame reading (optional_format file vs image folder) ##########
        self._reader = ImageReader(
            self._path,
            slice_size=int(config.get("slice_size", 5)),
        )

        # -- Directory used for metadata lookup ############
        # optional_format sequences: CSV files live next to the .optional file -> use parent.
        # Image folders: metadata files live in / alongside the folder itself.
        if self._path.is_file():
            self._meta_dir = self._path.parent
        else:
            self._meta_dir = self._path

        # -- Camera metadata (optional) ###############
        camera_name = (config.get("camera_name") or "").strip()
        self._ldv: dict[int, tuple[float, float, float]] = {}
        self._cam: dict = {
            "fps": float(config.get("fps", 10.0)),
            "width": 0,
            "height": 0,
            "chh_deg": 0.0,
            "chv_deg": 0.0,
        }

        if camera_name:
            self._load_metadata(camera_name, config.get("metadata_csv") or [])

        # Fall back to frame dimensions from ImageReader when metadata absent
        if not self._cam.get("width") or not self._cam.get("height"):
            w, h = self._reader.resolution
            self._cam["width"] = w
            self._cam["height"] = h

        log.info(
            "SequenceLoader: mode=%s  frames=%d  res=%dx%d  fps=%.1f  camera=%s",
            self._reader.mode,
            len(self),
            self._cam["width"],
            self._cam["height"],
            self.get_fps(),
            camera_name or "none",
        )

    ####
    # Metadata loading
    ####

    def _load_metadata(self, camera_name: str, csv_files: list) -> None:
        """
        Load camera metadata (LDV series + camera info).

        csv_files is a list of paths (relative to ROOT or absolute) pointing
        explicitly to the required CSV files.  Relative paths are resolved
        against the project ROOT before being forwarded to the camera reader.
        If the list is empty the camera reader falls back to auto-discovery
        in self._meta_dir (backward compatibility).
        """
        try:
            # Resolve relative CSV paths from ROOT
            resolved: list = []
            for f in csv_files:
                p = Path(f)
                if not p.is_absolute():
                    p = ROOT / p
                resolved.append(p)

            from .cameras import load_metadata_reader

            meta = load_metadata_reader(camera_name, self._meta_dir, resolved)
            self._ldv = meta.get_ldv_series()  # {frame_idx: (az, el)}
            cam = meta.get_camera_info()
            # Mise à jour champ par champ : fps seulement si non nul (évite
            # d'écraser le fps YAML quand la caméra ne le connaît pas).
            for key, val in cam.items():
                if key == "fps" and not val:
                    continue
                self._cam[key] = val

        except Exception as exc:
            log.warning(
                "Metadata reader failed (camera='%s'): %s - no LDV available",
                camera_name,
                exc,
            )

    ####
    # Iteration
    ####

    def __iter__(self) -> Iterator[tuple[int, np.ndarray, dict]]:
        n = len(self._reader)
        end = self._stop if self._stop >= 0 else n
        end = min(end, n)

        for frame_idx in range(self._start, end):
            frame = self._reader[frame_idx]
            meta = {
                "ldv":      self._ldv.get(frame_idx),   # (az_deg, el_deg, roulis_deg) ou None
                "hfov_deg": self._cam.get("chh_deg", 0.0),
                "vfov_deg": self._cam.get("chv_deg", 0.0),
            }
            yield frame_idx, frame, meta

    ####
    # BaseLoader-compatible interface
    ####

    def __len__(self) -> int:
        n = len(self._reader)
        end = self._stop if self._stop >= 0 else n
        return max(0, min(end, n) - self._start)

    def get_fps(self) -> float:
        # Priorité : métadonnées caméra > FPS natif vidéo > config YAML
        cam_fps = self._cam.get("fps", 0.0)
        if cam_fps:
            return float(cam_fps)
        if self._reader.fps:
            return float(self._reader.fps)
        return float(self._config.get("fps", 10.0))

    def close(self) -> None:
        """Libère les ressources (VideoCapture pour les fichiers vidéo)."""
        self._reader.close()

    def get_resolution(self) -> tuple[int, int]:
        """Returns (width, height)."""
        return (self._cam.get("width", 0), self._cam.get("height", 0))
