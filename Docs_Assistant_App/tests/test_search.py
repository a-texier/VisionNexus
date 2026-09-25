from __future__ import annotations

from pathlib import Path

import pytest

from backend.core.search import (
    SearchParams,
    SearchService,
    build_match,
    make_snippet,
    query_terms,
    rrf_fuse,
)
from backend.core.store import Store
from backend.core.sync import SyncManager
from tests.helpers import FakeEmbedder, page, prose

NASTY = [
    'it\'s a "quote" -dash cafe',
    "l'apostrophe typographique et l\u2019autre",
    "annotation_workspace ANNOTATION-WORKSPACE",
    "AND OR NOT NEAR(",
    "* ( ) : ^ { } [ ]",
    "'; DROP TABLE chunks; --",
    "d\u00e9pannage propag\u00e9 \u00e9cran",
    '"',
    "\u4e2d\u6587 \u0440\u0443\u0441\u0441\u043a\u0438\u0439",
    "-",
]


def service(store: Store, embedder: FakeEmbedder, sync: SyncManager) -> SearchService:
    return SearchService(store, embedder, lambda: sync.snapshot, embedder.model_id, warm_model=embedder.load)


def run(svc: SearchService, q: str, **kw) -> dict:
    return svc.search(SearchParams(q=q, **kw))


@pytest.fixture
def svc(store: Store, embedder: FakeEmbedder, sync: SyncManager) -> SearchService:
    sync.run_blocking()
    return service(store, embedder, sync)


@pytest.mark.parametrize("raw", NASTY)
def test_keyword_query_never_raises(svc: SearchService, raw: str) -> None:
    match = build_match(query_terms(raw))
    svc.store.keyword_hits(match, 10)  # une syntaxe FTS5 invalide leverait sqlite3.OperationalError
    result = run(svc, raw)
    assert result["mode"] in ("hybrid", "keyword")


def test_empty_and_short_queries_return_no_hits(svc: SearchService) -> None:
    for q in ("", " ", "a", "  x  ", "!!"):
        assert run(svc, q)["hits"] == []


def test_query_terms_and_match() -> None:
    assert query_terms("Comment ajouter un projet ?") == ["ajouter", "projet"]
    assert query_terms("the a of") == ["the", "of"]  # que des mots vides : on les garde
    assert query_terms("SAM2 sam2 SAM2") == ["sam2"]
    assert len(query_terms(" ".join(f"mot{i}" for i in range(50)))) == 16
    assert build_match([]) == ""
    match = build_match(["ecran", "propagation"])
    assert '"ecran"' in match and '"propagation"' in match and '"propagat"*' in match and " OR " in match
    assert build_match(['a"b']) == '"a""b"'


def test_accents_and_case_are_insensitive_in_fts(
    store: Store, embedder: FakeEmbedder, sync: SyncManager, docs_root: Path
) -> None:
    (docs_root / "DVC_App" / "docs" / "user-guide.fr.md").write_text(
        page(
            "dvc",
            "user-guide",
            "fr",
            "Guide",
            [("D\u00e9pannage de l'\u00e9cran", prose("frx", 70) + " Cr\u00e9er un r\u00e9sum\u00e9.")],
        ),
        encoding="utf-8",
    )
    sync.run_blocking()
    svc = service(store, embedder, sync)
    hits = run(svc, "creer resume ECRAN", lang="fr", apps=("dvc",), method="keyword")["hits"]
    assert hits and hits[0]["doc"] == "user-guide" and hits[0]["lang"] == "fr"


def test_rrf_is_deterministic_and_rank_based() -> None:
    fused = rrf_fuse([[1, 2, 3], [3, 1, 4]])
    assert fused[1] == pytest.approx(1 / 61 + 1 / 62)
    assert fused[3] == pytest.approx(1 / 63 + 1 / 61)
    assert fused[4] == pytest.approx(1 / 63)
    order = sorted(fused, key=lambda c: (-fused[c], c))
    assert order == [1, 3, 2, 4]
    assert rrf_fuse([[1, 2, 3], [3, 1, 4]]) == fused
    assert rrf_fuse([]) == {}


def test_search_is_deterministic_and_scores_normalised(svc: SearchService) -> None:
    a = run(svc, "endvcbeta3 alpha", k=5)
    b = run(svc, "endvcbeta3 alpha", k=5)
    assert a["hits"] == b["hits"]
    assert a["mode"] == "hybrid"
    assert all(0.0 <= h["score"] <= 1.0 for h in a["hits"])
    assert a["hits"][0]["score"] == max(h["score"] for h in a["hits"])


def test_filters_lang_apps_audience(
    svc: SearchService, docs_root: Path, store: Store, embedder: FakeEmbedder, sync: SyncManager
) -> None:
    res = run(svc, "section alpha", lang="fr", k=30)
    assert res["hits"] and {h["lang"] for h in res["hits"]} == {"fr"}
    res = run(svc, "section alpha", apps=("dvc",), k=30)
    assert {h["app"] for h in res["hits"]} == {"dvc"}

    (docs_root / "DVC_App" / "docs" / "architecture.md").write_text(
        page("dvc", "architecture", "en", "Architecture", [("Internals", prose("dev", 90))], audience="dev"),
        encoding="utf-8",
    )
    (docs_root / "DVC_App" / "docs" / "README.md").write_text(
        page("dvc", "README", "en", "Readme", [("Overview", prose("both", 90))], audience="both"),
        encoding="utf-8",
    )
    sync.run_blocking()
    svc = service(store, embedder, sync)
    dev = {h["doc"] for h in run(svc, "dev0 both0 alpha", audience="dev", lang="en", k=30)["hits"]}
    assert (
        "architecture" in dev and "README" in dev and "user-guide" not in dev
    )  # audience both passe partout
    user = {h["doc"] for h in run(svc, "dev0 both0 alpha", audience="user", lang="en", k=30)["hits"]}
    assert "architecture" not in user and "README" in user and "user-guide" in user


def test_max_two_results_per_file_and_k_cap(svc: SearchService) -> None:
    res = run(svc, "section alpha beta gamma", lang="en", k=30)
    per_file: dict[tuple[str, str], int] = {}
    for h in res["hits"]:
        key = (h["app"], h["doc"], h["lang"])
        per_file[key] = per_file.get(key, 0) + 1
    assert max(per_file.values()) <= 2
    assert len(run(svc, "section", lang="en", k=1)["hits"]) == 1


def test_both_dedupes_twins_by_pair_key_and_honours_prefer(svc: SearchService) -> None:
    q = "alpha section endvcalpha3 frdvcalpha3"
    res = run(svc, q, apps=("dvc",), k=30)
    pairs = [(h["doc"], h["heading_idx"]) for h in res["hits"]]
    assert len(pairs) == len(set(pairs))  # une section n'apparait qu'une fois
    assert all(h["lang"] == "en" for h in res["hits"])
    assert all(
        h["other_lang"] == {"lang": "fr", "doc": "user-guide", "heading_idx": h["heading_idx"]}
        for h in res["hits"]
    )

    res_fr = run(svc, q, apps=("dvc",), k=30, prefer="fr")
    assert res_fr["hits"] and all(h["lang"] == "fr" for h in res_fr["hits"])
    assert res_fr["hits"][0]["other_lang"]["lang"] == "en"


def test_both_keeps_other_language_when_only_twin(
    svc: SearchService, docs_root: Path, store: Store, embedder: FakeEmbedder, sync: SyncManager
) -> None:
    (docs_root / "DVC_App" / "docs" / "user-guide.md").unlink()
    sync.run_blocking()
    svc = service(store, embedder, sync)
    res = run(svc, "alpha section", apps=("dvc",), prefer="en")
    assert res["hits"] and {h["lang"] for h in res["hits"]} == {"fr"}
    assert all(h["other_lang"] is None for h in res["hits"])


def test_french_query_retrieves_english_page(store: Store, docs_root: Path) -> None:
    # Modele factice qui rapproche des mots FR et EN, comme le ferait un modele multilingue :
    # la langue de la requete ne doit jamais restreindre les pages retournees.
    embedder = FakeEmbedder(aliases={"exporter": "export", "annotations": "annotations", "masque": "mask"})
    (docs_root / "Annotation_App" / "docs" / "workflows.md").write_text(
        page(
            "annotation",
            "workflows",
            "en",
            "Workflows",
            [
                ("Export the dataset", "export annotations mask " + prose("zz", 70)),
                ("Something else", prose("other", 90)),
            ],
        ),
        encoding="utf-8",
    )
    sync = SyncManager(store, embedder, docs_root)
    sync.run_blocking()
    svc = service(store, embedder, sync)
    res = run(svc, "exporter masque", lang="en", method="vector", apps=("annotation",))
    top = res["hits"][0]
    assert (top["doc"], top["lang"], top["heading_path"][-1]) == ("workflows", "en", "Export the dataset")
    assert top["vector_score"] > 0.1 and top["keyword_rank"] is None  # trouve par le vecteur seul


def test_keyword_only_fallback_when_model_missing(store: Store, docs_root: Path) -> None:
    embedder = FakeEmbedder()
    embedder.is_available = False
    sync = SyncManager(store, embedder, docs_root)
    sync.run_blocking()
    svc = service(store, embedder, sync)
    res = run(svc, "endvcbeta3")
    assert res["mode"] == "keyword" and "introuvable" in res["notice"]
    assert res["hits"] and res["hits"][0]["vector_score"] is None and res["hits"][0]["keyword_rank"] == 1


def test_keyword_only_while_model_loads_then_hybrid(
    store: Store, embedder: FakeEmbedder, docs_root: Path
) -> None:
    sync = SyncManager(store, embedder, docs_root)
    sync.run_blocking()
    embedder.is_loaded = False
    svc = service(store, embedder, sync)
    first = run(svc, "endvcbeta3")
    assert first["mode"] == "keyword" and "chargement" in first["notice"]
    assert embedder.warm_calls == 1  # la requete lance le chargement sans l'attendre
    second = run(svc, "endvcbeta3")
    assert second["mode"] == "hybrid" and "notice" not in second


def test_vector_failure_falls_back_to_keywords(svc: SearchService, embedder: FakeEmbedder) -> None:
    def boom(_: list[str]):
        raise RuntimeError("CUDA out of memory")

    embedder.embed_queries = boom  # type: ignore[method-assign]
    res = run(svc, "endvcbeta3")
    assert res["mode"] == "keyword" and "CUDA out of memory" in res["notice"] and res["hits"]


def test_snippet_picks_best_sentence_without_html() -> None:
    text = "**Intro** sans rapport. Le proxy <b>nginx</b> ecoute sur le port 8080 par defaut. Fin du texte."
    snippet = make_snippet(text, ["port", "8080"])
    assert snippet.startswith("Le proxy nginx ecoute") and "<b>" not in snippet and "**" not in snippet
    assert make_snippet(text, ["zzz"]).startswith("Intro sans rapport.")
    long = "mot " * 400
    assert len(make_snippet(long, ["mot"])) <= 320
    assert make_snippet("", ["x"]) == ""


def test_hit_shape(svc: SearchService) -> None:
    hit = run(svc, "endvcgamma5", lang="en", apps=("dvc",))["hits"][0]
    assert set(hit) == {
        "app",
        "doc",
        "doc_type",
        "audience",
        "lang",
        "title",
        "heading_path",
        "heading_idx",
        "part",
        "snippet",
        "score",
        "relevance",
        "vector_score",
        "keyword_rank",
        "other_lang",
    }
    assert hit["heading_path"] == ["User guide", "Gamma section"] and hit["doc"] == "user-guide"
    assert "endvcgamma5" in hit["snippet"]
