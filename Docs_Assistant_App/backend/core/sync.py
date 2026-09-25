"""Synchronisation incrementale des docs vers l'index.

Un fichier au sha256 inchange est ignore. Seuls les passages dont le chunk_hash n'a pas
de vecteur pour le modele courant sont embeddes : une section editee ne re-embedde que ses
propres passages, un fichier deplace ou renomme rien du tout. Changer de modele repart de
zero une fois.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

from backend.core.chunker import chunk_document
from backend.core.embedder import Embedder
from backend.core.sources import scan_sources
from backend.core.store import Snapshot, Store

logger = logging.getLogger(__name__)

EMBED_BATCH = 64


class SyncManager:
    def __init__(self, store: Store, embedder: Embedder, repo_root: Path) -> None:
        self.store = store
        self.embedder = embedder
        self.repo_root = repo_root
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._warming = False
        self._snapshot = Snapshot.empty()
        self._state: dict = {
            "syncing": False,
            "phase": "idle",
            "files_total": 0,
            "files_done": 0,
            "chunks_to_embed": 0,
            "chunks_embedded": 0,
            "last_error": None,
            "model_error": None,
            "last_sync_at": None,
            "last_sync_seconds": None,
        }
        self.refresh_snapshot()

    # ---- etat ------------------------------------------------------------ #

    @property
    def snapshot(self) -> Snapshot:
        return self._snapshot

    def status(self) -> dict:
        with self._lock:
            state = dict(self._state)
        state["progress"] = {
            "phase": state.pop("phase"),
            "files_total": state.pop("files_total"),
            "files_done": state.pop("files_done"),
            "chunks_to_embed": state.pop("chunks_to_embed"),
            "chunks_embedded": state.pop("chunks_embedded"),
        }
        return state

    @property
    def syncing(self) -> bool:
        return bool(self._state["syncing"])

    def _set(self, **values: object) -> None:
        with self._lock:
            self._state.update(values)

    def refresh_snapshot(self) -> None:
        # Remplacement d'un bloc : une recherche en cours garde l'ancienne vue coherente.
        self._snapshot = self.store.load_snapshot(self.embedder.model_id)

    # ---- lancement ---------------------------------------------------------- #

    def start(self, rebuild: bool = False) -> bool:
        """Lance la sync en arriere-plan. False si une sync tourne deja (appel idempotent)."""
        with self._lock:
            if self._state["syncing"]:
                return False
            self._state.update(syncing=True, phase="starting", last_error=None)
        self._thread = threading.Thread(
            target=self._thread_main, args=(rebuild,), name="docs-sync", daemon=True
        )
        self._thread.start()
        return True

    def wait(self, timeout: float | None = None) -> None:
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _thread_main(self, rebuild: bool) -> None:
        try:
            self._run(rebuild)
        except (
            Exception
        ) as exc:  # le thread ne doit jamais mourir en silence : l'erreur va dans /index/status
            logger.exception("sync en echec")
            self._set(last_error=f"{type(exc).__name__}: {exc}")
        finally:
            self._set(syncing=False, phase="idle")
        self.warm_model_blocking()

    def warm_model(self) -> None:
        """Charge le modele en arriere-plan (idempotent) ; les requetes restent en mots-cles."""
        if self.embedder.loaded or not self.embedder.available:
            return
        with self._lock:
            if self._warming:
                return
            self._warming = True
        threading.Thread(target=self.warm_model_blocking, name="docs-warm", daemon=True).start()

    def warm_model_blocking(self) -> None:
        if self.embedder.loaded or not self.embedder.available:
            return
        with self._lock:
            self._warming = True
        try:
            self.embedder.load()
            self._set(model_error=None)
        except Exception as exc:  # poids illisibles, CUDA, memoire : signale sans planter
            logger.warning("chargement du modele impossible : %s", exc)
            self._set(model_error=f"{type(exc).__name__}: {exc}")
        finally:
            with self._lock:
                self._warming = False

    # ---- corps de la sync ----------------------------------------------------- #

    def run_blocking(self, rebuild: bool = False) -> None:
        """Sync synchrone (tests, scripts). Meme code que le thread d'arriere-plan."""
        self._set(syncing=True, phase="starting", last_error=None)
        try:
            self._run(rebuild)
        finally:
            self._set(syncing=False, phase="idle")

    def _run(self, rebuild: bool) -> None:
        started = time.monotonic()
        model_id = self.embedder.model_id
        self._set(phase="scanning", files_total=0, files_done=0, chunks_to_embed=0, chunks_embedded=0)
        try:
            docs = scan_sources(self.repo_root)
        except (OSError, ValueError, KeyError) as exc:
            self._set(last_error=f"Sources de doc illisibles ({self.repo_root}) : {exc}")
            return

        if rebuild:
            self.store.clear_all()
        if self.store.meta_get("model_id") != model_id:
            # Vecteurs d'un autre modele : inutilisables (dimension et espace differents).
            self.store.drop_other_models(model_id)
            self.store.meta_set(model_id=model_id)

        known = self.store.file_hashes()
        changed = [d for d in docs if known.get(d.path) != d.sha256]
        removed = set(known) - {d.path for d in docs}
        self._set(phase="chunking", files_total=len(changed))
        for done, doc in enumerate(changed, start=1):
            chunks = chunk_document(
                doc.body, app=doc.app, doc_name=doc.doc_name, title=doc.title, app_label=doc.app_label
            )
            self.store.replace_file(doc, chunks)
            self._set(files_done=done)
        if removed:
            self.store.remove_files(removed)
        # Les mots-cles marchent des maintenant, avant meme la fin des embeddings.
        self.refresh_snapshot()

        self._embed_missing(model_id)
        self.store.gc_embeddings()
        self.refresh_snapshot()

        seconds = round(time.monotonic() - started, 2)
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        self.store.meta_set(last_sync_at=now, last_sync_seconds=seconds)
        self._set(last_sync_at=now, last_sync_seconds=seconds)

    def _embed_missing(self, model_id: str) -> None:
        todo = self.store.missing_embeddings(model_id)
        self._set(phase="embedding", chunks_to_embed=len(todo), chunks_embedded=0)
        if not todo:
            return
        if not self.embedder.available:
            self._set(last_error=self.embedder.unavailable_reason())
            return
        # Tri par longueur : moins de padding dans chaque batch.
        todo.sort(key=lambda item: len(item[1]))
        try:
            for start in range(0, len(todo), EMBED_BATCH):
                batch = todo[start : start + EMBED_BATCH]
                vectors = self.embedder.embed_passages([text for _, text in batch])
                self.store.save_embeddings(model_id, [h for h, _ in batch], vectors)
                self.store.meta_set(dim=vectors.shape[1])
                self._set(chunks_embedded=start + len(batch))
        except Exception as exc:  # chargement ou inference : l'index reste utilisable en mots-cles
            logger.exception("embedding en echec")
            self._set(last_error=f"Embeddings interrompus : {type(exc).__name__}: {exc}")
