# ============================================================
# api/orchestrator.py
# Endpoints dédiés à l'interconnexion avec l'Orchestrateur.
# Ne modifient pas le comportement autonome de Dataset_Explorer_App.
# ============================================================

import asyncio
import logging
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.config import ANNOTATION_APP_IMPORTS
from backend.core.embedder import clip_embedder
from backend.core.semantic_filter import semantic_search
from backend.core.subset_manager import create_subset_symlinks, export_to_annotation_app
from backend.db.database import get_session
from backend.db.models import Dataset, Embedding, Image, Subset, SubsetImage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class LoadDatasetRequest(BaseModel):
    name: str
    root_path: str
    n_clusters: int = 15
    wait_for_scan: bool = True      # poll jusqu'à status != "scanning"
    wait_timeout_s: int = 180       # max secondes d'attente
    # Si un dataset existe déjà pour ce root_path sous un AUTRE nom : par défaut on le
    # réutilise (évite un rescan+réembedding coûteux des mêmes images à chaque run).
    # allow_duplicate=True force la création d'une entrée distincte sous `name`, même
    # si le chemin est déjà connu — utilisé quand l'orchestrateur a averti l'utilisateur
    # du doublon (pré-vol sur le nœud Dataset Source) et qu'il a choisi de continuer.
    allow_duplicate: bool = False


class StartEmbedRequest(BaseModel):
    dataset_name: str
    # ID exact renvoyé par /load-dataset — a priorité sur dataset_name si fourni.
    # Nécessaire car Dataset_Explorer_App n'impose PAS l'unicité du nom (deux datasets
    # peuvent légitimement s'appeler pareil, ex. deux dossiers importés séparément
    # sous le même nom) : une recherche par nom seul peut alors retomber sur le
    # MAUVAIS dataset. dataset_name reste requis pour compat (appel manuel/UI
    # existant qui ne connaît pas l'id).
    dataset_id: Optional[int] = None
    wait_for_ready: bool = True     # bloque jusqu'à status=ready (embedding + UMAP + clusters)
    wait_timeout_s: int = 1800      # max secondes d'attente


class CreateSubsetRequest(BaseModel):
    dataset_name: str
    dataset_id: Optional[int] = None       # identité exacte, prioritaire sur le nom
    subset_name: str
    query: str                      # requête sémantique CLIP
    top_k: int = 80
    min_score: Optional[float] = None
    source_subset_name: Optional[str] = None  # si fourni, filtrer aux images de ce subset


class ExportSubsetRequest(BaseModel):
    subset_name: str
    subset_id: Optional[int] = None        # identité exacte, prioritaire sur le nom
    dataset_id: Optional[int] = None       # garde-fou contre les homonymes
    annotation_imports_path: Optional[str] = None  # override ANNOTATION_APP_IMPORTS


# ------------------------------------------------------------------ #
# POST /api/orchestrator/load-dataset                                 #
# Crée ou retrouve un dataset par nom/chemin.                        #
# Si wait_for_scan=True, attend la fin du scan (blocking poll).      #
# ------------------------------------------------------------------ #

@router.post("/load-dataset")
def load_dataset(body: LoadDatasetRequest, session: Session = Depends(get_session)):
    # Chemin UNC saisi cote Windows (\\hote\partage\...) : ce backend tourne en
    # PosixPath sur la VM et ne comprend pas cette syntaxe -> "Chemin introuvable"
    # systematique alors que le meme dossier marche depuis les autres ecrans de
    # l'app (qui traduisent deja, cf. /api/datasets et /api/datasets/check-path).
    from backend.utils.native_share import from_native_share_path
    body.root_path = from_native_share_path(body.root_path) or body.root_path
    root = Path(body.root_path)
    if not root.exists():
        raise HTTPException(400, f"Chemin introuvable : {body.root_path}")

    resolved_root = str(root.resolve())

    # Chercher les datasets existants pour ce chemin (peut y en avoir plusieurs si un
    # doublon a été créé volontairement, ex. "IR" / "IR_2" sur le même dossier).
    existing_matches = session.exec(
        select(Dataset).where(Dataset.root_path == resolved_root)
    ).all()
    existing = existing_matches[0] if existing_matches else None

    if existing and not body.allow_duplicate:
        logger.info("Orchestrator: dataset '%s' (id=%d) déjà existant", existing.name, existing.id)
        dataset_id = existing.id
        status = existing.status
    else:
        if existing and body.allow_duplicate:
            logger.info(
                "Orchestrator: création d'un doublon '%s' (root_path déjà connu sous '%s', id=%d)",
                body.name, existing.name, existing.id,
            )
        # Créer via l'endpoint datasets (importer depuis le client interne).
        # create_dataset planifie lui-même le scan dans le pool de jobs — plus
        # besoin du montage BackgroundTasks + executor jetable d'avant.
        from backend.api.datasets import create_dataset, DatasetCreate
        result = create_dataset(
            # allow_duplicate=True : le cas "meme root_path" est deja arbitre
            # plus haut par l'orchestrateur (reutilisation ou doublon assume),
            # inutile que create_dataset le refuse une seconde fois.
            body=DatasetCreate(
                root_path=body.root_path, name=body.name,
                n_clusters=body.n_clusters, allow_duplicate=True,
            ),
            session=session,
        )
        dataset_id = result.id
        status = result.status
        logger.info("Orchestrator: dataset '%s' (id=%d) créé, scan lancé", body.name, dataset_id)

    # Attendre fin du scan si demandé
    if body.wait_for_scan and status == "scanning":
        deadline = time.time() + body.wait_timeout_s
        while time.time() < deadline:
            time.sleep(3)
            session.expire_all()
            ds = session.get(Dataset, dataset_id)
            if ds and ds.status != "scanning":
                status = ds.status
                break
        else:
            raise HTTPException(504, f"Timeout scan dataset '{body.name}' (>{body.wait_timeout_s}s)")

    # Épingle le dataset au Playground pour qu'il soit VISIBLE tout de suite
    # (bug step 6 : « rien dans playground, je dois le mettre »). Le Playground ne
    # montre que les IDs de settings.playground_dataset_ids.
    try:
        from backend.api.settings import load_settings, _save_settings
        s = load_settings()
        if dataset_id not in s.playground_dataset_ids:
            s.playground_dataset_ids = [*s.playground_dataset_ids, dataset_id]
            _save_settings(s)
            logger.info("Orchestrator: dataset '%s' épinglé au Playground", body.name)
    except Exception as exc:
        logger.warning("Auto-pin Playground échoué : %s", exc)

    ds = session.get(Dataset, dataset_id)
    return {
        "dataset_id": dataset_id,
        "name": ds.name if ds else body.name,
        "status": ds.status if ds else status,
        "image_count": ds.image_count if ds else 0,
        "root_path": resolved_root,
        # Autres datasets connus pour ce même root_path (avant ou après ce call) —
        # permet à l'appelant (orchestrateur) de signaler le doublon même quand
        # allow_duplicate a été utilisé, ou quand la réutilisation silencieuse a eu lieu.
        "duplicate_of": [
            {"id": d.id, "name": d.name} for d in existing_matches if d.id != dataset_id
        ],
    }


# ------------------------------------------------------------------ #
# POST /api/orchestrator/start-embed                                  #
# Lance le pipeline embedding CLIP+FAISS+UMAP+KMeans.                #
# Retourne immédiatement — le pipeline tourne en SSE côté explorer.      #
# ------------------------------------------------------------------ #

@router.post("/start-embed")
async def start_embed(body: StartEmbedRequest, session: Session = Depends(get_session)):
    if body.dataset_id is not None:
        ds = session.get(Dataset, body.dataset_id)
        if not ds:
            raise HTTPException(404, f"Dataset id={body.dataset_id} introuvable")
    else:
        ds = session.exec(
            select(Dataset).where(Dataset.name == body.dataset_name)
        ).first()
        if not ds:
            raise HTTPException(404, f"Dataset '{body.dataset_name}' introuvable")
    if not clip_embedder.is_loaded:
        raise HTTPException(503, "Modèle CLIP non chargé")

    if ds.status == "ready":
        return {
            "dataset_id": ds.id,
            "status": "already_ready",
            "embedded_count": ds.embedded_count,
            "message": "Dataset déjà prêt — embedding déjà calculé",
        }

    dataset_id = ds.id
    image_count = ds.image_count
    dataset_name = body.dataset_name

    # Lance l'embedding s'il ne tourne pas déjà (le pipeline /embed tourne en fond,
    # verrou _embedding_ids côté explorer → pas de double-run).
    if ds.status != "embedding":
        async def _run_embed():
            try:
                import httpx
                from backend.config import BACKEND_PORT
                async with httpx.AsyncClient(timeout=30) as c:
                    await c.post(f"http://localhost:{BACKEND_PORT}/api/datasets/{dataset_id}/embed")
            except Exception as exc:
                logger.warning("Orchestrator start-embed background error: %s", exc)
        asyncio.create_task(_run_embed())

    # BLOQUANT (bug step 6) : on attend que l'embedding + UMAP + clustering soient
    # RÉELLEMENT finis (status=ready) avant de rendre la main. Sinon l'étape « embed »
    # se marquait done immédiatement → la gate « vérifier les clusters » apparaissait
    # trop tôt (Playground vide/en cours) et le create-subset suivant échouait en 400
    # (umap_cached=False) → aucun subset, aucun export.
    if body.wait_for_ready:
        deadline = time.time() + body.wait_timeout_s
        while time.time() < deadline:
            await asyncio.sleep(3)
            session.expire_all()
            d = session.get(Dataset, dataset_id)
            if d and d.status in ("ready", "error"):
                break
        d = session.get(Dataset, dataset_id)
        if d and d.status == "error":
            raise HTTPException(500, f"Embedding échoué pour '{dataset_name}'")
        if not d or d.status != "ready":
            raise HTTPException(504, f"Timeout embedding '{dataset_name}' (>{body.wait_timeout_s}s)")
        return {
            "dataset_id": dataset_id,
            "status": "ready",
            "embedded_count": d.embedded_count,
            "image_count": image_count,
            "message": f"Embedding terminé pour '{dataset_name}' ({d.embedded_count} images)",
        }

    return {
        "dataset_id": dataset_id,
        "status": "started",
        "image_count": image_count,
        "message": f"Embedding lancé pour '{dataset_name}' ({image_count} images)",
    }


# ------------------------------------------------------------------ #
# POST /api/orchestrator/create-subset                                #
# Crée un subset via recherche sémantique CLIP.                      #
# ------------------------------------------------------------------ #

@router.post("/create-subset")
def create_subset_orchestrator(body: CreateSubsetRequest, session: Session = Depends(get_session)):
    ds = session.get(Dataset, body.dataset_id) if body.dataset_id is not None else None
    if ds is None and body.dataset_id is None:
        matches = session.exec(select(Dataset).where(Dataset.name == body.dataset_name)).all()
        if len(matches) > 1:
            raise HTTPException(
                409,
                f"Dataset '{body.dataset_name}' ambigu ({len(matches)} résultats) : fournissez dataset_id",
            )
        ds = matches[0] if matches else None
    if not ds:
        raise HTTPException(404, f"Dataset '{body.dataset_name}' introuvable")
    if not ds.umap_cached:
        raise HTTPException(400, f"Dataset '{body.dataset_name}' pas encore prêt (lancez l'embedding d'abord)")

    # Recherche sémantique
    if body.min_score is not None:
        raw = semantic_search(ds.id, body.query, max(ds.image_count, 1), session)
        results = [r for r in raw if r["score"] >= body.min_score]
    else:
        results = semantic_search(ds.id, body.query, body.top_k, session)

    # Filtrer aux images du subset source si spécifié (subset-of-subset)
    if body.source_subset_name:
        src_subset = session.exec(
            select(Subset).where(
                Subset.dataset_id == ds.id,
                Subset.name == body.source_subset_name,
            )
        ).first()
        if not src_subset:
            raise HTTPException(404, f"Subset source '{body.source_subset_name}' introuvable")
        src_links = session.exec(select(SubsetImage).where(SubsetImage.subset_id == src_subset.id)).all()
        src_image_ids = {lnk.image_id for lnk in src_links}
        results = [r for r in results if r["image_id"] in src_image_ids]
        logger.info("Orchestrator: subset-of-subset '%s' filtré à %d images de '%s'",
                    body.subset_name, len(results), body.source_subset_name)

    if not results:
        raise HTTPException(404, f"Aucune image trouvée pour la requête '{body.query}'")

    image_ids = [r["image_id"] for r in results]

    # Vérifier si un subset de ce nom existe déjà → le supprimer
    existing_subset = session.exec(
        select(Subset).where(
            Subset.dataset_id == ds.id,
            Subset.name == body.subset_name,
        )
    ).first()
    if existing_subset:
        from backend.db.models import SubsetExport
        from backend.core.subset_manager import delete_subset_dir
        links = session.exec(select(SubsetImage).where(SubsetImage.subset_id == existing_subset.id)).all()
        for lnk in links:
            session.delete(lnk)
        # Sans ces lignes, chaque relance du meme pipeline laissait des exports orphelins et un dossier obsolete.
        for exp in session.exec(select(SubsetExport).where(SubsetExport.subset_id == existing_subset.id)).all():
            session.delete(exp)
        if existing_subset.symlink_dir:
            delete_subset_dir(existing_subset.symlink_dir)
        session.delete(existing_subset)
        session.commit()
        logger.info("Orchestrator: ancien subset '%s' supprimé", body.subset_name)

    # Créer le nouveau subset
    images = session.exec(
        select(Image).where(Image.id.in_(image_ids), Image.dataset_id == ds.id)
    ).all()

    subset = Subset(
        dataset_id=ds.id,
        name=body.subset_name,
        image_count=len(images),
    )
    session.add(subset)
    session.commit()
    session.refresh(subset)

    for img in images:
        session.add(SubsetImage(subset_id=subset.id, image_id=img.id))
    session.commit()

    image_paths = [img.file_path for img in images]
    try:
        subset_dir = create_subset_symlinks(body.subset_name, image_paths)
        subset.symlink_dir = str(subset_dir)
        session.commit()
    except Exception as exc:
        logger.warning("Liens subset echoues : %s", exc)

    logger.info("Orchestrator: subset '%s' créé (%d images)", body.subset_name, len(images))
    return {
        "subset_id": subset.id,
        "subset_name": body.subset_name,
        "dataset_id": ds.id,
        "image_count": len(images),
        "query": body.query,
    }


# ------------------------------------------------------------------ #
# POST /api/orchestrator/export-subset                                #
# Exporte un subset vers l'Annotation_App (symlinks/copies).         #
# ------------------------------------------------------------------ #

@router.post("/export-subset")
def export_subset_orchestrator(body: ExportSubsetRequest, session: Session = Depends(get_session)):
    subset = session.get(Subset, body.subset_id) if body.subset_id is not None else None
    if subset is None and body.subset_id is None:
        query = select(Subset).where(Subset.name == body.subset_name)
        if body.dataset_id is not None:
            query = query.where(Subset.dataset_id == body.dataset_id)
        matches = session.exec(query).all()
        if len(matches) > 1:
            raise HTTPException(
                409,
                f"Subset '{body.subset_name}' ambigu ({len(matches)} résultats) : fournissez subset_id",
            )
        subset = matches[0] if matches else None
    if not subset:
        raise HTTPException(404, f"Subset '{body.subset_name}' introuvable")
    if body.dataset_id is not None and subset.dataset_id != body.dataset_id:
        raise HTTPException(
            409,
            f"Subset '{body.subset_name}' appartient au dataset {subset.dataset_id}, pas {body.dataset_id}",
        )

    links = session.exec(select(SubsetImage).where(SubsetImage.subset_id == subset.id)).all()
    image_ids = [lnk.image_id for lnk in links]
    images = session.exec(select(Image).where(Image.id.in_(image_ids))).all()
    image_paths = [img.file_path for img in images]

    # Override du chemin d'export si fourni
    if body.annotation_imports_path:
        target_dir = Path(body.annotation_imports_path) / body.subset_name
        # Un rerun peut réutiliser le même nom pour un autre dataset. Remplacer le
        # dossier atomiquement côté logique évite de mélanger anciennes et nouvelles images.
        if target_dir.exists():
            import shutil
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)
        import shutil, os
        for p in image_paths:
            src = Path(p)
            dst = target_dir / src.name
            if not dst.exists():
                try:
                    os.symlink(src, dst)
                except Exception:
                    shutil.copy2(src, dst)
        export_path = str(target_dir)
    else:
        try:
            from backend.config import ANNOTATION_APP_IMPORTS
            stale_target = ANNOTATION_APP_IMPORTS / body.subset_name
            if stale_target.exists():
                import shutil
                shutil.rmtree(stale_target)
            target_dir = export_to_annotation_app(body.subset_name, image_paths)
            export_path = str(target_dir)
        except FileExistsError:
            # Already exported — return existing path (idempotent)
            from backend.config import ANNOTATION_APP_IMPORTS
            export_path = str(ANNOTATION_APP_IMPORTS / body.subset_name)
            logger.info("Orchestrator: subset '%s' deja exporte, chemin: %s", body.subset_name, export_path)
        except Exception as exc:
            raise HTTPException(500, f"Export échoué : {exc}")

    logger.info("Orchestrator: subset '%s' exporté vers %s", body.subset_name, export_path)
    return {
        "subset_id": subset.id,
        "dataset_id": subset.dataset_id,
        "subset_name": body.subset_name,
        "export_path": export_path,
        "image_count": len(image_paths),
    }


# ------------------------------------------------------------------ #
# GET /api/orchestrator/status                                        #
# Retourne l'état courant du dataset (pour human gate de vérif).     #
# ------------------------------------------------------------------ #

@router.get("/status")
def get_status(dataset_name: str = "", session: Session = Depends(get_session)):
    if not dataset_name:
        datasets = session.exec(select(Dataset).order_by(Dataset.updated_at.desc())).all()
        return {
            "datasets": [
                {"id": d.id, "name": d.name, "status": d.status, "image_count": d.image_count}
                for d in datasets
            ]
        }
    ds = session.exec(select(Dataset).where(Dataset.name == dataset_name)).first()
    if not ds:
        raise HTTPException(404, f"Dataset '{dataset_name}' introuvable")
    return {
        "dataset_id": ds.id,
        "name": ds.name,
        "status": ds.status,
        "image_count": ds.image_count,
        "embedded_count": ds.embedded_count,
        "ready": ds.status == "ready",
    }
