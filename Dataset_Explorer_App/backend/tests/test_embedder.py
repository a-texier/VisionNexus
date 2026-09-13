# ============================================================
# tests/test_embedder.py
# Tests unitaires : CLIPEmbedder.
# ============================================================

import hashlib
import io
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest
from PIL import Image as PILImage

from backend.core.embedder import CLIPEmbedder

TEST_DATASET_DIR = Path(
    os.environ.get(
        "TEST_DATASET_DIR",
        str(Path(__file__).parent.parent.parent.parent / "Annotation_App" / "data_test" / "test dev" / "img"),
    )
)


@pytest.fixture(scope="module")
def embedder():
    """Charge CLIP une seule fois pour tous les tests du module."""
    e = CLIPEmbedder()
    e.load()
    return e


@pytest.fixture(scope="module")
def dummy_image_path(tmp_path_factory):
    """Image factice 224×224 pour les tests rapides."""
    tmp = tmp_path_factory.mktemp("imgs")
    img_path = tmp / "dummy.jpg"
    img = PILImage.new("RGB", (224, 224), color=(128, 64, 32))
    img.save(str(img_path), "JPEG")
    return str(img_path)


# ------------------------------------------------------------------ #

def test_md5_stability(dummy_image_path):
    """Le MD5 d'un même fichier doit être identique entre deux appels."""
    e = CLIPEmbedder()
    md5_1 = e.compute_md5(dummy_image_path)
    md5_2 = e.compute_md5(dummy_image_path)
    assert md5_1 == md5_2
    assert len(md5_1) == 32  # hex MD5


def test_embed_single_image(embedder, dummy_image_path):
    """Vérifie shape (1, 512), dtype float32, norme L2 ≈ 1."""
    vecs = embedder.embed_images([dummy_image_path])
    assert vecs.shape == (1, 512)
    assert vecs.dtype == np.float32
    norm = np.linalg.norm(vecs[0])
    assert abs(norm - 1.0) < 1e-4, f"Norme L2 inattendue : {norm}"


def test_embed_batch(embedder, dummy_image_path):
    """Batch de 5 images identiques → shape (5, 512)."""
    paths = [dummy_image_path] * 5
    vecs = embedder.embed_images(paths, batch_size=2)
    assert vecs.shape == (5, 512)
    # Toutes les lignes identiques (même image)
    for i in range(1, 5):
        diff = np.abs(vecs[i] - vecs[0]).max()
        assert diff < 1e-4, "Vecteurs identiques attendus pour la même image"


def test_thumbnail_generation(embedder, dummy_image_path, tmp_path):
    """Vérifie que la miniature est générée et a les bonnes dimensions."""
    import backend.core.embedder as embedder_mod
    # Rediriger vers un dossier temporaire.
    # embedder.py fait "from backend.config import THUMBS_DIR" (import de valeur,
    # pas du module) : patcher backend.config.THUMBS_DIR ne suffit pas, il faut
    # patcher le nom lie dans le module embedder lui-meme.
    original_thumbs = embedder_mod.THUMBS_DIR
    embedder_mod.THUMBS_DIR = tmp_path
    try:
        md5 = embedder.compute_md5(dummy_image_path)
        url = embedder.generate_thumbnail(dummy_image_path, md5)
        assert url.startswith("/thumbs/")
        thumb_path = tmp_path / f"{md5}.jpg"
        assert thumb_path.exists()
        with PILImage.open(thumb_path) as t:
            assert max(t.size) <= 256
    finally:
        embedder_mod.THUMBS_DIR = original_thumbs


@pytest.mark.skipif(not TEST_DATASET_DIR.exists(), reason="Dataset test absent")
def test_embed_real_images(embedder):
    """Teste sur les vraies images du dataset test (si disponibles)."""
    paths = list(TEST_DATASET_DIR.glob("*.jpg"))[:10]
    assert len(paths) > 0, "Aucune image .jpg dans le dataset test"
    vecs = embedder.embed_images([str(p) for p in paths])
    assert vecs.shape == (len(paths), 512)
    norms = np.linalg.norm(vecs, axis=1)
    assert np.allclose(norms, 1.0, atol=1e-4), "Certains vecteurs ne sont pas L2-normalisés"
