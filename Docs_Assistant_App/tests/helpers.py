"""Outils de test : embedder factice deterministe, generateurs de pages, settings."""

from __future__ import annotations

import re
import unicodedata
import zlib
from pathlib import Path

import numpy as np

from backend.config import Settings

_WORD = re.compile(r"\w+", re.UNICODE)


def _fold(word: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", word.lower()) if not unicodedata.combining(c))


class FakeEmbedder:
    """Sac de mots hache en dimension fixe, L2-normalise. Compte les textes embeddes.

    `aliases` rapproche des mots de langues differentes (fr -> en) pour simuler un modele
    multilingue sans poids."""

    def __init__(self, model_id: str = "fake-model", dim: int = 96, aliases: dict[str, str] | None = None):
        self.model_id = model_id
        self.dim = dim
        self.device: str | None = "fake"
        self.aliases = {_fold(k): _fold(v) for k, v in (aliases or {}).items()}
        self.is_available = True
        self.is_loaded = True
        self.passage_texts: list[str] = []
        self.query_texts: list[str] = []
        self.warm_calls = 0

    @property
    def available(self) -> bool:
        return self.is_available

    @property
    def loaded(self) -> bool:
        return self.is_loaded

    def unavailable_reason(self) -> str:
        return "Modele d'embeddings introuvable (test)." if not self.is_available else ""

    def load(self) -> None:
        self.warm_calls += 1
        self.is_loaded = True

    def _encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for row, text in enumerate(texts):
            for word in _WORD.findall(text):
                w = _fold(word)
                w = self.aliases.get(w, w)
                out[row, zlib.crc32(w.encode()) % self.dim] += 1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.where(norms == 0, 1.0, norms)

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        self.passage_texts.extend(texts)
        return self._encode(texts)

    def embed_queries(self, texts: list[str]) -> np.ndarray:
        self.query_texts.extend(texts)
        return self._encode(texts)


def prose(prefix: str, n: int) -> str:
    """n mots distincts, une phrase par 12 mots (pour les extraits)."""
    words = [f"{prefix}{i}" for i in range(n)]
    sentences = [" ".join(words[i : i + 12]) + "." for i in range(0, n, 12)]
    return " ".join(sentences)


def page(
    app: str,
    doc: str,
    lang: str,
    title: str,
    sections: list[tuple[str, str]],
    *,
    doc_type: str | None = None,
    audience: str = "user",
    tags: str = "[alpha, beta]",
) -> str:
    """Page markdown avec frontmatter ; `sections` = [(titre H2, corps)]."""
    head = (
        f"---\napp: {app}\ndoc_type: {doc_type or doc}\naudience: {audience}\nlang: {lang}\n"
        f"title: {title}\norder: 10\ntags: {tags}\nsources: [x.py]\n---\n\n# {title}\n\nIntro courte.\n"
    )
    return head + "".join(f"\n## {h}\n\n{body}\n" for h, body in sections)


MANIFEST = {
    "version": 1,
    "doc_set": [
        {"name": "user-guide", "doc_type": "user-guide", "audience": "user", "order": 10},
        {"name": "architecture", "doc_type": "architecture", "audience": "dev", "order": 60},
    ],
    "sources": [
        {"id": "suite", "dir": ".", "docs_path": "docs", "indexed": True},
        {"id": "annotation", "dir": "Annotation_App", "indexed": True},
        {"id": "dvc", "dir": "DVC_App", "indexed": True},
    ],
}


def make_settings(tmp_path: Path, repo_root: Path, model_name: str = "fake-model") -> Settings:
    return Settings(
        repo_root=repo_root,
        workspace=tmp_path / "ws",
        user="test",
        model_name=model_name,
        model_dir=tmp_path / "no-model",
        device=None,
        seed_path=tmp_path / "seed.sqlite",
    )
