"""Embeddings e5 avec transformers seul (sentence_transformers n'est pas requis).

Les modeles e5 attendent les prefixes "query: " (questions) et "passage: " (documents).
Pooling moyen sur le masque d'attention, puis normalisation L2 : cosinus = produit scalaire.
Le modele se charge a la demande, jamais a l'import ni au demarrage du serveur.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Protocol

import numpy as np

from backend.model_paths import missing_files

logger = logging.getLogger(__name__)

MAX_LENGTH = 512
BATCH_SIZE = 32


class Embedder(Protocol):
    """Contrat commun a E5Embedder et aux embedders factices des tests."""

    model_id: str
    dim: int
    device: str | None

    @property
    def available(self) -> bool: ...

    @property
    def loaded(self) -> bool: ...

    def unavailable_reason(self) -> str: ...

    def load(self) -> None: ...

    def embed_passages(self, texts: list[str]) -> np.ndarray: ...

    def embed_queries(self, texts: list[str]) -> np.ndarray: ...


def _read_hidden_size(model_dir: Path) -> int:
    try:
        return int(json.loads((model_dir / "config.json").read_text(encoding="utf-8"))["hidden_size"])
    except (OSError, ValueError, KeyError):
        return 0


class E5Embedder:
    def __init__(self, model_id: str, model_dir: Path, device: str | None = None) -> None:
        self.model_id = model_id
        self.model_dir = model_dir
        self._requested_device = device
        self.device: str | None = device
        # La dimension vient de config.json : connue avant le chargement, pour /index/status.
        self.dim = _read_hidden_size(model_dir)
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()
        self._tokenizer = None
        self._model = None
        self.load_error: str | None = None

    @property
    def available(self) -> bool:
        return not missing_files(self.model_dir)

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def unavailable_reason(self) -> str:
        missing = missing_files(self.model_dir)
        if not missing:
            return ""
        return (
            f"Modele d'embeddings introuvable dans {self.model_dir} (manque : {', '.join(missing)}). "
            "Lancez `python scripts/download_model.py` une fois en ligne."
        )

    def load(self) -> None:
        with self._load_lock:
            if self._model is not None:
                return
            if not self.available:
                raise FileNotFoundError(self.unavailable_reason())
            # torch et transformers sont lourds : importes ici, pas au demarrage du serveur.
            import torch
            from transformers import AutoModel, AutoTokenizer
            from transformers.utils import logging as hf_logging

            # Sinon : des centaines de lignes tqdm et un rapport sur position_ids (inoffensif).
            hf_logging.disable_progress_bar()
            hf_logging.set_verbosity_error()
            device = self._requested_device or ("cuda" if torch.cuda.is_available() else "cpu")
            try:
                tokenizer = AutoTokenizer.from_pretrained(str(self.model_dir), local_files_only=True)
                model = AutoModel.from_pretrained(str(self.model_dir), local_files_only=True)
                model.eval().to(device)
            except Exception as exc:  # poids corrompus, CUDA indisponible, memoire : on garde le message
                self.load_error = f"{type(exc).__name__}: {exc}"
                raise
            self._tokenizer, self._model, self.device = tokenizer, model, device
            self.dim = int(model.config.hidden_size)
            self.load_error = None
            logger.info("modele %s charge sur %s (dim %d)", self.model_id, device, self.dim)

    def _encode(self, texts: list[str]) -> np.ndarray:
        import torch

        if self._model is None:
            self.load()
        out: list[np.ndarray] = []
        with self._lock, torch.inference_mode():
            for start in range(0, len(texts), BATCH_SIZE):
                batch = texts[start : start + BATCH_SIZE]
                enc = self._tokenizer(
                    batch, max_length=MAX_LENGTH, padding=True, truncation=True, return_tensors="pt"
                ).to(self.device)
                hidden = self._model(**enc).last_hidden_state
                mask = enc["attention_mask"].unsqueeze(-1).to(hidden.dtype)
                pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
                pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
                out.append(pooled.float().cpu().numpy())
        return np.vstack(out) if out else np.zeros((0, self.dim), dtype=np.float32)

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        return self._encode([f"passage: {t}" for t in texts])

    def embed_queries(self, texts: list[str]) -> np.ndarray:
        return self._encode([f"query: {t}" for t in texts])
