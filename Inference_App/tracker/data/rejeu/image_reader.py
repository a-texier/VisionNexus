##########################################
# Project  : VisionNexus
# File     : image_reader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Unified random-access frame reader supporting optional_format, video, and image folder inputs.
##########################################

import logging
import sys
from pathlib import Path

import numpy as np

_APP_ROOT = Path(__file__).resolve().parents[3]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

try:
    import cv2
except ImportError:
    cv2 = None  # mode optional_format fonctionnel sans cv2 ; video/folder lèvent ImportError à l'init

log = logging.getLogger(__name__)

_IMG_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".tif"}
_VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".m4v"}


class ImageReader:
    """
    Unified random-access frame reader.

    Supported inputs
    #########
    sequence_path = *.optional file   -> mode "optional_format"    (optional_format_adapter.readOTI)
    sequence_path = video file   -> mode "video"  (cv2.VideoCapture)
                   (.mp4 .avi .mov .mkv .m4v)
    sequence_path = folder       -> mode "folder" (cv2.imread per frame)

    Parameters
    ########
    sequence_path : Path-like
    slice_size    : int - optional_format slice size (ignored in folder/video modes)

    Attributes
    ########
    mode       : "optional_format" | "video" | "folder"
    resolution : (width, height)
    fps        : float - native FPS (video mode) or 0.0 (other modes)
    """

    def __init__(self, sequence_path, slice_size: int = 5):
        self._path = Path(sequence_path)
        self._slice_size = slice_size
        self._video_fps: float = 0.0
        self._cap = None  # cv2.VideoCapture (video mode only)
        self._cap_pos: int = 0  # next frame index in cap

        if self._path.is_file():
            suf = self._path.suffix.lower()
            if suf == ".optional":
                self._mode = "optional_format"
                self._init_optional_format(self._path)
            elif suf in _VIDEO_EXTS:
                self._mode = "video"
                self._init_video(self._path)
            else:
                raise ValueError(
                    f"ImageReader: fichier non reconnu : {self._path.name}\n"
                    f"  Formats acceptés : .optional  ou  {sorted(_VIDEO_EXTS)}\n"
                    "  Pour un dossier d'images : passer un répertoire."
                )

        elif self._path.is_dir():
            self._mode = "folder"
            self._init_folder()

        else:
            raise FileNotFoundError(
                f"ImageReader: chemin introuvable : {self._path}\n"
                "  Fournir un fichier .optional, une vidéo .mp4/.avi, "
                "ou un dossier d'images."
            )

        log.info(
            "ImageReader: mode=%s  frames=%d  res=%dx%d  fps=%.1f",
            self._mode,
            self._n,
            self._w,
            self._h,
            self._video_fps,
        )

    ####
    # Initialisation
    ####

    def _init_optional_format(self, optional_format_path: Path) -> None:
        log.info("optional_format: %s  (slice_size=%d)", optional_format_path.name, self._slice_size)
        from backend.services.format_registry import invoke_for_filename

        self._frames, header = invoke_for_filename(
            str(optional_format_path),
            "read",
            str(optional_format_path),
            slice_size=self._slice_size,
            use_wrapper=True,
            return_header=True,
        )
        self._n = int(header.dict["n_img"])
        first = self._frames[0]
        self._h, self._w = first.shape[:2]

    def _init_video(self, video_path: Path) -> None:
        """Ouvre un fichier vidéo via cv2.VideoCapture (lecture séquentielle ou random-access)."""
        if cv2 is None:
            raise ImportError(
                "opencv-python requis pour la lecture vidéo (pip install opencv-python)"
            )
        log.info("Video: %s", video_path.name)
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise OSError(f"ImageReader: impossible d'ouvrir la vidéo : {video_path}")

        self._n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self._w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self._h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self._video_fps = float(cap.get(cv2.CAP_PROP_FPS)) or 25.0

        # Garder le cap ouvert pour la lecture séquentielle (évite les seeks coûteux)
        self._cap = cap
        self._cap_pos = 0

    def _init_folder(self) -> None:
        files = sorted(
            p for p in self._path.iterdir() if p.is_file() and p.suffix.lower() in _IMG_EXTS
        )
        if not files:
            raise FileNotFoundError(f"ImageReader: no image files found in {self._path}")
        self._files = files
        self._n = len(files)

        if cv2 is None:
            raise ImportError(
                "opencv-python requis pour la lecture de dossier d'images (pip install opencv-python)"
            )
        sample = cv2.imread(str(files[0]), cv2.IMREAD_UNCHANGED)
        if sample is None:
            raise OSError(f"ImageReader: cannot read sample image {files[0]}")
        self._h, self._w = sample.shape[:2]

    ####
    # Public API
    ####

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def resolution(self) -> tuple[int, int]:
        """(width, height)"""
        return (self._w, self._h)

    @property
    def fps(self) -> float:
        """FPS natif (mode vidéo) - 0.0 pour optional_format / dossier."""
        return self._video_fps

    def __len__(self) -> int:
        return self._n

    def __getitem__(self, idx: int) -> np.ndarray:
        """Return the frame at *idx* as a numpy array."""
        if idx < 0 or idx >= self._n:
            raise IndexError(f"ImageReader: index {idx} out of range [0, {self._n})")

        if self._mode == "optional_format":
            return self._frames[idx]

        elif self._mode == "video":
            # Seek seulement si nécessaire (lecture séquentielle = pas de seek)
            if idx != self._cap_pos:
                self._cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                self._cap_pos = idx
            ret, frame = self._cap.read()
            self._cap_pos += 1
            if not ret or frame is None:
                log.warning("ImageReader: lecture vidéo échouée frame=%d", idx)
                return np.zeros((self._h, self._w, 3), dtype=np.uint8)
            return frame

        else:  # folder
            frame = cv2.imread(str(self._files[idx]), cv2.IMREAD_UNCHANGED)
            if frame is None:
                log.warning("ImageReader: cannot read %s", self._files[idx])
                return np.zeros((self._h, self._w), dtype=np.uint8)
            return frame

    def close(self) -> None:
        """Libère la VideoCapture (mode vidéo uniquement)."""
        if self._cap is not None:
            self._cap.release()
            self._cap = None
