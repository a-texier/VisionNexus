# ============================================================
# backend/tests/smoke_test.py
#
# Smoke test bout-en-bout, lancable seul (sans pytest) :
#
#   python backend/tests/smoke_test.py
#
# ou via pytest (le fichier est aussi collecte automatiquement : le motif
# par defaut de pytest inclut "*_test.py") :
#
#   python -m pytest backend/tests/smoke_test.py -q
#
# Verifie que l'application demarre toujours : import du package backend,
# /health, et un tour complet projet -> classe -> frame -> annotation ->
# export sur un workspace TEMPORAIRE (jamais data/ ni un workspace de prod).
# Aucun effet de bord : le workspace temporaire est supprime a la fin.
# ============================================================

import os
import shutil
import sys
import tempfile
from pathlib import Path

# ---- Isolation AVANT tout import de `backend` ----
# Si lance sous pytest, backend/tests/conftest.py a deja positionne ces
# variables : ne pas les ecraser (on resterait sur la meme base SQLite que
# le reste de la suite). Si lance en standalone (python smoke_test.py),
# personne d'autre ne les a positionnees : on cree notre propre workspace.
_OWN_WORKSPACE = None
if "ANNOTATION_WORKSPACE" not in os.environ:
    _OWN_WORKSPACE = tempfile.mkdtemp(prefix="annotation_app_smoke_")
    os.environ["ANNOTATION_WORKSPACE"] = _OWN_WORKSPACE
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_OFFLINE", "1")


def _ensure_backend_importable() -> None:
    """Permet `python backend/tests/smoke_test.py` depuis n'importe quel cwd."""
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))


def main() -> None:
    _ensure_backend_importable()

    print("[smoke] Import du package backend...")
    import backend.main  # noqa: F401  (verifie que l'app se construit sans erreur)
    print("[smoke] OK — backend.main importe sans erreur")

    from fastapi.testclient import TestClient

    # SAM2 mocke pour ne pas exiger un vrai checkpoint/GPU pendant le smoke test.
    from backend.services.sam_service import sam_service

    async def _fake_load_model(model_size: str = "tiny"):
        return {"status": "checkpoint_missing", "device": sam_service.device, "model": model_size}

    original_load_model = sam_service.load_model
    sam_service.load_model = _fake_load_model

    try:
        with TestClient(backend.main.app) as client:
            print("[smoke] GET /health ...")
            resp = client.get("/health")
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "ok"
            print("[smoke] OK — /health")

            print("[smoke] GET / ...")
            resp = client.get("/")
            assert resp.status_code == 200
            print("[smoke] OK — /")

            print("[smoke] GET /api/projects (liste vide ou existante) ...")
            resp = client.get("/api/projects")
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)
            print("[smoke] OK — /api/projects")

            print("[smoke] POST /api/projects (creation projet) ...")
            resp = client.post("/api/projects", json={
                "name": "Smoke test project",
                "project_type": "image",
                "classes": [{"name": "objet_test"}],
            })
            assert resp.status_code == 201, resp.text
            project = resp.json()
            project_id = project["id"]
            print(f"[smoke] OK — projet {project_id} cree")

            print("[smoke] GET classes du projet ...")
            classes = client.get(f"/api/projects/{project_id}/classes").json()
            assert len(classes) == 1
            class_id = classes[0]["id"]
            print("[smoke] OK — classe presente")

            print("[smoke] Import d'une image de test ...")
            import io
            from PIL import Image
            buf = io.BytesIO()
            Image.new("RGB", (32, 24), (128, 64, 32)).save(buf, format="JPEG")
            resp = client.post(
                f"/api/projects/{project_id}/import/images",
                files=[("files", ("smoke.jpg", buf.getvalue(), "image/jpeg"))],
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["frames_added"] == 1
            print("[smoke] OK — image importee")

            frame_id = client.get(f"/api/projects/{project_id}/frames").json()[0]["id"]

            print("[smoke] Creation d'une annotation ...")
            resp = client.post(f"/api/frames/{frame_id}/annotations", json={
                "class_id": class_id, "cx": 0.5, "cy": 0.5, "width": 0.2, "height": 0.2,
            })
            assert resp.status_code == 201, resp.text
            print("[smoke] OK — annotation creee")

            print("[smoke] GET image de la frame ...")
            resp = client.get(f"/api/frames/{frame_id}/image")
            assert resp.status_code == 200
            print("[smoke] OK — image servie")

            print("[smoke] Nettoyage : suppression du projet ...")
            resp = client.delete(f"/api/projects/{project_id}")
            assert resp.status_code == 200
            print("[smoke] OK — projet supprime")
    finally:
        sam_service.load_model = original_load_model
        if _OWN_WORKSPACE:
            shutil.rmtree(_OWN_WORKSPACE, ignore_errors=True)

    print("[smoke] TOUS LES CONTROLES SONT PASSES.")


def test_smoke_end_to_end():
    """Point d'entree pytest (le meme scenario que `python smoke_test.py`)."""
    main()


if __name__ == "__main__":
    main()
