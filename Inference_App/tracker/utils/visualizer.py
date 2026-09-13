##########################################
# Project  : VisionNexus
# File     : visualizer.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Modular rendering engine - display, PNG save, MP4 encode, and MJPEG stream.
##########################################

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None

from utils.logger import get_logger

log = get_logger(__name__)

Detection = list[float]  # [x1, y1, x2, y2, score, class_id]


##############################################################################
# Configuration
##############################################################################


@dataclass
class VisualizerConfig:
    ### Modes ##################################################################
    local_display: bool = False  # fenêtre imshow locale (HDMI) - false sur Jetson sans écran
    save_frames: bool = False  # PNG / JPG par frame dans output_dir/frames/
    save_video: bool = False  # MP4 dans output_dir/

    ### Sortie #################################################################
    output_dir: Path = Path("output")
    fps: float = 10.0
    frame_ext: str = "png"  # "png" ou "jpg"
    video_codec: str = "mp4v"  # "mp4v" --> .mp4  |  "XVID" --> .avi

    ### Fenêtre interactive ####################################################
    window_name: str = "VisionNexus Tracker"
    wait_ms: int = 1  # waitKey(wait_ms) ; 0 = pause sur chaque frame

    ### Overlays visuels (bounding boxes, etc.) ################################
    show_raw_det: bool = True
    show_tracks: bool = True
    show_gt: bool = True
    show_legend: bool = True

    ### Bande debug (debug_dialog_on_frames dans le YAML) #####################
    # True  -> bande info en bas + dot curseur + points clics (rendu sur canvas)
    # False -> rien sauf la légende de couleurs
    debug_overlay: bool = False

    ### Affichage des détections brutes pendant le SOT ########################
    # False (défaut) : masquer raw_dets quand sot_active=True.
    # True           : toujours afficher les détections même pendant le SOT.
    show_dets_in_sot: bool = False

    ### Mode de rendu ##########################################################
    # light_render: True  - ultrarapide (Jetson / bench / stream)
    #   · bboxes colorées uniquement - ZÉRO texte, traîne, légende, bande debug
    #   · BYPASS tous les flags ci-dessous (show_legend, debug_overlay, trail…)
    #   · économise ~3-5 ms/frame
    # light_render: False - mode complet (développement / analyse)
    #   · applique tous les flags : show_legend, debug_overlay, trail, show_gt…
    #   · ID de track, labels GT, légende, traîne, bande debug, log panel
    light_render: bool = False

    ### Streaming réseau (Jetson -> PC via Ethernet) ############################
    # "none"  : pas de stream (comportement par défaut)
    # "mjpeg" : serveur HTTP MJPEG sur stream_port
    stream_mode: str = "none"
    stream_host: str = "0.0.0.0"  # interface d'écoute Jetson
    stream_port: int = 8080
    stream_quality: int = 70  # qualité JPEG 0-100
    stream_every: int = 1  # envoyer 1 frame sur N (ex: 2 = ~22fps display)

    ### Longueur de la traîne des tracks ######################################
    trail_length: int = 20

    ### Epaisseurs (section render: du YAML) ###################################
    bbox_thickness: int = 1  # detections brutes/compensees + GT
    mot_bbox_thickness: int = 2  # tracks MOT actives (vert) - etat MOT pur
    mot_bg_bbox_thickness: int = 1  # tracks MOT en fond quand SOT actif (plus fin = highlight SOT)
    sot_bbox_thickness: int = 3  # track SOT1 (magenta, plus epais = plus visible)
    sot2_bbox_thickness: int = 3  # track SOT2 (orange)
    click_radius: int = 4  # rayon du point de clic (debug_overlay)
    click_thickness: int = 1  # epaisseur du contour du point de clic

    ### Couleurs BGR (section render: du YAML) #################################
    color_raw_det: tuple = (50, 50, 220)  # rouge        - detections brutes
    color_mot_active: tuple = (50, 210, 50)  # vert vif     - tracks MOT actives
    color_mot_predict: tuple = (50, 130, 50)  # vert sombre  - predictions Kalman
    color_sot_lock: tuple = (255, 60, 220)  # magenta      - SOT1 actif (clic gauche)
    color_sot_miss: tuple = (160, 30, 130)  # magenta som  - SOT1 perd temp.
    color_sot2_lock: tuple = (0, 165, 255)  # orange       - SOT2 actif (clic droit)
    color_sot2_miss: tuple = (0, 100, 180)  # orange som   - SOT2 perd temp.
    color_gt: tuple = (220, 200, 30)  # cyan         - ground truth


##############################################################################
# Visualizer
##############################################################################


class Visualizer:
    """
    Moteur de visu modulaire pour le tracker VisionNexus.

    Constructeurs
    #######
    Visualizer(config)            à partir d'un VisualizerConfig
    Visualizer.from_config(...)   kwargs directs (plus pratique)
    """

    # Hauteur fixe de la bande debug (pixels)
    DEBUG_BAR_H = 22

    def __init__(self, config: VisualizerConfig):
        self.cfg = config

        self._cv2 = self._import_cv2()
        self._writer = None
        self._video_path: Path | None = None
        self._frame_count = 0
        self._t_start = time.time()
        self._frames_dir: Path | None = None

        if self.cfg.save_frames:
            self._frames_dir = Path(self.cfg.output_dir) / "frames"
            self._frames_dir.mkdir(parents=True, exist_ok=True)
            log.info(f"Frames  --> {self._frames_dir}")

        if self.cfg.save_video:
            Path(self.cfg.output_dir).mkdir(parents=True, exist_ok=True)

        self._stream_server = None
        if self.cfg.stream_mode == "mjpeg":
            from utils.stream_server import MJPEGServer

            self._stream_server = MJPEGServer(
                host=self.cfg.stream_host,
                port=self.cfg.stream_port,
                quality=self.cfg.stream_quality,
                stream_every=self.cfg.stream_every,
            )
            self._stream_server.start()

        # File d'actions clavier à consommer par session.py (ex: toggle_mot_background)
        self._pending_actions: list[str] = []

    ####
    # Constructeur alternatif
    ####

    @classmethod
    def from_config(
        cls,
        local_display: bool = False,
        save_frames: bool = False,
        save_video: bool = False,
        output_dir: Path = Path("output"),
        fps: float = 10.0,
        **kwargs,
    ) -> Visualizer:
        """Crée un Visualizer depuis des kwargs directs."""
        cfg = VisualizerConfig(
            local_display=local_display,
            save_frames=save_frames,
            save_video=save_video,
            output_dir=Path(output_dir),
            fps=fps,
            **kwargs,
        )
        return cls(cfg)

    ####
    # Import OpenCV
    ####

    @staticmethod
    def _import_cv2():
        if cv2 is None:
            raise ImportError("opencv-python requis pour Visualizer.\n  pip install opencv-python")
        return cv2

    ####
    # Conversion IR -> BGR uint8
    ####

    @staticmethod
    def to_display(frame: np.ndarray) -> np.ndarray:
        """
        Convertit une frame brute en image BGR uint8 prête à afficher/encoder.

        Fast paths (sans copie ni normalisation) :
          - uint8 BGR  (H,W,3)  -> retourné directement (zero-copy)
          - uint8 BGRA (H,W,4)  -> slice [:,:,:3]
          - uint8 Gray (H,W)    -> cvtColor GRAY->BGR uniquement

        Path général (uint16 / float32 / …) :
          - cv2.normalize()  : SIMD single-pass, ~2× plus rapide que numpy min/max/div/clip
          - cvtColor si nécessaire
        """
        #####Fast paths uint8 ####
        if frame.dtype == np.uint8:
            if frame.ndim == 3 and frame.shape[2] == 3:
                return frame  # BGR direct
            if frame.ndim == 3 and frame.shape[2] == 4:
                return frame[:, :, :3]  # BGRA -> BGR (slice)
            if frame.ndim == 2:
                return cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)  # Gray -> BGR

        #####Path général : normalisation SIMD via cv2 ####
        # cv2.normalize fait min/max + stretch en une seule passe C/SIMD.
        # Bien plus rapide que : astype(float32) -> min/max -> / -> clip -> astype(uint8)
        norm = cv2.normalize(frame, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8U)

        if norm.ndim == 2:
            return cv2.cvtColor(norm, cv2.COLOR_GRAY2BGR)
        if norm.ndim == 3 and norm.shape[2] == 1:
            return cv2.cvtColor(norm[:, :, 0], cv2.COLOR_GRAY2BGR)
        return norm

    ####
    # Primitives visuelles (bounding boxes, tracks, légende)
    ####

    def _draw_raw_detections(self, canvas: np.ndarray, dets: list[Detection]):
        t = self.cfg.bbox_thickness
        for d in dets:
            x1, y1, x2, y2 = map(int, d[:4])
            self._cv2.rectangle(canvas, (x1, y1), (x2, y2), self.cfg.color_raw_det, t)

    def _draw_gt(self, canvas: np.ndarray, gt_boxes: list):
        cv2 = self._cv2
        t = self.cfg.bbox_thickness
        color = self.cfg.color_gt
        for item in gt_boxes:
            # Format : (cls, x1, y1, x2, y2)  ou  (cls, x1, y1, x2, y2, track_id)
            # On prend les 5 premiers champs pour rester compatible avec les deux formats.
            cls, x1, y1, x2, y2 = item[:5]
            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, t)
            # Mode debug uniquement : label de classe GT
            if not self.cfg.light_render:
                cv2.putText(
                    canvas,
                    f"GT{cls}",
                    (x1, max(y1 - 4, 10)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.35,
                    color,
                    1,
                )

    def _draw_tracks(self, canvas: np.ndarray, tracks: list, sot_active: bool = False):
        cv2 = self._cv2
        n = self.cfg.trail_length
        _light = self.cfg.light_render

        for trk in tracks:
            x1, y1, x2, y2 = map(int, trk.predicted_bbox())
            # Utiliser is_sot_target (sentinel posé par _SotTrack) plutot que
            # track_id == 0 : le 1er track MOT porte aussi ID=0 et serait rendu
            # en magenta a tort au debut d'une session (bug visuel).
            is_sot = getattr(trk, "is_sot_target", False)

            if is_sot:
                slot = getattr(trk, "sot_slot", 0)
                if slot == 1:
                    # SOT cible 2 (clic droit) - orange
                    color = (
                        self.cfg.color_sot2_lock
                        if trk.time_since_update == 0
                        else self.cfg.color_sot2_miss
                    )
                    thickness = self.cfg.sot2_bbox_thickness
                    label = (
                        "SOT2" if trk.time_since_update == 0 else f"SOT2?{trk.time_since_update}"
                    )
                else:
                    # SOT cible 1 (clic gauche) - magenta
                    color = (
                        self.cfg.color_sot_lock
                        if trk.time_since_update == 0
                        else self.cfg.color_sot_miss
                    )
                    thickness = self.cfg.sot_bbox_thickness
                    label = "SOT" if trk.time_since_update == 0 else f"SOT?{trk.time_since_update}"
            else:
                color = (
                    self.cfg.color_mot_active
                    if trk.time_since_update == 0
                    else self.cfg.color_mot_predict
                )
                # Quand SOT actif en fond (mot_background=true) : tracks MOT rendues
                # plus fines pour mettre en valeur la track SOT (magenta).
                thickness = (
                    self.cfg.mot_bg_bbox_thickness if sot_active else self.cfg.mot_bbox_thickness
                )
                label = f"T{trk.track_id}"

            cv2.rectangle(canvas, (x1, y1), (x2, y2), color, thickness)

            # Mode debug uniquement : label ID track
            if not _light:
                cv2.putText(
                    canvas,
                    label,
                    (x1, max(y1 - 6, 12)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.40,
                    color,
                    1,
                )

            # Traîne - mode debug uniquement (N lignes par track, coût ~0.5-1 ms)
            if not _light:
                pts = trk.history[-n:]
                for i in range(1, len(pts)):
                    alpha = i / max(len(pts) - 1, 1)
                    c = tuple(int(v * alpha) for v in color)
                    p0 = (int(pts[i - 1][0]), int(pts[i - 1][1]))
                    p1 = (int(pts[i][0]), int(pts[i][1]))
                    cv2.line(canvas, p0, p1, c, 1)

    def _draw_legend(self, canvas: np.ndarray, bottom_offset: int = 0):
        """
        Légende des couleurs, ancrée en bas à gauche.

        Parameters
        ########
        bottom_offset : décalage en pixels depuis le bas (ex. DEBUG_BAR_H quand
                        la bande debug est présente, pour ne pas se superposer).
        """
        cv2 = self._cv2
        h = canvas.shape[0]
        items = [
            (self.cfg.color_raw_det, "Raw det"),
            (self.cfg.color_mot_active, "Track"),
            (self.cfg.color_gt, "GT"),
        ]
        for i, (color, label) in enumerate(reversed(items)):
            y = h - 6 - bottom_offset - i * 14
            if y < 14:
                continue
            cv2.rectangle(canvas, (6, y - 8), (16, y), color, -1)
            cv2.putText(
                canvas,
                label,
                (20, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.32,
                color,
                1,
            )

    ####
    # Bande debug (debug_overlay=True) - dessinée sur le canvas avant saves
    ####

    def _draw_debug_bar(
        self,
        canvas: np.ndarray,
        frame_idx: int,
        n_tracks: int,
        H: np.ndarray | None,
        fps_live: float,
        sot_active: bool,
        event_text: str = "",
        cursor_pos: tuple[int, int] | None = None,
    ) -> None:
        """
        Bande d'information fixe en bas du canvas.

        Contenu : [MOT|SOT]  T:<n>  FPS:<fps>  F:<frame>  [EGO]  <bannière>  X:…Y:…

        Rendue AVANT les sauvegardes -> apparaît dans PNG et vidéo.
        """
        cv2 = self._cv2
        h, w = canvas.shape[:2]
        BAR_H = self.DEBUG_BAR_H
        y0 = h - BAR_H

        # Fond semi-transparent (noir 75 %)
        overlay = canvas.copy()
        cv2.rectangle(overlay, (0, y0), (w, h - 1), (15, 15, 15), -1)
        cv2.addWeighted(overlay, 0.75, canvas, 0.25, 0, canvas)
        cv2.line(canvas, (0, y0), (w, y0), (80, 80, 80), 1)

        font = cv2.FONT_HERSHEY_SIMPLEX
        fscale = 0.42
        thick = 1
        ty = h - 6  # ligne de base du texte

        #### État MOT / SOT (coloré)
        state_label = "SOT" if sot_active else "MOT"
        state_color = (0, 140, 255) if sot_active else (50, 200, 80)
        x = 6
        cv2.putText(canvas, f"[{state_label}]", (x, ty), font, fscale, state_color, thick)
        x += 52

        #### Nombre de tracks
        cv2.putText(canvas, f"T:{n_tracks}", (x, ty), font, fscale, (200, 200, 200), thick)
        x += 48

        #### FPS
        cv2.putText(canvas, f"FPS:{fps_live:.1f}", (x, ty), font, fscale, (200, 200, 200), thick)
        x += 75

        #### Numéro de frame
        cv2.putText(canvas, f"F:{frame_idx:05d}", (x, ty), font, fscale, (200, 200, 200), thick)
        x += 82

        #### EGO
        if H is not None:
            cv2.putText(canvas, "EGO", (x, ty), font, fscale, (0, 200, 200), thick)

        #### Bannière d'événement (centrée)
        if event_text:
            tw = cv2.getTextSize(event_text, font, fscale, thick)[0][0]
            ex = max(x + 40, (w - tw) // 2)
            cv2.putText(canvas, event_text, (ex, ty), font, fscale, (80, 230, 230), thick)

        #### Position curseur (alignée à droite)
        if cursor_pos is not None:
            cx, cy = cursor_pos
            txt = f"X:{cx:4d} Y:{cy:4d}"
            tw = cv2.getTextSize(txt, font, fscale, thick)[0][0]
            cv2.putText(canvas, txt, (w - tw - 8, ty), font, fscale, (160, 160, 160), thick)

    ####
    # Dot curseur et points de clics (debug_overlay=True, sur canvas)
    ####

    def _draw_cursor_dot(
        self,
        canvas: np.ndarray,
        cursor_pos: tuple[int, int],
    ) -> None:
        """Croix/cercle à la position du curseur (debug_overlay=True)."""
        cv2 = self._cv2
        cx, cy = cursor_pos
        color = (0, 220, 220)  # jaune-cyan
        cv2.circle(canvas, (cx, cy), 5, color, 1)
        cv2.line(canvas, (cx - 8, cy), (cx + 8, cy), color, 1)
        cv2.line(canvas, (cx, cy - 8), (cx, cy + 8), color, 1)

    def _draw_click_dots(
        self,
        canvas: np.ndarray,
        clicks: list[tuple[int, int]],
    ) -> None:
        """Red dots for recent clicks (debug_overlay=True)."""
        cv2 = self._cv2
        r = self.cfg.click_radius
        t = self.cfg.click_thickness
        for cx, cy in clicks:
            cv2.circle(canvas, (cx, cy), r, (0, 0, 200), -1)  # filled red
            cv2.circle(canvas, (cx, cy), r, (0, 0, 255), t)  # bright outline

    ####
    # Éléments UI display-only (non sauvegardés)
    ####

    def _draw_rec_indicator(
        self,
        canvas: np.ndarray,
        record_mode: bool,
    ) -> None:
        """
        Indicateur REC en haut à droite du canvas (display uniquement).

        Couleur :
          vert  (0, 160, 0)   = enregistrement ACTIF
          rouge (0, 0, 180)   = enregistrement INACTIF
        """
        cv2 = self._cv2
        _, w = canvas.shape[:2]

        label = "● REC ON " if record_mode else "○ REC OFF"
        bg_color = (0, 160, 0) if record_mode else (0, 0, 180)

        font = cv2.FONT_HERSHEY_SIMPLEX
        fscale = 0.45
        thick = 1
        tw, th = cv2.getTextSize(label, font, fscale, thick)[0]

        margin = 5
        x1 = w - tw - margin * 2 - 2
        y1 = margin
        x2 = w - margin
        y2 = y1 + th + margin + 2

        cv2.rectangle(canvas, (x1, y1), (x2, y2), bg_color, -1)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), (200, 200, 200), 1)
        cv2.putText(
            canvas,
            label,
            (x1 + margin, y2 - margin),
            font,
            fscale,
            (255, 255, 255),
            thick,
        )

    def _draw_cursor_xy(
        self,
        canvas: np.ndarray,
        cursor_pos: tuple[int, int],
        bottom_offset: int = 0,
    ) -> None:
        """
        Coordonnées X / Y du curseur en bas à droite (display uniquement).
        Police plus grande et épaisse.

        Parameters
        ########
        bottom_offset : décalage depuis le bas (ex. DEBUG_BAR_H quand la bande
                        debug est présente, pour ne pas se superposer).
        """
        cv2 = self._cv2
        h, w = canvas.shape[:2]
        cx, cy = cursor_pos

        txt = f"X:{cx:4d}  Y:{cy:4d}"
        font = cv2.FONT_HERSHEY_SIMPLEX
        fscale = 0.55
        thick = 2

        tw, th = cv2.getTextSize(txt, font, fscale, thick)[0]
        x = w - tw - 10
        y = h - 10 - bottom_offset

        # Fond sombre pour lisibilité
        cv2.rectangle(
            canvas,
            (x - 4, y - th - 4),
            (w - 4, y + 4),
            (30, 30, 30),
            -1,
        )
        cv2.putText(canvas, txt, (x, y), font, fscale, (220, 220, 220), thick)

    ####
    # Construction du canvas de base
    ####

    def _build_canvas(
        self,
        frame: np.ndarray,
        raw_detections: list[Detection],
        tracks: list,
        gt_boxes: list,
        frame_idx: int,
        H: np.ndarray | None,
        sot_active: bool = False,
    ) -> np.ndarray:
        """
        Construit le canvas RGB avec les éléments visuels de tracking.

        Contient toujours : bounding boxes (raw, GT), tracks + traînes.
        Quand sot_active=True et show_dets_in_sot=False, les détections raw
        sont masquées pour ne laisser visible que la track SOT (magenta).
        La légende est ajoutée si show_legend=True.
        """
        canvas = self.to_display(frame).copy()

        # Masquer les détections en mode SOT (sauf option show_dets_in_sot=True)
        _show_dets = not sot_active or self.cfg.show_dets_in_sot
        _light = self.cfg.light_render

        if _show_dets and self.cfg.show_raw_det:
            self._draw_raw_detections(canvas, raw_detections)
        if self.cfg.show_gt:
            self._draw_gt(canvas, gt_boxes)
        if self.cfg.show_tracks:
            # sot_active transmis pour amincir les tracks MOT de fond (mot_background=true)
            self._draw_tracks(canvas, tracks, sot_active=sot_active)

        # Légende : mode debug uniquement (4× rectangle + 4× putText)
        if self.cfg.show_legend and not _light:
            offset = self.DEBUG_BAR_H if self.cfg.debug_overlay else 0
            self._draw_legend(canvas, bottom_offset=offset)

        return canvas

    ####
    # VideoWriter (lazy init)
    ####

    def _get_writer(self, h: int, w: int):
        if self._writer is not None:
            return self._writer

        codec = self.cfg.video_codec
        ext = "mp4" if codec == "mp4v" else "avi"
        path = Path(self.cfg.output_dir) / f"tracking.{ext}"

        fourcc = self._cv2.VideoWriter_fourcc(*codec)
        writer = self._cv2.VideoWriter(str(path), fourcc, self.cfg.fps, (w, h))

        if not writer.isOpened():
            log.warning(f"Codec '{codec}' non disponible, fallback XVID (.avi)")
            path = Path(self.cfg.output_dir) / "tracking.avi"
            fourcc = self._cv2.VideoWriter_fourcc(*"XVID")
            writer = self._cv2.VideoWriter(str(path), fourcc, self.cfg.fps, (w, h))

        self._writer = writer
        self._video_path = path
        log.info(f"Video   --> {path}  ({w}x{h} @ {self.cfg.fps} fps)")
        return self._writer

    ####
    # Rendu principal
    ####

    def render(
        self,
        frame: np.ndarray,
        raw_detections: list[Detection],
        tracks: list,
        gt_boxes: list,
        frame_idx: int,
        H: np.ndarray | None = None,
        #### Gestionnaire de clics (interactif)
        click_handler=None,
        #### État du pipeline pour la bande debug
        sot_active: bool = False,
        event_text: str = "",
        #### Panneau log (debug_dialog_on_frames, display uniquement)
        log_panel=None,
        #### Clics command supplémentaires (mode command, points rouges)
        extra_clicks: list[tuple[int, int]] | None = None,
    ):
        """
        Rend une frame selon les modes actifs dans la config.

        Parameters
        ########
        frame           : image IR brute (uint16, float32…)
        raw_detections  : détections brutes (compensation ego-motion interne au tracker)
        tracks          : liste de Track (MOT) ou _SotTrack (SOT)
        gt_boxes        : [(cls, x1, y1, x2, y2), …]
        frame_idx       : index de la frame courante
        H               : homographie 3x3 (indicateur EGO dans la bande)
        click_handler   : ClickHandler ou None
        sot_active      : True si la machine d'état est en mode SOT
        event_text      : bannière d'événement (transition MOT<->SOT, etc.)
        log_panel       : LogPanel instance ou None - panneau terminal affiché
                          A DROITE de la fenetre display uniquement (n'est pas
                          sauvegarde dans les frames/video).
        """
        #### Extraction état click_handler
        cursor_pos = click_handler.cursor_pos if click_handler else None
        recent_clicks = click_handler.get_recent_clicks() if click_handler else []
        record_mode = click_handler.record_mode if click_handler else False

        # Fusionner les clics interactifs et les clics command (points rouges)
        if extra_clicks:
            recent_clicks = list(recent_clicks) + list(extra_clicks)

        #### Guard : aucun mode de sortie actif -> no-op (pas de canvas)
        if not any(
            [
                self.cfg.local_display,
                self.cfg.save_frames,
                self.cfg.save_video,
                self._stream_server is not None,
            ]
        ):
            self._frame_count += 1
            return

        #### Canvas de base (dets, tracks, légende)
        if (
            self.cfg.debug_overlay
            or self.cfg.save_frames
            or self.cfg.save_video
            or self.cfg.local_display
            or self._stream_server is not None
        ):
            canvas = self._build_canvas(
                frame,
                raw_detections,
                tracks,
                gt_boxes,
                frame_idx,
                H,
                sot_active=sot_active,
            )
            h, w = canvas.shape[:2]

        _light = self.cfg.light_render

        #### Bande debug + dot curseur + points clics (debug_overlay=True, mode debug uniquement)
        # Dessinée sur le canvas principal -> présente dans PNG et vidéo.
        # En mode light : complètement skippée (pas d'addWeighted, pas de putText).
        if self.cfg.debug_overlay and not _light:
            elapsed = time.time() - self._t_start
            fps_live = (self._frame_count + 1) / max(elapsed, 1e-6)

            if recent_clicks:
                self._draw_click_dots(canvas, recent_clicks)
            if cursor_pos is not None:
                self._draw_cursor_dot(canvas, cursor_pos)

            self._draw_debug_bar(
                canvas,
                frame_idx,
                len(tracks),
                H,
                fps_live,
                sot_active,
                event_text,
                cursor_pos,
            )

        #### Sauvegarde PNG / JPG
        if self.cfg.save_frames:
            name = f"{frame_idx:06d}.{self.cfg.frame_ext}"
            self._cv2.imwrite(str(self._frames_dir / name), canvas)

        #### Encodage vidéo
        if self.cfg.save_video:
            self._get_writer(h, w).write(canvas)

        #### Affichage interactif
        if self.cfg.local_display:
            # Copie isolée pour les overlays display-only (évite de polluer le canvas sauvegardé)
            display_canvas = canvas.copy()

            # En mode debug : indicateur REC + coordonnées curseur + log panel
            if not _light:
                self._draw_rec_indicator(display_canvas, record_mode)

                if self.cfg.debug_overlay and cursor_pos is not None:
                    self._draw_cursor_xy(
                        display_canvas,
                        cursor_pos,
                        bottom_offset=self.DEBUG_BAR_H + 4,
                    )

                #### Log panel sidebar (debug seulement, mode debug uniquement)
                if log_panel is not None and self.cfg.debug_overlay:
                    panel_img = log_panel.render(h)
                    display_canvas = self._cv2.hconcat([display_canvas, panel_img])

            self._cv2.imshow(self.cfg.window_name, display_canvas)
            key = self._cv2.waitKey(self.cfg.wait_ms) & 0xFF

            if key == ord("q"):
                log.info("Stop requested (key q)")
                raise KeyboardInterrupt("q pressed")

            elif key == ord("r"):
                # Bascule enregistrement des clics
                if click_handler is not None:
                    click_handler.toggle_record()

            elif key == ord("m"):
                # Toggle mot_background - consommé par session.py via pop_actions()
                self._pending_actions.append("toggle_mot_background")
                log.info("Key 'm' : demande toggle mot_background")

            elif key == ord(" "):
                log.info("Pause -- press space to resume")
                while True:
                    k2 = self._cv2.waitKey(100) & 0xFF
                    if k2 == ord(" ") or k2 == ord("q"):
                        if k2 == ord("q"):
                            raise KeyboardInterrupt("q pressed")
                        break

        # Streaming réseau (Jetson -> PC)
        if self._stream_server is not None:
            self._stream_server.push(canvas)

        self._frame_count += 1

    ####
    # Actions clavier
    ####

    def pop_actions(self) -> list[str]:
        """
        Retourne et vide la liste des actions clavier en attente.

        A appeler depuis session.py après chaque viz.render() pour traiter
        les touches pressées (ex: 'm' -> toggle mot_background).

        Returns
        ######
        List[str] : liste d'actions (peut être vide)
            "toggle_mot_background" : touche M pressée
        """
        acts = list(self._pending_actions)
        self._pending_actions.clear()
        return acts

    ####
    # Fermeture et bilan
    ####

    def close(self) -> dict:
        """
        Libère toutes les ressources.

        Returns
        ######
        dict :
          "frames_dir"  : Path ou None
          "video_path"  : Path ou None
          "n_frames"    : int
          "duration_s"  : float
        """
        if self._writer is not None:
            self._writer.release()
            self._writer = None

        if self._stream_server is not None:
            self._stream_server.stop()
            self._stream_server = None

        if self.cfg.local_display:
            self._cv2.destroyAllWindows()

        duration = time.time() - self._t_start
        summary = {
            "frames_dir": self._frames_dir,
            "video_path": self._video_path,
            "n_frames": self._frame_count,
            "duration_s": duration,
        }

        log.info(f"Visualizer closed - {self._frame_count} frames in {duration:.1f}s")
        if self._video_path:
            log.info(f"  video  : {self._video_path}")
        if self._frames_dir:
            log.info(f"  frames : {self._frames_dir}")

        return summary
