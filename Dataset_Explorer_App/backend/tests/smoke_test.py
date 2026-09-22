#!/usr/bin/env python
# ============================================================
# backend/tests/smoke_test.py
# Smoke test bout-en-bout, lancable seul (sans pytest) :
#   - importe le backend (verifie qu'il n'y a pas d'erreur d'import)
#   - demarre l'app FastAPI (lifespan : DB, migrations, CLIP, FAISS)
#   - tape /health et quelques endpoints principaux en lecture
#   - cree UN dataset ephemere dans un dossier temporaire, verifie le
#     scan, puis le supprime (aucun effet de bord persistant)
#
# Usage :
#   python backend/tests/smoke_test.py
#
# Sortie : code 0 si tout est vert, 1 sinon. Imprime un resume lisible.
# IMPORTANT : force un workspace TEMPORAIRE (EXPLORER_WORKSPACE) avant tout
# import de backend.* — ne touche jamais data/dataset_explorer.db (production).
# ============================================================

import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

# ---- Isolation AVANT tout import backend.* ----
_TEST_WORKSPACE = Path(tempfile.mkdtemp(prefix="dataset_explorer_app_smoketest_"))
os.environ["EXPLORER_WORKSPACE"] = str(_TEST_WORKSPACE)
os.environ.setdefault("EXPLORER_USER", "smoketest")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

_APP_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_APP_ROOT))

_RESULTS: list[tuple[str, bool, str]] = []


def _check(name: str, fn) -> bool:
    try:
        fn()
        _RESULTS.append((name, True, ""))
        print(f"[OK]   {name}")
        return True
    except Exception as exc:
        _RESULTS.append((name, False, f"{type(exc).__name__}: {exc}"))
        print(f"[FAIL] {name} -> {type(exc).__name__}: {exc}")
        traceback.print_exc()
        return False


def main() -> int:
    print("=" * 60)
    print("Dataset Explorer -- smoke test")
    print(f"Workspace temporaire : {_TEST_WORKSPACE}")
    print("=" * 60)

    # ---- 1. Import backend (verifie l'absence d'erreur d'import) ----
    def _import_backend():
        import backend.config  # noqa: F401
        import backend.main  # noqa: F401
        assert str(backend.config.WORKSPACE) == str(_TEST_WORKSPACE), (
            "backend.config n'utilise pas le workspace temporaire attendu "
            "(risque d'ecriture dans data/ de production)"
        )

    if not _check("import backend.main", _import_backend):
        _print_summary()
        return 1

    from fastapi.testclient import TestClient
    from backend.main import app

    dataset_id = None

    with TestClient(app) as client:
        # ---- 2. /health ----
        def _health():
            resp = client.get("/health")
            assert resp.status_code == 200, resp.text
            data = resp.json()
            assert data["status"] == "ok"
            assert data["clip_loaded"] is True, "CLIP non charge au demarrage"

        _check("GET /health", _health)

        # ---- 3. Endpoints principaux en lecture ----
        def _settings():
            resp = client.get("/api/settings")
            assert resp.status_code == 200, resp.text

        _check("GET /api/settings", _settings)

        def _datasets_list():
            resp = client.get("/api/datasets")
            assert resp.status_code == 200, resp.text
            assert isinstance(resp.json(), list)

        _check("GET /api/datasets", _datasets_list)

        def _folders_list():
            resp = client.get("/api/folders")
            assert resp.status_code == 200, resp.text

        _check("GET /api/folders", _folders_list)

        def _subsets_list():
            resp = client.get("/api/subsets")
            assert resp.status_code == 200, resp.text

        _check("GET /api/subsets", _subsets_list)

        def _app_mode():
            resp = client.get("/api/app-mode")
            assert resp.status_code == 200, resp.text
            assert resp.json()["mode"] in ("solo", "orchestrator")

        _check("GET /api/app-mode", _app_mode)

        # ---- 4. Cycle de vie complet d'un dataset ephemere ----
        img_dir = _TEST_WORKSPACE / "_smoketest_images"

        def _create_images():
            from PIL import Image as PILImage
            img_dir.mkdir(parents=True, exist_ok=True)
            for i in range(3):
                PILImage.new("RGB", (16, 16), color=(i * 30, 40, 60)).save(
                    img_dir / f"img{i}.png", "PNG"
                )

        _check("Creation d'images de test", _create_images)

        def _create_and_scan_dataset():
            nonlocal dataset_id
            resp = client.post(
                "/api/datasets",
                json={"root_path": str(img_dir), "name": "smoketest_dataset"},
            )
            assert resp.status_code == 201, resp.text
            dataset_id = resp.json()["id"]

            get_resp = client.get(f"/api/datasets/{dataset_id}")
            assert get_resp.status_code == 200, get_resp.text
            data = get_resp.json()
            assert data["image_count"] == 3, f"image_count={data['image_count']}"
            assert data["status"] == "pending", f"status={data['status']}"

        _check("POST /api/datasets (creation + scan)", _create_and_scan_dataset)

        def _get_dataset_images():
            resp = client.get(f"/api/datasets/{dataset_id}/images")
            assert resp.status_code == 200, resp.text
            assert len(resp.json()["items"]) == 3

        if dataset_id is not None:
            _check("GET /api/datasets/{id}/images", _get_dataset_images)

        def _delete_dataset():
            resp = client.delete(f"/api/datasets/{dataset_id}")
            assert resp.status_code == 200, resp.text
            assert resp.json()["success"] is True

        if dataset_id is not None:
            _check("DELETE /api/datasets/{id} (nettoyage)", _delete_dataset)

    # ---- 5. Nettoyage du workspace temporaire ----
    def _cleanup():
        # Le moteur SQLite (module-level dans backend.db.database) garde le
        # fichier .db ouvert -> le disposer avant rmtree, sinon le dossier
        # temporaire (dataset_explorer.db en WAL) reste partiellement verrouille sur
        # Windows et la suppression echoue silencieusement.
        from backend.db.database import engine
        engine.dispose()
        shutil.rmtree(_TEST_WORKSPACE)
        assert not _TEST_WORKSPACE.exists()

    _check("Nettoyage workspace temporaire", _cleanup)

    return _print_summary()


def _print_summary() -> int:
    print("=" * 60)
    n_ok = sum(1 for _, ok, _ in _RESULTS if ok)
    n_total = len(_RESULTS)
    print(f"Resume : {n_ok}/{n_total} verifications reussies")
    for name, ok, err in _RESULTS:
        status = "OK" if ok else "FAIL"
        line = f"  [{status}] {name}"
        if err:
            line += f" — {err}"
        print(line)
    print("=" * 60)
    all_ok = n_ok == n_total and n_total > 0
    print("SMOKE TEST : SUCCES" if all_ok else "SMOKE TEST : ECHEC")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
