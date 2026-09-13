##########################################
# Project  : VisionNexus
# File     : mjpeg_receiver.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Standalone MJPEG receiver script for the operator PC - displays stream with click support.
##########################################

import argparse
import queue
import threading
import time

import cv2
import numpy as np
import requests

#########################################
# Réception MJPEG (thread dédié, faible latence)
#########################################


class _MJPEGStream:
    """
    Décode un flux MJPEG HTTP multipart en frames OpenCV.

    Utilise une session requests en streaming pour consommer les bytes
    au fil de l'eau - latence minimale (pas de buffer VideoCapture).
    Reconnexion automatique en cas de coupure.
    """

    def __init__(self, url: str):
        self._url = url
        self._frame: np.ndarray | None = None
        self._ts: float = 0.0
        self._lock = threading.Lock()
        self._running = threading.Event()
        self._running.set()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="mjpeg_recv")
        self._thread.start()

    def get_latest(self) -> tuple[np.ndarray | None, float]:
        with self._lock:
            return self._frame, self._ts

    def stop(self) -> None:
        self._running.clear()

    def _loop(self) -> None:
        while self._running.is_set():
            try:
                r = requests.get(self._url, stream=True, timeout=10)
                buf = b""
                SOI = b"\xff\xd8"
                EOI = b"\xff\xd9"
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
                        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        if frame is not None:
                            with self._lock:
                                self._frame = frame
                                self._ts = time.perf_counter()
            except Exception:
                if self._running.is_set():
                    time.sleep(1.0)


#########################################
# Envoi des commandes vers la Jetson (thread dédié, non-bloquant)
#########################################


class _Commander:
    """Envoie les clics et touches vers la Jetson via HTTP POST."""

    def __init__(self, base_url: str):
        self._base = base_url.rstrip("/")
        self._sess = requests.Session()
        self._sess.headers.update({"Content-Type": "application/json"})
        self._q = queue.Queue(maxsize=32)
        self._thread = threading.Thread(target=self._loop, daemon=True, name="commander")
        self._thread.start()

    def send_click(self, x: int, y: int, button: int = 0) -> None:
        """button: 0=gauche (SOT1), 2=droit (SOT2), 1=molette (KILL)."""
        import json

        try:
            self._q.put_nowait(("click", json.dumps({"x": x, "y": y, "button": button})))
        except queue.Full:
            pass

    def send_key(self, key: str) -> None:
        """key : 'm' | 'r' | 'q' | 'space'"""
        import json

        try:
            self._q.put_nowait(("key", json.dumps({"key": key})))
        except queue.Full:
            pass

    def _loop(self) -> None:
        while True:
            try:
                endpoint, body = self._q.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                self._sess.post(
                    f"{self._base}/{endpoint}",
                    data=body.encode(),
                    timeout=2.0,
                )
            except Exception:
                pass  # réseau coupé -> drop silencieux


#########################################
# Viewer interactif principal
#########################################


def _get_info(base_url: str) -> dict:
    """Récupère les métadonnées du stream (dimensions originales, fps)."""
    try:
        r = requests.get(f"{base_url}/info", timeout=5)
        return r.json()
    except Exception:
        return {"width": 0, "height": 0, "fps": 10.0}


def run_receiver(
    host: str = "192.168.1.10",
    port: int = 8080,
    scale: float = 1.0,
    title: str = "VisionNexus Remote",
    send_cmds: bool = True,
) -> None:
    """
    Démarre le viewer interactif MJPEG.

    Parameters
    ########
    host       IP de la Jetson / machine qui diffuse
    port       Port HTTP du MJPEGServer
    scale      Facteur d'affichage (1.0 = taille originale)
    title      Titre fenêtre cv2
    send_cmds  True = envoi clics/touches, False = lecture seule
    """
    base_url = f"http://{host}:{port}"

    print(f"[Receiver] Connexion à {base_url} ...")
    info = _get_info(base_url)
    orig_w = info.get("width", 0)
    orig_h = info.get("height", 0)
    fps = info.get("fps", 10.0)
    if orig_w and orig_h:
        print(f"[Receiver] Image : {orig_w}x{orig_h} @ {fps:.1f}fps")
    else:
        print("[Receiver] Image : dimensions inconnues (stream pas encore démarré?)")

    stream = _MJPEGStream(f"{base_url}/stream")
    cmd = _Commander(base_url) if send_cmds else None

    _scale_x: list = [1.0]
    _scale_y: list = [1.0]
    _click_dots: list = []
    _CLICK_TTL_S = 1.0

    def _on_mouse(event, x, y, flags, param):
        if cmd is None:
            return
        ox = int(round(x * _scale_x[0]))
        oy = int(round(y * _scale_y[0]))
        if event == cv2.EVENT_LBUTTONDOWN:
            cmd.send_click(ox, oy, button=0)
            _click_dots.append((x, y, 0, time.perf_counter()))
            print(f"[Receiver] Clic gauche (SOT1) ({ox},{oy})")
        elif event == cv2.EVENT_RBUTTONDOWN:
            cmd.send_click(ox, oy, button=2)
            _click_dots.append((x, y, 2, time.perf_counter()))
            print(f"[Receiver] Clic droit  (SOT2) ({ox},{oy})")
        elif event == cv2.EVENT_MBUTTONDOWN:
            cmd.send_click(ox, oy, button=1)
            print(f"[Receiver] Clic molette (KILL SOT) ({ox},{oy})")

    cv2.namedWindow(title, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(title, _on_mouse)

    print("[Receiver] Touches : M=mot_bg  R=record  ESPACE=pause  Q=quitter")
    print(f"[Receiver] Clics={'ON' if send_cmds else 'OFF (--no-click)'}")

    frame_count = 0
    last_ts = 0.0
    last_disp = None

    while True:
        frame, ts = stream.get_latest()

        if frame is not None and ts != last_ts:
            last_ts = ts
            frame_count += 1

            fh, fw = frame.shape[:2]
            disp_w = int(fw * scale)
            disp_h = int(fh * scale)

            if scale != 1.0:
                disp = cv2.resize(frame, (disp_w, disp_h), interpolation=cv2.INTER_LINEAR)
            else:
                disp = frame
                disp_w, disp_h = fw, fh

            ref_w = orig_w if orig_w > 0 else fw
            ref_h = orig_h if orig_h > 0 else fh
            _scale_x[0] = ref_w / max(1, disp_w)
            _scale_y[0] = ref_h / max(1, disp_h)
            last_disp = disp.copy()

        if last_disp is None:
            if cv2.waitKey(30) & 0xFF == ord("q"):
                break
            continue

        disp_out = last_disp.copy()
        now = time.perf_counter()
        _click_dots[:] = [d for d in _click_dots if now - d[3] < _CLICK_TTL_S]
        for cx, cy, btn, _ in _click_dots:
            color = (0, 165, 255) if btn == 2 else (0, 0, 255)
            cv2.circle(disp_out, (cx, cy), 7, color, 2)
            cv2.circle(disp_out, (cx, cy), 2, color, -1)

        cv2.imshow(title, disp_out)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            if cmd:
                cmd.send_key("q")
            break
        elif key == ord("m") and cmd:
            cmd.send_key("m")
            print("[Receiver] M -> toggle mot_background")
        elif key == ord("r") and cmd:
            cmd.send_key("r")
            print("[Receiver] R -> toggle record")
        elif key == ord(" ") and cmd:
            cmd.send_key("space")
            print("[Receiver] Space -> pause")

    stream.stop()
    cv2.destroyAllWindows()
    print(f"[Receiver] Terminé - {frame_count} frames reçus.")


#########################################
# Entry point
#########################################

if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="Récepteur MJPEG interactif VisionNexus (PC opérateur)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--host", default="192.168.1.10", help="IP de la Jetson / machine pipeline")
    ap.add_argument("--port", type=int, default=8080, help="Port HTTP du MJPEGServer")
    ap.add_argument(
        "--scale", type=float, default=1.0, help="Facteur d'affichage (0.5 = demi-taille)"
    )
    ap.add_argument("--title", default="VisionNexus Remote", help="Titre fenêtre cv2")
    ap.add_argument(
        "--no-click", action="store_true", help="Lecture seule - clics et touches non envoyés"
    )
    args = ap.parse_args()

    run_receiver(
        host=args.host,
        port=args.port,
        scale=args.scale,
        title=args.title,
        send_cmds=not args.no_click,
    )
