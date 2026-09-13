"""
trackers/sot/tracking_tophat/tracker.py
----------------------------
SOT par Poursuite par Composantes Connexes (Tracking_TOPHAT) - version adaptative.

Principe (pipeline adaptatif)
-----------------------------
A chaque frame :
  1. CMC / Homographie H  : le dernier centre est warpé sous H (mouvement caméra).
  2. Kalman prediction    : centre prédit cx_pred, cy_pred (+ vitesse cible).
  3. Search ROI adaptative: centrée sur le centre prédit ; sa TAILLE suit la
     taille EMA du blob (objet) + la vitesse Kalman (gating dynamique).
  4. Multi-kernel Top-Hat : plusieurs noyaux morphologiques (petit->grand) pour
     capturer la cible quelle que soit sa taille courante.
  5. Multi-threshold      : plusieurs niveaux de seuillage adaptatif
     (median + k_sigma·MAD) -> robustesse au contraste variable.
  6. Candidats tophat     : blobs bruts via _detect_candidates_multi() (cœur commun MOT/ROI/Tracking_TOPHAT).
  7. Duplicate fusion     : suppression des doublons (IoU / distance centre).
  8. Feature extraction   : par candidat - géométrie, intensité, fond, mouvement.
  9. Feature matching      : score global pondéré vs profil de la cible (EMA).
 10. Best blob selection   : meilleur score ≥ seuil ET distance ≤ max_dist_px.
 11. Si VALIDE :
       - Kalman update(cx_blob, cy_blob)  + reset compteur de miss
       - EMA bbox width/height  -> BBOX adaptative (rétrécit ET grandit !)
       - EMA blob diameter      -> search ROI de la frame suivante
       - mise à jour du profil de features + (option) template d'apparence
       - sortie bbox = centre blob ± (EMA_w, EMA_h)
     Sinon : miss++ -> la state machine repasse en MOT/IDLE après N misses.

Pourquoi cette refonte ?
------------------------
L'ancienne version reconstruisait la bbox avec `max(blob, last_size)` : la bbox
ne pouvait QUE grandir, jamais rétrécir. Une cible passant de 100×100 à 10×10 px
gardait une bbox de 100×100 (totalement inadaptée). La nouvelle bbox suit la
taille réelle du blob mesuré via une EMA -> suit l'agrandissement ET la
réduction de la cible. Le matching n'est plus un simple matchTemplate (fragile
au changement d'échelle) mais une combinaison de features en grande partie
invariantes ou tolérantes à l'échelle (SNR, ratio, intensité, mouvement),
l'apparence (NCC/cosinus ResNet) ne pesant que `w_appearance` dans le score.

Coût temps réel
---------------
Toutes les opérations sont O(pixels ROI). Avec une ROI bornée (max_search_radius_px)
et quelques (kernel × seuil) passes sur une petite zone, le coût est de l'ordre
de 2–5 ms/frame CPU -> temps réel garanti tant que la cible n'est pas immense
(c.-à-d. tant que la ROI reste bornée). max_search_radius_px protège le pire cas.

Hyperparametres (section tracking_tophat: du YAML)
-----------------------------------------
### PARAMÈTRES PRINCIPAUX (à régler en premier - pilotent tout le reste) ###
use_resnet             : false (défaut) = apparence NCC CPU | true = cosinus ResNet18 GPU.
                         La détection est TOUJOURS multi-kernel Top-Hat (white + black).
                         N'a d'effet que si w_appearance > 0.
white_tophat_kernels   : LISTE de noyaux white top-hat (cible chaude sur fond froid),
                         ex [3,5,7]. 1 passe par noyau.
black_tophat_kernels   : LISTE de noyaux black top-hat (cible froide sur fond chaud),
                         ex [5,7]. [] = desactive.
k_sigma_levels         : LISTE unique de seuils adaptatifs, ex [2.5] ou [1.5,2.5,3.5].
                         (kernels_total x seuils) = nb total de passes.
w_appearance           : poids apparence (NCC/cosinus). **0 = OFF** (pas de calcul template, +rapide)
adaptive_size          : true -> ROI ET bbox suivent la taille de la cible (EMA)
feature_match_threshold: score global minimum pour accepter un blob (0-1) - sensibilité globale
max_dist_px            : distance max blob↔centre prédit (px) - gate dur de cohérence

### Détection / ROI ###
search_radius_px       : demi-taille MIN de la ROI (px) - plancher
max_search_radius_px   : demi-taille MAX de la ROI (px) - borne temps réel
threshold_rel          : seuil top-hat fixe (si use_adaptive_thresh=false)
use_adaptive_thresh    : seuillage adaptatif median + k_sigma·MAD (recommandé)
min_thresh_abs         : seuil absolu minimum 0-255 (adaptatif)
min_area_px2/max_area_px2 : filtre d'aire des blobs (px²)
### Fusion doublons ###
dedup_iou_thresh / dedup_dist_px / max_candidates : fusion + borne perf
### Feature matching (poids du score global, normalisés en interne) ###
w_geometry / w_intensity / w_background / w_motion : poids des familles de features
feature_ema_alpha      : lissage EMA du profil de features (0.1 stable -> 1 réactif)
bg_ring_margin_px      : marge de l'anneau de fond autour du blob (px)
### Taille adaptative ###
size_ema_alpha         : lissage EMA des tailles (bbox + diamètre blob)
roi_size_factor        : ROI ≈ roi_size_factor × diamètre EMA
vel_radius_factor      : marge ROI = vel_radius_factor × vitesse Kalman
### Apparence (template) - actif seulement si w_appearance > 0 ###
template_patch_size / template_history / template_update_thresh / template_update_interval
    template_history : buffer circulaire de N patches (NCC) ou vecteurs (ResNet) - uniquement
                       pour w_appearance. Les autres features utilisent le profil EMA feat_profile.
fallback_bbox_size_px  : carré fallback si aucune track MOT ni mémoire Tracking_TOPHAT
### Kalman / ResNet ###
kf_process_noise / kf_measure_noise : bruits Kalman (héritent de sot_kalman:)
resnet_device / resnet_layer : mode=resnet uniquement
"""

from __future__ import annotations

import logging
import math
import os
from typing import Any

import cv2
import numpy as np

from pipeline.detector.detector_mot import _detect_candidates_multi
from trackers.mot.custom_kalman.kalman_filter import KalmanFilter2D

log = logging.getLogger(__name__)


#################################
# Helpers
#################################


def _to_uint8_gray(frame: np.ndarray) -> np.ndarray:
    """Normalise une frame en uint8 niveaux de gris."""
    if frame.ndim == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.shape[2] == 3 else frame[:, :, 0]
    else:
        gray = frame
    if gray.dtype != np.uint8:
        img = gray.astype(np.float32)
        lo, hi = img.min(), img.max()
        if hi > lo:
            img = (img - lo) / (hi - lo) * 255.0
        else:
            img = np.zeros_like(img)
        gray = img.clip(0, 255).astype(np.uint8)
    return gray


def _warp_center(H: np.ndarray, cx: float, cy: float) -> tuple[float, float]:
    """
    Applique l'homographie H au point (cx, cy).
    Retourne (cx_warped, cy_warped).
    """
    denom = H[2, 0] * cx + H[2, 1] * cy + H[2, 2]
    if abs(denom) < 1e-8:
        return cx, cy
    cx_w = (H[0, 0] * cx + H[0, 1] * cy + H[0, 2]) / denom
    cy_w = (H[1, 0] * cx + H[1, 1] * cy + H[1, 2]) / denom
    return cx_w, cy_w


def _extract_patch(
    gray: np.ndarray,
    cx: float,
    cy: float,
    patch_size: int,
) -> np.ndarray | None:
    """
    Extrait un patch carre de taille patch_size x patch_size centre sur (cx, cy).
    Retourne None si le patch sort de l'image.
    """
    h, w = gray.shape[:2]
    half = patch_size // 2
    x1 = int(round(cx)) - half
    y1 = int(round(cy)) - half
    x2 = x1 + patch_size
    y2 = y1 + patch_size
    if x1 < 0 or y1 < 0 or x2 > w or y2 > h:
        # Essayer de clipper
        x1c = max(0, x1)
        y1c = max(0, y1)
        x2c = min(w, x2)
        y2c = min(h, y2)
        patch = gray[y1c:y2c, x1c:x2c]
        if patch.shape[0] < patch_size // 2 or patch.shape[1] < patch_size // 2:
            return None
        # Remettre a la bonne taille avec bordure nulle
        out = np.zeros((patch_size, patch_size), dtype=np.uint8)
        dy = y1c - y1
        dx = x1c - x1
        out[dy : dy + patch.shape[0], dx : dx + patch.shape[1]] = patch
        return out
    return gray[y1:y2, x1:x2].copy()


def _ncc_score(patch: np.ndarray, template: np.ndarray) -> float:
    """
    Retourne le score NCC (Normalized Cross-Correlation) entre patch et template.
    Les deux doivent avoir la meme taille.
    Retourne 0.0 en cas d'erreur.
    """
    try:
        t = cv2.resize(template, (patch.shape[1], patch.shape[0]))
        result = cv2.matchTemplate(patch, t, cv2.TM_CCORR_NORMED)
        return float(result.max())
    except Exception:
        return 0.0


def _iou(a, b) -> float:
    """IoU entre deux bbox [x1,y1,x2,y2]."""
    ax1, ay1, ax2, ay2 = a[0], a[1], a[2], a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[2], b[3]
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _rel_sim(value: float, ref: float, scale: float = 0.5) -> float:
    """
    Similarité gaussienne sur l'écart RELATIF entre value et ref.
    1.0 = identique, -> 0 quand l'écart relatif croît.
    scale contrôle la tolérance (0.5 = écart de 50% -> score ~0.37).
    """
    denom = abs(ref) * scale + 1e-3
    d = (value - ref) / denom
    return math.exp(-d * d)


#################################
# ResNet feature extractor (lazy init, mode=resnet)
#################################


class _ResNetExtractor:
    """
    Extrait des features via ResNet18 pretraine.
    Initialisation lazy pour ne pas charger PyTorch si mode=tophat.
    """

    def __init__(self, layer: str = "layer3", device: str = "cpu"):
        self._layer = layer
        self._device = device
        self._model = None
        self._hook_out: np.ndarray | None = None
        self._transform = None

    def _init(self) -> bool:
        try:
            import torchvision.models as models
            import torchvision.transforms as T

            model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
            model.eval()
            model = model.to(self._device)

            target_layer = dict(model.named_children()).get(self._layer)
            if target_layer is None:
                log.error("_ResNetExtractor: couche '%s' introuvable dans ResNet18", self._layer)
                return False

            def _hook(module, input, output):
                self._hook_out = output.detach().cpu().numpy()

            target_layer.register_forward_hook(_hook)

            self._model = model
            self._transform = T.Compose(
                [
                    T.ToPILImage(),
                    T.Resize((64, 64)),
                    T.ToTensor(),
                    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ]
            )
            log.info(
                "_ResNetExtractor: ResNet18 charge (layer=%s, device=%s)",
                self._layer,
                self._device,
            )
            return True
        except Exception as exc:
            log.error("_ResNetExtractor._init: %s", exc)
            return False

    def extract(self, patch_gray: np.ndarray) -> np.ndarray | None:
        """Extrait un vecteur de features 1D normalise (L2), ou None si erreur."""
        if self._model is None:
            if not self._init():
                return None
        try:
            import torch

            rgb = cv2.cvtColor(patch_gray, cv2.COLOR_GRAY2RGB)
            tensor = self._transform(rgb).unsqueeze(0).to(self._device)
            self._hook_out = None
            with torch.no_grad():
                self._model(tensor)
            if self._hook_out is None:
                return None
            feat = self._hook_out.flatten()
            norm = np.linalg.norm(feat)
            if norm < 1e-8:
                return None
            return feat / norm
        except Exception as exc:
            log.debug("_ResNetExtractor.extract: %s", exc)
            return None


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Similarite cosinus entre deux vecteurs 1D normalises."""
    try:
        return float(np.dot(a, b))
    except Exception:
        return 0.0


def _numbered_name(name: str, n: int) -> str:
    """Insere un compteur numerote dans un nom de fichier avant l'extension."""
    base, ext = os.path.splitext(name)
    return f"{base}_c{n:03d}{ext}"


#################################
# TrackingTophatSot
#################################


class TrackingTophatSot:
    """
    Tracker SOT par Poursuite par Composantes Connexes - adaptatif.

    Détection-par-segmentation (multi-kernel / multi-seuil Top-Hat) + association
    par features (géométrie / intensité / fond / mouvement / apparence) avec une
    ROI et une bbox dont la TAILLE s'adapte dynamiquement (EMA) à celle de la cible.
    """

    def __init__(self):
        self._initialized: bool = False
        self._last_cx: float | None = None
        self._last_cy: float | None = None
        self._last_w: float = 40.0
        self._last_h: float = 40.0

        # EMA des dimensions de la bbox affichée (rétrécit ET grandit avec la cible)
        self._ema_w: float | None = None
        self._ema_h: float | None = None

        # Mémoire persistante inter-reset : taille du dernier suivi réussi.
        # Survit à reset() - utilisée dans init() comme fallback bbox.
        self._prev_last_w: float = 0.0
        self._prev_last_h: float = 0.0

        # Historique templates/features d'apparence
        self._template_history: list[Any] = []
        self._update_frame_count: int = 0

        # Profil de features de la cible (EMA) - rempli à l'init et maj chaque frame OK
        self._feat_profile: dict[str, float] | None = None

        # Kalman CMC
        self._kf = None
        self._kf_process_noise: float = 10.0
        self._kf_measure_noise: float = 5.0

        # --- Hyperparams détection / ROI (écrasés par configure) ---
        self._use_resnet: bool = False
        self._search_radius_px = 40
        self._max_search_radius_px = 200
        # white_tophat_kernels : noyaux white tophat (cibles chaudes sur fond froid)
        # black_tophat_kernels : noyaux black tophat (cibles froides sur fond chaud)
        self._white_kernels: list[int] = [3, 5, 7]
        self._black_kernels: list[int] = []
        self._threshold_rel = 0.3
        self._use_adaptive = True
        # k_sigma_levels : LISTE unique de seuils adaptatifs (l'ancien k_sigma
        # scalaire est juste un élément de cette liste). (kernels × seuils) passes.
        self._k_sigma_levels: list[float] = [2.5]
        self._min_thresh_abs = 5
        self._min_area_px2 = 8
        self._max_area_px2 = 5000
        self._max_dist_px = 40.0

        # --- Fusion doublons ---
        self._dedup_iou_thresh = 0.3
        self._dedup_dist_px = 5.0
        self._max_candidates = 30

        # --- Feature matching ---
        self._w_geometry = 0.20
        self._w_intensity = 0.20
        self._w_background = 0.15
        self._w_motion = 0.30
        self._w_appearance = 0.15
        self._feature_match_thr = 0.45
        self._feature_ema_alpha = 0.3
        self._bg_ring_margin_px = 6

        # --- Apparence (template) ---
        self._template_patch_size = 48
        self._template_history_max = 5
        self._template_update_thresh = 0.5
        self._template_update_interval = 3
        self._fallback_bbox_size_px = 40
        self._resnet_device = "cpu"
        self._resnet_layer = "layer3"

        # --- Taille adaptative ---
        self._adaptive_size: bool = True
        self._size_ema_alpha: float = 0.2
        self._roi_size_factor: float = 2.0
        self._vel_radius_factor: float = 2.0
        self._ema_blob_size: float | None = None

        # Rayon et patch effectifs
        self._effective_search_radius: int = 40
        self._effective_template_patch: int = 48

        # ResNet extractor (lazy)
        self._extractor: _ResNetExtractor | None = None

        # Click max dist (param unifie top-level)
        self._near_thresh_px: float = float("inf")

        # Debug videos Tracking_TOPHAT SOT (un fichier par clic)
        self._tracking_tophat_video_writer = None
        self._tracking_tophat_binary_writer = None
        self._tracking_tophat_blob_writer = None
        self._tracking_tophat_blob_video_enabled: bool = False
        self._tracking_tophat_blob_video_fps: float = 25.0
        self._tracking_tophat_blob_video_name_tpl: str = "tracking_tophat_blobs_sot_debug.mp4"
        self._frame_idx: int = 0
        self._click_count: int = 0
        self._debug_dir: str = "outputs/debug_tracking"
        self._tracking_tophat_video_enabled: bool = False
        self._tracking_tophat_video_fps: float = 25.0
        self._tracking_tophat_video_name_tpl: str = "tracking_tophat_sot_debug.mp4"
        self._tracking_tophat_binary_enabled: bool = False
        self._tracking_tophat_binary_fps: float = 25.0
        self._tracking_tophat_binary_name_tpl: str = "tracking_tophat_seuillage_sot_debug.mp4"

    ######################################
    # Configuration
    ######################################

    def configure(self, cfg: dict) -> None:
        """Charge les hyperparametres depuis cfg["tracking_tophat"] + top-level."""
        tracking_tophat = cfg.get("tracking_tophat", {})
        sot_kf = cfg.get("sot_kalman", {})

        self._use_resnet = bool(tracking_tophat.get("use_resnet", False))
        self._search_radius_px = int(tracking_tophat.get("search_radius_px", 40))
        self._max_search_radius_px = int(tracking_tophat.get("max_search_radius_px", 200))
        self._threshold_rel = float(tracking_tophat.get("threshold_rel", 0.3))
        self._use_adaptive = bool(tracking_tophat.get("use_adaptive_thresh", True))
        self._min_thresh_abs = int(tracking_tophat.get("min_thresh_abs", 5))
        self._min_area_px2 = int(tracking_tophat.get("min_area_px2", 8))
        self._max_area_px2 = int(tracking_tophat.get("max_area_px2", 5000))
        self._max_dist_px = float(tracking_tophat.get("max_dist_px", 40.0))

        # white_tophat_kernels : cibles chaudes (blanc = pic local lumineux).
        # Fallback sur l'ancien parametre tophat_kernels si absent.
        wk = tracking_tophat.get("white_tophat_kernels") or tracking_tophat.get("tophat_kernels") or [3, 5, 7]
        self._white_kernels = sorted({max(3, int(k) | 1) for k in wk})
        # black_tophat_kernels : cibles froides (pic local sombre). Vide = desactive.
        bk = tracking_tophat.get("black_tophat_kernels") or []
        self._black_kernels = sorted({max(3, int(k) | 1) for k in bk})

        # k_sigma_levels : LISTE unique de seuils (paramètre homogène ; l'ancien
        # k_sigma scalaire est supprimé - mettre sa valeur dans la liste).
        ksl = tracking_tophat.get("k_sigma_levels", []) or [2.5]
        self._k_sigma_levels = [float(s) for s in ksl]

        # Fusion doublons
        self._dedup_iou_thresh = float(tracking_tophat.get("dedup_iou_thresh", 0.3))
        self._dedup_dist_px = float(tracking_tophat.get("dedup_dist_px", 5.0))
        self._max_candidates = int(tracking_tophat.get("max_candidates", 30))

        # Feature matching
        self._w_geometry = float(tracking_tophat.get("w_geometry", 0.20))
        self._w_intensity = float(tracking_tophat.get("w_intensity", 0.20))
        self._w_background = float(tracking_tophat.get("w_background", 0.15))
        self._w_motion = float(tracking_tophat.get("w_motion", 0.30))
        self._w_appearance = float(tracking_tophat.get("w_appearance", 0.15))
        self._feature_match_thr = float(tracking_tophat.get("feature_match_threshold", 0.45))
        self._feature_ema_alpha = float(tracking_tophat.get("feature_ema_alpha", 0.3))
        self._bg_ring_margin_px = int(tracking_tophat.get("bg_ring_margin_px", 6))

        # Apparence (template)
        self._template_patch_size = int(tracking_tophat.get("template_patch_size", 48))
        self._template_history_max = int(tracking_tophat.get("template_history", 5))
        self._template_update_thresh = float(tracking_tophat.get("template_update_thresh", 0.5))
        self._template_update_interval = int(tracking_tophat.get("template_update_interval", 3))
        self._fallback_bbox_size_px = int(tracking_tophat.get("fallback_bbox_size_px", 40))
        self._resnet_device = str(tracking_tophat.get("resnet_device", cfg.get("device", "cpu")))
        self._resnet_layer = str(tracking_tophat.get("resnet_layer", "layer3"))

        # Kalman (sot_kalman: source principale, tracking_tophat: override)
        self._kf_process_noise = float(
            tracking_tophat.get("kf_process_noise", sot_kf.get("kf_process_noise", 10.0))
        )
        self._kf_measure_noise = float(
            tracking_tophat.get("kf_measure_noise", sot_kf.get("kf_measure_noise", 5.0))
        )

        # Taille adaptative
        self._adaptive_size = bool(tracking_tophat.get("adaptive_size", True))
        self._size_ema_alpha = float(tracking_tophat.get("size_ema_alpha", 0.2))
        self._roi_size_factor = float(tracking_tophat.get("roi_size_factor", 2.0))
        self._vel_radius_factor = float(tracking_tophat.get("vel_radius_factor", 2.0))

        self._effective_search_radius = self._search_radius_px
        self._effective_template_patch = self._template_patch_size

        sot_dist = float(cfg.get("sot_click_max_dist_px", 0.0))
        self._near_thresh_px = float("inf") if sot_dist <= 0 else sot_dist

        # Debug videos
        from utils.visu_algo_debug import AlgoDebugConfig

        self._debug_dir = str(cfg.get("_debug_dir", "outputs/debug_tracking"))
        dbg_cfg = AlgoDebugConfig(cfg, self._debug_dir)
        self._tracking_tophat_video_enabled = dbg_cfg.tracking_tophat_sot_video
        self._tracking_tophat_video_fps = dbg_cfg.tracking_tophat_video_fps
        self._tracking_tophat_video_name_tpl = dbg_cfg.tracking_tophat_video_name
        self._tracking_tophat_binary_enabled = dbg_cfg.tracking_tophat_binary_video
        self._tracking_tophat_binary_fps = dbg_cfg.tracking_tophat_binary_video_fps
        self._tracking_tophat_binary_name_tpl = dbg_cfg.tracking_tophat_binary_video_name
        self._tracking_tophat_blob_video_enabled = dbg_cfg.tracking_tophat_blob_video
        self._tracking_tophat_blob_video_fps = dbg_cfg.tracking_tophat_blob_video_fps
        self._tracking_tophat_blob_video_name_tpl = dbg_cfg.tracking_tophat_blob_video_name

        log.debug(
            "TrackingTophatSot.configure: use_resnet=%s  search=[%d..%d]px"
            "  white_kernels=%s  black_kernels=%s  k_sigma_levels=%s"
            "  adaptive=%s  feat_thr=%.2f  weights(g/i/b/m/a)=%.2f/%.2f/%.2f/%.2f/%.2f"
            "  max_dist=%.0fpx",
            self._use_resnet,
            self._search_radius_px,
            self._max_search_radius_px,
            self._white_kernels,
            self._black_kernels,
            self._k_sigma_levels,
            self._adaptive_size,
            self._feature_match_thr,
            self._w_geometry,
            self._w_intensity,
            self._w_background,
            self._w_motion,
            self._w_appearance,
            self._max_dist_px,
        )

    ######################################
    # SOT interface
    ######################################

    def init(self, frame: np.ndarray, click_pos: tuple, mot_tracks=None) -> None:
        """
        Initialise Tracking_TOPHAT sur la meilleure bbox disponible au clic.

        Priorite bbox d'init :
          1. Track MOT dont la bbox contient le clic
          2. Track MOT la plus proche (dans near_thresh_px)
          3. Taille Tracking_TOPHAT mémorisée (_prev_last_w/h > 0) - après une perte
          4. Carré fallback_bbox_size_px centré sur le clic
        """
        cx, cy = float(click_pos[0]), float(click_pos[1])
        bbox, source = self._find_bbox(cx, cy, mot_tracks)

        if bbox is None:
            h_f, w_f = frame.shape[:2]
            if self._prev_last_w > 0 and self._prev_last_h > 0:
                fb_w = int(self._prev_last_w)
                fb_h = int(self._prev_last_h)
                source = f"fallback taille_tracking_tophat_prev {fb_w}x{fb_h}"
            else:
                fb_w = self._fallback_bbox_size_px
                fb_h = self._fallback_bbox_size_px
                source = f"fallback config {fb_w}x{fb_h}"
            x1 = max(0, int(cx) - fb_w // 2)
            y1 = max(0, int(cy) - fb_h // 2)
            x2 = min(w_f, x1 + fb_w)
            y2 = min(h_f, y1 + fb_h)
            bbox = [x1, y1, x2, y2]

        x1, y1, x2, y2 = [int(v) for v in bbox]
        w = max(1, x2 - x1)
        h = max(1, y2 - y1)

        self._last_cx = (x1 + x2) / 2.0
        self._last_cy = (y1 + y2) / 2.0
        self._last_w = float(w)
        self._last_h = float(h)
        self._ema_w = float(w)
        self._ema_h = float(h)
        self._update_frame_count = 0
        self._template_history = []
        self._ema_blob_size = float(max(w, h))
        self._effective_search_radius = self._search_radius_px
        self._effective_template_patch = self._template_patch_size

        # Kalman CMC
        self._kf = KalmanFilter2D(
            process_noise=self._kf_process_noise,
            measure_noise=self._kf_measure_noise,
        )
        self._kf.init(self._last_cx, self._last_cy)

        # Template d'apparence initial + profil de features initial
        gray = _to_uint8_gray(frame)
        self._add_template(gray, self._last_cx, self._last_cy)
        feat0 = self._extract_features(gray, [x1, y1, x2, y2])
        self._feat_profile = dict(feat0) if feat0 is not None else None

        # ResNet extractor si use_resnet
        if self._use_resnet and self._extractor is None:
            self._extractor = _ResNetExtractor(
                layer=self._resnet_layer,
                device=self._resnet_device,
            )

        # Writers de debug : un MP4 par clic
        self._click_count += 1
        self._frame_idx = 0
        if self._tracking_tophat_video_enabled:
            from utils.visu_algo_debug import TrackingTophatSotVideoWriter

            if self._tracking_tophat_video_writer is not None:
                self._tracking_tophat_video_writer.close()
            self._tracking_tophat_video_writer = TrackingTophatSotVideoWriter(
                debug_dir=self._debug_dir,
                fps=self._tracking_tophat_video_fps,
                video_name=_numbered_name(self._tracking_tophat_video_name_tpl, self._click_count),
            )
        if self._tracking_tophat_binary_enabled:
            from utils.visu_algo_debug import TrackingTophatBinaryVideoWriter

            if self._tracking_tophat_binary_writer is not None:
                self._tracking_tophat_binary_writer.close()
            self._tracking_tophat_binary_writer = TrackingTophatBinaryVideoWriter(
                debug_dir=self._debug_dir,
                fps=self._tracking_tophat_binary_fps,
                video_name=_numbered_name(self._tracking_tophat_binary_name_tpl, self._click_count),
            )
        if self._tracking_tophat_blob_video_enabled:
            from utils.visu_algo_debug import TrackingTophatBlobVideoWriter

            if self._tracking_tophat_blob_writer is not None:
                self._tracking_tophat_blob_writer.close()
            self._tracking_tophat_blob_writer = TrackingTophatBlobVideoWriter(
                debug_dir=self._debug_dir,
                fps=self._tracking_tophat_blob_video_fps,
                video_name=_numbered_name(self._tracking_tophat_blob_video_name_tpl, self._click_count),
            )

        self._initialized = True

        log.info(
            "TrackingTophatSot.init: click=(%.0f,%.0f)  source=%s  bbox=[%d,%d,%d,%d] (%dx%d)"
            "  use_resnet=%s  white_k=%s  black_k=%s  levels=%s",
            cx,
            cy,
            source,
            x1,
            y1,
            x2,
            y2,
            w,
            h,
            self._use_resnet,
            self._white_kernels,
            self._black_kernels,
            self._k_sigma_levels,
        )

    def update(
        self,
        frame: np.ndarray,
        mot_tracks=None,
        H: np.ndarray | None = None,
    ) -> tuple[bool, list | None, np.ndarray | None]:
        """
        Propage le suivi d'une frame (pipeline adaptatif). Retourne (ok, bbox, mask).
        """
        if not self._initialized:
            log.debug("TrackingTophatSot.update: non initialise -> skip")
            return False, None, None

        gray = _to_uint8_gray(frame)
        h_f, w_f = gray.shape[:2]

        ##### 1. CMC + prediction Kalman ####
        cx_pred = self._last_cx
        cy_pred = self._last_cy
        if H is not None:
            cx_pred, cy_pred = _warp_center(H, self._last_cx, self._last_cy)
        kf_vel = 0.0
        if self._kf is not None:
            if H is not None:
                self._kf.camera_update(H)
            kf_state = self._kf.predict()
            cx_pred = float(kf_state[0])
            cy_pred = float(kf_state[1])
            if len(kf_state) >= 4:
                kf_vel = math.hypot(float(kf_state[2]), float(kf_state[3]))

        # Clamp du centre prédit dans l'image : évite une ROI vide (fast-fail
        # silencieux) si le Kalman dérive. La perte réelle reste gérée par le
        # compteur de miss (la state machine repasse en MOT/IDLE après N misses).
        cx_pred = float(min(max(cx_pred, 0.0), w_f - 1.0))
        cy_pred = float(min(max(cy_pred, 0.0), h_f - 1.0))

        ##### 2. ROI adaptative (taille = EMA blob + vitesse Kalman) ####
        sr = self._compute_search_radius(kf_vel)
        self._effective_search_radius = sr
        sx1 = max(0, int(cx_pred) - sr)
        sy1 = max(0, int(cy_pred) - sr)
        sx2 = min(w_f, int(cx_pred) + sr)
        sy2 = min(h_f, int(cy_pred) + sr)
        if sx2 <= sx1 or sy2 <= sy1:
            log.debug("TrackingTophatSot.update: zone recherche vide -> echec")
            return self._fail_frame(frame, cx_pred, cy_pred, sr)

        search_roi = gray[sy1:sy2, sx1:sx2]

        ##### 3-7. Multi-kernel + multi-threshold + dedup ####
        _want_bin = self._tracking_tophat_binary_writer is not None
        candidates, binary_white, binary_black = self._detect_candidates(
            search_roi, sx1, sy1, want_binary=_want_bin
        )
        if _want_bin and binary_white is not None:
            self._tracking_tophat_binary_writer.write(
                binary_white, sx1, sy1, h_f, w_f,
                binary_black_roi=binary_black,
            )

        n_white = sum(1 for b in candidates if b[5] < 0.5)
        n_black = len(candidates) - n_white
        log.debug(
            "TrackingTophatSot.update: pred=(%.0f,%.0f) sr=%d search=[%d,%d,%d,%d]"
            " candidates=%d (white=%d black=%d)",
            cx_pred,
            cy_pred,
            sr,
            sx1,
            sy1,
            sx2,
            sy2,
            len(candidates),
            n_white,
            n_black,
        )

        if not candidates:
            if self._tracking_tophat_blob_writer is not None:
                self._tracking_tophat_blob_writer.write(
                    frame, cx_pred, cy_pred, sr, [], None, 0.0, self._frame_idx
                )
            return self._fail_frame(frame, cx_pred, cy_pred, sr)

        ##### 8-10. Feature extraction + matching + selection ####
        best_blob = None
        best_score = -1.0
        best_feat = None
        best_comp: tuple[float, float, float, float, float] = (0.0, 0.0, 0.0, 0.0, 0.0)
        for blob in candidates:
            bcx = (blob[0] + blob[2]) / 2.0
            bcy = (blob[1] + blob[3]) / 2.0
            dist = math.hypot(bcx - cx_pred, bcy - cy_pred)
            if dist > self._max_dist_px:
                continue
            feat = self._extract_features(gray, blob)
            if feat is None:
                continue
            score, s_geom, s_int, s_bg, s_mot, s_app = self._score_candidate(
                gray, blob, feat, dist
            )
            if score > best_score:
                best_score = score
                best_blob = blob
                best_feat = feat
                best_comp = (s_geom, s_int, s_bg, s_mot, s_app)

        # Blob video : tous les candidats + blob retenu (ou None si echec)
        if self._tracking_tophat_blob_writer is not None:
            _matched = best_blob is not None and best_score >= self._feature_match_thr
            self._tracking_tophat_blob_writer.write(
                frame, cx_pred, cy_pred, sr,
                candidates, best_blob if _matched else None, best_score, self._frame_idx,
            )

        if best_blob is None or best_score < self._feature_match_thr:
            if best_blob is not None:
                log.debug(
                    "TrackingTophatSot.update: echec score=%.3f < seuil=%.2f"
                    "  geom=%.3f int=%.3f bg=%.3f mot=%.3f app=%.3f",
                    best_score, self._feature_match_thr, *best_comp,
                )
            else:
                log.debug(
                    "TrackingTophatSot.update: echec aucun blob retenu (dist/aire)  score=%.3f < seuil=%.2f",
                    best_score, self._feature_match_thr,
                )
            return self._fail_frame(frame, cx_pred, cy_pred, sr, score=best_score)

        log.debug(
            "TrackingTophatSot.update: blob retenu score=%.3f  geom=%.3f int=%.3f bg=%.3f mot=%.3f app=%.3f",
            best_score, *best_comp,
        )

        ##### 11. VALIDE : maj position / tailles / profil / template ####
        bx1, by1, bx2, by2 = [int(v) for v in best_blob[:4]]
        bcx = (bx1 + bx2) / 2.0
        bcy = (by1 + by2) / 2.0
        blob_w = max(1, bx2 - bx1)
        blob_h = max(1, by2 - by1)

        # Kalman update (mesure = centre blob)
        if self._kf is not None:
            self._kf.update(bcx, bcy)

        # EMA des tailles de bbox (rétrécit ET grandit avec la cible)
        a = self._size_ema_alpha
        self._ema_w = blob_w if self._ema_w is None else a * blob_w + (1 - a) * self._ema_w
        self._ema_h = blob_h if self._ema_h is None else a * blob_h + (1 - a) * self._ema_h
        out_w = max(2, int(round(self._ema_w)))
        out_h = max(2, int(round(self._ema_h)))

        # Bbox adaptative centrée sur le blob, clippée
        rx1 = max(0, int(bcx - out_w / 2))
        ry1 = max(0, int(bcy - out_h / 2))
        rx2 = min(w_f, rx1 + out_w)
        ry2 = min(h_f, ry1 + out_h)
        bbox = [rx1, ry1, rx2, ry2]

        self._last_cx = bcx
        self._last_cy = bcy
        self._last_w = float(rx2 - rx1)
        self._last_h = float(ry2 - ry1)
        self._update_frame_count += 1

        # EMA du diamètre blob (pour la ROI de la frame suivante)
        blob_diam = float(max(blob_w, blob_h))
        if self._ema_blob_size is None:
            self._ema_blob_size = blob_diam
        else:
            self._ema_blob_size = a * blob_diam + (1 - a) * self._ema_blob_size

        # Profil de features (EMA)
        if best_feat is not None:
            self._update_profile(best_feat)

        # Patch d'apparence effectif (suit la taille si adaptive)
        if self._adaptive_size:
            self._effective_template_patch = max(32, int(self._ema_blob_size * 3))

        # Mise à jour template d'apparence (si activée et score d'apparence bon)
        if self._w_appearance > 0:
            app = self._score_blob(gray, bcx, bcy)
            if (
                app >= self._template_update_thresh
                and self._update_frame_count % self._template_update_interval == 0
            ):
                self._add_template(gray, bcx, bcy)

        blob_src = "black" if best_blob[5] >= 0.5 else "white"
        log.debug(
            "TrackingTophatSot.update: OK bbox=[%d,%d,%d,%d] (%dx%d) score=%.3f"
            " src=%s ema=(%.1f,%.1f)",
            rx1,
            ry1,
            rx2,
            ry2,
            out_w,
            out_h,
            best_score,
            blob_src,
            self._ema_w,
            self._ema_h,
        )

        if self._tracking_tophat_video_writer is not None:
            self._tracking_tophat_video_writer.write(
                frame=frame,
                cx_pred=cx_pred,
                cy_pred=cy_pred,
                search_radius=sr,
                bbox=bbox,
                score=best_score,
                n_templates=len(self._template_history),
                frame_idx=self._frame_idx,
            )
        self._frame_idx += 1
        return True, bbox, None

    def get_last_size(self) -> tuple[float, float]:
        """(w, h) du dernier suivi réussi (persiste après reset, fallback init)."""
        return self._prev_last_w, self._prev_last_h

    def reset(self) -> None:
        if self._last_w > 0:
            self._prev_last_w = self._last_w
            self._prev_last_h = self._last_h

        self._initialized = False
        self._last_cx = None
        self._last_cy = None
        self._last_w = 40.0
        self._last_h = 40.0
        self._ema_w = None
        self._ema_h = None
        self._template_history = []
        self._feat_profile = None
        self._update_frame_count = 0
        self._kf = None
        self._frame_idx = 0
        self._ema_blob_size = None
        self._effective_search_radius = self._search_radius_px
        self._effective_template_patch = self._template_patch_size
        if self._tracking_tophat_video_writer is not None:
            self._tracking_tophat_video_writer.close()
            self._tracking_tophat_video_writer = None
        if self._tracking_tophat_binary_writer is not None:
            self._tracking_tophat_binary_writer.close()
            self._tracking_tophat_binary_writer = None
        if self._tracking_tophat_blob_writer is not None:
            self._tracking_tophat_blob_writer.close()
            self._tracking_tophat_blob_writer = None
        log.debug("TrackingTophatSot.reset")

    ######################################
    # Pipeline : détection multi-kernel / multi-seuil
    ######################################

    def _compute_search_radius(self, kf_vel: float) -> int:
        """Rayon ROI adaptatif (plancher search_radius_px, plafond max_search_radius_px)."""
        if not self._adaptive_size or self._ema_blob_size is None:
            return self._search_radius_px
        radius = (
            self._ema_blob_size * self._roi_size_factor + kf_vel * self._vel_radius_factor + 8.0
        )
        radius = max(self._search_radius_px, int(radius))
        return min(self._max_search_radius_px, radius)

    def _detect_candidates(
        self,
        search_roi: np.ndarray,
        sx1: int,
        sy1: int,
        want_binary: bool = True,
    ) -> "tuple[list[list], np.ndarray | None, np.ndarray | None]":
        """
        Multi-kernel × multi-seuil Top-Hat -> blobs candidats dédupliqués.
        Utilise _detect_candidates_multi() (cœur commun MOT/ROI/Tracking_TOPHAT) pour la
        collecte, puis applique la dédup Tracking_TOPHAT (IoU + distance + max_candidates).
        Retourne (candidates, binary_white, binary_black).
        """
        # Collecte brute : dedup_dist_px=0 pour laisser _dedup_blobs() Tracking_TOPHAT gérer
        all_blobs, binary_white, binary_black = _detect_candidates_multi(
            search_roi,
            tophat_kernels=self._white_kernels,
            black_tophat_kernels=self._black_kernels,
            k_sigma_levels=self._k_sigma_levels,
            threshold_rel=self._threshold_rel,
            min_area_px2=self._min_area_px2,
            max_area_px2=self._max_area_px2,
            min_score=0.0,
            offset_x=sx1,
            offset_y=sy1,
            use_adaptive=self._use_adaptive,
            min_thresh_abs=self._min_thresh_abs,
            dedup_dist_px=0,  # dédup riche ci-dessous (IoU + dist + max_candidates)
            want_binary=want_binary,
        )
        return self._dedup_blobs(all_blobs), binary_white, binary_black

    def _dedup_blobs(self, blobs: list[list]) -> list[list]:
        """Fusion de doublons : garde le plus gros blob par cluster (IoU/distance)."""
        if not blobs:
            return []
        blobs = sorted(blobs, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]), reverse=True)
        kept: list[list] = []
        for b in blobs:
            bcx = (b[0] + b[2]) / 2.0
            bcy = (b[1] + b[3]) / 2.0
            dup = False
            for k in kept:
                kcx = (k[0] + k[2]) / 2.0
                kcy = (k[1] + k[3]) / 2.0
                if (
                    math.hypot(bcx - kcx, bcy - kcy) <= self._dedup_dist_px
                    or _iou(b, k) >= self._dedup_iou_thresh
                ):
                    dup = True
                    break
            if not dup:
                kept.append(b)
            if len(kept) >= self._max_candidates:
                break
        return kept

    ######################################
    # Pipeline : features + scoring
    ######################################

    def _extract_features(self, gray: np.ndarray, bbox: list) -> dict[str, float] | None:
        """Features géométrie / intensité / fond pour un blob candidat."""
        h_f, w_f = gray.shape[:2]
        x1, y1, x2, y2 = [int(v) for v in bbox[:4]]
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w_f, x2)
        y2 = min(h_f, y2)
        w = max(1, x2 - x1)
        h = max(1, y2 - y1)
        inner = gray[y1:y2, x1:x2].astype(np.float32)
        if inner.size == 0:
            return None

        mean_in = float(inner.mean())
        max_in = float(inner.max())
        std_in = float(inner.std())

        m = self._bg_ring_margin_px
        ox1 = max(0, x1 - m)
        oy1 = max(0, y1 - m)
        ox2 = min(w_f, x2 + m)
        oy2 = min(h_f, y2 + m)
        outer = gray[oy1:oy2, ox1:ox2].astype(np.float32)
        ring_cnt = outer.size - inner.size
        if ring_cnt > 0:
            mean_bg = float((outer.sum() - inner.sum()) / ring_cnt)
            std_bg = float(outer.std())
        else:
            mean_bg = mean_in
            std_bg = std_in

        contrast = mean_in - mean_bg
        snr = contrast / (std_bg + 1e-3)
        diam = float(max(w, h))
        aspect = float(w) / float(h)

        return {
            "w": float(w),
            "h": float(h),
            "diam": diam,
            "aspect": aspect,
            "area": float(w * h),
            "mean_in": mean_in,
            "max_in": max_in,
            "std_in": std_in,
            "mean_bg": mean_bg,
            "std_bg": std_bg,
            "contrast": float(contrast),
            "snr": float(snr),
        }

    def _score_candidate(
        self,
        gray: np.ndarray,
        blob: list,
        feat: dict[str, float],
        dist: float,
    ) -> tuple[float, float, float, float, float, float]:
        """Score global pondéré (0-1) + composantes (total, geom, int, bg, motion, app)."""
        prof = self._feat_profile

        # Mouvement : proximité au centre prédit Kalman
        s_motion = math.exp(-dist / max(self._max_dist_px, 1.0))

        if prof is None:
            s_geom = s_int = s_bg = 1.0
        else:
            s_geom = 0.5 * _rel_sim(feat["diam"], prof["diam"]) + 0.5 * _rel_sim(
                feat["aspect"], prof["aspect"]
            )
            s_int = _rel_sim(feat["mean_in"], prof["mean_in"])
            s_bg = _rel_sim(feat["snr"], prof["snr"], scale=0.7)

        # Apparence (optionnelle)
        s_app = 0.0
        w_app = self._w_appearance
        if w_app > 0:
            bcx = (blob[0] + blob[2]) / 2.0
            bcy = (blob[1] + blob[3]) / 2.0
            s_app = self._score_blob(gray, bcx, bcy)
        else:
            w_app = 0.0

        num = (
            self._w_geometry * s_geom
            + self._w_intensity * s_int
            + self._w_background * s_bg
            + self._w_motion * s_motion
            + w_app * s_app
        )
        den = self._w_geometry + self._w_intensity + self._w_background + self._w_motion + w_app
        total = num / den if den > 0 else 0.0
        return total, s_geom, s_int, s_bg, s_motion, s_app

    def _update_profile(self, feat: dict[str, float]) -> None:
        """Met à jour le profil de features de la cible par EMA."""
        if self._feat_profile is None:
            self._feat_profile = dict(feat)
            return
        a = self._feature_ema_alpha
        for k, v in feat.items():
            old = self._feat_profile.get(k, v)
            self._feat_profile[k] = a * v + (1 - a) * old

    ######################################
    # Apparence (template NCC / cosinus ResNet)
    ######################################

    def _add_template(self, gray: np.ndarray, cx: float, cy: float) -> None:
        """Extrait un template/features d'apparence et l'ajoute a l'historique."""
        patch = _extract_patch(gray, cx, cy, self._effective_template_patch)
        if patch is None:
            return
        if self._use_resnet:
            if self._extractor is None:
                self._extractor = _ResNetExtractor(
                    layer=self._resnet_layer,
                    device=self._resnet_device,
                )
            feat = self._extractor.extract(patch)
            if feat is None:
                return
            entry = feat
        else:
            entry = patch
        self._template_history.append(entry)
        if len(self._template_history) > self._template_history_max:
            self._template_history.pop(0)

    def _score_blob(self, gray: np.ndarray, bcx: float, bcy: float) -> float:
        """Score d'apparence max (NCC ou cosinus) vs l'historique des templates."""
        if not self._template_history:
            return 0.0
        patch = _extract_patch(gray, bcx, bcy, self._effective_template_patch)
        if patch is None:
            return 0.0
        if self._use_resnet:
            if self._extractor is None:
                return 0.0
            feat = self._extractor.extract(patch)
            if feat is None:
                return 0.0
            return max(_cosine_similarity(feat, t) for t in self._template_history)
        return max(_ncc_score(patch, t) for t in self._template_history)

    ######################################
    # Helpers divers
    ######################################

    def _fail_frame(
        self,
        frame,
        cx_pred: float,
        cy_pred: float,
        sr: int,
        score: float = 0.0,
    ) -> tuple[bool, None, None]:
        """Frame sans blob valide : écrit le debug et retourne l'échec."""
        if self._tracking_tophat_video_writer is not None:
            self._tracking_tophat_video_writer.write(
                frame=frame,
                cx_pred=cx_pred,
                cy_pred=cy_pred,
                search_radius=sr,
                bbox=None,
                score=score,
                n_templates=len(self._template_history),
                frame_idx=self._frame_idx,
            )
        self._frame_idx += 1
        return False, None, None

    def _find_bbox(
        self,
        cx: float,
        cy: float,
        mot_tracks,
    ) -> tuple[list | None, str | None]:
        """Meilleure track MOT : hit exact > plus proche (near_thresh_px) > None."""
        if not mot_tracks:
            return None, None
        for trk in mot_tracks:
            x1, y1, x2, y2 = trk.bbox[:4]
            if x1 <= cx <= x2 and y1 <= cy <= y2:
                return [int(x1), int(y1), int(x2), int(y2)], f"hit track_id={trk.track_id}"
        best_trk = None
        best_dist = float("inf")
        for trk in mot_tracks:
            x1, y1, x2, y2 = trk.bbox[:4]
            d = math.hypot((x1 + x2) / 2 - cx, (y1 + y2) / 2 - cy)
            if d < best_dist:
                best_dist = d
                best_trk = trk
        if best_trk is not None and best_dist <= self._near_thresh_px:
            return (
                [int(v) for v in best_trk.bbox[:4]],
                f"track_id={best_trk.track_id} dist={best_dist:.1f}px",
            )
        return None, None
