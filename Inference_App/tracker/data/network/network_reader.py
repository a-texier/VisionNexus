##########################################
# Project  : VisionNexus
# File     : network_reader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Reads frames from an HTTP MJPEG stream (network mode for Jetson deployment).
##########################################

import logging
import queue
import threading
import time

import numpy as np

log = logging.getLogger(__name__)


class NetworkFrameReader:
    """
    Lit des frames depuis un flux MJPEG HTTP en temps réel.

    Utilise un thread dédié pour recevoir les frames en continu
    et les stocker dans une queue circulaire. La boucle principale
    appelle __getitem__(idx) pour obtenir le frame suivant dans l'ordre.

    Le paramètre `idx` est ignoré (flux séquentiel sans possibilité
    de seek), mais l'interface reste compatible avec ImageReader.
    """

    def __init__(self, stream_url: str, prefetch: int = 2):
        """
        Parameters
        ########
        stream_url  URL complète du flux MJPEG
                    ex: "http://192.168.1.50:9090/stream"
        prefetch    Taille du buffer interne (frames en avance)
        """
        self._url = stream_url
        self._prefetch = prefetch
        self._queue: queue.Queue = queue.Queue(maxsize=prefetch + 2)
        self._fps: float = 10.0
        self._n: int = -1  # inconnu en mode live
        self._running = threading.Event()
        self._running.set()
        self._last_frame: np.ndarray | None = None

        # Récupérer les métadonnées (/info) si disponibles
        self._fetch_info()

        # Démarrer le thread réception
        self._thread = threading.Thread(target=self._recv_loop, daemon=True, name="net_frame_recv")
        self._thread.start()
        log.info(
            "NetworkFrameReader: %s  fps=%.1f",
            stream_url,
            self._fps,
        )

    def _fetch_info(self) -> None:
        """Récupère les métadonnées depuis GET /info (FPS, dimensions)."""
        try:
            import requests

            base = self._url.rsplit("/stream", 1)[0].rsplit("/", 1)[0]
            # Essayer plusieurs variantes d'URL pour /info
            for info_url in [
                f"{base}/info",
                self._url.replace("/stream", "/info"),
            ]:
                try:
                    r = requests.get(info_url, timeout=3)
                    data = r.json()
                    self._fps = float(data.get("fps", 10.0))
                    log.info("NetworkFrameReader /info: %s", data)
                    return
                except Exception:
                    continue
        except ImportError:
            pass
        except Exception as exc:
            log.debug("NetworkFrameReader /info: %s (ignoré)", exc)

    def _recv_loop(self) -> None:
        """Thread de réception : décode le flux MJPEG et enqueue les frames."""
        try:
            import requests
        except ImportError:
            log.error("NetworkFrameReader: 'requests' non installé. pip install requests")
            return

        SOI = b"\xff\xd8"
        EOI = b"\xff\xd9"

        while self._running.is_set():
            try:
                r = requests.get(self._url, stream=True, timeout=10)
                buf = b""
                for chunk in r.iter_content(chunk_size=8192):
                    if not self._running.is_set():
                        break
                    buf += chunk
                    while True:
                        start = buf.find(SOI)
                        if start == -1:
                            buf = b""
                            break
                        end = buf.find(EOI, start + 2)
                        if end == -1:
                            buf = buf[start:]
                            break
                        jpeg = buf[start : end + 2]
                        buf = buf[end + 2 :]
                        arr = np.frombuffer(jpeg, dtype=np.uint8)
                        frame = cv_imdecode(arr)
                        if frame is not None:
                            self._last_frame = frame
                            # Remplacer le frame le plus ancien si queue pleine
                            if self._queue.full():
                                try:
                                    self._queue.get_nowait()
                                except queue.Empty:
                                    pass
                            try:
                                self._queue.put_nowait(frame)
                            except queue.Full:
                                pass
            except Exception as exc:
                if self._running.is_set():
                    log.warning("NetworkFrameReader: déconnecté (%s) - reconnexion dans 1s", exc)
                    time.sleep(1.0)

    ######################################
    # Interface compatible ImageReader
    ######################################

    def __len__(self) -> int:
        """Nombre de frames - inconnu en mode live (retourne -1)."""
        return self._n

    def __getitem__(self, idx: int) -> np.ndarray:
        """
        Retourne le prochain frame disponible du flux (idx ignoré).

        Bloque jusqu'à 5 secondes si aucun frame n'est disponible.
        Retourne le dernier frame connu si timeout (permet de continuer
        même en cas de freeze temporaire du flux).
        """
        try:
            return self._queue.get(timeout=5.0)
        except queue.Empty:
            log.warning("NetworkFrameReader: timeout 5s - retour dernier frame connu")
            if self._last_frame is not None:
                return self._last_frame
            # Aucun frame : retourner une image noire 640×512
            return np.zeros((512, 640, 3), dtype=np.uint8)

    @property
    def fps(self) -> float:
        """FPS du flux (récupéré depuis /info)."""
        return self._fps

    @property
    def shape(self):
        """Forme du frame (h, w, c) - None si aucun frame reçu."""
        if self._last_frame is not None:
            return self._last_frame.shape
        return None

    def close(self) -> None:
        """Arrête le thread de réception."""
        self._running.clear()
        self._thread.join(timeout=3.0)
        log.info("NetworkFrameReader: fermé.")


#########################################
# Helper - décoder JPEG sans OpenCV natif si absent (fallback PIL)
#########################################
def cv_imdecode(arr):
    """Décode un JPEG en np.ndarray BGR uint8."""
    try:
        import cv2

        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except ImportError:
        try:
            import io

            from PIL import Image

            img = Image.open(io.BytesIO(arr.tobytes()))
            import numpy as np

            bgr = np.array(img)[:, :, ::-1].copy()
            return bgr
        except Exception:
            return None
