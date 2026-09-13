##########################################
# Project  : VisionNexus
# File     : detector_roi.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : ROI detectors triggered by click events, returning a single bbox for SOT init.
##########################################

import os
from abc import ABC, abstractmethod
from typing import Any

import numpy as np

from pipeline.detector.detector_mot import (
    _detect_candidates_multi,
    _to_uint8_gray,
)
from utils.logger import get_logger

log = get_logger(__name__)

# Type alias
Detection = list[float]


#### ROI Detectors #############################################################


class BaseDetectorROI(ABC):
    @abstractmethod
    def detect_at_click(self, frame: np.ndarray, click_pos: tuple) -> list | None:
        """
        Detecte la cible dans la region autour de `click_pos`.

        Parameters
        ########
        frame     : np.ndarray  HxW ou HxWxC
        click_pos : (x, y) coordonnees du clic en pixels

        Returns
        ######
        [x1, y1, x2, y2] en coordonnees image completes, ou None
        """


class NoneDetectorROI(BaseDetectorROI):
    """Detecteur ROI vide : retourne toujours None."""

    def detect_at_click(self, frame: np.ndarray, click_pos: tuple) -> list | None:
        return None


class TopHatROIDetector(BaseDetectorROI):
    """
    Detecteur ROI par top-hat morphologique autour du clic operateur.

    Extrait une ROI centree sur le clic, applique le top-hat, trouve les
    blobs et selectionne le meilleur par score composite :
      score = intensite * (1 / (1 + dist_clic * 0.1))

    Seuillage adaptatif disponible (use_adaptive=True) :
      thresh = max(min_thresh_abs, median + k_sigma * 1.4826 * MAD)

    Visualisation debug (debug_tracking.tophat_roi_save=true) :
      PNG deux vues (neutre + blobs) via visu_algo_debug.save_tophat_roi_debug().
      Ecrit dans <_debug_dir>/tophat_roi_click{N:04d}.png.
      _debug_dir injecte depuis run_dir/debug_tracking/ par session.py via cfg["_debug_dir"].

    Parameters
    ########
    roi_size_px     : demi-taille de la ROI autour du clic (pixels)
    tophat_kernels  : liste de tailles noyau  ex. [5]   (remplace kernel_size)
    k_sigma_levels  : liste de seuils sigma   ex. [2.0] (remplace k_sigma)
    threshold_rel   : seuil relatif si use_adaptive=False
    min_area_px2    : aire minimale d'un blob dans la ROI
    max_area_px2    : aire maximale d'un blob dans la ROI
    use_adaptive    : seuillage adaptatif (median + k_sigma * MAD)
    min_thresh_abs  : seuil absolu minimum (adaptatif)
    """

    def __init__(
        self,
        roi_size_px: int = 120,
        tophat_kernels: list = None,
        black_tophat_kernels: list = None,
        k_sigma_levels: list = None,
        threshold_rel: float = 0.3,
        min_area_px2: int = 4,
        max_area_px2: int = 2000,
        use_adaptive: bool = False,
        min_thresh_abs: int = 5,
        max_candidates: int = 0,
    ):
        self.roi_size_px = roi_size_px
        self.tophat_kernels = list(tophat_kernels) if tophat_kernels else [5]
        self.black_tophat_kernels = list(black_tophat_kernels) if black_tophat_kernels else []
        self.k_sigma_levels = list(k_sigma_levels) if k_sigma_levels else [2.0]
        self.threshold_rel = threshold_rel
        self.min_area_px2 = min_area_px2
        self.max_area_px2 = max_area_px2
        self.use_adaptive = use_adaptive
        self.min_thresh_abs = min_thresh_abs
        self._max_candidates = max_candidates  # 0 = pas de cap
        # Compat legacy
        self.kernel_size = self.tophat_kernels[0]

        # Debug (reconfigure par configure())
        self._debug_dir: str = ""
        self._debug_tophat_save: bool = False
        self._debug_click_count: int = 0
        self._debug_cfg = None  # AlgoDebugConfig (construit dans configure)

    def configure(self, cfg: dict) -> None:
        """
        Charge les parametres depuis le config dict.

        Sections lues :
          cfg["_debug_dir"]        : chemin injecte par session.py (run_dir/debug_tracking/)
          tophat_roi.*             : parametres algo (use_adaptive_thresh, k_sigma, min_thresh_abs)
          debug_tracking.*         : flags debug (tophat_roi_save)
          render.*                 : epaisseurs/rayons pour annotations

        Ne jamais appeler configure() avec un save_dir hardcode :
        lire uniquement cfg["_debug_dir"].
        """
        from utils.visu_algo_debug import AlgoDebugConfig

        # _debug_dir injecte par session.py dans la shallow copy de cfg
        self._debug_dir = str(cfg.get("_debug_dir", "outputs/debug_tracking"))

        # Parametres algo adaptatif depuis tophat_roi
        roi_cfg = cfg.get("tophat_roi", {})
        self.use_adaptive = bool(roi_cfg.get("use_adaptive_thresh", self.use_adaptive))
        self.min_thresh_abs = int(roi_cfg.get("min_thresh_abs", self.min_thresh_abs))
        # white_kernels (nouveau nom) avec fallback legacy tophat_kernels
        if "white_kernels" in roi_cfg:
            self.tophat_kernels = list(roi_cfg["white_kernels"])
            self.kernel_size = self.tophat_kernels[0]
        elif "tophat_kernels" in roi_cfg:
            self.tophat_kernels = list(roi_cfg["tophat_kernels"])
            self.kernel_size = self.tophat_kernels[0]
        # black_kernels : noyaux black tophat (cibles froides)
        if "black_kernels" in roi_cfg:
            self.black_tophat_kernels = list(roi_cfg["black_kernels"])
        if "k_sigma_levels" in roi_cfg:
            self.k_sigma_levels = list(roi_cfg["k_sigma_levels"])
        elif "k_sigma" in roi_cfg:
            self.k_sigma_levels = [float(roi_cfg["k_sigma"])]
        if "max_candidates" in roi_cfg:
            self._max_candidates = int(roi_cfg["max_candidates"])

        # Flags debug
        dbg = cfg.get("debug_tracking", {})
        self._debug_tophat_save = bool(dbg.get("tophat_roi_save", False))

        # Config de rendu (couleurs, epaisseurs)
        self._debug_cfg = AlgoDebugConfig(cfg, self._debug_dir)

        log.debug(
            "TopHatROIDetector.configure: tophat_roi_save=%s  debug_dir=%s"
            "  white_kernels=%s  black_kernels=%s  k_sigma_levels=%s  use_adaptive=%s  min_thresh_abs=%d",
            self._debug_tophat_save,
            self._debug_dir,
            self.tophat_kernels,
            self.black_tophat_kernels,
            self.k_sigma_levels,
            self.use_adaptive,
            self.min_thresh_abs,
        )

    def detect_at_click(self, frame: np.ndarray, click_pos: tuple) -> list | None:
        """
        Detecte la cible la plus proche du clic dans une ROI.

        Si debug_tracking.tophat_roi_save=true, sauvegarde une image PNG
        en deux vues (neutre + blobs) via visu_algo_debug.save_tophat_roi_debug().

        Returns [x1, y1, x2, y2] en coordonnees image completes, ou None.
        """
        cx, cy = int(click_pos[0]), int(click_pos[1])
        h, w = frame.shape[:2]

        # ROI clippee aux bords de l'image
        rx1 = max(0, cx - self.roi_size_px)
        ry1 = max(0, cy - self.roi_size_px)
        rx2 = min(w, cx + self.roi_size_px)
        ry2 = min(h, cy + self.roi_size_px)

        if rx2 <= rx1 or ry2 <= ry1:
            return None

        roi = frame[ry1:ry2, rx1:rx2]
        gray_roi = _to_uint8_gray(roi)

        # Coordonnees du clic dans la ROI
        click_in_roi_x = cx - rx1
        click_in_roi_y = cy - ry1

        # Seuillage + extraction blobs via cœur commun multi-kernel/sigma
        blobs, binary_roi, _ = _detect_candidates_multi(
            gray_roi,
            tophat_kernels=self.tophat_kernels,
            black_tophat_kernels=self.black_tophat_kernels,
            k_sigma_levels=self.k_sigma_levels,
            threshold_rel=self.threshold_rel,
            min_area_px2=self.min_area_px2,
            max_area_px2=self.max_area_px2,
            min_score=0.0,  # filtrage par score composite ci-dessous
            offset_x=0,
            offset_y=0,
            use_adaptive=self.use_adaptive,
            min_thresh_abs=self.min_thresh_abs,
        )

        if self._max_candidates > 0 and len(blobs) > self._max_candidates:
            blobs = blobs[: self._max_candidates]

        log.debug(
            "TopHatROIDetector: clic=(%d,%d)  ROI=[%d,%d,%d,%d]  kernels=%s  blobs=%d  max_candidates=%s",
            cx,
            cy,
            rx1,
            ry1,
            rx2,
            ry2,
            self.tophat_kernels,
            len(blobs),
            self._max_candidates if self._max_candidates > 0 else "off",
        )

        if not blobs:
            log.debug("TopHatROIDetector: aucun blob dans la ROI autour de (%d,%d)", cx, cy)
            if self._debug_tophat_save and self._debug_cfg is not None:
                self._save_debug_png(
                    gray_roi,
                    binary_roi,
                    [],
                    None,
                    click_in_roi_x,
                    click_in_roi_y,
                    (rx1, ry1, rx2, ry2),
                    {},
                )
            return None

        # Selectionner le blob avec le meilleur score composite
        best_score = -1.0
        best_blob = None
        for blob in blobs:
            bx1, by1, bx2, by2, intensity, _ = blob
            bcx = (bx1 + bx2) / 2.0
            bcy = (by1 + by2) / 2.0
            dist = ((bcx - click_in_roi_x) ** 2 + (bcy - click_in_roi_y) ** 2) ** 0.5
            composite = intensity * (1.0 / (1.0 + dist * 0.1))
            log.debug(
                "TopHatROIDetector: blob [%d,%d,%d,%d]  intensity=%.3f"
                "  dist=%.1f px  composite=%.3f",
                int(bx1),
                int(by1),
                int(bx2),
                int(by2),
                intensity,
                dist,
                composite,
            )
            if composite > best_score:
                best_score = composite
                best_blob = blob

        if best_blob is None:
            return None

        if self._debug_tophat_save and self._debug_cfg is not None:
            self._save_debug_png(
                gray_roi,
                binary_roi,
                blobs,
                best_blob,
                click_in_roi_x,
                click_in_roi_y,
                (rx1, ry1, rx2, ry2),
                {},
            )

        bx1, by1, bx2, by2 = best_blob[0], best_blob[1], best_blob[2], best_blob[3]
        log.debug(
            "TopHatROIDetector: best blob [%d,%d,%d,%d]  score=%.3f"
            "  -> coordonnees image [%d,%d,%d,%d]",
            int(bx1),
            int(by1),
            int(bx2),
            int(by2),
            best_score,
            int(bx1 + rx1),
            int(by1 + ry1),
            int(bx2 + rx1),
            int(by2 + ry1),
        )
        # Convertir en coordonnees image completes
        return [
            float(bx1 + rx1),
            float(by1 + ry1),
            float(bx2 + rx1),
            float(by2 + ry1),
        ]

    ######################################
    # Debug interne - ne pas appeler depuis l'exterieur
    ######################################

    def _save_debug_png(
        self,
        gray_roi: np.ndarray,
        binary_roi: np.ndarray,
        blobs: list,
        best_blob: list | None,
        click_roi_x: int,
        click_roi_y: int,
        roi_coords: tuple,
        stats: dict[str, Any] | None = None,
    ) -> None:
        """
        Delegue la sauvegarde PNG a visu_algo_debug.save_tophat_roi_debug().

        Chemin de sortie : <_debug_dir>/tophat_roi_click{N:04d}.png
        Toute la logique d'annotation/assemblage est dans visu_algo_debug.
        """
        try:
            from utils.visu_algo_debug import save_tophat_roi_debug

            self._debug_click_count += 1
            save_path = os.path.join(
                self._debug_dir,
                f"tophat_roi_click{self._debug_click_count:04d}.png",
            )

            algo_params = {
                "roi_size_px": self.roi_size_px,
                "tophat_kernels": self.tophat_kernels,
                "threshold_rel": self.threshold_rel,
                "use_adaptive": self.use_adaptive,
                "k_sigma_levels": self.k_sigma_levels,
            }
            save_tophat_roi_debug(
                gray_roi=gray_roi,
                binary_roi=binary_roi,
                blobs=blobs,
                best_blob=best_blob,
                click_roi_x=click_roi_x,
                click_roi_y=click_roi_y,
                roi_coords=roi_coords,
                save_path=save_path,
                debug_cfg=self._debug_cfg,
                stats=stats,
                algo_params=algo_params,
            )
        except Exception as exc:
            log.debug("TopHatROIDetector._save_debug_png: erreur -> %s", exc)
