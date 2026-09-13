##########################################
# Project  : VisionNexus
# File     : stream_server.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Non-blocking HTTP MJPEG server for streaming annotated frames to a remote viewer.
##########################################

import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

#########################################
# Page HTML interactive embarquée
#########################################
_HTML_PAGE = """<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VisionNexus Inference - Live Stream</title>
  <style>
    body { margin:0; background:#111; display:flex; flex-direction:column;
           align-items:center; justify-content:center; min-height:100vh; }
    h1   { color:#7BDFF2; font-family:monospace; margin-bottom:8px; font-size:1.2em; }
    #container { position:relative; display:inline-block; }
    img  { max-width:95vw; max-height:90vh; border:2px solid #45475a;
           border-radius:6px; cursor:crosshair; display:block; }
    p    { color:#888; font-family:monospace; font-size:11px; margin-top:6px; }
    #status { color:#06D6A0; font-family:monospace; font-size:11px; margin-top:4px;
              min-height:16px; }
  </style>
</head>
<body>
  <h1>VisionNexus Inference</h1>
  <div id="container">
    <img id="stream" src="/stream" alt="Live stream">
  </div>
  <p>Clic gauche = SOT1 &nbsp;|&nbsp; Clic droit = SOT2 &nbsp;|&nbsp;
     Clic molette = KILL (relâche toutes les cibles) &nbsp;|&nbsp;
     <kbd>M</kbd> = toggle MOT background &nbsp;|&nbsp;
     <kbd>R</kbd> = enregistrement clics &nbsp;|&nbsp;
     <kbd>Q</kbd> = quitter pipeline</p>
  <div id="status">Connecté</div>
  <script>
    var img = document.getElementById('stream');
    var status = document.getElementById('status');

    function sendClick(ev, button) {
      // Transformer les coordonnées affichage -> coordonnées image originale
      var rect = img.getBoundingClientRect();
      var scaleX = img.naturalWidth  / rect.width;
      var scaleY = img.naturalHeight / rect.height;
      var x = Math.round((ev.clientX - rect.left) * scaleX);
      var y = Math.round((ev.clientY - rect.top)  * scaleY);
      fetch('/click', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({x: x, y: y, button: button || 0})
      });
      var label = button === 2 ? 'Clic droit (SOT2)' : 'Clic';
      status.textContent = label + ' envoyé (' + x + ', ' + y + ')';
      setTimeout(() => { status.textContent = 'Connecté'; }, 1500);
    }

    img.addEventListener('click',       function(ev) { sendClick(ev, 0); });
    img.addEventListener('contextmenu', function(ev) { ev.preventDefault(); sendClick(ev, 2); });
    // Clic molette (bouton du milieu) -> KILL toutes les cibles SOT (button=1).
    // 'auxclick' se déclenche pour les boutons non-primaires ; on bloque aussi
    // 'mousedown' du milieu pour éviter le scroll automatique du navigateur.
    img.addEventListener('mousedown', function(ev) { if (ev.button === 1) ev.preventDefault(); });
    img.addEventListener('auxclick',  function(ev) { if (ev.button === 1) { ev.preventDefault(); sendClick(ev, 1); } });

    document.addEventListener('keydown', function(ev) {
      var key = ev.key.toLowerCase();
      if (['m', 'r', 'q', ' '].includes(key)) {
        ev.preventDefault();
        fetch('/key', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({key: key === ' ' ? 'space' : key})
        });
        status.textContent = 'Touche : ' + (key === ' ' ? 'space' : key);
        setTimeout(() => { status.textContent = 'Connecté'; }, 1000);
      }
    });
  </script>
</body>
</html>
""".encode()


#########################################
# Handler HTTP
#########################################
class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # silence les logs HTTP dans la console

    def do_GET(self):
        if self.path == "/":
            self._serve_html()
        elif self.path == "/stream":
            self._serve_stream()
        elif self.path == "/snapshot":
            self._serve_snapshot()
        elif self.path == "/info":
            self._serve_info()
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/click":
            print(f"[MJPEGServer] POST /click  from {self.client_address}")
            self._handle_click()
        elif self.path == "/key":
            self._handle_key()
        else:
            self.send_error(404)

    #####GET handlers ####

    def _serve_html(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(_HTML_PAGE)))
        self.end_headers()
        self.wfile.write(_HTML_PAGE)

    def _serve_stream(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=--mjpeg_boundary")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        server: MJPEGServer = self.server.mjpeg_server  # type: ignore
        client_q: queue.Queue = queue.Queue(maxsize=4)
        server._register(client_q)
        try:
            while not server._stop_event.is_set():
                try:
                    jpeg_bytes = client_q.get(timeout=0.5)
                except queue.Empty:
                    continue
                try:
                    self.wfile.write(
                        b"--mjpeg_boundary\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: "
                        + str(len(jpeg_bytes)).encode()
                        + b"\r\n\r\n"
                        + jpeg_bytes
                        + b"\r\n"
                    )
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
        finally:
            server._unregister(client_q)

    def _serve_snapshot(self):
        server: MJPEGServer = self.server.mjpeg_server  # type: ignore
        jpeg = server.last_jpeg
        if jpeg is None:
            self.send_error(503, "No frame yet")
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(jpeg)))
        self.end_headers()
        self.wfile.write(jpeg)

    def _serve_info(self):
        """Retourne les métadonnées du stream : taille originale, fps."""
        server: MJPEGServer = self.server.mjpeg_server  # type: ignore
        info = json.dumps(
            {
                "width": server.frame_width,
                "height": server.frame_height,
                "fps": server.fps,
                "quality": server._quality,
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(info)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(info)

    #####POST handlers ####

    def _read_json_body(self) -> dict | None:
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                return {}
            body = self.rfile.read(length)
            return json.loads(body.decode())
        except Exception:
            return None

    def _ok(self):
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def _handle_click(self):
        """
        POST /click  body: {"x": int, "y": int, "button": int, "frame_id": int (opt)}

        button: 0 = clic gauche (SOT1, défaut), 2 = clic droit (SOT2)
        Coordonnées en pixels de l'image originale.
        """
        server: MJPEGServer = self.server.mjpeg_server  # type: ignore
        data = self._read_json_body()
        if data and "x" in data and "y" in data:
            click = {
                "x": int(data["x"]),
                "y": int(data["y"]),
                "button": int(data.get("button", 0)),  # 0=gauche, 2=droit
                "frame_id": int(data.get("frame_id", -1)),
            }
            try:
                server._click_q.put_nowait(click)
            except queue.Full:
                pass  # pipeline lent, drop
        self._ok()

    def _handle_key(self):
        """
        POST /key  body: {"key": "m"|"r"|"q"|"space"}
        """
        server: MJPEGServer = self.server.mjpeg_server  # type: ignore
        data = self._read_json_body()
        if data and "key" in data:
            key = str(data["key"]).lower().strip()
            if key in ("m", "r", "q", "space"):
                try:
                    server._key_q.put_nowait(key)
                except queue.Full:
                    pass
        self._ok()


#########################################
# Serveur principal
#########################################
class MJPEGServer:
    """
    Serveur HTTP MJPEG bidirectionnel.

    Outbound (Jetson -> PC) :
      GET /           -> page HTML interactive avec clics JS
      GET /stream     -> flux MJPEG continu
      GET /snapshot   -> JPEG unique du dernier frame
      GET /info       -> JSON {width, height, fps, quality}

    Inbound (PC -> Jetson) :
      POST /click     -> {"x":int, "y":int}   clic opérateur
      POST /key       -> {"key":"m"|"r"|"q"|"space"}  touche clavier

    Consommation (depuis session.py) :
      clicks = server.pop_clicks()  -> List[dict]  appelé chaque frame
      keys   = server.pop_keys()    -> List[str]   appelé chaque frame
    """

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        quality: int = 70,
        stream_every: int = 1,
        fps: float = 10.0,
    ):
        self._host = host
        self._port = port
        self._quality = quality
        self._stream_every = stream_every
        self.fps = fps
        self._encode_param = [cv2.IMWRITE_JPEG_QUALITY, quality]

        # Dimensions du dernier frame (pour /info)
        self.frame_width: int = 0
        self.frame_height: int = 0

        # Clients stream outbound
        self._clients: list = []
        self._lock = threading.Lock()
        self.last_jpeg: bytes | None = None
        self._stop_event = threading.Event()

        self._frame_count = 0
        self._encode_q: queue.Queue = queue.Queue(maxsize=2)

        # Queues inbound : clics et touches reçus des clients
        self._click_q: queue.Queue = queue.Queue(maxsize=64)
        self._key_q: queue.Queue = queue.Queue(maxsize=32)

        # Threads
        self._enc_thread = threading.Thread(
            target=self._encode_loop, daemon=True, name="mjpeg_encode"
        )
        # ThreadingHTTPServer : chaque connexion dans son propre thread.
        # Indispensable pour que POST /click soit traité PENDANT que GET /stream
        # tient la connexion ouverte (le mode mono-thread bloquait tous les clics
        # jusqu'à la déconnexion du client mjpeg_receiver).
        self._httpd = ThreadingHTTPServer((host, port), _Handler)
        self._httpd.mjpeg_server = self  # type: ignore
        self._http_thread = threading.Thread(
            target=self._httpd.serve_forever, daemon=True, name="mjpeg_http"
        )

    def start(self) -> None:
        self._enc_thread.start()
        self._http_thread.start()
        print(f"[MJPEGServer] Stream  -> http://{self._host}:{self._port}/stream")
        print(f"[MJPEGServer] Browser -> http://{self._host}:{self._port}/")
        print(f"[MJPEGServer] Info    -> http://{self._host}:{self._port}/info")

    #####API pipeline ####

    def push(self, frame) -> None:
        """Non-bloquant. Drop si queue encodage pleine ou si frame non retenue."""
        self._frame_count += 1
        if self._frame_count % self._stream_every != 0:
            return
        # Mémoriser dimensions pour /info
        if hasattr(frame, "shape"):
            h, w = frame.shape[:2]
            self.frame_height = h
            self.frame_width = w
        try:
            self._encode_q.put_nowait(frame.copy())
        except queue.Full:
            pass

    def pop_clicks(self) -> list[dict]:
        """
        Retourne et vide tous les clics reçus depuis le dernier appel.

        Chaque clic : {"x": int, "y": int, "frame_id": int}
        Les coordonnées sont dans le repère de l'image originale.
        À appeler depuis session.py après viz.render().
        """
        clicks = []
        while True:
            try:
                clicks.append(self._click_q.get_nowait())
            except queue.Empty:
                break
        if clicks:
            print(f"[MJPEGServer] {len(clicks)} clic(s) reçus")
        return clicks

    def pop_keys(self) -> list[str]:
        """
        Retourne et vide toutes les touches reçues depuis le dernier appel.

        Valeurs possibles : "m" | "r" | "q" | "space"
        À appeler depuis session.py après viz.render().
        """
        keys = []
        while True:
            try:
                keys.append(self._key_q.get_nowait())
            except queue.Empty:
                break
        return keys

    def stop(self) -> None:
        self._stop_event.set()
        self._httpd.shutdown()
        self._enc_thread.join(timeout=2.0)

    #####Interne ####

    def _register(self, q: queue.Queue) -> None:
        with self._lock:
            self._clients.append(q)

    def _unregister(self, q: queue.Queue) -> None:
        with self._lock:
            self._clients = [c for c in self._clients if c is not q]

    def _encode_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                frame = self._encode_q.get(timeout=1.0)
            except queue.Empty:
                continue
            ok, buf = cv2.imencode(".jpg", frame, self._encode_param)
            if not ok:
                continue
            jpeg = buf.tobytes()
            self.last_jpeg = jpeg
            with self._lock:
                for q in self._clients:
                    try:
                        q.put_nowait(jpeg)
                    except queue.Full:
                        pass  # client lent -> drop
