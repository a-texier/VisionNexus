# ============================================================
# models/routers/orchestrator.py
# Endpoints dédiés à l'interconnexion avec l'Orchestrateur.
# Ne cassent pas le fonctionnement autonome de l'app.
# ============================================================

import asyncio
import logging
import time
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.annotation import Annotation
from backend.models.frame import Frame
from backend.models.label_class import LabelClass
from backend.models.project import Project, ProjectType

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

# Suivi live de l'import d'images de create-project (scan Annotation), par nom de projet.
# Lu par l'orchestrator via /project-status pendant l'import → barre de scan sous le node.
_import_progress: dict[str, dict] = {}


# ------------------------------------------------------------------ #
# Schémas                                                             #
# ------------------------------------------------------------------ #

class LabelClassInput(BaseModel):
    name: str
    color: str = "#FF6B6B"
    class_index: Optional[int] = None


class CreateProjectRequest(BaseModel):
    subset_name: str                        # nom du subset exporté par Visu
    project_name: Optional[str] = None      # défaut : subset_name
    label_classes: List[LabelClassInput] = []
    import_path: Optional[str] = None       # override du chemin d'import
    mode: str = "sequence"                  # "sequence" (Séquence Image) | "random" (Image Aléatoire)


class ExportYoloRequest(BaseModel):
    project_name: str
    export_name: Optional[str] = None
    split_train: float = 0.8
    split_val: float = 0.2
    split_test: float = 0.0
    wait_timeout_s: int = 120
    # Orchestrator step 6 (Annotation Locked+Manuel) : nom d'un export EXISTANT
    # choisi par l'utilisateur au gate "annoter" (liste des exports déjà produits
    # pour ce projet). Si présent ET que cet export existe réellement sur disque,
    # on le réutilise tel quel — AUCUN nouvel export n'est déclenché (idempotent,
    # évite d'écraser/relancer un job pour rien). Sinon (absent ou introuvable),
    # comportement normal inchangé : export frais.
    reuse_if_exists: Optional[str] = None


class ExportVerRequest(BaseModel):
    project_name: str
    export_name: Optional[str] = None
    wait_timeout_s: int = 120


class AutoAnnotateRequest(BaseModel):
    project_name: str
    model: str = "sam3"             # "sam3" | "grounding_dino"
    text_prompt: str = ""           # prompt texte open-vocabulary
    threshold: float = 0.20         # seuil de confiance (box_threshold)


def _resolve_import_root(subset_name: str, import_path: Optional[str] = None) -> Optional[Path]:
    """Dossier d'import réel pour un subset donné — plusieurs emplacements possibles
    (chemin explicite, imports courants, legacy). Partagé par create_project et le
    check de doublon (même résolution, sinon les deux pourraient diverger)."""
    from backend.config import DATA_DIR
    candidates = [
        Path(import_path) if import_path else None,
        DATA_DIR / "imports" / subset_name,
        Path(DATA_DIR).parent / "imports" / subset_name,  # legacy
    ]
    for p in candidates:
        if p and p.exists():
            return p
    return None


# ------------------------------------------------------------------ #
# GET /api/orchestrator/check-source                                  #
# Projets existants dont le source_path correspond DÉJÀ à ce subset — #
# averti AVANT de créer un projet séparé sur les mêmes images.       #
# ------------------------------------------------------------------ #

@router.get("/check-source")
def check_source(subset_name: str, session: Session = Depends(get_session)):
    import_root = _resolve_import_root(subset_name)
    if not import_root:
        return []
    matches = session.exec(select(Project).where(Project.source_path == str(import_root))).all()
    return [
        {"id": p.id, "name": p.name, "frame_count": p.frame_count, "annotated_count": p.annotated_count}
        for p in matches
    ]


# ------------------------------------------------------------------ #
# POST /api/orchestrator/create-project                               #
# Crée un projet d'annotation depuis un subset exporté par Visu.    #
# ------------------------------------------------------------------ #

@router.post("/create-project")
def create_project(body: CreateProjectRequest, session: Session = Depends(get_session)):
    project_name = body.project_name or body.subset_name

    import_root = _resolve_import_root(body.subset_name, body.import_path)

    if not import_root:
        from backend.config import DATA_DIR
        searched = [
            str(p) for p in (
                Path(body.import_path) if body.import_path else None,
                DATA_DIR / "imports" / body.subset_name,
                Path(DATA_DIR).parent / "imports" / body.subset_name,
            ) if p
        ]
        raise HTTPException(
            404,
            f"Dossier d'import introuvable pour '{body.subset_name}'. "
            f"Chemins cherchés : {searched}. "
            "Vérifiez que Dataset_Explorer_App a exporté ce subset."
        )

    # Doublon : un AUTRE projet (nom différent) a déjà ce même source_path — averti
    # dans la réponse (l'orchestrateur relaie), pas bloquant (créer un projet
    # séparé sur les mêmes images est un choix valide, ex. deux jeux de classes).
    duplicate_of = [
        {"id": p.id, "name": p.name}
        for p in session.exec(select(Project).where(Project.source_path == str(import_root))).all()
        if p.name != project_name
    ]

    # Glob des images
    SUPPORTED = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
    image_files = sorted([
        p for p in import_root.rglob("*")
        if p.suffix.lower() in SUPPORTED and (p.is_file() or (p.is_symlink() and p.exists()))
    ])

    if not image_files:
        raise HTTPException(400, f"Aucune image trouvée dans {import_root}")

    # Projet existant ?
    existing = session.exec(select(Project).where(Project.name == project_name)).first()
    if existing:
        logger.info("Orchestrator: projet '%s' (id=%d) existant", project_name, existing.id)
        return {
            "project_id": existing.id,
            "project_name": existing.name,
            "frame_count": existing.frame_count,
            "import_path": str(import_root),
            "status": "already_exists",
            "duplicate_of": duplicate_of,
        }

    # Type de projet : "sequence" → VIDEO (Séquence Image), sinon IMAGE (Aléatoire).
    # L'Orchestrateur envoie `mode` depuis le node Annotation (annotation_mode).
    project_type = ProjectType.VIDEO if str(body.mode).lower() == "sequence" else ProjectType.IMAGE

    # Créer le projet
    project = Project(
        name=project_name,
        description=f"Créé par l'Orchestrateur depuis subset '{body.subset_name}'",
        project_type=project_type,
        source_path=str(import_root),
        frame_count=0,
        annotated_count=0,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    # Classes d'annotation
    default_classes = body.label_classes or [LabelClassInput(name="object", color="#6366f1")]
    for idx, cls in enumerate(default_classes):
        lc = LabelClass(
            project_id=project.id,
            name=cls.name,
            color=cls.color,
            class_index=cls.class_index if cls.class_index is not None else idx,
        )
        session.add(lc)
    session.commit()

    # Importer les images comme frames
    from PIL import Image as PILImage
    from backend.services.dataset_service import dataset_service as _ds
    import os as _os
    frames_created = 0
    frames_dir = _ds.get_frames_dir(project.id)
    _total_imgs = len(image_files)
    _import_progress[project_name] = {"current": 0, "total": _total_imgs}

    for idx, img_path in enumerate(image_files):
        try:
            with PILImage.open(img_path) as pil:
                w, h = pil.size
        except Exception:
            w, h = 0, 0

        frame = Frame(
            project_id=project.id,
            filename=img_path.name,
            frame_index=idx,
            width=w,
            height=h,
            is_annotated=False,
            is_extracted=True,
            source_frame_index=idx,
        )
        session.add(frame)
        frames_created += 1
        _import_progress[project_name] = {"current": frames_created, "total": _total_imgs}

        # Make the image reachable via the static /media URL that list_frames returns.
        # Images live in import_root; link them into the standard frames directory.
        target = frames_dir / img_path.name
        if not target.exists():
            try:
                _os.symlink(img_path.resolve(), target)
            except (OSError, NotImplementedError):
                import shutil as _shutil
                _shutil.copy2(str(img_path), str(target))

    project.frame_count = frames_created
    session.commit()
    _import_progress.pop(project_name, None)   # import terminé → fin du suivi live

    logger.info("Orchestrator: projet '%s' (id=%d) créé — %d images", project_name, project.id, frames_created)
    return {
        "project_id": project.id,
        "project_name": project_name,
        "frame_count": frames_created,
        "import_path": str(import_root),
        "status": "created",
        "duplicate_of": duplicate_of,
    }


# ------------------------------------------------------------------ #
# GET /api/orchestrator/project-status                                #
# ------------------------------------------------------------------ #

@router.get("/project-status")
def project_status(project_name: str, session: Session = Depends(get_session)):
    project = session.exec(select(Project).where(Project.name == project_name)).first()
    if not project:
        raise HTTPException(404, f"Projet '{project_name}' introuvable")

    annotated = session.exec(
        select(Frame).where(Frame.project_id == project.id, Frame.is_annotated == True)
    )
    annotated_count = len(list(annotated))

    ann_count = len(session.exec(
        select(Annotation).join(Frame).where(Frame.project_id == project.id)
    ).all())

    _imp = _import_progress.get(project.name, {})
    return {
        "project_id": project.id,
        "project_name": project.name,
        "frame_count": project.frame_count,
        "annotated_count": annotated_count,
        "annotation_count": ann_count,
        "completion_pct": round(annotated_count / project.frame_count * 100, 1) if project.frame_count else 0,
        # Scan live de l'import d'images (pendant create-project) → barre sous le node.
        "import_current": _imp.get("current", 0),
        "import_total": _imp.get("total", 0),
    }


# ------------------------------------------------------------------ #
# Idempotence de l'export YOLO orchestrateur                         #
# ------------------------------------------------------------------ #
# Relancer une chaine echouee redéclenchait un export complet sur le meme
# dossier, ce qui (a) refaisait un travail long pour rien quand rien n'avait
# changé et (b) écrasait un dossier encore ouvert par une étape aval -> WinError
# 32 (fichier verrouillé). On calcule donc une signature des ENTREES de l'export
# (splits, classes, nombre et date des annotations) : si un export de meme
# signature existe deja, on le réutilise sans rien réécrire ; si les paramètres
# ont changé, on écrit dans un nouveau nom suffixé "(1)", "(2)"... plutot que
# d'écraser l'ancien. Aucun dossier existant n'est donc jamais réécrit.

_EXPORT_SIG_FILE = ".orchestrator_export.json"


def _yolo_export_signature(
    session: Session, project: Project, *, splits: tuple[float, float, float], fmt: str = "yolo_bbox"
) -> tuple[dict, str]:
    """Signature des entrées de l'export et son hash sha256 (stable, trié)."""
    import hashlib
    import json as _json

    ann_rows = session.exec(
        select(Annotation.id, Annotation.created_at).join(Frame).where(Frame.project_id == project.id)
    ).all()
    frame_ids = session.exec(select(Frame.id).where(Frame.project_id == project.id)).all()
    classes = session.exec(
        select(LabelClass).where(LabelClass.project_id == project.id).order_by(LabelClass.class_index)
    ).all()
    last_created = max((r[1] for r in ann_rows if r[1] is not None), default=None)
    payload = {
        "format": fmt,
        "include_unannotated": True,
        "splits": [round(splits[0], 4), round(splits[1], 4), round(splits[2], 4)],
        "annotation_count": len(ann_rows),
        "frame_count": len(frame_ids),
        "last_annotation_at": last_created.isoformat() if last_created else "",
        "classes": [[c.class_index, c.full_name] for c in classes],
    }
    digest = hashlib.sha256(
        _json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return payload, digest


def _is_valid_export(path: Path) -> bool:
    """Dossier d'export réellement produit (contient un data.yaml)."""
    return path.is_dir() and ((path / "data.yaml").exists() or any(path.rglob("data.yaml")))


def _read_export_signature(export_dir: Path) -> Optional[str]:
    import json as _json

    sig_file = export_dir / _EXPORT_SIG_FILE
    if not sig_file.is_file():
        return None
    try:
        return _json.loads(sig_file.read_text(encoding="utf-8")).get("signature_hash")
    except (OSError, ValueError):
        return None


def _resolve_export_target(
    exports_dir: Path, base: str, current_hash: str, *, max_variants: int = 200
) -> tuple[str, Optional[Path]]:
    """Choisit le nom d'export cible.

    Renvoie (nom, dossier_a_reutiliser). Si un export de meme signature existe,
    dossier_a_reutiliser pointe dessus (aucun réexport). Sinon le nom est le
    premier libre parmi base, "base (1)", "base (2)"... (aucun écrasement).
    """
    first_free: Optional[str] = None
    for i in range(0, max_variants):
        name = base if i == 0 else f"{base} ({i})"
        folder = exports_dir / name
        taken = _is_valid_export(folder) or (exports_dir / f"{name}.zip").exists()
        if taken:
            if _is_valid_export(folder) and _read_export_signature(folder) == current_hash:
                return name, folder
            continue
        if first_free is None:
            first_free = name
    return (first_free or base), None


def _write_export_signature(export_path: str, payload: dict, digest: str, name: str) -> None:
    import json as _json

    try:
        folder = Path(export_path)
        if folder.is_dir():
            (folder / _EXPORT_SIG_FILE).write_text(
                _json.dumps(
                    {"signature_hash": digest, "signature": payload, "export_name": name},
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
    except OSError:
        logger.warning("Signature d'export non écrite pour '%s'", name)


# ------------------------------------------------------------------ #
# POST /api/orchestrator/export-yolo                                  #
# Déclenche l'export YOLO via l'endpoint existant et attend.         #
# ------------------------------------------------------------------ #

@router.post("/export-yolo")
async def export_yolo_orchestrator(body: ExportYoloRequest, session: Session = Depends(get_session)):
    from backend.config import DATA_DIR, BACKEND_PORT
    import httpx

    project = session.exec(select(Project).where(Project.name == body.project_name)).first()
    if not project:
        raise HTTPException(404, f"Projet '{body.project_name}' introuvable")

    # Réutilisation d'un export déjà produit (step 6 orchestrateur, Locked+Manuel) :
    # même heuristique de détection que le scanner de l'orchestrateur
    # (Orchestrator_App/backend/api/graphs.py::get_workspace_outputs) — dossier avec
    # data.yaml, OU .zip du même nom — pour rester cohérent avec ce que l'utilisateur
    # a VU dans la liste au moment de choisir.
    if body.reuse_if_exists:
        reuse_dir = DATA_DIR / "exports" / body.reuse_if_exists
        reuse_zip = DATA_DIR / "exports" / f"{body.reuse_if_exists}.zip"
        has_yaml = reuse_dir.is_dir() and (
            (reuse_dir / "data.yaml").exists() or any(reuse_dir.rglob("data.yaml"))
        )
        if has_yaml or reuse_zip.exists():
            existing_path = str(reuse_dir if has_yaml else reuse_zip)
            logger.info("Orchestrator: réutilisation export YOLO existant '%s' → %s",
                        body.reuse_if_exists, existing_path)
            return {
                "export_name": body.reuse_if_exists,
                "export_path": existing_path,
                "zip_path": str(reuse_zip) if reuse_zip.exists() else None,
                "artifact_type": "dataset",
                "format": "yolo",
                "schema": "yolo-dataset-v1",
                "project_name": body.project_name,
                "status": "done",
                "reused": True,
            }
        logger.info("Orchestrator: export '%s' choisi mais introuvable sur disque — "
                    "export frais de '%s' à la place.", body.reuse_if_exists, body.project_name)

    # Garde-fou anti-blocage (step 7) : refuser un export SANS aucune annotation.
    # Sinon l'export produit un dataset vide → l'entraînement aval part sur rien et
    # semble « tourner à l'infini ». On échoue tôt avec un message clair et actionnable.
    ann_count = len(session.exec(
        select(Annotation).join(Frame).where(Frame.project_id == project.id)
    ).all())
    if ann_count == 0:
        raise HTTPException(
            400,
            f"Projet '{body.project_name}' : aucune annotation à exporter. "
            f"Annotez au moins une image (ou lancez l'annotation auto) avant de continuer vers l'étape suivante."
        )

    # Idempotence : réutiliser un export de mêmes paramètres, sinon suffixer.
    base_name = body.export_name or f"{body.project_name}-yolo"
    exports_dir = DATA_DIR / "exports"
    sig_payload, sig_hash = _yolo_export_signature(
        session, project, splits=(body.split_train, body.split_val, body.split_test)
    )
    export_name, reuse_dir = _resolve_export_target(exports_dir, base_name, sig_hash)
    if reuse_dir is not None:
        reuse_zip = exports_dir / f"{export_name}.zip"
        logger.info(
            "Orchestrator: export YOLO '%s' inchangé (mêmes paramètres) → réutilisation, pas de ré-export.",
            export_name,
        )
        return {
            "export_name": export_name,
            "export_path": str(reuse_dir),
            "zip_path": str(reuse_zip) if reuse_zip.exists() else None,
            "artifact_type": "dataset",
            "format": "yolo",
            "schema": "yolo-dataset-v1",
            "project_name": body.project_name,
            "status": "done",
            "reused": True,
        }

    # Appel interne : lancer l'export via l'endpoint existant
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"http://localhost:{BACKEND_PORT}/api/projects/{project.id}/export",
            json={
                "format": "yolo_bbox",
                "split_train": body.split_train,
                "split_val": body.split_val,
                "split_test": body.split_test,
                "include_unannotated": True,
                "export_name": export_name,
                # Pipeline local : dossier YOLO directement consommable, images liées.
                # Un ZIP portable reste générable depuis l'UI à la demande.
                "symlink_images": True,
            }
        )
        if r.status_code >= 400:
            raise HTTPException(r.status_code, f"Export échoué : {r.text}")

        task_id = r.json().get("task_id")

    if not task_id:
        raise HTTPException(500, "Pas de task_id retourné par l'export")

    # Polling jusqu'à completion
    deadline = time.time() + body.wait_timeout_s
    export_path = None
    zip_path = None

    async with httpx.AsyncClient(timeout=10) as c:
        while time.time() < deadline:
            await asyncio.sleep(3)
            r = await c.get(f"http://localhost:{BACKEND_PORT}/api/exports/{task_id}/status")
            if r.status_code >= 400:
                break
            d = r.json()
            status = d.get("status", "")
            if status in ("done", "completed"):
                export_path = d.get("folder_path") or d.get("export_path")
                zip_path = d.get("zip_path")
                break
            if status == "error":
                raise HTTPException(500, f"Export YOLO échoué : {d.get('error')}")

    if not export_path:
        # Fallback : chercher dans le dossier exports
        export_dir = DATA_DIR / "exports"
        matching = sorted(export_dir.glob(f"{export_name}*")) if export_dir.exists() else []
        export_path = str(matching[-1]) if matching else str(DATA_DIR / "exports" / export_name)

    # Empreinte des entrées : un ré-lancement à paramètres identiques la
    # retrouvera et sautera l'export au lieu de réécrire ce dossier.
    _write_export_signature(export_path, sig_payload, sig_hash, export_name)

    logger.info("Orchestrator: export YOLO '%s' → %s", export_name, export_path)
    return {
        "export_name": export_name,
        "export_path": export_path,
        "zip_path": zip_path,
        "artifact_type": "dataset",
        "format": "yolo",
        "schema": "yolo-dataset-v1",
        "project_name": body.project_name,
        "status": "done",
    }


# ------------------------------------------------------------------ #
# POST /api/orchestrator/export-ver                                   #
# Exporte les annotations GT natives (.ver, format texte natif) — le pendant  #
# de export-yolo pour la branche Inference/tracking (port out_ver).   #
# ------------------------------------------------------------------ #

@router.post("/export-ver")
async def export_ver_orchestrator(body: ExportVerRequest, session: Session = Depends(get_session)):
    from backend.config import DATA_DIR, BACKEND_PORT
    import httpx

    project = session.exec(select(Project).where(Project.name == body.project_name)).first()
    if not project:
        raise HTTPException(404, f"Projet '{body.project_name}' introuvable")

    ann_count = len(session.exec(
        select(Annotation).join(Frame).where(Frame.project_id == project.id)
    ).all())
    if ann_count == 0:
        raise HTTPException(
            400,
            f"Projet '{body.project_name}' : aucune annotation à exporter en .ver. "
            f"Annotez au moins une image avant de continuer.")

    export_name = body.export_name or f"{body.project_name}-ver"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"http://localhost:{BACKEND_PORT}/api/projects/{project.id}/export",
            json={
                "output_format": "ver",     # fichier .ver par séquence (format texte natif natif)
                "include_unannotated": True,
                "export_name": export_name,
                # Le dossier .ver natif suffit dans le workspace ; pas de .ver.zip redondant.
                "symlink_images": True,
            },
        )
        if r.status_code >= 400:
            raise HTTPException(r.status_code, f"Export .ver échoué : {r.text}")
        task_id = r.json().get("task_id")
    if not task_id:
        raise HTTPException(500, "Pas de task_id retourné par l'export .ver")

    deadline = time.time() + body.wait_timeout_s
    export_path = None
    async with httpx.AsyncClient(timeout=10) as c:
        while time.time() < deadline:
            await asyncio.sleep(3)
            r = await c.get(f"http://localhost:{BACKEND_PORT}/api/exports/{task_id}/status")
            if r.status_code >= 400:
                break
            d = r.json()
            if d.get("status") in ("done", "completed"):
                export_path = d.get("folder_path") or d.get("export_path") or d.get("zip_path")
                break
            if d.get("status") == "error":
                raise HTTPException(500, f"Export .ver échoué : {d.get('error')}")

    if not export_path:
        export_dir = DATA_DIR / "exports"
        matching = sorted(export_dir.glob(f"{export_name}*")) if export_dir.exists() else []
        export_path = str(matching[-1]) if matching else str(DATA_DIR / "exports" / export_name)

    folder_path = export_path if Path(export_path).is_dir() else None
    if folder_path:
        ver_files = sorted(Path(folder_path).rglob("*.ver"))
        if ver_files:
            export_path = str(ver_files[0])

    logger.info("Orchestrator: export .ver '%s' → %s", export_name, export_path)
    return {"export_name": export_name, "export_path": export_path,
            "folder_path": folder_path,
            "artifact_type": "annotations", "format": "ver", "schema": "vision-ver-v1",
            "project_name": body.project_name, "status": "done"}


# ------------------------------------------------------------------ #
# POST /api/orchestrator/auto-annotate                                #
# Annote automatiquement toutes les frames d'un projet via SAM3      #
# ou Grounding DINO. Les frames sans détection sont marquées empty.  #
# ------------------------------------------------------------------ #

@router.post("/auto-annotate")
async def auto_annotate(body: AutoAnnotateRequest, session: Session = Depends(get_session)):
    from backend.config import BACKEND_PORT
    from backend.models.label_class import LabelClass
    from backend.models.annotation import Annotation, AnnotationType
    import httpx

    project = session.exec(select(Project).where(Project.name == body.project_name)).first()
    if not project:
        raise HTTPException(404, f"Projet '{body.project_name}' introuvable")

    frames = session.exec(select(Frame).where(Frame.project_id == project.id)).all()
    if not frames:
        raise HTTPException(400, "Aucune frame dans ce projet")

    label_class = session.exec(
        select(LabelClass).where(LabelClass.project_id == project.id)
    ).first()
    if not label_class:
        raise HTTPException(400, "Aucune classe d'annotation définie")

    # Relance sur un projet DEJA annote (cas courant : fork de run, ou simple
    # re-lancement du graphe). Sans purge :
    #   - chaque detection s'ajoutait aux precedentes -> boites en double dans
    #     l'export YOLO, donc dans le training ;
    #   - annotated_count etait deja au maximum, donc la barre de progression de
    #     l'Orchestrateur affichait 100 % des la premiere seconde et le node
    #     semblait fige alors que le travail commencait a peine.
    # On ne touche QUE ce que l'IA a produit : une annotation manuelle
    # (is_auto=False) est conservee, et sa frame reste marquee annotee.
    previous_auto = session.exec(
        select(Annotation).join(Frame).where(Frame.project_id == project.id,
                                             Annotation.is_auto == True)  # noqa: E712
    ).all()
    if previous_auto:
        auto_frame_ids = {a.frame_id for a in previous_auto}
        for ann in previous_auto:
            session.delete(ann)
        session.flush()
        kept = {
            a.frame_id for a in session.exec(
                select(Annotation).join(Frame).where(Frame.project_id == project.id)
            ).all()
        }
        for frame in frames:
            if frame.id in auto_frame_ids and frame.id not in kept:
                frame.is_annotated = False
                frame.is_empty = False
                session.add(frame)
        session.commit()
        logger.info("auto-annotate: %d annotation(s) IA precedentes purgees sur '%s'",
                    len(previous_auto), project.name)

    total_annotations = 0
    annotated_frames = 0
    empty_frames = 0

    # Resolve base image directory: prefer project.source_path, fallback to dataset_service
    from backend.services.dataset_service import dataset_service as _ds
    import os as _os

    def _image_path(frame) -> str:
        """Return absolute path to frame image, resolving symlinks."""
        if project.source_path:
            candidate = Path(project.source_path) / frame.filename
            if candidate.exists() or candidate.is_symlink():
                return str(candidate.resolve())
        fallback = _ds.get_frame_path(project.id, frame.filename)
        return str(fallback)

    if body.model == "sam3":
        from backend.services.sam3_service import get_sam3_service
        svc = get_sam3_service()
        if not svc.is_available:
            raise HTTPException(503, "SAM3 non disponible")
        if not svc.is_loaded:
            svc.load_model()

        for frame in frames:
            try:
                img_path = _image_path(frame)
                detections = await svc.detect_and_segment(
                    image_path=img_path,
                    text_prompt=body.text_prompt,
                    img_width=frame.width or 1,
                    img_height=frame.height or 1,
                )
                detections = [d for d in detections if d.get("score", 1.0) >= body.threshold]
            except Exception as exc:
                logger.warning("auto-annotate SAM3 frame %d: %s", frame.id, exc)
                detections = []

            if not detections:
                frame.is_empty = True
                session.add(frame)
                empty_frames += 1
                continue

            for det in detections:
                bbox = det.get("bbox_yolo", [0.5, 0.5, 0.1, 0.1])
                ann = Annotation(
                    frame_id=frame.id,
                    class_id=label_class.id,
                    annotation_type=AnnotationType.BBOX,
                    cx=float(bbox[0]), cy=float(bbox[1]),
                    width=float(bbox[2]), height=float(bbox[3]),
                    confidence=float(det.get("score", 1.0)),
                    is_auto=True, source_algorithm="sam3",
                )
                session.add(ann)
                total_annotations += 1

            frame.is_annotated = True
            session.add(frame)
            annotated_frames += 1

    else:
        # Grounding DINO via internal HTTP (handles its own path lookup)
        async with httpx.AsyncClient(timeout=120) as c:
            for frame in frames:
                try:
                    r = await c.post(
                        f"http://localhost:{BACKEND_PORT}/api/sam/predict/text",
                        json={"frame_id": frame.id, "text_prompt": body.text_prompt,
                              "box_threshold": body.threshold}
                    )
                    detections = r.json().get("detections", []) if r.status_code < 400 else []
                except Exception as exc:
                    logger.warning("auto-annotate GD frame %d: %s", frame.id, exc)
                    detections = []

                # Filtre les boîtes quasi plein-cadre (aire normalisée > 0.90) :
                # artefact connu de Grounding DINO (~1 % des détections) qui
                # pollue l'export YOLO et le training si on le laisse passer.
                kept = []
                for d in detections:
                    bb = d.get("bbox_yolo", [0, 0, 1, 1])
                    if float(bb[2]) * float(bb[3]) <= 0.90:
                        kept.append(d)
                if len(kept) < len(detections):
                    logger.info("auto-annotate GD frame %d: %d boite(s) plein-cadre filtree(s)",
                                frame.id, len(detections) - len(kept))
                detections = kept

                if not detections:
                    frame.is_empty = True
                    session.add(frame)
                    empty_frames += 1
                    continue

                for det in detections:
                    bbox = det.get("bbox_yolo", [0.5, 0.5, 0.1, 0.1])
                    ann = Annotation(
                        frame_id=frame.id,
                        class_id=label_class.id,
                        annotation_type=AnnotationType.BBOX,
                        cx=float(bbox[0]), cy=float(bbox[1]),
                        width=float(bbox[2]), height=float(bbox[3]),
                        confidence=float(det.get("score", 1.0)),
                        is_auto=True, source_algorithm="grounding_dino",
                    )
                    session.add(ann)
                    total_annotations += 1

                frame.is_annotated = True
                session.add(frame)
                annotated_frames += 1

    project.annotated_count = annotated_frames
    session.add(project)
    session.commit()

    logger.info(
        "Orchestrator: auto-annotate '%s' — %d frames annotées, %d vides, %d annotations",
        body.project_name, annotated_frames, empty_frames, total_annotations,
    )
    return {
        "project_name": body.project_name,
        "frames_processed": len(frames),
        "annotated_frames": annotated_frames,
        "empty_frames": empty_frames,
        "total_annotations": total_annotations,
        "model": body.model,
        "prompt": body.text_prompt,
    }
