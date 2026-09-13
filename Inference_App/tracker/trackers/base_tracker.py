##########################################
# Project  : VisionNexus
# File     : base_tracker.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Abstract base class defining the common MOT tracker interface.
##########################################

from abc import ABC, abstractmethod

import numpy as np


class BaseTracker(ABC):
    """
    Interface MOT commune.
    Toutes les implémentations doivent respecter ce contrat.
    """

    @abstractmethod
    def init(self, config: dict) -> None:
        """Initialise le tracker avec un dictionnaire de configuration."""

    @abstractmethod
    def update(
        self,
        frame: np.ndarray,
        detections: list[list[float]],
        H: np.ndarray | None = None,
    ) -> list:
        """
        Met a jour le tracker pour une frame.

        Parameters
        ########
        frame      : np.ndarray HxW ou HxWxC
        detections : list of [x1, y1, x2, y2, score, class_id]
                     Detections YOLO toujours brutes (jamais compensees
                     exterieurement). La CMC est appliquee en interne sur
                     les etats Kalman (Methode B : H avant predict()).
        H          : np.ndarray (3,3) ou None
                     Homographie frame_{i-1} -> frame_i.
                     Tous les trackers l'utilisent pour leur CMC interne :
                     custom_kalman/bytetrack -> camera_update sur KF ;
                     botsort  -> bypass GMC (sparseOptFlow) ;
                     boosttrack -> bypass ECC ou _apply_camera_update.

        Returns
        ######
        list of Track-like objects exposant au minimum :
            .track_id  : int
            .bbox      : [x1, y1, x2, y2]
            .score     : float
            .is_confirmed : bool
        """

    @abstractmethod
    def reset(self) -> None:
        """Remet le tracker dans son état initial."""

    ####
    # Compensation de mouvement camera (CMC) - interface optionnelle
    ####

    @property
    def has_internal_cmc(self) -> bool:
        """
        True si ce tracker effectue en interne sa propre CMC (Methode B).

        Tous les trackers retournent True. Les detections YOLO sont toujours
        passees brutes ; le tracker applique H sur ses etats Kalman via
        camera_update / _apply_camera_update / bypass GMC avant predict().

        Implementations :
          - custom_kalman  -> True   (Methode B camera_update interne)
          - bytetrack      -> True   (Methode B sur STrack.mean via _apply_camera_update)
          - botsort        -> True   (sparseOptFlow ou bypass LDV)
          - boosttrack     -> True   (ECC interne si use_ecc, sinon _apply_camera_update)
        """
        return False

    @property
    def has_own_image_cmc(self) -> bool:
        """
        True si ce tracker calcule lui-meme une homographie H depuis l'image.

        Concerne uniquement :
          - botsort  : GMC sparseOptFlow (si cmc_method != 'none')
          - boosttrack : ECC interne (si use_ecc=True)

        Quand True, session.py passe H=None au tracker (niveau 2 de la chaine
        de fallback) et ne calcule PAS de H_image externe. Le tracker utilise
        sa propre CMC image.

        Quand False (custom_kalman, bytetrack, boosttrack sans ECC), session.py
        doit fournir H externement (LDV ou H_image externe) ou pas de CMC.
        """
        return False

    def get_last_homography(self) -> np.ndarray | None:
        """
        Retourne l'homographie H (3x3, frame_prev -> frame_cur) calculée lors
        du dernier ``update()``.

        Utilisée dans le pipeline pour reprojecter un clic enregistré à la
        frame précédente (k=1) sans recalculer H depuis l'image.

        Retourne None si :
          - le tracker n'expose pas de H interne (BoT-SORT seulement)
          - le premier ``update()`` n'a pas encore été appelé
        """
        return None
