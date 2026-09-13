# Tracker SOT : CSRT (Channel and Spatial Reliability Tracking)

## Section 1 : Principe

CSRT (Lukezic et al., CVPR 2017) est un tracker par filtre de correlation discriminant (DCF)
integre dans OpenCV. Il etend les trackers DCF classiques par deux mecanismes complementaires :
la **fiabilite de canal** (ponderation adaptive des canaux HOG/intensite selon leur discrimination)
et la **fiabilite spatiale** (masque foreground/background qui focalise le filtre sur les parties
discriminantes de la cible). La detection se fait par correlation dans le domaine frequentiel (FFT).
La qualite du suivi est evaluee par le PSR (Peak-to-Sidelobe Ratio).

**Limites importantes** :

- **Ratio fixe** : CSRT utilise DSST (Discriminative Scale Space Tracker) pour le multi-scale.
  DSST recherche un facteur scalaire unique `s` applique a la taille initiale `(w0, h0)`.
  Resultat : `(s*w0, s*h0)`. Le ratio largeur/hauteur est toujours constant. Si la cible change
  de forme (rectangle -> carre), la bbox CSRT ne peut pas s'adapter. Seul le zoom/dezoom est gere.

- **PSR indisponible dans certains builds** : `TrackerCSRT.getScore()` n'est pas expose dans les
  wheels pip standard d'opencv-contrib-python. L'appel echoue silencieusement (AttributeError),
  le PSR vaut alors `None` et le seuil `psr_threshold` est inactif.

- **`padding` n'est pas une contrainte spatiale** : le parametre `padding` controle uniquement
  la TAILLE du patch extrait pour calculer le filtre DCF (template de `padding * bbox_size`).
  Ce n'est PAS une cage empechant le resultat de sortir. La correlation FFT calcule un map de
  reponse sur tout le patch ; le pic peut etre n'importe ou dans celui-ci.

- **Drift interne OpenCV apres perte + fausse recuperation au coin** : quand `tracker.update()`
  retourne `False`, OpenCV CSRT met quand meme a jour son etat interne avec la position du pic
  FFT trouve (meme de faible PSR). Sur le frame suivant il cherche depuis cette position driftee.
  Si le patch de recherche touche un bord de frame, les effets de bord FFT (BORDER_REPLICATE)
  produisent un pic parasite au coin (0,0). CSRT retourne alors `True` avec bbox `[0,0,~20,~12]`,
  remet le compteur de miss a 0 et corrompt le Kalman.

- **Pas de CMC par warp de frame** : OpenCV TrackerCSRT n'expose aucune API pour deplacer la
  fenetre de recherche interne sans reinitialisation complete (qui remet a zero le template DCF).
  Warper le frame entier et recentrer manuellement cree un decalage de systeme de coordonnees
  inter-frames qui ne peut pas etre annule proprement a la sortie. Le H est transmis uniquement
  au Kalman pour la prediction cinematique.

- **CPU uniquement**, aucune dependance GPU.

---

## Section 2 : Parametres YAML

Section `csrt:` dans le YAML.

| Parametre               | Type    | Defaut       | Plage        | Effet |
|-------------------------|---------|--------------|--------------|-------|
| `psr_threshold`         | float   | 6.0          | 3.0-15.0     | PSR minimum pour accepter le suivi. Souvent inactif (PSR=N/A, cf. section 1). |
| `min_width_px`          | int     | 10           | 1-100        | Largeur minimale bbox (px). |
| `min_height_px`         | int     | 10           | 1-100        | Hauteur minimale bbox (px). |
| `kf_process_noise`      | float/null | (sot_kalman) | 1-100 | Bruit Q Kalman. null = Kalman desactive. Herite de sot_kalman: si absent. |
| `kf_measure_noise`      | float/null | (sot_kalman) | 0.1-50 | Bruit R Kalman. null = Kalman desactive. |
| `fallback_bbox_size_px` | int     | 40           | 10-200       | Cote (px) du carre de fallback si aucune track MOT proche du clic. |
| `padding`               | float   | 3.0          | 1.5-6.0      | Taille du patch DCF = padding * bbox_size. Augmenter pour cibles rapides. |
| `filter_lr`             | float   | 0.02         | 0.005-0.1    | Taux d'apprentissage DCF. 0.02 recommande pour IR stable. |
| `admm_iterations`       | int     | 4            | 2-8          | Iterations solveur ADMM. |
| `number_of_scales`      | int     | 33           | 0-63         | Niveaux DSST. 0/1 = pas de multi-scale. |
| `scale_step`            | float   | 1.05         | 1.02-1.15    | Ratio entre echelles consecutives DSST. |
| `template_size`         | int     | 200          | 64-400       | Cote (px) du patch normalise pour features. |
| `use_channel_weights`   | bool    | true         | true/false   | CSRT complet vs DCF poids egaux. |
| `use_segmentation`      | bool    | false        | true/false   | Masque fond/cible. +5-15 ms/frame. Desactive par defaut (IR). |

Section `sot_kalman:` (partagee avec Tracking_TOPHAT) :

| Parametre           | Type       | Defaut | Role |
|---------------------|------------|--------|------|
| `kf_process_noise`  | float/null | 10.0   | Bruit Q Kalman cinematique. null = desactive. |
| `kf_measure_noise`  | float/null | 5.0    | Bruit R Kalman. null = desactive. |

---

## Section 3 : Inputs / Outputs du workflow

**Entrees**

| Entree       | Type                     | Description |
|--------------|--------------------------|-------------|
| `frame`      | `ndarray (H, W)`         | Frame courante IR (uint16 ou uint8, converti en BGR uint8) |
| `click_pos`  | `(x, y)`                 | Position du clic operateur (init uniquement) |
| `mot_tracks` | `list[Track]` ou `None`  | Tracks MOT pour trouver la bbox au clic |
| `H`          | `ndarray (3,3)` ou `None`| Homographie frame_{i-1}->frame_i (passe au Kalman uniquement) |

**Sorties de `update()`**

| Sortie   | Type                         | Description |
|----------|------------------------------|-------------|
| `ok`     | `bool`                       | True si suivi valide |
| `bbox`   | `[x1,y1,x2,y2]` ou `None`   | Position cible dans frame_i |
| `mask`   | `None`                       | Toujours None |

---

## Section 4 : Integration dans le pipeline

**Flux d'init** :
1. Clic operateur -> state machine appelle `csrt_sot.init(frame, click_pos, mot_tracks)`.
2. `_find_bbox()` : track contenant le clic > track plus proche < fallback carre.
3. `cv2.TrackerCSRT_create()` initialise avec parametres YAML.
4. Kalman `KalmanFilter2D.init(cx, cy)` si actif.
5. Premier `update()` retourne bbox d'init directement (bug OpenCV init/update meme-frame).

**Flux d'update** (chaque frame en mode SOT) :
1. `cam_shift = warp_shift(H, last_cx, last_cy)` -- deplacement camera en px (log uniquement).
2. Kalman : `camera_update(H)` + `predict()` -> (cx_pred, cy_pred).
3. `ok, roi = cv2_tracker.update(frame)`.
4. Si ok=False : log PSR et cam_shift, ecrit frame debug video, `return False`.
5. Clip bords + filtres taille min + PSR.
6. Kalman `update(cx_csrt, cy_csrt)`.
7. Mise a jour `last_cx, last_cy, last_w, last_h`.

**Source du H pour CSRT** :
H est transmis au Kalman `camera_update(H)` pour corriger la prediction cinematique du
deplacement camera. Il n'est pas utilise pour warper le frame.

**Debug video** : `csrt_kalman_box_visu: true` produit `csrt_kalman_debug.mp4` -- vue
unique du frame courant avec search zone, derniere bbox (gris), prediction Kalman (cyan),
detection CSRT (vert). Le frame de perte (ok=False) est inclus avec zone de recherche visible.

**Echec SOT** : si ok=False, session.py incremente `sot_miss`. Apres `sot_loss_threshold`
echecs consecutifs -> retour MOT ou IDLE.

---

## Section 5 : Conseils de reglage

**Cible IR pointiforme (drone 5-15 px)** :
- `padding: 3.0-4.0` : zone de recherche suffisante.
- `fallback_bbox_size_px: 20-30`.
- `psr_threshold: 4.0-5.0` (souvent N/A, cf. section 1).

**Cible petite + camera tres mobile** :
- Verifier dans les logs : `cam_shift=XX px`. Si cam_shift > search_radius systematiquement,
  la cible sort de la zone de recherche CSRT entre deux frames -> pertes frequentes.
  Augmenter `padding` pour agrandir le search_radius.
- `filter_lr: 0.01` : modele plus stable.

**Cible plus grande (vehicule 30-80 px)** :
- `psr_threshold: 6.0-8.0`.
- `use_segmentation: true` si contours nets en IR.
- `padding: 2.5`.
- `number_of_scales: 33`.

**Occultations frequentes** :
- `filter_lr: 0.01` : memoire plus longue.
- `psr_threshold: 4.0`.
- Augmenter `sot_loss_threshold` pour tolerer plus de frames d'echec.

**Kalman desactive** :
- `kf_process_noise: null` ou `kf_measure_noise: null` dans `sot_kalman:`.
- Sans Kalman : pas de pred (cx_pred, cy_pred) dans la debug video.
