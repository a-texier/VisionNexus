# ============================================================
# backend/tests/integration/test_multiuser.py — Annotation App
#
# Tests d'integration multiuser — N instances simultanees.
#
# Lancement :
#   # Depuis Annotation_App/
#   python -m pytest backend/tests/integration/ -v -m multiuser
#
#   # Rapide (3 users) :
#   MULTIUSER_N_USERS=3 python -m pytest backend/tests/integration/ -v -m multiuser
# ============================================================

import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib import request

import pytest

# ------------------------------------------------------------------ #
# Helpers API                                                         #
# ------------------------------------------------------------------ #

def api_get(port: int, path: str, timeout: int = 10) -> dict | list | None:
    try:
        with request.urlopen(f"http://localhost:{port}{path}", timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def api_post(port: int, path: str, data: dict, timeout: int = 15) -> dict | list | None:
    body = json.dumps(data).encode()
    req  = request.Request(
        f"http://localhost:{port}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def api_put(port: int, path: str, data: dict, timeout: int = 10) -> dict | list | None:
    body = json.dumps(data).encode()
    req  = request.Request(
        f"http://localhost:{port}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def api_delete(port: int, path: str, timeout: int = 10) -> bool:
    req = request.Request(f"http://localhost:{port}{path}", method="DELETE")
    try:
        with request.urlopen(req, timeout=timeout) as r:
            return True
    except Exception:
        return False


# ------------------------------------------------------------------ #
# T1 — Sante de base                                                  #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestHealth:
    """Chaque backend repond sur /health et les endpoints principaux."""

    def test_health_all_backends(self, multiuser_instances):
        """GET /health repond pour chaque instance."""
        failures = []
        for inst in multiuser_instances:
            resp = api_get(inst["port"], "/health", timeout=5)
            if resp is None:
                failures.append(inst["user"])
        assert not failures, f"Backends sans reponse sur /health : {failures}"

    def test_health_status_ok(self, multiuser_instances):
        """Le champ 'status' vaut 'ok' pour tous les backends."""
        failures = []
        for inst in multiuser_instances:
            resp = api_get(inst["port"], "/health", timeout=5) or {}
            if resp.get("status") != "ok":
                failures.append(f"{inst['user']} → status={resp.get('status')!r}")
        assert not failures, f"Status != 'ok' :\n" + "\n".join(failures)

    @pytest.mark.parametrize("endpoint", [
        "/api/projects",
        "/api/settings",
        "/api/workspace/info",
    ])
    def test_endpoints_respond_for_all_users(self, multiuser_instances, endpoint):
        """Chaque endpoint repond pour tous les users."""
        failures = []
        for inst in multiuser_instances:
            resp = api_get(inst["port"], endpoint, timeout=8)
            if resp is None:
                failures.append(f"{inst['user']} → {endpoint}")
        assert not failures, "Endpoints sans reponse :\n" + "\n".join(failures)


# ------------------------------------------------------------------ #
# T2 — Isolation workspace (projects)                                 #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestWorkspaceIsolation:
    """Chaque workspace demarre sans project."""

    def test_workspaces_start_empty(self, multiuser_instances):
        """Aucun workspace ne contient de projects au demarrage."""
        failures = []
        for inst in multiuser_instances:
            projects = api_get(inst["port"], "/api/projects") or []
            if projects:
                failures.append(f"[{inst['user']}] {len(projects)} project(s)")
        assert not failures, "Workspaces non vides :\n" + "\n".join(failures)

    def test_each_workspace_has_independent_db(self, multiuser_instances):
        """
        Les infos workspace (chemin) sont toutes distinctes.
        Garantit qu'aucun backend ne partage la meme DB.
        """
        ws_paths = []
        for inst in multiuser_instances:
            info = api_get(inst["port"], "/api/workspace/info") or {}
            ws_paths.append(info.get("path", ""))

        non_empty = [p for p in ws_paths if p]
        if non_empty:
            assert len(set(non_empty)) == len(non_empty), (
                f"Des workspaces partagent le meme chemin : {ws_paths}"
            )


# ------------------------------------------------------------------ #
# T3 — Isolation des projects                                         #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestProjectIsolation:
    """Un project cree par un user ne doit pas etre visible des autres."""

    @pytest.fixture(scope="class")
    def alice_project(self, multiuser_instances):
        """Cree un project image chez alice, yield son id, nettoie en teardown."""
        alice = multiuser_instances[0]
        resp = api_post(alice["port"], "/api/projects", {
            "name": "test_isolation_alice",
            "type": "image",
        })
        assert resp and "id" in resp, f"Echec creation project : {resp}"
        project_id = resp["id"]
        yield {"owner": alice, "project_id": project_id}
        api_delete(alice["port"], f"/api/projects/{project_id}")

    def test_owner_sees_own_project(self, multiuser_instances, alice_project):
        alice    = alice_project["owner"]
        projects = api_get(alice["port"], "/api/projects") or []
        ids      = [p["id"] for p in projects]
        assert alice_project["project_id"] in ids, "Alice ne voit pas son propre project"

    def test_others_cannot_see_alice_project(self, multiuser_instances, alice_project):
        """Aucun autre user ne doit voir le project d'alice."""
        owner_user = alice_project["owner"]["user"]
        others     = [i for i in multiuser_instances if i["user"] != owner_user]
        leaks      = []

        for inst in others:
            projects = api_get(inst["port"], "/api/projects") or []
            names    = [p.get("name") for p in projects]
            if "test_isolation_alice" in names:
                leaks.append(inst["user"])

        assert not leaks, f"Project d'alice visible chez : {leaks} (fuite d'isolation)"

    def test_two_users_create_independent_projects(self, multiuser_instances):
        """
        Alice et bob creent chacun un project.
        Chacun ne voit que le sien.
        """
        alice = multiuser_instances[0]
        bob   = multiuser_instances[1]

        r_alice = api_post(alice["port"], "/api/projects", {
            "name": "test_independent_alice", "type": "image"
        })
        r_bob = api_post(bob["port"], "/api/projects", {
            "name": "test_independent_bob", "type": "image"
        })

        assert r_alice and "id" in r_alice, "Echec creation project alice"
        assert r_bob   and "id" in r_bob,   "Echec creation project bob"

        try:
            alice_projects = [p["name"] for p in (api_get(alice["port"], "/api/projects") or [])]
            bob_projects   = [p["name"] for p in (api_get(bob["port"],   "/api/projects") or [])]

            assert "test_independent_alice" in alice_projects, "Alice ne voit pas son project"
            assert "test_independent_bob"   in bob_projects,   "Bob ne voit pas son project"
            assert "test_independent_bob"   not in alice_projects, "Alice voit le project de bob!"
            assert "test_independent_alice" not in bob_projects,   "Bob voit le project d'alice!"
        finally:
            api_delete(alice["port"], f"/api/projects/{r_alice['id']}")
            api_delete(bob["port"],   f"/api/projects/{r_bob['id']}")


# ------------------------------------------------------------------ #
# T4 — Concurrence                                                    #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestConcurrentAccess:
    """N users frappent l'API en meme temps — 0 erreur."""

    @pytest.mark.parametrize("round_n", [1, 2, 3, 4, 5])
    def test_concurrent_api_round(self, multiuser_instances, round_n):
        """Round `round_n` : tous les backends repondent simultanement."""
        errors = []

        def hit(inst):
            if api_get(inst["port"], "/api/projects", timeout=10) is None:
                errors.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
            list(ex.map(hit, multiuser_instances))

        assert not errors, f"Round {round_n} — backends sans reponse : {errors}"

    def test_concurrent_project_creation(self, multiuser_instances):
        """
        Tous les users creent un project simultanément.
        Chacun doit voir le sien — aucune collision d'ID.
        """
        created = {}
        errors  = []

        def create_project(inst):
            resp = api_post(inst["port"], "/api/projects", {
                "name": f"concurrent_{inst['user']}",
                "type": "image",
            })
            if resp and "id" in resp:
                created[inst["user"]] = resp["id"]
            else:
                errors.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
            list(ex.map(create_project, multiuser_instances))

        assert not errors, f"Echec creation project concurrent pour : {errors}"

        # Nettoyage + verification isolation
        isolation_errors = []
        for inst in multiuser_instances:
            user   = inst["user"]
            pid    = created.get(user)
            if pid is None:
                continue
            # Chaque user ne doit voir QUE son project (les autres workspaces sont isolés)
            projects = api_get(inst["port"], "/api/projects") or []
            names    = [p.get("name") for p in projects]
            for other_user in created:
                if other_user != user and f"concurrent_{other_user}" in names:
                    isolation_errors.append(f"{user} voit le project de {other_user}")
            # Nettoyer
            api_delete(inst["port"], f"/api/projects/{pid}")

        assert not isolation_errors, "Fuites d'isolation :\n" + "\n".join(isolation_errors)


# ------------------------------------------------------------------ #
# T5 — Isolation des settings                                         #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestSettingsIsolation:
    """Les settings sont propres a chaque workspace."""

    def test_settings_do_not_bleed(self, multiuser_instances):
        """
        Alice modifie un champ de ses settings.
        Bob ne doit pas voir ce changement.
        """
        alice = multiuser_instances[0]
        bob   = multiuser_instances[1]

        # Snapshot avant
        bob_settings_before = api_get(bob["port"], "/api/settings") or {}

        # Modifier les settings d'alice
        alice_settings = api_get(alice["port"], "/api/settings") or {}
        alice_settings["show_minimap"] = not alice_settings.get("show_minimap", True)

        result = api_put(alice["port"], "/api/settings", alice_settings)
        assert result is not None, f"Echec PUT /api/settings pour {alice['user']}"

        time.sleep(0.5)

        # Verifier que bob n'a pas change
        bob_settings_after = api_get(bob["port"], "/api/settings") or {}
        assert bob_settings_before == bob_settings_after, (
            f"Settings de bob ont change apres modification d'alice !\n"
            f"Avant : {bob_settings_before}\nApres : {bob_settings_after}"
        )

    def test_settings_write_concurrent(self, multiuser_instances):
        """Tous les users ecrivent leurs settings simultanement — 0 erreur."""
        errors = []

        def write(inst):
            s = api_get(inst["port"], "/api/settings") or {}
            if api_put(inst["port"], "/api/settings", s) is None:
                errors.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
            list(ex.map(write, multiuser_instances))

        assert not errors, f"Echec ecriture settings concurrent pour : {errors}"
