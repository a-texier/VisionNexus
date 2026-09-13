"""
trackers/sot/base_sot.py
------------------------
Interface commune pour tous les trackers SOT.

Contrat :
  init(frame, click_pos, mot_tracks)   -> démarrage du suivi
  update(frame, mot_tracks)            -> propagation (une frame)
  reset()                              -> remise à l'état initial

Tous les trackers SOT reçoivent :
  - click_pos  : (x, y) position pixel du clic utilisateur
  - mot_tracks : liste de tracks MOT courants (peut être vide ou None)
                 Utilisé pour trouver la bbox initiale la plus proche du clic.
                 Les trackers point-only (SAM2) peuvent l'ignorer.
"""

import math
from abc import ABC, abstractmethod

import numpy as np


class BaseSot(ABC):
    """
    Interface SOT commune.
    init  -> démarre le suivi sur une cible (clic + tracks MOT optionnels)
    update -> propage le suivi frame suivante
    reset  -> remet à l'état initial
    """

    @abstractmethod
    def init(
        self,
        frame: np.ndarray,
        click_pos: tuple,  # (x, y) position pixel du clic
        mot_tracks=None,  # liste de Track-like objects courants (peut être [])
    ) -> None:
        """
        Initialise le SOT sur la frame et la position de clic données.

        Parameters
        ########
        frame      : image courante (IR uint16 ou BGR uint8)
        click_pos  : (x, y) pixel du clic utilisateur
        mot_tracks : tracks MOT courants - utilisés pour extraire une bbox
                     initiale. Peut être None ou [] (trackers point-only).
        """

    @abstractmethod
    def update(
        self,
        frame: np.ndarray,
        mot_tracks=None,
        H: np.ndarray | None = None,
    ) -> tuple[bool, list | None, np.ndarray | None]:
        """
        Propage le suivi d'une frame.

        Parameters
        ########
        frame      : image courante
        mot_tracks : tracks MOT (utilisé par DummySot pour trouver la track cible)
        H          : homographie 3x3 (frame_{i-1} -> frame_i) pour CMC interne.
                     None si LDV indisponible ou caméra fixe.
                     Utilisé par CsrtSot pour Kalman CMC + re-ancrage.
                     Ignoré par DummySot, DiMP, OSTrack, SAM2 (pour l'instant).

        Returns
        ######
        success : bool              - True si la piste est valide
        bbox    : [x1,y1,x2,y2]    - bbox courante (None si success=False)
        mask    : np.ndarray|None   - masque de segmentation (None si non dispo)
        """

    def configure(self, cfg: dict) -> None:
        """
        Charge les hyperparamètres spécifiques à ce tracker depuis le dict cfg.

        Appelé par builders.build_trackers() après instanciation et avant
        la première frame.  Chaque tracker lit sa propre section du config
        (ex. cfg["csrt"]["psr_threshold"]).

        Implémentation par défaut : no-op.
        Surcharger dans les trackers qui ont des hyperparamètres configurables.
        """

    def reset(self) -> None:
        """Remet le tracker SOT dans son état initial (optionnel)."""

    @property
    def hides_mot_tracks(self) -> bool:
        """
        Quand True, la state machine :
          - fait toujours tourner le MOT en arriere-plan (meme si une commande
            mot_state=0 a ete recue pour desactiver le MOT)
          - retourne UNIQUEMENT la track SOT au visualizer (aucune track MOT affichee)

        Utile pour DummySot qui depend des tracks MOT mais ne doit afficher
        que la track selectionnee.

        Surcharger a True dans les trackers SOT qui gerent l'affichage MOT
        en interne (ex : DummySot).
        """
        return False


####
# Helpers partagés (bbox finding depuis click + MOT tracks)
####

_DEFAULT_NEAR_PX = 300.0  # distance max par défaut pour le fallback "nearest"


def find_bbox_from_tracks(
    cx: float,
    cy: float,
    mot_tracks,
    near_thresh_px: float = _DEFAULT_NEAR_PX,
) -> list | None:
    """
    Retourne [x1, y1, x2, y2] de la meilleure track MOT proche de (cx, cy).

    Priorités :
      1. Track dont la bbox *contient* le clic (hit exact)
      2. Track dont le *centre* est le plus proche dans near_thresh_px
      3. None si aucune track disponible ou trop distante

    Parameters
    ########
    cx, cy         : position du clic (pixels)
    mot_tracks     : liste de Track-like (attribut .bbox = [x1,y1,x2,y2])
    near_thresh_px : seuil de distance centre-à-centre (pixels)
    """
    if not mot_tracks:
        return None

    # Priorité 1 : containment
    for trk in mot_tracks:
        x1, y1, x2, y2 = trk.bbox[:4]
        if x1 <= cx <= x2 and y1 <= cy <= y2:
            return [int(x1), int(y1), int(x2), int(y2)]

    # Priorité 2 : nearest centre
    best_trk = None
    best_dist = float("inf")
    for trk in mot_tracks:
        x1, y1, x2, y2 = trk.bbox[:4]
        d = math.hypot((x1 + x2) / 2 - cx, (y1 + y2) / 2 - cy)
        if d < best_dist:
            best_dist = d
            best_trk = trk

    if best_trk is not None and best_dist <= near_thresh_px:
        x1, y1, x2, y2 = best_trk.bbox[:4]
        return [int(x1), int(y1), int(x2), int(y2)]

    return None
