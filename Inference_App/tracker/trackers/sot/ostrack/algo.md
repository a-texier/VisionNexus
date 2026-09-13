# Tracker SOT : OSTrack (One-Stream Tracking)

## Section 1 : Principe

OSTrack (Ye et al., ECCV 2022) est un tracker SOT de type ViT (Vision Transformer) one-stream :
il traite simultanement les tokens du template (crop de la cible a l'init) et les tokens de la
zone de recherche (crop de la frame courante) dans le meme encodeur Transformer, permettant une
attention croisee implicite template-recherche des les premieres couches. Une tete de prediction
legere (heatmap + regression bbox) localise la cible dans la zone de recherche. Le modele est
entierement pretraine et ne se met pas a jour pendant le suivi (template fixe).
Necessite GPU (~3 GB VRAM). Fallback automatique sur CSRT si VRAM insuffisante.

---

## Section 2 : Parametres YAML

Section `ostrack:` dans le YAML.

| Parametre  | Type | Defaut | Plage       | Effet                                                        |
|------------|------|--------|-------------|--------------------------------------------------------------|
| `weights`  | str  | ""     | chemin .pth | Chemin vers les poids OSTrack. Vide = erreur explicite au demarrage. |

Parametres internes (non exposes, definis dans la config OSTrack) :
- `search_size` : taille crop de recherche (256 ou 384 px). Plus grand = meilleure precision, plus lent.
- `template_size` : taille crop template (128 px standard).
- `score_threshold` : seuil de confiance interne pour succes/echec.

---

## Section 3 : Inputs / Outputs du workflow

**Entrees**

| Entree      | Type                     | Description                                                       |
|-------------|--------------------------|-------------------------------------------------------------------|
| `frame`     | `ndarray (H, W, ...)`    | Frame courante (normalisee ImageNet en interne)                   |
| `click_pos` | `(x, y)`                 | Position du clic operateur (a l'init)                            |
| `mot_tracks`| `list[Track]` ou `None`  | Tracks MOT pour trouver la bbox la plus proche du clic (init)    |
| `H`         | non utilise par OSTrack  | Transmis au fallback CSRT si actif                               |

**Sorties de `update()`**

| Sortie  | Type                       | Description                                              |
|---------|----------------------------|----------------------------------------------------------|
| `ok`    | `bool`                     | True si OSTrack localise la cible avec score suffisant   |
| `bbox`  | `[x1,y1,x2,y2]` ou `None` | Position estimee par la tete de regression ViT           |
| `mask`  | `None`                     | Toujours None (OSTrack ne produit pas de masque)         |

---

## Section 4 : Integration dans le pipeline

**Appelant** : `session.py`, via la state machine, apres un clic operateur.

**Flux d'init** :
1. Clic operateur -> `ostrack_sot.init(frame, click_pos, mot_tracks)`.
2. `find_bbox_from_tracks()` (utilitaire `base_sot.py`) : track MOT contenant le clic > track la plus proche <= 300 px > boite par defaut 60x60 px.
3. Verification VRAM : si libre < `vram_threshold_gb` -> fallback CSRT.
4. Import `lib.test.evaluation.Tracker` du repo OSTrack (lazy) : si echec -> fallback CSRT.
5. `tracker_obj.initialize(frame, {"init_bbox": [x1, y1, w, h]})` : le template est extrait et encode.

**Flux d'update** :
1. Session.py appelle `ostrack_sot.update(frame)`.
2. Si fallback actif : delegue a `_fallback.update()` (CSRT).
3. Sinon : `self._tracker.track(frame)` -> `out["target_bbox"]` au format (x, y, w, h).
4. Conversion en [x1, y1, x2, y2] et retour.

**Fallback CSRT** : actif si VRAM insuffisante OU si OSTrack non installe. Transparent pour session.py.

**Note sur la CMC** : OSTrack n'integre pas de CMC propre. H est ignore par OSTrack et transmis uniquement au fallback CSRT. Pour les sequences avec forte motion camera, le fallback CSRT (avec Kalman CMC) peut etre plus stable qu'OSTrack sans CMC.

**Interaction state machine** : identique aux autres SOT. Echec -> sot_miss -> retour MOT ou IDLE.

---

## Section 5 : Conseils de reglage

**Configuration minimale** :
- Fournir `weights:` avec le chemin vers le fichier `.pth` OSTrack (vitb_256_mae_ce_32x4_ep300).
- `vram_threshold_gb: 3.0` minimum pour ViT-Base. Mettre 4.0-5.0 si d'autres modeles GPU actifs.

**Avantage vs DiMP** :
- OSTrack ne necessite pas d'optimisation en ligne -> plus rapide par frame (~40-60 FPS GPU).
- Meilleure precision sur les benchmarks standards (LaSOT, GOT-10k).
- Template fixe : peut perdre la cible si elle change fortement d'apparence.

**Cibles IR** :
- OSTrack a ete entraine sur des datasets RGB. Sur IR thermique, les performances peuvent etre reduites par rapport au RGB.
- Preferer DiMP (qui se met a jour en ligne) sur des cibles IR avec apparence variable.
- Sur des cibles avec fort contraste thermique (drone tres chaud sur fond froid) : OSTrack fonctionne bien.

**Camera mobile (forte CMC)** :
- OSTrack n'a pas de Kalman CMC interne. Si la camera bouge fortement entre deux frames, le crop de recherche 256x256 peut ne plus centrer la cible.
- Solution : augmenter `search_size` (parametres internes OSTrack) ou utiliser CSRT avec CMC active.
- Le fallback CSRT est preferable si la camera est tres mobile et H_ldv non disponible.

**Initialisation** :
- La boite par defaut est 60x60 px (hardcode dans le wrapper). Suffisant pour des drones IR visibles.
- OSTrack est particulierement efficace quand la bbox initiale provient d'une track MOT precise.

**Comparaison OSTrack vs SAM2** :
- OSTrack (3 GB, ~40 FPS) vs SAM2 large (8 GB, ~10 FPS) : OSTrack si temps reel requis.
- SAM2 si precision pixel-level necessaire ou occultations longues frequentes.
