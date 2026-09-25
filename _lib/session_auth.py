"""
session_auth.py -- jeton de session par instance d'application.

Pourquoi : les serveurs ecoutent sur 127.0.0.1, ce qui ferme le reseau, mais
la boucle locale d'une VM est commune a tous ses comptes. N'importe quel
utilisateur connecte a la VM pouvait donc interroger le backend d'un autre
(curl, ou un tunnel ssh -L vers son port) et lire ses fichiers avec les droits
du proprietaire. Chaque instance a desormais un secret aleatoire, et le
backend refuse toute requete qui ne le presente pas.

Trajet du jeton :
  1. le lanceur le genere (new_session_env) et le passe au backend par
     variable d'environnement -- jamais en argument de commande, visible de
     tous dans `ps` ;
  2. il l'annonce une fois sur sa sortie (announce) : ligne `[token]` lue par
     le lanceur Electron, qui la retire de ses logs ;
  3. le backend (install_session_auth) verifie chaque requete : en-tete
     `X-VN-Token` (pose par Electron) ou cookie `vn_<port backend>` (pose par
     le lien d'amorcage, pour un navigateur classique) ;
  4. il publie aussi son jeton dans un fichier lisible par son seul
     proprietaire, pour que les autres backends du MEME utilisateur
     (Orchestrator -> sous-apps, appels internes) l'ajoutent tout seuls a
     leurs appels httpx (install_outbound_auth).

Le lien d'amorcage (`/api/_auth/bootstrap?code=...`) donne l'acces a un
navigateur sans mettre le jeton dans une URL : le code est a usage unique et
expire vite, la reponse pose le cookie HttpOnly puis redirige vers l'app.

Desactivation explicite : CV_AUTH=0 dans l'environnement du lanceur.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
import socket
import sys
import time
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TOKEN_ENV = "CV_SESSION_TOKEN"
BOOTSTRAP_ENV = "CV_BOOTSTRAP_CODE"
AUTH_SWITCH_ENV = "CV_AUTH"
HEADER_NAME = "x-vn-token"

BOOTSTRAP_PATH = "/api/_auth/bootstrap"
BOOTSTRAP_CODE_PATH = "/api/_auth/bootstrap-code"
# Sondes de disponibilite (lanceur, Orchestrator) : elles ne renvoient aucune
# donnee et doivent repondre avant qu'on connaisse le jeton.
PUBLIC_PATHS = frozenset({"/health", "/api/health", BOOTSTRAP_PATH})

# Code demande par le lanceur Electron au clic sur "Ouvrir dans le navigateur".
CODE_TTL_S = 120
# Code annonce dans le terminal au lancement, pour un usage sans Electron.
INITIAL_CODE_TTL_S = 30 * 60

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


# ---------------------------------------------------------------------------
# Cote lanceur
# ---------------------------------------------------------------------------

def auth_enabled() -> bool:
    return os.environ.get(AUTH_SWITCH_ENV, "1").strip() != "0"


def new_session_env() -> dict[str, str]:
    """Variables a ajouter a l'environnement du backend lance. Vide si l'auth est coupee."""
    if not auth_enabled():
        return {}
    return {
        TOKEN_ENV: secrets.token_urlsafe(32),
        BOOTSTRAP_ENV: secrets.token_urlsafe(16),
    }


def announce(session_env: dict[str, str], frontend_port: int | None) -> None:
    """Annonce le jeton au client qui lit la sortie du lanceur, et le lien navigateur."""
    token = session_env.get(TOKEN_ENV)
    if not token:
        print(f"[auth] jeton de session desactive ({AUTH_SWITCH_ENV}=0)", flush=True)
        return
    print(f"[token] {token}", flush=True)
    if frontend_port:
        code = session_env[BOOTSTRAP_ENV]
        print(
            f"[auth] navigateur (lien a usage unique, 30 min) : "
            f"http://127.0.0.1:{frontend_port}{BOOTSTRAP_PATH}?code={code}",
            flush=True,
        )


def cookie_name(backend_port: int | str) -> str:
    # Un cookie ne distingue pas les ports : un nom par instance, sinon deux
    # apps ouvertes dans le meme navigateur s'ecraseraient leur jeton.
    return f"vn_{backend_port}"


# ---------------------------------------------------------------------------
# Fichiers de jeton (appels entre backends du meme utilisateur)
# ---------------------------------------------------------------------------

def _token_dir() -> Path:
    return Path.home() / ".visionnexus" / "tokens"


def _token_file(port: int | str) -> Path:
    # Le nom d'hote evite qu'un home partage entre plusieurs VM (NFS) melange
    # les jetons de deux instances qui auraient le meme port.
    return _token_dir() / f"{socket.gethostname()}_{port}"


def publish_token(port: int | str, token: str) -> None:
    """Ecrit le jeton dans un fichier lisible par son seul proprietaire (0600, dossier 0700)."""
    directory = _token_dir()
    directory.mkdir(parents=True, exist_ok=True)
    if sys.platform != "win32":
        os.chmod(directory, 0o700)
    path = _token_file(port)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, token.encode("ascii"))
    finally:
        os.close(fd)
    if sys.platform != "win32":
        os.chmod(path, 0o600)


def token_for_port(port: int | str) -> str | None:
    try:
        return _token_file(port).read_text(encoding="ascii").strip() or None
    except OSError:
        return None


def outbound_headers(url: str) -> dict[str, str]:
    """En-tete d'auth pour un appel vers une instance locale du meme utilisateur, sinon {}."""
    parts = urlsplit(url)
    if parts.hostname not in _LOOPBACK_HOSTS or parts.port is None:
        return {}
    token = token_for_port(parts.port)
    return {HEADER_NAME: token} if token else {}


_outbound_installed = False


def install_outbound_auth() -> None:
    """Ajoute le jeton aux appels httpx vers nos autres instances locales.

    Un seul point au lieu d'une vingtaine de clients httpx a modifier un par
    un (Orchestrator -> sous-apps, appels d'un backend a lui-meme) : chaque
    envoi regarde le port vise et, s'il appartient a une instance de ce meme
    utilisateur, pose l'en-tete. Un appel vers un hote non local n'est jamais
    touche.
    """
    global _outbound_installed
    if _outbound_installed:
        return
    try:
        import httpx
    except ImportError:
        return
    _outbound_installed = True

    def _decorate(request: "httpx.Request") -> None:
        if HEADER_NAME in request.headers:
            return
        for key, value in outbound_headers(str(request.url)).items():
            request.headers[key] = value

    sync_send = httpx.Client.send
    async_send = httpx.AsyncClient.send

    def send(self, request, *args, **kwargs):
        _decorate(request)
        return sync_send(self, request, *args, **kwargs)

    async def asend(self, request, *args, **kwargs):
        _decorate(request)
        return await async_send(self, request, *args, **kwargs)

    httpx.Client.send = send
    httpx.AsyncClient.send = asend


# ---------------------------------------------------------------------------
# Cote backend : middleware ASGI
# ---------------------------------------------------------------------------

class SessionAuthMiddleware:
    """Refuse toute requete HTTP ou WebSocket sans le jeton de cette instance.

    Middleware ASGI pur (pas BaseHTTPMiddleware, qui ajoute un surcout par
    requete et casse les reponses en streaming comme les images servies par
    morceaux). La verification est une comparaison a temps constant : aucun
    acces disque ni base de donnees.
    """

    def __init__(self, app, token: str, cookie: str, bootstrap_code: str | None = None) -> None:
        self.app = app
        self.token = token
        self.cookie = cookie
        self._codes: dict[str, float] = {}
        if bootstrap_code:
            self._codes[bootstrap_code] = time.monotonic() + INITIAL_CODE_TTL_S

    async def __call__(self, scope, receive, send) -> None:
        kind = scope["type"]
        if kind not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "")
        # Preflight CORS : le navigateur ne joint jamais de cookie ni d'en-tete
        # personnalise a un OPTIONS, et il ne renvoie aucune donnee.
        if kind == "http" and method == "OPTIONS":
            await self.app(scope, receive, send)
            return
        if kind == "http" and path == BOOTSTRAP_PATH:
            await self._bootstrap(scope, send)
            return
        authorized = self._authorized(scope)
        if authorized and kind == "http" and path == BOOTSTRAP_CODE_PATH and method == "POST":
            await self._issue_code(send)
            return
        if authorized or path in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return
        await self._deny(kind, send)

    def _authorized(self, scope) -> bool:
        header_value = ""
        cookie_header = ""
        for key, value in scope.get("headers", []):
            if key == b"x-vn-token":
                header_value = value.decode("latin-1")
            elif key == b"cookie":
                cookie_header = value.decode("latin-1")
        if header_value and hmac.compare_digest(header_value, self.token):
            return True
        if cookie_header:
            morsel = SimpleCookie(cookie_header).get(self.cookie)
            if morsel is not None and hmac.compare_digest(morsel.value, self.token):
                return True
        return False

    def _take_code(self, code: str) -> bool:
        now = time.monotonic()
        for stale in [c for c, exp in self._codes.items() if exp < now]:
            del self._codes[stale]
        for known in list(self._codes):
            if hmac.compare_digest(known, code):
                del self._codes[known]
                return True
        return False

    async def _bootstrap(self, scope, send) -> None:
        query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
        code = (query.get("code") or [""])[0]
        if not code or not self._take_code(code):
            await _send_text(
                send, 403,
                "Lien de connexion invalide ou deja utilise. "
                "Relancez 'Ouvrir dans le navigateur' depuis VisionNexus.",
            )
            return
        cookie = f"{self.cookie}={self.token}; Path=/; HttpOnly; SameSite=Strict"
        target = _safe_next((query.get("next") or ["/"])[0])
        await send({
            "type": "http.response.start",
            "status": 302,
            "headers": [
                (b"location", target.encode("latin-1")),
                (b"set-cookie", cookie.encode("latin-1")),
                (b"cache-control", b"no-store"),
                (b"content-length", b"0"),
            ],
        })
        await send({"type": "http.response.body", "body": b""})

    async def _issue_code(self, send) -> None:
        code = secrets.token_urlsafe(16)
        self._codes[code] = time.monotonic() + CODE_TTL_S
        body = json.dumps({"code": code, "path": BOOTSTRAP_PATH, "ttl_s": CODE_TTL_S}).encode()
        await send({
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"application/json"),
                (b"cache-control", b"no-store"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    async def _deny(self, kind: str, send) -> None:
        if kind == "websocket":
            # Fermer avant accept() : le serveur repond 403 a la poignee de main.
            await send({"type": "websocket.close", "code": 4401})
            return
        await _send_text(send, 401, "Jeton de session manquant ou invalide.")


def _safe_next(path: str) -> str:
    """Redirection interne uniquement : un `next` vers un autre site ferait du lien un relais."""
    if not path.startswith("/") or path.startswith("//") or "\\" in path:
        return "/"
    try:
        path.encode("latin-1")
    except UnicodeEncodeError:
        return "/"
    return path


async def _send_text(send, status: int, text: str) -> None:
    body = json.dumps({"detail": text}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
        ],
    })
    await send({"type": "http.response.body", "body": body})


def install_session_auth(app) -> bool:
    """A appeler dans chaque backend, apres la configuration CORS.

    Sans jeton dans l'environnement (lancement manuel d'uvicorn en dev, ou
    CV_AUTH=0), le backend garde le comportement d'avant. Les appels sortants
    sont equipes dans tous les cas : un backend sans jeton peut quand meme
    devoir parler a une instance qui en a un.
    """
    install_outbound_auth()
    token = os.environ.get(TOKEN_ENV, "").strip()
    if not token:
        return False
    port = os.environ.get("BACKEND_PORT", "").strip()
    if not port:
        raise RuntimeError(f"{TOKEN_ENV} est defini mais BACKEND_PORT manque : cookie impossible a nommer.")
    app.add_middleware(
        SessionAuthMiddleware,
        token=token,
        cookie=cookie_name(port),
        bootstrap_code=os.environ.get(BOOTSTRAP_ENV) or None,
    )
    publish_token(port, token)
    return True
