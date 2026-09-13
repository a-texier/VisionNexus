##########################################
# Project  : VisionNexus
# File     : visu_algo_debug.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Centralises all algorithm debug visualisations - binary videos, overlays, etc.
##########################################

from __future__ import annotations

import logging
import os
from typing import Any

try:
    import cv2
except ImportError:
    cv2 = None  # module de debug optionnel, opérations cv2 désactivées si absent

import numpy as np

log = logging.getLogger(__name__)


#################################
# Conversion generique IR -> BGR uint8
#################################


def to_uint8_display(frame: np.ndarray) -> np.ndarray:
    """
    Normalise un frame IR (uint16, float32, uint8 gray, BGR...) en BGR uint8.

    Compatible avec tous les formats produits par le loader MultiCsv.
    """
    img = frame.astype(np.float32)
    lo, hi = img.min(), img.max()
    if hi > lo:
        img = (img - lo) / (hi - lo) * 255.0
    img = img.clip(0, 255).astype(np.uint8)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.ndim == 3 and img.shape[2] == 1:
        img = cv2.cvtColor(img[:, :, 0], cv2.COLOR_GRAY2BGR)
    return img


#################################
# Configuration debug (lue depuis le dict cfg + debug_dir injecte)
#################################


class AlgoDebugConfig:
    """
    Charge et centralise les parametres de debug visuel depuis le cfg dict.

    Construit a partir de :
      cfg["debug_tracking"]  : options debug (tophat_roi_save, csrt_patch_save...)
      cfg["render"]          : parametres de rendu (epaisseurs, rayons...)
      debug_dir              : chemin effectif d'ecriture des fichiers debug
                               (injecte depuis run_dir/debug_tracking/ par session.py)

    Utilisation :
      debug_cfg = AlgoDebugConfig(cfg, debug_dir=str(run_dir / "debug_tracking"))
    """

    def __init__(self, cfg: dict, debug_dir: str):
        self.debug_dir = debug_dir

        dbg = cfg.get("debug_tracking", {})
        rnd = cfg.get("render", {})

        #####Debug tracking ######################
        self.tophat_roi_save = bool(dbg.get("tophat_roi_save", False))
        self.csrt_patch_save = bool(dbg.get("csrt_patch_save", False))
        self.csrt_patch_interval = int(dbg.get("csrt_patch_interval", 10))
        self.csrt_log_psr = bool(dbg.get("csrt_log_psr", True))
        self.csrt_kalman_box_visu = bool(dbg.get("csrt_kalman_box_visu", False))
        _vid_fps = float(dbg.get("debug_video_fps", 25.0))
        self.csrt_kalman_video_fps = _vid_fps
        self.binary_video_fps = _vid_fps
        self.tracking_tophat_video_fps = _vid_fps
        self.tracking_tophat_binary_video_fps = _vid_fps
        self.tracking_tophat_blob_video_fps = _vid_fps
        self.csrt_kalman_video_name = str(dbg.get("csrt_kalman_video_name", "csrt_kalman_debug.mp4"))
        # binary video tophat_mot
        self.tophat_binary_video = bool(dbg.get("tophat_mot_save_binary_video", False))
        self.binary_video_name = str(dbg.get("binary_video_name", "tophat_mot_binary.mp4"))
        # Tracking_TOPHAT SOT debug video (annote : zone recherche + blob + score)
        self.tracking_tophat_sot_video = bool(dbg.get("tracking_tophat_sot_save_video", False))
        self.tracking_tophat_video_name = str(dbg.get("tracking_tophat_video_name", "tracking_tophat_sot_debug.mp4"))
        # Tracking_TOPHAT SOT binary video (image seuilee dans la zone de recherche)
        self.tracking_tophat_binary_video = bool(dbg.get("tracking_tophat_binary_save_video", False))
        self.tracking_tophat_binary_video_name = str(
            dbg.get("tracking_tophat_binary_video_name", "tracking_tophat_seuillage_sot_debug.mp4")
        )
        # Tracking_TOPHAT SOT blob video (carte des N candidats + blob selectionne en rouge)
        self.tracking_tophat_blob_video = bool(dbg.get("tracking_tophat_blob_save_video", False))
        self.tracking_tophat_blob_video_name = str(
            dbg.get("tracking_tophat_blob_video_name", "tracking_tophat_blobs_sot_debug.mp4")
        )

        #####Rendu bboxes / clic ###############
        self.click_radius = int(rnd.get("click_radius", 3))
        self.click_thickness = int(rnd.get("click_thickness", 1))
        self.bbox_thickness = int(rnd.get("bbox_thickness", 1))
        self.selected_bbox_thickness = int(rnd.get("selected_bbox_thickness", 2))

        #####visu TopHat ROI debug (couleurs BGR, marge) ########
        # Marge (en px) autour de la ROI pour le patch debug
        self.tophat_patch_margin = int(dbg.get("tophat_patch_margin", 30))

        # Couleurs BGR
        def _to_color(key, default):
            return tuple(int(v) for v in dbg.get(key, default))

        self.color_roi_rect = _to_color("tophat_color_roi", [60, 60, 200])
        self.color_blobs = _to_color("tophat_color_blobs", [200, 80, 0])
        self.color_selected = _to_color("tophat_color_selected", [0, 200, 0])
        self.color_click = _to_color("tophat_color_click", [0, 0, 200])

    def ensure_dir(self) -> bool:
        """Cree le debug_dir si necessaire. Retourne True si ok."""
        try:
            os.makedirs(self.debug_dir, exist_ok=True)
            return True
        except Exception as exc:
            log.debug("AlgoDebugConfig.ensure_dir: %s", exc)
            return False


#################################
# Sauvegarde debug ROI TopHat (deux vues)
#################################


def save_tophat_roi_debug(
    gray_roi: np.ndarray,
    binary_roi: np.ndarray,
    blobs: list[list[float]],
    best_blob: list[float] | None,
    click_roi_x: int,
    click_roi_y: int,
    roi_coords: tuple[int, int, int, int],  # (rx1, ry1, rx2, ry2) dans image complète
    save_path: str,
    debug_cfg: AlgoDebugConfig,
    stats: dict[str, Any] | None = None,
    algo_params: dict[str, Any] | None = None,
) -> None:
    """
    Sauvegarde une image PNG avec deux vues cote-a-cote de la ROI TopHat.

    Vue gauche - binaire :
      - Image binaire seuilee (blanc sur noir)
      - Marqueur clic (croix couleur)

    Vue droite - blobs + infos :
      - Image grise de la ROI en BGR
      - Rectangle cadre ROI
      - Tous les blobs en bleu (fin)
      - Blob selectionne en vert (plus epais)
      - Stats en texte : mean, sigma, seuil, nb blobs
      - Parametres algo : roi_size, kernel, threshold, adaptive, k_sigma

    Parameters
    ########
    gray_roi    : image grise de la ROI (uint8)
    binary_roi  : image binaire apres seuillage (uint8, 0 ou 255)
    blobs       : liste [bx1,by1,bx2,by2,intensity,_] dans coords ROI
    best_blob   : blob selectionne ou None
    click_roi_x : position clic x dans la ROI
    click_roi_y : position clic y dans la ROI
    roi_coords  : (rx1,ry1,rx2,ry2) coords ROI dans image complete (pour infos)
    save_path   : chemin complet du PNG de sortie
    debug_cfg   : parametres de rendu
    stats       : dict optionnel : mean_roi, std_roi, noise_est, thresh_final, n_blobs
    algo_params : dict optionnel : roi_size_px, kernel_size, threshold_rel,
                  use_adaptive, k_sigma  (affiches dans la vue droite)
    """
    try:
        h_roi, w_roi = gray_roi.shape[:2]
        rx1, ry1, rx2, ry2 = roi_coords

        #####Vue gauche : image binaire pure (blanc sur noir) ####
        if binary_roi is not None and binary_roi.shape[:2] == gray_roi.shape[:2]:
            view_binary = cv2.cvtColor(binary_roi.copy(), cv2.COLOR_GRAY2BGR)
        else:
            view_binary = np.zeros((h_roi, w_roi, 3), dtype=np.uint8)

        #####Vue droite : image grise + annotations ####
        view_blobs = cv2.cvtColor(gray_roi.copy(), cv2.COLOR_GRAY2BGR)

        # Cadre ROI
        cv2.rectangle(view_blobs, (0, 0), (w_roi - 1, h_roi - 1), debug_cfg.color_roi_rect, 1)

        #####Marqueur clic (sur les deux vues) ####
        cx_l, cy_l = int(click_roi_x), int(click_roi_y)
        arm = max(4, debug_cfg.click_radius * 2)
        for view in (view_binary, view_blobs):
            cv2.line(
                view,
                (cx_l - arm, cy_l),
                (cx_l + arm, cy_l),
                debug_cfg.color_click,
                debug_cfg.click_thickness,
            )
            cv2.line(
                view,
                (cx_l, cy_l - arm),
                (cx_l, cy_l + arm),
                debug_cfg.color_click,
                debug_cfg.click_thickness,
            )
            cv2.circle(
                view,
                (cx_l, cy_l),
                debug_cfg.click_radius,
                debug_cfg.color_click,
                debug_cfg.click_thickness,
            )

        #####Blobs (vue droite uniquement) ####
        for blob in blobs:
            bx1, by1, bx2, by2 = int(blob[0]), int(blob[1]), int(blob[2]), int(blob[3])
            cv2.rectangle(
                view_blobs, (bx1, by1), (bx2, by2), debug_cfg.color_blobs, debug_cfg.bbox_thickness
            )

        if best_blob is not None:
            bx1, by1, bx2, by2 = (
                int(best_blob[0]),
                int(best_blob[1]),
                int(best_blob[2]),
                int(best_blob[3]),
            )
            cv2.rectangle(
                view_blobs,
                (bx1, by1),
                (bx2, by2),
                debug_cfg.color_selected,
                debug_cfg.selected_bbox_thickness,
            )

        #####Texte vue droite : stats + params algo ####
        font = cv2.FONT_HERSHEY_SIMPLEX
        fscale = 0.36
        thick = 1
        text_color = (210, 210, 210)
        text_lines: list[str] = []

        if stats:
            text_lines += [
                f"mean={stats.get('mean_roi', 0):.1f}",
                f"sig={stats.get('std_roi', 0):.1f}",
                f"noise={stats.get('noise_est', 0):.1f}",
                f"thr={stats.get('thresh_final', 0):.0f}",
                f"blobs={stats.get('n_blobs', 0)}",
            ]

        if algo_params:
            adp_str = "Y" if algo_params.get("use_adaptive") else "N"
            text_lines += [
                "--- params ---",
                f"roi={algo_params.get('roi_size_px', '?')}px",
                f"ker={algo_params.get('kernel_size', '?')}",
                f"thr={algo_params.get('threshold_rel', '?')}",
                f"adp={adp_str}  k={algo_params.get('k_sigma', '?')}",
            ]

        y0 = 12
        for i, line in enumerate(text_lines):
            y = y0 + i * 13
            if y < h_roi - 2:
                cv2.putText(view_blobs, line, (2, y), font, fscale, text_color, thick)

        #####Assemblage cote-a-cote ####
        gap = np.zeros((h_roi, 3, 3), dtype=np.uint8)  # separateur
        combined = np.hstack([view_binary, gap, view_blobs])

        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        cv2.imwrite(save_path, combined)
        log.debug("TopHat ROI debug -> %s", save_path)

    except Exception as exc:
        log.debug("save_tophat_roi_debug: erreur -> %s", exc)


#################################
# Sauvegarde debug patch CSRT
#################################


def save_csrt_patch_debug(
    frame: np.ndarray,
    bbox: list[int],
    save_path: str,
    debug_cfg: AlgoDebugConfig,
) -> None:
    """
    Sauvegarde le patch suivi par CSRT en PNG.

    Le patch inclut une marge autour de la bbox et un rectangle vert dessine
    sur la bbox de tracking. Le frame IR est normalise en uint8.

    Parameters
    ########
    frame      : frame IR courant (tout format)
    bbox       : [x1, y1, x2, y2] bbox CSRT
    save_path  : chemin complet du PNG de sortie
    debug_cfg  : parametres de rendu (marge non utilisee ici, on prend 20 px)
    """
    try:
        x1, y1, x2, y2 = [int(v) for v in bbox]
        margin = 20
        h_f, w_f = frame.shape[:2]
        px1 = max(0, x1 - margin)
        py1 = max(0, y1 - margin)
        px2 = min(w_f, x2 + margin)
        py2 = min(h_f, y2 + margin)
        patch = frame[py1:py2, px1:px2]
        if patch.size == 0:
            return
        patch_u8 = to_uint8_display(patch)
        # Bbox en coords patch
        lx1, ly1 = x1 - px1, y1 - py1
        lx2, ly2 = x2 - px1, y2 - py1
        cv2.rectangle(
            patch_u8,
            (lx1, ly1),
            (lx2, ly2),
            debug_cfg.color_selected,
            debug_cfg.selected_bbox_thickness,
        )
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        cv2.imwrite(save_path, patch_u8)
        log.debug("CSRT patch debug -> %s", save_path)
    except Exception as exc:
        log.debug("save_csrt_patch_debug: erreur -> %s", exc)


#################################
# Video binaire debug TopHat MOT
#################################


class TopHatBinaryVideoWriter:
    """
    Ecrit une video MP4 de l'image binaire seuilee TopHat (debug MOT).

    Initialise le VideoWriter lazily au premier appel de write().
    La video est ecrite dans debug_dir/binary_video_name.

    Utilisation :
      writer = TopHatBinaryVideoWriter(debug_dir, fps, video_name)
      writer.write(binary_frame)   # dans la boucle de detection
      writer.close()               # en fin de session
    """

    def __init__(
        self,
        debug_dir: str,
        fps: float = 25.0,
        video_name: str = "tophat_mot_binary.mp4",
    ):
        self._save_path = os.path.join(debug_dir, video_name)
        self._fps = fps
        self._writer = None
        self._debug_dir = debug_dir

    def write(self, binary: np.ndarray) -> None:
        """
        Ecrit un frame binaire dans la video.

        Parameters
        ########
        binary : np.ndarray uint8 - image binaire (0 ou 255), 1 ou 3 canaux
        """
        try:
            # Convertir en BGR 3 canaux pour VideoWriter
            if binary.ndim == 2:
                bgr = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
            elif binary.ndim == 3 and binary.shape[2] == 1:
                bgr = cv2.cvtColor(binary[:, :, 0], cv2.COLOR_GRAY2BGR)
            else:
                bgr = binary.copy()

            h, w = bgr.shape[:2]

            # Init lazily
            if self._writer is None:
                os.makedirs(self._debug_dir, exist_ok=True)
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                self._writer = cv2.VideoWriter(self._save_path, fourcc, self._fps, (w, h))
                if not self._writer.isOpened():
                    log.warning(
                        "TopHatBinaryVideoWriter: impossible d'ouvrir %s (codec mp4v)",
                        self._save_path,
                    )
                    self._writer = None
                    return
                log.info(
                    "TopHat binary video -> %s  (%dx%d @ %.0f fps)",
                    self._save_path,
                    w,
                    h,
                    self._fps,
                )

            self._writer.write(bgr)

        except Exception as exc:
            log.debug("TopHatBinaryVideoWriter.write: %s", exc)

    def close(self) -> None:
        """Libere le VideoWriter."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None
            log.info("TopHat binary video closed: %s", self._save_path)


#################################
# Video debug Tracking_TOPHAT SOT
#################################


class TrackingTophatSotVideoWriter:
    """
    Ecrit une video MP4 de debug du tracker Tracking_TOPHAT SOT.

    Chaque frame montre :
      - Image grise normalisee (RGB)
      - Rectangle de la zone de recherche (bleu)
      - Rectangle du blob selectionne (vert epais) ou "no match" si echec
      - Texte : frame_idx, score NCC, nb templates

    La video est ecrite dans debug_dir/tracking_tophat_video_name pendant que le SOT est actif.
    Arret et fermeture a reset().

    Utilisation :
      writer = TrackingTophatSotVideoWriter(debug_dir, fps, video_name)
      writer.write(frame, cx_pred, cy_pred, search_radius, bbox, score, n_tpl, frame_idx)
      writer.close()   # appele par TrackingTophatSot.reset()
    """

    def __init__(
        self,
        debug_dir: str,
        fps: float = 25.0,
        video_name: str = "tracking_tophat_sot_debug.mp4",
    ):
        self._save_path = os.path.join(debug_dir, video_name)
        self._fps = fps
        self._writer = None
        self._debug_dir = debug_dir

    def write(
        self,
        frame: np.ndarray,
        cx_pred: float,
        cy_pred: float,
        search_radius: int,
        bbox: list[int] | None,
        score: float,
        n_templates: int,
        frame_idx: int,
    ) -> None:
        """
        Ecrit un frame annote dans la video Tracking_TOPHAT SOT.

        Parameters
        ########
        frame         : frame IR courante (tout format)
        cx_pred       : centre predit x (zone de recherche)
        cy_pred       : centre predit y
        search_radius : demi-taille zone de recherche (px)
        bbox          : [x1,y1,x2,y2] du blob selectionne, ou None si echec
        score         : score NCC/cosinus du blob
        n_templates   : nombre de templates en historique
        frame_idx     : index de la frame
        """
        try:
            # Normaliser frame en uint8 BGR
            bgr = to_uint8_display(frame)
            h, w = bgr.shape[:2]

            # Zone de recherche (rectangle bleu)
            sx1 = max(0, int(cx_pred) - search_radius)
            sy1 = max(0, int(cy_pred) - search_radius)
            sx2 = min(w - 1, int(cx_pred) + search_radius)
            sy2 = min(h - 1, int(cy_pred) + search_radius)
            cv2.rectangle(bgr, (sx1, sy1), (sx2, sy2), (200, 80, 0), 1)  # bleu

            # Centre predit (croix jaune)
            cx_i, cy_i = int(cx_pred), int(cy_pred)
            arm = 5
            cv2.line(bgr, (cx_i - arm, cy_i), (cx_i + arm, cy_i), (0, 220, 220), 1)
            cv2.line(bgr, (cx_i, cy_i - arm), (cx_i, cy_i + arm), (0, 220, 220), 1)

            # Blob selectionne (vert epais)
            if bbox is not None:
                cv2.rectangle(bgr, (bbox[0], bbox[1]), (bbox[2], bbox[3]), (0, 220, 0), 2)
                status = f"OK  score={score:.3f}"
                status_color = (0, 220, 0)
            else:
                status = f"NO MATCH  score={score:.3f}"
                status_color = (0, 0, 220)

            # Texte info - panneau en bas de l image pour une meilleure lisibilite
            font = cv2.FONT_HERSHEY_SIMPLEX
            fscale = 0.55
            thick = 1
            lh = 22  # hauteur de ligne (px)
            info_lines = [
                (f"Tracking_TOPHAT SOT  f={frame_idx}", (220, 220, 220)),
                (status, status_color),
                (f"tpl={n_templates}", (180, 180, 180)),
            ]
            panel_h = lh * len(info_lines) + 8
            # Fond semi-opaque en bas
            overlay = bgr.copy()
            cv2.rectangle(overlay, (0, h - panel_h), (w, h), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.75, bgr, 0.25, 0, bgr)
            for i, (line, color) in enumerate(info_lines):
                y = h - panel_h + 6 + (i + 1) * lh - 4
                cv2.putText(bgr, line, (6, y), font, fscale, color, thick, cv2.LINE_AA)

            # Init VideoWriter lazily
            if self._writer is None:
                os.makedirs(self._debug_dir, exist_ok=True)
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                self._writer = cv2.VideoWriter(self._save_path, fourcc, self._fps, (w, h))
                if not self._writer.isOpened():
                    log.warning(
                        "TrackingTophatSotVideoWriter: impossible d'ouvrir %s (codec mp4v)",
                        self._save_path,
                    )
                    self._writer = None
                    return
                log.info(
                    "Tracking_TOPHAT SOT debug video -> %s  (%dx%d @ %.0f fps)",
                    self._save_path,
                    w,
                    h,
                    self._fps,
                )

            self._writer.write(bgr)

        except Exception as exc:
            log.debug("TrackingTophatSotVideoWriter.write: %s", exc)

    def close(self) -> None:
        """Libere le VideoWriter."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None
            log.info("Tracking_TOPHAT SOT debug video closed: %s", self._save_path)


#################################
# Video binaire debug Tracking_TOPHAT SOT (image seuilee dans la zone de recherche)
#################################


class TrackingTophatBinaryVideoWriter:
    """
    Ecrit une video MP4 de l'image binaire seuilee produite par le tracker Tracking_TOPHAT.

    Analogue a TopHatBinaryVideoWriter mais pour le SOT Tracking_TOPHAT :
    montre uniquement la zone de recherche (search_roi) en binaire,
    le reste du cadre est noir.

    La video est ecrite dans debug_dir/tracking_tophat_binary_video_name pendant que
    le SOT est actif. Arret et fermeture a reset().

    Utilisation :
      writer = TrackingTophatBinaryVideoWriter(debug_dir, fps, video_name)
      writer.write(binary_roi, sx1, sy1, frame_h, frame_w)  # dans update()
      writer.close()   # appele par TrackingTophatSot.reset()
    """

    def __init__(
        self,
        debug_dir: str,
        fps: float = 25.0,
        video_name: str = "tracking_tophat_seuillage_sot_debug.mp4",
    ):
        self._save_path = os.path.join(debug_dir, video_name)
        self._fps = fps
        self._writer = None
        self._debug_dir = debug_dir

    def write(
        self,
        binary_roi: np.ndarray,
        sx1: int,
        sy1: int,
        frame_h: int,
        frame_w: int,
        binary_black_roi: "np.ndarray | None" = None,
    ) -> None:
        """
        Ecrit un frame dans la video binaire Tracking_TOPHAT SOT.

        Construit un frame complet (frame_h x frame_w) tout noir,
        puis insere le binary_roi dans la zone de recherche [sy1:sy2, sx1:sx2].
        Si binary_black_roi est fourni et non vide, la video est colorisee :
          orange (0,165,255) = white tophat (cible chaude)
          cyan   (255,255,0) = black tophat (cible froide)

        Parameters
        ########
        binary_roi       : masque binaire white tophat (uint8 0/255) dans la ROI
        sx1, sy1         : coin haut-gauche de la zone de recherche
        frame_h          : hauteur du cadre complet (pixels)
        frame_w          : largeur du cadre complet (pixels)
        binary_black_roi : masque binaire black tophat (uint8 0/255) ou None
        """
        try:
            rh, rw = binary_roi.shape[:2]
            sy2 = min(frame_h, sy1 + rh)
            sx2 = min(frame_w, sx1 + rw)
            clip_h = sy2 - sy1
            clip_w = sx2 - sx1

            full_white = np.zeros((frame_h, frame_w), dtype=np.uint8)
            full_white[sy1:sy2, sx1:sx2] = binary_roi[:clip_h, :clip_w]

            if binary_black_roi is not None and binary_black_roi.any():
                full_black = np.zeros((frame_h, frame_w), dtype=np.uint8)
                bh, bw = binary_black_roi.shape[:2]
                bsy2 = min(frame_h, sy1 + bh)
                bsx2 = min(frame_w, sx1 + bw)
                full_black[sy1:bsy2, sx1:bsx2] = binary_black_roi[
                    : bsy2 - sy1, : bsx2 - sx1
                ]
                bgr = np.zeros((frame_h, frame_w, 3), dtype=np.uint8)
                bgr[full_white > 0] = (0, 165, 255)   # orange = cible chaude
                bgr[full_black > 0] = (255, 255, 0)   # cyan   = cible froide
                # overlap white+black -> jaune
                bgr[(full_white > 0) & (full_black > 0)] = (0, 255, 255)
            else:
                bgr = cv2.cvtColor(full_white, cv2.COLOR_GRAY2BGR)
            h, w = bgr.shape[:2]

            if self._writer is None:
                os.makedirs(self._debug_dir, exist_ok=True)
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                self._writer = cv2.VideoWriter(self._save_path, fourcc, self._fps, (w, h))
                if not self._writer.isOpened():
                    log.warning(
                        "TrackingTophatBinaryVideoWriter: impossible d'ouvrir %s (codec mp4v)",
                        self._save_path,
                    )
                    self._writer = None
                    return
                log.info(
                    "Tracking_TOPHAT binary video -> %s  (%dx%d @ %.0f fps)", self._save_path, w, h, self._fps
                )

            self._writer.write(bgr)

        except Exception as exc:
            log.debug("TrackingTophatBinaryVideoWriter.write: %s", exc)

    def close(self) -> None:
        """Libere le VideoWriter."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None
            log.info("Tracking_TOPHAT binary video closed: %s", self._save_path)


#################################
# Video blob debug Tracking_TOPHAT SOT (carte des candidats + blob retenu)
#################################


class TrackingTophatBlobVideoWriter:
    """
    Ecrit une video MP4 montrant la carte des blobs candidats Tracking_TOPHAT SOT.

    Chaque frame montre (sur l'image IR complete normalisee) :
      - Rectangle bleu     : zone de recherche (search ROI)
      - Croix jaune        : centre predit Kalman
      - Rectangles cyan    : tous les N blobs candidats apres dedup
      - Rectangle rouge    : blob selectionne (score >= seuil) + score en texte
      - Panel bas          : frame_idx, nb candidats, meilleur score

    Cout = zero si tracking_tophat_blob_save_video: false (writer == None, jamais instancie).
    Un MP4 est cree par clic (numerote _c001, _c002 ...) comme les autres videos Tracking_TOPHAT.
    """

    def __init__(
        self,
        debug_dir: str,
        fps: float = 25.0,
        video_name: str = "tracking_tophat_blobs_sot_debug.mp4",
    ):
        self._save_path = os.path.join(debug_dir, video_name)
        self._fps = fps
        self._writer = None
        self._debug_dir = debug_dir

    def write(
        self,
        frame: np.ndarray,
        cx_pred: float,
        cy_pred: float,
        search_radius: int,
        candidates: list,
        best_blob: list | None,
        best_score: float,
        frame_idx: int,
    ) -> None:
        """
        Ecrit une frame annotee dans la video blob Tracking_TOPHAT.

        Parameters
        ----------
        frame         : frame IR courante (tout format)
        cx_pred       : centre predit x (Kalman)
        cy_pred       : centre predit y (Kalman)
        search_radius : demi-taille zone de recherche (px)
        candidates    : liste de blobs [x1,y1,x2,y2,...] coords image completes
        best_blob     : blob retenu [x1,y1,x2,y2,...] ou None si echec
        best_score    : score global du blob retenu (ou meilleur score si echec)
        frame_idx     : index de la frame
        """
        try:
            bgr = to_uint8_display(frame)
            h, w = bgr.shape[:2]

            # Zone de recherche (rectangle bleu)
            sx1 = max(0, int(cx_pred) - search_radius)
            sy1 = max(0, int(cy_pred) - search_radius)
            sx2 = min(w - 1, int(cx_pred) + search_radius)
            sy2 = min(h - 1, int(cy_pred) + search_radius)
            cv2.rectangle(bgr, (sx1, sy1), (sx2, sy2), (200, 80, 0), 1)  # bleu fonce

            # Centre predit (croix jaune)
            cx_i, cy_i = int(cx_pred), int(cy_pred)
            arm = 5
            cv2.line(bgr, (cx_i - arm, cy_i), (cx_i + arm, cy_i), (0, 220, 220), 1)
            cv2.line(bgr, (cx_i, cy_i - arm), (cx_i, cy_i + arm), (0, 220, 220), 1)

            # Tous les candidats (cyan fin)
            for blob in candidates:
                bx1, by1, bx2, by2 = int(blob[0]), int(blob[1]), int(blob[2]), int(blob[3])
                cv2.rectangle(bgr, (bx1, by1), (bx2, by2), (220, 220, 0), 1)

            # Blob retenu (rouge epais + score)
            if best_blob is not None:
                bx1 = int(best_blob[0])
                by1 = int(best_blob[1])
                bx2 = int(best_blob[2])
                by2 = int(best_blob[3])
                cv2.rectangle(bgr, (bx1, by1), (bx2, by2), (0, 0, 220), 2)
                score_txt = f"{best_score:.3f}"
                cv2.putText(
                    bgr, score_txt,
                    (bx1, max(0, by1 - 3)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 220), 1, cv2.LINE_AA,
                )
                status = f"OK  score={best_score:.3f}"
                status_color = (0, 220, 0)
            else:
                status = f"NO MATCH  best={best_score:.3f}"
                status_color = (0, 0, 220)

            # Panel bas
            font = cv2.FONT_HERSHEY_SIMPLEX
            fscale = 0.50
            thick = 1
            lh = 20
            info_lines = [
                (f"Tracking_TOPHAT BLOBS  f={frame_idx}", (220, 220, 220)),
                (f"candidats={len(candidates)}", (180, 180, 180)),
                (status, status_color),
            ]
            panel_h = lh * len(info_lines) + 8
            overlay = bgr.copy()
            cv2.rectangle(overlay, (0, h - panel_h), (w, h), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.75, bgr, 0.25, 0, bgr)
            for i, (line, color) in enumerate(info_lines):
                y = h - panel_h + 6 + (i + 1) * lh - 4
                cv2.putText(bgr, line, (6, y), font, fscale, color, thick, cv2.LINE_AA)

            # Init VideoWriter lazily
            if self._writer is None:
                os.makedirs(self._debug_dir, exist_ok=True)
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                self._writer = cv2.VideoWriter(self._save_path, fourcc, self._fps, (w, h))
                if not self._writer.isOpened():
                    log.warning(
                        "TrackingTophatBlobVideoWriter: impossible d'ouvrir %s (codec mp4v)",
                        self._save_path,
                    )
                    self._writer = None
                    return
                log.info(
                    "Tracking_TOPHAT blob video -> %s  (%dx%d @ %.0f fps)",
                    self._save_path, w, h, self._fps,
                )

            self._writer.write(bgr)

        except Exception as exc:
            log.debug("TrackingTophatBlobVideoWriter.write: %s", exc)

    def close(self) -> None:
        """Libere le VideoWriter."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None
            log.info("Tracking_TOPHAT blob video closed: %s", self._save_path)


#################################
# Video debug CSRT - bbox Kalman projetee vs bbox CSRT
#################################


class CsrtKalmanVideoWriter:
    """
    Writes an MP4 debug video for CSRT showing bbox layers.

    Each frame shows (when available):
      - Yellow rect : search zone (padding * previous bbox around last center)
      - Grey   rect : previous bbox position
      - Cyan   cross: Kalman prediction (cx_pred, cy_pred)
      - Green  rect : CSRT detection bbox
      - Info panel  : frame_idx, cam_shift, PSR

    Useful for diagnosing:
      - How far the search zone covers vs actual camera shift
      - Kalman prediction accuracy
      - PSR evolution and CSRT loss events

    Usage:
      writer = CsrtKalmanVideoWriter(debug_dir, fps, video_name)
      writer.write(frame, csrt_bbox, cam_shift, psr, frame_idx,
                   kf_pred=None, last_bbox=None, search_zone=None)
      writer.close()   # called by CsrtSot.reset()
    """

    def __init__(
        self,
        debug_dir: str,
        fps: float = 25.0,
        video_name: str = "csrt_kalman_debug.mp4",
    ):
        self._save_path = os.path.join(debug_dir, video_name)
        self._fps = fps
        self._writer = None
        self._debug_dir = debug_dir

    def write(
        self,
        frame: np.ndarray,
        csrt_bbox: list | None,
        cam_shift: float,
        psr: float | None,
        frame_idx: int,
        kf_pred: tuple | None = None,
        last_bbox: list | None = None,
        search_zone: list | None = None,
    ) -> None:
        """
        Write one annotated frame to the CSRT debug video (single panel).

        Parameters
        ----------
        frame       : current IR frame (any format)
        csrt_bbox   : [x1,y1,x2,y2] final CSRT bbox, None if lost
        cam_shift   : camera displacement in px (LDV H, for info only)
        psr         : CSRT PSR score or None if unavailable
        frame_idx   : frame index (for label)
        kf_pred     : (cx, cy) Kalman predicted center, None if KF disabled
        last_bbox   : [x1,y1,x2,y2] bbox from previous frame
        search_zone : [x1,y1,x2,y2] search area = padding * last_bbox
        """
        try:
            bgr = to_uint8_display(frame)
            h, w = bgr.shape[:2]

            def _clip_pt(x, y, fw, fh):
                return max(0, min(int(x), fw - 1)), max(0, min(int(y), fh - 1))

            def _draw_rect(img, x1, y1, x2, y2, color, thickness=1):
                fw, fh = img.shape[1], img.shape[0]
                p1 = _clip_pt(x1, y1, fw, fh)
                p2 = _clip_pt(x2, y2, fw, fh)
                cv2.rectangle(img, p1, p2, color, thickness)

            def _draw_cross(img, cx, cy, arm, color, thickness=1):
                fw, fh = img.shape[1], img.shape[0]
                p1x = _clip_pt(cx - arm, cy, fw, fh)
                p2x = _clip_pt(cx + arm, cy, fw, fh)
                p1y = _clip_pt(cx, cy - arm, fw, fh)
                p2y = _clip_pt(cx, cy + arm, fw, fh)
                cv2.line(img, p1x, p2x, color, thickness)
                cv2.line(img, p1y, p2y, color, thickness)
                cv2.circle(img, _clip_pt(cx, cy, fw, fh), 3, color, thickness)

            # Overlays on frame
            if search_zone is not None:
                _draw_rect(bgr, *[int(v) for v in search_zone], (255, 255, 0), 1)
            if last_bbox is not None:
                _draw_rect(bgr, *[int(v) for v in last_bbox], (220, 220, 220), 1)
            if kf_pred is not None:
                _draw_cross(bgr, kf_pred[0], kf_pred[1], 8, (0, 220, 220), 1)
            if csrt_bbox is not None:
                _draw_rect(bgr, *[int(v) for v in csrt_bbox], (0, 220, 0), 2)

            canvas = bgr

            # ── Info panel at bottom ─────────────────────────────────────────
            ch, cw = canvas.shape[:2]
            font = cv2.FONT_HERSHEY_SIMPLEX
            fscale = 0.44
            thick = 1
            lh = 18

            status, status_color = (
                ("CSRT OK", (0, 220, 0)) if csrt_bbox is not None
                else ("CSRT LOST", (0, 0, 220))
            )
            psr_str = f"PSR={psr:.2f}" if psr is not None else "PSR=N/A"
            kf_str = (
                f"kf=({int(kf_pred[0])},{int(kf_pred[1])})"
                if kf_pred is not None else "kf=off"
            )

            info_lines = [
                (f"f={frame_idx}  {status}", status_color),
                (f"cam_shift={cam_shift:.1f}px", (180, 180, 180)),
                (f"{psr_str}  {kf_str}", (180, 180, 180)),
            ]

            panel_h = lh * len(info_lines) + 8
            overlay = canvas.copy()
            cv2.rectangle(overlay, (0, ch - panel_h), (cw, ch), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.75, canvas, 0.25, 0, canvas)
            for i, (line, color) in enumerate(info_lines):
                y = ch - panel_h + 6 + (i + 1) * lh - 4
                cv2.putText(canvas, line, (6, y), font, fscale, color, thick, cv2.LINE_AA)

            # ── Init VideoWriter lazily (size may change first frame) ────────
            if self._writer is None:
                os.makedirs(self._debug_dir, exist_ok=True)
                fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                self._writer = cv2.VideoWriter(
                    self._save_path, fourcc, self._fps, (cw, ch)
                )
                if not self._writer.isOpened():
                    log.warning(
                        "CsrtKalmanVideoWriter: impossible d'ouvrir %s (codec mp4v)",
                        self._save_path,
                    )
                    self._writer = None
                    return
                log.info(
                    "CSRT Kalman debug video -> %s  (%dx%d @ %.0f fps)",
                    self._save_path, cw, ch, self._fps,
                )

            self._writer.write(canvas)

        except Exception as exc:
            log.debug("CsrtKalmanVideoWriter.write: %s", exc)

    def close(self) -> None:
        """Libere le VideoWriter."""
        if self._writer is not None:
            self._writer.release()
            self._writer = None
            log.info("CSRT Kalman debug video closed: %s", self._save_path)
