"""
trackers/mot/custom_kalman/kalman_filter.py
-------------------------------------------
Filtre de Kalman 2D pour le suivi d'un objet ponctuel.

Methode B - Camera Update (CMC interne) :
  L'etat Kalman est TOUJOURS exprime dans la frame courante (frame_i).
  La compensation ego-motion est appliquee sur l'ETAT avant la prediction
  via l'homographie H = K·R·K^-1 (LDV ou ORB/ECC).

  Cycle par frame :
    1. camera_update(H)  : x <- H @ x      (warp etat dans frame_i AVANT prediction)
    2. predict()         : x_pred = F @ x  (prediction cinematique dans frame_i)
    3. associate()       : IoU entre x_pred et detections YOLO brutes  <- meme repere
    4. update(u, v)      : correction Kalman dans frame_i

  Avantages vs Methode A (compensation externe des detections) :
    - Zero drift : H applique une seule fois par frame sur l'etat, pas cumule
    - Mesures YOLO passees brutes (pas de decalage artificiel)
    - IoU directement comparable sans H^-1
    - Coherent avec l'approche BoostTrack/BoT-SORT/ByteTrack (Methode B)

Etat : x = [u, v, du, dv]^T
  - (u, v)   : centre de la bbox dans la frame courante (pixels)
  - (du, dv) : vitesse pixel par frame (dans frame_i apres warp)

Observation : z = [u, v]^T  (centre YOLO brut, meme repere)

Modele mouvement constant (vitesse uniforme).
"""

import numpy as np


class KalmanFilter2D:
    """
    Filtre de Kalman 2D (position + vitesse).

    Parameters
    ########
    process_noise  : float  bruit de processus (accélération inconnue)
    measure_noise  : float  bruit de mesure (incertitude de la détection)
    dt             : float  intervalle de temps entre frames (en frames, = 1)
    """

    def __init__(
        self,
        process_noise: float = 1.0,
        measure_noise: float = 5.0,
        dt: float = 1.0,
    ):
        self.dt = dt

        ### Matrices du filtre ################################################

        # Matrice de transition F  (mouvement à vitesse constante)
        self.F = np.array(
            [
                [1, 0, dt, 0],
                [0, 1, 0, dt],
                [0, 0, 1, 0],
                [0, 0, 0, 1],
            ],
            dtype=np.float64,
        )

        # Matrice d'observation H  (on mesure seulement (u, v))
        self.H = np.array(
            [
                [1, 0, 0, 0],
                [0, 1, 0, 0],
            ],
            dtype=np.float64,
        )

        # Bruit de processus Q
        q = process_noise
        self.Q = np.diag([q, q, q * 4, q * 4]).astype(np.float64)

        # Bruit de mesure R
        r = measure_noise
        self.R = np.diag([r, r]).astype(np.float64)

        # État initial (sera surchargé par init())
        self.x = np.zeros((4, 1), dtype=np.float64)  # [u, v, du, dv]
        self.P = np.eye(4, dtype=np.float64) * 100.0  # covariance initiale large

    ### Initialisation ########################################################

    def init(self, u: float, v: float, du: float = 0.0, dv: float = 0.0):
        """Initialise l'état à partir d'une première observation."""
        self.x = np.array([[u], [v], [du], [dv]], dtype=np.float64)
        self.P = np.eye(4, dtype=np.float64) * 100.0

    ### Prédiction ############################################################

    def predict(self) -> np.ndarray:
        """
        Etape de prediction (mouvement constant, dans frame_i).

        Appeler APRES camera_update(H) pour que l'etat soit deja dans frame_i.
        Resultat : x_pred = F @ (H @ x_prev).

        Returns
        ######
        x_pred : np.ndarray (4,)  etat predit [u, v, du, dv]
        """
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.x.flatten()

    def camera_update(self, H: np.ndarray) -> None:
        """
        Deforme l'etat courant par l'homographie H.

        A appeler AVANT predict().
        H mappe frame_{i-1} -> frame_i (H = K·R·K^-1 depuis LDV ou ORB/ECC).

        Apres cet appel, l'etat [u, v, du, dv] est exprime dans frame_i.
        predict() appliquera F dans ce repere : x_pred = F @ (H @ x_prev).
        Les mesures YOLO sont egalement dans frame_i -> meme repere,
        association IoU directe, zero drift.

        Propagation de la covariance via le Jacobien analytique de H :
          J_2x2 = d(u',v')/d(u,v) = 1/w * [[h00-u'*h20, h01-u'*h21],
                                              [h10-v'*h20, h11-v'*h21]]
          J4x4 = diag(J, J)  (position et vitesse se transforment identiquement)
          P' = J4 @ P @ J4^T

        Parameters
        ########
        H : np.ndarray (3, 3)
            Homographie frame_{i-1} -> frame_i.
            Si None, la methode retourne immediatement (no-op).
        """
        if H is None:
            return

        u_p = float(self.x[0, 0])
        v_p = float(self.x[1, 0])
        du_p = float(self.x[2, 0])
        dv_p = float(self.x[3, 0])

        # Denominateur de la projection perspective
        w = H[2, 0] * u_p + H[2, 1] * v_p + H[2, 2]
        if abs(w) < 1e-8:
            return  # Degenere - etat inchange

        # Position projetee dans frame_i
        u_w = (H[0, 0] * u_p + H[0, 1] * v_p + H[0, 2]) / w
        v_w = (H[1, 0] * u_p + H[1, 1] * v_p + H[1, 2]) / w

        # Jacobien analytique J = d(u',v')/d(u,v) au point (u_p, v_p)
        # J = 1/w * [[h00 - u'*h20,  h01 - u'*h21],
        #             [h10 - v'*h20,  h11 - v'*h21]]
        J = np.array(
            [
                [(H[0, 0] - u_w * H[2, 0]) / w, (H[0, 1] - u_w * H[2, 1]) / w],
                [(H[1, 0] - v_w * H[2, 0]) / w, (H[1, 1] - v_w * H[2, 1]) / w],
            ],
            dtype=np.float64,
        )

        # Vitesse projetee (approximation lineaire via Jacobien)
        vel = J @ np.array([du_p, dv_p], dtype=np.float64)

        # Mise a jour de l'etat
        self.x[0, 0] = u_w
        self.x[1, 0] = v_w
        self.x[2, 0] = vel[0]
        self.x[3, 0] = vel[1]

        # Propagation de la covariance :  P' = J4 @ P @ J4^T
        # J4 = diag(J_2x2, J_2x2)
        J4 = np.zeros((4, 4), dtype=np.float64)
        J4[:2, :2] = J
        J4[2:, 2:] = J
        self.P = J4 @ self.P @ J4.T

    ### Mise a jour ###########################################################

    def update(self, u: float, v: float) -> np.ndarray:
        """
        Étape de mise à jour avec une mesure (u, v).

        Returns
        ######
        x_updated : np.ndarray (4,)  état mis à jour [u, v, du, dv]
        """
        z = np.array([[u], [v]], dtype=np.float64)

        # Innovation
        y = z - self.H @ self.x

        # Gain de Kalman
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)

        # Mise à jour état et covariance
        self.x = self.x + K @ y
        I_KH = np.eye(4) - K @ self.H
        self.P = I_KH @ self.P

        return self.x.flatten()

    ### Accesseurs ############################################################

    @property
    def position(self) -> tuple:
        """Retourne (u, v) de l'état courant."""
        return float(self.x[0, 0]), float(self.x[1, 0])

    @property
    def velocity(self) -> tuple:
        """Retourne (du, dv) de l'état courant."""
        return float(self.x[2, 0]), float(self.x[3, 0])

    def mahalanobis(self, u: float, v: float) -> float:
        """
        Distance de Mahalanobis entre la mesure (u,v) et l'état prédit.
        Utile pour le gate de l'association.
        """
        z = np.array([[u], [v]], dtype=np.float64)
        y = z - self.H @ self.x
        S = self.H @ self.P @ self.H.T + self.R
        return float((y.T @ np.linalg.inv(S) @ y)[0, 0])
