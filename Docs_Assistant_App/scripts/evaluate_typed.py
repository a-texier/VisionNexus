"""Mesure la recherche sur tests/typed_questions.json avec un vrai modele.

Complement de evaluate.py : ici une reponse est acceptable si son app et son type de page
sont ceux attendus (pas une section exacte), ce qui juge la qualite percue sur des
questions ecrites comme un utilisateur les tape (procedure, depannage, mots-cles, fautes,
identifiants, hors sujet). Donne top-1 / top-3 par jeu et par categorie, pour plusieurs
modes de langue, plus la separation de la confiance (questions reelles / hors sujet).

    python scripts/evaluate_typed.py
    python scripts/evaluate_typed.py --set validation --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from backend.core.embedder import E5Embedder  # noqa: E402
from backend.core.rerank import RankConfig  # noqa: E402
from backend.core.search import SearchParams, SearchService  # noqa: E402
from backend.core.store import Store  # noqa: E402
from backend.core.sync import SyncManager  # noqa: E402
from backend.model_paths import model_dir  # noqa: E402

# mode -> filtre de langue de la recherche, par rapport a la langue de la question
MODES = ("both", "same", "cross")


def language_filter(mode: str, q_lang: str) -> str:
    if mode == "both":
        return "both"
    if mode == "same":
        return q_lang
    return "en" if q_lang == "fr" else "fr"


def acceptable(hit: dict, item: dict) -> bool:
    if item["apps"] is not None and hit["app"] not in item["apps"]:
        return False
    return item["types"] is None or hit["doc_type"] in item["types"]


def evaluate(svc: SearchService, questions: list[dict], mode: str, method: str = "hybrid") -> dict:
    rows = []
    for item in questions:
        result = svc.search(
            SearchParams(
                q=item["q"],
                lang=language_filter(mode, item["lang"]),
                prefer=item["lang"],
                k=8,
                method=method,
            )
        )
        hits = result["hits"]
        rows.append(
            (
                item,
                result,
                bool(hits) and acceptable(hits[0], item),
                any(acceptable(h, item) for h in hits[:3]),
            )
        )
    scored = [r for r in rows if r[0]["cat"] != "oos"]
    return {
        "rows": scored,
        "oos": [r for r in rows if r[0]["cat"] == "oos"],
        "top1": 100.0 * sum(r[2] for r in scored) / len(scored),
        "top3": 100.0 * sum(r[3] for r in scored) / len(scored),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--model", default="intfloat/multilingual-e5-small")
    parser.add_argument("--docs-root", type=Path, default=APP_ROOT.parent)
    parser.add_argument("--questions", type=Path, default=APP_ROOT / "tests" / "typed_questions.json")
    parser.add_argument("--set", choices=("diagnostic", "validation", "all"), default="all")
    parser.add_argument(
        "--verbose", action="store_true", help="liste les questions dont la 1re reponse n'est pas acceptable"
    )
    args = parser.parse_args()

    data = json.loads(args.questions.read_text(encoding="utf-8"))
    sets = ("diagnostic", "validation") if args.set == "all" else (args.set,)

    embedder = E5Embedder(args.model, model_dir(args.model), None)
    if not embedder.available:
        print(embedder.unavailable_reason(), file=sys.stderr)
        return 1
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        store = Store(Path(tmp) / "index.sqlite")
        sync = SyncManager(store, embedder, args.docs_root)
        sync.run_blocking()
        embedder.load()
        svc = SearchService(store, embedder, lambda: sync.snapshot, embedder.model_id)
        svc.rank = RankConfig()
        print(f"{store.counts(embedder.model_id)['chunks']} passages, modele {embedder.model_id}\n")

        for name in sets:
            questions = data[name]
            print(f"== {name} ({sum(1 for q in questions if q['cat'] != 'oos')} questions) ==")
            for mode in MODES:
                r = evaluate(svc, questions, mode)
                print(f"  langue {mode:5s} top-1 {r['top1']:5.1f}%  top-3 {r['top3']:5.1f}%")
            r = evaluate(svc, questions, "both")
            for method in ("vector", "keyword"):
                m = evaluate(svc, questions, "both", method)
                print(f"  {method:8s} seul    top-1 {m['top1']:5.1f}%  top-3 {m['top3']:5.1f}%")
            cats = sorted({row[0]["cat"] for row in r["rows"]})
            per = {
                c: (
                    100.0
                    * sum(row[2] for row in r["rows"] if row[0]["cat"] == c)
                    / sum(1 for row in r["rows"] if row[0]["cat"] == c)
                )
                for c in cats
            }
            print("  top-1 par categorie :", ", ".join(f"{c} {v:.0f}%" for c, v in per.items()))
            flagged = sum(1 for row in r["rows"] if row[1]["confidence"] == "low")
            oos_flagged = sum(1 for row in r["oos"] if row[1]["confidence"] == "low")
            print(
                f"  confiance basse : {flagged}/{len(r['rows'])} questions reelles, "
                f"{oos_flagged}/{len(r['oos'])} hors sujet"
            )
            if args.verbose:
                for item, result, top1, top3 in r["rows"]:
                    if not top1:
                        head = result["hits"][0] if result["hits"] else None
                        where = f"{head['app']}/{head['doc']}" if head else "(aucun resultat)"
                        print(f"  [{'top-3' if top3 else 'rate'}] {item['q']}  ->  {where}")
            print()
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
