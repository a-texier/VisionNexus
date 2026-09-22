# ============================================================
# db/models.py
# Modèles SQLModel — schéma de la base de données.
#
# NOTE : PAS de "from __future__ import annotations" ici.
#        SQLAlchemy 2.x évalue les annotations des relationships
#        à l'exécution — les lazy strings (PEP 563) cassent le mapper.
#
# Tables :
#   Dataset          — un scan de dossier d'images
#   Image            — une image dans un dataset
#   Embedding        — vecteur CLIP (float32, L2-normalisé)
#   ClusterCentroid  — centroïde KMeans par cluster/dataset
#   Subset           — collection d'images (symlinks)
#   SubsetImage      — table de jointure Subset <-> Image
#
# Invariant : tous les embeddings sont L2-normalisés
#             => cosine_similarity = dot_product
# ============================================================

from datetime import datetime
from typing import List, Optional

from sqlmodel import Field, Relationship, SQLModel


# ---- Folder --------------------------------------------------------
# Arborescence de dossiers pour organiser les datasets (step 3).
# is_global=True → dossier partagé (miroir des datasets globaux) :
#   persisté aussi dans folders_registry.json et re-synchronisé dans chaque
#   workspace par son `uid` stable. is_global=False → dossier perso (workspace).

class Folder(SQLModel, table=True):
    __tablename__ = "folder"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(max_length=255)
    parent_id: Optional[int] = Field(default=None, foreign_key="folder.id", index=True)
    is_global: bool = Field(default=False)
    uid: Optional[str] = Field(default=None, index=True)   # clé stable cross-workspace (dossiers partagés)
    added_by: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ---- Dataset -------------------------------------------------------

class Dataset(SQLModel, table=True):
    __tablename__ = "dataset"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, max_length=255)
    root_path: str                              # chemin absolu scanné
    recursive: bool = Field(default=True)
    image_count: int = Field(default=0)
    embedded_count: int = Field(default=0)      # images avec embedding calculé
    status: str = Field(default="pending")      # pending | embedding | ready | error
    error_message: Optional[str] = Field(default=None)  # detail reel si status="error"
    faiss_index_path: Optional[str] = Field(default=None)
    umap_cached: bool = Field(default=False)
    n_clusters: int = Field(default=20)
    is_global: bool = Field(default=False)      # vrai = partagé dans dataset_gallery/
    added_by: Optional[str] = Field(default=None)  # utilisateur qui a créé ce dataset
    reduction_settings_hash: Optional[str] = Field(default=None)  # hash des params de réduction utilisés
    reduction_method: Optional[str] = Field(default=None)     # umap | tsne | pca (méthode 2D appliquée)
    reduction_params_json: Optional[str] = Field(default=None)  # JSON des hyperparamètres de réduction appliqués
    cluster_method: Optional[str] = Field(default=None)       # kmeans | hdbscan (méthode appliquée)
    cluster_params_json: Optional[str] = Field(default=None)  # JSON : {"n_clusters":20} ou {"min_cluster_size":5}
    folder_id: Optional[int] = Field(default=None, foreign_key="folder.id", index=True)  # dossier (step 3)

    # Filtrage rapide par embeddings (step 4) + tags auto (step 5)
    mean_embedding_blob: Optional[bytes] = Field(default=None)  # centroïde L2-normalisé du dataset
    auto_tags_json: Optional[str] = Field(default=None)         # JSON list[str] — tags CLIP zero-shot

    # Métadonnées d'annotation référencées (step 6)
    annotation_path: Optional[str] = Field(default=None)
    annotation_format: Optional[str] = Field(default=None)   # ver | yolo_folder | yolo_txt
    annotation_name: Optional[str] = Field(default=None)
    annotation_frames: Optional[int] = Field(default=None)
    annotation_boxes: Optional[int] = Field(default=None)

    # Métadonnées tabulaires liées (CSV/Excel associé à l'import)
    metadata_path: Optional[str] = Field(default=None)          # fichier source .csv/.xlsx
    metadata_key_column: Optional[str] = Field(default=None)    # colonne servant de clé (match sur le nom de fichier)
    metadata_columns_json: Optional[str] = Field(default=None)  # JSON list[str] des colonnes disponibles
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    images: List["Image"] = Relationship(back_populates="dataset")
    subsets: List["Subset"] = Relationship(back_populates="dataset")
    centroids: List["ClusterCentroid"] = Relationship(back_populates="dataset")


# ---- Image ---------------------------------------------------------

class Image(SQLModel, table=True):
    __tablename__ = "image"

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_id: int = Field(foreign_key="dataset.id", index=True)
    file_path: str                              # chemin absolu original
    filename: str                               # basename
    md5: Optional[str] = Field(default=None, index=True)  # cache key
    width: int = Field(default=0)
    height: int = Field(default=0)
    file_size_bytes: int = Field(default=0)
    thumbnail_path: Optional[str] = Field(default=None)   # URL relative /thumbs/{md5}.jpg

    # Résultats pipeline
    umap_x: Optional[float] = Field(default=None)
    umap_y: Optional[float] = Field(default=None)
    cluster_id: Optional[int] = Field(default=None)
    rarity_score: Optional[float] = Field(default=None)   # 0=commun, 1=rare

    # Doublons
    duplicate_group_id: Optional[int] = Field(default=None)
    is_duplicate_kept: Optional[bool] = Field(default=None)  # None=non décidé

    # Métadonnées tabulaires liées (dict JSON issu de la ligne CSV/Excel associée)
    metadata_json: Optional[str] = Field(default=None)

    dataset: Optional["Dataset"] = Relationship(back_populates="images")
    embedding: Optional["Embedding"] = Relationship(back_populates="image")
    subset_links: List["SubsetImage"] = Relationship(back_populates="image")


# ---- Embedding -----------------------------------------------------

class Embedding(SQLModel, table=True):
    __tablename__ = "embedding"

    id: Optional[int] = Field(default=None, primary_key=True)
    image_id: int = Field(foreign_key="image.id", unique=True, index=True)
    vector_blob: bytes                          # float32 L2-normalisé, 512 dims
    dim: int = Field(default=512)
    model_name: str = Field(default="ViT-B-32")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    image: Optional["Image"] = Relationship(back_populates="embedding")


# ---- ClusterCentroid -----------------------------------------------

class ClusterCentroid(SQLModel, table=True):
    __tablename__ = "cluster_centroid"

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_id: int = Field(foreign_key="dataset.id", index=True)
    cluster_id: int
    centroid_blob: bytes                        # float32, même dim que embeddings
    size: int = Field(default=0)               # nb images dans ce cluster

    dataset: Optional["Dataset"] = Relationship(back_populates="centroids")


# ---- Subset --------------------------------------------------------

class Subset(SQLModel, table=True):
    __tablename__ = "subset"

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset_id: int = Field(foreign_key="dataset.id", index=True)
    name: str = Field(index=True, max_length=255)
    symlink_dir: Optional[str] = Field(default=None)
    image_count: int = Field(default=0)
    exported_to_annotation_app: bool = Field(default=False)
    export_path: Optional[str] = Field(default=None)   # premier export (compat)
    locked: bool = Field(default=False)   # protege contre la suppression accidentelle
    created_at: datetime = Field(default_factory=datetime.utcnow)

    dataset: Optional["Dataset"] = Relationship(back_populates="subsets")
    image_links: List["SubsetImage"] = Relationship(back_populates="subset")
    exports: List["SubsetExport"] = Relationship(back_populates="subset")


# ---- SubsetImage ---------------------------------------------------

class SubsetImage(SQLModel, table=True):
    __tablename__ = "subset_image"

    id: Optional[int] = Field(default=None, primary_key=True)
    subset_id: int = Field(foreign_key="subset.id", index=True)
    image_id: int = Field(foreign_key="image.id", index=True)

    subset: Optional["Subset"] = Relationship(back_populates="image_links")
    image: Optional["Image"] = Relationship(back_populates="subset_links")


# ---- SubsetExport --------------------------------------------------

class SubsetExport(SQLModel, table=True):
    """Historique des exports d'un subset (plusieurs exports possibles)."""
    __tablename__ = "subset_export"

    id: Optional[int] = Field(default=None, primary_key=True)
    subset_id: int = Field(foreign_key="subset.id", index=True)
    export_path: str
    export_type: str = Field(default="symlink")   # symlink | copy
    created_at: datetime = Field(default_factory=datetime.utcnow)

    subset: Optional["Subset"] = Relationship(back_populates="exports")
