##########################################
# Project  : VisionNexus
# File     : detector_mot.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : MOT detectors (YOLO, TopHat, Dummy, None) returning [x1,y1,x2,y2,score,cls] lists.
##########################################

import random
from abc import ABC, abstractmethod
from typing import Any

import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None

from utils.logger import get_logger

log = get_logger(__name__)

Detection = list[float]  # [x1, y1, x2, y2, score, class_id]

# Conversion factor: MAD -> equivalent Gaussian sigma (robust noise estimator)
_MAD_TO_SIGMA = 1.4826


#################################
# Helpers partages (importes par detector_roi)
#################################


def _to_uint8_gray(frame: np.ndarray) -> np.ndarray:
    """Convertit une frame en uint8 niveaux de gris (normalise float32/uint16)."""
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


def _compute_adaptive_threshold(
    tophat: np.ndarray,
    threshold_rel: float,
    use_adaptive: bool,
    k_sigma: float,
    min_thresh_abs: int,
) -> tuple:
    """
    Calcule le seuil pour l'image tophat.

    Mode adaptatif (use_adaptive=True) :
      - median  : valeur mediane du tophat (robuste aux blobs brillants)
      - MAD     : median absolute deviation
      - noise   : 1.4826 * MAD  (estimation sigma gaussien)
      - seuil   : max(min_thresh_abs, median + k_sigma * noise)

    Mode fixe (use_adaptive=False) :
      - seuil = threshold_rel * max_val

    Returns
    ######
    (thresh_val, stats)
      thresh_val : int   (valeur 0-255 a passer a cv2.threshold)
      stats      : dict  (mean_roi, std_roi, noise_est, median_roi, thresh_final)
    """
    max_val = float(tophat.max())
    flat = tophat.flatten().astype(np.float32)
    mean_val = float(flat.mean())
    std_val = float(flat.std())
    median_val = float(np.median(flat))
    mad = float(np.median(np.abs(flat - median_val)))
    noise_est = _MAD_TO_SIGMA * mad

    if use_adaptive and max_val > 0:
        thresh_raw = median_val + k_sigma * noise_est
        thresh_val = max(float(min_thresh_abs), min(thresh_raw, max_val))
    else:
        thresh_val = threshold_rel * max_val if max_val > 0 else 0.0

    stats = {
        "mean_roi": mean_val,
        "std_roi": std_val,
        "median_roi": median_val,
        "noise_est": noise_est,
        "thresh_final": thresh_val,
    }
    return int(thresh_val), stats


def _detect_candidates_multi(
    gray: np.ndarray,
    tophat_kernels: list,
    k_sigma_levels: list,
    threshold_rel: float,
    min_area_px2: int,
    max_area_px2: int,
    min_score: float = 0.0,
    offset_x: int = 0,
    offset_y: int = 0,
    use_adaptive: bool = True,
    min_thresh_abs: int = 5,
    dedup_dist_px: float = 5.0,
    black_tophat_kernels: list = [],
    want_binary: bool = True,
) -> "tuple[list[Detection], np.ndarray | None, np.ndarray | None]":
    """
    Coeur commun de detection tophat - multi-kernel x multi-seuil.

    Utilisé par TopHatDetectorMOT, TopHatROIDetector et TrackingTophatSot.
    Pour chaque combinaison (kernel, k_sigma) appelle _tophat_blobs() pour les
    white tophat (cibles chaudes) et _blackhat_blobs() pour les black tophat
    (cibles froides). Fusionne les resultats. Les doublons (distance centre <
    dedup_dist_px) sont supprimes en gardant le blob de meilleur score.

    Parameters
    ########
    gray                 : image grise uint8 (ROI ou image complete)
    tophat_kernels       : liste noyaux white tophat ex. [3, 7] (cibles chaudes)
    black_tophat_kernels : liste noyaux black tophat ex. [5] (cibles froides)
    k_sigma_levels       : liste de seuils sigma ex. [2.0] ou [1.5, 2.5]
    threshold_rel        : seuil fixe (si use_adaptive=False)
    min_area_px2 / max_area_px2 : filtre d'aire blob
    min_score            : score minimum d'intensite relative (0-1)
    offset_x/y           : decalage coords pour retour en coords image complete (ROI)
    use_adaptive         : seuillage adaptatif mediane + k_sigma*MAD
    min_thresh_abs       : seuil absolu minimum (0-255)
    dedup_dist_px        : distance max entre centres pour fusion des doublons

    Returns
    ######
    (blobs, binary_white, binary_black)
      blobs         : list of [x1,y1,x2,y2,score,src] dedupliques
                      src=0.0 white tophat | src=1.0 black tophat
      binary_white  : OR des masques binaires white tophat (cibles chaudes)
      binary_black  : OR des masques binaires black tophat (cibles froides)
    """
    all_blobs: list[Detection] = []
    binary_white = np.zeros_like(gray) if want_binary else None
    binary_black = np.zeros_like(gray) if want_binary else None

    for ks in tophat_kernels:
        for k_sig in k_sigma_levels:
            blobs, binary = _tophat_blobs(
                gray,
                kernel_size=int(ks),
                threshold_rel=threshold_rel,
                min_area_px2=min_area_px2,
                max_area_px2=max_area_px2,
                min_score=min_score,
                offset_x=offset_x,
                offset_y=offset_y,
                use_adaptive=use_adaptive,
                k_sigma=float(k_sig),
                min_thresh_abs=min_thresh_abs,
            )
            all_blobs.extend(blobs)
            if want_binary:
                binary_white = cv2.bitwise_or(binary_white, binary)

    for ks in black_tophat_kernels:
        for k_sig in k_sigma_levels:
            blobs, binary = _blackhat_blobs(
                gray,
                kernel_size=int(ks),
                threshold_rel=threshold_rel,
                min_area_px2=min_area_px2,
                max_area_px2=max_area_px2,
                min_score=min_score,
                offset_x=offset_x,
                offset_y=offset_y,
                use_adaptive=use_adaptive,
                k_sigma=float(k_sig),
                min_thresh_abs=min_thresh_abs,
            )
            all_blobs.extend(blobs)
            if want_binary:
                binary_black = cv2.bitwise_or(binary_black, binary)

    if not all_blobs or dedup_dist_px <= 0:
        return all_blobs, binary_white, binary_black

    # Deduplications : trier par score decroissant, supprimer les proches
    all_blobs.sort(key=lambda b: b[4], reverse=True)
    kept: list[Detection] = []
    for blob in all_blobs:
        bcx = (blob[0] + blob[2]) / 2.0
        bcy = (blob[1] + blob[3]) / 2.0
        too_close = False
        for kb in kept:
            kcx = (kb[0] + kb[2]) / 2.0
            kcy = (kb[1] + kb[3]) / 2.0
            if ((bcx - kcx) ** 2 + (bcy - kcy) ** 2) ** 0.5 < dedup_dist_px:
                too_close = True
                break
        if not too_close:
            kept.append(blob)

    return kept, binary_white, binary_black


def _blackhat_blobs(
    gray: np.ndarray,
    kernel_size: int,
    threshold_rel: float,
    min_area_px2: int,
    max_area_px2: int,
    min_score: float = 0.0,
    offset_x: int = 0,
    offset_y: int = 0,
    use_adaptive: bool = False,
    k_sigma: float = 2.0,
    min_thresh_abs: int = 5,
) -> "tuple[list[Detection], np.ndarray]":
    """
    Applique la transformee morphologique top-hat noire et extrait les blobs.
    Detecte les cibles FROIDES (sombres) sur fond chaud (clair).
    Identique a _tophat_blobs mais utilise MORPH_BLACKHAT.
    """
    h, w = gray.shape[:2]
    max_k = min(h, w) - 1
    if max_k < 1:
        return [], np.zeros_like(gray)
    if kernel_size > max_k:
        log.warning(
            "_blackhat_blobs: kernel %d > ROI min(%d,%d) -> clampe a %d"
            " (blackhat degenere si kernel >= ROI, reduire kernel ou agrandir ROI)",
            kernel_size, h, w, max_k,
        )
        kernel_size = max_k
    if kernel_size % 2 == 0:
        kernel_size = max(1, kernel_size - 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)

    thresh_val, stats = _compute_adaptive_threshold(
        blackhat, threshold_rel, use_adaptive, k_sigma, min_thresh_abs,
    )
    stats["n_blobs"] = 0

    if thresh_val == 0:
        return [], np.zeros_like(gray)

    _, binary = cv2.threshold(blackhat, thresh_val, 255, cv2.THRESH_BINARY)
    binary = binary.astype(np.uint8)

    n_labels, labels, cv_stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    detections = []
    for label_id in range(1, n_labels):
        area = int(cv_stats[label_id, cv2.CC_STAT_AREA])
        if area < min_area_px2 or area > max_area_px2:
            continue

        lx = int(cv_stats[label_id, cv2.CC_STAT_LEFT])
        ly = int(cv_stats[label_id, cv2.CC_STAT_TOP])
        lw = int(cv_stats[label_id, cv2.CC_STAT_WIDTH])
        lh = int(cv_stats[label_id, cv2.CC_STAT_HEIGHT])

        mask = labels == label_id
        mean_intensity = float(blackhat[mask].mean()) / 255.0
        if mean_intensity < min_score:
            continue

        x1 = float(lx + offset_x)
        y1 = float(ly + offset_y)
        x2 = float(lx + lw + offset_x)
        y2 = float(ly + lh + offset_y)

        detections.append([x1, y1, x2, y2, mean_intensity, 1.0])

    stats["n_blobs"] = len(detections)
    return detections, binary


def _tophat_blobs(
    gray: np.ndarray,
    kernel_size: int,
    threshold_rel: float,
    min_area_px2: int,
    max_area_px2: int,
    min_score: float = 0.0,
    offset_x: int = 0,
    offset_y: int = 0,
    use_adaptive: bool = False,
    k_sigma: float = 2.0,
    min_thresh_abs: int = 5,
    stats_out: dict[str, Any] | None = None,
) -> "tuple[list[Detection], np.ndarray]":
    """
    Applique la transformee morphologique top-hat blanche et extrait les blobs.

    Etapes :
      1. top-hat morphologique (noyau elliptique kernel_size x kernel_size)
      2. seuillage : adaptatif (median + k_sigma * MAD) ou fixe (threshold_rel * max)
      3. etiquetage composantes connexes
      4. filtrage par aire (min/max_area_px2) et score (min_score)

    Parameters
    ########
    gray            : image grise uint8
    kernel_size     : taille noyau morphologique
    threshold_rel   : seuil fixe = threshold_rel * max_val  (si not use_adaptive)
    min_area_px2    : aire minimale blob (px²)
    max_area_px2    : aire maximale blob (px²)
    min_score       : score minimum (intensite moyenne relative dans le blob, 0-1)
    offset_x/y      : decalage pour coords image complete (ROI uniquement)
    use_adaptive    : activer le seuillage adaptatif
    k_sigma         : multiplicateur sigma (seuillage adaptatif)
    min_thresh_abs  : seuil absolu minimum (0-255)
    stats_out       : si fourni, dict rempli avec les stats du seuillage

    Returns
    ######
    (blobs, binary)
      blobs  : list of [x1, y1, x2, y2, score, 0.0] en coords image completes
      binary : image binaire uint8 (0 ou 255) - pour debug video
    """
    h, w = gray.shape[:2]
    max_k = min(h, w) - 1
    if max_k < 1:
        if stats_out is not None:
            stats_out.update({"n_blobs": 0})
        return [], np.zeros_like(gray)
    if kernel_size > max_k:
        log.warning(
            "_tophat_blobs: kernel %d > ROI min(%d,%d) -> clampe a %d"
            " (tophat degenere si kernel >= ROI, reduire kernel ou agrandir ROI)",
            kernel_size, h, w, max_k,
        )
        kernel_size = max_k
    if kernel_size % 2 == 0:
        kernel_size = max(1, kernel_size - 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)

    thresh_val, stats = _compute_adaptive_threshold(
        tophat,
        threshold_rel,
        use_adaptive,
        k_sigma,
        min_thresh_abs,
    )
    stats["n_blobs"] = 0  # rempli ci-dessous

    if thresh_val == 0:
        if stats_out is not None:
            stats_out.update(stats)
        return [], np.zeros_like(gray)

    _, binary = cv2.threshold(tophat, thresh_val, 255, cv2.THRESH_BINARY)
    binary = binary.astype(np.uint8)

    n_labels, labels, cv_stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    detections = []
    for label_id in range(1, n_labels):  # skip background (label 0)
        area = int(cv_stats[label_id, cv2.CC_STAT_AREA])
        if area < min_area_px2 or area > max_area_px2:
            continue

        lx = int(cv_stats[label_id, cv2.CC_STAT_LEFT])
        ly = int(cv_stats[label_id, cv2.CC_STAT_TOP])
        lw = int(cv_stats[label_id, cv2.CC_STAT_WIDTH])
        lh = int(cv_stats[label_id, cv2.CC_STAT_HEIGHT])

        mask = labels == label_id
        mean_intensity = float(tophat[mask].mean()) / 255.0
        if mean_intensity < min_score:
            continue

        x1 = float(lx + offset_x)
        y1 = float(ly + offset_y)
        x2 = float(lx + lw + offset_x)
        y2 = float(ly + lh + offset_y)

        detections.append([x1, y1, x2, y2, mean_intensity, 0.0])

    stats["n_blobs"] = len(detections)

    if stats_out is not None:
        stats_out.update(stats)

    return detections, binary


#################################
# MOT Detectors
#################################


class BaseDetectorMOT(ABC):
    def warmup(self) -> None:
        """Pré-charge le modèle avant l'ouverture ZMQ. No-op par défaut."""

    @abstractmethod
    def detect(self, frame: np.ndarray, frame_idx: int) -> list[Detection]:
        """
        Detecte les objets dans `frame`.

        Parameters
        ########
        frame     : np.ndarray  HxW ou HxWxC
        frame_idx : int         index de la frame (pour debug / log)

        Returns
        ######
        list of [x1, y1, x2, y2, score, class_id]
        """

    def configure(self, cfg: dict) -> None:
        """Charge les hyperparametres debug. Override dans TopHatDetectorMOT."""

    def close(self) -> None:
        """Libere les ressources (video debug, etc.). Override si necesssaire."""


class NoneDetectorMOT(BaseDetectorMOT):
    """Detecteur vide : retourne toujours []. Utiliser detector_mot: "none"."""

    def detect(self, frame: np.ndarray, frame_idx: int) -> list[Detection]:
        return []


class DummyDetectorMOT(BaseDetectorMOT):
    """
    Genere des detections aleatoires pour tester le pipeline
    sans avoir de modele YOLO disponible.

    Parameters
    ########
    n_objects     : nombre moyen d'objets simules par frame
    box_size      : taille approximative des boites (pixels)
    seed          : graine aleatoire (None = aleatoire)
    presence_prob : probabilite qu'un objet fictif apparaisse sur une frame
    """

    def __init__(
        self,
        n_objects: int = 2,
        box_size: int = 30,
        seed: int = 42,
        presence_prob: float = 0.8,
    ):
        self.n_objects = n_objects
        self.box_size = box_size
        self.presence_prob = presence_prob
        self._rng = random.Random(seed)
        self._fake_tracks: list = []

    def _init_fake_tracks(self, h: int, w: int):
        self._fake_tracks = []
        for _ in range(self.n_objects):
            cx = self._rng.uniform(self.box_size, w - self.box_size)
            cy = self._rng.uniform(self.box_size, h - self.box_size)
            vx = self._rng.uniform(-3, 3)
            vy = self._rng.uniform(-3, 3)
            self._fake_tracks.append([cx, cy, vx, vy])

    def _step_fake_tracks(self, h: int, w: int):
        for t in self._fake_tracks:
            t[0] = float(np.clip(t[0] + t[2], self.box_size, w - self.box_size))
            t[1] = float(np.clip(t[1] + t[3], self.box_size, h - self.box_size))
            t[2] += self._rng.gauss(0, 0.3)
            t[3] += self._rng.gauss(0, 0.3)

    def detect(self, frame: np.ndarray, frame_idx: int) -> list[Detection]:
        h, w = frame.shape[:2]

        if not self._fake_tracks:
            self._init_fake_tracks(h, w)

        self._step_fake_tracks(h, w)

        detections = []
        for cx, cy, _, _ in self._fake_tracks:
            if self._rng.random() > self.presence_prob:
                continue

            half = self.box_size / 2
            noise_x = self._rng.gauss(0, 3)
            noise_y = self._rng.gauss(0, 3)
            x1 = max(0, cx - half + noise_x)
            y1 = max(0, cy - half + noise_y)
            x2 = min(w, cx + half + noise_x)
            y2 = min(h, cy + half + noise_y)
            score = self._rng.uniform(0.6, 0.99)
            class_id = 0

            detections.append([x1, y1, x2, y2, score, class_id])

        return detections


class YOLODetectorMOT(BaseDetectorMOT):
    r"""
    Detecteur YOLO base sur ultralytics.

    Formats supportés :
      .pt    : poids PyTorch (entraînement standard)
      .onnx  : ONNX exporté
      .engine: TensorRT engine (Jetson / GPU NVIDIA)
               /!\ Un .engine est spécifique au GPU sur lequel il a été compilé.
               Compiler sur la Jetson cible :
                 from ultralytics import YOLO
                 YOLO("last.pt").export(format="engine", imgsz=640, device=0)
               Puis utiliser le .engine généré :
                 weights_yolo: "weights/last.engine"

    Parameters
    ########
    weights_path : str   chemin vers le .pt, .onnx ou .engine
    conf_thresh  : float seuil de confiance
    iou_thresh   : float seuil NMS IoU
    device       : str   'cpu', 'cuda', 'cuda:0', etc.
                         (ignoré pour .engine : le device est baked-in)
    img_size     : int   taille d'entree reseau
                         (ignoré pour .engine : baked-in à la compilation)
    """

    def __init__(
        self,
        weights_path: str,
        conf_thresh: float = 0.3,
        iou_thresh: float = 0.45,
        device: str = "cpu",
        img_size: int = 640,
    ):
        self.conf_thresh = conf_thresh
        self.iou_thresh = iou_thresh
        self.device = device
        self.img_size = img_size
        self._model = None
        self._weights_path = weights_path
        self._is_trt = weights_path.lower().endswith(".engine")

    def warmup(self) -> None:
        """Déclenche le chargement + inférence dummy avant l'ouverture ZMQ."""
        if self._model is None:
            self._load_model()

    def _load_model(self):
        """Chargement paresseux du modèle (PyTorch, ONNX ou TensorRT)."""
        import time

        try:
            from ultralytics import YOLO  # noqa
        except ImportError as e:
            raise ImportError("ultralytics n'est pas installé. pip install ultralytics") from e

        self._model = YOLO(self._weights_path, task="detect")

        if self._is_trt:
            log.info(
                "YOLO TensorRT engine chargé : %s (device baked-in, img_size baked-in)",
                self._weights_path,
            )
        else:
            try:
                self._model.to(self.device)
            except Exception as exc:
                log.warning("YOLO .to(%s) échoué : %s (ignoré)", self.device, exc)
            log.info(
                "YOLO model chargé : %s sur %s",
                self._weights_path,
                self.device,
            )

        # Inférence dummy pour forcer la compilation JIT / TensorRT et le transfert
        # des poids GPU avant la première vraie frame (évite le spike de latence).
        log.info("YOLO warmup...")
        t0 = time.perf_counter()
        dummy = np.zeros((self.img_size, self.img_size, 3), dtype=np.uint8)
        self._model.predict(dummy, verbose=False)
        log.info("YOLO warmup terminé en %.2f s", time.perf_counter() - t0)

    def _preprocess(self, frame: np.ndarray) -> np.ndarray:
        """Convertit une image IR (uint16 ou float) en uint8 RGB 3 canaux pour YOLO."""
        img = frame.astype(np.float32)
        lo, hi = img.min(), img.max()
        if hi > lo:
            img = (img - lo) / (hi - lo) * 255.0
        img = img.clip(0, 255).astype(np.uint8)
        if img.ndim == 2:
            img = np.stack([img, img, img], axis=-1)
        return img

    def detect(self, frame: np.ndarray, frame_idx: int) -> list[Detection]:
        if self._model is None:
            self._load_model()

        rgb = self._preprocess(frame)
        results = self._model.predict(
            rgb,
            conf=self.conf_thresh,
            iou=self.iou_thresh,
            imgsz=self.img_size,
            verbose=False,
        )

        detections = []
        for r in results:
            boxes = r.boxes
            if boxes is None:
                continue
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                score = float(box.conf[0].cpu().numpy())
                class_id = int(box.cls[0].cpu().numpy())
                detections.append([float(x1), float(y1), float(x2), float(y2), score, class_id])
        return detections


class TopHatDetectorMOT(BaseDetectorMOT):
    """
    Detecteur morphologique top-hat pour points chauds IR (non-IA, sans GPU).

    Utilise _detect_candidates_multi() - cœur commun partagé avec
    TopHatROIDetector et TrackingTophatSot.

    Parametres YAML (section tophat_mot) :
      tophat_kernels     : liste de tailles noyau  ex. [7]  (remplace kernel_size)
      k_sigma_levels     : liste de seuils sigma   ex. [2.0] (remplace k_sigma)
      threshold_rel      : seuil fixe (si use_adaptive_thresh=false)
      min_area_px2       : aire min blob (px²)
      max_area_px2       : aire max blob (px²)
      min_score          : intensite min relative (0-1)
      use_adaptive_thresh: activer le seuillage adaptatif
      min_thresh_abs     : seuil absolu minimum (0-255)

    Debug (section debug_tracking) :
      tophat_mot_save_binary_video : sauvegarder video binaire seuilee
      binary_video_fps             : fps de la video
      binary_video_name            : nom du fichier MP4
    """

    def __init__(
        self,
        tophat_kernels: list = None,
        k_sigma_levels: list = None,
        threshold_rel: float = 0.4,
        min_area_px2: int = 16,
        max_area_px2: int = 5000,
        min_score: float = 0.5,
        use_adaptive: bool = False,
        min_thresh_abs: int = 5,
        max_candidates: int = 0,
    ):
        self.tophat_kernels = list(tophat_kernels) if tophat_kernels else [7]
        self.k_sigma_levels = list(k_sigma_levels) if k_sigma_levels else [2.0]
        self.threshold_rel = threshold_rel
        self.min_area_px2 = min_area_px2
        self.max_area_px2 = max_area_px2
        self.min_score = min_score
        self.use_adaptive = use_adaptive
        self.min_thresh_abs = min_thresh_abs
        self._max_candidates = max_candidates  # 0 = pas de cap
        # Compat legacy : exposé pour les logs dans configure()
        self.kernel_size = self.tophat_kernels[0]

        # Video debug (initialise par configure() si active)
        self._binary_video_writer = None

    def configure(self, cfg: dict) -> None:
        """Charge les parametres de debug depuis le cfg dict."""
        from utils.visu_algo_debug import AlgoDebugConfig, TopHatBinaryVideoWriter

        debug_dir = cfg.get("_debug_dir", "outputs/debug_tracking")
        debug_cfg = AlgoDebugConfig(cfg, debug_dir)

        if debug_cfg.tophat_binary_video:
            self._binary_video_writer = TopHatBinaryVideoWriter(
                debug_dir=debug_dir,
                fps=debug_cfg.binary_video_fps,
                video_name=debug_cfg.binary_video_name,
            )
            log.info(
                "TopHatDetectorMOT: video binaire debug activee -> %s/%s",
                debug_dir,
                debug_cfg.binary_video_name,
            )
        else:
            self._binary_video_writer = None

        log.debug(
            "TopHatDetectorMOT.configure: kernels=%s  k_sigma=%s  adaptive=%s"
            "  min_thresh=%d  binary_video=%s",
            self.tophat_kernels,
            self.k_sigma_levels,
            self.use_adaptive,
            self.min_thresh_abs,
            self._binary_video_writer is not None,
        )

    def detect(self, frame: np.ndarray, frame_idx: int) -> list[Detection]:
        gray = _to_uint8_gray(frame)

        blobs, binary, _ = _detect_candidates_multi(
            gray,
            tophat_kernels=self.tophat_kernels,
            k_sigma_levels=self.k_sigma_levels,
            threshold_rel=self.threshold_rel,
            min_area_px2=self.min_area_px2,
            max_area_px2=self.max_area_px2,
            min_score=self.min_score,
            use_adaptive=self.use_adaptive,
            min_thresh_abs=self.min_thresh_abs,
        )

        if self._max_candidates > 0 and len(blobs) > self._max_candidates:
            blobs = blobs[: self._max_candidates]

        log.debug(
            "TopHatDetectorMOT [F%05d]: kernels=%s  blobs=%d  max_candidates=%s",
            frame_idx,
            self.tophat_kernels,
            len(blobs),
            self._max_candidates if self._max_candidates > 0 else "off",
        )

        # Video debug binaire
        if self._binary_video_writer is not None and binary is not None:
            self._binary_video_writer.write(binary)

        return blobs

    def close(self) -> None:
        """Libere la video de debug si active."""
        if self._binary_video_writer is not None:
            self._binary_video_writer.close()
            self._binary_video_writer = None


#### Backward compatibility aliases ###########################################

BaseDetector = BaseDetectorMOT
DummyDetector = DummyDetectorMOT
YOLODetector = YOLODetectorMOT
