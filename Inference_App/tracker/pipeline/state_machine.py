##########################################
# Project  : VisionNexus
# File     : state_machine.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : MOT <-> SOT state machine - manages transitions, click handling, and dual-SOT.
##########################################

import logging
import math
import time
from dataclasses import dataclass
from enum import Enum

import numpy as np

from pipeline.detector.detector_roi import NoneDetectorROI

log = logging.getLogger(__name__)


#################################
# Modes et état structuré
#################################


class PipelineMode(str, Enum):
    """Mode opérationnel courant du pipeline."""
    IDLE = "IDLE"   # tracker_mot=None, en attente du 1er clic (dets brutes affichées si detector_mot configuré)
    MOT  = "MOT"    # tracking multi-objets actif (premier plan)
    SOT  = "SOT"    # tracking mono-objet SOT1 verrouillé


class MotRole(str, Enum):
    """Rôle du tracker MOT vis-à-vis du SOT."""
    OFF        = "off"         # tracker_mot=None (mode SOT-only) ou disabled
    FOREGROUND = "foreground"  # MOT seul actif (état MOT)
    BACKGROUND = "background"  # MOT tourne en fond pendant SOT (mot_background=True)
    KEEPALIVE  = "keepalive"   # MOT maintenu temporairement (fenêtre dual-SOT 2e clic)
    PAUSED     = "paused"      # MOT en veille (état SOT, mot_background=False)


@dataclass
class PipelineState:
    """
    Snapshot de l'état courant du pipeline.

    Mis à jour à chaque transition via _set_state() / _set_mot_role().
    Conçu pour être sérialisable (JSON / ZMQ) dans le futur.
    """
    mode:         PipelineMode = PipelineMode.IDLE
    mot_role:     MotRole      = MotRole.OFF
    sot2_active:  bool         = False
    last_event:   str          = ""    # texte libre du dernier événement
    frame_id:     int          = -1    # frame du dernier changement d'état
    sot_miss:     int          = 0     # misses SOT1 courants
    n_sot_inits:  int          = 0
    n_sot_losses: int          = 0


class TrackerStateMachine:
    """
    Orchestrates MOT <-> SOT transitions.

    Parameters
    ########
    mot_tracker          : BaseTracker | None
        Tracker MOT. None = mode SOT-only (pas de MOT, pas de detector_mot).
    sot_tracker          : BaseSot
        Tracker SOT unique.
    mot_background       : bool
        MOT actif en fond pendant le SOT ? (ignore si mot_tracker=None)
    sot_loss_threshold   : int
        Echecs consecutifs avant retour MOT/IDLE.
    sot_click_max_dist_px: float
        Distance max (px) clic-track pour declencher SOT / switcher de cible.
        0 = desactive (pas de filtre).
        Si > 0 et aucune track dans le rayon -> fallback detector_roi.
    roi_detector         : BaseDetectorROI | None
        Detecteur bbox au clic sans track MOT.
        Obligatoire si mot_tracker=None.
    """

    def __init__(
        self,
        mot_tracker,
        sot_tracker,
        mot_background: bool = False,
        sot_loss_threshold: int = 10,
        sot_click_max_dist_px: float = 0.0,
        roi_detector=None,
        sot_tracker2=None,
        mot_keepalive_after_sot_s: float = 2.0,
        has_mot_detector: bool = False,
    ):
        self._mot = mot_tracker
        self._sot = sot_tracker
        self._mot_bg = bool(mot_background)
        self._loss_thr = int(sot_loss_threshold)
        self._max_dist = float(sot_click_max_dist_px)
        self._roi_det = roi_detector

        self._mot_keepalive_s: float = float(mot_keepalive_after_sot_s)
        self._mot_keepalive_until: float = 0.0

        self._mot_is_none: bool = mot_tracker is None
        # IDLE uniquement si tracker=None ET detector=None.
        # Si tracker=None mais detector configure : etat MOT (dets brutes -> _DetTrack).
        self._has_det: bool = bool(has_mot_detector)

        self._state: PipelineMode = self._back_state
        self._sot_miss: int = 0
        self._sot_last_bbox = None
        self._sot_history: list = []
        self._pending_click = None

        # --- SOT cible 2 ---
        self._sot2 = sot_tracker2
        self._sot2_active: bool = False
        self._sot2_miss: int = 0
        self._sot2_last_bbox = None
        self._sot2_history: list = []
        self._pending_click2 = None

        self._mot_active: bool = True

        # Compteurs SOT
        self._n_sot_losses: int = 0
        self._n_sot_inits:  int = 0
        self._n_sot2_losses: int = 0
        self._n_sot2_inits:  int = 0

        _initial_mot_role = MotRole.OFF if self._mot_is_none else MotRole.FOREGROUND
        self._ps = PipelineState(mode=self._back_state, mot_role=_initial_mot_role)

        if self._mot_is_none:
            _init_state_label = "MOT(det-only)" if self._has_det else "IDLE"
            log.info(
                "StateMachine init | mode=SOT-only | etat=%s | mot_background=IGNORE | sot2=%s",
                _init_state_label,
                "ON" if self._sot2 else "OFF",
            )
        else:
            log.info(
                "StateMachine init | mode=normal | état=MOT | bg=%s | dist_max=%.0fpx | sot2=%s",
                self._mot_bg,
                self._max_dist,
                "ON" if self._sot2 else "OFF",
            )

    ######################################
    # Transitions d'état internes (source de vérité)
    ######################################

    def _set_state(self, new_state: PipelineMode, frame_id: int = -1, event: str = "") -> None:
        """
        Seul point d'écriture de self._state.
        Log INFO uniquement sur changement d'état (pas de spam).
        Met à jour PipelineState en parallèle.
        """
        if new_state == self._state:
            return
        log.info(
            "[F%05d] %s -> %s | %s",
            frame_id, self._state.value, new_state.value, event,
        )
        self._state = new_state
        self._ps.mode = new_state
        self._ps.frame_id = frame_id
        self._ps.last_event = event

    def _set_mot_role(self, role: MotRole, frame_id: int = -1) -> None:
        """
        Met à jour le rôle MOT.
        Log INFO uniquement sur changement (pas de spam par frame).
        """
        if role == self._ps.mot_role:
            return
        log.info("[F%05d] MOT role : %s", frame_id, role.value)
        self._ps.mot_role = role

    ######################################
    # Controle MOT on/off
    ######################################

    def set_mot_background(self, value: bool) -> None:
        """
        Bascule le flag mot_background à chaud (touche M en mode interactif).
        """
        if self._mot_is_none:
            log.debug("set_mot_background(%s) ignore : mode SOT-only", value)
            return
        self._mot_bg = bool(value)
        log.info("StateMachine: mot_background -> %s", self._mot_bg)

    def set_mot_active(self, active: bool) -> None:
        """
        Active ou desactive le tracker MOT.
        """
        if self._mot_is_none:
            log.debug("set_mot_active(%s) ignore : mode SOT-only (tracker_mot=None)", active)
            return
        if self._mot_active == active:
            return
        self._mot_active = active
        log.info("MOT toggled : %s", "ACTIVE" if active else "DESACTIVE")

        if not active:
            if self._state == PipelineMode.SOT:
                self._set_state(PipelineMode.MOT, event="MOT desactive -> reset SOT")
                self._sot_miss = 0
                self._sot.reset()
            self._pending_click = None

    ######################################
    # API publique
    ######################################

    def trigger_sot(self, click_pos: tuple, frame_id: int) -> None:
        """Enregistre un clic gauche (SOT cible 1) - traite au prochain update()."""
        self._pending_click = (frame_id, click_pos[0], click_pos[1])
        log.info("[F%05d] CLIC reçu (%.0f,%.0f) -> SOT1 en attente", frame_id, click_pos[0], click_pos[1])

    def trigger_sot2(self, click_pos: tuple, frame_id: int) -> None:
        """Enregistre un clic droit (SOT cible 2) - traite au prochain update()."""
        if self._sot2 is None:
            log.debug("trigger_sot2: sot2 non configuré (n_targets < 2) - ignoré")
            return
        self._pending_click2 = (frame_id, click_pos[0], click_pos[1])
        log.info("[F%05d] CLIC droit (%.0f,%.0f) -> SOT2 en attente", frame_id, click_pos[0], click_pos[1])

    def get_state(self) -> str:
        return self._state

    def get_pipeline_state(self) -> PipelineState:
        """Retourne le snapshot d'état courant (exportable JSON/ZMQ)."""
        self._ps.sot2_active  = self._sot2_active
        self._ps.sot_miss     = self._sot_miss
        self._ps.n_sot_inits  = self._n_sot_inits
        self._ps.n_sot_losses = self._n_sot_losses
        return self._ps

    def get_n_losses(self) -> int:
        return self._n_sot_losses

    def get_n_inits(self) -> int:
        return self._n_sot_inits

    def get_n_sot2_losses(self) -> int:
        return self._n_sot2_losses

    def get_n_sot2_inits(self) -> int:
        return self._n_sot2_inits

    def is_mot_active(self) -> bool:
        return self._mot_active and not self._mot_is_none

    @property
    def _back_state(self) -> "PipelineMode":
        """Etat de repos : IDLE si tracker=None et pas de detecteur, MOT sinon."""
        if self._mot_is_none and not self._has_det:
            return PipelineMode.IDLE
        return PipelineMode.MOT

    def reset_to_mot(self) -> None:
        self._set_state(
            self._back_state,
            event="reset manuel",
        )
        self._sot_miss = 0
        self._sot_last_bbox = None
        self._pending_click = None
        if not self._mot_is_none:
            self._mot_active = True
        self._sot.reset()

    def kill_all_sot(self) -> None:
        """
        Tue immédiatement TOUTES les cibles SOT (clic molette / middle-click).
        """
        killed = 0

        if self._state == PipelineMode.SOT:
            self._n_sot_losses += 1
            killed += 1
        self._sot.reset()
        self._set_state(
            self._back_state,
            event=f"kill_all_sot ({killed} cible(s))",
        )
        self._sot_miss = 0
        self._sot_last_bbox = None
        self._sot_history = []
        self._pending_click = None

        if self._sot2 is not None:
            if self._sot2_active:
                self._n_sot2_losses += 1
                killed += 1
                self._sot2.reset()
            self._sot2_active = False
            self._sot2_miss = 0
            self._sot2_last_bbox = None
            self._sot2_history = []
            self._pending_click2 = None

        self._mot_keepalive_until = 0.0

        log.info(
            "[KILL] kill_all_sot : %d cible(s) SOT relâchée(s) -> état=%s",
            killed,
            self._state.value,
        )

    def _mot_keepalive_active(self) -> bool:
        if self._mot_is_none or self._mot_bg:
            return False
        if self._sot2 is None or self._sot2_active:
            return False
        if self._mot_keepalive_s <= 0.0:
            return False
        return time.time() < self._mot_keepalive_until

    def _should_run_mot(self) -> bool:
        if self._mot_is_none or not self._mot_active:
            return False
        if self._state == PipelineMode.MOT:
            return True
        if self._state == PipelineMode.SOT:
            return self._mot_bg or self._mot_keepalive_active()
        return False  # IDLE

    def should_run_mot_detection(self) -> bool:
        """
        API publique pour session.py : faut-il executer le detecteur MOT cette frame ?

        Cas tracker=None + detecteur configure : True sauf en SOT avec mot_background=False
                                                 (hors fenetre keepalive).
        Cas tracker=None + detecteur=none     : False (rien a detecter).
        Cas tracker actif                     : delegue a _should_run_mot().
        """
        if self._mot_is_none:
            if not self._has_det:
                return False
            # En SOT avec mot_background=False : couper le detecteur (reduction charge)
            # Exception : fenetre keepalive active -> dets necessaires pour clic SOT2
            if self._state == PipelineMode.SOT and not self._mot_bg:
                return time.time() < self._mot_keepalive_until
            return True
        return self._should_run_mot()

    def update(
        self,
        frame: np.ndarray,
        frame_id: int,
        detections: list[list[float]],
        H: np.ndarray | None = None,
    ) -> list:
        """
        Update tracker pour une frame.

        Returns
        ######
        list de Track-like objects.
          - Mode IDLE   : []  (en attente de clic)
          - Mode MOT    : tracks MOT
          - Mode SOT    : [_SotTrack] + mot_tracks si mot_background=true
        """

        ############################################
        # MODE SANS TRACKER MOT (tracker_mot = None)
        # Les détections brutes sont converties en _DetTrack (éphémères, sans ID persistant).
        # IDLE  : retourne les _DetTrack pour affichage + métriques.
        # SOT   : _DetTrack passées comme mot_tracks pour init/update SOT.
        ############################################
        if self._mot_is_none:
            det_tracks = [_DetTrack(i, d) for i, d in enumerate(detections)]
            _state_before = self._state

            log.debug(
                "[F%05d] %-5s | no-MOT  dets=%d%s",
                frame_id,
                self._state.value,
                len(det_tracks),
                "  | CLIC!" if self._pending_click else "",
            )

            if self._pending_click is not None:
                _, cx, cy = self._pending_click
                self._pending_click = None
                self._handle_click_idle(frame, (cx, cy), frame_id, mot_tracks=det_tracks)

            if self._pending_click2 is not None and self._sot2 is not None:
                _, cx2, cy2 = self._pending_click2
                self._pending_click2 = None
                self._init_sot2(frame, (cx2, cy2), det_tracks, frame_id)

            # Keepalive det-only : même logique que MOT normal pour le dual-SOT.
            # Transition IDLE→SOT1 avec sot2 configuré → on arme le timer pour que
            # les détections brutes restent visibles N sec (le temps de cliquer SOT2).
            if (
                _state_before != PipelineMode.SOT
                and self._state == PipelineMode.SOT
                and self._sot2 is not None
                and not self._sot2_active
                and self._mot_keepalive_s > 0.0
            ):
                self._mot_keepalive_until = time.time() + self._mot_keepalive_s
                log.info(
                    "[F%05d] Dual SOT (det-only) : detections maintenues %.1fs pour le 2e clic",
                    frame_id,
                    self._mot_keepalive_s,
                )

            sot1_result = []
            if self._state == PipelineMode.SOT:
                sot1_result = self._run_sot_update(frame, frame_id, mot_tracks=det_tracks, H=H)

            sot2_result = self._run_sot2_update(frame, frame_id, det_tracks, H=H)

            if self._state == PipelineMode.SOT or sot2_result:
                # Pendant la fenêtre keepalive : inclure les dets brutes pour SOT2
                _ka = (
                    self._sot2 is not None
                    and not self._sot2_active
                    and self._mot_keepalive_s > 0.0
                    and time.time() < self._mot_keepalive_until
                )
                if _ka:
                    return sot1_result + sot2_result + det_tracks
                return sot1_result + sot2_result

            return det_tracks  # IDLE : dets brutes visibles

        ############################################
        # MODE NORMAL (tracker_mot set)
        ############################################

        _state_before = self._state

        # 1. Calcul des tracks MOT
        should_run_mot = self._should_run_mot()
        mot_tracks = self._mot.update(frame, detections, H=H) if should_run_mot else []

        # Mise à jour du rôle MOT (log INFO uniquement sur changement)
        if not self._mot_active:
            self._set_mot_role(MotRole.OFF, frame_id)
        elif self._state == PipelineMode.MOT:
            self._set_mot_role(MotRole.FOREGROUND, frame_id)
        elif self._state == PipelineMode.SOT:
            if self._mot_bg:
                self._set_mot_role(MotRole.BACKGROUND, frame_id)
            elif self._mot_keepalive_active():
                self._set_mot_role(MotRole.KEEPALIVE, frame_id)
            else:
                self._set_mot_role(MotRole.PAUSED, frame_id)

        log.debug(
            "[F%05d] %-3s | MOT %-3s | trks=%2d | bg=%-3s%s",
            frame_id,
            self._state.value,
            "ON" if self._mot_active else "OFF",
            len(mot_tracks),
            "on" if self._mot_bg else "off",
            "  | CLIC!" if self._pending_click else "",
        )

        # 2. Traitement du clic gauche (SOT1)
        if self._pending_click is not None:
            _, cx, cy = self._pending_click
            self._pending_click = None

            if self._state == PipelineMode.MOT:
                self._handle_click_in_mot(frame, (cx, cy), mot_tracks, frame_id)
            elif self._state == PipelineMode.SOT:
                self._handle_click_in_sot(frame, (cx, cy), mot_tracks, frame_id)

        # 2b. Traitement du clic droit (SOT2)
        if self._pending_click2 is not None and self._sot2 is not None:
            _, cx2, cy2 = self._pending_click2
            self._pending_click2 = None
            self._init_sot2(frame, (cx2, cy2), mot_tracks, frame_id)

        # 2c. Armement keepalive MOT sur transition MOT->SOT1 (dual SOT)
        if (
            _state_before == PipelineMode.MOT
            and self._state == PipelineMode.SOT
            and self._sot2 is not None
            and not self._mot_bg
            and not self._sot2_active
            and self._mot_keepalive_s > 0.0
        ):
            self._mot_keepalive_until = time.time() + self._mot_keepalive_s
            log.info(
                "[F%05d] Dual SOT : MOT maintenu actif %.1fs pour le 2e clic (SOT2)",
                frame_id,
                self._mot_keepalive_s,
            )

        # 3. Mise a jour SOT1 + assemblage résultat
        if self._state == PipelineMode.SOT:
            sot1_result = self._run_sot_update(frame, frame_id, mot_tracks, H=H)
            if self._mot_bg and self._state == PipelineMode.SOT:
                main_result = sot1_result + list(mot_tracks)
            elif mot_tracks and self._mot_keepalive_active():
                main_result = sot1_result + list(mot_tracks)
            else:
                main_result = sot1_result
        else:
            main_result = list(mot_tracks)

        # 3b. Mise a jour SOT2 (parallèle)
        sot2_result = self._run_sot2_update(frame, frame_id, mot_tracks, H=H)

        return main_result + sot2_result

    ######################################
    # Mise a jour SOT (factorisee)
    ######################################

    def _run_sot_update(
        self,
        frame: np.ndarray,
        frame_id: int,
        mot_tracks: list,
        H: np.ndarray | None = None,
    ) -> list:
        """Execute un update SOT et gere les transitions d'etat."""
        ok, bbox, mask = self._sot.update(frame, mot_tracks=mot_tracks, H=H)

        if ok and bbox is not None:
            log.debug(
                "[F%05d] SOT  OK  | bbox=[%d %d %d %d] | miss=0/%d",
                frame_id,
                *[int(v) for v in bbox],
                self._loss_thr,
            )
            self._sot_miss = 0
            self._sot_last_bbox = bbox
            cx_t = (bbox[0] + bbox[2]) / 2.0
            cy_t = (bbox[1] + bbox[3]) / 2.0
            self._sot_history.append([cx_t, cy_t])
            return [_SotTrack(bbox=bbox, mask=mask, history=self._sot_history, miss=0)]

        # Echec SOT
        self._sot_miss += 1
        log.info(
            "[F%05d] SOT miss=%d/%d",
            frame_id,
            self._sot_miss,
            self._loss_thr,
        )

        if self._sot_miss >= self._loss_thr:
            self._n_sot_losses += 1
            self._set_state(
                self._back_state,
                frame_id=frame_id,
                event=f"DÉCROCHAGE SOT1 ({self._sot_miss} miss consécutifs)",
            )
            self._sot_miss = 0
            self._sot.reset()
            return []

        if self._sot_last_bbox is not None:
            return [
                _SotTrack(
                    bbox=self._sot_last_bbox,
                    mask=None,
                    history=self._sot_history,
                    miss=self._sot_miss,
                )
            ]
        return []

    ######################################
    # SOT cible 2 (clic droit) - parallèle
    ######################################

    def _init_sot2(
        self,
        frame: np.ndarray,
        click_pos: tuple,
        mot_tracks: list,
        frame_id: int,
    ) -> None:
        """Initialise ou réinitialise le tracker SOT cible 2 (clic droit)."""
        cx, cy = click_pos
        if self._sot2_active:
            self._sot2.reset()
            log.info("[F%05d] SOT2 reset + réinit (%.0f,%.0f)", frame_id, cx, cy)
        else:
            log.info("[F%05d] SOT2 init (%.0f,%.0f)", frame_id, cx, cy)

        try:
            self._sot2.init(frame, click_pos, mot_tracks)
            self._sot2_active = True
            self._sot2_miss = 0
            self._sot2_last_bbox = None
            self._sot2_history = []
            self._n_sot2_inits += 1
            self._ps.sot2_active = True
            log.info("[F%05d] SOT2 ACCROCHAGE OK", frame_id)
        except Exception as exc:
            log.error("[F%05d] SOT2 init erreur : %s", frame_id, exc)
            self._sot2_active = False

    def _run_sot2_update(
        self,
        frame: np.ndarray,
        frame_id: int,
        mot_tracks: list,
        H=None,
    ) -> list:
        """
        Met à jour le tracker SOT2 (cible 2, clic droit).
        Retourne une liste avec 0 ou 1 _SotTrack(sot_slot=1).
        """
        if not self._sot2_active or self._sot2 is None:
            return []

        try:
            ok, bbox, mask = self._sot2.update(frame, mot_tracks=mot_tracks, H=H)
        except Exception as exc:
            log.error("[F%05d] SOT2 update erreur : %s", frame_id, exc)
            self._sot2_active = False
            return []

        if ok and bbox is not None:
            self._sot2_miss = 0
            self._sot2_last_bbox = bbox
            cx_t = (bbox[0] + bbox[2]) / 2.0
            cy_t = (bbox[1] + bbox[3]) / 2.0
            self._sot2_history.append([cx_t, cy_t])
            return [_SotTrack(bbox=bbox, mask=mask, history=self._sot2_history, miss=0, sot_slot=1)]

        self._sot2_miss += 1
        log.info("[F%05d] SOT2 miss=%d/%d", frame_id, self._sot2_miss, self._loss_thr)

        if self._sot2_miss >= self._loss_thr:
            log.info(
                "[F%05d] DÉCROCHAGE SOT2 (%d miss) -> désactivé",
                frame_id, self._sot2_miss,
            )
            self._sot2_active = False
            self._sot2_miss = 0
            self._n_sot2_losses += 1
            self._ps.sot2_active = False
            self._sot2.reset()
            return []

        if self._sot2_last_bbox is not None:
            return [
                _SotTrack(
                    bbox=self._sot2_last_bbox,
                    mask=None,
                    history=self._sot2_history,
                    miss=self._sot2_miss,
                    sot_slot=1,
                )
            ]
        return []

    ######################################
    # Gestionnaires de clics
    ######################################

    def _handle_click_idle(
        self,
        frame: np.ndarray,
        click_pos: tuple,
        frame_id: int,
        mot_tracks: list = None,
    ) -> None:
        """Clic en mode IDLE (tracker_mot=None).

        mot_tracks : _DetTrack issus des détections brutes courantes.
        Passés à _activate_sot pour trouver la bbox la plus proche du clic.
        Fallback sur detector_roi si aucune detection ne contient le clic.
        """
        cx, cy = click_pos
        tracks = mot_tracks or []

        _was_sot = self._state == PipelineMode.SOT
        if _was_sot:
            log.info(
                "[F%05d] Nouveau clic en SOT (no-MOT) (%.0f,%.0f) -> reset",
                frame_id, cx, cy,
            )
            self._sot.reset()
            self._set_state(PipelineMode.IDLE, frame_id=frame_id, event="nouveau clic en SOT -> reset")
            self._sot_miss = 0
            self._sot_last_bbox = None
            self._sot_history = []

        log.info("[F%05d] Clic IDLE (%.0f,%.0f) -> %d dets disponibles", frame_id, cx, cy, len(tracks))
        success = self._activate_sot(frame, click_pos, tracks, frame_id, is_reinit=_was_sot)
        if not success:
            self._set_state(PipelineMode.IDLE, frame_id=frame_id, event="IDLE clic KO")
            self._sot_miss = 0
            self._sot_last_bbox = None
            self._sot_history = []

    def _handle_click_in_mot(
        self,
        frame: np.ndarray,
        click_pos: tuple,
        mot_tracks: list,
        frame_id: int,
    ) -> None:
        """
        Clic reçu en état MOT.

        Priorité :
          1. MOT désactivé -> detector_roi direct.
          2. sot_click_max_dist_px=0 -> pas de filtre.
          3. Track dans le rayon -> SOT.init avec bbox de la track.
          4. Track trop loin / absente -> fallback detector_roi.
               detector_roi vide -> [KO] Warning, clic ignoré.
        """
        cx, cy = click_pos

        if not self._mot_active:
            log.info(
                "[F%05d] Clic (MOT désactivé) -> detector_roi (%.0f,%.0f)",
                frame_id, cx, cy,
            )
            self._activate_sot(frame, click_pos, [], frame_id, is_reinit=False)
            return

        if self._max_dist <= 0:
            log.info(
                "[F%05d] Clic sans filtre distance -> SOT (%.0f,%.0f)  tracks=%d",
                frame_id, cx, cy, len(mot_tracks),
            )
            self._activate_sot(frame, click_pos, mot_tracks, frame_id, is_reinit=False)
            return

        if mot_tracks:
            dists = self._track_distances(click_pos, mot_tracks)
            min_dist, nearest = dists[0]
            self._log_track_distances(frame_id, dists)

            if min_dist <= self._max_dist:
                log.info(
                    "[F%05d] Clic -> T%d dist=%.1fpx <= %.0fpx -> SOT (%.0f,%.0f)",
                    frame_id, nearest.track_id, min_dist, self._max_dist, cx, cy,
                )
                self._activate_sot(frame, click_pos, mot_tracks, frame_id, is_reinit=False)
                return

            # Track trop loin -> fallback detector_roi (géré, pas une erreur)
            log.info(
                "[F%05d] Clic (%.0f,%.0f) : T%d à %.1fpx > %.0fpx -> fallback detector_roi",
                frame_id, cx, cy, nearest.track_id, min_dist, self._max_dist,
            )
        else:
            log.info(
                "[F%05d] Clic (%.0f,%.0f) : 0 tracks MOT -> fallback detector_roi",
                frame_id, cx, cy,
            )

        success = self._activate_sot(frame, click_pos, [], frame_id, is_reinit=False)
        if not success:
            log.warning(
                "[F%05d] [KO] Clic ignoré : detector_roi vide et aucune track dans %.0fpx."
                " Cliquer directement sur le blob IR ou ajuster sot_click_max_dist_px.",
                frame_id, self._max_dist,
            )

    def _handle_click_in_sot(
        self,
        frame: np.ndarray,
        click_pos: tuple,
        mot_tracks: list,
        frame_id: int,
    ) -> None:
        """
        Clic reçu en état SOT.

        mot_background=True  (Cas 2) : switch de cible MOT la plus proche.
        mot_background=False (Cas 3) : abandon SOT + nouveau via detector_roi.
        """
        cx, cy = click_pos

        if self._mot_bg:
            # --- Cas 2 : switch de cible ---
            if mot_tracks and (self._max_dist <= 0 or True):
                dists = self._track_distances(click_pos, mot_tracks)
                min_dist, nearest = dists[0]
                self._log_track_distances(frame_id, dists)

                if self._max_dist <= 0 or min_dist <= self._max_dist:
                    log.info(
                        "[F%05d] Switch cible : T%d dist=%.1fpx -> SOT (%.0f,%.0f)",
                        frame_id, nearest.track_id, min_dist, cx, cy,
                    )
                    self._sot.reset()
                    self._activate_sot(frame, click_pos, mot_tracks, frame_id, is_reinit=True)
                    return

                # Track trop loin -> fallback detector_roi
                log.info(
                    "[F%05d] Switch cible : T%d à %.1fpx > %.0fpx -> fallback detector_roi (%.0f,%.0f)",
                    frame_id, nearest.track_id, min_dist, self._max_dist, cx, cy,
                )
                self._sot.reset()
                success = self._activate_sot(frame, click_pos, [], frame_id, is_reinit=True)
                if not success:
                    log.warning(
                        "[F%05d] [KO] Switch cible ignoré : detector_roi vide."
                        " Cliquer plus près d'une track MOT (seuil=%.0fpx).",
                        frame_id, self._max_dist,
                    )
                    if self._sot_last_bbox is not None:
                        bx = self._sot_last_bbox
                        lx, ly = (bx[0] + bx[2]) // 2, (bx[1] + bx[3]) // 2
                        self._activate_sot(frame, (lx, ly), mot_tracks, frame_id, is_reinit=False)
                return

            # Aucune track MOT en fond -> fallback detector_roi
            log.info(
                "[F%05d] Switch cible : 0 tracks MOT en fond (%.0f,%.0f) -> fallback detector_roi",
                frame_id, cx, cy,
            )
            self._sot.reset()
            success = self._activate_sot(frame, click_pos, [], frame_id, is_reinit=True)
            if not success:
                log.warning(
                    "[F%05d] [KO] Switch cible ignoré : detector_roi vide et 0 tracks MOT."
                    " Attendre les premières détections MOT avant de cliquer.",
                    frame_id,
                )
                if self._sot_last_bbox is not None:
                    bx = self._sot_last_bbox
                    lx, ly = (bx[0] + bx[2]) // 2, (bx[1] + bx[3]) // 2
                    self._activate_sot(frame, (lx, ly), mot_tracks, frame_id, is_reinit=False)

        else:
            # --- Cas 3 : nouveau SOT solo (MOT en veille) ---
            log.info(
                "[F%05d] Nouveau SOT (Cas3 bg=off) : (%.0f,%.0f) -> reset + detector_roi",
                frame_id, cx, cy,
            )
            self._sot.reset()
            success = self._activate_sot(frame, click_pos, [], frame_id, is_reinit=True)
            if not success:
                log.warning(
                    "[F%05d] [KO] Impossible d'accrocher la nouvelle cible (%.0f,%.0f)."
                    " detector_roi n'a détecté aucun blob. Cliquer directement sur le blob IR.",
                    frame_id, cx, cy,
                )
                self._set_state(PipelineMode.MOT, frame_id=frame_id, event="KO accrochage Cas3 -> retour MOT")
                self._sot_miss = 0
                self._sot_last_bbox = None
                self._sot_history = []

    ######################################
    # Activation SOT (interne)
    ######################################

    def _activate_sot(
        self,
        frame: np.ndarray,
        click_pos: tuple,
        mot_tracks: list,
        frame_id: int,
        is_reinit: bool = False,
    ) -> bool:
        """
        Initialise le tracker SOT.

        Priorite pour obtenir une bbox d'init :
          1. mot_tracks non vide -> tracker_sot choisit la meilleure.
          2. mot_tracks vide + detector_roi reel -> blob IR dans ROI au clic.
          3. mot_tracks vide + detector_roi=None -> fallback CSRT 40x40 interne.

        Returns True si SOT initialisé, False si aucune source de bbox.
        """
        cx, cy = click_pos
        effective_tracks = list(mot_tracks)

        if not effective_tracks:
            if self._roi_det is not None:
                is_none_det = isinstance(self._roi_det, NoneDetectorROI)

                if not is_none_det:
                    roi_bbox = self._roi_det.detect_at_click(frame, (cx, cy))
                    if roi_bbox is not None:
                        synthetic = _SyntheticTrack(bbox=roi_bbox)
                        effective_tracks = [synthetic]
                        log.info(
                            "[F%05d] detector_roi -> blob [%d,%d,%d,%d] -> track synthétique",
                            frame_id,
                            *[int(v) for v in roi_bbox],
                        )
                    else:
                        log.warning(
                            "[F%05d] [KO] Impossible d'accrocher : detector_roi aucun blob"
                            " au clic (%.0f,%.0f). Cliquer directement sur le blob IR.",
                            frame_id, cx, cy,
                        )
                        return False

        # Source de la bbox d'init (pour le log)
        if mot_tracks:
            _src = f"dets-yolo/mot ({len(mot_tracks)} tracks)"
        elif effective_tracks:
            _src = "roi-detector (blob synthétique)"
        else:
            _src = "fallback interne tracker (aucune source externe)"

        log.info(
            "[F%05d] ACCROCHAGE SOT1 | click=(%.0f,%.0f) | source=%s | bg=%s | tracker=%s",
            frame_id,
            cx, cy,
            _src,
            "on" if self._mot_bg else "off",
            type(self._sot).__name__,
        )

        self._sot_history = []
        self._sot_last_bbox = None
        self._sot.init(frame, (cx, cy), mot_tracks=effective_tracks)
        self._set_state(PipelineMode.SOT, frame_id=frame_id, event=f"ACCROCHAGE (%.0f,%.0f)" % (cx, cy))
        self._sot_miss = 0
        if is_reinit:
            self._n_sot_inits += 1
        return True

    ######################################
    # Helpers
    ######################################

    @staticmethod
    def _track_center(track) -> tuple[float, float]:
        bb = track.bbox
        return (bb[0] + bb[2]) / 2.0, (bb[1] + bb[3]) / 2.0

    def _track_distances(self, click_pos: tuple, tracks: list) -> list[tuple[float, object]]:
        cx, cy = click_pos
        dists = [
            (
                math.hypot(
                    (t.bbox[0] + t.bbox[2]) / 2 - cx,
                    (t.bbox[1] + t.bbox[3]) / 2 - cy,
                ),
                t,
            )
            for t in tracks
        ]
        dists.sort(key=lambda x: x[0])
        return dists

    def _log_track_distances(self, frame_id: int, dists: list[tuple[float, object]]) -> None:
        if not log.isEnabledFor(logging.DEBUG):
            return
        seuil_str = f"{self._max_dist:.0f}" if self._max_dist > 0 else "inf"
        for d, t in dists:
            in_range = (self._max_dist <= 0) or (d <= self._max_dist)
            flag = "OK " if in_range else "FAR"
            log.debug(
                "[F%05d]   [%s] T%-3d  dist=%5.1f px  bbox=[%d,%d,%d,%d]  seuil=%s px",
                frame_id,
                flag,
                t.track_id,
                d,
                int(t.bbox[0]),
                int(t.bbox[1]),
                int(t.bbox[2]),
                int(t.bbox[3]),
                seuil_str,
            )


#################################
# Tracks synthetiques internes
#################################


class _SyntheticTrack:
    """
    Track synthetique cree par detector_roi pour initialiser le SOT
    quand aucune track MOT n'est disponible.
    """

    track_id = -1
    is_confirmed = True
    score = 1.0

    def __init__(self, bbox: list):
        self.bbox = bbox
        self.time_since_update = 0
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        self.history = [[cx, cy]]

    def predicted_bbox(self) -> list:
        return self.bbox


class _DetTrack:
    """
    Adaptateur léger : convertit une détection brute [x1,y1,x2,y2,score,cls]
    en objet track duck-typing compatible (Visualizer, métriques, SOT init).

    Utilisé quand tracker_mot=None + detector_mot configuré.
    track_id éphémère (index dans la liste du frame) — pas de persistance inter-frames.
    """

    is_confirmed = True
    time_since_update = 0

    def __init__(self, idx: int, det: list):
        self.track_id  = idx
        self.bbox      = [det[0], det[1], det[2], det[3]]
        self.score     = float(det[4]) if len(det) > 4 else 1.0
        self.class_id  = int(det[5])   if len(det) > 5 else 0
        cx = (det[0] + det[2]) / 2.0
        cy = (det[1] + det[3]) / 2.0
        self.history   = [[cx, cy]]

    def predicted_bbox(self) -> list:
        return self.bbox


class _SotTrack:
    """
    Track synthetique representant une cible SOT.

    is_sot_target = True : sentinel utilise par le Visualizer.
    sot_slot : 0 = SOT cible 1 (magenta), 1 = SOT cible 2 (orange).
    """

    is_confirmed = True
    is_sot_target = True

    def __init__(
        self,
        bbox: list,
        mask=None,
        history: list = None,
        miss: int = 0,
        sot_slot: int = 0,
    ):
        self.bbox = bbox
        self.score = 1.0
        self.mask = mask
        self.time_since_update = miss
        self.sot_slot = sot_slot
        self.track_id = 0 if sot_slot == 0 else -2
        self.is_confirmed = True
        cx = (bbox[0] + bbox[2]) / 2.0
        cy = (bbox[1] + bbox[3]) / 2.0
        self.history = list(history) if history else [[cx, cy]]

    def predicted_bbox(self) -> list:
        return self.bbox
