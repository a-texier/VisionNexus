"""Mesure la qualite de la recherche sur tests/golden.json avec un vrai modele.

Construit un index temporaire a partir d'une COPIE des docs (jamais les originaux), puis
donne top-1/3/5 en hybride, vecteur seul et mots-cles seuls : global, par langue de
question, questions croisees (question FR sur pages EN et inversement), par public. Mesure
aussi le temps de build complet, d'une re-sync sans changement et d'une re-sync apres
l'edition d'un fichier, et la latence des requetes.

    python scripts/evaluate.py --model intfloat/multilingual-e5-small
    python scripts/evaluate.py --model intfloat/multilingual-e5-base --verbose
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_ROOT))

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

from backend.core.embedder import E5Embedder  # noqa: E402
from backend.core.search import SearchParams, SearchService  # noqa: E402
from backend.core.sources import docs_relpath, load_manifest  # noqa: E402
from backend.core.store import Store  # noqa: E402
from backend.core.sync import SyncManager  # noqa: E402
from backend.model_paths import model_dir  # noqa: E402

METHODS = ("hybrid", "vector", "keyword")
DEFAULT_K = 10


def copy_docs(repo_root: Path, dest: Path) -> None:
    """Copie manifest + pages des sources : la re-sync editera cette copie, pas les docs."""
    shutil.copy2(repo_root / "docs" / "docs_manifest.json", _ensure(dest / "docs" / "docs_manifest.json"))
    for source in load_manifest(repo_root)["sources"]:
        rel = docs_relpath(source)
        docs = repo_root / rel
        for md in docs.glob("*.md") if docs.is_dir() else []:
            shutil.copy2(md, _ensure(dest / rel / md.name))


def _ensure(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def section_starts(store: Store) -> dict[tuple[str, str, str], list[int]]:
    """Premiers titres des passages de chaque page : un passage couvre [debut, debut suivant[."""
    rows = (
        store._conn()
        .execute("SELECT DISTINCT app, doc_name, lang, heading_idx FROM chunks ORDER BY heading_idx")
        .fetchall()
    )
    out: dict[tuple[str, str, str], list[int]] = {}
    for r in rows:
        out.setdefault((r["app"], r["doc_name"], r["lang"]), []).append(r["heading_idx"])
    return out


def is_correct(hit: dict, expect: dict, starts: dict[tuple[str, str, str], list[int]]) -> bool:
    if (hit["app"], hit["doc"]) != (expect["app"], expect["doc"]):
        return False
    wanted = expect["heading_idx"] if isinstance(expect["heading_idx"], list) else [expect["heading_idx"]]
    page_starts = starts.get((hit["app"], hit["doc"], hit["lang"]), [])
    for idx in wanted:
        covering = max((s for s in page_starts if s <= idx), default=None)
        if covering == hit["heading_idx"]:
            return True
    return False


def rank_of_first_hit(result: dict, expect: dict, starts: dict) -> int | None:
    for rank, hit in enumerate(result["hits"], start=1):
        if is_correct(hit, expect, starts):
            return rank
    return None


def rate(ranks: list[int | None], n: int) -> float:
    return 100.0 * sum(1 for r in ranks if r is not None and r <= n) / len(ranks) if ranks else 0.0


def run_method(
    svc: SearchService, questions: list[dict], method: str, starts: dict
) -> tuple[list[int | None], list[float], list[dict]]:
    ranks: list[int | None] = []
    timings: list[float] = []
    results: list[dict] = []
    for item in questions:
        started = time.perf_counter()
        result = svc.search(SearchParams(q=item["q"], lang=item["search_lang"], k=DEFAULT_K, method=method))
        timings.append((time.perf_counter() - started) * 1000)
        ranks.append(rank_of_first_hit(result, item["expect"], starts))
        results.append(result)
    return ranks, timings, results


def scopes(questions: list[dict]) -> dict[str, list[int]]:
    idx = range(len(questions))
    return {
        "all": list(idx),
        "q fr": [i for i in idx if questions[i]["q_lang"] == "fr"],
        "q en": [i for i in idx if questions[i]["q_lang"] == "en"],
        "cross-language": [i for i in idx if questions[i]["q_lang"] != questions[i]["search_lang"]],
        "same-language": [i for i in idx if questions[i]["q_lang"] == questions[i]["search_lang"]],
        "audience user": [i for i in idx if questions[i]["audience"] == "user"],
        "audience dev": [i for i in idx if questions[i]["audience"] == "dev"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--model", default="intfloat/multilingual-e5-small")
    parser.add_argument("--model-dir", type=Path, default=None)
    parser.add_argument("--docs-root", type=Path, default=APP_ROOT.parent)
    parser.add_argument("--golden", type=Path, default=APP_ROOT / "tests" / "golden.json")
    parser.add_argument("--device", default=None)
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="liste les questions dont la bonne section n'est pas en tete (hybride)",
    )
    parser.add_argument("--json", type=Path, default=None, help="ecrit les resultats bruts dans ce fichier")
    args = parser.parse_args()

    questions = json.loads(args.golden.read_text(encoding="utf-8"))["questions"]
    embedder = E5Embedder(args.model, args.model_dir or model_dir(args.model), args.device)
    if not embedder.available:
        print(embedder.unavailable_reason(), file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        docs_copy = Path(tmp) / "repo"
        copy_docs(args.docs_root, docs_copy)
        store = Store(Path(tmp) / "index.sqlite")
        manager = SyncManager(store, embedder, docs_copy)

        started = time.perf_counter()
        embedder.load()
        load_s = time.perf_counter() - started
        started = time.perf_counter()
        manager.run_blocking()
        build_s = time.perf_counter() - started
        counts = store.counts(embedder.model_id)
        if manager.status()["last_error"]:
            print(f"[echec] {manager.status()['last_error']}", file=sys.stderr)
            return 1

        svc = SearchService(store, embedder, lambda: manager.snapshot, embedder.model_id)
        svc.search(SearchParams(q="warmup", k=1))  # 1re requete GPU : allocations, hors mesure
        starts = section_starts(store)

        report: dict = {
            "model": args.model,
            "device": embedder.device,
            "dim": embedder.dim,
            "files": counts["files"],
            "chunks": counts["chunks"],
            "load_s": round(load_s, 2),
            "build_s": round(build_s, 2),
            "methods": {},
        }
        raw: dict[str, list[dict]] = {}
        for method in METHODS:
            ranks, timings, results = run_method(svc, questions, method, starts)
            raw[method] = results
            report["methods"][method] = {"ranks": ranks, "latency_ms": timings}

        # Re-sync : sans changement, puis apres l'edition d'un paragraphe d'un fichier.
        started = time.perf_counter()
        manager.run_blocking()
        noop_s = time.perf_counter() - started
        target = docs_copy / "Annotation_App" / "docs" / "troubleshooting.md"
        text = target.read_text(encoding="utf-8")
        marker = "\n\nAdditional note added by the evaluation script to force one re-embedding.\n"
        anchor = text.index("\n## ", text.index("\n## ") + 4)
        target.write_text(text[:anchor] + marker + text[anchor:], encoding="utf-8")
        started = time.perf_counter()
        manager.run_blocking()
        edit_s = time.perf_counter() - started
        report["resync"] = {
            "no_change_s": round(noop_s, 3),
            "one_file_edited_s": round(edit_s, 3),
            "chunks_reembedded": manager.status()["progress"]["chunks_to_embed"],
        }
        store.close()

    print(
        f"\nModele {args.model} ({report['device']}, dim {report['dim']}) : "
        f"{report['files']} fichiers, {report['chunks']} passages"
    )
    print(
        f"Chargement du modele {load_s:.1f} s ; build complet {build_s:.1f} s ; "
        f"re-sync sans changement {noop_s:.2f} s ; apres edition d'un fichier {edit_s:.2f} s "
        f"({report['resync']['chunks_reembedded']} passage(s) re-embedde(s))"
    )

    groups = scopes(questions)
    print(f"\n{'methode':<9} {'perimetre':<15} {'n':>3} {'top1':>7} {'top3':>7} {'top5':>7}")
    for method in METHODS:
        ranks = report["methods"][method]["ranks"]
        for name, members in groups.items():
            sub = [ranks[i] for i in members]
            tops = " ".join(f"{rate(sub, n):>6.1f}%" for n in (1, 3, 5))
            print(f"{method:<9} {name:<15} {len(sub):>3} {tops}")
    for method in METHODS:
        lat = sorted(report["methods"][method]["latency_ms"])
        p95 = lat[max(0, int(0.95 * len(lat)) - 1)]
        print(
            f"latence {method:<8} moyenne {statistics.mean(lat):.1f} ms, "
            f"mediane {statistics.median(lat):.1f} ms, p95 {p95:.1f} ms"
        )

    if args.verbose:
        print("\nQuestions dont la bonne section n'est pas en premiere position (hybride) :")
        for i, item in enumerate(questions):
            rank = report["methods"]["hybrid"]["ranks"][i]
            if rank != 1:
                got = [
                    f"{h['app']}/{h['doc']}#{h['heading_idx']}({h['lang']})"
                    for h in raw["hybrid"][i]["hits"][:4]
                ]
                e = item["expect"]
                wanted = f"{e['app']}/{e['doc']}#{e['heading_idx']}"
                print(f"  [{rank}] {item['id']}: attendu {wanted} ; obtenu {', '.join(got)}")
    if args.json:
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
