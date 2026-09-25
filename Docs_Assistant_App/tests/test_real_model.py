"""Test optionnel avec les vrais poids (ignore s'ils sont absents). Les scores de
recherche detailles sont dans scripts/evaluate.py."""

from __future__ import annotations

import numpy as np
import pytest

from backend.core.embedder import E5Embedder
from backend.model_paths import DEFAULT_MODEL, missing_files, model_dir

pytestmark = pytest.mark.model


@pytest.fixture(scope="module")
def embedder() -> E5Embedder:
    directory = model_dir(DEFAULT_MODEL)
    if missing_files(directory):
        pytest.skip(f"poids absents : {directory}")
    e = E5Embedder(DEFAULT_MODEL, directory)
    e.load()
    return e


def test_vectors_are_normalised_and_dimension_matches(embedder: E5Embedder) -> None:
    vectors = embedder.embed_passages(["Guide > Export\nExporter le dataset au format YOLO."])
    assert vectors.shape == (1, embedder.dim) and embedder.dim == 384
    assert np.linalg.norm(vectors[0]) == pytest.approx(1.0, abs=1e-4)


def test_french_query_is_closest_to_english_twin(embedder: E5Embedder) -> None:
    passages = embedder.embed_passages(
        [
            "Workflows > Export the dataset\nClick Export in the toolbar and choose the YOLO output format.",
            "Troubleshooting > CUDA out of memory\nReduce the batch size or the image size.",
        ]
    )
    query = embedder.embed_queries(["comment exporter mes annotations au format YOLO ?"])[0]
    scores = passages @ query
    assert scores[0] > scores[1]
