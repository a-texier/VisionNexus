# ============================================================
# api/datasets.py
# Endpoints : scan, liste, images, pipeline d'embedding (SSE).
# Ajouts :
#   POST /api/datasets/merge    — fusionner plusieurs datasets (SSE)
#   POST /api/datasets/{id}/recluster — relancer KMeans + rareté
# ============================================================

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, func
from sqlmodel import Session, select

from backend.config import CURRENT_USER, DATASET_GALLERY_DIR, GLOBAL_REGISTRY_FILE, SUPPORTED_EXTENSIONS, THUMBS_DIR
from backend.core import audit
from backend.core.clusterer import clusterer
from backend.core.embedder import clip_embedder
from backend.core.indexer import faiss_indexer
from backend.core.job_runner import submit_job
from backend.core.reducer import umap_reducer
from backend.core.format_registry import get_format_for_filename, invoke_for_filename
from backend.db.database import get_session
from backend.db.models import ClusterCentroid, Dataset, Embedding, Folder, Image

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["datasets"])


# ------------------------------------------------------------------ #
# Registre global des datasets partagés                               #
# Persist dans DATASET_GALLERY_DIR/registry.json                     #
# Indépendant du workspace — permet d'afficher les datasets globaux  #
# même quand le workspace change.                                     #
# ------------------------------------------------------------------ #

def _load_global_registry() -> list[dict]:
    """Lit le fichier registry.json. Retourne [] si absent ou corrompu."""
    try:
        if GLOBAL_REGISTRY_FILE.exists():
            with open(GLOBAL_REGISTRY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
    except Exception as exc:
        logger.warning("Registre global illisible : %s", exc)
    return []


def _save_global_registry(entries: list[dict]) -> None:
    """Écrit le registre global sur disque de façon atomique.

    Utilise un fichier temporaire + rename pour éviter la race condition
    entre des requêtes concurrentes (poll toutes les 2s pendant le scan) :
    - open("w") tronque le fichier avant d'écrire → lecture d'un fichier vide possible
    - Path.replace() est atomique sur NTFS et les FS POSIX (rename(2))
    """
    import tempfile
    tmp_path: str | None = None
    try:
        GLOBAL_REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(GLOBAL_REGISTRY_FILE.parent),
            suffix=".tmp",
            delete=False,
        ) as tmp:
            json.dump(entries, tmp, ensure_ascii=False, default=str, indent=2)
            tmp_path = tmp.name
        Path(tmp_path).replace(GLOBAL_REGISTRY_FILE)
    except Exception as exc:
        logger.warning("Impossible d'ecrire le registre global : %s", exc)
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


def _compute_reduction_hash() -> str:
    """Hash des paramètres de réduction actuels (settings user).
    Permet de détecter si la carte UMAP/t-SNE/PCA est obsolète."""
    import hashlib
    try:
        from backend.api.settings import load_settings
        s = load_settings()
        key = (
            f"{s.reduction_method}:"
            f"{s.umap_n_neighbors}:{s.umap_min_dist}:"
            f"{s.tsne_perplexity}:{s.tsne_learning_rate}"
        )
    except Exception:
        key = "umap:15:0.1:30:200.0"
    return hashlib.md5(key.encode()).hexdigest()


def _load_cluster_settings() -> dict:
    """Méthode + hyperparams de clustering depuis les settings user."""
    try:
        from backend.api.settings import load_settings
        s = load_settings()
        return {
            "method": (s.cluster_method or "kmeans").lower(),
            "hdbscan_min_cluster_size": int(s.hdbscan_min_cluster_size),
        }
    except Exception:
        return {"method": "kmeans", "hdbscan_min_cluster_size": 5}


def _load_reduction_settings_full() -> dict:
    """Méthode + hyperparamètres de réduction dimensionnelle depuis les settings user.
    Sert de valeurs par défaut au pipeline d'embedding et au bouton 'Relancer la réduction'."""
    try:
        from backend.api.settings import load_settings
        s = load_settings()
        return {
            "method": (s.reduction_method or "umap").lower(),
            "umap_n_neighbors": int(s.umap_n_neighbors),
            "umap_min_dist": float(s.umap_min_dist),
            "tsne_perplexity": int(s.tsne_perplexity),
            "tsne_learning_rate": float(s.tsne_learning_rate),
        }
    except Exception:
        return {"method": "umap", "umap_n_neighbors": 15, "umap_min_dist": 0.1,
                "tsne_perplexity": 30, "tsne_learning_rate": 200.0}


def _reduction_display_params(method: str, params: dict) -> dict:
    """Sous-ensemble des hyperparamètres pertinents pour la méthode (affichage UI)."""
    method = (method or "umap").lower()
    if method == "umap":
        return {"n_neighbors": params.get("umap_n_neighbors", 15),
                "min_dist": params.get("umap_min_dist", 0.1)}
    if method == "tsne":
        return {"perplexity": params.get("tsne_perplexity", 30),
                "learning_rate": params.get("tsne_learning_rate", 200.0)}
    return {}   # PCA : pas d'hyperparamètre


def _store_reduction_config(ds: "Dataset", params: dict) -> None:
    """Mémorise sur le dataset la méthode + hyperparams de réduction 2D appliqués."""
    method = (params.get("method") or "umap").lower()
    ds.reduction_method = method
    ds.reduction_params_json = json.dumps(_reduction_display_params(method, params))


def _embeddings_by_image_id(db, image_ids: list) -> dict:
    """{image_id: vecteur float32} pour une liste d'ids, en une seule requete.

    SQLite plafonne le nombre de parametres d'un IN (~999 par defaut), d'ou le
    decoupage en tranches."""
    out: dict = {}
    if not image_ids:
        return out
    CHUNK = 900
    for start in range(0, len(image_ids), CHUNK):
        chunk = image_ids[start:start + CHUNK]
        for emb in db.exec(select(Embedding).where(Embedding.image_id.in_(chunk))).all():
            # .copy() : frombuffer renvoie une vue en lecture seule sur le blob
            out[emb.image_id] = np.frombuffer(emb.vector_blob, dtype=np.float32).copy()
    return out


def _vectors_for_images(db, images: list):
    """(vecteurs, images valides) pour une liste d'Image, en une seule requete.

    Les images sans embedding sont ecartees des deux listes, qui restent donc
    alignees index par index (invariant attendu par le clustering/UMAP)."""
    blobs = _embeddings_by_image_id(db, [img.id for img in images])
    vecs: list = []
    valid: list = []
    for img in images:
        vec = blobs.get(img.id)
        if vec is not None:
            vecs.append(vec)
            valid.append(img)
    return vecs, valid


def _load_dataset_embeddings(db, dataset_id: int, active_only: bool = False):
    """Charge la matrice d'embeddings (N, 512) alignée avec les image_ids.

    Utilisé par le filtrage CLIP (step 4) et le merge filtré (step 6). Retourne
    (embeddings float32 [N,512], image_ids list[int]). Les vecteurs sont déjà
    L2-normalisés en base → produit scalaire = cosine.
    """
    q = (
        select(Image)
        .where(Image.dataset_id == dataset_id)
        .order_by(Image.id)
    )
    if active_only:
        q = q.where(Image.is_duplicate_kept.is_not(False))
    images = db.exec(q).all()
    # Une seule requete pour tous les embeddings (et non un SELECT par image :
    # sur 9k images cela faisait 9k allers-retours SQLite).
    blobs = _embeddings_by_image_id(db, [img.id for img in images])
    vecs: list = []
    ids: list = []
    for img in images:
        vec = blobs.get(img.id)
        if vec is not None:
            vecs.append(vec)
            ids.append(img.id)
    if not vecs:
        return np.zeros((0, 512), dtype=np.float32), []
    return np.vstack(vecs).astype(np.float32), ids


def _dataset_cluster_spec(ds: Dataset, n_clusters: int) -> tuple[str, dict]:
    """Methode et parametres de clustering propres a ce dataset (rebuild, reset) :
    un dataset HDBSCAN reste HDBSCAN au lieu de repasser en KMeans."""
    if (ds.cluster_method or "kmeans").lower() == "hdbscan":
        try:
            saved = json.loads(ds.cluster_params_json or "{}")
        except ValueError:
            saved = {}
        default = _load_cluster_settings()["hdbscan_min_cluster_size"]
        return "hdbscan", {"min_cluster_size": int(saved.get("min_cluster_size", default))}
    return "kmeans", {"n_clusters": n_clusters}


def _apply_clustering(db, dataset_id: int, embeddings: np.ndarray, images: list,
                      method: str, params: dict) -> int:
    """Applique KMeans ou HDBSCAN sur `embeddings` (alignés avec `images`),
    met à jour cluster_id + ClusterCentroid + rarity_score, et renseigne
    dataset.cluster_method / cluster_params_json / n_clusters.

    Réutilisé par le pipeline d'embedding ET le recluster. Retourne le nombre
    de clusters effectifs (hors bruit pour HDBSCAN).
    """
    method = (method or "kmeans").lower()
    n = len(embeddings)

    if method == "hdbscan":
        min_cluster_size = max(2, int(params.get("min_cluster_size", 5)))
        labels = clusterer.hdbscan_cluster(embeddings, min_cluster_size=min_cluster_size)
        valid = sorted({int(l) for l in labels if l >= 0})
        max_label = max(valid) if valid else -1
        centroids = np.zeros((max_label + 1, embeddings.shape[1]), dtype=np.float32)
        for l in valid:
            centroids[l] = embeddings[labels == l].mean(axis=0)
        n_clusters = len(valid)
        used_params = {"min_cluster_size": min_cluster_size}
    else:
        method = "kmeans"
        n_clusters = min(max(1, int(params.get("n_clusters", 20))), max(1, n))
        labels, centroids = clusterer.kmeans(embeddings, n_clusters)
        used_params = {"n_clusters": n_clusters}

    for img, label in zip(images, labels):
        img.cluster_id = int(label)

    old = db.exec(
        select(ClusterCentroid).where(ClusterCentroid.dataset_id == dataset_id)
    ).all()
    for c in old:
        db.delete(c)
    for cid in range(len(centroids)):
        cnt = int((labels == cid).sum())
        if cnt == 0:
            continue
        db.add(ClusterCentroid(
            dataset_id=dataset_id,
            cluster_id=cid,
            centroid_blob=centroids[cid].astype(np.float32).tobytes(),
            size=cnt,
        ))

    rarity = clusterer.compute_rarity_scores(embeddings, centroids, labels)
    for img, score in zip(images, rarity):
        img.rarity_score = float(score)

    ds = db.get(Dataset, dataset_id)
    ds.cluster_method = method
    ds.cluster_params_json = json.dumps(used_params)
    if n_clusters >= 1:
        ds.n_clusters = n_clusters
    return n_clusters


def _parse_json_list(raw: Optional[str]) -> list:
    """Parse un JSON list[str] stocké en colonne ; [] si vide/invalide."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _parse_json_dict(raw: Optional[str]) -> dict:
    """Parse un JSON dict stocké en colonne ; {} si vide/invalide."""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _enrich_global_registry(root_path: str, *,
                            mean_embedding_b64=None, annotation=None) -> None:
    """Enrichit l'entrée registre d'un dataset global avec les métadonnées de
    filtrage (centroïde base64, annotation) — pour les workspaces qui ne l'ont
    pas encore importé. None = conserver la valeur existante."""
    entries = _load_global_registry()
    hit = False
    for e in entries:
        if e.get("root_path") == root_path:
            if mean_embedding_b64 is not None:
                e["mean_embedding_b64"] = mean_embedding_b64
            if annotation is not None:
                e["annotation"] = annotation
            hit = True
            break
    if hit:
        _save_global_registry(entries)


def _parse_cluster_params(cluster_params_json: Optional[str], dataset: "Dataset") -> dict:
    """Params de clustering pour l'affichage. Fallback : KMeans avec n_clusters
    si la colonne cluster_params_json est absente/vide mais le dataset est prêt."""
    if cluster_params_json:
        try:
            data = json.loads(cluster_params_json)
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    if getattr(dataset, "umap_cached", False):
        return {"n_clusters": dataset.n_clusters}
    return {}


def _compute_basic_gallery_stats(dataset_id: int, session) -> dict:
    """Calcule les stats légères à stocker dans le registre global.
    Rapide : uniquement width/height/format depuis les rows Image (pas d'I/O disque)."""
    images = session.exec(
        select(Image).where(Image.dataset_id == dataset_id)
    ).all()
    if not images:
        return {}
    widths  = [img.width  for img in images if img.width]
    heights = [img.height for img in images if img.height]
    fmt_dist: dict[str, int] = {}
    for img in images:
        from pathlib import Path as _Path
        ext = _Path(img.filename).suffix.lower() or "?"
        fmt_dist[ext] = fmt_dist.get(ext, 0) + 1
    return {
        "avg_width":  round(sum(widths)  / len(widths))  if widths  else 0,
        "avg_height": round(sum(heights) / len(heights)) if heights else 0,
        "format_distribution": fmt_dist,
    }


def _upsert_global_registry(
    summary: "DatasetSummary",
    gallery_thumb_urls: list[str] | None = None,
    basic_stats: dict | None = None,
    folder_uid: str | None = None,
) -> None:
    """Ajoute ou met à jour une entrée dans le registre global.

    Stocke le minimum vital : chemin, stats de base, 5 thumbnail URLs fixes.
    Paramètres None = conserver la valeur existante.
    `folder_uid` = uid du dossier partagé de destination (step 3) ; None conserve.
    """
    entries = _load_global_registry()
    existing = next((e for e in entries if e.get("root_path") == summary.root_path), None)

    existing_thumbs = existing.get("gallery_thumb_urls", []) if existing else []
    existing_stats  = existing.get("basic_stats", {}) if existing else {}
    existing_added_by = existing.get("added_by") if existing else None
    existing_folder_uid = existing.get("folder_uid") if existing else None

    entry = {
        "name": summary.name,
        "root_path": summary.root_path,
        "image_count": summary.image_count,
        "n_clusters": summary.n_clusters,
        "is_global": True,
        "created_at": str(summary.created_at),
        "gallery_thumb_urls": gallery_thumb_urls if gallery_thumb_urls is not None else existing_thumbs,
        "basic_stats": basic_stats if basic_stats is not None else existing_stats,
        "added_by": summary.added_by if summary.added_by is not None else existing_added_by,
        "folder_uid": folder_uid if folder_uid is not None else existing_folder_uid,
    }
    entries = [e for e in entries if e.get("root_path") != summary.root_path]
    entries.append(entry)
    _save_global_registry(entries)


# ------------------------------------------------------------------ #
# Schémas de requête / réponse                                        #
# ------------------------------------------------------------------ #

class DatasetCreate(BaseModel):
    root_path: str
    name: Optional[str] = None
    recursive: bool = True
    n_clusters: int = 20
    share_dataset: bool = False  # si True : symlink dans dataset_gallery + is_global=True
    folder_id: Optional[int] = None  # dossier de destination (step 3)
    annotation_path: Optional[str] = None  # .ver / dossier YOLO / .txt (step 6)
    annotation_name: Optional[str] = None
    metadata_path: Optional[str] = None        # CSV/Excel de métadonnées à associer
    metadata_key_column: Optional[str] = None  # colonne clé (match sur nom de fichier)
    allow_duplicate: bool = False              # créer même si root_path déjà indexé (409 sinon)


class DatasetSummary(BaseModel):
    id: int
    name: str
    root_path: str
    image_count: int
    embedded_count: int
    status: str
    umap_cached: bool
    n_clusters: int
    is_global: bool = False
    in_workspace: bool = True   # False = dataset global visible depuis le registre, pas encore dans ce workspace
    created_at: datetime
    updated_at: datetime
    rejected_count: int = 0
    map_needs_rebuild: bool = False    # True si des images rejetées ont encore des coords UMAP
    map_method_outdated: bool = False  # True si les params de réduction ont changé depuis le build
    gallery_thumb_urls: list[str] = []  # URLs miniatures gallery fixes (toujours accessibles)
    registry_stats: dict = {}           # stats légères stockées dans registry (pour non-workspace globals)
    scan_progress: int = 0             # images scannées (état transitoire, 0 quand fini)
    scan_total: int = 0                # total images à scanner
    added_by: Optional[str] = None  # utilisateur ayant créé ce dataset (global uniquement) (0 avant glob)
    error_message: Optional[str] = None  # detail reel si status="error" (permission, chemin...)

    # Progression du pipeline d'embedding (background task — poll, robuste SSH)
    embed_progress: int = 0
    embed_total: int = 0
    embed_phase: str = ""              # embedding | indexing | umap | clustering | scoring

    # Progression des thumbnails asynchrones
    thumb_progress: int = 0
    thumb_total: int = 0

    # Progression du reclustering
    recluster_progress: int = 0
    recluster_total: int = 0
    recluster_phase: str = ""

    # Progression de la réduction dimensionnelle (relance UMAP/t-SNE/PCA en fond)
    reduce_progress: int = 0
    reduce_total: int = 0
    reduce_phase: str = ""

    # Config de clustering effectivement appliquée (affichage Playground/Carte)
    cluster_method: Optional[str] = None       # kmeans | hdbscan
    cluster_params: dict = {}                   # ex : {"n_clusters": 20} ou {"min_cluster_size": 5}

    # Config de réduction 2D effectivement appliquée
    reduction_method: Optional[str] = None      # umap | tsne | pca
    reduction_params: dict = {}                 # ex : {"n_neighbors": 15, "min_dist": 0.1}

    # Dossier (step 3) — arborescence d'organisation
    folder_id: Optional[int] = None

    # Annotation (step 6) — pour filtrage additif
    has_annotations: bool = False
    annotation_name: Optional[str] = None
    annotation_format: Optional[str] = None
    annotation_frames: Optional[int] = None
    annotation_boxes: Optional[int] = None

    # Métadonnées tabulaires liées (CSV/Excel)
    metadata_columns: list[str] = []
    metadata_key_column: Optional[str] = None

    # Doublons (même root_path, un autre nom) — pour avertir dans la galerie
    duplicate_of: list[dict] = []  # [{"id": int, "name": str}, ...]


class ImageSummary(BaseModel):
    id: int
    filename: str
    file_path: str
    thumbnail_url: Optional[str]
    width: int
    height: int
    cluster_id: Optional[int]
    rarity_score: Optional[float]
    umap_x: Optional[float]
    umap_y: Optional[float]
    duplicate_group_id: Optional[int]
    is_duplicate_kept: Optional[bool]
    metadata: dict = {}   # métadonnées tabulaires liées (CSV/Excel), {} si aucune


class ImagePage(BaseModel):
    total: int
    page: int
    limit: int
    items: List[ImageSummary]


class ReclusterRequest(BaseModel):
    n_clusters: int = 20
    method: str = "kmeans"          # kmeans | hdbscan
    min_cluster_size: int = 5       # HDBSCAN


class ReduceRequest(BaseModel):
    """Relance de la réduction dimensionnelle 2D (indépendante du clustering)."""
    method: str = "umap"            # umap | tsne | pca
    umap_n_neighbors: int = 15
    umap_min_dist: float = 0.1
    tsne_perplexity: int = 30
    tsne_learning_rate: float = 200.0


class ExcludeImagesRequest(BaseModel):
    image_ids: List[int]


class MoveDatasetRequest(BaseModel):
    folder_id: Optional[int] = None   # None = racine de la section


class MergeRequest(BaseModel):
    source_ids: List[int]
    name: str
    n_clusters: int = 20


# ------------------------------------------------------------------ #
# Dictionnaires de progression en mémoire (info transitoire)         #
# Evite d'ajouter des colonnes DB pour des états éphémères.          #
# Tous surfacés dans DatasetSummary via list_datasets → poll 2s.     #
# ------------------------------------------------------------------ #
# {dataset_id: {"current": int, "total": int}}
_scan_progress_map: dict[int, dict] = {}

# {dataset_id: {"current": int, "total": int, "phase": str}}
# Progression du pipeline d'embedding (background task, robuste SSH).
_embed_progress: dict[int, dict] = {}
# Verrou : datasets dont le pipeline d'embedding tourne (anti double-run).
_embedding_ids: set[int] = set()

# {dataset_id: {"current": int, "total": int}} — thumbnails asynchrones.
_thumb_progress: dict[int, dict] = {}
_thumb_ids: set[int] = set()

# {dataset_id: {"current": int, "total": int, "phase": str}} — reclustering.
_recluster_progress: dict[int, dict] = {}
_recluster_ids: set[int] = set()

# {dataset_id: {"current": int, "total": int, "phase": str}} — réduction 2D.
_reduce_progress: dict[int, dict] = {}
_reduce_ids: set[int] = set()


# ------------------------------------------------------------------ #
# POST /api/metadata/preview — aperçu colonnes d'un CSV/Excel         #
# Sert l'UI de mapping (choix de la colonne clé) avant l'import.      #
# ------------------------------------------------------------------ #

class MetadataPreviewRequest(BaseModel):
    path: str


@router.post("/metadata/preview")
def metadata_preview(body: MetadataPreviewRequest):
    """Lit les colonnes + quelques lignes d'un CSV/Excel pour le mapping."""
    from backend.core.metadata_loader import preview
    try:
        return preview(body.path)
    except Exception as exc:
        raise HTTPException(400, f"Lecture métadonnées impossible : {exc}")


# ------------------------------------------------------------------ #
# POST /api/datasets — scanner un dossier                             #
# Retourne immédiatement (status="scanning") — le scan est async.    #
# ------------------------------------------------------------------ #

@router.post("/datasets", response_model=DatasetSummary, status_code=201)
def create_dataset(
    body: DatasetCreate,
    session: Session = Depends(get_session),
):
    from backend.utils.native_share import from_native_share_path
    body.root_path = from_native_share_path(body.root_path) or body.root_path
    root = Path(body.root_path)

    # Validation rapide : le chemin doit exister
    if not root.exists():
        raise HTTPException(400, f"Chemin introuvable : {body.root_path}")

    name = body.name or root.stem
    resolved_root = root.resolve()

    # Meme dossier deja scanne : on refuse par defaut au lieu d'accumuler des
    # datasets identiques (l'ancienne version se contentait d'un avertissement
    # affiche apres coup). Le client renvoie allow_duplicate=true s'il confirme.
    if not body.allow_duplicate:
        clash = session.exec(
            select(Dataset).where(Dataset.root_path == str(resolved_root))
        ).first()
        if clash:
            raise HTTPException(409, {
                "message": f"Ce dossier est deja indexe par le dataset '{clash.name}' (#{clash.id}).",
                "existing_dataset_id": clash.id,
                "existing_dataset_name": clash.name,
                "root_path": str(resolved_root),
                "hint": "Relancer avec allow_duplicate=true pour creer quand meme un second dataset.",
            })

    # Récupérer added_by du registre si ce chemin existe déjà (import d'un dataset global)
    existing_registry_entry = next(
        (e for e in _load_global_registry() if e.get("root_path") == str(resolved_root)),
        None
    )
    dataset_added_by = existing_registry_entry.get("added_by") if existing_registry_entry else CURRENT_USER

    # Résolution du dossier de destination (step 3)
    from backend.api.folders import sync_shared_folders
    folder_id = body.folder_id
    if folder_id is None and existing_registry_entry and existing_registry_entry.get("folder_uid"):
        # Import d'un dataset global rangé dans un dossier partagé → le retrouver localement
        sync_shared_folders(session)
        f = session.exec(select(Folder).where(Folder.uid == existing_registry_entry["folder_uid"])).first()
        folder_id = f.id if f else None
    if folder_id is not None and not session.get(Folder, folder_id):
        folder_id = None

    # Métadonnées d'annotation (step 6) — détection format + comptage frames/boxes
    ann_format = ann_frames = ann_boxes = None
    ann_name = body.annotation_name
    if body.annotation_path:
        from backend.core.annotation_ref import describe_annotations
        desc = describe_annotations(body.annotation_path)
        if desc:
            ann_format = desc["format"]
            ann_frames = desc["frames"]
            ann_boxes = desc["boxes"]
            if not ann_name:
                ann_name = Path(body.annotation_path).name

    dataset = Dataset(
        name=name,
        root_path=str(resolved_root),
        recursive=body.recursive,
        image_count=0,       # mis à jour par _scan_dataset
        n_clusters=body.n_clusters,
        status="scanning",   # état transitoire — polling frontend
        is_global=body.share_dataset,
        added_by=dataset_added_by,
        folder_id=folder_id,
        annotation_path=body.annotation_path,
        annotation_format=ann_format,
        annotation_name=ann_name,
        annotation_frames=ann_frames,
        annotation_boxes=ann_boxes,
        metadata_path=body.metadata_path or None,
        metadata_key_column=body.metadata_key_column or None,
    )
    session.add(dataset)
    session.commit()
    session.refresh(dataset)

    # uid du dossier partagé (pour propager le rangement cross-workspace dans le registre)
    _folder = session.get(Folder, folder_id) if folder_id else None
    folder_uid = _folder.uid if (_folder and _folder.is_global) else None

    # Partage global : créer le dossier gallery (dossier réel, PAS un symlink)
    if body.share_dataset:
        gallery_dir = DATASET_GALLERY_DIR / name
        if gallery_dir.is_symlink():
            try:
                gallery_dir.unlink()
                logger.info("Galerie : ancien symlink supprime pour '%s'", name)
            except Exception as exc:
                logger.warning("Impossible de supprimer le symlink galerie : %s", exc)
        if not gallery_dir.exists():
            try:
                gallery_dir.mkdir(parents=True, exist_ok=True)
                logger.info("Galerie partagee : dossier cree pour '%s'", name)
            except Exception as exc:
                logger.warning("Creation dossier galerie echouee : %s", exc)

    # Pré-enregistrer dans le registre global même avant le scan
    if body.share_dataset:
        _upsert_global_registry(DatasetSummary(
            id=dataset.id, name=dataset.name, root_path=dataset.root_path,
            image_count=0, embedded_count=0, status="scanning",
            umap_cached=False, n_clusters=dataset.n_clusters, is_global=True,
            created_at=dataset.created_at, updated_at=dataset.updated_at,
            added_by=dataset_added_by,
        ), folder_uid=folder_uid)

    # Lancer le scan complet en arrière-plan (glob + optional_format + thumbnails + métadonnées)
    submit_job(f"scan:{dataset.id}", _scan_dataset, dataset.id, root, body.recursive, body.share_dataset)

    return DatasetSummary(
        id=dataset.id,
        name=dataset.name,
        root_path=dataset.root_path,
        image_count=0,
        embedded_count=0,
        status="scanning",
        umap_cached=dataset.umap_cached,
        n_clusters=dataset.n_clusters,
        is_global=dataset.is_global,
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
        folder_id=dataset.folder_id,
    )


@router.patch("/datasets/{dataset_id}/folder")
def move_dataset_to_folder(dataset_id: int, body: MoveDatasetRequest,
                           session: Session = Depends(get_session)):
    """Déplace un dataset dans un dossier (ou à la racine si folder_id=None)."""
    ds = session.get(Dataset, dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset introuvable")
    if body.folder_id is not None and not session.get(Folder, body.folder_id):
        raise HTTPException(400, "Dossier introuvable")
    ds.folder_id = body.folder_id
    ds.updated_at = datetime.utcnow()
    session.commit()

    # Propager le rangement dans le registre global (folder_uid) pour les datasets partagés
    if ds.is_global:
        f = session.get(Folder, body.folder_id) if body.folder_id else None
        folder_uid = f.uid if (f and f.is_global) else None
        entries = _load_global_registry()
        for e in entries:
            if e.get("root_path") == ds.root_path:
                e["folder_uid"] = folder_uid
        _save_global_registry(entries)

    return {"success": True, "dataset_id": dataset_id, "folder_id": ds.folder_id}


def _copy_gallery_thumbnails(dataset: "Dataset", session) -> list[str]:
    """
    Copie jusqu'à 5 thumbnails dans le répertoire gallery fixe (indépendant du workspace).
    Retourne la liste des URLs servies via /gallery-thumbs/{name}/thumbs/{idx}.jpg.

    Important : le dossier DATASET_GALLERY_DIR/{name} doit être un VRAI dossier,
    PAS un symlink — sinon les thumbnails seraient écrits dans le dossier images
    de l'utilisateur. La création de symlink a été supprimée de create_dataset.
    """
    import random
    import shutil
    from backend.config import DATASET_GALLERY_DIR, THUMBS_DIR

    # Filtrer les images avec un thumbnail valide (ni None ni chaîne vide)
    images_with_thumb = session.exec(
        select(Image)
        .where(Image.dataset_id == dataset.id)
        .where(Image.thumbnail_path.is_not(None))
        .where(Image.thumbnail_path != "")
    ).all()
    if not images_with_thumb:
        logger.debug("_copy_gallery_thumbnails : aucun thumbnail pour dataset %d", dataset.id)
        return []

    sampled = random.sample(images_with_thumb, min(5, len(images_with_thumb)))

    # S'assurer que le dossier cible est un vrai dossier (pas un symlink)
    gallery_dir = DATASET_GALLERY_DIR / dataset.name
    if gallery_dir.is_symlink():
        # Ancien code créait un symlink — le supprimer et le remplacer par un dossier
        try:
            gallery_dir.unlink()
            logger.info("Gallery : symlink '%s' supprime pour creer un dossier reel", dataset.name)
        except Exception as exc:
            logger.warning("Impossible de supprimer le symlink galerie '%s' : %s", dataset.name, exc)
            return []

    gallery_thumb_dir = gallery_dir / "thumbs"
    try:
        gallery_thumb_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        logger.warning("Creation dossier gallery thumbs echouee : %s", exc)
        return []

    urls: list[str] = []
    for idx, img in enumerate(sampled):
        # thumbnail_path format : "/thumbs/{md5}.jpg"
        tp = (img.thumbnail_path or "").lstrip("/")
        # Extraire uniquement le nom de fichier (après "thumbs/")
        if "/" in tp:
            md5_filename = tp.split("/", 1)[1]   # "{md5}.jpg"
        else:
            md5_filename = tp
        if not md5_filename:
            continue
        src = THUMBS_DIR / md5_filename
        if not src.is_file():   # is_file() évite les faux positifs sur des dossiers
            logger.debug("Thumbnail source introuvable : %s", src)
            continue
        dest = gallery_thumb_dir / f"{idx}.jpg"
        try:
            shutil.copy2(src, dest)
            urls.append(f"/gallery-thumbs/{dataset.name}/thumbs/{idx}.jpg")
        except Exception as exc:
            logger.warning("Copie thumbnail gallery echouee (%s -> %s) : %s", src, dest, exc)

    logger.info("_copy_gallery_thumbnails : %d/%d thumbs copies pour '%s'",
                len(urls), len(sampled), dataset.name)
    return urls


def _scan_dataset(dataset_id: int, root: Path, recursive: bool, share_dataset: bool) -> None:
    """
    Background task complet :
      1. Conversion optional_format si nécessaire
      2. Glob des fichiers images
      3. Création des Image rows + MD5 + thumbnails
      4. Mise à jour du registre global si partagé
    """
    from sqlmodel import Session as S
    from backend.db.database import engine
    from PIL import Image as PILImage

    with S(engine) as session:
        dataset = session.get(Dataset, dataset_id)
        if not dataset:
            return

        try:
            # 1. Conversion optional_format si le chemin pointe vers un .optional
            if root.is_file() and root.suffix.lower() == ".optional":
                out_dir = root.parent / f"{root.stem}_to_png"
                invoke_for_filename(str(root), "convert_to_images", root, out_dir)
                logger.info("Auto-conversion optional_format : %s -> %s", root, out_dir)
                root = out_dir

            # 2. Glob des fichiers images
            pattern = "**/*" if recursive else "*"
            paths = [
                p for p in root.glob(pattern)
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
            ]

            # Auto-conversion des .optional si pas d'images classiques
            if not paths:
                adapter_source = next(
                    (
                        path
                        for path in root.rglob("*")
                        if path.is_file() and get_format_for_filename(str(path))
                    ),
                    None,
                )
                optional_format_files = (
                    invoke_for_filename(str(adapter_source), "find_files", root)
                    if adapter_source is not None
                    else []
                )
                if optional_format_files:
                    for optional_format_file in optional_format_files:
                        out_dir = optional_format_file.parent / f"{optional_format_file.stem}_to_png"
                        invoke_for_filename(
                            str(optional_format_file), "convert_to_images", optional_format_file, out_dir
                        )
                        logger.info("Auto-conversion optional_format : %s -> %s", optional_format_file, out_dir)
                    paths = [
                        p for p in root.glob(pattern)
                        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
                    ]

            if not paths:
                dataset.status = "error"
                dataset.error_message = (
                    f"Aucune image trouvee dans {root} "
                    f"(formats supportes : {', '.join(sorted(SUPPORTED_EXTENSIONS))})"
                )
                dataset.updated_at = datetime.utcnow()
                session.commit()
                _scan_progress_map.pop(dataset_id, None)
                logger.warning("Scan dataset %d : aucune image trouvee", dataset_id)
                return

            # Mettre à jour le compteur total
            dataset.image_count = len(paths)
            dataset.updated_at = datetime.utcnow()
            session.commit()

            # 3. Progression : init
            _scan_progress_map[dataset_id] = {"current": 0, "total": len(paths)}

            # 4. Créer les Image rows RAPIDEMENT : md5 + dimensions (lecture header
            #    only, PAS de décodage complet), SANS thumbnail. Le scan devient
            #    quasi instantané ; les thumbnails sont générés juste après (5 aperçus
            #    immédiats) puis en tâche de fond non bloquante.
            BATCH = 100
            for batch_start in range(0, len(paths), BATCH):
                batch = paths[batch_start: batch_start + BATCH]
                for p in batch:
                    try:
                        md5 = clip_embedder.compute_md5(str(p))
                        stat = p.stat()
                        try:
                            with PILImage.open(p) as im:
                                w, h = im.size          # header only, pas de .load()
                        except Exception:
                            w, h = 0, 0

                        session.add(Image(
                            dataset_id=dataset_id,
                            file_path=str(p.resolve()),
                            filename=p.name,
                            md5=md5,
                            width=w,
                            height=h,
                            file_size_bytes=stat.st_size,
                            thumbnail_path="",          # généré en tâche de fond (step 7)
                        ))
                    except Exception as exc:
                        logger.warning("Image ignoree %s : %s", p, exc)

                session.commit()
                _scan_progress_map[dataset_id] = {
                    "current": min(batch_start + BATCH, len(paths)),
                    "total": len(paths),
                }

            # Rows créées → statut pending : l'app est déjà utilisable (peut lancer embed)
            dataset.status = "pending"
            dataset.updated_at = datetime.utcnow()
            session.commit()
            _scan_progress_map.pop(dataset_id, None)

            # 4a. Association des métadonnées tabulaires (CSV/Excel) si fournies.
            #     Chaque image reçoit la ligne dont la colonne clé matche son nom.
            if dataset.metadata_path:
                try:
                    from backend.core.metadata_loader import build_key_map, match_image
                    key_map, columns = build_key_map(dataset.metadata_path, dataset.metadata_key_column)
                    dataset.metadata_columns_json = json.dumps(columns)
                    session.commit()
                    if key_map:
                        matched = 0
                        imgs = session.exec(
                            select(Image).where(Image.dataset_id == dataset_id)
                        ).all()
                        for img in imgs:
                            row = match_image(img.filename, key_map)
                            if row is not None:
                                img.metadata_json = json.dumps(row, ensure_ascii=False)
                                matched += 1
                        session.commit()
                        logger.info("Metadonnees associees : %d/%d images (dataset %d)",
                                    matched, len(imgs), dataset_id)
                        # Index texte : rend ces colonnes cherchables a travers
                        # tout le catalogue (POST /api/metadata/search).
                        try:
                            from backend.core import metadata_index
                            metadata_index.reindex_dataset(session, dataset_id)
                        except Exception:
                            logger.exception("Indexation metadonnees echouee (dataset %d)", dataset_id)
                except Exception:
                    logger.exception("Association metadonnees echouee (dataset %d)", dataset_id)

            # 4b. Thumbnails : 5 aperçus IMMÉDIATS (carte dataset), puis le reste en
            #     tâche de fond. Progression via _thumb_progress → poll → barre UI.
            all_images = session.exec(
                select(Image).where(Image.dataset_id == dataset_id).order_by(Image.id)
            ).all()
            total_thumbs = len(all_images)
            _thumb_progress[dataset_id] = {"current": 0, "total": total_thumbs}
            for img in all_images[:5]:
                if img.md5 and not img.thumbnail_path:
                    img.thumbnail_path = clip_embedder.generate_thumbnail(img.file_path, img.md5)
            session.commit()
            _thumb_progress[dataset_id] = {"current": min(5, total_thumbs), "total": total_thumbs}

            # 5. Registry global si partagé (utilise les 5 aperçus déjà générés)
            if share_dataset:
                session.refresh(dataset)
                gallery_thumb_urls = _copy_gallery_thumbnails(dataset, session)
                basic_stats = _compute_basic_gallery_stats(dataset_id, session)
                _fld = session.get(Folder, dataset.folder_id) if dataset.folder_id else None
                _folder_uid = _fld.uid if (_fld and _fld.is_global) else None
                _upsert_global_registry(DatasetSummary(
                    id=dataset.id, name=dataset.name, root_path=dataset.root_path,
                    image_count=dataset.image_count, embedded_count=dataset.embedded_count,
                    status=dataset.status, umap_cached=dataset.umap_cached,
                    n_clusters=dataset.n_clusters, is_global=True,
                    created_at=dataset.created_at, updated_at=dataset.updated_at,
                ), gallery_thumb_urls=gallery_thumb_urls, basic_stats=basic_stats, folder_uid=_folder_uid)
                logger.info("Gallery : %d thumbs copiees pour '%s'", len(gallery_thumb_urls), dataset.name)

            logger.info("Scan termine pour dataset %d (%d images) — thumbnails en fond", dataset_id, len(paths))

            # 6. Reste des thumbnails, non bloquant (même thread scan). Peut tourner
            #    en parallèle d'un embed lancé par l'utilisateur (autre thread).
            _generate_remaining_thumbnails(session, dataset_id, all_images, total_thumbs)

        except PermissionError as exc:
            logger.warning("Scan dataset %d : acces refuse (%s)", dataset_id, exc)
            try:
                dataset.status = "error"
                dataset.error_message = f"Acces refuse a {root} : {exc}"
                dataset.updated_at = datetime.utcnow()
                session.commit()
            except Exception:
                pass
            _scan_progress_map.pop(dataset_id, None)
            _thumb_progress.pop(dataset_id, None)
        except Exception as exc:
            logger.exception("Erreur scan dataset %d", dataset_id)
            try:
                dataset.status = "error"
                dataset.error_message = str(exc)
                dataset.updated_at = datetime.utcnow()
                session.commit()
            except Exception:
                pass
            _scan_progress_map.pop(dataset_id, None)
            _thumb_progress.pop(dataset_id, None)


THUMB_WORKERS = 6  # I/O-bound (lecture disque/SMB) : quelques workers suffisent a paralleliser


def _generate_remaining_thumbnails(session, dataset_id: int, images: list, total: int) -> None:
    """Génère les thumbnails manquants d'un dataset, en publiant la progression
    dans `_thumb_progress` (lue par le poll). Non bloquant pour l'app : tourne dans
    le thread du scan (ou appelé isolément). Utilise PIL draft() (voir embedder).

    Parallelise via un ThreadPoolExecutor : chaque lecture/decodage/resize est
    I/O-bound (surtout sur un dataset servi par SMB depuis une VM distante), donc
    plusieurs workers se recouvrent utilement. Seul le thread principal touche la
    session SQLAlchemy (assignation `img.thumbnail_path` + commit)."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    pending = [img for img in images if not img.thumbnail_path and img.md5]
    done = total - len(pending)
    _thumb_progress[dataset_id] = {"current": done, "total": total}
    try:
        with ThreadPoolExecutor(max_workers=THUMB_WORKERS) as executor:
            future_to_img = {
                executor.submit(clip_embedder.generate_thumbnail, img.file_path, img.md5): img
                for img in pending
            }
            for future in as_completed(future_to_img):
                img = future_to_img[future]
                try:
                    img.thumbnail_path = future.result()
                except Exception as exc:
                    logger.warning("Thumbnail echoue pour %s : %s", img.file_path, exc)
                done += 1
                if done % 25 == 0:
                    session.commit()
                    _thumb_progress[dataset_id] = {"current": done, "total": total}
        session.commit()
        _thumb_progress[dataset_id] = {"current": total, "total": total}
        logger.info("Thumbnails termines pour dataset %d (%d, %d workers)", dataset_id, total, THUMB_WORKERS)
    except Exception:
        logger.exception("Erreur generation thumbnails dataset %d", dataset_id)
    finally:
        _thumb_progress.pop(dataset_id, None)


# ------------------------------------------------------------------ #
# POST /api/datasets/merge — fusionner plusieurs datasets (SSE)       #
# IMPORTANT : doit être déclaré AVANT /datasets/{dataset_id}          #
# ------------------------------------------------------------------ #

@router.post("/datasets/merge")
def merge_datasets(body: MergeRequest, session: Session = Depends(get_session)):
    """
    Fusionne plusieurs datasets en un seul sans relancer CLIP.
    Copie les Image et Embedding records, recalcule FAISS/UMAP/KMeans/rareté.
    Retourne un flux SSE (même format que /embed).
    """
    def pipeline():
        from sqlmodel import Session as S
        from backend.db.database import engine

        with S(engine) as db:
            try:
                # Validation des sources
                sources = []
                for sid in body.source_ids:
                    ds = db.get(Dataset, sid)
                    if not ds:
                        yield _sse({"type": "error", "message": f"Dataset {sid} introuvable"})
                        return
                    if not ds.umap_cached:
                        yield _sse({"type": "error", "message": f"Dataset '{ds.name}' pas encore prêt (UMAP non calculé)"})
                        return
                    sources.append(ds)

                if len(sources) < 2:
                    yield _sse({"type": "error", "message": "Sélectionnez au moins 2 datasets"})
                    return

                # Charger images + embeddings de toutes les sources
                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "loading"})

                all_src_images: List[Image] = []
                all_vecs: List[np.ndarray] = []

                for ds in sources:
                    imgs = db.exec(
                        select(Image)
                        .where(Image.dataset_id == ds.id)
                        .order_by(Image.id)
                    ).all()
                    src_vecs, src_imgs = _vectors_for_images(db, imgs)
                    all_src_images.extend(src_imgs)
                    all_vecs.extend(src_vecs)

                if not all_vecs:
                    yield _sse({"type": "error", "message": "Aucun embedding trouvé dans les sources"})
                    return

                total = len(all_vecs)
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "loading"})
                logger.info("Merge : %d images chargees depuis %d datasets", total, len(sources))

                # Créer le dataset fusionné
                source_names = ", ".join(ds.name for ds in sources)
                merged = Dataset(
                    name=body.name,
                    root_path=f"merged:{','.join(str(ds.id) for ds in sources)}",
                    image_count=total,
                    n_clusters=body.n_clusters,
                    status="embedding",
                )
                db.add(merged)
                db.commit()
                db.refresh(merged)

                # Créer les Image + Embedding records pour le dataset fusionné
                new_images: List[Image] = []
                batch_size = 100
                for i, (src_img, vec) in enumerate(zip(all_src_images, all_vecs)):
                    new_img = Image(
                        dataset_id=merged.id,
                        file_path=src_img.file_path,
                        filename=src_img.filename,
                        md5=src_img.md5,
                        width=src_img.width,
                        height=src_img.height,
                        file_size_bytes=src_img.file_size_bytes,
                        thumbnail_path=src_img.thumbnail_path,
                    )
                    db.add(new_img)
                    db.flush()
                    db.add(Embedding(image_id=new_img.id, vector_blob=vec.tobytes()))
                    new_images.append(new_img)

                    if (i + 1) % batch_size == 0 or i == total - 1:
                        db.commit()
                        yield _sse({
                            "type": "progress",
                            "current": i + 1,
                            "total": total,
                            "phase": "embedding",
                        })

                embeddings = np.vstack(all_vecs)

                # FAISS
                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "indexing"})
                index_path = faiss_indexer.index_path_str(merged.id)
                faiss_indexer.build(merged.id, embeddings)
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "indexing"})

                # UMAP
                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "umap"})
                coords = umap_reducer.reduce(embeddings)
                for img, (x, y) in zip(new_images, coords):
                    img.umap_x = float(x)
                    img.umap_y = float(y)
                db.commit()
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "umap"})

                # Clustering (methode des reglages) + rarete, comme le pipeline d'embedding
                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "clustering"})
                cs = _load_cluster_settings()
                params = ({"n_clusters": min(body.n_clusters, total)} if cs["method"] == "kmeans"
                          else {"min_cluster_size": cs["hdbscan_min_cluster_size"]})
                _apply_clustering(db, merged.id, embeddings, new_images, cs["method"], params)
                merged = db.get(Dataset, merged.id)
                db.commit()
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "clustering"})

                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "scoring"})

                merged.embedded_count = total
                merged.status = "ready"
                merged.umap_cached = True
                merged.faiss_index_path = index_path
                merged.updated_at = datetime.utcnow()
                db.commit()
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "scoring"})

                yield _sse({"type": "done", "dataset_id": merged.id, "status": "ready"})
                logger.info("Merge termine : dataset %d (%d images)", merged.id, total)

            except GeneratorExit:
                try:
                    stuck = db.exec(
                        select(Dataset).where(Dataset.status == "embedding")
                    ).all()
                    if stuck:
                        logger.warning("Client deconnecte pendant merge — remise en 'pending'")
                        for ds in stuck:
                            ds.status = "pending"
                        db.commit()
                except Exception:
                    pass
                raise

            except Exception as exc:
                logger.exception("Erreur merge datasets")
                yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        pipeline(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------ #
# POST /api/datasets/filter-by-text — filtrage CLIP par mot-clé       #
# (refonte step 4/5). Ne concerne QUE les datasets déjà embeddés.     #
# Multi-requête (OR/AND), seuil réglable, comptage par dataset +      #
# 5 meilleures images. DOIT être déclaré AVANT /datasets/{id}.        #
# ------------------------------------------------------------------ #

def _parse_terms(queries: Optional[list], query: Optional[str]) -> list[str]:
    """Normalise la liste de termes : accepte une liste OU une chaîne 'a, b, c'."""
    terms: list[str] = []
    for t in (queries or []):
        terms.extend(str(t).split(","))
    if not terms and query:
        terms = query.split(",")
    return [t.strip() for t in terms if t and t.strip()]


def _encode_terms(terms: list[str]) -> np.ndarray:
    """Encode chaque terme via CLIP → matrice (T, 512) L2-normalisée."""
    vecs = [clip_embedder.embed_text(t).astype(np.float32).reshape(-1) for t in terms]
    return np.vstack(vecs)


def _match_scores(embeddings: np.ndarray, term_vecs: np.ndarray,
                  threshold: float, mode: str):
    """Retourne (keep_mask, per_image_score) pour un dataset.

    per_image_score = max des scores par terme (union) ou min (intersection).
    keep = au moins un terme >= seuil (union) / tous les termes >= seuil (intersection).
    Les embeddings et term_vecs sont L2-normalisés → produit scalaire = cosine.
    """
    S = embeddings @ term_vecs.T                 # (N, T) cosine image × terme
    matched = S >= threshold
    if mode == "intersection":
        keep = matched.all(axis=1)
        per_img = S.min(axis=1)
    else:
        keep = matched.any(axis=1)
        per_img = S.max(axis=1)
    return keep, per_img


class FilterByTextRequest(BaseModel):
    queries: list[str] = []          # termes séparés (ou une seule chaîne 'drone, forest')
    query: str = ""                  # alternative : chaîne brute splittée sur les virgules
    threshold: float = 0.25          # seuil de matching cosine [0,1]
    mode: str = "union"              # union (OR) | intersection (AND)
    top_thumbs: int = 5              # images d'aperçu par dataset


@router.post("/datasets/filter-by-text")
def datasets_filter_by_text(body: FilterByTextRequest, session: Session = Depends(get_session)):
    """Classe les datasets DÉJÀ EMBEDDÉS par pertinence à une (ou plusieurs) requête(s).

    Pour chaque dataset : compte les images dont le score CLIP dépasse le seuil
    (union OR / intersection AND des termes), renvoie matched/total/percent + les
    N meilleures images. Le tri (absolu vs relatif) se fait côté client.
    """
    if not clip_embedder.is_loaded:
        raise HTTPException(503, "Modele CLIP non charge")

    terms = _parse_terms(body.queries, body.query)
    if not terms:
        return {"terms": [], "results": []}

    thr = min(max(float(body.threshold), 0.0), 1.0)
    mode = body.mode if body.mode in ("union", "intersection") else "union"
    top_thumbs = max(0, int(body.top_thumbs))
    term_vecs = _encode_terms(terms)

    results: list[dict] = []
    for d in session.exec(select(Dataset)).all():
        E, ids = _load_dataset_embeddings(session, d.id)
        if E.shape[0] == 0:
            continue   # dataset sans embeddings → hors filtrage
        keep, per_img = _match_scores(E, term_vecs, thr, mode)
        matched_count = int(keep.sum())
        if matched_count == 0:
            continue
        total = int(E.shape[0])
        matched_idx = np.where(keep)[0]
        order = matched_idx[np.argsort(-per_img[matched_idx])][:top_thumbs]
        top_images = [{"image_id": int(ids[i]), "score": round(float(per_img[i]), 4)} for i in order]
        results.append({
            "dataset_id": d.id,
            "name": d.name,
            "root_path": d.root_path,
            "matched_count": matched_count,
            "total_count": total,
            "percent": round(100.0 * matched_count / max(total, 1), 1),
            "top_images": top_images,
        })

    results.sort(key=lambda r: r["matched_count"], reverse=True)
    return {"terms": terms, "threshold": thr, "mode": mode, "results": results}


# ------------------------------------------------------------------ #
# POST /api/datasets/merge-filtered — merge intelligent (step 6)      #
# Fusionne UNIQUEMENT les images matchées (score > seuil) de chaque   #
# source dans un nouveau dataset. SSE (même format que /merge).       #
# ------------------------------------------------------------------ #

class MergeFilteredRequest(BaseModel):
    source_ids: List[int]
    name: str
    queries: list[str] = []
    query: str = ""
    threshold: float = 0.25
    mode: str = "union"
    n_clusters: int = 20


@router.post("/datasets/merge-filtered")
def merge_filtered(body: MergeFilteredRequest, session: Session = Depends(get_session)):
    """Construit un dataset à partir des seules images pertinentes de plusieurs
    sources (score CLIP > seuil). Copie les Image/Embedding, recalcule
    FAISS/UMAP/clustering/rareté. Flux SSE (même format que /merge)."""
    if not clip_embedder.is_loaded:
        raise HTTPException(503, "Modele CLIP non charge")
    terms = _parse_terms(body.queries, body.query)

    def pipeline():
        from sqlmodel import Session as S
        from backend.db.database import engine

        with S(engine) as db:
            try:
                if not terms:
                    yield _sse({"type": "error", "message": "Aucun terme de recherche"})
                    return
                thr = min(max(float(body.threshold), 0.0), 1.0)
                mode = body.mode if body.mode in ("union", "intersection") else "union"
                term_vecs = _encode_terms(terms)

                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "loading"})

                sel_images: List[Image] = []
                sel_vecs: List[np.ndarray] = []
                for sid in body.source_ids:
                    ds = db.get(Dataset, sid)
                    if not ds:
                        continue
                    E, ids = _load_dataset_embeddings(db, sid)
                    if E.shape[0] == 0:
                        continue
                    keep, _ = _match_scores(E, term_vecs, thr, mode)
                    for local_i in np.where(keep)[0]:
                        img = db.get(Image, int(ids[local_i]))
                        if img is not None:
                            sel_images.append(img)
                            sel_vecs.append(E[local_i].astype(np.float32))

                if not sel_vecs:
                    yield _sse({"type": "error", "message": "Aucune image ne dépasse le seuil dans les sources sélectionnées"})
                    return

                total = len(sel_vecs)
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "loading"})
                logger.info("Merge filtre : %d images retenues depuis %d sources",
                            total, len(body.source_ids))

                merged = Dataset(
                    name=body.name,
                    root_path=f"merged:{','.join(str(s) for s in body.source_ids)}",
                    image_count=total,
                    n_clusters=body.n_clusters,
                    status="embedding",
                )
                db.add(merged)
                db.commit()
                db.refresh(merged)

                new_images: List[Image] = []
                batch_size = 100
                for i, (src_img, vec) in enumerate(zip(sel_images, sel_vecs)):
                    new_img = Image(
                        dataset_id=merged.id,
                        file_path=src_img.file_path,
                        filename=src_img.filename,
                        md5=src_img.md5,
                        width=src_img.width,
                        height=src_img.height,
                        file_size_bytes=src_img.file_size_bytes,
                        thumbnail_path=src_img.thumbnail_path,
                    )
                    db.add(new_img)
                    db.flush()
                    db.add(Embedding(image_id=new_img.id, vector_blob=vec.tobytes()))
                    new_images.append(new_img)
                    if (i + 1) % batch_size == 0 or i == total - 1:
                        db.commit()
                        yield _sse({"type": "progress", "current": i + 1, "total": total, "phase": "embedding"})

                embeddings = np.vstack(sel_vecs)

                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "indexing"})
                index_path = faiss_indexer.index_path_str(merged.id)
                faiss_indexer.build(merged.id, embeddings)
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "indexing"})

                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "umap"})
                red = _load_reduction_settings_full()
                coords = umap_reducer.reduce(embeddings, red)
                for img, (x, y) in zip(new_images, coords):
                    img.umap_x = float(x)
                    img.umap_y = float(y)
                db.commit()
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "umap"})

                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "clustering"})
                cs = _load_cluster_settings()
                params = ({"n_clusters": body.n_clusters} if cs["method"] == "kmeans"
                          else {"min_cluster_size": cs["hdbscan_min_cluster_size"]})
                _apply_clustering(db, merged.id, embeddings, new_images, cs["method"], params)
                merged = db.get(Dataset, merged.id)
                _store_reduction_config(merged, red)
                merged.embedded_count = total
                merged.status = "ready"
                merged.umap_cached = True
                merged.faiss_index_path = index_path
                merged.reduction_settings_hash = _compute_reduction_hash()
                merged.updated_at = datetime.utcnow()
                db.commit()
                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "scoring"})

                yield _sse({"type": "done", "dataset_id": merged.id, "status": "ready"})
                logger.info("Merge filtre termine : dataset %d (%d images)", merged.id, total)

            except GeneratorExit:
                raise
            except Exception as exc:
                logger.exception("Erreur merge filtre")
                yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        pipeline(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------ #
# GET /api/datasets                                                   #
# ------------------------------------------------------------------ #

@router.get("/datasets", response_model=List[DatasetSummary])
def list_datasets(session: Session = Depends(get_session)):
    # Synchroniser les dossiers partagés dans ce workspace (step 3) avant tout.
    from backend.api.folders import sync_shared_folders
    sync_shared_folders(session)
    # Map uid -> folder_id local (pour ranger les datasets globaux non importés)
    folder_uid_to_id = {
        f.uid: f.id
        for f in session.exec(select(Folder).where(Folder.uid.is_not(None))).all()
    }

    datasets = session.exec(select(Dataset).order_by(Dataset.created_at.desc())).all()

    # --- Requêtes agrégées en une passe ---
    rejected_rows = session.exec(
        select(Image.dataset_id, func.count(Image.id).label("cnt"))
        .where(Image.is_duplicate_kept == False)  # noqa: E712
        .group_by(Image.dataset_id)
    ).all()
    rejected_map: dict[int, int] = {row[0]: row[1] for row in rejected_rows}

    stale_rows = session.exec(
        select(Image.dataset_id, func.count(Image.id).label("cnt"))
        .where(and_(
            Image.is_duplicate_kept == False,  # noqa: E712
            Image.umap_x.is_not(None),
        ))
        .group_by(Image.dataset_id)
    ).all()
    stale_map: dict[int, bool] = {row[0]: row[1] > 0 for row in stale_rows}

    # Doublons : plusieurs datasets peuvent pointer sur le MÊME root_path sous des
    # noms différents (import volontaire d'un doublon nommé, ex. "IR" / "IR_2") —
    # regroupé en une passe pour avertir dans la galerie (badge « doublon de : X »).
    by_root_path: dict[str, list[Dataset]] = {}
    for d in datasets:
        by_root_path.setdefault(d.root_path, []).append(d)
    duplicate_map: dict[int, list[dict]] = {
        d.id: [{"id": other.id, "name": other.name} for other in siblings if other.id != d.id]
        for siblings in by_root_path.values() if len(siblings) > 1
        for d in siblings
    }

    # Hash des paramètres de réduction courants
    current_reduction_hash = _compute_reduction_hash()

    # Registre global (chargé une fois, rechargé après auto-refresh)
    registry_by_path: dict[str, dict] = {e.get("root_path"): e for e in _load_global_registry()}

    # --- Auto-refresh gallery thumbnails + stats pour datasets globaux en workspace ---
    # Uniquement si le scan est terminé (status=ready) pour éviter les race conditions
    # avec le background task _scan_images. Ne met à jour le registre que si on
    # obtient réellement des données (évite d'écraser les données avec []).
    registry_changed = False
    for d in datasets:
        if not d.is_global:
            continue
        if d.status not in ("ready", "error"):
            # Scan en cours — _scan_images mettra le registre à jour lui-même
            continue
        reg = registry_by_path.get(d.root_path, {})
        needs_thumbs = not reg.get("gallery_thumb_urls")
        needs_stats  = not reg.get("basic_stats")
        if not (needs_thumbs or needs_stats):
            continue

        new_thumbs = _copy_gallery_thumbnails(d, session) if needs_thumbs else None
        new_stats  = _compute_basic_gallery_stats(d.id, session) if needs_stats else None

        # Seulement mettre à jour si on a obtenu quelque chose (évite d'écraser avec [])
        if (new_thumbs or not needs_thumbs) or (new_stats or not needs_stats):
            _upsert_global_registry(DatasetSummary(
                id=d.id, name=d.name, root_path=d.root_path,
                image_count=d.image_count, embedded_count=d.embedded_count,
                status=d.status, umap_cached=d.umap_cached,
                n_clusters=d.n_clusters, is_global=True,
                created_at=d.created_at, updated_at=d.updated_at,
            ), gallery_thumb_urls=new_thumbs, basic_stats=new_stats)
            registry_changed = True
            if new_thumbs:
                logger.info("Auto-refresh gallery : %d thumbs pour '%s'", len(new_thumbs), d.name)

    if registry_changed:
        # Recharger le registre une seule fois après toutes les modifications
        registry_by_path = {e.get("root_path"): e for e in _load_global_registry()}

    # --- Construction du résultat ---
    result = []
    for d in datasets:
        reg = registry_by_path.get(d.root_path, {}) if d.is_global else {}
        prog = _scan_progress_map.get(d.id, {})
        eprog = _embed_progress.get(d.id, {})
        tprog = _thumb_progress.get(d.id, {})
        rprog = _recluster_progress.get(d.id, {})
        dprog = _reduce_progress.get(d.id, {})
        result.append(DatasetSummary(
            id=d.id, name=d.name, root_path=d.root_path,
            image_count=d.image_count, embedded_count=d.embedded_count,
            status=d.status, umap_cached=d.umap_cached,
            n_clusters=d.n_clusters, is_global=d.is_global, in_workspace=True,
            created_at=d.created_at, updated_at=d.updated_at,
            error_message=getattr(d, "error_message", None),
            rejected_count=rejected_map.get(d.id, 0),
            map_needs_rebuild=stale_map.get(d.id, False),
            map_method_outdated=(
                d.umap_cached and
                d.reduction_settings_hash is not None and
                d.reduction_settings_hash != current_reduction_hash
            ),
            gallery_thumb_urls=reg.get("gallery_thumb_urls", []),
            registry_stats=reg.get("basic_stats", {}),
            scan_progress=prog.get("current", 0),
            scan_total=prog.get("total", 0),
            embed_progress=eprog.get("current", 0),
            embed_total=eprog.get("total", 0),
            embed_phase=eprog.get("phase", ""),
            thumb_progress=tprog.get("current", 0),
            thumb_total=tprog.get("total", 0),
            recluster_progress=rprog.get("current", 0),
            recluster_total=rprog.get("total", 0),
            recluster_phase=rprog.get("phase", ""),
            reduce_progress=dprog.get("current", 0),
            reduce_total=dprog.get("total", 0),
            reduce_phase=dprog.get("phase", ""),
            cluster_method=getattr(d, "cluster_method", None),
            cluster_params=_parse_cluster_params(getattr(d, "cluster_params_json", None), d),
            reduction_method=getattr(d, "reduction_method", None),
            reduction_params=_parse_json_dict(getattr(d, "reduction_params_json", None)),
            folder_id=getattr(d, "folder_id", None),
            has_annotations=bool(getattr(d, "annotation_format", None)),
            annotation_name=getattr(d, "annotation_name", None),
            annotation_format=getattr(d, "annotation_format", None),
            annotation_frames=getattr(d, "annotation_frames", None),
            annotation_boxes=getattr(d, "annotation_boxes", None),
            metadata_columns=_parse_json_list(getattr(d, "metadata_columns_json", None)),
            metadata_key_column=getattr(d, "metadata_key_column", None),
            added_by=d.added_by,
            duplicate_of=duplicate_map.get(d.id, []),
        ))

    # --- Datasets globaux du registre PAS encore dans ce workspace ---
    # On n'exclut que les entrées dont le workspace possède DÉJÀ une copie GLOBALE
    # (is_global=True). Un dataset workspace-only (is_global=False) au même chemin
    # ne doit PAS cacher l'entrée globale dans la galerie — sinon l'ajout accidentel
    # d'un dataset comme "workspace only" au même chemin que un dataset global ferait
    # disparaître ce dernier de la section "Galerie globale".
    global_workspace_root_paths = {d.root_path for d in datasets if d.is_global}
    for entry in _load_global_registry():
        if entry.get("root_path") in global_workspace_root_paths:
            continue  # déjà dans le workspace ET marqué global → pas de doublon
        try:
            created = datetime.fromisoformat(entry["created_at"]) if isinstance(entry.get("created_at"), str) else datetime.utcnow()
            result.append(DatasetSummary(
                id=-1,  # pas d'ID dans ce workspace
                name=entry["name"],
                root_path=entry["root_path"],
                image_count=entry.get("image_count", 0),
                embedded_count=0,
                status="ready",
                umap_cached=False,
                n_clusters=entry.get("n_clusters", 20),
                is_global=True,
                in_workspace=False,
                created_at=created,
                updated_at=created,
                gallery_thumb_urls=entry.get("gallery_thumb_urls", []),
                registry_stats=entry.get("basic_stats", {}),
                folder_id=folder_uid_to_id.get(entry.get("folder_uid")),
                has_annotations=bool(entry.get("annotation")),
                annotation_name=(entry.get("annotation") or {}).get("name"),
                annotation_format=(entry.get("annotation") or {}).get("format"),
                annotation_frames=(entry.get("annotation") or {}).get("frames"),
                annotation_boxes=(entry.get("annotation") or {}).get("boxes"),
                added_by=entry.get("added_by"),
            ))
        except Exception as exc:
            logger.warning("Entree registre invalide ignoree : %s — %s", entry, exc)

    return result


# ------------------------------------------------------------------ #
# GET /api/datasets/check-path                                       #
# Doublons existants pour un root_path donné — appelé AVANT la création #
# (import manuel) pour avertir "ce chemin existe déjà sous le nom X". #
# Doit rester déclarée AVANT /datasets/{dataset_id} : Starlette route  #
# par ordre d'enregistrement et "check-path" matcherait sinon le      #
# paramètre {dataset_id} (int) et échouerait la conversion (422).     #
# ------------------------------------------------------------------ #

@router.get("/datasets/check-path")
def check_duplicate_path(root_path: str, session: Session = Depends(get_session)):
    from backend.utils.native_share import from_native_share_path
    root_path = from_native_share_path(root_path) or root_path
    try:
        resolved = str(Path(root_path).resolve())
    except Exception:
        return []
    matches = session.exec(select(Dataset).where(Dataset.root_path == resolved)).all()
    return [
        {"id": d.id, "name": d.name, "image_count": d.image_count, "status": d.status}
        for d in matches
    ]


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}                                              #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: int, session: Session = Depends(get_session)):
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")

    cluster_dist = {}
    images = session.exec(
        select(Image).where(Image.dataset_id == dataset_id)
    ).all()
    dup_count = sum(1 for img in images if img.duplicate_group_id is not None)
    rejected_count = sum(1 for img in images if img.is_duplicate_kept is False)
    map_needs_rebuild = any(
        img.is_duplicate_kept is False and img.umap_x is not None
        for img in images
    )

    for img in images:
        if img.cluster_id is not None:
            cluster_dist[img.cluster_id] = cluster_dist.get(img.cluster_id, 0) + 1

    return {
        "id": dataset.id,
        "name": dataset.name,
        "root_path": dataset.root_path,
        "image_count": dataset.image_count,
        "embedded_count": dataset.embedded_count,
        "status": dataset.status,
        "error_message": dataset.error_message,
        "umap_cached": dataset.umap_cached,
        "n_clusters": dataset.n_clusters,
        "is_global": dataset.is_global,
        "cluster_distribution": [
            {"cluster_id": k, "count": v}
            for k, v in sorted(cluster_dist.items())
        ],
        "duplicate_count": dup_count,
        "rejected_count": rejected_count,
        "map_needs_rebuild": map_needs_rebuild,
        "cluster_method": dataset.cluster_method,
        "cluster_params": _parse_cluster_params(dataset.cluster_params_json, dataset),
        "reduction_method": dataset.reduction_method,
        "reduction_params": _parse_json_dict(dataset.reduction_params_json),
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
    }


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/stats                                        #
# Statistiques descriptives du dataset (dimensions, formats, tailles)#
# + 5 thumbnails aléatoires pour aperçu rapide.                      #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/stats")
def get_dataset_stats(dataset_id: int, session: Session = Depends(get_session)):
    """
    Retourne des statistiques descriptives sur les images du dataset :
    dimensions moyennes, distribution des formats, taille fichier,
    mode couleur (via PIL), et 5 thumbnails aléatoires.
    """
    import random
    from PIL import Image as PILImage

    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")

    images = session.exec(select(Image).where(Image.dataset_id == dataset_id)).all()
    if not images:
        return {
            "image_count": 0,
            "avg_width": 0, "avg_height": 0,
            "format_distribution": {},
            "color_modes": {},
            "avg_file_size_bytes": 0,
            "total_size_bytes": 0,
            "thumbnails": [],
        }

    # Dimensions
    widths  = [img.width  for img in images if img.width]
    heights = [img.height for img in images if img.height]

    # Formats depuis extension du filename
    fmt_dist: dict[str, int] = {}
    for img in images:
        ext = Path(img.filename).suffix.lower() or "inconnu"
        fmt_dist[ext] = fmt_dist.get(ext, 0) + 1

    # Tailles fichier
    sizes = [img.file_size_bytes for img in images if img.file_size_bytes]

    # Mode couleur : échantillonner jusqu'à 20 images pour éviter le surcoût
    color_modes: dict[str, int] = {}
    sample_for_color = random.sample(images, min(20, len(images)))
    for img in sample_for_color:
        try:
            with PILImage.open(img.file_path) as pil:
                mode = pil.mode  # "RGB", "L", "RGBA", etc.
                color_modes[mode] = color_modes.get(mode, 0) + 1
        except Exception:
            pass

    # 5 thumbnails aléatoires (avec thumbnail_path défini)
    imgs_with_thumb = [img for img in images if img.thumbnail_path]
    sampled = random.sample(imgs_with_thumb, min(5, len(imgs_with_thumb)))
    thumbnails = [
        {"url": img.thumbnail_path, "filename": img.filename,
         "width": img.width, "height": img.height}
        for img in sampled
    ]

    return {
        "image_count": len(images),
        "avg_width":  round(sum(widths)  / len(widths))  if widths  else 0,
        "avg_height": round(sum(heights) / len(heights)) if heights else 0,
        "min_width":  min(widths)  if widths  else 0,
        "max_width":  max(widths)  if widths  else 0,
        "min_height": min(heights) if heights else 0,
        "max_height": max(heights) if heights else 0,
        "format_distribution": fmt_dist,
        "color_modes": color_modes,
        "avg_file_size_bytes": round(sum(sizes) / len(sizes)) if sizes else 0,
        "total_size_bytes": sum(sizes) if sizes else 0,
        "thumbnails": thumbnails,
    }


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/images                                       #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/images", response_model=ImagePage)
def get_images(
    dataset_id: int,
    page: int = 0,
    limit: int = 50,
    cluster_id: Optional[int] = None,
    min_rarity: Optional[float] = None,
    max_rarity: Optional[float] = None,
    duplicate_only: bool = False,
    session: Session = Depends(get_session),
):
    query = select(Image).where(Image.dataset_id == dataset_id)

    if cluster_id is not None:
        query = query.where(Image.cluster_id == cluster_id)
    if min_rarity is not None:
        query = query.where(Image.rarity_score >= min_rarity)
    if max_rarity is not None:
        query = query.where(Image.rarity_score <= max_rarity)
    if duplicate_only:
        query = query.where(Image.duplicate_group_id.is_not(None))

    # Pagination SQL reelle : COUNT + LIMIT/OFFSET. L'ancienne version chargeait
    # toutes les lignes filtrees en memoire avant de slicer en Python — sur un
    # dataset de plusieurs dizaines de milliers d'images, chaque page coutait un
    # SELECT * complet.
    from sqlalchemy import func as sa_func
    total = session.exec(
        select(sa_func.count()).select_from(Image).where(query.whereclause)
    ).one()
    total = int(total if not isinstance(total, tuple) else total[0])

    limit = max(1, min(limit, 500))
    page = max(0, page)
    all_images = session.exec(
        query.order_by(Image.id).offset(page * limit).limit(limit)
    ).all()
    items = all_images

    return ImagePage(
        total=total,
        page=page,
        limit=limit,
        items=[
            ImageSummary(
                id=img.id,
                filename=img.filename,
                file_path=img.file_path,
                thumbnail_url=img.thumbnail_path,
                width=img.width,
                height=img.height,
                cluster_id=img.cluster_id,
                rarity_score=img.rarity_score,
                umap_x=img.umap_x,
                umap_y=img.umap_y,
                duplicate_group_id=img.duplicate_group_id,
                is_duplicate_kept=img.is_duplicate_kept,
                metadata=_parse_json_dict(getattr(img, "metadata_json", None)),
            )
            for img in items
        ],
    )


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/images/{img_id}/full                         #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/images/{image_id}/full")
def get_image_full(
    dataset_id: int,
    image_id: int,
    session: Session = Depends(get_session),
):
    img = session.get(Image, image_id)
    if not img or img.dataset_id != dataset_id:
        raise HTTPException(404, "Image introuvable")
    if not Path(img.file_path).exists():
        raise HTTPException(404, "Fichier image introuvable sur le disque")
    return FileResponse(img.file_path)


# ------------------------------------------------------------------ #
# GET /api/datasets/{id}/images/{img_id}/full-path — chemin natif      #
# (coquille Electron, desktop/src/imageProtocol.ts) — jamais appelé   #
# par une page web classique.                                         #
# ------------------------------------------------------------------ #

@router.get("/datasets/{dataset_id}/images/{image_id}/full-path")
def get_image_full_path(
    dataset_id: int,
    image_id: int,
    session: Session = Depends(get_session),
):
    img = session.get(Image, image_id)
    if not img or img.dataset_id != dataset_id:
        raise HTTPException(404, "Image introuvable")
    from backend.utils.native_share import to_native_share_path
    return {"native_path": to_native_share_path(img.file_path)}


# ------------------------------------------------------------------ #
# GET /api/images/{image_id}/thumb — thumbnail à la demande          #
# Sert le thumbnail caché ; le génère+cache à la volée s'il manque   #
# (fallback pour les images non encore traitées par la tâche fond).  #
# ------------------------------------------------------------------ #

@router.get("/images/{image_id}/thumb")
def get_image_thumb(image_id: int, session: Session = Depends(get_session)):
    img = session.get(Image, image_id)
    if not img:
        raise HTTPException(404, "Image introuvable")
    if not img.md5:
        raise HTTPException(404, "Thumbnail indisponible")

    dest = THUMBS_DIR / f"{img.md5}.jpg"
    if not dest.exists():
        # Génération paresseuse (à la volée) puis cache disque
        url = clip_embedder.generate_thumbnail(img.file_path, img.md5)
        if url and not img.thumbnail_path:
            img.thumbnail_path = url
            session.commit()
    if dest.exists():
        return FileResponse(str(dest), media_type="image/jpeg")
    raise HTTPException(404, "Thumbnail indisponible")


# ------------------------------------------------------------------ #
# GET /api/images/{image_id}/thumb-path — chemin natif (coquille       #
# Electron) pour la miniature déjà en cache. Ne génère RIEN à la      #
# volée (contrairement à /thumb) — si le cache n'existe pas encore,   #
# renvoie native_path=null, le frontend retombe sur /thumb classique   #
# qui, lui, génère puis sert.                                          #
# ------------------------------------------------------------------ #

@router.get("/images/{image_id}/thumb-path")
def get_image_thumb_path(image_id: int, session: Session = Depends(get_session)):
    img = session.get(Image, image_id)
    if not img or not img.md5:
        return {"native_path": None}
    dest = THUMBS_DIR / f"{img.md5}.jpg"
    if not dest.exists():
        return {"native_path": None}
    from backend.utils.native_share import to_native_share_path
    return {"native_path": to_native_share_path(str(dest))}


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/embed — pipeline SSE                        #
# ------------------------------------------------------------------ #

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_embed_pipeline(dataset_id: int, force: bool = False) -> None:
    """Pipeline complet (embedding → FAISS → UMAP → KMeans → rareté) en TÂCHE DE FOND.

    Contrairement à l'ancienne version SSE (générateur), ce pipeline tourne
    entièrement côté serveur, indépendamment de la connexion du client. La
    progression est publiée dans `_embed_progress[dataset_id]` et lue par le
    frontend via le poll 2s de `list_datasets` (robuste en SSH : plus de
    dépendance à une connexion directe au backend).

    IMPORTANT : les embeddings sont calculés sur l'IMAGE DE BASE (`img.file_path`),
    jamais sur un thumbnail (voir CLIPEmbedder.embed_images).

    Le verrou `_embedding_ids` (posé par l'endpoint) est libéré ici en fin de run.
    """
    from sqlmodel import Session as S
    from backend.db.database import engine

    def _prog(current: int, total: int, phase: str) -> None:
        _embed_progress[dataset_id] = {"current": current, "total": total, "phase": phase}

    with S(engine) as db:
        try:
            ds = db.get(Dataset, dataset_id)
            if not ds:
                return
            ds.status = "embedding"
            ds.updated_at = datetime.utcnow()
            db.commit()

            images = db.exec(
                select(Image)
                .where(Image.dataset_id == dataset_id)
                .order_by(Image.id)
            ).all()

            if not images:
                ds.status = "error"
                db.commit()
                logger.warning("Embed dataset %d : aucune image", dataset_id)
                return

            total = len(images)

            # --- Incremental : on ne recalcule CLIP que pour les images qui n'ont
            #     pas encore d'embedding. Relancer /embed apres avoir ajoute
            #     quelques images ne repaye plus l'encodage de tout le dataset
            #     (force=True pour tout refaire, ex. changement de modele).
            cached = {} if force else _embeddings_by_image_id(db, [img.id for img in images])
            todo = [img for img in images if img.id not in cached]
            reused = total - len(todo)
            if reused:
                logger.info("Embed dataset %d : %d/%d embeddings reutilises", dataset_id, reused, total)

            computed: dict = {}
            done = 0
            _prog(0, max(len(todo), 1), "embedding")

            batch_size = 64
            for batch_start in range(0, len(todo), batch_size):
                batch = todo[batch_start: batch_start + batch_size]
                paths = [img.file_path for img in batch]     # image de base, jamais thumbnail

                vecs = clip_embedder.embed_images(paths, batch_size=batch_size)

                existing_rows = {
                    e.image_id: e
                    for e in db.exec(
                        select(Embedding).where(Embedding.image_id.in_([i.id for i in batch]))
                    ).all()
                }
                for img, vec in zip(batch, vecs):
                    blob = vec.tobytes()
                    row = existing_rows.get(img.id)
                    if row:
                        row.vector_blob = blob
                    else:
                        db.add(Embedding(image_id=img.id, vector_blob=blob))
                    computed[img.id] = vec

                db.commit()
                done = min(batch_start + batch_size, len(todo))
                _prog(done, max(len(todo), 1), "embedding")

            # Matrice alignee sur `images` (ordre id ascendant) — INVARIANT FAISS.
            embeddings = np.vstack([
                computed.get(img.id, cached.get(img.id)) for img in images
            ]).astype(np.float32)

            _prog(0, 1, "indexing")
            index_path = faiss_indexer.index_path_str(dataset_id)
            faiss_indexer.build(dataset_id, embeddings)

            # Réduction 2D — le clustering ci-dessous est fait sur les embeddings
            # CLIP 512D, JAMAIS sur ces coordonnées 2D (distances déformées).
            _prog(0, 1, "umap")
            red = _load_reduction_settings_full()
            coords = umap_reducer.reduce(embeddings, red)
            for img, (x, y) in zip(images, coords):
                img.umap_x = float(x)
                img.umap_y = float(y)
            _store_reduction_config(ds, red)
            db.commit()

            # Clustering sur les embeddings 512D (source de vérité)
            _prog(0, 1, "clustering")
            cs = _load_cluster_settings()
            params = ({"n_clusters": ds.n_clusters} if cs["method"] == "kmeans"
                      else {"min_cluster_size": cs["hdbscan_min_cluster_size"]})
            _apply_clustering(db, dataset_id, embeddings, images, cs["method"], params)
            db.commit()

            _prog(0, 1, "scoring")   # (rareté déjà calculée dans _apply_clustering)
            ds = db.get(Dataset, dataset_id)

            # Centroïde du dataset (utilisé comme repli pour le filtrage cross-workspace)
            mean_vec = embeddings.mean(axis=0).astype(np.float32)
            n = float(np.linalg.norm(mean_vec))
            if n > 0:
                mean_vec = mean_vec / n
            ds.mean_embedding_blob = mean_vec.tobytes()

            ds.embedded_count = total
            ds.status = "ready"
            ds.umap_cached = True
            ds.faiss_index_path = index_path
            ds.reduction_settings_hash = _compute_reduction_hash()
            ds.updated_at = datetime.utcnow()
            db.commit()

            # Enrichir le registre global (filtrage cross-workspace des globaux non importés)
            if ds.is_global:
                import base64
                ann = None
                if ds.annotation_format:
                    ann = {"name": ds.annotation_name, "format": ds.annotation_format,
                           "frames": ds.annotation_frames, "boxes": ds.annotation_boxes}
                _enrich_global_registry(
                    ds.root_path,
                    mean_embedding_b64=base64.b64encode(ds.mean_embedding_blob).decode() if ds.mean_embedding_blob else None,
                    annotation=ann,
                )

            logger.info("Embed termine : dataset %d (%d images)", dataset_id, total)

        except Exception:
            logger.exception("Erreur pipeline embed dataset %d", dataset_id)
            try:
                ds = db.get(Dataset, dataset_id)
                if ds:
                    ds.status = "error"
                    db.commit()
            except Exception:
                pass
        finally:
            _embed_progress.pop(dataset_id, None)
            _embedding_ids.discard(dataset_id)


@router.post("/datasets/{dataset_id}/embed", status_code=202)
def start_embedding(
    dataset_id: int,
    force: bool = False,
    session: Session = Depends(get_session),
):
    """Lance le pipeline d'embedding en tâche de fond (non bloquant, poll-driven).

    Réponse immédiate. Un re-clic pendant que le pipeline tourne est un no-op
    (`already_running`) — le verrou `_embedding_ids` empêche tout double run.
    La progression est visible via le poll de `list_datasets` (embed_progress/…).

    `force=True` recalcule TOUS les embeddings ; par défaut seules les images
    sans embedding sont encodées (les autres sont relues depuis la base).
    """
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not clip_embedder.is_loaded:
        raise HTTPException(503, "Modele CLIP non charge")

    if dataset_id in _embedding_ids:
        return {"status": "already_running", "dataset_id": dataset_id}

    # Verrou + état initial AVANT de programmer la tâche (le prochain poll voit 'embedding')
    _embedding_ids.add(dataset_id)
    _embed_progress[dataset_id] = {"current": 0, "total": dataset.image_count or 1, "phase": "embedding"}
    dataset.status = "embedding"
    dataset.updated_at = datetime.utcnow()
    session.commit()

    submit_job(f"embed:{dataset_id}", _run_embed_pipeline, dataset_id, force)
    return {"status": "started", "dataset_id": dataset_id, "force": force}


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/recluster                                   #
# Relance KMeans + rareté sans recalculer embeddings ni UMAP.         #
# ------------------------------------------------------------------ #

def _run_recluster(dataset_id: int, method: str, params: dict) -> None:
    """Relance le clustering (KMeans/HDBSCAN) en tâche de fond, sans recalculer
    CLIP ni l'UMAP. Progression dans `_recluster_progress` (poll)."""
    from sqlmodel import Session as S
    from backend.db.database import engine

    with S(engine) as db:
        try:
            _recluster_progress[dataset_id] = {"current": 0, "total": 1, "phase": "loading"}
            images = db.exec(
                select(Image)
                .where(Image.dataset_id == dataset_id)
                .order_by(Image.id)
            ).all()

            vecs, valid_images = _vectors_for_images(db, images)

            if not vecs:
                logger.warning("Recluster dataset %d : aucun embedding", dataset_id)
                return

            embeddings = np.vstack(vecs)
            _recluster_progress[dataset_id] = {"current": 0, "total": 1, "phase": "clustering"}
            n_clusters = _apply_clustering(db, dataset_id, embeddings, valid_images, method, params)

            ds = db.get(Dataset, dataset_id)
            ds.updated_at = datetime.utcnow()
            db.commit()
            logger.info("Recluster dataset %d : methode=%s -> %d clusters",
                        dataset_id, method, n_clusters)

        except Exception:
            logger.exception("Erreur recluster dataset %d", dataset_id)
        finally:
            _recluster_progress.pop(dataset_id, None)
            _recluster_ids.discard(dataset_id)


@router.post("/datasets/{dataset_id}/recluster", status_code=202)
def recluster_dataset(
    dataset_id: int,
    body: ReclusterRequest,
    session: Session = Depends(get_session),
):
    """Relance le clustering (KMeans ou HDBSCAN) en tâche de fond, sans recalculer
    les embeddings CLIP ni l'UMAP. Progression via le poll (recluster_progress/…)."""
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(400, "Dataset pas encore prêt (lancez d'abord les embeddings)")

    if dataset_id in _recluster_ids:
        return {"status": "already_running", "dataset_id": dataset_id}

    method = (body.method or "kmeans").lower()
    if method == "hdbscan":
        params = {"min_cluster_size": max(2, body.min_cluster_size)}
    else:
        method = "kmeans"
        if body.n_clusters < 1:
            raise HTTPException(400, "n_clusters doit être >= 1")
        params = {"n_clusters": body.n_clusters}

    _recluster_ids.add(dataset_id)
    _recluster_progress[dataset_id] = {"current": 0, "total": 1, "phase": "loading"}
    submit_job(f"recluster:{dataset_id}", _run_recluster, dataset_id, method, params)
    return {"status": "started", "dataset_id": dataset_id, "method": method}


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/reduce                                      #
# Relance UNIQUEMENT la réduction 2D (UMAP/t-SNE/PCA) avec méthode +  #
# hyperparamètres choisis, sans recalculer CLIP ni le clustering.     #
# Tâche de fond + progression par poll (comme embed/recluster).       #
# ------------------------------------------------------------------ #

def _run_reduce(dataset_id: int, params: dict) -> None:
    """Recalcule la réduction 2D en tâche de fond depuis les embeddings 512D.
    Ne touche NI aux embeddings, NI au clustering. Progression : _reduce_progress."""
    from sqlmodel import Session as S
    from backend.db.database import engine

    with S(engine) as db:
        try:
            _reduce_progress[dataset_id] = {"current": 0, "total": 1, "phase": "loading"}
            images = db.exec(
                select(Image)
                .where(Image.dataset_id == dataset_id)
                .where(Image.is_duplicate_kept.is_not(False))
                .order_by(Image.id)
            ).all()

            vecs, valid_images = _vectors_for_images(db, images)

            if not vecs:
                logger.warning("Reduce dataset %d : aucun embedding", dataset_id)
                return

            embeddings = np.vstack(vecs)
            _reduce_progress[dataset_id] = {"current": 0, "total": 1, "phase": params.get("method", "umap")}
            coords = umap_reducer.reduce(embeddings, params)
            for img, (x, y) in zip(valid_images, coords):
                img.umap_x = float(x)
                img.umap_y = float(y)

            ds = db.get(Dataset, dataset_id)
            _store_reduction_config(ds, params)
            ds.reduction_settings_hash = _compute_reduction_hash()
            ds.updated_at = datetime.utcnow()
            db.commit()
            logger.info("Reduce dataset %d : methode=%s (%d images)",
                        dataset_id, params.get("method"), len(valid_images))

        except Exception:
            logger.exception("Erreur reduce dataset %d", dataset_id)
        finally:
            _reduce_progress.pop(dataset_id, None)
            _reduce_ids.discard(dataset_id)


@router.post("/datasets/{dataset_id}/reduce", status_code=202)
def reduce_dataset(
    dataset_id: int,
    body: ReduceRequest,
    session: Session = Depends(get_session),
):
    """Relance la réduction dimensionnelle 2D (UMAP/t-SNE/PCA) en tâche de fond,
    sans recalculer les embeddings CLIP ni le clustering. Progression via le poll
    (reduce_progress/…)."""
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(400, "Dataset pas encore prêt (lancez d'abord les embeddings)")

    if dataset_id in _reduce_ids:
        return {"status": "already_running", "dataset_id": dataset_id}

    method = (body.method or "umap").lower()
    if method not in ("umap", "tsne", "pca"):
        method = "umap"
    params = {
        "method": method,
        "umap_n_neighbors": max(2, body.umap_n_neighbors),
        "umap_min_dist": max(0.0, body.umap_min_dist),
        "tsne_perplexity": max(2, body.tsne_perplexity),
        "tsne_learning_rate": max(1.0, body.tsne_learning_rate),
    }

    _reduce_ids.add(dataset_id)
    _reduce_progress[dataset_id] = {"current": 0, "total": 1, "phase": "loading"}
    submit_job(f"reduce:{dataset_id}", _run_reduce, dataset_id, params)
    return {"status": "started", "dataset_id": dataset_id, "method": method}


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/remap — SSE                                #
# Recalcule UNIQUEMENT la réduction 2D (UMAP/t-SNE/PCA) sans        #
# re-embedder CLIP ni refaire le clustering.                         #
# Utilisé quand la méthode de réduction a changé dans les settings.  #
# ------------------------------------------------------------------ #

@router.post("/datasets/{dataset_id}/remap")
def remap_dataset(
    dataset_id: int,
    session: Session = Depends(get_session),
):
    """
    Recalcule la réduction dimensionnelle (UMAP/t-SNE/PCA) en utilisant
    les embeddings existants. Ne relance pas CLIP. Ne change pas le clustering.
    """
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(400, "Dataset pas encore prêt (lancez d'abord les embeddings)")

    def pipeline():
        from sqlmodel import Session as S
        from backend.db.database import engine

        with S(engine) as db:
            try:
                images = db.exec(
                    select(Image)
                    .where(Image.dataset_id == dataset_id)
                    .where(Image.is_duplicate_kept.is_not(False))
                    .order_by(Image.id)
                ).all()

                if not images:
                    yield _sse({"type": "error", "message": "Aucune image active dans ce dataset"})
                    return

                yield _sse({"type": "progress", "current": 0, "total": len(images), "phase": "loading"})

                vecs, valid_images = _vectors_for_images(db, images)

                if not vecs:
                    yield _sse({"type": "error", "message": "Aucun embedding trouvé — relancez le pipeline complet"})
                    return

                total = len(vecs)
                yield _sse({"type": "progress", "current": total, "total": total, "phase": "loading"})

                embeddings = np.vstack(vecs)

                # Réduction 2D selon la méthode configurée dans les settings
                yield _sse({"type": "progress", "current": 0, "total": 1, "phase": "umap"})
                red = _load_reduction_settings_full()
                coords = umap_reducer.reduce(embeddings, red)
                for img, (x, y) in zip(valid_images, coords):
                    img.umap_x = float(x)
                    img.umap_y = float(y)

                ds = db.get(Dataset, dataset_id)
                _store_reduction_config(ds, red)
                ds.reduction_settings_hash = _compute_reduction_hash()
                ds.updated_at = datetime.utcnow()
                db.commit()

                yield _sse({"type": "progress", "current": 1, "total": 1, "phase": "umap"})
                yield _sse({"type": "done", "dataset_id": dataset_id, "status": "ready"})
                logger.info("Remap termine pour dataset %d (%d images)", dataset_id, total)

            except Exception as exc:
                logger.exception("Erreur remap dataset %d", dataset_id)
                yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        pipeline(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/rebuild-without-duplicates — SSE           #
# Recalcule UMAP + KMeans sans les images rejetées.                  #
# ------------------------------------------------------------------ #

@router.post("/datasets/{dataset_id}/rebuild-without-duplicates")
def rebuild_without_duplicates(
    dataset_id: int,
    session: Session = Depends(get_session),
):
    """
    Recalcule UMAP + KMeans + rareté en excluant les images rejetées
    (is_duplicate_kept=False). Les rejetées voient leurs coordonnées effacées.
    """
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.umap_cached:
        raise HTTPException(400, "Dataset pas encore prêt (lancez d'abord les embeddings)")

    orig_n_clusters = dataset.n_clusters

    def pipeline():
        from sqlmodel import Session as S
        from backend.db.database import engine

        with S(engine) as db:
            try:
                all_images = db.exec(
                    select(Image)
                    .where(Image.dataset_id == dataset_id)
                    .order_by(Image.id)
                ).all()

                active_images = [img for img in all_images if img.is_duplicate_kept is not False]
                rejected_images = [img for img in all_images if img.is_duplicate_kept is False]

                if not active_images:
                    yield _sse({"type": "error", "message": "Aucune image active — toutes rejetées"})
                    return

                yield _sse({"type": "progress", "current": 0, "total": 3, "phase": "loading"})

                # Charger embeddings des images actives
                vecs, valid_active = _vectors_for_images(db, active_images)

                if not vecs:
                    yield _sse({"type": "error", "message": "Aucun embedding trouvé"})
                    return

                embeddings = np.vstack(vecs)

                # Effacer coords des images rejetées
                for img in rejected_images:
                    img.umap_x = None
                    img.umap_y = None
                    img.cluster_id = None
                    img.rarity_score = None
                db.commit()

                # UMAP
                yield _sse({"type": "progress", "current": 1, "total": 3, "phase": "umap"})
                coords = umap_reducer.reduce(embeddings)
                for img, (x, y) in zip(valid_active, coords):
                    img.umap_x = float(x)
                    img.umap_y = float(y)
                db.commit()

                # Clustering : la methode du dataset (KMeans ou HDBSCAN) est conservee
                yield _sse({"type": "progress", "current": 2, "total": 3, "phase": "clustering"})
                method, params = _dataset_cluster_spec(db.get(Dataset, dataset_id), min(orig_n_clusters, len(vecs)))
                _apply_clustering(db, dataset_id, embeddings, valid_active, method, params)

                ds = db.get(Dataset, dataset_id)
                ds.umap_cached = True
                ds.reduction_settings_hash = _compute_reduction_hash()
                ds.updated_at = datetime.utcnow()
                db.commit()

                yield _sse({"type": "progress", "current": 3, "total": 3, "phase": "scoring"})
                yield _sse({
                    "type": "done",
                    "dataset_id": dataset_id,
                    "active": len(valid_active),
                    "rejected": len(rejected_images),
                })
                logger.info(
                    "Rebuild-without-duplicates dataset %d : %d actives, %d rejetees",
                    dataset_id, len(valid_active), len(rejected_images),
                )

            except Exception as exc:
                logger.exception("Erreur rebuild-without-duplicates dataset %d", dataset_id)
                yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        pipeline(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/reset-duplicate-filter — SSE               #
# Efface les décisions doublon et reconstruit UMAP sur toutes images. #
# ------------------------------------------------------------------ #

@router.post("/datasets/{dataset_id}/reset-duplicate-filter")
def reset_duplicate_filter(
    dataset_id: int,
    session: Session = Depends(get_session),
):
    """
    Efface is_duplicate_kept pour toutes les images, puis recalcule
    UMAP + KMeans + rareté sur la totalité du dataset.
    """
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")

    orig_n_clusters = dataset.n_clusters

    def pipeline():
        from sqlmodel import Session as S
        from backend.db.database import engine

        with S(engine) as db:
            try:
                all_images = db.exec(
                    select(Image)
                    .where(Image.dataset_id == dataset_id)
                    .order_by(Image.id)
                ).all()

                # Effacer les décisions de doublon
                for img in all_images:
                    img.is_duplicate_kept = None
                db.commit()

                yield _sse({"type": "progress", "current": 0, "total": 3, "phase": "loading"})

                # Charger embeddings de TOUTES les images
                vecs, valid_images = _vectors_for_images(db, all_images)

                if not vecs:
                    yield _sse({"type": "error", "message": "Aucun embedding trouvé"})
                    return

                embeddings = np.vstack(vecs)

                # UMAP
                yield _sse({"type": "progress", "current": 1, "total": 3, "phase": "umap"})
                coords = umap_reducer.reduce(embeddings)
                for img, (x, y) in zip(valid_images, coords):
                    img.umap_x = float(x)
                    img.umap_y = float(y)
                db.commit()

                # Clustering : la methode du dataset (KMeans ou HDBSCAN) est conservee
                yield _sse({"type": "progress", "current": 2, "total": 3, "phase": "clustering"})
                method, params = _dataset_cluster_spec(db.get(Dataset, dataset_id), min(orig_n_clusters, len(vecs)))
                _apply_clustering(db, dataset_id, embeddings, valid_images, method, params)

                ds = db.get(Dataset, dataset_id)
                ds.umap_cached = True
                ds.updated_at = datetime.utcnow()
                db.commit()

                yield _sse({"type": "progress", "current": 3, "total": 3, "phase": "scoring"})
                yield _sse({"type": "done", "dataset_id": dataset_id, "total": len(valid_images)})
                logger.info(
                    "Reset-duplicate-filter dataset %d : %d images restaurees",
                    dataset_id, len(valid_images),
                )

            except Exception as exc:
                logger.exception("Erreur reset-duplicate-filter dataset %d", dataset_id)
                yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        pipeline(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/exclude-images                              #
# Marque des images comme rejetées (is_duplicate_kept=False),         #
# identique aux rejets de doublons — intégrées dans les exclusions.  #
# ------------------------------------------------------------------ #

@router.post("/datasets/{dataset_id}/exclude-images")
def exclude_images(
    dataset_id: int,
    body: ExcludeImagesRequest,
    session: Session = Depends(get_session),
):
    """
    Exclut une liste d'images du dataset courant en les marquant comme rejetées.
    Ces images sont invisibles sur la carte (filtre explore.py) et exclues du rebuild.
    """
    if not body.image_ids:
        return {"excluded": 0, "dataset_id": dataset_id}

    images = session.exec(
        select(Image).where(
            Image.id.in_(body.image_ids),
            Image.dataset_id == dataset_id,
        )
    ).all()

    for img in images:
        img.is_duplicate_kept = False
    session.commit()

    logger.info("Exclusion dataset %d : %d images marquees rejetees", dataset_id, len(images))
    return {"excluded": len(images), "dataset_id": dataset_id}


# ------------------------------------------------------------------ #
# POST /api/convert-optional_format                                               #
# Convertit un fichier .optional (ou un dossier) en PNG.                  #
# Crée {stem}_to_png/ au même niveau que le fichier source.          #
# ------------------------------------------------------------------ #

class ConvertOtiRequest(BaseModel):
    path: str   # chemin vers un .optional ou un dossier contenant des .optional


@router.post("/convert-optional_format")
def convert_optional_format(body: ConvertOtiRequest):
    """
    Lit le(s) fichier(s) .optional au chemin indiqué et convertit chaque image
    en PNG dans un dossier {stem}_to_png/ à côté du fichier source.

    Retourne les chemins des dossiers de sortie créés.
    """
    p = Path(body.path)
    if not p.exists():
        raise HTTPException(400, f"Chemin introuvable : {body.path}")
    try:
        adapter_source = p
        if p.is_dir():
            adapter_source = next(
                (
                    path
                    for path in p.rglob("*")
                    if path.is_file() and get_format_for_filename(str(path))
                ),
                p,
            )
        result = invoke_for_filename(str(adapter_source), "convert_path", p)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.exception("Erreur conversion optional_format")
        raise HTTPException(500, f"Erreur conversion : {exc}")
    return result


# ------------------------------------------------------------------ #
# POST /api/datasets/{id}/refresh-gallery                             #
# Régénère les miniatures gallery + stats pour un dataset global.    #
# À appeler manuellement si les thumbs sont vides.                   #
# ------------------------------------------------------------------ #

@router.post("/datasets/{dataset_id}/refresh-gallery")
def refresh_gallery(dataset_id: int, session: Session = Depends(get_session)):
    """Régénère les miniatures gallery et les stats de base pour un dataset global."""
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")
    if not dataset.is_global:
        raise HTTPException(400, "Ce dataset n'est pas global")

    gallery_thumb_urls = _copy_gallery_thumbnails(dataset, session)
    basic_stats = _compute_basic_gallery_stats(dataset_id, session)

    _upsert_global_registry(DatasetSummary(
        id=dataset.id, name=dataset.name, root_path=dataset.root_path,
        image_count=dataset.image_count, embedded_count=dataset.embedded_count,
        status=dataset.status, umap_cached=dataset.umap_cached,
        n_clusters=dataset.n_clusters, is_global=True,
        created_at=dataset.created_at, updated_at=dataset.updated_at,
    ), gallery_thumb_urls=gallery_thumb_urls, basic_stats=basic_stats)

    logger.info("Refresh gallery '%s' : %d thumbs, stats=%s", dataset.name, len(gallery_thumb_urls), bool(basic_stats))
    return {
        "gallery_thumb_urls": gallery_thumb_urls,
        "basic_stats": basic_stats,
        "thumb_count": len(gallery_thumb_urls),
    }


# ------------------------------------------------------------------ #
# DELETE /api/datasets/global?root_path=...                          #
# Suppression depuis le registre global (owner uniquement)           #
# IMPORTANT : doit être déclaré AVANT /datasets/{dataset_id}         #
# ------------------------------------------------------------------ #

@router.delete("/datasets/global")
def delete_global_registry_entry(root_path: str, session: Session = Depends(get_session)):
    """Supprime un dataset du registre global ET du workspace courant s'il y est présent.
    Réservé au propriétaire (added_by).
    """
    import shutil as _shutil
    entries = _load_global_registry()
    entry = next((e for e in entries if e.get("root_path") == root_path), None)
    if not entry:
        raise HTTPException(404, "Dataset non trouvé dans le registre global")

    owner = entry.get("added_by")
    if owner and owner != CURRENT_USER:
        audit.record("dataset.delete_global.refused", root_path=root_path, owner=owner)
        raise HTTPException(403, f"Seul '{owner}' peut supprimer ce dataset global")

    audit.record(
        "dataset.delete_global",
        root_path=root_path, name=entry.get("name"), owner=owner,
        image_count=entry.get("image_count"),
    )

    # Retirer du registre
    entries = [e for e in entries if e.get("root_path") != root_path]
    _save_global_registry(entries)

    # Supprimer le dossier gallery
    gallery_dir = DATASET_GALLERY_DIR / entry["name"]
    if gallery_dir.exists():
        try:
            _shutil.rmtree(str(gallery_dir))
        except Exception:
            pass

    # Cascade : supprimer également le dataset du workspace courant s'il y est présent
    ws_dataset = session.exec(
        select(Dataset).where(Dataset.root_path == root_path)
    ).first()
    if ws_dataset:
        _delete_dataset_from_session(ws_dataset.id, session)

    return {"success": True}


def _delete_dataset_from_session(dataset_id: int, session: Session) -> None:
    """Supprime un dataset et toutes ses données du workspace (helper interne)."""
    from backend.db.models import SubsetImage, Subset
    from backend.config import THUMBS_DIR as _THUMBS_DIR

    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        return

    faiss_indexer.remove(dataset_id)
    from backend.core import metadata_index
    metadata_index.delete_dataset(session, dataset_id)
    index_path = Path(faiss_indexer.index_path_str(dataset_id))
    if index_path.exists():
        index_path.unlink()
        try:
            index_path.parent.rmdir()
        except OSError:
            pass

    images = session.exec(select(Image).where(Image.dataset_id == dataset_id)).all()
    thumb_md5s = [img.md5 for img in images if img.md5]

    for img in images:
        links = session.exec(select(SubsetImage).where(SubsetImage.image_id == img.id)).all()
        for link in links:
            session.delete(link)
        if img.embedding:
            session.delete(img.embedding)
        session.delete(img)

    subsets = session.exec(select(Subset).where(Subset.dataset_id == dataset_id)).all()
    for s in subsets:
        # Supprimer les exports liés à ce subset
        from backend.db.models import SubsetExport
        exports = session.exec(select(SubsetExport).where(SubsetExport.subset_id == s.id)).all()
        for exp in exports:
            session.delete(exp)
        # Le dossier du subset (liens ou copies) sous <workspace>/subsets/ ne doit pas survivre a son dataset.
        if s.symlink_dir:
            from backend.core.subset_manager import delete_subset_dir
            delete_subset_dir(s.symlink_dir)
        session.delete(s)

    centroids = session.exec(
        select(ClusterCentroid).where(ClusterCentroid.dataset_id == dataset_id)
    ).all()
    for c in centroids:
        session.delete(c)

    session.delete(dataset)
    session.commit()

    # Supprimer les thumbnails orphelines
    for md5 in thumb_md5s:
        other = session.exec(
            select(Image).where(Image.md5 == md5)
        ).first()
        if not other:
            thumb_file = _THUMBS_DIR / f"{md5}.jpg"
            if thumb_file.exists():
                try:
                    thumb_file.unlink()
                except Exception:
                    pass


# ------------------------------------------------------------------ #
# DELETE /api/datasets/{id}                                           #
# ------------------------------------------------------------------ #

@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: int, session: Session = Depends(get_session)):
    dataset = session.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset introuvable")

    # Pas de vérification de propriété — tout utilisateur peut retirer un dataset
    # de son workspace. La suppression du registre global est dans DELETE /api/datasets/global.
    # NOTE : on ne touche PAS au registre global lors d'une suppression workspace.
    audit.record(
        "dataset.delete",
        dataset_id=dataset_id, name=dataset.name, root_path=dataset.root_path,
        image_count=dataset.image_count, is_global=dataset.is_global,
    )
    _delete_dataset_from_session(dataset_id, session)

    return {"success": True}
