# ============================================================
# core/indexer.py
# Gestion des index FAISS (IndexFlatIP — produit scalaire).
#
# Invariant : FAISS position i = Image avec rang i trié par
#             Image.id ascendant au moment de la construction.
#
# IndexFlatIP + vecteurs L2-normalisés = recherche cosine exacte.
# ============================================================

import logging
from collections import deque
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import faiss
import numpy as np

from backend.config import EMBED_DIM, FAISS_DIR

logger = logging.getLogger(__name__)

# Au-dela de ce nombre de vecteurs, l'index global passe de Flat (exact, O(N) par
# requete) a HNSW (approche, mais utilisable a l'echelle "data lake"). En dessous,
# Flat reste preferable : exact et sans parametre a regler.
GLOBAL_ANN_THRESHOLD = 200_000
HNSW_M = 32              # connexions par noeud (compromis memoire/rappel)
HNSW_EF_SEARCH = 128     # profondeur d'exploration a la recherche


class FAISSIndexer:
    """Wrapper FAISS : construction, persistance, recherche, doublons.

    Deux niveaux d'index coexistent :
      - un index par dataset (`_indexes`), exact, persiste sur disque ;
      - un index global optionnel (`_global_index`), construit en memoire a la
        demande par concatenation des index par dataset, pour la recherche et la
        deduplication *cross-dataset*. Il n'est jamais persiste : sa
        reconstruction est bon marche (les vecteurs sont deja en RAM) et evite
        tout probleme d'invalidation sur disque.
    """

    def __init__(self) -> None:
        self._indexes: Dict[int, faiss.IndexFlatIP] = {}
        # --- Index global (cross-dataset), reconstruit si la signature change ---
        self._global_index = None
        self._global_map: List[Tuple[int, int]] = []   # position globale -> (dataset_id, position locale)
        self._global_vectors: Optional[np.ndarray] = None
        self._global_sig: Tuple = ()

    # ------------------------------------------------------------------ #
    # Construction / chargement                                           #
    # ------------------------------------------------------------------ #

    def build(self, dataset_id: int, embeddings: np.ndarray) -> faiss.IndexFlatIP:
        """
        Construit un index FAISS et le sauvegarde sur disque.

        Args:
            dataset_id: identifiant du dataset.
            embeddings:  (N, EMBED_DIM) float32, L2-normalisé.
        """
        index = faiss.IndexFlatIP(EMBED_DIM)
        index.add(embeddings.astype(np.float32))
        self._indexes[dataset_id] = index
        self._save(dataset_id, index)
        self._invalidate_global()
        logger.info("FAISS index construit pour dataset %d (%d vecteurs)", dataset_id, embeddings.shape[0])
        return index

    def load(self, dataset_id: int, index_path: str) -> None:
        """Charge un index depuis le disque."""
        index = faiss.read_index(str(index_path))
        self._indexes[dataset_id] = index
        self._invalidate_global()
        logger.info("FAISS index charge pour dataset %d (%d vecteurs)", dataset_id, index.ntotal)

    def get(self, dataset_id: int) -> faiss.IndexFlatIP | None:
        return self._indexes.get(dataset_id)

    def remove(self, dataset_id: int) -> None:
        """Supprime l'index mémoire (le fichier doit être supprimé séparément)."""
        self._indexes.pop(dataset_id, None)
        self._invalidate_global()

    def _invalidate_global(self) -> None:
        """Force la reconstruction de l'index global au prochain usage.

        La signature (ids + tailles) ne suffit pas : un re-embed du même dataset
        produit le même nombre de vecteurs avec des valeurs différentes."""
        self._global_sig = ()

    # ------------------------------------------------------------------ #
    # Recherche                                                           #
    # ------------------------------------------------------------------ #

    def search(
        self,
        dataset_id: int,
        query: np.ndarray,
        top_k: int,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Recherche les top_k voisins les plus proches.

        Args:
            query: (1, EMBED_DIM) ou (EMBED_DIM,) float32.
        Returns:
            (scores, indices) de forme (1, top_k).
        """
        index = self._indexes.get(dataset_id)
        if index is None:
            raise RuntimeError(f"Aucun index FAISS pour dataset {dataset_id}")

        q = query.reshape(1, -1).astype(np.float32)
        k = min(top_k, index.ntotal)
        scores, indices = index.search(q, k)
        return scores, indices

    # ------------------------------------------------------------------ #
    # Détection de doublons                                               #
    # ------------------------------------------------------------------ #

    def find_duplicates(
        self,
        dataset_id: int,
        threshold: float = 0.97,
        max_neighbors: int = 50,
    ) -> List[List[int]]:
        """
        Retourne les groupes de doublons (composantes connexes).

        Args:
            threshold: seuil de similarité cosine (0–1).
            max_neighbors: nombre de candidats examinés par image. Un groupe de
                doublons plus large que cette valeur peut être scindé — augmenter
                si le dataset contient de très grandes rafales identiques.
        Returns:
            Liste de groupes ; chaque groupe = liste d'indices FAISS.
            Seuls les groupes de taille >= 2 sont retournés.
        """
        index = self._indexes.get(dataset_id)
        if index is None:
            raise RuntimeError(f"Aucun index FAISS pour dataset {dataset_id}")

        vectors = self.vectors_of(dataset_id)
        if vectors is None or vectors.shape[0] == 0:
            return []

        adjacency = self._build_adjacency(index, vectors, threshold, max_neighbors)
        return self._connected_components(adjacency)

    # ------------------------------------------------------------------ #
    # Helpers doublons (partagés dataset / global)                        #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_adjacency(
        index,
        vectors: np.ndarray,
        threshold: float,
        max_neighbors: int,
    ) -> Dict[int, set]:
        """Construit le graphe d'adjacence "similarité >= seuil" par batchs."""
        n = vectors.shape[0]
        k = min(max_neighbors, n)
        batch = 256
        adjacency: Dict[int, set] = {i: set() for i in range(n)}

        for start in range(0, n, batch):
            end = min(start + batch, n)
            scores, indices = index.search(vectors[start:end], k)

            for local_i, (row_scores, row_indices) in enumerate(zip(scores, indices)):
                global_i = start + local_i
                for score, j in zip(row_scores, row_indices):
                    j = int(j)
                    if j == -1 or j == global_i:
                        continue
                    if float(score) >= threshold:
                        adjacency[global_i].add(j)
                        adjacency[j].add(global_i)

        return adjacency

    @staticmethod
    def _connected_components(adjacency: Dict[int, set]) -> List[List[int]]:
        """Composantes connexes par BFS (deque : pop gauche en O(1))."""
        visited: set = set()
        groups: List[List[int]] = []

        for start_node in adjacency:
            if start_node in visited or not adjacency[start_node]:
                continue
            queue = deque([start_node])
            component: List[int] = []
            while queue:
                node = queue.popleft()
                if node in visited:
                    continue
                visited.add(node)
                component.append(node)
                queue.extend(adjacency[node] - visited)

            if len(component) >= 2:
                groups.append(sorted(component))

        return groups

    @staticmethod
    def _extract_vectors(index) -> np.ndarray:
        """Reconstitue la matrice (N, EMBED_DIM) stockée dans un index FAISS."""
        n = index.ntotal
        if n == 0:
            return np.zeros((0, EMBED_DIM), dtype=np.float32)
        return np.ascontiguousarray(index.reconstruct_n(0, n).astype(np.float32))

    def vectors_of(self, dataset_id: int) -> Optional[np.ndarray]:
        """Vecteurs d'un dataset, dans l'ordre FAISS (= Image.id ascendant)."""
        index = self._indexes.get(dataset_id)
        if index is None:
            return None
        return self._extract_vectors(index)

    def loaded_dataset_ids(self) -> List[int]:
        return sorted(self._indexes.keys())

    # ------------------------------------------------------------------ #
    # Index global (cross-dataset)                                        #
    # ------------------------------------------------------------------ #

    def ensure_global(self, dataset_ids: Optional[Sequence[int]] = None) -> int:
        """(Re)construit l'index global si nécessaire. Retourne le nb de vecteurs.

        La signature (ids + tailles) sert de cache : tant qu'aucun index par
        dataset n'a été (re)construit ou déchargé, l'index global est réutilisé.
        """
        ids = sorted(dataset_ids) if dataset_ids is not None else self.loaded_dataset_ids()
        ids = [i for i in ids if i in self._indexes]
        sig = tuple((i, int(self._indexes[i].ntotal)) for i in ids)

        if sig == self._global_sig and self._global_index is not None:
            return len(self._global_map)

        if not ids:
            self._global_index, self._global_map = None, []
            self._global_vectors, self._global_sig = None, ()
            return 0

        blocks, mapping = [], []
        for ds_id in ids:
            vecs = self._extract_vectors(self._indexes[ds_id])
            if vecs.shape[0] == 0:
                continue
            blocks.append(vecs)
            mapping.extend((ds_id, pos) for pos in range(vecs.shape[0]))

        if not blocks:
            self._global_index, self._global_map = None, []
            self._global_vectors, self._global_sig = None, ()
            return 0

        matrix = np.vstack(blocks).astype(np.float32)
        total = matrix.shape[0]

        if total > GLOBAL_ANN_THRESHOLD:
            index = faiss.IndexHNSWFlat(EMBED_DIM, HNSW_M, faiss.METRIC_INNER_PRODUCT)
            index.hnsw.efSearch = HNSW_EF_SEARCH
            kind = f"HNSW(M={HNSW_M})"
        else:
            index = faiss.IndexFlatIP(EMBED_DIM)
            kind = "Flat"
        index.add(matrix)

        self._global_index = index
        self._global_map = mapping
        self._global_vectors = matrix
        self._global_sig = sig
        logger.info("FAISS index global construit : %d vecteurs, %d datasets, %s", total, len(ids), kind)
        return total

    def global_size(self) -> int:
        return len(self._global_map)

    def search_global(
        self,
        query: np.ndarray,
        top_k: int,
        dataset_ids: Optional[Sequence[int]] = None,
    ) -> List[Tuple[int, int, float]]:
        """Recherche cross-dataset.

        Returns:
            Liste de (dataset_id, position locale FAISS, score), triée par score
            décroissant.
        """
        self.ensure_global()
        if self._global_index is None:
            raise RuntimeError("Aucun index FAISS charge — lancer /embed sur au moins un dataset")

        allowed = set(dataset_ids) if dataset_ids else None
        # Sur-echantillonnage quand un filtre est actif : les meilleurs voisins
        # peuvent appartenir a des datasets exclus.
        k = min(top_k * 5 if allowed else top_k, len(self._global_map))
        q = query.reshape(1, -1).astype(np.float32)
        scores, indices = self._global_index.search(q, max(k, 1))

        out: List[Tuple[int, int, float]] = []
        for score, idx in zip(scores[0], indices[0]):
            idx = int(idx)
            if idx < 0 or idx >= len(self._global_map):
                continue
            ds_id, local_pos = self._global_map[idx]
            if allowed and ds_id not in allowed:
                continue
            out.append((ds_id, local_pos, float(score)))
            if len(out) >= top_k:
                break
        return out

    def find_duplicates_global(
        self,
        threshold: float = 0.97,
        max_neighbors: int = 50,
        dataset_ids: Optional[Sequence[int]] = None,
    ) -> List[List[Tuple[int, int]]]:
        """Groupes de doublons cross-dataset.

        Returns:
            Liste de groupes ; chaque groupe = liste de (dataset_id, position
            locale FAISS). Seuls les groupes qui contiennent au moins 2 images
            sont retournés.
        """
        self.ensure_global(dataset_ids)
        if self._global_index is None or self._global_vectors is None:
            return []

        adjacency = self._build_adjacency(
            self._global_index, self._global_vectors, threshold, max_neighbors
        )
        return [
            [self._global_map[i] for i in component]
            for component in self._connected_components(adjacency)
        ]

    # ------------------------------------------------------------------ #
    # Persistance                                                         #
    # ------------------------------------------------------------------ #

    def _save(self, dataset_id: int, index: faiss.IndexFlatIP) -> str:
        path = self._index_path(dataset_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        faiss.write_index(index, str(path))
        return str(path)

    def _index_path(self, dataset_id: int) -> Path:
        return FAISS_DIR / str(dataset_id) / "index.faiss"

    def index_path_str(self, dataset_id: int) -> str:
        return str(self._index_path(dataset_id))


# Singleton global
faiss_indexer = FAISSIndexer()
