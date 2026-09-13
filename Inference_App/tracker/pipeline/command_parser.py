##########################################
# Project  : VisionNexus
# File     : command_parser.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : File-based command parser - reads cmd_send.txt and maps frame IDs to commands.
##########################################

import logging
import re
from pathlib import Path
from typing import NamedTuple, Union

import cv2
import numpy as np

from pipeline.ego_motion import reproject_click

log = logging.getLogger(__name__)

# Durée d'affichage (en frames) des points rouges pour les clics command
_CMD_CLICK_TTL = 15


####
# Types de commandes
####


class ClickCommand(NamedTuple):
    """Commande de déclenchement SOT."""

    frame_emit: int  # frame à laquelle la commande est émise
    frame_click: int  # frame réelle du clic dans la séquence
    x: int
    y: int


class MotControlCommand(NamedTuple):
    """
    Commande d'activation / désactivation du MOT.

    mot_state : 0 = désactiver le MOT (mode SOT Single)
                1 = réactiver le MOT
    """

    frame_emit: int
    frame_real: int
    mot_state: int  # 0 ou 1


AnyCommand = Union[ClickCommand, MotControlCommand]


####
# Parser
####


class CommandParser:
    """
    Charge et expose les commandes depuis un fichier cmd_send.txt.

    Parameters
    ########
    filepath : chemin vers le fichier cmd_send.txt
    delta    : fenêtre temporelle (frames) pendant laquelle une commande est active
    """

    def __init__(self, filepath: str, delta: int = 1):
        self._commands: list[AnyCommand] = []
        self._delta = delta
        self._click_ttl: list[tuple[int, int, int]] = []  # (x_raw, y_raw, expire_fid)
        self._load(filepath)

    def _load(self, filepath: str) -> None:
        path = Path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"Fichier de commandes introuvable : {filepath}")

        n_click = 0
        n_mot = 0

        with open(path, encoding="utf-8") as f:
            for lineno, raw in enumerate(f, start=1):
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                # Séparateurs : virgule, TAB ou espaces multiples
                parts = re.split(r"[,\t]+|\s+", line.strip())

                if len(parts) == 4:
                    #### Commande clic SOT
                    try:
                        frame_emit = int(parts[0])
                        frame_click = int(parts[1])
                        x = int(parts[2])
                        y = int(parts[3])
                    except ValueError as e:
                        raise ValueError(
                            f"Valeur non entière ligne {lineno} (click) : '{line}'"
                        ) from e
                    self._commands.append(ClickCommand(frame_emit, frame_click, x, y))
                    n_click += 1

                elif len(parts) == 3:
                    #### Commande contrôle MOT
                    try:
                        frame_emit = int(parts[0])
                        frame_real = int(parts[1])
                        mot_state = int(parts[2])
                    except ValueError as e:
                        raise ValueError(
                            f"Valeur non entière ligne {lineno} (mot_control) : '{line}'"
                        ) from e
                    if mot_state not in (0, 1):
                        raise ValueError(
                            f"mot_state invalide ligne {lineno} : attendu 0 ou 1, reçu {mot_state}"
                        )
                    self._commands.append(MotControlCommand(frame_emit, frame_real, mot_state))
                    n_mot += 1

                else:
                    raise ValueError(
                        f"Format invalide ligne {lineno} : attendu "
                        f"'frame_emit frame_click x y' (4 champs) ou "
                        f"'frame_emit frame_real mot_state' (3 champs) "
                        f"- reçu : '{line}' ({len(parts)} champs)"
                    )

        log.info(
            "CommandParser: %d commandes chargées (%d clics, %d contrôle MOT) depuis %s",
            len(self._commands),
            n_click,
            n_mot,
            filepath,
        )

    def get_commands(self, frame_id: int) -> list[AnyCommand]:
        """
        Retourne les commandes actives pour frame_id.
        Active si : frame_emit <= frame_id < frame_emit + delta
        """
        return [
            cmd
            for cmd in self._commands
            if cmd.frame_emit <= frame_id < cmd.frame_emit + self._delta
        ]

    def has_click_commands(self) -> bool:
        """True si au moins une commande clic est chargée."""
        return any(isinstance(c, ClickCommand) for c in self._commands)

    def has_mot_commands(self) -> bool:
        """True si au moins une commande de contrôle MOT est chargée."""
        return any(isinstance(c, MotControlCommand) for c in self._commands)

    def apply_commands(
        self,
        frame_id: int,
        frame,
        state_machine,
        ldv_buffer,
        cur_ldv,
        compensator,
        frame_buffer,
        H_dets,
        homography_method: str = "",
        min_inliers: int = 10,
    ) -> list[tuple[int, int]]:
        """
        Applique les commandes actives pour frame_id à state_machine.

        Gère la reprojection des clics (LDV, homographie H ou image-based) quand
        frame_click != frame_id.

        Returns : liste (x, y) bruts encore dans la fenêtre TTL, pour affichage.
        """
        for cmd in self.get_commands(frame_id):
            if isinstance(cmd, MotControlCommand):
                state_machine.set_mot_active(bool(cmd.mot_state))
                log.info(
                    "[F%05d] MOT control cmd: mot_state=%d (%s)",
                    frame_id,
                    cmd.mot_state,
                    "ON" if cmd.mot_state else "OFF",
                )
                continue

            cx, cy = float(cmd.x), float(cmd.y)

            if cmd.frame_click != frame_id:
                ldv_click = ldv_buffer.get(cmd.frame_click)
                if ldv_click is not None and cur_ldv is not None:
                    cx, cy = compensator.reproject_click_ldv(
                        ldv_click,
                        cur_ldv,
                        (cx, cy),
                        frame.shape,
                    )
                elif cmd.frame_click == frame_id - 1 and H_dets is not None:
                    pt = np.array([[[cx, cy]]], dtype=np.float64)
                    dst = cv2.perspectiveTransform(pt, H_dets)
                    cx, cy = float(dst[0][0][0]), float(dst[0][0][1])
                elif homography_method:
                    frame_ref = frame_buffer.get(cmd.frame_click)
                    if frame_ref is not None:
                        cx, cy = reproject_click(
                            frame_ref,
                            frame,
                            (cx, cy),
                            method=homography_method,
                            min_inliers=min_inliers,
                        )

            self._click_ttl.append((int(cmd.x), int(cmd.y), frame_id + _CMD_CLICK_TTL))
            state_machine.trigger_sot((int(cx), int(cy)), frame_id)

        self._click_ttl = [(x, y, exp) for x, y, exp in self._click_ttl if frame_id <= exp]
        return [(x, y) for x, y, _ in self._click_ttl]
