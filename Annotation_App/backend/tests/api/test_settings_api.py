# ============================================================
# Tests API — backend/models/routers/settings.py
# Le service settings_service est un singleton partage (fichier
# user_settings.json unique dans le workspace de test) : chaque test qui
# modifie l'etat le remet a zero (`reset`) pour ne pas polluer les tests
# suivants dans la meme session.
#
# NOTE : /api/workspace/reveal ouvre un vrai explorateur de fichiers
# (subprocess Popen "explorer"/"open"/"xdg-open") -> INTENTIONNELLEMENT
# NON teste ici pour eviter tout effet de bord visible sur la machine.
# ============================================================

import pytest

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _reset_settings_after(client):
    yield
    client.post("/api/settings/reset")


def test_get_settings_returns_defaults_structure(client):
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "interface" in data
    assert "algorithms" in data
    assert "export" in data


def test_update_settings_partial_merge(client):
    resp = client.put("/api/settings", json={"algorithms": {"nms_iou_threshold": 0.42}})
    assert resp.status_code == 200
    assert resp.json()["algorithms"]["nms_iou_threshold"] == pytest.approx(0.42)

    fetched = client.get("/api/settings").json()
    assert fetched["algorithms"]["nms_iou_threshold"] == pytest.approx(0.42)
    # Autres cles de la section conservees
    assert "sam_points_per_side" in fetched["algorithms"]


def test_reset_settings_restores_defaults(client):
    client.put("/api/settings", json={"interface": {"default_tool": "polygon"}})
    resp = client.post("/api/settings/reset")
    assert resp.status_code == 200
    assert resp.json()["interface"]["default_tool"] == "bbox"


def test_workspace_info_returns_existing_path(client):
    resp = client.get("/api/workspace/info")
    assert resp.status_code == 200
    data = resp.json()
    assert data["exists"] is True
    assert len(data["path"]) > 0
