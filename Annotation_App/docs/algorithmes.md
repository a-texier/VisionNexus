# Algorithmes

Version texte de l'onglet Presentation > Algorithmes de l'app (visuel stylé
avec schémas interactifs : `frontend/src/components/presentation/TabAlgorithms.tsx`).
Fonctionnement réel de chaque méthode disponible dans l'onglet Tracks, avec
ses paramètres effectifs et les hypothèses qu'elle pose. Les valeurs citées
sont celles du code, pas celles des articles d'origine — chaque hypothèse
explicite ce qui casse l'algorithme, pas seulement comment il marche.

## Chaîne d'entrée commune à tous les modèles

Source (16 bits PNG/TIFF, 8 bits JPEG, ou format specialise brut) -> LUT (3-sigma / minmax
/ manuel, séquence > projet) -> 8 bits (JPEG qualité 95, dossier temporaire)
-> Resize (1024x1024, sans préserver le ratio) -> Tenseur (normalisé
ImageNet, bfloat16 sur GPU).

Conséquence pratique : régler la LUT change ce que le modèle reçoit. Sur de
l'imagerie 16 bits, un mauvais réglage donne une image écrasée, et le modèle
travaille alors sur la même bouillie que celle affichée à l'écran.

## SAMURAI — suivi vidéo mono-cible

*SAM2 augmenté d'un filtre de Kalman qui arbitre le choix du masque.*

SAMURAI est un fork de SAM2, pas un modèle différent : mêmes poids
(`sam2.1_hiera_small.pt`), même architecture. Ce qu'il ajoute est une règle
de décision. À chaque frame, SAM2 propose plusieurs masques candidats avec
un score de confiance ; SAM2 seul prend le plus sûr, SAMURAI prend celui qui
concilie confiance et cohérence de mouvement.

**La boucle de décision** : SAM2 propose plusieurs masques (frame t) avec
leur IoU prédit -> un filtre de Kalman prédit une boîte attendue à partir de
l'état précédent -> score combiné = `0.15 x IoU_kalman + 0.85 x IoU_modèle`
-> le masque retenu est le mieux noté sur ce score combiné, pas seulement le
plus sûr -> si le score dépasse le seuil, le filtre est corrigé avec la
boîte retenue. Sous le seuil, le compteur `stable_frames` retombe à 0 et le
filtre repart en prédiction pure ; il faut 15 frames consécutives correctes
(`stable_frames_threshold`) pour le considérer reverrouillé.

**Le filtre de Kalman en détail** : état à 8 dimensions dans l'espace `xyah`
(centre x, centre y, ratio d'aspect, hauteur) plus les quatre vitesses
associées. Modèle à vitesse constante (`dt = 1` frame). Le bruit est
proportionnel à la hauteur de la boîte (`_std_weight_position = 1/20`,
`_std_weight_velocity = 1/160`) : un objet qui occupe beaucoup de pixels a
droit à plus d'incertitude absolue qu'un objet lointain. Le mélange des
scores est fixé à `kf_score_weight = 0.15` — le Kalman départage, il ne
décide pas.

**Pourquoi SAMURAI ne suit qu'UNE cible** : `kf_mean`, `kf_covariance` et
`stable_frames` sont des attributs du *modèle*, pas d'un objet suivi. Il
n'existe donc qu'un seul état de Kalman en mémoire, quel que soit le nombre
de cibles. Avec deux objets, la comparaison de scores porte sur un tenseur à
plusieurs éléments et lève `RuntimeError: Boolean value of Tensor with more
than one value is ambiguous`.

L'application gère ce cas au lieu de planter : dès la 2e cible,
`configure_video_tracking()` met `samurai_mode = False` et bascule sur SAM2
multi-objets natif, qui suit N objets sans Kalman. L'état est aussi remis à
zéro à chaque run — le modèle est un singleton partagé, un reliquat
corromprait le run suivant.

Le mode SAMURAI par objet contourne la limite autrement : N passes
indépendantes, une session et un filtre par cible. Suivi de meilleure
qualité, coût environ N fois le temps de calcul.

**Banque de mémoire** : `num_maskmem = 7` — l'attention croisée ne regarde
que les 7 dernières frames mémorisées, plus la frame de référence (celle
annotée). Le coût par frame est donc constant, il n'augmente pas avec la
longueur de la séquence. SAMURAI filtre en plus ce qui entre dans cette
banque (`memory_bank_iou_threshold = 0.5`) : une frame où le suivi est
douteux n'est pas mémorisée, ce qui évite d'empoisonner les frames
suivantes.

**Préparation des images** : les frames sont converties en JPEG qualité 95
numérotées `000000.jpg` dans un dossier temporaire — SAMURAI exige des noms
qui soient des entiers purs. Un JPEG 8 bits déjà conforme est symlinké sans
recodage ; sinon la LUT est appliquée puis l'image réencodée. Chaque frame
est ensuite redimensionnée en 1024x1024 sans préservation du ratio : une
image 16:9 est donc déformée, de manière identique à l'entraînement, ce qui
est sans effet sur la qualité. Les coordonnées reviennent en normalisé via
la taille d'origine.

**Précision numérique** : l'inférence tourne sous `autocast(bfloat16)`. Sans
cela, PyTorch refuse les noyaux Flash et memory-efficient de l'attention et
retombe sur une implémentation naïve, 3 à 5 fois plus lente. Le même
contexte enveloppe l'initialisation, le prompt et la propagation : un dtype
différent entre ces étapes corromprait la banque de mémoire.

**Paramètres**

| Nom | Défaut | Description |
|---|---|---|
| `image_size` | 1024 | Résolution interne, appliquée à chaque frame. |
| `num_maskmem` | 7 | Frames conservées dans la banque de mémoire. |
| `stable_frames_threshold` | 15 | Frames consécutives correctes avant de considérer le suivi reverrouillé. |
| `kf_score_weight` | 0.15 | Poids du Kalman dans le score de sélection du masque. |
| `memory_bank_iou_threshold` | 0.5 | IoU minimum pour qu'une frame entre en mémoire. |
| `offload_video_to_cpu` | false | Frames en RAM plutôt qu'en VRAM. Plus lent, indispensable sur petit GPU. |

**Hypothèses (et ce qui casse si elles sont fausses)**

- Le mouvement est lisse à vitesse quasi constante — si faux : un changement brutal de direction fait diverger la prédiction, le suivi décroche.
- La cible reste visible ou n'est occultée que brièvement — si faux : après une longue occultation le filtre a trop dérivé pour reverrouiller.
- Le ratio d'aspect varie peu — si faux : une rotation dans le plan image fait de la boîte un mauvais descripteur.
- La boîte de départ cadre bien l'objet — si faux : un prompt approximatif fixe une cible ambiguë pour toute la séquence.
- L'apparence reste comparable sur 7 frames — si faux : un changement rapide d'échelle ou d'éclairage vide la mémoire de son utilité.

## SAM2 vidéo — suivi multi-objets

*Mémoire d'attention seule, sans modèle de mouvement.*

Utilisé automatiquement dès que plusieurs cibles sont demandées, et
disponible seul si SAMURAI n'est pas installé. Chaque objet reçoit un
identifiant et son propre jeu de masques ; la propagation est mutualisée, il
n'y a donc pas de surcoût proportionnel au nombre d'objets comme dans le
mode par objet.

La différence avec SAMURAI tient en une phrase : SAM2 choisit le masque
dont il est le plus sûr, sans jamais se demander si ce masque est plausible
compte tenu du déplacement précédent. Sur des objets bien contrastés et
isolés, la différence est nulle. Sur deux objets similaires qui se
croisent, SAM2 peut sauter de l'un à l'autre là où le Kalman de SAMURAI
aurait rejeté le saut.

Provenance distincte en base : depuis la séparation, les annotations
portent `samurai` ou `sam2_video` selon le tracker réellement actif. Les
runs antérieurs conservent `sam2_tracking`, qui ne permettait pas de les
distinguer.

**Hypothèses**

- Les objets restent distinguables par leur apparence — si faux : deux objets identiques qui se croisent échangent leurs identifiants.
- Les identités sont fixées par le prompt initial — si faux : un objet qui entre en cours de séquence ne sera jamais suivi.
- La mémoire de 7 frames suffit à maintenir l'identité — si faux : une occultation plus longue casse la piste sans possibilité de rattrapage.

## Grounding DINO — détection par texte

*Détecteur ouvert piloté par un prompt, sans notion de temps.*

Modèle `IDEA-Research/grounding-dino-tiny`, téléchargé automatiquement
depuis HuggingFace au premier usage (environ 340 Mo). Il associe un
encodeur texte et un encodeur image et retourne les boîtes dont la
représentation correspond au prompt. Vocabulaire ouvert : le prompt n'a pas
besoin d'appartenir à une liste de classes prédéfinies.

**Deux seuils, deux rôles** : `box_threshold` filtre sur la confiance de la
boîte ; `text_threshold` filtre sur la force de l'association entre la
boîte et les mots du prompt. En tracking guidé les deux sont volontairement
bas (0.20 et 0.15) : l'objectif est de maximiser le rappel, le tri est
ensuite fait par l'appariement géométrique aux cibles.

**Rédaction du prompt** : les termes doivent être séparés par des points,
en minuscules, au singulier : `car . truck . person`. Une phrase entière
dégrade la détection — le modèle attend des concepts, pas une description.

**Hypothèses**

- L'objet appartient au vocabulaire visuel appris — si faux : une cible très spécifique (pièce industrielle, signature infrarouge) n'est pas trouvée, quel que soit le prompt.
- Chaque frame est indépendante — aucune cohérence temporelle : les identités viennent uniquement de l'appariement par centroïde.
- Le domaine visuel est proche des données d'entraînement — si faux : sur de l'infrarouge ou du 16 bits mal remappé, les scores s'effondrent.

## SAM3 — détection et segmentation par concept

*Alternative à Grounding DINO, sortie boîte ou masque.*

Également piloté par texte, mais capable de produire directement des
masques de segmentation en plus des boîtes — réglable par
`sam3_output_mode` (`bbox` ou `segmentation`). Poids locaux dans
`backend/checkpoints/sam3.1/`.

Dans le tracking guidé, il occupe exactement la même place que Grounding
DINO : un détecteur appliqué frame par frame, dont les sorties sont ensuite
appariées aux cibles. Le choix entre les deux est empirique — SAM3 se
comporte généralement mieux sur les objets aux contours nets, Grounding
DINO sur les concepts plus abstraits.

**Hypothèses**

- Le concept est exprimable en langue naturelle — si faux : une distinction purement visuelle sans mot pour la nommer reste hors de portée.
- Frames indépendantes — même absence de continuité temporelle que Grounding DINO.

## YOLO custom — détecteur entraîné maison

*Vos propres poids `.pt`, en boucle de tracking.*

Charge un modèle local via `settings.algorithms.yolo_model_path`
(Ultralytics, cache par chemin). Aucun prompt texte : les classes sont
celles de votre entraînement. C'est la voie à privilégier quand vous avez
déjà un détecteur sur votre domaine — il battra systématiquement un modèle
généraliste.

**Seuil de confiance volontairement bas** : `yolo_conf_threshold = 0.15`
par défaut. Ce n'est pas un réglage de détection mais de tracking : on
accepte beaucoup de candidats, puis l'appariement par centroïde élimine
ceux qui ne tombent pas près d'une cible connue. Une fausse alarme loin de
toute cible est écartée sans jamais devenir une annotation.
`yolo_iou_threshold = 0.7` contrôle le NMS interne.

**Hypothèses**

- Les classes du modèle correspondent à celles du projet — si faux : les indices de classe sont décalés et les annotations mal étiquetées.
- Le domaine d'entraînement couvre les images annotées — si faux : un modèle entraîné de jour ne détecte rien la nuit.

## Homographie XFeat / SIFT

*Propagation géométrique quand c'est la caméra qui bouge.*

Aucun réseau de détection : on estime la transformation entre deux frames
et on y transporte les boîtes. Appariement par XFeat sur GPU, repli SIFT
sur CPU, puis RANSAC pour estimer une matrice 3x3.

**Paramètres**

| Nom | Défaut | Description |
|---|---|---|
| `xfeat_top_k` | 4096 | Points d'intérêt extraits par image. |
| `xfeat_min_cossim` | 0.82 | Similarité cosinus minimale pour valider un appariement. |
| `ransac_threshold` | 3.0 | Erreur de reprojection tolérée, en pixels. |
| `min_inlier_count` | 30 | Nombre absolu d'inliers requis. |
| `min_inlier_ratio` | 0.5 | Proportion d'inliers requise. |

Refus explicite plutôt que résultat faux : sous 30% d'inliers,
`compute_homography()` retourne `None` et la propagation s'arrête. Une
homographie estimée sur trop peu de correspondances produit des boîtes
aberrantes ; mieux vaut ne rien écrire.

**Hypothèses**

- La scène est plane ou la caméra tourne autour de son centre optique — si faux : en présence de parallaxe une seule matrice ne peut pas décrire la scène.
- L'objet est immobile par rapport à la scène — si faux : un objet qui se déplace en propre ne suit pas la transformation globale (utiliser le flux optique).
- La texture est suffisante — si faux : ciel, mer, mur uniforme : pas de points d'intérêt, pas d'homographie.
- Le recouvrement entre frames est important — si faux : un mouvement trop rapide ne laisse pas assez de correspondances.

## Flux optique Lucas-Kanade

*Propagation par objet, quand c'est la cible qui bouge.*

Complémentaire de l'homographie. Des points sont semés dans chaque boîte
puis suivis individuellement d'une frame à l'autre par Lucas-Kanade
pyramidal. Le déplacement médian des points survivants translate la boîte.
Chaque objet est traité séparément, donc plusieurs objets peuvent partir
dans des directions différentes.

**Paramètres**

| Nom | Défaut | Description |
|---|---|---|
| `optflow_win_size` | 21 | Fenêtre de recherche, en pixels. Plus grand = mouvements rapides mais moins précis. |
| `optflow_max_level` | 3 | Niveaux de pyramide. Chaque niveau double l'amplitude gérable. |
| `optflow_min_pts` | 4 | Points suivis minimum pour valider le déplacement. |

**Hypothèses**

- Constance de la luminance : un point garde son intensité — si faux : un changement d'éclairage ou un reflet fait perdre les points.
- Le déplacement reste dans la fenêtre de recherche — si faux : trop rapide pour 21 px sur 3 niveaux, le suivi décroche (augmenter `max_level`).
- Les points voisins bougent ensemble — si faux : sur un objet déformable, le déplacement médian n'a plus de sens.
- L'objet est texturé — si faux : une surface uniforme ne fournit aucun point suivable.

## Comment choisir

- **Une cible, séquence longue** — SAMURAI, le meilleur compromis.
- **Plusieurs cibles** — SAM2 multi-objets ; passer en SAMURAI par objet si la qualité ne suffit pas et que le temps de calcul est acceptable.
- **Objets nombreux et nommables** — Grounding DINO ou SAM3 en tracking guidé.
- **Détecteur déjà entraîné sur le domaine** — YOLO custom, sans hésiter.
- **Caméra qui bouge, scène fixe** — homographie.
- **Caméra fixe, objets qui bougent** — flux optique.
