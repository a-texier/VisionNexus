##########################################
# Project  : VisionNexus
# File     : zmq_reader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Updated  : 2026-09-13
# Obj  : Receives frames from the generic ZMQ protocol (tools/zmq_cpp) :
#        PULL socket connected to the C++ sender, multipart messages
#        [meta JSON, JPEG bytes]. No port auto-discovery: host/port must
#        match the C++ --port on both ends.
##########################################

import logging
import queue
import threading

import cv2
import numpy as np
import zmq

from .protocol import DEFAULT_FRAME_PORT, RAD_TO_DEG, parse_meta

log = logging.getLogger(__name__)

_FALLBACK_H = 512
_FALLBACK_W = 640


class ZmqFrameReader:
    """
    Recoit des frames depuis le protocole ZMQ generique de tools/zmq_cpp.

    Protocole :
    1. Le C++ (tools/zmq_cpp) bind une socket PUSH sur tcp://*:port et envoie
       pour chaque frame un message multipart [meta JSON, JPEG].
    2. Python se connecte en PULL sur tcp://host:port (host/port fixes,
       aucune decouverte dynamique - contrairement a l'ancien protocole).
    3. Les frames sont lues dans un thread dedie et placees dans un ring
       buffer Python (drop oldest).

    meta JSON (voir tools/zmq_cpp/json_utils.hpp::make_meta_json) :
      {"az": <rad>, "el": <rad>, "chh": <deg, FOV horizontal>, "frame_id": <int>}
    Le protocole generique ne transmet ni le roulis ni un FOV vertical distinct :
    roulis_deg vaut toujours 0.0, et vfov_deg est un alias de hfov_deg.

    Interface publique du lecteur de frames ZMQ :
      __getitem__, drain, queue_depth, last_received_fid, ring_size, close.

    Parameters
    ----------
    host        IP du sender C++ (defaut : "127.0.0.1")
    port        Port ZMQ des frames (defaut : DEFAULT_FRAME_PORT, cf --port cote C++)
    ring_size   Taille du ring buffer Python (drop oldest)
    timeout_ms  Timeout poller et queue.get (ms)
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = DEFAULT_FRAME_PORT,
        ring_size: int = 10,
        timeout_ms: int = 5000,
    ):
        self._host = host
        self._port = port
        self._ring_size = ring_size
        self._timeout_ms = timeout_ms
        self._n = -1  # flux live : longueur inconnue

        # Ring buffer Python
        self._queue: queue.Queue = queue.Queue(maxsize=ring_size)
        self._last_frame: np.ndarray | None = None
        self._last_ldv: tuple[float, float, float] | None = None
        self._last_zmq_id: int = -1

        self._running = threading.Event()
        self._running.set()
        self._ever_received_image: bool = False  # True after the first frame

        # Set by _handle_message() when frame_id drops sharply (sender restart).
        # Consumed by the loader via check_reconnect() to reset gap tracking.
        self._reconnect_event = threading.Event()

        self._last_hfov: float = 0.0
        self._last_vfov: float = 0.0

        self._ctx = zmq.Context()
        self._sock = self._ctx.socket(zmq.PULL)
        self._sock.set_hwm(ring_size * 2)
        self._sock.connect(f"tcp://{host}:{port}")

        self._poller = zmq.Poller()
        self._poller.register(self._sock, zmq.POLLIN)

        self._thread = threading.Thread(target=self._recv_loop, daemon=True, name="vision_zmq_recv")
        self._thread.start()
        log.info(
            "ZmqFrameReader: tcp://%s:%d  ring=%d  timeout=%dms",
            host,
            port,
            ring_size,
            timeout_ms,
        )

    # ------------------------------------------------------------------ #
    # Thread de reception                                                  #
    # ------------------------------------------------------------------ #

    def _recv_loop(self) -> None:
        """Main recv thread loop (daemon).

        Polls the frame socket with a timeout so the thread can exit cleanly
        on close(). After a positive poll, recv_multipart() is called NOBLOCK
        because the window between poll() and recv() could allow another
        consumer to take the message (NOBLOCK prevents a residual block).

        Flow on sender silence (timeout, not ZMQError):
          - poll() returns empty dict -> continue back to top of while
          - "sender disconnected?" warning logged once (_wait_logged gate)
          - when the sender resumes and events arrive, "reachable again" is
            logged (lines after continue)

        Flow on ZMQError (context terminated by close(), or fatal socket error):
          - break exits the while loop, thread ends
        """
        _wait_logged = False
        while self._running.is_set():
            try:
                events = dict(self._poller.poll(timeout=self._timeout_ms))
            except zmq.ZMQError as exc:
                if self._running.is_set():
                    log.error("ZmqFrameReader: ZMQError during poll, recv loop exits: %s", exc)
                break

            if not events:
                if not _wait_logged:
                    if self._ever_received_image:
                        log.warning(
                            "ZmqFrameReader: no message for %dms - sender disconnected? "
                            "(tcp://%s:%d)",
                            self._timeout_ms,
                            self._host,
                            self._port,
                        )
                    else:
                        log.warning(
                            "ZmqFrameReader: no message for %dms - waiting for sender on "
                            "tcp://%s:%d",
                            self._timeout_ms,
                            self._host,
                            self._port,
                        )
                    _wait_logged = True
                continue

            if _wait_logged and self._ever_received_image:
                log.info("ZmqFrameReader: sender reachable again - messages received")
            _wait_logged = False

            try:
                parts = self._sock.recv_multipart(zmq.NOBLOCK)
            except zmq.Again:
                continue
            except Exception as exc:
                if self._running.is_set():
                    log.debug("ZmqFrameReader: erreur recv: %s", exc)
                continue

            self._handle_message(parts)

    def _handle_message(self, parts: list) -> None:
        """Decode un message multipart [meta JSON, JPEG] et l'enfile dans le ring buffer.

        Rejette silencieusement les messages malformes (JSON invalide, JPEG
        corrompu, mauvais nombre de parties) pour se proteger du bruit reseau.

        Le ring buffer (queue Python) est rempli en drop-oldest : si plein on
        ejecte la plus vieille frame avant d'inserer la nouvelle, de sorte que
        le consommateur voit toujours les frames les plus recentes disponibles.
        """
        if len(parts) != 2:
            log.debug("ZmqFrameReader: message multipart inattendu (%d parties)", len(parts))
            return

        meta_raw, jpeg_raw = parts
        try:
            meta = parse_meta(meta_raw)
        except Exception as exc:
            log.debug("ZmqFrameReader: parse meta: %s", exc)
            return

        frame = _decode_jpeg(jpeg_raw)
        if frame is None:
            log.debug("ZmqFrameReader: JPEG invalide, frame ignoree")
            return

        frame_id = int(meta.get("frame_id", -1))
        az_deg = float(meta.get("az", 0.0)) * RAD_TO_DEG
        el_deg = float(meta.get("el", 0.0)) * RAD_TO_DEG
        # chh est deja en degres (voir tools/zmq_cpp/csv_reader.hpp), pas de
        # conversion radians->degres ici. Pas de FOV vertical distinct dans le
        # protocole generique -> vfov_deg est un simple alias de hfov_deg.
        chh_deg = float(meta.get("chh", 0.0))
        hfov_deg = chh_deg if chh_deg > 0.0 else 0.0
        vfov_deg = hfov_deg

        # Reconnect sender : son compteur frame_id repart de 0 au redemarrage.
        # Un saut negatif superieur au ring_size est un signal fiable (le flux
        # normal ne recule jamais de plus que la taille du ring buffer).
        if (
            self._ever_received_image
            and frame_id >= 0
            and frame_id < self._last_zmq_id - self._ring_size
        ):
            log.warning(
                "ZmqFrameReader: sender reconnect detecte (fid etait %d, redevient %d)",
                self._last_zmq_id,
                frame_id,
            )
            self._reconnect_event.set()

        # roulis_deg : non fourni par le protocole generique -> toujours 0.0.
        ldv = (az_deg, el_deg, 0.0)

        self._last_frame = frame
        self._last_ldv = ldv
        self._last_zmq_id = frame_id
        self._last_hfov = hfov_deg
        self._last_vfov = vfov_deg
        self._ever_received_image = True

        item = (frame, ldv, hfov_deg, vfov_deg, frame_id)

        if self._queue.full():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            pass

    # ------------------------------------------------------------------ #
    # Interface publique                                                   #
    # ------------------------------------------------------------------ #

    def __len__(self) -> int:
        """Retourne -1 : la longueur d'un flux live est inconnue a l'avance."""
        return self._n

    def __getitem__(self, idx: int):
        """Consomme et retourne la prochaine frame du ring buffer (FIFO, plus ancienne d'abord).

        Bloque au plus timeout_ms si le buffer est vide.
        Fallback sur la derniere frame connue si le sender a arrete d'envoyer (frame figee).
        Si aucune frame n'a encore ete recue, retourne une image noire 512x640.

        Args:
            idx: ignoré (interface compatible SequenceLoader, le flux live est sans indice).

        Returns:
            (frame ndarray, (az_deg, el_deg, roulis_deg), hfov_deg, vfov_deg, frame_id)
        """
        try:
            return self._queue.get(timeout=self._timeout_ms / 1000.0)
        except queue.Empty:
            if self._last_frame is not None:
                log.warning("ZmqFrameReader: ring buffer vide - retour derniere frame (figee)")
                return (
                    self._last_frame,
                    self._last_ldv,
                    self._last_hfov,
                    self._last_vfov,
                    self._last_zmq_id,
                )
            log.warning(
                "ZmqFrameReader: ring buffer vide, aucune frame recue - "
                "image noire en attente de tcp://%s:%d",
                self._host,
                self._port,
            )
            return np.zeros((_FALLBACK_H, _FALLBACK_W, 3), dtype=np.uint8), None, 0.0, 0.0, -1

    def drain(self, n: int) -> int:
        """Consomme et abandonne au plus n frames du ring buffer sans les traiter.

        Utilise au demarrage (startup drain : vider les vieilles frames accumulees
        pendant l'init YOLO) et par _ZmqLoaderWrapper lors du recalage automatique
        (sauter des frames quand avg_gap > zmq_catchup_threshold).

        Returns:
            Nombre de frames effectivement consommees (peut etre < n si buffer peu plein).
        """
        count = 0
        for _ in range(n):
            try:
                self._queue.get_nowait()
                count += 1
            except queue.Empty:
                break
        return count

    def queue_depth(self) -> int:
        """Nombre de frames en attente dans le ring buffer (0..ring_size)."""
        return self._queue.qsize()

    @property
    def ring_size(self) -> int:
        """Capacite maximale du ring buffer Python (zmq_ring_size dans le YAML)."""
        return self._ring_size

    @property
    def last_received_fid(self) -> int:
        """frame_id du dernier message recu depuis le sender (-1 avant la premiere frame)."""
        return self._last_zmq_id

    @property
    def last_ldv(self) -> tuple[float, float, float] | None:
        """(az_deg, el_deg, roulis_deg) du dernier message recu, ou None si aucun."""
        return self._last_ldv

    @property
    def last_hfov(self) -> float:
        """FOV horizontal (chh converti depuis le meta JSON) du dernier message. 0.0 si invalide."""
        return self._last_hfov

    @property
    def last_vfov(self) -> float:
        """Alias de last_hfov : pas de FOV vertical distinct dans le protocole generique."""
        return self._last_vfov

    @property
    def host(self) -> str:
        """Host du sender C++, pour reutilisation par ZmqDisplayBridge (memes host/anno/click)."""
        return self._host

    def check_reconnect(self) -> bool:
        """Return True if a sender reconnect was detected since the last call.

        Clears the internal flag. Called by the loader wrapper each frame to
        reset gap tracking when the sender restarts its frame counter from 0.
        Thread-safe: Event.is_set() / clear() are atomic.
        """
        if self._reconnect_event.is_set():
            self._reconnect_event.clear()
            return True
        return False

    def close(self) -> None:
        """Arrete le thread de reception et ferme la socket proprement.

        _running.clear() + join() garantit qu'aucun recv() n'est en cours
        avant de fermer la socket (sinon zmq leve une erreur).
        linger=0 : abandon des messages en attente sans bloquer.
        """
        self._running.clear()
        self._thread.join(timeout=3.0)
        self._sock.close(linger=0)
        self._ctx.term()
        log.info("ZmqFrameReader: ferme.")


# ------------------------------------------------------------------ #
# Helper decodage JPEG                                               #
# ------------------------------------------------------------------ #


def _decode_jpeg(data: bytes) -> np.ndarray | None:
    """Decode des bytes JPEG en ndarray via cv2.imdecode.

    Retourne None sur echec (JPEG corrompu) : l'appelant doit ignorer le message.
    """
    try:
        arr = np.frombuffer(data, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    except Exception:
        return None
