# Tracker SOT : DiMP (Discriminative Model Prediction)

## Section 1 : Principe

DiMP (Bhat et al., ICCV 2019) est un tracker par apprentissage profond qui optimise en ligne
un filtre discriminant CNN pendant le suivi, en quelques iterations de descente de gradient
differentiable. Il combine un extracteur de features ResNet (ResNet-18 ou ResNet-50 selon la
variante), un optimiseur de filtre en ligne, et un reseau IoUNet pour l'estimation precise de
la boite englobante. Le filtre apprend a distinguer la cible du fond specifiquement pour
la scene courante a chaque frame. Necessite GPU (~2 GB VRAM pour dimp50).
Fallback automatique sur CSRT si VRAM insuffisante ou repo pytracking absent.

---

## Section 2 : Parametres YAML

Section `dimp:` dans le YAML.

| Parametre   | Type   | Defaut    | Plage                  | Effet                                                         |
|-------------|--------|-----------|------------------------|---------------------------------------------------------------|
| `weights`   | str    | ""        | chemin .pth            | Chemin vers les poids pretrain DiMP. Vide = erreur explicite au demarrage. |
| `net_type`  | str    | "dimp50"  | "dimp18" / "dimp50"    | dimp18 : ResNet-18, plus rapide (~30 FPS GPU). dimp50 : ResNet-50, plus precis. |

Parametres internes (non exposes dans le YAML, definis dans les poids) :
- Nombre d'iterations de l'optimiseur en ligne (2-5 par frame).
- Learning rate de l'optimiseur.
- Taille de la fenetre de recherche.
- Seuil de confiance interne.

---

## Section 3 : Inputs / Outputs du workflow

**Entrees**

| Entree      | Type                     | Description                                                      |
|-------------|--------------------------|------------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`    | Frame courante (convertie en RGB pour pytracking)               |
| `click_pos` | `(x, y)`                 | Position du clic operateur (a l'init)                           |
| `mot_tracks`| `list[Track]` ou `None`  | Tracks MOT pour trouver la bbox la plus proche du clic (init)  |
| `H`         | non utilise par DiMP     | Transmis au fallback CSRT si actif                              |

**Sorties de `update()`**

| Sortie  | Type                       | Description                                                 |
|---------|----------------------------|-------------------------------------------------------------|
| `ok`    | `bool`                     | True si DiMP localise la cible avec score suffisant         |
| `bbox`  | `[x1,y1,x2,y2]` ou `None` | Position estimee par IoUNet                                 |
| `mask`  | `None`                     | Toujours None (DiMP ne produit pas de masque)               |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py`, via la state machine, apres un clic operateur.

**Flux d'init** :
1. Clic operateur -> `dimp_sot.init(frame, click_pos, mot_tracks)`.
2. `find_bbox_from_tracks()` (utilitaire `base_sot.py`) : track MOT contenant le clic > track la plus proche <= 300 px > boite par defaut 60x60 px.
3. Verification VRAM : si libre < `vram_threshold_gb` -> fallback CSRT.
4. Import pytracking (lazy, premier appel) : si echec -> fallback CSRT.
5. `PyTracker("dimp", "dimp50").initialize(frame, init_bbox)` : initialise le filtre en ligne.

**Flux d'update** :
1. Session.py appelle `dimp_sot.update(frame)`.
2. Si fallback actif : delegue a `_fallback.update()` (CSRT).
3. Sinon : `self._tracker.track(frame)` -> `out["target_bbox"]` au format (x, y, w, h).
4. Conversion en [x1, y1, x2, y2] et retour.

**Fallback CSRT** : actif si VRAM insuffisante OU si pytracking non installe. Le fallback est initialise avec les memes parametres (click_pos, mot_tracks). Transparent pour session.py.

**Note sur la CMC** : DiMP n'integre pas de CMC propre. H est transmis au fallback CSRT (qui lui integre un Kalman CMC). Si DiMP seul est actif, aucune compensation de mouvement camera n'est appliquee.

**Interaction state machine** : identique aux autres SOT. Echec -> sot_miss -> retour MOT ou IDLE.

---

## Section 5 : Conseils de reglage

**Configuration minimale** :
- Fournir `weights:` avec le chemin absolu ou relatif vers le fichier `.pth` DiMP50.
- `vram_threshold_gb: 2.0` minimum pour DiMP50. Mettre 4.0 si d'autres modeles GPU sont actifs.
- `net_type: "dimp18"` sur GPU moins puissant (Jetson Orin : ~2 GB GPU libre si YOLO actif).

**Scene IR avec fond complexe** :
- DiMP est superieur a CSRT sur les fonds textures car son filtre discriminant s'adapte au fond specifique de la scene.
- Pas de parametre de reglage expose ; ajuster `vram_threshold_gb` pour eviter le fallback non desire.

**Occultations** :
- DiMP gere mieux les occultations courtes que CSRT grace a l'IoUNet (affinement de bbox).
- Pour les occultations longues (>10 frames) : preferer SAM2 (memoire temporelle).

**Initialisation sans track MOT** :
- La boite par defaut est 60x60 px centree sur le clic. Suffisant pour des drones visibles en IR.
- Si la cible est plus grande, le fallback CSRT est generalement meilleur car il dispose de `fallback_bbox_size_px` configurable.

**Comparaison DiMP vs OSTrack** :
- DiMP (2 GB VRAM) vs OSTrack (3 GB VRAM) : preferer OSTrack si le GPU le permet (meilleure precision).
- Sur Jetson 8 GB avec YOLO actif (~3 GB) : DiMP18 a ~2 GB est un meilleur candidat qu'OSTrack.
