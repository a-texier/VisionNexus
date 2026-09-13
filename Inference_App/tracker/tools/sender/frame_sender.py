##########################################
# Project  : VisionNexus
# File     : frame_sender.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Standalone MJPEG sender script - reads a video source and streams it to the Jetson.
##########################################

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingTCPServer

import cv2
import numpy as np

_APP_ROOT = Path(__file__).resolve().parents[3]
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

#########################################
# Serveur MJPEG minimal - push-only (pas de /click, juste /stream et /info)
#########################################


class _FramePushServer:
    """
    Serveur HTTP MJPEG minimal pour diffuser des frames brutes.

    Routes disponibles :
      GET /stream  - flux MJPEG continu (multipart/x-mixed-replace)
      GET /        - alias de /stream
      GET /info    - métadonnées JSON {width, height, fps}
    """

    def __init__(self, host: str, port: int, quality: int, fps: float):
        self._quality = quality
        self._fps = float(fps)
        self._frame_bytes = None
        self._frame_event = threading.Event()
        self._lock = threading.Lock()
        self._width = 0
        self._height = 0

        outer = self

        class _Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                pass  # silence les logs HTTP

            def do_GET(self):
                path = self.path.split("?")[0]

                if path in ("/stream", "/"):
                    self.send_response(200)
                    self.send_header(
                        "Content-Type",
                        "multipart/x-mixed-replace;boundary=mjpeg_boundary",
                    )
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    last_sent = None
                    try:
                        while True:
                            outer._frame_event.wait(timeout=2.0)
                            outer._frame_event.clear()
                            with outer._lock:
                                data = outer._frame_bytes
                            if data is None or data is last_sent:
                                continue
                            last_sent = data
                            header = (
                                b"--mjpeg_boundary\r\n"
                                b"Content-Type: image/jpeg\r\n"
                                b"Content-Length: " + str(len(data)).encode() + b"\r\n\r\n"
                            )
                            self.wfile.write(header + data + b"\r\n")
                            self.wfile.flush()
                    except Exception:
                        pass

                elif path == "/info":
                    with outer._lock:
                        info = {
                            "width": outer._width,
                            "height": outer._height,
                            "fps": outer._fps,
                        }
                    body = json.dumps(info).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

                else:
                    self.send_response(404)
                    self.end_headers()

        self._httpd = ThreadingTCPServer((host, port), _Handler)
        self._httpd.daemon_threads = True
        self._thread = threading.Thread(
            target=self._httpd.serve_forever, daemon=True, name="mjpeg_push"
        )
        self._thread.start()

    def push(self, frame: np.ndarray) -> None:
        """Encode la frame en JPEG et la met à disposition du flux."""
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self._quality])
        if ok:
            with self._lock:
                self._frame_bytes = bytes(buf)
                self._height, self._width = frame.shape[:2]
            self._frame_event.set()

    def stop(self) -> None:
        self._httpd.shutdown()


#########################################
# Itérateur de frames selon la source
#########################################


def _to_bgr_uint8(frame: np.ndarray) -> np.ndarray:
    """Normalise n'importe quelle frame (uint16, float32, gray) en BGR uint8."""
    if frame.dtype != np.uint8:
        frame = cv2.normalize(frame, None, 0, 255, cv2.NORM_MINMAX, cv2.CV_8U)
    if frame.ndim == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
    return frame


def _iter_frames(source: str, start: int, stop: int, loop: bool):
    """
    Générateur de frames depuis une vidéo, un dossier d'images ou un fichier optional_format.

    Yields : np.ndarray BGR uint8.

    optional_format support (optionnel) : nécessite `pip install optional_format_adapter`.
    """
    src = Path(source)
    video_exts = {".mp4", ".avi", ".mov", ".mkv", ".m4v"}

    # --- Cas 1 : fichier optional_format ---
    if src.is_file() and src.suffix.lower() == ".optional":
        from backend.services.format_registry import invoke_for_filename

        def _read_optional_format(path, s, e, lp):
            frames, header = invoke_for_filename(
                str(path),
                "read",
                str(path),
                slice_size=5,
                use_wrapper=True,
                return_header=True,
            )
            n = int(header.dict["n_img"])
            i0 = max(0, s)
            i1 = min(n, e) if e >= 0 else n
            while True:
                for i in range(i0, i1):
                    f = frames[i]
                    if f is not None:
                        yield _to_bgr_uint8(
                            np.array(f, dtype=np.float32) if not isinstance(f, np.ndarray) else f
                        )
                if not lp:
                    break

        yield from _read_optional_format(src, start, stop, loop)
        return

    # --- Cas 2 : fichier vidéo ---
    if src.is_file() and src.suffix.lower() in video_exts:
        while True:
            cap = cv2.VideoCapture(str(src))
            if start > 0:
                cap.set(cv2.CAP_PROP_POS_FRAMES, start)
            idx = start
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if stop >= 0 and idx >= stop:
                    break
                yield _to_bgr_uint8(frame)
                idx += 1
            cap.release()
            if not loop:
                break
        return

    # --- Cas 3 : dossier d'images ---
    if src.is_dir():
        img_exts = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
        files = sorted(f for f in src.iterdir() if f.suffix.lower() in img_exts)
        if start:
            files = files[start:]
        if stop >= 0:
            files = files[: stop - start]
        while True:
            for f in files:
                frame = cv2.imread(str(f), cv2.IMREAD_UNCHANGED)
                if frame is not None:
                    yield _to_bgr_uint8(frame)
            if not loop:
                break
        return

    raise FileNotFoundError(f"Source introuvable ou format non supporté : {source}")


def _get_video_fps(source: str) -> float:
    """Lit le FPS natif d'un fichier vidéo."""
    cap = cv2.VideoCapture(source)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return fps if fps > 0 else 0.0


#########################################
# Logique principale
#########################################


def run_sender(
    input_path: str,
    host: str = "0.0.0.0",
    port: int = 9090,
    fps: float = 0.0,
    quality: int = 90,
    loop: bool = False,
    start: int = 0,
    stop: int = -1,
) -> None:
    """Démarre le serveur d'envoi de frames brutes."""
    if fps <= 0:
        fps = _get_video_fps(input_path)
    if fps <= 0:
        fps = 10.0
    frame_interval = 1.0 / fps

    print(f"[FrameSender] Source  : {input_path}")
    print(f"[FrameSender] FPS     : {fps:.1f}")
    print(f"[FrameSender] Qualité : JPEG q={quality}")
    print(f"[FrameSender] Écoute  : http://{host}:{port}/stream")
    print("              Configurer le pipeline :")
    print(f'              sequence_dir: "http://<ip_de_ce_pc>:{port}/stream"')

    server = _FramePushServer(host=host, port=port, quality=quality, fps=fps)

    frame_count = 0
    try:
        for frame in _iter_frames(input_path, start, stop, loop):
            t0 = time.perf_counter()
            server.push(frame)
            frame_count += 1
            elapsed = time.perf_counter() - t0
            sleep_s = frame_interval - elapsed
            if sleep_s > 0:
                time.sleep(sleep_s)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
        print(f"[FrameSender] Terminé - {frame_count} frames envoyées.")


#########################################
# Entry point
#########################################

if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="FrameSender - diffuse une vidéo/séquence vers la Jetson via MJPEG",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument(
        "--input", required=True, help="Vidéo (.mp4/.avi/…), fichier .optional ou dossier d'images"
    )
    ap.add_argument(
        "--host", default="0.0.0.0", help="Interface d'écoute (0.0.0.0 = toutes interfaces)"
    )
    ap.add_argument("--port", type=int, default=9090, help="Port HTTP")
    ap.add_argument("--fps", type=float, default=0.0, help="FPS d'envoi (0 = auto depuis la vidéo)")
    ap.add_argument("--quality", type=int, default=90, help="Qualité JPEG 0-100")
    ap.add_argument("--loop", action="store_true", help="Boucler en fin de séquence")
    ap.add_argument("--start", type=int, default=0, help="Première frame (index)")
    ap.add_argument("--stop", type=int, default=-1, help="Dernière frame exclusive (-1 = fin)")
    args = ap.parse_args()

    run_sender(
        input_path=args.input,
        host=args.host,
        port=args.port,
        fps=args.fps,
        quality=args.quality,
        loop=args.loop,
        start=args.start,
        stop=args.stop,
    )
