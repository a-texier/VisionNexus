from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from backend.core.chunker import chunk_document
from backend.core.rerank import (
    DEV,
    NONE,
    QueryProfile,
    RankConfig,
    confidence,
    detect_intent,
    detect_lang,
    factor,
    mentioned_apps,
    relevance,
)
from backend.core.search import SearchParams, SearchService
from backend.core.store import SCHEMA_VERSION, Store
from backend.core.sync import SyncManager
from tests.helpers import MANIFEST, FakeEmbedder, page, prose

LABELS = {
    "annotation": "Annotation App",
    "explorer": "Dataset Explorer",
    "orchestrator": "Orchestrator App",
    "training": "Training App",
    "suite": "VisionNexus",
    "docs": "Docs Assistant",
    "mlflow": "MLflow App",
}
E5_SMALL = "intfloat/multilingual-e5-small"


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("/api/graphs/meta/workspace-outputs", DEV),
        ("HF_HUB_OFFLINE", DEV),
        ("which endpoint lists the datasets", DEV),
        ("How does the DVC subprocess wrapper find the executable?", DEV),
        ("l'application ne demarre pas", NONE),
        ("backend not responding", NONE),
        ("comment exporter au format YOLO", NONE),
        ("what is a human gate", NONE),
        ("Why must the FAISS index positions match the order of the image ids?", NONE),
        ("Pourquoi MLflow utilise un store SQLite", DEV),
    ],
)
def test_detect_intent(query: str, expected: str) -> None:
    assert detect_intent(query) == expected


@pytest.mark.parametrize(
    ("query", "apps"),
    [
        ("comment lancer un pipeline avec l'orchestrateur", {"orchestrator"}),
        ("how to use the Dataset Explorer", {"explorer"}),
        ("explorer les clusters", {"explorer"}),
        ("comment lancer un entrainement", {"training"}),
        ("activer l'assistant de documentation", {"docs"}),
        ("comment exporter depuis explorer vers annotation", {"explorer", "annotation"}),
        ("open the mlflow UI", {"mlflow"}),
        ("what is a dataset", set()),
        ("how do I export to YOLO", set()),
    ],
)
def test_mentioned_apps(query: str, apps: set[str]) -> None:
    assert mentioned_apps(query, LABELS) == apps


def test_factor_demotes_generated_tables_unless_developer_question() -> None:
    cfg = RankConfig()
    neutral = QueryProfile(NONE, frozenset())
    dev = QueryProfile(DEV, frozenset())
    assert factor("annotation", "api-reference", neutral, cfg) < 1.0
    assert factor("annotation", "code-map", neutral, cfg) < 1.0
    assert factor("annotation", "readme", neutral, cfg) < 1.0
    assert factor("annotation", "workflows", neutral, cfg) == 1.0
    assert factor("annotation", "api-reference", dev, cfg) == 1.0
    assert factor("annotation", "readme", dev, cfg) == 1.0


def test_factor_mention_pushes_the_named_app_only() -> None:
    cfg = RankConfig()
    profile = QueryProfile(NONE, frozenset({"dvc"}))
    assert factor("dvc", "workflows", profile, cfg) > 1.0
    assert factor("training", "workflows", profile, cfg) == 1.0
    assert factor("dvc", "api-reference", profile, cfg) < factor("dvc", "workflows", profile, cfg)


def test_factor_strength_zero_disables_each_rule() -> None:
    off = RankConfig(tables=0, mention=0)
    assert factor("dvc", "workflows", QueryProfile(NONE, frozenset({"dvc"})), off) == 1.0
    assert factor("dvc", "api-reference", QueryProfile(NONE, frozenset()), off) == 1.0


@pytest.mark.parametrize(
    ("query", "lang"),
    [
        ("comment exporter mon projet au format YOLO", "fr"),
        ("how do I export annotations to COCO", "en"),
        ("le tunnel echoue", "fr"),
        ("mes images ne s'affichent pas", "fr"),
        ("ou est defini le registre des apps", "fr"),
        ("procédure d'export", "fr"),  # les accents tranchent
        ("what is the difference between SAM2 and SAMURAI", "en"),
        ("SAM2", None),
        ("port 8068", None),
        ("", None),
    ],
)
def test_detect_lang(query: str, lang: str | None) -> None:
    assert detect_lang(query) == lang


def test_relevance_is_calibrated_per_model() -> None:
    assert relevance(0.80, E5_SMALL) == 0.0
    assert relevance(0.92, E5_SMALL) == 1.0
    assert relevance(0.70, E5_SMALL) == 0.0 and relevance(0.99, E5_SMALL) == 1.0
    assert 0.0 < relevance(0.86, E5_SMALL) < 1.0
    assert relevance(0.9, "fake-model") is None
    assert relevance(None, E5_SMALL) is None


def test_confidence() -> None:
    assert confidence(0.89, None, 6, E5_SMALL) == "high"
    assert confidence(0.82, None, 6, E5_SMALL) == "low"
    # un mot-cle seul bien classe par BM25 reste fiable : l'embedding d'une requete
    # si courte est flou ("UNC" plafonne a 0,79)
    assert confidence(0.79, 1, 1, E5_SMALL) == "high"
    assert confidence(0.79, 9, 1, E5_SMALL) == "low"
    assert confidence(0.79, 1, 2, E5_SMALL) == "low"  # deux mots : le cosinus decide
    assert confidence(0.79, 1, 5, E5_SMALL) == "low"
    assert confidence(0.89, 1, 1, "fake-model") is None
    assert confidence(None, 1, 1, E5_SMALL) is None


# ---- nom d'app dans le texte indexe ------------------------------------------- #


def test_chunk_header_carries_the_app_label() -> None:
    body = "# Workflows\n\n## Train a model\n\nRun the training " + "word " * 80
    with_label = chunk_document(
        body, app="training", doc_name="workflows", title="Workflows", app_label="Training App"
    )
    without = chunk_document(body, app="training", doc_name="workflows", title="Workflows")
    assert with_label[0].embed_text.startswith("Training App - Workflows > Train a model\n")
    assert without[0].embed_text.startswith("Workflows > Train a model\n")
    assert with_label[0].chunk_hash != without[0].chunk_hash


def test_chunk_header_does_not_repeat_a_label_already_in_the_title() -> None:
    body = "# Training App\n\n## What it does\n\n" + "word " * 80
    chunks = chunk_document(
        body, app="training", doc_name="README", title="Training App", app_label="Training App"
    )
    assert chunks[0].embed_text.startswith("Training App > What it does\n")


# ---- schema : un index d'une autre version est refait --------------------------- #


def test_store_drops_an_index_of_another_schema_version(tmp_path: Path) -> None:
    path = tmp_path / "index.sqlite"
    store = Store(path)
    store.meta_set(model_id="old-model")
    store.close()
    con = sqlite3.connect(path)
    con.execute("UPDATE meta SET value = '1' WHERE key = 'schema_version'")
    con.execute("INSERT INTO files(path, sha256) VALUES ('x.md', 'abc')")
    con.commit()
    con.close()

    reopened = Store(path)
    assert reopened.file_hashes() == {}  # l'ancien contenu est jete, la sync le refait
    assert reopened.meta_get("schema_version") == SCHEMA_VERSION
    assert reopened.meta_get("model_id") is None
    cols = [r[1] for r in reopened._conn().execute("PRAGMA table_info(files)")]
    assert "app_label" in cols
    reopened.close()


# ---- integration : la recherche utilise ces regles ------------------------------ #


def build_service(tmp_path: Path, pages: dict[str, str]) -> SearchService:
    """Arbre de docs minimal : `pages` = chemin relatif -> contenu."""
    root = tmp_path / "repo"
    (root / "docs").mkdir(parents=True)
    manifest = dict(MANIFEST)
    manifest["doc_set"] = [
        *MANIFEST["doc_set"],
        {"name": "api-reference", "doc_type": "api-reference", "audience": "dev", "order": 70},
        {"name": "README", "doc_type": "readme", "audience": "both", "order": 0},
    ]
    (root / "docs" / "docs_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    for rel, content in pages.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    store = Store(tmp_path / "index.sqlite")
    embedder = FakeEmbedder()
    sync = SyncManager(store, embedder, root)
    sync.run_blocking()
    return SearchService(store, embedder, lambda: sync.snapshot, embedder.model_id)


def two_apps(tmp_path: Path) -> SearchService:
    shared = prose("widgetword", 60)
    pages = {}
    for app_dir, app, title in (
        ("Annotation_App", "annotation", "Annotation App"),
        ("DVC_App", "dvc", "DVC App"),
    ):
        pages[f"{app_dir}/docs/README.md"] = page(app, "README", "en", title, [("Intro", "x " * 60)])
        pages[f"{app_dir}/docs/user-guide.md"] = page(
            app, "user-guide", "en", "Guide", [("Shared topic", shared)]
        )
    return build_service(tmp_path, pages)


def test_a_named_app_is_pushed_up(tmp_path: Path) -> None:
    svc = two_apps(tmp_path)
    for app, name in (("dvc", "DVC"), ("annotation", "annotation")):
        hits = svc.search(SearchParams(q=f"widgetword1 widgetword2 {name}", lang="en", k=4))["hits"]
        assert hits[0]["app"] == app
    svc.rank = RankConfig(mention=0)
    neutral = svc.search(SearchParams(q="widgetword1 widgetword2 dvc", lang="en", k=4))["hits"]
    assert {h["app"] for h in neutral[:2]} == {"annotation", "dvc"}  # sans la regle : a egalite


def test_generated_tables_rank_below_a_step_by_step_for_a_plain_question(tmp_path: Path) -> None:
    text = prose("gizmoword", 70)
    pages = {
        "Annotation_App/docs/user-guide.md": page(
            "annotation", "user-guide", "en", "Guide", [("Use the gizmo", text)]
        ),
        "Annotation_App/docs/api-reference.md": page(
            "annotation", "api-reference", "en", "API", [("Gizmo endpoints", text)], audience="dev"
        ),
    }
    svc = build_service(tmp_path, pages)
    hits = svc.search(SearchParams(q="gizmoword3 gizmoword4", lang="en", k=4))["hits"]
    assert [h["doc"] for h in hits[:2]] == ["user-guide", "api-reference"]
    svc.rank = RankConfig(tables=0)
    tied = svc.search(SearchParams(q="gizmoword3 gizmoword4", lang="en", k=4))["hits"]
    assert {h["doc"] for h in tied[:2]} == {"user-guide", "api-reference"}


def test_prefer_auto_keeps_the_language_of_the_question(tmp_path: Path) -> None:
    common = "sharedgizmo " + prose("twin", 60)
    pages = {
        "Annotation_App/docs/user-guide.md": page(
            "annotation", "user-guide", "en", "Guide", [("Topic", common)]
        ),
        "Annotation_App/docs/user-guide.fr.md": page(
            "annotation", "user-guide", "fr", "Guide", [("Sujet", common)]
        ),
    }
    svc = build_service(tmp_path, pages)
    fr = svc.search(SearchParams(q="comment utiliser le sharedgizmo", lang="both", prefer="auto", k=4))
    en = svc.search(SearchParams(q="how to use the sharedgizmo", lang="both", prefer="auto", k=4))
    assert fr["lang_detected"] == "fr" and {h["lang"] for h in fr["hits"]} == {"fr"}
    assert en["lang_detected"] == "en" and {h["lang"] for h in en["hits"]} == {"en"}
    # rien ne tranche : la langue de l'interface decide
    keyword = svc.search(SearchParams(q="sharedgizmo", lang="both", prefer="auto", ui_lang="fr", k=4))
    assert keyword["lang_detected"] is None and {h["lang"] for h in keyword["hits"]} == {"fr"}
    # une preference explicite l'emporte sur la detection
    forced = svc.search(SearchParams(q="comment utiliser le sharedgizmo", lang="both", prefer="en", k=4))
    assert {h["lang"] for h in forced["hits"]} == {"en"}


def test_relevance_and_confidence_fields(tmp_path: Path) -> None:
    svc = two_apps(tmp_path)
    plain = svc.search(SearchParams(q="widgetword1 widgetword2", lang="en", k=3))
    assert plain["confidence"] is None and all(
        h["relevance"] is None for h in plain["hits"]
    )  # modele non calibre
    svc.model_id = E5_SMALL
    # un mot-cle seul bien classe par BM25 : fiable meme si le cosinus du faux modele est bas
    short = svc.search(SearchParams(q="widgetword1", lang="en", k=3))
    assert short["confidence"] == "high"
    assert all(0.0 <= h["relevance"] <= 1.0 for h in short["hits"])
    # une vraie phrase dont le cosinus reste sous le seuil : faible confiance
    long = svc.search(
        SearchParams(q="widgetword1 widgetword2 unrelated words in a longer sentence", lang="en")
    )
    assert long["confidence"] == "low"


def test_short_query_reports_the_real_mode(tmp_path: Path) -> None:
    svc = two_apps(tmp_path)
    result = svc.search(SearchParams(q="a", lang="en"))
    assert result["hits"] == [] and result["mode"] == "hybrid" and "notice" not in result
    svc.embedder.is_loaded = False
    assert svc.search(SearchParams(q="a", lang="en"))["mode"] == "keyword"
