"""Tests de _lib/session_auth.py : middleware, lien d'amorcage, fichiers de jeton."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from _lib import session_auth  # noqa: E402

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI, WebSocket  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TOKEN = "jeton-de-test"
CODE = "code-initial"


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    return tmp_path


@pytest.fixture
def client(home, monkeypatch):
    monkeypatch.setenv(session_auth.TOKEN_ENV, TOKEN)
    monkeypatch.setenv(session_auth.BOOTSTRAP_ENV, CODE)
    monkeypatch.setenv("BACKEND_PORT", "8123")
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/api/data")
    def data():
        return {"secret": 42}

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        await socket.send_text("ok")
        await socket.close()

    assert session_auth.install_session_auth(app)
    return TestClient(app)


def test_requete_sans_jeton_refusee(client):
    assert client.get("/api/data").status_code == 401


def test_sonde_health_publique(client):
    assert client.get("/health").status_code == 200


def test_en_tete_valide_accepte(client):
    r = client.get("/api/data", headers={"X-VN-Token": TOKEN})
    assert r.status_code == 200 and r.json() == {"secret": 42}


def test_mauvais_jeton_refuse(client):
    assert client.get("/api/data", headers={"X-VN-Token": "autre"}).status_code == 401


def test_cookie_valide_accepte(client):
    client.cookies.set("vn_8123", TOKEN)
    assert client.get("/api/data").status_code == 200


def test_cookie_d_une_autre_instance_ignore(client):
    client.cookies.set("vn_9999", TOKEN)
    assert client.get("/api/data").status_code == 401


def test_preflight_options_passe(client):
    assert client.options("/api/data").status_code != 401


def test_websocket_sans_jeton_refuse(client):
    with pytest.raises(Exception):
        with client.websocket_connect("/ws") as ws:
            ws.receive_text()


def test_websocket_avec_jeton(client):
    with client.websocket_connect("/ws", headers={"X-VN-Token": TOKEN}) as ws:
        assert ws.receive_text() == "ok"


def test_code_initial_pose_le_cookie_une_seule_fois(client):
    r = client.get(f"{session_auth.BOOTSTRAP_PATH}?code={CODE}", follow_redirects=False)
    assert r.status_code == 302
    set_cookie = r.headers["set-cookie"]
    assert "vn_8123=" in set_cookie and "HttpOnly" in set_cookie and "SameSite=Strict" in set_cookie
    assert client.get("/api/data").status_code == 200
    client.cookies.clear()
    again = client.get(f"{session_auth.BOOTSTRAP_PATH}?code={CODE}", follow_redirects=False)
    assert again.status_code == 403


def test_code_demande_par_le_lanceur(client):
    assert client.post(session_auth.BOOTSTRAP_CODE_PATH).status_code == 401
    r = client.post(session_auth.BOOTSTRAP_CODE_PATH, headers={"X-VN-Token": TOKEN})
    code = r.json()["code"]
    ok = client.get(f"{session_auth.BOOTSTRAP_PATH}?code={code}", follow_redirects=False)
    assert ok.status_code == 302


def test_next_interne_uniquement(client):
    def location(nxt: str) -> str:
        code = client.post(session_auth.BOOTSTRAP_CODE_PATH, headers={"X-VN-Token": TOKEN}).json()["code"]
        r = client.get(session_auth.BOOTSTRAP_PATH, params={"code": code, "next": nxt}, follow_redirects=False)
        return r.headers["location"]

    assert location("/api/training/run1/artifact/a.png") == "/api/training/run1/artifact/a.png"
    assert location("//site-externe.example/x") == "/"
    assert location("https://site-externe.example/") == "/"


def test_jeton_publie_pour_les_appels_sortants(client):
    assert session_auth.token_for_port(8123) == TOKEN
    assert session_auth.outbound_headers("http://127.0.0.1:8123/api/x") == {"x-vn-token": TOKEN}
    assert session_auth.outbound_headers("http://localhost:8123/api/x") == {"x-vn-token": TOKEN}
    # Jamais vers un hote distant, meme sur un port connu.
    assert session_auth.outbound_headers("http://10.0.0.5:8123/api/x") == {}
    assert session_auth.outbound_headers("http://127.0.0.1:7000/api/x") == {}


def test_sans_jeton_le_backend_reste_ouvert(home, monkeypatch):
    monkeypatch.delenv(session_auth.TOKEN_ENV, raising=False)
    app = FastAPI()

    @app.get("/api/data")
    def data():
        return {"secret": 42}

    assert not session_auth.install_session_auth(app)
    assert TestClient(app).get("/api/data").status_code == 200


def test_new_session_env_desactivable(monkeypatch):
    monkeypatch.setenv(session_auth.AUTH_SWITCH_ENV, "0")
    assert session_auth.new_session_env() == {}
    monkeypatch.setenv(session_auth.AUTH_SWITCH_ENV, "1")
    env = session_auth.new_session_env()
    assert len(env[session_auth.TOKEN_ENV]) >= 40 and env[session_auth.BOOTSTRAP_ENV]
