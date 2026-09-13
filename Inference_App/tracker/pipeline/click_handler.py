##########################################
# Project  : VisionNexus
# File     : click_handler.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Thread-safe OpenCV click queue for interactive SOT target selection.
##########################################

import logging
import queue
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

# Durée de rétention des clics récents pour l'affichage (secondes)
CLICK_DISPLAY_TTL = 3.0


class ClickHandler:
    """
    Gère les événements souris en mode interactif.

    Clic gauche  -> SOT cible 1 (comportement existant)
    Clic droit   -> SOT cible 2 (si n_targets >= 2 dans le YAML)
    Clic molette -> KILL : relâche immédiatement TOUTES les cibles SOT
                   (simule une perte de track sur toutes les cibles, retour MOT/IDLE)

    La touche 'r' (capturée par le Visualizer dans sa boucle waitKey)
    bascule le mode enregistrement via toggle_record().

    Attributes
    ########
    cursor_pos    : (x, y) dernière position connue du curseur
    record_mode   : bool - si True, les clics SOT sont logués sur disque
    last_clicks   : liste de (x, y, timestamp) - clics gauche récents
    last_r_clicks : liste de (x, y, timestamp) - clics droit récents
    """

    def __init__(
        self,
        seq_name: str = "",
        record_dir: Path | None = None,
    ):
        self._queue: queue.Queue = queue.Queue()  # clics gauche (SOT1)
        self._r_queue: queue.Queue = queue.Queue()  # clics droit  (SOT2)
        self._m_queue: queue.Queue = queue.Queue()  # clics molette (KILL SOT)
        self._lock: threading.Lock = threading.Lock()

        self.cursor_pos: tuple[int, int] = (0, 0)
        self.record_mode: bool = False
        self.last_clicks: list[tuple[int, int, float]] = []
        self.last_r_clicks: list[tuple[int, int, float]] = []

        self._seq_name = seq_name
        self._record_dir = Path(record_dir) if record_dir else None
        self._record_file = None

    ####
    # Callback cv2
    ####

    def callback(self, event, x: int, y: int, flags, param) -> None:
        """
        Callback cv2.setMouseCallback - thread-safe.

        Événements gérés :
          EVENT_MOUSEMOVE    -> mise à jour cursor_pos
          EVENT_LBUTTONDOWN  -> clic SOT enregistré dans la queue + last_clicks
        """
        try:
            import cv2  # lazy : ClickHandler chargé même en headless, cv2 non requis là

            if event == cv2.EVENT_MOUSEMOVE:
                self.cursor_pos = (x, y)

            elif event == cv2.EVENT_LBUTTONDOWN:
                # Clic gauche -> SOT cible 1
                self._queue.put((x, y))
                now = time.time()
                with self._lock:
                    self.last_clicks.append((x, y, now))
                    self.last_clicks = [
                        c for c in self.last_clicks if now - c[2] < CLICK_DISPLAY_TTL
                    ]
                log.info("Clic SOT1 (gauche) : pos=(%d,%d)", x, y)

            elif event == cv2.EVENT_RBUTTONDOWN:
                # Clic droit -> SOT cible 2
                self._r_queue.put((x, y))
                now = time.time()
                with self._lock:
                    self.last_r_clicks.append((x, y, now))
                    self.last_r_clicks = [
                        c for c in self.last_r_clicks if now - c[2] < CLICK_DISPLAY_TTL
                    ]
                log.info("Clic SOT2 (droit) : pos=(%d,%d)", x, y)

            elif event == cv2.EVENT_MBUTTONDOWN:
                # Clic molette -> KILL toutes les cibles SOT
                self._m_queue.put((x, y))
                log.info("Clic KILL SOT (molette) : pos=(%d,%d)", x, y)

        except Exception as exc:
            log.error("ClickHandler.callback erreur : %s", exc)

    ####
    # Toggle enregistrement (appelé par le Visualizer sur touche 'r')
    ####

    def toggle_record(self) -> None:
        """Bascule le mode enregistrement des clics."""
        with self._lock:
            self.record_mode = not self.record_mode
            if self.record_mode and self._record_file is None:
                self._open_record_file()
        log.info(
            "Mode enregistrement clics : %s",
            "ON" if self.record_mode else "OFF",
        )

    ####
    # Clics récents pour le rendu (points rouges)
    ####

    def get_recent_clicks(self) -> list[tuple[int, int]]:
        """
        Retourne la liste des clics encore dans la fenêtre TTL.

        Returns
        ######
        Liste de (x, y)
        """
        now = time.time()
        with self._lock:
            self.last_clicks = [c for c in self.last_clicks if now - c[2] < CLICK_DISPLAY_TTL]
            return [(c[0], c[1]) for c in self.last_clicks]

    ####
    # Enregistrement des clics sur disque
    ####

    def _open_record_file(self) -> None:
        """Ouvre (ou crée) le fichier de log des clics."""
        if self._record_dir is None:
            log.warning("record_dir not set: recording disabled")
            self.record_mode = False
            return

        self._record_dir.mkdir(parents=True, exist_ok=True)
        fname = f"cmd_send_{self._seq_name}.txt" if self._seq_name else "cmd_send.txt"
        path = self._record_dir / fname
        # Append pour ne pas écraser une session précédente
        self._record_file = open(path, "a", encoding="utf-8")
        log.info("Click recording -> %s", path)

    def save_click(
        self,
        frame_emit: int,
        frame_click: int,
        x: int,
        y: int,
    ) -> None:
        """
        Enregistre un clic dans le fichier de log (mode record uniquement).

        Format : frame_emit,frame_click,x,y  (compatible command mode)
        """
        if self.record_mode and self._record_file is not None:
            line = f"{frame_emit},{frame_click},{x},{y}\n"
            self._record_file.write(line)
            self._record_file.flush()

    ####
    # API principale
    ####

    def get_right_click(self) -> tuple[int, int] | None:
        """Retourne (x, y) si un clic droit SOT2 est en attente, sinon None."""
        try:
            return self._r_queue.get_nowait()
        except queue.Empty:
            return None

    def has_right_click(self) -> bool:
        """True s'il y a au moins un clic droit en attente."""
        return not self._r_queue.empty()

    def get_recent_right_clicks(self) -> list[tuple[int, int]]:
        """Retourne la liste des clics droit encore dans la fenêtre TTL."""
        now = time.time()
        with self._lock:
            self.last_r_clicks = [c for c in self.last_r_clicks if now - c[2] < CLICK_DISPLAY_TTL]
            return [(c[0], c[1]) for c in self.last_r_clicks]

    def inject_right_click(self, frame_id: int, x: int, y: int) -> None:
        """Injecte un clic droit programmatique (réseau) pour SOT cible 2."""
        self._r_queue.put((x, y))
        now = time.time()
        with self._lock:
            self.last_r_clicks.append((x, y, now))
            self.last_r_clicks = [c for c in self.last_r_clicks if now - c[2] < CLICK_DISPLAY_TTL]
        log.info("Clic droit injecté (réseau) SOT2 : (%d,%d) frame=%d", x, y, frame_id)

    def get_kill_click(self) -> tuple[int, int] | None:
        """Retourne (x, y) si un clic molette KILL est en attente, sinon None."""
        try:
            return self._m_queue.get_nowait()
        except queue.Empty:
            return None

    def has_kill_click(self) -> bool:
        """True s'il y a au moins un clic molette KILL en attente."""
        return not self._m_queue.empty()

    def inject_kill_click(self, frame_id: int = -1, x: int = 0, y: int = 0) -> None:
        """Injecte un clic KILL programmatique (réseau : middle-click / button=1)."""
        self._m_queue.put((x, y))
        log.info("Clic KILL SOT injecté (réseau) : (%d,%d) frame=%d", x, y, frame_id)

    def apply_clicks(self, frame_id: int, state_machine) -> str | None:
        """
        Consomme tous les clics en attente et les applique à state_machine.

        Returns : texte de bannière si un kill a eu lieu, sinon None.
        """
        while self.has_click():
            cx, cy = self.get_click()
            state_machine.trigger_sot((int(cx), int(cy)), frame_id)
            if self.record_mode:
                self.save_click(frame_id, frame_id, int(cx), int(cy))
        while self.has_right_click():
            rcx, rcy = self.get_right_click()
            state_machine.trigger_sot2((int(rcx), int(rcy)), frame_id)
        if self.has_kill_click():
            self.get_kill_click()
            state_machine.kill_all_sot()
            return "KILL SOT (molette)"
        return None

    def inject_click(self, frame_id: int, x: int, y: int) -> None:
        """
        Injecte un clic programmatique (réseau, test) dans la queue SOT.

        Équivalent à EVENT_LBUTTONDOWN depuis cv2 mais sans la fenêtre.
        Utilisé par session.py quand un clic est reçu via MJPEGServer /click.

        Parameters
        ########
        frame_id : frame courante (pour l'enregistrement éventuel)
        x, y     : coordonnées dans le repère de l'image originale
        """
        self._queue.put((x, y))
        now = time.time()
        with self._lock:
            self.last_clicks.append((x, y, now))
            self.last_clicks = [c for c in self.last_clicks if now - c[2] < CLICK_DISPLAY_TTL]
        if self.record_mode:
            self.save_click(frame_id, frame_id, x, y)
        log.info("Clic injecté (réseau) : (%d,%d) frame=%d", x, y, frame_id)

    def get_click(self) -> tuple[int, int] | None:
        """Retourne (x, y) si un clic SOT est en attente, sinon None."""
        try:
            return self._queue.get_nowait()
        except queue.Empty:
            return None

    def has_click(self) -> bool:
        """True s'il y a au moins un clic SOT en attente."""
        return not self._queue.empty()

    def clear(self) -> None:
        """Vide la queue de clics."""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break

    def close(self) -> None:
        """Ferme le fichier de log si ouvert."""
        if self._record_file is not None:
            self._record_file.close()
            self._record_file = None
            log.info("Click log file closed.")
