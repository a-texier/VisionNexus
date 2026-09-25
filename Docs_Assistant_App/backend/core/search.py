"""Recherche hybride : cosinus exact (vecteurs) + BM25 (FTS5), fusion par RRF.

Le service ne genere aucun texte : il renvoie des passages existants, avec un extrait
choisi dans le passage. Sans modele charge, il se replie sur les mots-cles seuls.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from backend.core.chunker import plain_text
from backend.core.embedder import Embedder
from backend.core.rerank import (
    RankConfig,
    confidence,
    detect_intent,
    detect_lang,
    factor,
    profile_query,
    relevance,
)
from backend.core.store import ChunkMeta, Snapshot, Store

RRF_K = 60
CANDIDATES = 50  # taille de chaque liste avant fusion
KEYWORD_FETCH = 400  # marge : les filtres retirent des lignes apres la requete FTS
MAX_PER_FILE = 2
MAX_QUERY_TERMS = 16
SNIPPET_CHARS = 320
MAX_K = 30
MIN_QUERY_CHARS = 2
# Au-dela de cette longueur, un mot est aussi cherche par prefixe (propager ~ propagation).
_STEM_MIN_LEN = 6

_WORD = re.compile(r"\w+", re.UNICODE)
_SENTENCE = re.compile(r"(?<=[.!?])\s+|\n+")

_STOPWORDS = frozenset(
    "a an and are as at be by can do does for from how i in is it its me my of on or the "
    "to what when where which who why with you your "
    "au aux ce ces comment dans de des du en est et il je la le les leur mais me mes ne ou "
    "par pas pour que qui quoi se ses sur un une vos votre vous y qu".split()
)


def fold(text: str) -> str:
    """Minuscules sans accents, pour comparer une requete et un extrait."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def query_terms(query: str) -> list[str]:
    """Mots de la requete (minuscules, accents conserves, sans doublon ni mot vide)."""
    seen: dict[str, None] = {}
    for word in _WORD.findall(query.lower()):
        if len(word) >= 2 or word.isdigit():
            seen.setdefault(word, None)
    terms = list(seen)
    useful = [t for t in terms if t not in _STOPWORDS]
    return (useful or terms)[:MAX_QUERY_TERMS]


def build_match(terms: list[str]) -> str:
    """Expression FTS5 sure : chaque mot est cite (tiret, apostrophe ou guillemet saisis
    par l'utilisateur ne peuvent pas casser la syntaxe), reunis par OR."""
    parts: list[str] = []
    for term in terms:
        safe = term.replace('"', '""')
        parts.append(f'"{safe}"')
        if len(term) >= _STEM_MIN_LEN:
            stem = term[: max(4, len(term) - 3)].replace('"', '""')
            parts.append(f'"{stem}"*')
    return " OR ".join(parts)


def rrf_fuse(rankings: list[list[int]], k: int = RRF_K) -> dict[int, float]:
    """Reciprocal rank fusion : somme des 1/(k + rang) sur chaque liste (rang depuis 1)."""
    scores: dict[int, float] = defaultdict(float)
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking, start=1):
            scores[chunk_id] += 1.0 / (k + rank)
    return dict(scores)


def make_snippet(text: str, terms: list[str], limit: int = SNIPPET_CHARS) -> str:
    """Phrase(s) du passage qui recouvrent le mieux la requete, sinon le debut du passage."""
    plain = plain_text(text)
    sentences = [s.strip() for s in _SENTENCE.split(plain) if s.strip()]
    if not sentences:
        return ""
    wanted = {fold(t) for t in terms}
    best, best_score = 0, 0
    for i, sentence in enumerate(sentences):
        words = set(_WORD.findall(fold(sentence)))
        score = len(words & wanted)
        if score > best_score:
            best, best_score = i, score
    picked: list[str] = []
    size = 0
    for sentence in sentences[best:]:
        if picked and size + len(sentence) + 1 > limit:
            break
        picked.append(sentence)
        size += len(sentence) + 1
    snippet = " ".join(picked)
    if len(snippet) > limit:
        cut = snippet[: limit - 3].rsplit(" ", 1)[0]
        snippet = f"{cut}..."
    return snippet


@dataclass(frozen=True)
class SearchParams:
    q: str
    lang: str = "both"  # fr | en | both
    apps: tuple[str, ...] = ()
    audience: str = "all"  # user | dev | all
    k: int = 8
    prefer: str = "auto"  # langue gardee en mode both : fr | en | auto (langue de la question)
    ui_lang: str = "en"  # langue de repli quand la question ne permet pas de trancher
    method: str = "hybrid"  # hybrid | vector | keyword (evaluation)


class SearchService:
    def __init__(
        self,
        store: Store,
        embedder: Embedder,
        get_snapshot: Callable[[], Snapshot],
        model_id: str,
        warm_model: Callable[[], None] = lambda: None,
        rank: RankConfig | None = None,
    ) -> None:
        self.rank = rank or RankConfig()
        self.store = store
        self.embedder = embedder
        self.get_snapshot = get_snapshot
        self.model_id = model_id
        self.warm_model = warm_model

    # ---- filtres --------------------------------------------------------- #

    @staticmethod
    def _allowed(meta: ChunkMeta, params: SearchParams) -> bool:
        if params.lang != "both" and meta.lang != params.lang:
            return False
        if params.apps and meta.app not in params.apps:
            return False
        if params.audience != "all" and meta.audience not in (params.audience, "both"):
            return False
        return True

    # ---- listes candidates ----------------------------------------------- #

    def _vector_ranking(
        self, query: str, snap: Snapshot, params: SearchParams
    ) -> tuple[list[int], dict[int, float]]:
        qvec = self.embedder.embed_queries([query])[0]
        scores = snap.matrix @ qvec
        allowed = np.fromiter(
            (self._allowed(snap.metas[int(i)], params) for i in snap.vec_ids),
            dtype=bool,
            count=len(snap.vec_ids),
        )
        if not allowed.any():
            return [], {}
        idx = np.flatnonzero(allowed)
        # Tri stable sur (score decroissant, id croissant) : classement deterministe.
        order = idx[np.lexsort((snap.vec_ids[idx], -scores[idx]))][:CANDIDATES]
        ids = [int(snap.vec_ids[i]) for i in order]
        return ids, {int(snap.vec_ids[i]): float(scores[i]) for i in order}

    def _keyword_ranking(self, terms: list[str], snap: Snapshot, params: SearchParams) -> list[int]:
        hits = self.store.keyword_hits(build_match(terms), KEYWORD_FETCH)
        ids = [cid for cid, _ in hits if cid in snap.metas and self._allowed(snap.metas[cid], params)]
        return ids[:CANDIDATES]

    # ---- point d'entree --------------------------------------------------- #

    def search(self, params: SearchParams) -> dict:
        query = " ".join(params.q.split())
        snap = self.get_snapshot()
        terms = query_terms(query)
        detected = detect_lang(query)
        prefer = params.prefer if params.prefer in ("fr", "en") else (detected or params.ui_lang)
        result: dict = {
            "mode": "hybrid" if self.embedder.loaded and len(snap.vec_ids) else "keyword",
            "hits": [],
            "terms": terms,
            "lang_detected": detected,
            "intent": None,
            "confidence": None,
        }
        if len(query) < MIN_QUERY_CHARS or not terms:
            return result
        result["intent"] = detect_intent(query)
        result["mode"] = "keyword"  # "hybrid" seulement si la recherche vectorielle a bien tourne

        vector_ids: list[int] = []
        cosine: dict[int, float] = {}
        notice = ""
        if params.method != "keyword":
            notice = self._vector_unavailable(snap)
            if not notice:
                try:
                    vector_ids, cosine = self._vector_ranking(query, snap, params)
                    result["mode"] = "hybrid"
                except Exception as exc:  # echec de chargement ou de calcul : repli, pas de 500
                    notice = (
                        f"Recherche vectorielle indisponible ({type(exc).__name__}: {exc}). Mots-cles seuls."
                    )
        if notice:
            result["notice"] = notice

        vector_only = params.method == "vector" and result["mode"] == "hybrid"
        keyword_ids = [] if vector_only else self._keyword_ranking(terms, snap, params)
        keyword_rank = {cid: rank for rank, cid in enumerate(keyword_ids, start=1)}

        lists = [r for r in (vector_ids, keyword_ids) if r]
        fused = rrf_fuse(lists)
        best_possible = len(lists) / (RRF_K + 1) if lists else 1.0
        profile = profile_query(query, snap.labels)
        fused = {
            cid: score * factor(snap.metas[cid].app, snap.metas[cid].doc_type, profile, self.rank)
            for cid, score in fused.items()
        }

        ordered = sorted(fused, key=lambda cid: (-fused[cid], cid))
        chosen = self._dedupe(ordered, fused, snap, params, prefer)
        chosen = self._cap_per_file(chosen, snap)[: max(1, min(params.k, MAX_K))]

        texts = self.store.chunk_texts(chosen)
        for cid in chosen:
            meta = snap.metas[cid]
            result["hits"].append(
                {
                    "app": meta.app,
                    "doc": meta.doc_name,
                    "doc_type": meta.doc_type,
                    "audience": meta.audience,
                    "lang": meta.lang,
                    "title": meta.title,
                    "heading_path": list(meta.heading_path),
                    "heading_idx": meta.heading_idx,
                    "part": meta.part,
                    "snippet": make_snippet(texts.get(cid, ""), terms),
                    "score": round(min(1.0, fused[cid] / best_possible), 4),
                    "vector_score": round(cosine[cid], 4) if cid in cosine else None,
                    "relevance": relevance(cosine.get(cid), self.model_id),
                    "keyword_rank": keyword_rank.get(cid),
                    "other_lang": self._other_lang(meta, snap),
                }
            )
        if result["hits"] and result["mode"] == "hybrid":
            best_cosine = max((cosine[c] for c in chosen if c in cosine), default=None)
            result["confidence"] = confidence(
                best_cosine, result["hits"][0]["keyword_rank"], len(terms), self.model_id
            )
        return result

    def _vector_unavailable(self, snap: Snapshot) -> str:
        if not self.embedder.available:
            return self.embedder.unavailable_reason() + " Mots-cles seuls."
        if not self.embedder.loaded:
            self.warm_model()  # chargement en arriere-plan : cette requete ne bloque pas
            return "Modele d'embeddings en cours de chargement : mots-cles seuls pour le moment."
        if len(snap.vec_ids) == 0:
            return "Aucun vecteur dans l'index pour l'instant (indexation en cours) : mots-cles seuls."
        return ""

    # ---- post-traitement --------------------------------------------------- #

    @staticmethod
    def _dedupe(
        ordered: list[int], fused: dict[int, float], snap: Snapshot, params: SearchParams, prefer: str
    ) -> list[int]:
        """En mode both, une section n'apparait qu'une fois (langue preferee, sinon l'autre).
        Elle garde le meilleur score de ses deux jumelles pour ne pas etre desavantagee."""
        if params.lang != "both":
            return ordered
        by_pair: dict[str, dict[str, int]] = {}
        for cid in ordered:  # deja trie : la premiere occurrence par langue est la meilleure
            meta = snap.metas[cid]
            by_pair.setdefault(meta.pair_key, {}).setdefault(meta.lang, cid)
        kept: list[int] = []
        for per_lang in by_pair.values():
            lang = prefer if prefer in per_lang else next(iter(per_lang))
            cid = per_lang[lang]
            fused[cid] = max(fused[c] for c in per_lang.values())
            kept.append(cid)
        return sorted(kept, key=lambda cid: (-fused[cid], cid))

    @staticmethod
    def _cap_per_file(ordered: list[int], snap: Snapshot) -> list[int]:
        counts: dict[str, int] = defaultdict(int)
        kept: list[int] = []
        for cid in ordered:
            path = snap.metas[cid].file_path
            if counts[path] < MAX_PER_FILE:
                counts[path] += 1
                kept.append(cid)
        return kept

    @staticmethod
    def _other_lang(meta: ChunkMeta, snap: Snapshot) -> dict | None:
        others = snap.pair_langs.get(meta.pair_key, frozenset()) - {meta.lang}
        if not others:
            return None
        return {"lang": sorted(others)[0], "doc": meta.doc_name, "heading_idx": meta.heading_idx}
