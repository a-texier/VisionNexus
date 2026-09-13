##########################################
# Project  : VisionNexus
# File     : ego_motion.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Inertial and image-based ego-motion compensation via homography (H = K·R·K⁻¹).
##########################################

import math
from collections import deque

import numpy as np

from utils.logger import get_logger

try:
    import cv2
except ImportError:
    cv2 = None

log = get_logger(__name__)

Detection = list[float]  # [x1, y1, x2, y2, score, class_id]


class EgoMotionCompensator:
    """
    Compensateur d'ego-motion basé sur les données LDV inertielles.

    La matrice intrinsèque K est construite à partir du HFOV et VFOV fournis par
    les métadonnées (ZMQ : f32HFOV_reel / f32VFOV_reel ; rejeu : CHH/CHV CSV).
    Appeler update_fov_from_meta(meta) chaque frame pour rester synchronisé.

    Parameters
    ########
    focal_length_px : float | None
        Focale en pixels. Si None, calculée depuis HFOV/VFOV des métadonnées.
    hfov_deg : float
        Champ horizontal initial en degrés. Mis à jour par update_fov_from_meta().
    vfov_deg : float
        Champ vertical initial. 0.0 = utiliser hfov (pixels carrés approx).
    """

    def __init__(
        self,
        focal_length_px: float | None = None,
        hfov_deg: float = 0.0,
        vfov_deg: float = 0.0,
    ):
        self._focal_px  = focal_length_px
        self._hfov_deg  = hfov_deg
        self._vfov_deg  = vfov_deg
        self._img_shape: tuple[int, int] | None = None
        self._K:  np.ndarray | None = None
        self._Ki: np.ndarray | None = None

    ### FOV depuis métadonnées ################################################

    def update_fov_from_meta(self, meta: dict) -> None:
        """
        Met à jour HFOV/VFOV depuis un dict de métadonnées frame.

        Clés lues : "hfov_deg" et "vfov_deg". Valeurs 0.0/absentes = ignorées.
        Invalide le cache K si le FOV change (K sera recalculé au prochain appel).
        """
        hfov = float(meta.get("hfov_deg") or 0.0)
        vfov = float(meta.get("vfov_deg") or 0.0)
        if hfov <= 0.0:
            return
        if hfov == self._hfov_deg and vfov == self._vfov_deg:
            return
        self._hfov_deg = hfov
        self._vfov_deg = vfov
        # Invalide K pour forcer recalcul avec le nouveau FOV
        self._K = None
        self._Ki = None
        log.debug(
            "EgoMotion FOV mis à jour : HFOV=%.2f° VFOV=%.2f°",
            self._hfov_deg,
            self._vfov_deg if self._vfov_deg > 0 else self._hfov_deg,
        )

    ### Matrice intrinsèque ###################################################

    def _build_K(self, h: int, w: int) -> np.ndarray | None:
        """
        Construit K depuis focal_px ou HFOV/VFOV.

        Si focal_length_px fourni : fx = fy = focal_px (pixels carrés).
        Sinon : fx depuis HFOV, fy depuis VFOV (fallback HFOV si VFOV absent).
        Retourne None si aucune source de FOV disponible.
        """
        if self._focal_px is not None:
            fx = fy = self._focal_px
        elif self._hfov_deg > 0.0:
            fx = (w / 2.0) / math.tan(math.radians(self._hfov_deg / 2.0))
            vfov = self._vfov_deg if self._vfov_deg > 0.0 else self._hfov_deg
            fy = (h / 2.0) / math.tan(math.radians(vfov / 2.0))
            log.debug(
                "K estimée : fx=%.1f  fy=%.1f  (HFOV=%.2f°  VFOV=%.2f°  %dx%d)",
                fx, fy, self._hfov_deg, vfov, w, h,
            )
        else:
            return None

        cx, cy = w / 2.0, h / 2.0
        return np.array(
            [[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]],
            dtype=np.float64,
        )

    def _get_K(self, h: int, w: int) -> np.ndarray | None:
        if self._K is None or self._img_shape != (h, w):
            self._img_shape = (h, w)
            self._K = self._build_K(h, w)
            self._Ki = np.linalg.inv(self._K) if self._K is not None else None
        return self._K

    ### Rotation caméra #######################################################

    @staticmethod
    def _ldv_to_rotation(
        prev_ldv: tuple[float, ...],
        cur_ldv: tuple[float, ...],
    ) -> np.ndarray:
        """
        Calcule R_3x3 entre deux positions LDV successives.

        Modèle : trois rotations découplées composées dans l'ordre Rz·Ry·Rx.
          d_az     --> Ry (pan horizontal)
          d_el     --> Rx (tilt vertical)
          d_roulis --> Rz (roulis caméra, présent si ldv[2] disponible)

        Parameters
        ########
        prev_ldv, cur_ldv : (az_deg, el_deg[, roulis_deg])
        """
        d_az = -math.radians(cur_ldv[0] - prev_ldv[0])
        d_el = -math.radians(cur_ldv[1] - prev_ldv[1])

        Rx = np.array(
            [[1, 0, 0],
             [0,  math.cos(d_el), -math.sin(d_el)],
             [0,  math.sin(d_el),  math.cos(d_el)]],
            dtype=np.float64,
        )
        Ry = np.array(
            [[ math.cos(d_az), 0, math.sin(d_az)],
             [0, 1, 0],
             [-math.sin(d_az), 0, math.cos(d_az)]],
            dtype=np.float64,
        )

        d_roulis_deg = None
        if len(cur_ldv) > 2 and len(prev_ldv) > 2:
            d_roulis_deg = cur_ldv[2] - prev_ldv[2]

        if d_roulis_deg is not None:
            d_r = -math.radians(d_roulis_deg)
            Rz = np.array(
                [[math.cos(d_r), -math.sin(d_r), 0],
                 [math.sin(d_r),  math.cos(d_r), 0],
                 [0, 0, 1]],
                dtype=np.float64,
            )
            return Rz @ Ry @ Rx

        return Ry @ Rx

    ### Homographie ###########################################################

    def build_homography(
        self,
        prev_ldv: tuple[float, ...],
        cur_ldv: tuple[float, ...],
        frame_shape: tuple[int, ...],
    ) -> np.ndarray | None:
        """
        Construit H = K · R · K⁻¹ (homographie inertielle planaire).

        Parameters
        ########
        prev_ldv, cur_ldv : (az_deg, el_deg[, roulis_deg])
                            Le roulis est utilisé si présent en ldv[2].
        frame_shape       : shape numpy (H, W) ou (H, W, C)

        Returns
        ######
        H : np.ndarray (3, 3) ou None si K non disponible (FOV absent)
        """
        h, w = frame_shape[:2]
        K = self._get_K(h, w)
        if K is None:
            log.debug("build_homography: K non disponible (HFOV=0) -> H=None")
            return None
        Ki = self._Ki

        R = self._ldv_to_rotation(prev_ldv, cur_ldv)
        H = K @ R @ Ki
        H /= H[2, 2]
        return H

    ### Reprojection d'un point via LDV #######################################

    def reproject_click_ldv(
        self,
        ldv_click: tuple[float, float],
        ldv_current: tuple[float, float],
        point: tuple[float, float],
        frame_shape: tuple[int, ...],
    ) -> tuple[float, float]:
        """
        Reprojecte un point (x, y) via la rotation caméra entre ldv_click et ldv_current.

        Aucun traitement image - construit H = K·R·K⁻¹ à partir des LDV
        et transforme le point par perspective.

        Utilisation typique : corriger le décalage entre frame_click et frame_emit
        quand la caméra a bougé pendant le délai de traitement.

        Parameters
        ########
        ldv_click   : (az_deg, el_deg) LDV au moment du clic utilisateur
        ldv_current : (az_deg, el_deg) LDV à la frame courante de traitement
        point       : (x, y) coordonnées du clic dans frame_click
        frame_shape : shape numpy (H, W) ou (H, W, C)

        Returns
        ######
        (x', y') reprojecté dans frame_current,
        ou point original inchangé si la construction de H échoue
        """
        try:
            H = self.build_homography(ldv_click, ldv_current, frame_shape)
            xp, yp = self._transform_point(H, point)
            log.debug(
                "reproject_click_ldv: (%.1f, %.1f) -> (%.1f, %.1f)",
                point[0],
                point[1],
                xp,
                yp,
            )
            return xp, yp
        except Exception as exc:
            log.warning("reproject_click_ldv: %s -> using raw coords", exc)
            return point

    ### Compensation des détections ###########################################

    @staticmethod
    def _transform_point(H: np.ndarray, pt: tuple[float, float]) -> tuple[float, float]:
        """Applique l'homographie H à un point 2D."""
        x, y = pt
        p = H @ np.array([x, y, 1.0], dtype=np.float64)
        return float(p[0] / p[2]), float(p[1] / p[2])

    def compensate_detections(
        self,
        detections: list[Detection],
        H: np.ndarray,
    ) -> list[Detection]:
        """
        Compense les bounding boxes en déplaçant leurs centres via H.
        La taille de la boîte est conservée (on ne déforme pas la bbox).

        Parameters
        ########
        detections : list of [x1, y1, x2, y2, score, class_id]
        H          : homographie 3x3 (frame_prev --> frame_cur stabilisée)

        Returns
        ######
        list of [x1_comp, y1_comp, x2_comp, y2_comp, score, class_id]
        """
        if H is None:
            return detections

        compensated = []
        for det in detections:
            x1, y1, x2, y2, score, cls = det
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            hw, hh = (x2 - x1) / 2.0, (y2 - y1) / 2.0

            # On transforme le centre
            cx_c, cy_c = self._transform_point(H, (cx, cy))

            compensated.append(
                [
                    cx_c - hw,
                    cy_c - hh,
                    cx_c + hw,
                    cy_c + hh,
                    score,
                    cls,
                ]
            )
        return compensated

    def compensate_frame(
        self,
        frame: np.ndarray,
        H: np.ndarray,
    ) -> np.ndarray:
        """
        Applique la compensation à l'image entière (pour visualisation).
        Utilise cv2.warpPerspective si OpenCV est disponible.

        Parameters
        ########
        frame : np.ndarray
        H     : homographie 3x3

        Returns
        ######
        frame stabilisée (même shape)
        """
        if cv2 is None:
            log.warning("cv2 not available: frame compensation skipped")
            return frame

        h, w = frame.shape[:2]
        # H^-1 : on mappe la frame courante vers la frame stabilisée
        H_inv = np.linalg.inv(H)
        warped = cv2.warpPerspective(
            frame,
            H_inv,
            (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )
        return warped


class FrameBuffer:
    """
    Buffer circulaire des dernières `max_delay` frames.
    Permet de retrouver frame_ref pour la reprojection image (ORB/ECC).
    """

    def __init__(self, max_delay: int = 30):
        self._buf: deque = deque(maxlen=max_delay)

    def push(self, frame_id: int, frame: np.ndarray) -> None:
        self._buf.append((frame_id, frame))

    def get(self, frame_id: int) -> np.ndarray | None:
        """Retourne la frame correspondant à frame_id, ou None."""
        for fid, frm in reversed(self._buf):
            if fid == frame_id:
                return frm
        return None


class LdvBuffer:
    """
    Buffer circulaire des LDV (Ligne De Visée) des dernières `max_delay` frames.

    Permet de retrouver la LDV au moment du clic pour la reprojection
    inertielle du clic via compensator.build_homography(ldv_click, ldv_current).
    Prioritaire sur la reprojection image (ORB/ECC) : aucun traitement pixel,
    uniquement les données d'orientation caméra.
    """

    def __init__(self, max_delay: int = 30):
        self._buf: deque = deque(maxlen=max_delay)

    def push(self, frame_id: int, ldv) -> None:
        """
        Enregistre la LDV pour frame_id.
        Ignoré si ldv is None (LDV indisponible pour ce bloc).
        """
        if ldv is not None:
            self._buf.append((frame_id, ldv))

    def get(self, frame_id: int):
        """
        Retourne la LDV correspondant à frame_id, ou None si absente.

        Parameters
        ########
        frame_id : int

        Returns
        ######
        ldv : (az_deg, el_deg, roulis_deg) ou None
        """
        for fid, ldv in reversed(self._buf):
            if fid == frame_id:
                return ldv
        return None


def _frame_to_uint8(img: np.ndarray) -> np.ndarray:
    """Normalize any frame dtype to uint8 [0,255]."""
    img = img.astype(np.float32)
    lo, hi = img.min(), img.max()
    if hi > lo:
        img = (img - lo) / (hi - lo) * 255.0
    return img.clip(0, 255).astype(np.uint8)


def _compute_image_homography(
    frame_prev: np.ndarray,
    frame_cur: np.ndarray,
    method: str = "orb",
    min_inliers: int = 10,
) -> np.ndarray | None:
    """Compute H between two consecutive frames using ORB or ECC features."""
    if cv2 is None:
        log.warning("OpenCV required for image-based homography")
        return None

    prev_u8 = _frame_to_uint8(frame_prev)
    cur_u8 = _frame_to_uint8(frame_cur)

    if prev_u8.ndim == 3:
        prev_gray = cv2.cvtColor(prev_u8, cv2.COLOR_BGR2GRAY)
        cur_gray = cv2.cvtColor(cur_u8, cv2.COLOR_BGR2GRAY)
    else:
        prev_gray = prev_u8
        cur_gray = cur_u8

    H = None

    if method == "orb":
        orb = cv2.ORB_create(nfeatures=500)
        kp1, des1 = orb.detectAndCompute(prev_gray, None)
        kp2, des2 = orb.detectAndCompute(cur_gray, None)

        if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
            log.debug("_compute_image_homography: not enough ORB keypoints")
            return None

        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des1, des2)
        matches = sorted(matches, key=lambda m: m.distance)

        if len(matches) < min_inliers:
            log.debug(
                "_compute_image_homography: only %d matches (need %d)", len(matches), min_inliers
            )
            return None

        pts1 = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        pts2 = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(pts1, pts2, cv2.RANSAC, 5.0)
        n_inliers = int(mask.sum()) if mask is not None else 0

        if H is None or n_inliers < min_inliers:
            log.debug("_compute_image_homography: ORB homography degraded (inliers=%d)", n_inliers)
            return None

    elif method == "ecc":
        warp_matrix = np.eye(3, 3, dtype=np.float32)
        try:
            _, H = cv2.findTransformECC(
                prev_gray.astype(np.float32),
                cur_gray.astype(np.float32),
                warp_matrix,
                cv2.MOTION_HOMOGRAPHY,
            )
        except cv2.error as exc:
            log.debug("_compute_image_homography: ECC failed (%s)", exc)
            return None
    else:
        log.warning("_compute_image_homography: unknown method '%s'", method)
        return None

    return H


def reproject_click(
    frame_ref: np.ndarray,
    frame_current: np.ndarray,
    point: tuple,
    method: str = "orb",
    min_inliers: int = 10,
) -> tuple:
    """
    Reprojecte un point de frame_ref vers frame_current.

    Parameters
    ########
    frame_ref     : frame au moment du clic (frame_click)
    frame_current : frame courante (frame_emit + traitement)
    point         : (x, y) dans frame_ref
    method        : "orb" | "ecc"
    min_inliers   : seuil qualité homographie RANSAC

    Returns
    ######
    (x', y') dans frame_current
    """
    if cv2 is None:
        log.error("OpenCV required for click reprojection")
        return point

    ref_u8 = _frame_to_uint8(frame_ref)
    cur_u8 = _frame_to_uint8(frame_current)

    if ref_u8.ndim == 3:
        ref_gray = cv2.cvtColor(ref_u8, cv2.COLOR_BGR2GRAY)
        cur_gray = cv2.cvtColor(cur_u8, cv2.COLOR_BGR2GRAY)
    else:
        ref_gray = ref_u8
        cur_gray = cur_u8

    H = None

    if method == "orb":
        orb = cv2.ORB_create(nfeatures=500)
        kp1, des1 = orb.detectAndCompute(ref_gray, None)
        kp2, des2 = orb.detectAndCompute(cur_gray, None)

        if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
            log.warning("reproject_click: not enough ORB keypoints -> raw coords")
            return point

        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des1, des2)
        matches = sorted(matches, key=lambda m: m.distance)

        if len(matches) < min_inliers:
            log.warning(
                "reproject_click: %d matches < threshold %d -> raw coords",
                len(matches),
                min_inliers,
            )
            return point

        pts1 = np.float32([kp1[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
        pts2 = np.float32([kp2[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
        H, mask = cv2.findHomography(pts1, pts2, cv2.RANSAC, 5.0)
        n_inliers = int(mask.sum()) if mask is not None else 0

        if H is None or n_inliers < min_inliers:
            log.warning(
                "reproject_click: ORB homography degraded (inliers=%d) -> fallback", n_inliers
            )
            return point

    elif method == "ecc":
        warp_matrix = np.eye(3, 3, dtype=np.float32)
        try:
            _, H = cv2.findTransformECC(
                ref_gray.astype(np.float32),
                cur_gray.astype(np.float32),
                warp_matrix,
                cv2.MOTION_HOMOGRAPHY,
            )
        except cv2.error as e:
            log.warning("reproject_click: ECC failed (%s) -> fallback", e)
            return point
    else:
        raise ValueError(f"Unknown method: {method!r} (expected 'orb' or 'ecc')")

    px = np.float32([[list(point)]]).reshape(-1, 1, 2)
    dst = cv2.perspectiveTransform(px, H)
    xp, yp = float(dst[0, 0, 0]), float(dst[0, 0, 1])
    log.debug("reproject_click: (%d,%d) -> (%.1f,%.1f)", point[0], point[1], xp, yp)
    return (xp, yp)
