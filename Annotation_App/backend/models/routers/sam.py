# ============================================================
# routers/sam.py
# Endpoints REST et WebSocket pour l'inférence SAM2.
#
# REST :
#   POST /api/sam/predict/points  — Segmentation interactive par points
#   POST /api/sam/auto-segment    — Auto-segmentation (tâche Celery)
#   GET  /api/sam/status          — État du service SAM2
#   POST /api/sam/load            — Charger/changer de modèle
#
# WebSocket :
#   ws://.../ws/sam/image  — Streaming des masques auto-segmentation
#   ws://.../ws/sam/video  — Session de propagation vidéo interactive
# ============================================================

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.database import get_session
from backend.models.frame import Frame
from backend.services.sam_service import sam_service

router = APIRouter(tags=["SAM2"])


# ---- Schémas Pydantic ----

class SAMPoint(BaseModel):
    """Point de prompt SAM2 (coordonnées normalisées)."""
    x: float   # [0, 1]
    y: float   # [0, 1]
    label: int  # 1 = foreground, 0 = background


class PredictPointsRequest(BaseModel):
    """Requête de segmentation par points."""
    frame_id: int
    points: List[SAMPoint]
    multimask: bool = True


class AutoSegmentRequest(BaseModel):
    """Requête de segmentation automatique."""
    frame_id: int
    points_per_side: int = 32
    pred_iou_thresh: float = 0.88
    stability_score_thresh: float = 0.95
    min_mask_area: int = 100
    box_nms_thresh: float = 0.7


class LoadModelRequest(BaseModel):
    """Requête de chargement d'un modèle SAM2."""
    model_size: str = "tiny"  # tiny | small | base_plus | large


# ---- Endpoints REST ----

@router.get("/api/sam/status")
async def get_sam_status():
    """
    Retourne l'état du service SAM2 :
    - Modèle chargé ou non
    - Dispositif (CPU/GPU)
    - Mémoire GPU utilisée
    - Sessions vidéo actives
    """
    return sam_service.get_status()


@router.post("/api/sam/load")
async def load_sam_model(request: LoadModelRequest):
    """
    Charge ou recharge le modèle SAM2 avec la taille spécifiée.
    Sur CPU, force automatiquement le modèle 'tiny'.
    """
    result = await sam_service.load_model(model_size=request.model_size)
    return result


@router.post("/api/sam/predict/points")
async def predict_with_points(
    request: PredictPointsRequest,
    session: Session = Depends(get_session),
):
    """
    Segmentation interactive SAM2 par points de prompt.
    Retourne jusqu'à 3 masques candidats triés par score décroissant.

    Format des masques retournés :
    - bbox_yolo: [cx, cy, w, h] normalisé dans [0, 1]
    - polygon: [[x,y], ...] contour simplifié normalisé
    - score: confiance SAM2 [0, 1]
    """
    frame = session.get(Frame, request.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    from backend.services.dataset_service import dataset_service

    image_path = str(dataset_service.get_frame_path(frame.project_id, frame.filename))

    if not sam_service._model_loaded:
        raise HTTPException(
            status_code=503,
            detail="Modèle SAM2 non chargé. Appelez POST /api/sam/load d'abord."
        )

    try:
        masks = await sam_service.predict_with_points(
            image_path=image_path,
            points=[(p.x, p.y) for p in request.points],
            labels=[p.label for p in request.points],
            image_width=frame.width,
            image_height=frame.height,
            multimask=request.multimask,
        )

        return {
            "masks": [
                {
                    "bbox_yolo": list(m.bbox_yolo),
                    "bbox_pixel": list(m.bbox_pixel),
                    "polygon": m.polygon,
                    "score": m.score,
                    "area": m.area,
                }
                for m in masks
            ]
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur SAM2 : {str(e)}")


# ---- Endpoint : Segmentation guidée par texte (Grounding DINO + SAM2) ----

class TextPredictRequest(BaseModel):
    """Requête de segmentation par prompt texte."""
    frame_id: int
    text_prompt: str          # Ex: "voiture. personne. vélo."
    box_threshold: float = 0.35
    text_threshold: float = 0.25
    use_sam: bool = True      # Si True, génère aussi les masques SAM2


@router.post("/api/sam/predict/text")
async def predict_with_text(
    request: TextPredictRequest,
    session: Session = Depends(get_session),
):
    """
    Segmentation guidée par texte : Grounding DINO → boîtes → SAM2 → masques.

    Permet d'annoter en décrivant les objets en langage naturel.
    Exemple de prompts :
      - "voiture. camion."
      - "personne debout. personne assise."
      - "dog. cat. bird."

    Retourne :
      - detections: liste de {bbox_yolo, polygon, label, score}
      - grounding_available: booléen indiquant si Grounding DINO est disponible
    """
    from backend.services.grounding_service import get_grounding_service
    from backend.services.dataset_service import dataset_service

    grounding_svc = get_grounding_service()

    if not grounding_svc.is_available:
        raise HTTPException(
            status_code=503,
            detail=(
                "Grounding DINO non disponible. "
                "Installez transformers>=4.37 et redémarrez."
            ),
        )

    frame = session.get(Frame, request.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    image_path = str(dataset_service.get_frame_path(frame.project_id, frame.filename))

    try:
        if request.use_sam and sam_service._model_loaded:
            # Pipeline complet : Grounding DINO + SAM2
            detections = grounding_svc.detect_and_segment(
                image_path=image_path,
                text_prompt=request.text_prompt,
                sam_service=sam_service,
                box_threshold=request.box_threshold,
                text_threshold=request.text_threshold,
            )
        else:
            # Grounding DINO seul : boîtes sans masques
            detections = grounding_svc.detect_objects(
                image_path=image_path,
                text_prompt=request.text_prompt,
                box_threshold=request.box_threshold,
                text_threshold=request.text_threshold,
                image_width=frame.width,
                image_height=frame.height,
            )
            # Ajouter polygon vide pour cohérence
            for d in detections:
                d.setdefault("polygon", [])

        return {
            "detections": detections,
            "grounding_available": True,
            "sam_used": request.use_sam and sam_service._model_loaded,
            "count": len(detections),
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur Grounding : {str(e)}")


@router.get("/api/sam/grounding/status")
async def get_grounding_status():
    """Retourne le statut du service Grounding DINO."""
    from backend.services.grounding_service import get_grounding_service
    return get_grounding_service().status


# ---- WebSocket : Segmentation automatique d'image ----

@router.websocket("/ws/sam/image")
async def websocket_sam_image(websocket: WebSocket):
    """
    WebSocket pour la segmentation automatique d'images avec streaming des résultats.

    Protocole de messages :
    Client → Serveur :
        { "type": "start_auto_segment", "frame_id": 42,
          "params": { "points_per_side": 32, "pred_iou_thresh": 0.88 } }

    Serveur → Client :
        { "type": "mask_result", "index": 0, "mask": { "bbox_yolo": [...], ... } }
        { "type": "complete", "total_masks": 45 }
        { "type": "error", "message": "..." }
    """
    await websocket.accept()

    try:
        while True:
            # Attente du message client
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            if msg_type == "start_auto_segment":
                frame_id = data.get("frame_id")
                params = data.get("params", {})

                # Récupération des métadonnées de la frame
                from sqlmodel import create_engine
                from backend.database import engine
                with Session(engine) as db_session:
                    frame = db_session.get(Frame, frame_id)
                    if not frame:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"Frame {frame_id} introuvable"
                        }))
                        continue

                    from backend.services.dataset_service import dataset_service
                    image_path = str(dataset_service.get_frame_path(
                        frame.project_id, frame.filename
                    ))
                    img_w, img_h = frame.width, frame.height

                if not sam_service._model_loaded:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Modèle SAM2 non chargé"
                    }))
                    continue

                # Streaming des masques générés
                mask_index = 0
                try:
                    async for mask_result in sam_service.auto_segment_image(
                        image_path=image_path,
                        image_width=img_w,
                        image_height=img_h,
                        points_per_side=params.get("points_per_side", 32),
                        pred_iou_thresh=params.get("pred_iou_thresh", 0.88),
                        stability_score_thresh=params.get("stability_score_thresh", 0.95),
                        min_mask_area=params.get("min_mask_area", 100),
                        box_nms_thresh=params.get("box_nms_thresh", 0.7),
                    ):
                        await websocket.send_text(json.dumps({
                            "type": "mask_result",
                            "index": mask_index,
                            "mask": {
                                "bbox_yolo": list(mask_result.bbox_yolo),
                                "bbox_pixel": list(mask_result.bbox_pixel),
                                "polygon": mask_result.polygon,
                                "score": mask_result.score,
                                "area": mask_result.area,
                            }
                        }))
                        mask_index += 1

                    await websocket.send_text(json.dumps({
                        "type": "complete",
                        "total_masks": mask_index,
                    }))

                except Exception as e:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": str(e)
                    }))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        print("[ws/sam/image] Client déconnecté")
    except Exception as e:
        print(f"[ws/sam/image] Erreur : {e}")
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


# ---- WebSocket : Propagation vidéo SAM2 ----

@router.websocket("/ws/sam/video")
async def websocket_sam_video(websocket: WebSocket):
    """
    WebSocket pour la session de propagation vidéo SAM2.

    Protocole de messages :
    1. Client initialise la session :
       { "type": "init_session", "project_id": 1, "frames_dir": "/chemin/..." }
       → Serveur : { "type": "session_ready", "session_id": "uuid" }

    2. Client ajoute des prompts :
       { "type": "add_prompt", "session_id": "...", "frame_index": 0,
         "object_id": 1, "points": [[0.5, 0.3]], "labels": [1],
         "image_width": 1920, "image_height": 1080 }
       → Serveur : { "type": "prompt_result", "mask": { ... } }

    3. Client lance la propagation :
       { "type": "propagate", "session_id": "...",
         "image_width": 1920, "image_height": 1080 }
       → Serveur : { "type": "propagation_frame", "frame_index": 5, ... } × N
       → Serveur : { "type": "propagation_complete", "total_frames": 150 }
    """
    await websocket.accept()
    current_session_id: Optional[str] = None

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type")

            # ---- Initialisation de session ----
            if msg_type == "init_session":
                project_id = data.get("project_id")
                frames_dir = data.get("frames_dir")
                frame_count = data.get("frame_count", 100)

                if not sam_service._model_loaded or sam_service._video_predictor is None:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Prédicteur vidéo SAM2 non disponible"
                    }))
                    continue

                try:
                    session_id = await sam_service.init_video_session(
                        frames_dir=frames_dir,
                        frame_count=frame_count,
                    )
                    current_session_id = session_id
                    await websocket.send_text(json.dumps({
                        "type": "session_ready",
                        "session_id": session_id,
                    }))
                except Exception as e:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Erreur init session : {e}"
                    }))

            # ---- Ajout d'un prompt pour un objet ----
            elif msg_type == "add_prompt":
                session_id = data.get("session_id", current_session_id)
                if not session_id:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": "Aucune session active"
                    }))
                    continue

                try:
                    mask_result = await sam_service.add_video_prompt(
                        session_id=session_id,
                        frame_index=data["frame_index"],
                        object_id=data["object_id"],
                        points=[(p[0], p[1]) for p in data["points"]],
                        labels=data["labels"],
                        image_width=data["image_width"],
                        image_height=data["image_height"],
                    )
                    await websocket.send_text(json.dumps({
                        "type": "prompt_result",
                        "object_id": data["object_id"],
                        "mask": {
                            "bbox_yolo": list(mask_result.bbox_yolo),
                            "polygon": mask_result.polygon,
                            "score": mask_result.score,
                        }
                    }))
                except Exception as e:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Erreur ajout prompt : {e}"
                    }))

            # ---- Propagation vidéo ----
            elif msg_type == "propagate":
                session_id = data.get("session_id", current_session_id)
                img_w = data.get("image_width", 1920)
                img_h = data.get("image_height", 1080)

                if not session_id:
                    await websocket.send_text(json.dumps({
                        "type": "error", "message": "Aucune session active"
                    }))
                    continue

                frames_processed = 0
                try:
                    async for prop_result in sam_service.propagate_video(
                        session_id=session_id,
                        image_width=img_w,
                        image_height=img_h,
                    ):
                        objects_data = {}
                        for obj_id, mask_res in prop_result.objects.items():
                            objects_data[str(obj_id)] = {
                                "bbox_yolo": list(mask_res.bbox_yolo),
                                "polygon": mask_res.polygon,
                                "score": mask_res.score,
                            }

                        await websocket.send_text(json.dumps({
                            "type": "propagation_frame",
                            "frame_index": prop_result.frame_index,
                            "progress": prop_result.progress,
                            "objects": objects_data,
                        }))
                        frames_processed += 1

                    await websocket.send_text(json.dumps({
                        "type": "propagation_complete",
                        "total_frames": frames_processed,
                    }))

                except Exception as e:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Erreur propagation : {e}"
                    }))

            # ---- Fermeture de session ----
            elif msg_type == "close_session":
                session_id = data.get("session_id", current_session_id)
                if session_id:
                    sam_service.close_video_session(session_id)
                    current_session_id = None
                await websocket.send_text(json.dumps({"type": "session_closed"}))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

    except WebSocketDisconnect:
        print("[ws/sam/video] Client déconnecté")
        # Nettoyage de la session en cas de déconnexion inattendue
        if current_session_id:
            sam_service.close_video_session(current_session_id)
    except Exception as e:
        print(f"[ws/sam/video] Erreur : {e}")
        if current_session_id:
            sam_service.close_video_session(current_session_id)


# ============================================================
# Endpoints SAM3 (Segment Anything Model 3 — texte open-vocabulary)
# ============================================================

class SAM3TextRequest(BaseModel):
    """Requête SAM3 par prompt texte open-vocabulary."""
    frame_id: int
    text_prompt: str  # Ex: "voiture. personne debout. vélo."
    box_threshold: float = 0.20   # Seuil score de confiance (filtre les détections faibles)
    text_threshold: float = 0.15  # Seuil texte (conservé pour cohérence avec GD, non utilisé par SAM3)


@router.get("/api/sam3/status")
async def get_sam3_status():
    """
    Statut du service SAM3 :
    - installed: SAM3 est installé dans l'environnement
    - checkpoint_exists: checkpoint disponible sur le disque
    - loaded: modèle chargé en mémoire GPU/CPU
    """
    from backend.services.sam3_service import get_sam3_service
    return get_sam3_service().get_status()


@router.post("/api/sam3/load")
async def load_sam3():
    """
    Charge le modèle SAM3.1 en mémoire.
    Nécessite le checkpoint dans backend/checkpoints/sam3.1_hiera_large.pt
    (téléchargeable avec python backend/tests/download_sam3.py après accès HF)
    """
    from backend.services.sam3_service import get_sam3_service
    svc = get_sam3_service()
    if not svc.is_available:
        raise HTTPException(status_code=503, detail="SAM3 non installé")
    if not svc.checkpoint_exists:
        raise HTTPException(
            status_code=503,
            detail="Checkpoint SAM3 absent. Lancez : python backend/tests/download_sam3.py"
        )
    ok = svc.load_model()
    if not ok:
        raise HTTPException(status_code=500, detail="Echec chargement SAM3")
    return {"status": "loaded", "model": "sam3.1_hiera_large"}


@router.post("/api/sam3/predict/text")
async def sam3_predict_text(
    request: SAM3TextRequest,
    session: Session = Depends(get_session),
):
    """
    Détection et segmentation par texte open-vocabulary avec SAM3.1.
    Supporte 4M+ concepts sans training supplémentaire.

    Exemples de prompts :
      - "voiture rouge"
      - "personne qui marche. vélo. chien."
      - "basketball player in white jersey"

    Retourne une liste de détections avec bbox_yolo, polygon et score.
    """
    from backend.services.sam3_service import get_sam3_service
    from backend.services.dataset_service import dataset_service

    svc = get_sam3_service()
    if not svc.is_available:
        raise HTTPException(status_code=503, detail="SAM3 non installé")
    if not svc.is_loaded:
        if not svc.checkpoint_exists:
            raise HTTPException(
                status_code=503,
                detail="Checkpoint SAM3 absent. Voir python backend/tests/download_sam3.py"
            )
        svc.load_model()

    frame = session.get(Frame, request.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame introuvable")

    image_path = str(dataset_service.get_frame_path(frame.project_id, frame.filename))

    try:
        detections = await svc.detect_and_segment(
            image_path=image_path,
            text_prompt=request.text_prompt,
            img_width=frame.width,
            img_height=frame.height,
        )
        detections = [d for d in detections if d.get("score", 1.0) >= request.box_threshold]
        return {
            "detections": detections,
            "count": len(detections),
            "model": "sam3.1",
            "prompt": request.text_prompt,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur SAM3 : {str(e)}")
