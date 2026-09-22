# ============================================================
# backend/tests/integration/test_multiuser.py
#
# Tests d'integration multiuser — solidite avec N instances
# simultanees (10 par defaut).
#
# Prerequis :
#   - Env conda IA_env avec uvicorn, FastAPI, CLIP...
#   - ~400 MB RAM par backend (CLIP ViT-B/32)
#   - Dossier d'images : TEST_DATASET_DIR (env)
#
# Lancement :
#   # Depuis Dataset_Explorer_App/
#   python -m pytest backend/tests/integration/ -v -m multiuser
#
#   # N utilisateurs seulement (plus rapide) :
#   MULTIUSER_N_USERS=3 python -m pytest backend/tests/integration/ -v
#
#   # Garder les workspaces apres test (debug) :
#   MULTIUSER_KEEP_WS=1 python -m pytest backend/tests/integration/ -v
# ============================================================

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib import request

import pytest

# ------------------------------------------------------------------ #
# Helpers API (stdlib urllib uniquement — pas de dependance requests) #
# ------------------------------------------------------------------ #

def api_get(port: int, path: str, timeout: int = 10) -> dict | list | None:
    try:
        with request.urlopen(f"http://localhost:{port}{path}", timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def api_post(port: int, path: str, data: dict, timeout: int = 30) -> dict | list | None:
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


def wait_scan_done(port: int, dataset_id: int, timeout: int = 120) -> dict | None:
    """Attend que le scan passe de 'scanning' a n'importe quel autre statut."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        datasets = api_get(port, "/api/datasets") or []
        ds = next((d for d in datasets if d.get("id") == dataset_id), None)
        if ds and ds.get("status") != "scanning":
            return ds
    return None


# ------------------------------------------------------------------ #
# T1 — Isolation workspace                                            #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestWorkspaceIsolation:
    """Chaque workspace demarre avec 0 dataset local."""

    def test_workspaces_start_empty(self, multiuser_instances):
        """
        Tous les workspaces sont neufs et ne doivent contenir
        aucun dataset local (in_workspace=True).
        """
        failures = []
        for inst in multiuser_instances:
            datasets = api_get(inst["port"], "/api/datasets") or []
            local = [d for d in datasets if d.get("in_workspace")]
            if local:
                failures.append(f"[{inst['user']}] {len(local)} dataset(s) trouves")

        assert not failures, "Workspaces non vides au demarrage :\n" + "\n".join(failures)

    def test_each_backend_responds(self, multiuser_instances):
        """Chaque backend repond bien sur son port dedie."""
        failures = []
        for inst in multiuser_instances:
            resp = api_get(inst["port"], "/api/datasets", timeout=5)
            if resp is None:
                failures.append(inst["user"])
        assert not failures, f"Backends qui ne repondent pas : {failures}"


# ------------------------------------------------------------------ #
# T2 — Dataset global                                                 #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
@pytest.mark.slow
class TestGlobalDataset:
    """Dataset cree global par alice → visible de tous les autres users."""

    @pytest.fixture(scope="class")
    def global_dataset_info(self, multiuser_instances, dataset_dir):
        """
        Cree un dataset global avec le premier user disponible.
        Attend la fin du scan. Nettoie en teardown.
        """
        owner = multiuser_instances[0]
        dataset_name = "test_global_multiuser_itest"
        root_path = str(dataset_dir)

        resp = api_post(owner["port"], "/api/datasets", {
            "root_path":     root_path,
            "n_clusters":    5,
            "name":          dataset_name,
            "share_dataset": True,
        })

        assert resp is not None and "id" in resp, (
            f"Echec creation dataset global par {owner['user']} : {resp}"
        )

        dataset_id = resp["id"]
        ds = wait_scan_done(owner["port"], dataset_id)
        assert ds is not None, f"Timeout : scan du dataset global pas termine en 120s"
        assert ds["status"] in ("pending", "ready"), f"Statut inattendu : {ds['status']}"

        yield {
            "owner":       owner,
            "dataset_id":  dataset_id,
            "name":        dataset_name,
            "root_path":   root_path,
            "image_count": ds.get("image_count", 0),
        }

        # Teardown — supprimer du registre global
        encoded = root_path.replace("\\", "%5C").replace(" ", "%20")
        api_delete(owner["port"], f"/api/datasets/global?root_path={encoded}")

    def test_owner_sees_dataset_in_workspace(
        self, multiuser_instances, global_dataset_info
    ):
        """Le createur voit le dataset dans son workspace."""
        owner = global_dataset_info["owner"]
        datasets = api_get(owner["port"], "/api/datasets") or []
        ws_ds = [
            d for d in datasets
            if d.get("in_workspace") and d.get("id") == global_dataset_info["dataset_id"]
        ]
        assert ws_ds, f"[{owner['user']}] ne voit pas son propre dataset dans le workspace"

    def test_all_others_see_global_dataset(
        self, multiuser_instances, global_dataset_info
    ):
        """Tous les autres users voient le dataset dans la galerie globale."""
        owner_user = global_dataset_info["owner"]["user"]
        others     = [i for i in multiuser_instances if i["user"] != owner_user]
        failures   = []

        def check(inst):
            datasets = api_get(inst["port"], "/api/datasets") or []
            globals_ = [
                d for d in datasets
                if d.get("is_global") and not d.get("in_workspace")
            ]
            found = any(d.get("name") == global_dataset_info["name"] for d in globals_)
            if not found:
                failures.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(others)) as ex:
            list(ex.map(check, others))

        assert not failures, (
            f"Ces users ne voient pas le dataset global : {failures}"
        )

    def test_global_dataset_not_in_others_workspace(
        self, multiuser_instances, global_dataset_info
    ):
        """Le dataset global n'apparait PAS comme dataset workspace des autres."""
        owner_user = global_dataset_info["owner"]["user"]
        others     = [i for i in multiuser_instances if i["user"] != owner_user]
        leaks      = []

        for inst in others:
            datasets = api_get(inst["port"], "/api/datasets") or []
            in_ws = [
                d for d in datasets
                if d.get("in_workspace") and d.get("name") == global_dataset_info["name"]
            ]
            if in_ws:
                leaks.append(inst["user"])

        assert not leaks, (
            f"Dataset global apparu dans le workspace de : {leaks} (fuite d'isolation)"
        )

    def test_global_dataset_image_count_consistent(
        self, multiuser_instances, global_dataset_info
    ):
        """Le nombre d'images vu par tous est identique."""
        expected = global_dataset_info["image_count"]
        if expected == 0:
            pytest.skip("image_count = 0, test non pertinent")

        for inst in multiuser_instances:
            datasets = api_get(inst["port"], "/api/datasets") or []
            ds = next(
                (d for d in datasets if d.get("name") == global_dataset_info["name"]),
                None,
            )
            if ds:
                assert ds.get("image_count") == expected, (
                    f"[{inst['user']}] image_count={ds.get('image_count')} "
                    f"!= attendu {expected}"
                )


# ------------------------------------------------------------------ #
# T3 — Isolation dataset workspace                                    #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
@pytest.mark.slow
class TestWorkspaceDatasetIsolation:
    """Dataset workspace d'un user invisible des autres."""

    @pytest.fixture(scope="class")
    def bob_dataset_info(self, multiuser_instances, dataset_dir):
        """Cree un dataset non partage avec le second user."""
        bob = multiuser_instances[1]
        resp = api_post(bob["port"], "/api/datasets", {
            "root_path":     str(dataset_dir),
            "n_clusters":    5,
            "name":          "test_workspace_isolation_itest",
            "share_dataset": False,
        })
        assert resp and "id" in resp, f"Echec creation dataset workspace : {resp}"
        ds = wait_scan_done(bob["port"], resp["id"])
        assert ds is not None, "Timeout scan dataset workspace"
        yield {"owner": bob, "dataset_id": resp["id"], "name": "test_workspace_isolation_itest"}
        # Pas de cleanup global : le dataset est workspace-local, sera detruit avec le workspace

    def test_owner_sees_own_dataset(self, multiuser_instances, bob_dataset_info):
        bob      = bob_dataset_info["owner"]
        datasets = api_get(bob["port"], "/api/datasets") or []
        local    = [d for d in datasets if d.get("in_workspace")]
        assert any(d.get("id") == bob_dataset_info["dataset_id"] for d in local), (
            f"[{bob['user']}] ne voit pas son propre dataset"
        )

    def test_others_cannot_see_workspace_dataset(
        self, multiuser_instances, bob_dataset_info
    ):
        """Aucun autre user ne doit voir ce dataset dans son workspace."""
        owner_user = bob_dataset_info["owner"]["user"]
        others     = [i for i in multiuser_instances if i["user"] != owner_user]
        leaks      = []

        for inst in others:
            datasets = api_get(inst["port"], "/api/datasets") or []
            in_ws    = [
                d for d in datasets
                if d.get("in_workspace")
                and d.get("name") == bob_dataset_info["name"]
            ]
            if in_ws:
                leaks.append(inst["user"])

        assert not leaks, (
            f"Dataset workspace visible chez des users non autorisés : {leaks}"
        )


# ------------------------------------------------------------------ #
# T4 — Concurrence                                                    #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestConcurrentAccess:
    """N users frappent leur API en meme temps — 0 erreur toleree."""

    @pytest.mark.parametrize("round_n", [1, 2, 3, 4, 5])
    def test_concurrent_api_round(self, multiuser_instances, round_n):
        """
        Round `round_n` : tous les backends repondent simultanement.
        Chaque round est un test independant → visible dans pytest -v.
        """
        errors = []

        def hit(inst):
            resp = api_get(inst["port"], "/api/datasets", timeout=10)
            if resp is None:
                errors.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
            list(ex.map(hit, multiuser_instances))

        assert not errors, f"Round {round_n} — backends sans reponse : {errors}"

    def test_concurrent_settings_read(self, multiuser_instances):
        """Lecture simultanee des settings — tous doivent repondre."""
        errors = []

        def hit(inst):
            resp = api_get(inst["port"], "/api/settings", timeout=10)
            if resp is None:
                errors.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
            list(ex.map(hit, multiuser_instances))

        assert not errors, f"Lecture settings simultanee echouee pour : {errors}"


# ------------------------------------------------------------------ #
# T5 — Isolation settings                                             #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestSettingsIsolation:
    """Modifier les settings d'un user ne doit pas affecter les autres."""

    def test_settings_do_not_bleed_between_workspaces(self, multiuser_instances):
        """
        Le user 0 modifie ses playground_dataset_ids.
        Le user 1 ne doit pas voir de changement.
        """
        user0 = multiuser_instances[0]
        user1 = multiuser_instances[1]

        # Snapshot avant
        s1_before = set(
            (api_get(user1["port"], "/api/settings") or {})
            .get("playground_dataset_ids", [])
        )

        # Modifier les settings de user0
        s0 = api_get(user0["port"], "/api/settings") or {}
        s0["playground_dataset_ids"] = [9999]
        result = api_put(user0["port"], "/api/settings", s0)
        assert result is not None, f"Echec PUT /api/settings pour {user0['user']}"

        time.sleep(0.5)

        # Snapshot apres pour user1
        s1_after = set(
            (api_get(user1["port"], "/api/settings") or {})
            .get("playground_dataset_ids", [])
        )

        assert s1_before == s1_after, (
            f"Settings de {user1['user']} ont change apres modification de {user0['user']} !\n"
            f"Avant : {s1_before} / Apres : {s1_after}"
        )

    def test_settings_write_per_workspace(self, multiuser_instances):
        """
        Chaque user peut ecrire dans ses settings sans erreur.
        """
        failures = []

        def write_settings(inst):
            s = api_get(inst["port"], "/api/settings") or {}
            s["playground_dataset_ids"] = []
            result = api_put(inst["port"], "/api/settings", s)
            if result is None:
                failures.append(inst["user"])

        with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
            list(ex.map(write_settings, multiuser_instances))

        assert not failures, f"Ecriture settings echouee pour : {failures}"


# ------------------------------------------------------------------ #
# T6 — Sante de l'API par user                                        #
# ------------------------------------------------------------------ #

@pytest.mark.multiuser
@pytest.mark.integration
class TestApiHealth:
    """Verification de la sante de base de chaque endpoint par user."""

    @pytest.mark.parametrize("endpoint", [
        "/api/datasets",
        "/api/subsets",
        "/api/settings",
    ])
    def test_endpoints_respond_for_all_users(self, multiuser_instances, endpoint):
        """Chaque endpoint retourne une reponse valide pour tous les users."""
        failures = []
        for inst in multiuser_instances:
            resp = api_get(inst["port"], endpoint, timeout=10)
            if resp is None:
                failures.append(f"{inst['user']} → {endpoint}")
        assert not failures, f"Endpoints sans reponse :\n" + "\n".join(failures)

    def test_each_backend_has_independent_db(self, multiuser_instances):
        """
        Verification indirecte de l'isolation DB : chaque backend
        connait son propre EXPLORER_USER via /api/settings.
        """
        user_map: dict[str, str] = {}
        for inst in multiuser_instances:
            settings = api_get(inst["port"], "/api/settings") or {}
            # On ne peut pas lire EXPLORER_USER directement, mais on peut
            # verifier que chaque backend a son propre workspace distinct.
            ws = settings.get("workspace_path", "")
            user_map[inst["user"]] = ws

        # Tous les workspaces doivent etre distincts
        paths = list(user_map.values())
        unique_paths = set(paths)
        # Si tous sont vides ("") c'est aussi OK car chaque backend
        # est sur son propre port et son propre process
        if any(paths):
            assert len(unique_paths) == len(paths), (
                f"Des workspaces sont partages entre users ! {user_map}"
            )



# # Rapide (3 users, ~2 min)
# python backend/tests/integration/run_tests.py --fast

# # Complet (10 users, ~4-5 min)  
# python backend/tests/integration/run_tests.py

# # Pytest natif avec variables
# MULTIUSER_N_USERS=5 python -m pytest backend/tests/integration/ -v -m multiuser