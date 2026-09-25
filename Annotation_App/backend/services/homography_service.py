# ============================================================
# services/homography_service.py
# Service de calcul et de propagation d'homographie pour la stabilisation
# de boîtes englobantes entre frames consécutives.
#
# Stratégie :
#   1. Tentative avec XFeat (GPU, rapide, robuste)
#   2. Fallback SIFT + RANSAC (CPU, plus lent mais universel)
#   3. Si l'homographie est de mauvaise qualité (peu d'inliers) → retourne None
#
# L'homographie modélise la transformation de la CAMÉRA (mouvement global),
# pas le mouvement des objets. Elle compense les déplacements de caméra pour
# maintenir les boîtes sur les objets statiques ou quasi-statiques.
# ============================================================

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


class HomographyService:
    """
    Service de propagation d'annotations par homographie.
    Utilise XFeat (si disponible) ou SIFT+RANSAC pour estimer
    la transformation entre deux frames.
    """

    def __init__(self):
        self._xfeat_model = None
        self._use_xfeat = False
        self._try_load_xfeat()

        # Paramètres SIFT
        self._sift = cv2.SIFT_create(nfeatures=2000, contrastThreshold=0.04)
        self._bf_matcher = cv2.BFMatcher(cv2.NORM_L2)

        # Seuils de qualité pour considérer l'homographie valide
        self.min_inlier_ratio = 0.5          # ratio minimum d'inliers (50%)
        self.min_inlier_count = 30           # nombre absolu minimum d'inliers
        self.ransac_reproj_threshold = 3.0   # pixels (plus strict = homographie plus précise)

        # Paramètres XFeat (ignorés en mode SIFT)
        self.xfeat_top_k = 4096             # nombre de keypoints détectés par image
        self.xfeat_min_cossim = 0.82        # similarité cosinus minimum pour un match valide

        print(f"[HomographyService] Initialisé — XFeat: {self._use_xfeat}, dispositif: {DEVICE}")

    def _try_load_xfeat(self) -> None:
        """
        Tente de charger XFeat depuis le dossier local.
        XFeat est installé via clone git dans le projet car pas de pip package.
        """
        # XFeat cloné dans backend/models/xfeat/ (pas un package PyPI)
        xfeat_path = Path(__file__).parent.parent / "models" / "xfeat"
        if not xfeat_path.exists():
            print("[HomographyService] XFeat non trouvé — utilisation de SIFT+RANSAC")
            return

        try:
            import sys
            sys.path.insert(0, str(xfeat_path))
            from modules.xfeat import XFeat
            self._xfeat_model = XFeat()
            self._use_xfeat = True
            print("[HomographyService] XFeat chargé avec succès")
        except Exception as e:
            print(f"[HomographyService] XFeat non disponible : {e} — utilisation SIFT+RANSAC")
            self._use_xfeat = False

    def compute_homography(
        self,
        frame_a: np.ndarray,  # Image source (BGR, uint8)
        frame_b: np.ndarray,  # Image cible (BGR, uint8)
        min_matches: int = 10,
        min_inlier_count: Optional[int] = None,
        min_inlier_ratio: Optional[float] = None,
        ransac_threshold: Optional[float] = None,
        xfeat_top_k: Optional[int] = None,
        xfeat_min_cossim: Optional[float] = None,
    ) -> Tuple[Optional[np.ndarray], float, dict]:
        """
        Calcule la matrice d'homographie 3×3 qui transforme frame_a en frame_b.
        Tous les paramètres optionnels ont un fallback sur les attributs de l'instance.

        Returns:
            Tuple (H_matrix, inlier_ratio, stats) où :
              - H_matrix est None si échec
              - stats = {"keypoints": int, "matches": int, "inliers": int}
        """
        eff_min_count   = min_inlier_count  if min_inlier_count  is not None else self.min_inlier_count
        eff_min_ratio   = min_inlier_ratio  if min_inlier_ratio  is not None else self.min_inlier_ratio
        eff_ransac      = ransac_threshold  if ransac_threshold  is not None else self.ransac_reproj_threshold
        eff_top_k       = xfeat_top_k       if xfeat_top_k       is not None else self.xfeat_top_k
        eff_min_cossim  = xfeat_min_cossim  if xfeat_min_cossim  is not None else self.xfeat_min_cossim

        if self._use_xfeat:
            H_matrix, inlier_ratio, inlier_count, stats = self._xfeat_homography(
                frame_a, frame_b, min_matches, eff_ransac, eff_top_k, eff_min_cossim
            )
        else:
            H_matrix, inlier_ratio, inlier_count, stats = self._sift_ransac_homography(
                frame_a, frame_b, min_matches, eff_ransac
            )

        if H_matrix is None:
            return None, inlier_ratio, stats

        # Double vérification : ratio ET nombre absolu d'inliers
        if inlier_ratio < eff_min_ratio:
            print(f"[HomographyService] Homographie rejetee — inlier_ratio={inlier_ratio:.2f} < {eff_min_ratio}")
            return None, inlier_ratio, stats
        if inlier_count < eff_min_count:
            print(f"[HomographyService] Homographie rejetee — inliers={inlier_count} < {eff_min_count}")
            return None, inlier_ratio, stats

        return H_matrix, inlier_ratio, stats

    def _xfeat_homography(
        self,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        min_matches: int,
        ransac_threshold: float,
        top_k: int,
        min_cossim: float,
    ) -> Tuple[Optional[np.ndarray], float, int, dict]:
        """
        Calcule l'homographie avec XFeat (descripteurs accélérés GPU).
        Retourne (H, inlier_ratio, inlier_count, stats).
        """
        _empty_stats: dict = {"keypoints": 0, "matches": 0, "inliers": 0}
        try:
            rgb_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2RGB)
            rgb_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2RGB)

            mkpts_a, mkpts_b = self._xfeat_model.match_xfeat(
                rgb_a, rgb_b,
                top_k=top_k,
                min_cossim=min_cossim,
            )

            n_matches = len(mkpts_a)
            stats: dict = {"keypoints": top_k, "matches": n_matches, "inliers": 0}

            if n_matches < min_matches:
                return None, 0.0, 0, stats

            pts_a = mkpts_a.cpu().numpy() if isinstance(mkpts_a, torch.Tensor) else np.asarray(mkpts_a, dtype=np.float32)
            pts_b = mkpts_b.cpu().numpy() if isinstance(mkpts_b, torch.Tensor) else np.asarray(mkpts_b, dtype=np.float32)

            H, mask = cv2.findHomography(
                pts_a, pts_b,
                cv2.RANSAC, ransac_threshold,
                confidence=0.999, maxIters=2000,
            )

            if H is None or mask is None:
                return None, 0.0, 0, stats

            inlier_count = int(mask.sum())
            inlier_ratio = inlier_count / len(mask)
            stats["inliers"] = inlier_count
            return H, float(inlier_ratio), inlier_count, stats

        except Exception as e:
            print(f"[HomographyService] Erreur XFeat : {e} — fallback SIFT")
            return self._sift_ransac_homography(frame_a, frame_b, min_matches, ransac_threshold)

    def _sift_ransac_homography(
        self,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        min_matches: int,
        ransac_threshold: float,
    ) -> Tuple[Optional[np.ndarray], float, int, dict]:
        """
        Calcule l'homographie avec SIFT + RANSAC.
        Retourne (H, inlier_ratio, inlier_count, stats).
        """
        gray_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)

        kp_a, desc_a = self._sift.detectAndCompute(gray_a, None)
        kp_b, desc_b = self._sift.detectAndCompute(gray_b, None)

        n_kp = len(kp_a) if kp_a else 0
        stats: dict = {"keypoints": n_kp, "matches": 0, "inliers": 0}

        if desc_a is None or desc_b is None or n_kp < min_matches:
            return None, 0.0, 0, stats

        raw_matches = self._bf_matcher.knnMatch(desc_a, desc_b, k=2)
        good_matches = []
        for match_pair in raw_matches:
            if len(match_pair) == 2:
                m, n = match_pair
                if m.distance < 0.7 * n.distance:
                    good_matches.append(m)

        stats["matches"] = len(good_matches)

        if len(good_matches) < min_matches:
            return None, 0.0, 0, stats

        pts_a = np.float32([kp_a[m.queryIdx].pt for m in good_matches])
        pts_b = np.float32([kp_b[m.trainIdx].pt for m in good_matches])

        H, mask = cv2.findHomography(
            pts_a, pts_b,
            cv2.RANSAC, ransac_threshold,
            confidence=0.999, maxIters=2000,
        )

        if H is None or mask is None:
            return None, 0.0, 0, stats

        inlier_count = int(mask.sum())
        inlier_ratio = float(inlier_count) / len(mask)
        stats["inliers"] = inlier_count
        return H, inlier_ratio, inlier_count, stats

    def warp_bbox_yolo(
        self,
        bbox_yolo: Tuple[float, float, float, float],
        H: np.ndarray,
        src_width: int,
        src_height: int,
        dst_width: int,
        dst_height: int,
    ) -> Optional[Tuple[float, float, float, float]]:
        """
        Applique la transformation homographique à une boîte YOLO.
        Projette les 4 coins de la bbox et calcule la nouvelle bbox englobante.

        Args:
            bbox_yolo: (cx, cy, w, h) normalisé dans [0, 1]
            H: Matrice d'homographie 3×3
            src_width, src_height: Dimensions de l'image source
            dst_width, dst_height: Dimensions de l'image cible

        Returns:
            Nouvelle bbox YOLO normalisée, ou None si hors cadre > 70%
        """
        cx, cy, w, h = bbox_yolo

        # Conversion YOLO → coins en pixels (source)
        x1 = (cx - w / 2) * src_width
        y1 = (cy - h / 2) * src_height
        x2 = (cx + w / 2) * src_width
        y2 = (cy + h / 2) * src_height

        # 4 coins de la bbox
        corners = np.array([
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
        ], dtype=np.float32)

        # Application de l'homographie aux 4 coins
        corners_h = np.column_stack([corners, np.ones(4)])  # Coordonnées homogènes
        transformed = (H @ corners_h.T).T

        # Division par la coordonnée homogène w (normalisation projectile)
        transformed /= transformed[:, 2:3]
        px = transformed[:, 0]
        py = transformed[:, 1]

        # Nouvelle bbox englobante
        new_x1, new_x2 = px.min(), px.max()
        new_y1, new_y2 = py.min(), py.max()

        # Vérification : la bbox doit rester majoritairement dans l'image
        clip_x1 = max(0, new_x1)
        clip_y1 = max(0, new_y1)
        clip_x2 = min(dst_width, new_x2)
        clip_y2 = min(dst_height, new_y2)

        original_area = (new_x2 - new_x1) * (new_y2 - new_y1)
        clipped_area = max(0, clip_x2 - clip_x1) * max(0, clip_y2 - clip_y1)

        # Rejeter si plus de 70% de la bbox est hors cadre
        if original_area > 0 and clipped_area / original_area < 0.3:
            return None

        # Conversion en YOLO normalisé
        new_cx = (clip_x1 + clip_x2) / 2 / dst_width
        new_cy = (clip_y1 + clip_y2) / 2 / dst_height
        new_w = (clip_x2 - clip_x1) / dst_width
        new_h = (clip_y2 - clip_y1) / dst_height

        # Clamp dans [0, 1]
        new_cx = max(0.0, min(1.0, new_cx))
        new_cy = max(0.0, min(1.0, new_cy))
        new_w = max(0.001, min(1.0, new_w))
        new_h = max(0.001, min(1.0, new_h))

        return (new_cx, new_cy, new_w, new_h)

    def track_bboxes_optical_flow(
        self,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        bboxes_yolo: List[Tuple[float, float, float, float]],
        src_width: int,
        src_height: int,
        win_size: int = 21,
        max_level: int = 3,
        min_tracked_pts: int = 4,
    ) -> List[Optional[Tuple[float, float, float, float]]]:
        """
        Suivi de boites par flux optique Lucas-Kanade (LK) avec adaptation de taille.

        Strategie en deux etapes :
          1. Tracker les 4 coins de la bbox + une grille 5x5 interieure (29 pts total)
             avec calcOpticalFlowPyrLK.
          2. Estimer une transformation affine partielle (translation + rotation + echelle)
             via estimateAffinePartial2D sur tous les points bien suivis, puis l'appliquer
             aux 4 coins originaux.
             => La nouvelle bbox est le rectangle englobant des coins transformes.
             => La taille change naturellement (zoom in/out, objet qui se rapproche).
          Fallback : si l'estimation affine echoue, translation mediane seule (taille fixe).

        Params :
          win_size       : taille de la fenetre LK en pixels (defaut 21)
          max_level      : niveaux de pyramide (defaut 3 — plus = capture grands deplacements)
          min_tracked_pts: minimum de points bien suivis pour valider (defaut 4)
        """
        gray_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)

        lk_params = dict(
            winSize=(win_size, win_size),
            maxLevel=max_level,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01),
        )

        results: List[Optional[Tuple[float, float, float, float]]] = []

        for bbox_yolo in bboxes_yolo:
            cx, cy, w, h = bbox_yolo
            x1 = (cx - w / 2) * src_width
            y1 = (cy - h / 2) * src_height
            x2 = (cx + w / 2) * src_width
            y2 = (cy + h / 2) * src_height

            # --- 4 coins explicites de la bbox ---
            corners = np.array([
                [x1, y1],
                [x2, y1],
                [x2, y2],
                [x1, y2],
            ], dtype=np.float32)

            # --- Grille 5x5 interieure (marges 15% pour rester dans la bbox) ---
            margin_x = (x2 - x1) * 0.15
            margin_y = (y2 - y1) * 0.15
            xs = np.linspace(x1 + margin_x, x2 - margin_x, 5)
            ys = np.linspace(y1 + margin_y, y2 - margin_y, 5)
            xx, yy = np.meshgrid(xs, ys)
            grid_pts = np.column_stack([xx.ravel(), yy.ravel()]).astype(np.float32)

            # Combiner coins + grille : 4 + 25 = 29 points
            all_pts = np.vstack([corners, grid_pts]).reshape(-1, 1, 2)

            pts_next, status, _ = cv2.calcOpticalFlowPyrLK(gray_a, gray_b, all_pts, None, **lk_params)

            good = (status.ravel() == 1)
            if good.sum() < min_tracked_pts:
                # Pas assez de points suivis -> bbox inchangee
                results.append(bbox_yolo)
                continue

            pts_src = all_pts[good].reshape(-1, 2)
            pts_dst = pts_next[good].reshape(-1, 2)

            # --- Estimation affine partielle (scale + rotation + translation) ---
            # Plus robuste que la mediane seule : capture les changements de taille
            M, inlier_mask = cv2.estimateAffinePartial2D(
                pts_src, pts_dst,
                method=cv2.RANSAC,
                ransacReprojThreshold=3.0,
            )

            if M is not None and inlier_mask is not None and int(inlier_mask.sum()) >= 2:
                # Appliquer la transformation affine aux 4 coins originaux
                corners_h = np.column_stack([corners, np.ones(4)])  # coords homogenes
                new_corners = (M @ corners_h.T).T  # (4, 2)
            else:
                # Fallback : translation mediane (taille inchangee)
                disp = pts_dst - pts_src
                dx = float(np.median(disp[:, 0]))
                dy = float(np.median(disp[:, 1]))
                new_corners = corners + np.array([[dx, dy]], dtype=np.float32)

            # Nouvelle bbox = rectangle englobant des coins transformes
            new_x1 = float(np.clip(new_corners[:, 0].min(), 0.0, src_width))
            new_y1 = float(np.clip(new_corners[:, 1].min(), 0.0, src_height))
            new_x2 = float(np.clip(new_corners[:, 0].max(), 0.0, src_width))
            new_y2 = float(np.clip(new_corners[:, 1].max(), 0.0, src_height))

            if new_x2 <= new_x1 or new_y2 <= new_y1:
                results.append(bbox_yolo)
                continue

            new_cx = (new_x1 + new_x2) / 2 / src_width
            new_cy = (new_y1 + new_y2) / 2 / src_height
            new_w  = (new_x2 - new_x1) / src_width
            new_h  = (new_y2 - new_y1) / src_height

            results.append((
                max(0.0, min(1.0, new_cx)),
                max(0.0, min(1.0, new_cy)),
                max(0.001, min(1.0, new_w)),
                max(0.001, min(1.0, new_h)),
            ))

        return results

    def compute_homography_debug(
        self,
        frame_a: np.ndarray,
        frame_b: np.ndarray,
        min_inlier_ratio: Optional[float] = None,
    ) -> dict:
        """
        Calcule l'homographie entre deux frames et retourne des informations de debug :
        methode utilisee, nombre de keypoints, matches, inliers, ratio d'inliers,
        et une visualisation des correspondances en base64 JPEG.
        """
        import base64

        eff_min_ratio = min_inlier_ratio if min_inlier_ratio is not None else self.min_inlier_ratio

        result: dict = {
            "method": "xfeat" if self._use_xfeat else "sift",
            "keypoints_a": 0,
            "keypoints_b": 0,
            "matches_total": 0,
            "matches_good": 0,
            "inliers": 0,
            "inlier_ratio": 0.0,
            "homography_valid": False,
            "visualization_b64": None,
        }

        try:
            if self._use_xfeat:
                rgb_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2RGB)
                rgb_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2RGB)
                mkpts_a, mkpts_b = self._xfeat_model.match_xfeat(
                    rgb_a, rgb_b,
                    top_k=self.xfeat_top_k,
                    min_cossim=self.xfeat_min_cossim,
                )

                result["keypoints_a"] = len(mkpts_a)
                result["keypoints_b"] = len(mkpts_b)
                result["matches_total"] = len(mkpts_a)
                result["matches_good"] = len(mkpts_a)

                if len(mkpts_a) >= 10:
                    # Conversion Tensor → numpy si nécessaire
                    dbg_pts_a = mkpts_a.cpu().numpy() if isinstance(mkpts_a, torch.Tensor) else np.asarray(mkpts_a, dtype=np.float32)
                    dbg_pts_b = mkpts_b.cpu().numpy() if isinstance(mkpts_b, torch.Tensor) else np.asarray(mkpts_b, dtype=np.float32)
                    H, mask = cv2.findHomography(
                        dbg_pts_a, dbg_pts_b,
                        cv2.RANSAC, self.ransac_reproj_threshold
                    )
                    if H is not None and mask is not None:
                        inliers = int(mask.sum())
                        result["inliers"] = inliers
                        result["inlier_ratio"] = round(float(inliers / len(mask)), 3)
                        result["homography_valid"] = result["inlier_ratio"] >= eff_min_ratio
                        vis = self._draw_keypoint_matches_debug(
                            frame_a, frame_b, dbg_pts_a, dbg_pts_b, mask
                        )
                        _, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 70])
                        result["visualization_b64"] = base64.b64encode(buf.tobytes()).decode()
            else:
                gray_a = cv2.cvtColor(frame_a, cv2.COLOR_BGR2GRAY)
                gray_b = cv2.cvtColor(frame_b, cv2.COLOR_BGR2GRAY)
                kp_a, desc_a = self._sift.detectAndCompute(gray_a, None)
                kp_b, desc_b = self._sift.detectAndCompute(gray_b, None)

                result["keypoints_a"] = len(kp_a)
                result["keypoints_b"] = len(kp_b)

                if desc_a is not None and desc_b is not None and len(kp_a) >= 10:
                    raw_matches = self._bf_matcher.knnMatch(desc_a, desc_b, k=2)
                    result["matches_total"] = len(raw_matches)

                    good_matches = []
                    for match_pair in raw_matches:
                        if len(match_pair) == 2:
                            m, n = match_pair
                            if m.distance < 0.75 * n.distance:
                                good_matches.append(m)
                    result["matches_good"] = len(good_matches)

                    if len(good_matches) >= 10:
                        pts_a = np.float32([kp_a[m.queryIdx].pt for m in good_matches])
                        pts_b = np.float32([kp_b[m.trainIdx].pt for m in good_matches])
                        H, mask = cv2.findHomography(pts_a, pts_b, cv2.RANSAC, self.ransac_reproj_threshold)
                        if H is not None and mask is not None:
                            inliers = int(mask.sum())
                            result["inliers"] = inliers
                            result["inlier_ratio"] = round(float(inliers / len(mask)), 3)
                            result["homography_valid"] = result["inlier_ratio"] >= eff_min_ratio
                            vis = self._draw_keypoint_matches_debug(frame_a, frame_b, pts_a, pts_b, mask)
                            _, buf = cv2.imencode(".jpg", vis, [cv2.IMWRITE_JPEG_QUALITY, 70])
                            result["visualization_b64"] = base64.b64encode(buf.tobytes()).decode()
        except Exception as e:
            result["error"] = str(e)

        return result

    def _draw_keypoint_matches_debug(
        self,
        img_a: np.ndarray,
        img_b: np.ndarray,
        pts_a: np.ndarray,
        pts_b: np.ndarray,
        mask: np.ndarray,
    ) -> np.ndarray:
        """
        Dessine les correspondances de keypoints entre deux images cote a cote.
        Inliers en vert, outliers en rouge (jusqu'a 200 correspondances affichees).
        """
        target_w = 400
        h_a, w_a = img_a.shape[:2]
        h_b, w_b = img_b.shape[:2]

        scale_a = target_w / w_a
        scale_b = target_w / w_b

        img_a_s = cv2.resize(img_a, (target_w, int(h_a * scale_a)))
        img_b_s = cv2.resize(img_b, (target_w, int(h_b * scale_b)))

        h_vis = max(img_a_s.shape[0], img_b_s.shape[0])

        if img_a_s.shape[0] < h_vis:
            pad = np.zeros((h_vis - img_a_s.shape[0], target_w, 3), dtype=np.uint8)
            img_a_s = np.vstack([img_a_s, pad])
        if img_b_s.shape[0] < h_vis:
            pad = np.zeros((h_vis - img_b_s.shape[0], target_w, 3), dtype=np.uint8)
            img_b_s = np.vstack([img_b_s, pad])

        vis = np.hstack([img_a_s, img_b_s])

        pts_a_s = pts_a * scale_a
        pts_b_s = pts_b * scale_b
        pts_b_s = pts_b_s.copy()
        pts_b_s[:, 0] += target_w

        inlier_mask = mask.ravel().astype(bool) if mask is not None else np.ones(len(pts_a_s), dtype=bool)
        n_draw = min(200, len(pts_a_s))

        for i in range(n_draw):
            pt_a = (int(pts_a_s[i][0]), int(pts_a_s[i][1]))
            pt_b = (int(pts_b_s[i][0]), int(pts_b_s[i][1]))
            color = (0, 200, 0) if inlier_mask[i] else (0, 0, 200)
            cv2.line(vis, pt_a, pt_b, color, 1)
            cv2.circle(vis, pt_a, 3, color, -1)
            cv2.circle(vis, pt_b, 3, color, -1)

        return vis

    def propagate_annotations_sequence(
        self,
        keyframe_annotations: List[Dict],  # [{cx, cy, width, height, class_id, ...}]
        frames: List[np.ndarray],           # Séquence d'images BGR
        keyframe_local_index: int,          # Indice de la keyframe dans 'frames'
        forward: bool = True,               # True = vers l'avant, False = vers l'arrière
    ) -> Dict[int, List[Dict]]:
        """
        Propage les annotations d'une keyframe sur une séquence de frames
        par application successive de l'homographie.

        Args:
            keyframe_annotations: Annotations de la frame de référence
            frames: Séquence d'images (BGR, numpy)
            keyframe_local_index: Position de la keyframe dans la liste
            forward: Direction de propagation

        Returns:
            Dict {frame_index_dans_sequence: [annotations_propagées]}
        """
        results: Dict[int, List[Dict]] = {keyframe_local_index: keyframe_annotations}

        if len(frames) < 2:
            return results

        # Propagation frame par frame
        current_annotations = keyframe_annotations.copy()
        indices = (
            range(keyframe_local_index, len(frames) - 1) if forward
            else range(keyframe_local_index, 0, -1)
        )

        for i in indices:
            next_i = i + 1 if forward else i - 1
            frame_a = frames[i]
            frame_b = frames[next_i]

            # Calcul de l'homographie entre les deux frames
            H, inlier_ratio = self.compute_homography(frame_a, frame_b)

            h, w = frame_a.shape[:2]
            next_annotations = []

            for ann in current_annotations:
                if H is not None:
                    # Propagation via homographie
                    new_bbox = self.warp_bbox_yolo(
                        bbox_yolo=(ann["cx"], ann["cy"], ann["width"], ann["height"]),
                        H=H,
                        src_width=w,
                        src_height=h,
                        dst_width=w,
                        dst_height=h,
                    )

                    if new_bbox is not None:
                        new_ann = ann.copy()
                        new_ann["cx"], new_ann["cy"] = new_bbox[0], new_bbox[1]
                        new_ann["width"], new_ann["height"] = new_bbox[2], new_bbox[3]
                        new_ann["is_interpolated"] = True
                        # Score composite : pondération confiance homographie
                        new_ann["confidence"] = float(ann.get("confidence", 1.0)) * (0.6 + 0.4 * inlier_ratio)
                        next_annotations.append(new_ann)
                else:
                    # Fallback : copier l'annotation sans transformation
                    new_ann = ann.copy()
                    new_ann["is_interpolated"] = True
                    new_ann["confidence"] = float(ann.get("confidence", 1.0)) * 0.5
                    next_annotations.append(new_ann)

            results[next_i] = next_annotations
            current_annotations = next_annotations

        return results


# Instance singleton partagée
homography_service = HomographyService()
