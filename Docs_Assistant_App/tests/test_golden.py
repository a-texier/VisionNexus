"""Verifie que le jeu de questions de reference reste coherent avec la doc reelle.

Le score de recherche se mesure avec scripts/evaluate.py (vrai modele) ; ici on garantit
seulement que chaque section attendue existe encore, aux memes numeros en FR et en EN.
Ignore quand la doc du depot n'est pas disponible (bundle sans docs).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.core.chunker import scan_headings
from backend.core.sources import scan_sources

REPO_ROOT = Path(__file__).resolve().parents[2]
GOLDEN = json.loads((Path(__file__).parent / "golden.json").read_text(encoding="utf-8"))["questions"]


def test_golden_shape_and_balance() -> None:
    assert len(GOLDEN) >= 40
    ids = [q["id"] for q in GOLDEN]
    assert len(ids) == len(set(ids))
    assert sum(q["q_lang"] == "fr" for q in GOLDEN) >= 20
    assert sum(q["q_lang"] == "en" for q in GOLDEN) >= 20
    cross = [q for q in GOLDEN if q["q_lang"] != q["search_lang"]]
    assert len(cross) >= 8
    assert {q["q_lang"] for q in cross} == {"fr", "en"}  # les deux sens
    assert {q["expect"]["app"] for q in GOLDEN} == {
        "annotation",
        "explorer",
        "orchestrator",
        "training",
        "inference",
        "optuna",
        "mlflow",
        "dvc",
        "suite",
        "docs",
    }
    assert {q["audience"] for q in GOLDEN} == {"user", "dev"}
    for q in GOLDEN:
        assert q["search_lang"] in ("fr", "en") and q["q_lang"] in ("fr", "en")
        assert q["q"].strip() and {"app", "doc", "heading_idx", "heading"} <= set(q["expect"])


@pytest.mark.skipif(
    not (REPO_ROOT / "docs" / "docs_manifest.json").is_file(), reason="docs du depot absentes"
)
def test_expected_sections_exist_in_both_languages() -> None:
    docs = {(d.app, d.doc_name, d.lang): d for d in scan_sources(REPO_ROOT)}
    problems: list[str] = []
    for q in GOLDEN:
        exp = q["expect"]
        indexes = exp["heading_idx"] if isinstance(exp["heading_idx"], list) else [exp["heading_idx"]]
        for lang in ("en", "fr"):
            doc = docs.get((exp["app"], exp["doc"], lang))
            if doc is None:
                problems.append(f"{q['id']}: page {exp['app']}/{exp['doc']} absente en {lang}")
                continue
            headings = scan_headings(doc.body)
            for idx in indexes:
                if idx >= len(headings):
                    problems.append(f"{q['id']}: pas de titre #{idx} en {lang}")
                elif (
                    lang == "en"
                    and exp["heading"].lower() not in headings[idx].text.lower()
                    and len(indexes) == 1
                ):
                    found = headings[idx].text
                    problems.append(
                        f"{q['id']}: le titre EN #{idx} est '{found}', attendu '{exp['heading']}'"
                    )
    assert not problems, "\n".join(problems)
