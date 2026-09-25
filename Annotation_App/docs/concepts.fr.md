---
app: annotation
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [sam2, samurai, grounding dino, sam3, homographie, flux optique, pistes, classes]
sources: [Annotation_App/backend/services/sam_service.py, Annotation_App/backend/models/routers/annotation.py, Annotation_App/backend/services/grounding_service.py, Annotation_App/backend/services/sam3_service.py, Annotation_App/backend/services/homography_service.py, Annotation_App/backend/services/interpolation_service.py, Annotation_App/backend/models/routers/tracking.py, Annotation_App/backend/models/annotation.py, Annotation_App/backend/models/sequence.py, Annotation_App/backend/models/track.py, Annotation_App/backend/models/label_class.py, Annotation_App/backend/utils/image_utils.py, Annotation_App/backend/ext/samurai_repo/sam2/sam2/configs/samurai/sam2.1_hiera_s.yaml]
---

# Concepts

## Projets et types de projet dans Annotation App

Un projet est l'unité de travail d'Annotation App : un ensemble nommé de frames, les classes utilisées pour les étiqueter, leurs annotations et leurs pistes. Les projets vivent dans le workspace de l'utilisateur ; chacun a son propre dossier sous `projects/<id>/`.

Un projet a l'un de deux types, choisi à la création et figé ensuite :

| Type (libellé) | Valeur stockée | À utiliser pour | Outils |
|---|---|---|---|
| **Image Random** | `image` | Images sans lien entre elles (photos, découpes, données collectées) | Outils manuels, SAM2, détection par texte, export |
| **Séquence Image** | `video` | Vidéos et dossiers d'images ordonnés (séries temporelles) | Tout ce qui précède plus le panneau Tracks (SAMURAI, Detect., homographie, flux optique), l'onglet Debug et les pistes |

Les deux types acceptent plusieurs séquences, la timeline, la LUT, l'import d'annotations existantes, la sauvegarde et tous les formats d'export. La seule différence est la disponibilité des outils temporels, qui supposent que des frames consécutives montrent la même scène. Choisir **Séquence Image** pour des images non ordonnées n'apporte rien ; choisir **Image Random** pour une vidéo retire les outils de propagation : prenez **Séquence Image** dès que l'ordre compte.

Un projet est supprimé avec toutes ses fiches en base (frames, annotations, pistes, classes, session). Les images sources référencées par lien symbolique et les exports déjà produits ne sont pas supprimés.

## Séquences et projets multi-séquences

Une séquence est une source importée dans un projet : un dossier d'images, une vidéo, ou un fichier d'un format spécifique optionnel. Chaque import crée une nouvelle séquence : un projet peut ainsi mélanger, par exemple, trois vidéos et deux dossiers d'images infrarouges.

Chaque séquence a un nom, un type de source (`images`, `video` ou un format spécifique), son chemin source, son premier index global de frame, son nombre de frames, et éventuellement sa cadence et sa propre LUT d'affichage. Les frames d'une nouvelle séquence sont ajoutées après les frames existantes du projet, et leurs fichiers reçoivent un préfixe propre à la séquence (`s001_frame_000000.jpg`) pour que deux imports n'entrent jamais en collision.

La séquence est le périmètre de travail de l'interface : le curseur, les compteurs de frames, le champ **aller à**, la timeline et les pistes ne montrent que la séquence courante. Les pistes sont aussi numérotées par séquence, à partir de 0 dans chacune.

Le nom de la séquence compte à l'export : il devient le nom du sous-dossier (`<nom>-yolo/`, `<nom>-coco/`) ou du fichier (`<nom>.ver`). Nommez les séquences de façon parlante à l'import ; par défaut, c'est le nom du dossier ou du fichier.

Les projets créés avant la prise en charge multi-séquence présentent leurs frames comme une seule pseudo-séquence appelée séquence principale. Elle fonctionne comme les autres, sauf que sa LUT ne peut être réglée qu'au niveau projet.

## Frames et index de frames

Une frame est une image d'une séquence. Annotation App stocke les métadonnées des frames en base (index, nom de fichier, taille, séquence, indicateur d'annotation) et les pixels sur disque ; les images ne sont jamais stockées en base.

Chaque frame a un `frame_index` global, unique dans le projet, et une position locale dans sa séquence. L'interface affiche presque partout des numéros locaux à partir de 1 (`12 / 450`) ; les exports utilisent aussi la position locale (à partir de 1 dans `.ver`). Trois endroits montrent l'index global, à partir de 0 : l'en-tête **Frame courante** du panneau Tracks (`#n`), les plages de frames de la liste **Tracks (N)**, et la plage **De F** / **à F** du lot de détection par texte.

Selon la source, les pixels se trouvent à des endroits différents :

- **Dossier d'images serveur** : des liens symboliques dans `projects/<id>/frames/` pointent vers les fichiers d'origine (zéro copie). Si les liens ne sont pas autorisés, les fichiers sont copiés.
- **Images envoyées** : stockées dans `projects/<id>/frames/` dans leur format d'origine.
- **Vidéo** : les frames sont extraites en tâche de fond en JPEG (qualité 85 par défaut) ou en PNG sans perte dans `projects/<id>/frames/`, en gardant éventuellement une frame sur N. Le canvas demande d'abord l'extraction autour de la frame courante : vous pouvez commencer avant la fin de l'extraction.

Les sources PNG et TIFF 16 bits sont conservées telles quelles. Pour l'affichage et pour les modèles, une version 8 bits est calculée à travers la LUT d'affichage et mise en cache ; la source n'est jamais modifiée.

Une frame est marquée annotée dès qu'elle porte au moins une annotation ; c'est ce qui rend sa cellule de timeline verte et ce que comptent les statistiques du projet.

## Classes et hiérarchie de classes à trois niveaux

Une classe est l'étiquette donnée à une annotation. Les classes appartiennent à un projet et chacune a une couleur, utilisée sur le canvas, dans les listes et sur les pistes.

Une classe peut avoir jusqu'à trois niveaux :

1. **Classe (détection)**, obligatoire : ce qu'est l'objet au niveau le plus grossier, par exemple `drone`.
2. **Sous-classe (reconnaissance)**, facultative : une catégorie plus fine, par exemple `quadcoptere`.
3. **Sous-sous-classe (identification)**, facultative et seulement quand une sous-classe existe : l'identité précise, par exemple `mavic`.

Les exports utilisent la hiérarchie différemment :

- **YOLO** et **COCO** ont une liste plate de catégories. Le nom complet joint les niveaux par des soulignés (`drone_quadcoptere_mavic`), et chaque classe distincte du projet devient une catégorie (index à partir de 0 en YOLO, `category_id` à partir de 1 en COCO).
- **.ver** garde les trois niveaux dans trois colonnes séparées.

Chaque annotation exige une classe, et les outils qui créent des annotations (tracé, SAM, détection par texte) utilisent la classe active sélectionnée dans l'onglet **Classes**. Quand des annotations sont importées d'un fichier `.ver` ou d'un dossier YOLO, les classes manquantes sont créées automatiquement (les noms de classes YOLO viennent de `classes.txt` ou d'un fichier `.yaml` s'ils existent, sinon `classe_<i>`).

## Annotations : boîtes, polygones et masques

Une annotation est un objet étiqueté sur une frame. Annotation App stocke deux types géométriques :

- **Boîte englobante** : un rectangle aligné sur les axes, tracé avec **Rectangle** ou produit par la plupart des outils d'IA en mode **BBox**.
- **Polygone** : un contour fait de points, tracé avec **Polygone** ou produit à partir d'un masque en mode **Seg** / **Segmentation**. Un polygone stocke aussi sa boîte englobante.

Les masques sont un résultat intermédiaire, jamais stockés tels quels. SAM2, SAMURAI et SAM3 produisent des masques de pixels ; l'application convertit chaque masque soit en boîte englobante, soit en polygone simplifié par l'algorithme de Douglas-Peucker (tolérance proportionnelle à la longueur du contour), en gardant le plus grand contour. Les polygones de SAM2 et SAMURAI ont 100 points au plus, les boîtes Grounding DINO raffinées par SAM2 64 au plus ; SAM3 utilise une tolérance plus fine (0,5 % de la longueur du contour) sans limite de points.

Que choisir :

| Besoin | Choix |
|---|---|
| Entraînement de détection d'objets (YOLO detect, boîtes COCO) | Boîtes |
| Entraînement de segmentation d'instances (YOLO segment, segmentation COCO) | Polygones |
| Relecture rapide de nombreuses frames | Boîtes (plus légères à afficher et à corriger) |
| Objets fins, inclinés ou irréguliers | Polygones |

Les exports s'adaptent automatiquement : YOLO écrit des boîtes pour chaque annotation et en plus une variante segmentation quand des polygones existent ; COCO inclut le polygone en `segmentation` ; `.ver` ne stocke que des boîtes. La propagation par homographie ou par flux optique ne déplace que la boîte englobante : à partir d'un polygone, elle produit une annotation qui garde le type polygone mais n'a aucun point de contour.

## Coordonnées normalisées et provenance des annotations

Annotation App stocke chaque annotation en coordonnées YOLO normalisées : le centre de la boîte `cx, cy` et sa taille `w, h` en fractions de la largeur et de la hauteur de l'image, entre 0 et 1. Les points des polygones sont normalisés de la même façon. Les valeurs en pixels ne sont calculées que pour l'affichage et pour les formats d'export en pixels (COCO et `.ver`). Les annotations sont ainsi indépendantes de la résolution à laquelle une frame est affichée ou traitée.

Chaque annotation enregistre aussi son origine :

| Champ | Signification |
|---|---|
| `confidence` | Score entre 0 et 1 ; 1,0 pour les annotations manuelles |
| `is_auto` | Vrai quand elle est produite par un modèle ou une propagation (badge **IA**) |
| `is_interpolated` | Vrai pour les résultats d'homographie et de flux optique (badge **Interp.** quand elle n'est pas automatique) |
| `source_algorithm` | `sam_point`, `sam_auto`, `grounding_dino`, `sam3`, `samurai`, `sam2_video`, `guided_tracking`, `homography`, `optical_flow`, `imported` ; les anciens projets peuvent contenir `sam2_tracking`. Vide pour les boîtes et polygones dessinés à la main |
| `track_id` | La piste à laquelle appartient l'annotation, s'il y en a une |

La provenance pilote le filtre et les badges **IA** de l'onglet **Annots** et la page Monitoring, qui compare travail automatique et manuel et compte les annotations automatiques retouchées ou supprimées ensuite.

## Pistes et identifiants de piste

Une piste relie les annotations d'un même objet physique à travers les frames d'une séquence. Elle a une classe, une couleur, une première et une dernière frame, et un `track_uid`, le numéro affiché `#uid` dans l'interface et écrit dans l'export `.ver`.

Les numéros de piste sont propres à chaque séquence : la première piste de chaque séquence est `#0`. Sur une frame donnée, une nouvelle piste prend le plus petit numéro libre.

Les pistes sont créées par :

- le dessin à la main dans un projet **Séquence Image** : chaque boîte ou polygone dessiné sans piste en reçoit une automatiquement, avec le plus petit numéro libre sur cette frame ; si une piste de ce numéro existe déjà dans la séquence, l'annotation la rejoint ;
- la propagation SAMURAI et SAM2 vidéo, et le mode Detect. : chaque cible garde sa piste ou en reçoit une nouvelle ;
- le sélecteur de piste de l'onglet **Annots** (**+ nouvelle**) ;
- l'import de fichiers `.ver`, qui portent des identifiants de piste.

L'homographie et le flux optique recopient la piste de chaque annotation source (une source sans piste donne des résultats sans piste) ; la détection par texte, SAM Point et SAM Auto ne créent ni ne prolongent jamais de piste.

Sur la timeline, chaque piste est une ligne. Un bloc est une suite continue de frames où la piste a des annotations ; les blocs sont séparés par des trous où l'objet a été perdu ou non traité. Supprimer un bloc ne retire que ce tronçon ; supprimer une piste la retire avec toutes ses annotations et renumérote les pistes restantes. **Tout suppr.** dans le panneau Tracks retire les pistes mais garde leurs annotations, détachées.

## LUT d'affichage et chaîne d'entrée des modèles

La LUT d'affichage (table de correspondance) convertit les valeurs brutes des pixels d'une frame vers la plage 0-255 affichée à l'écran. Elle compte surtout pour l'imagerie 16 bits et infrarouge, dont l'information utile occupe souvent une bande étroite de valeurs.

Trois modes existent : **Auto σ** étire `[moyenne - Nσ, moyenne + Nσ]` (N = 3 par défaut), **Min-Max** étire le minimum et le maximum réels de la frame, et **Manuel** utilise des valeurs basse et haute fixes. Une LUT peut être réglée par projet et remplacée par séquence ; pour chaque frame, la LUT de la séquence l'emporte sur celle du projet.

Tous les modèles utilisent la même chaîne d'entrée :

1. **Source** : PNG ou TIFF 16 bits, JPEG ou PNG 8 bits, ou un format spécifique.
2. **LUT** : la LUT effective de la frame (séquence, sinon projet) la convertit en 8 bits. Pour SAMURAI, les frames sont écrites en JPEG qualité 95 dans un dossier temporaire du projet ; un JPEG 8 bits déjà conforme est lié sans réencodage.
3. **Redimensionnement** : SAM2 et SAMURAI redimensionnent chaque frame en 1024 x 1024 sans conserver le ratio (le modèle a été entraîné ainsi ; les coordonnées sont reconverties avec la taille d'origine).
4. **Tenseur** : normalisé, et calculé en bfloat16 sur GPU.

Conséquence pratique : régler la LUT change ce que reçoit le modèle. Sur de l'imagerie 16 bits, un mauvais réglage donne une image écrasée, et le modèle travaille sur la même image plate que celle que vous voyez. Réglez la LUT avant de lancer détections ou propagations. Changer une LUT invalide automatiquement les images 8 bits et les aperçus en cache de ce projet.

## Segmentation d'image SAM2 (points et auto)

SAM2 (Segment Anything Model 2) est un modèle de segmentation universel : à partir d'une image et d'un prompt, il renvoie un masque précis de l'objet, quelle que soit sa classe. Annotation App utilise le checkpoint `sam2.1_hiera_small.pt` quand il est présent, avec le checkpoint tiny comme repli plus léger, sur GPU quand il est disponible.

Deux usages interactifs :

- **SAM Point** : chaque clic gauche est un point objet (label 1), chaque clic droit un point d'arrière-plan (label 0). Le modèle renvoie jusqu'à trois masques candidats après chaque point ; un double-clic accepte le meilleur, converti en boîte ou en polygone.
- **SAM Auto** : une grille de 32 points par côté est échantillonnée sur toute la frame ; les masques dont l'IoU prédit est inférieur à 0,88 ou le score de stabilité inférieur à 0,95, ou plus petits que 100 pixels, sont écartés. Les masques restants sont transmis en flux par WebSocket comme propositions que vous validez ou rejetez.

SAM2 raffine aussi les boîtes Grounding DINO en masques quand la détection par texte tourne en mode **Seg**.

Limites : SAM2 segmente « un objet », pas « une classe » : il ne sait pas ce que vous voulez étiqueter, la classe vient donc toujours de vous. Sur des scènes peu contrastées ou encombrées, un seul point peut sélectionner une partie de l'objet ou son environnement ; ajoutez des points d'arrière-plan pour lever l'ambiguïté. SAM Auto produit beaucoup de masques petits ou qui se chevauchent : utilisez ensuite la NMS et le filtre de confiance.

## Suivi vidéo mono-cible SAMURAI

SAMURAI est le tracker par défaut de l'onglet **SAMURAI**. Ce n'est pas un modèle différent mais un fork de SAM2 vidéo avec les mêmes poids (`sam2.1_hiera_small.pt`) et la même architecture ; il ajoute une règle de décision fondée sur un filtre de Kalman. À chaque frame, SAM2 propose plusieurs masques candidats avec un score de confiance. SAM2 seul prend le plus sûr ; SAMURAI prend celui qui concilie le mieux confiance et cohérence avec le mouvement précédent.

SAMURAI est livré avec l'application dans `backend/ext/samurai_repo/` et chargé automatiquement avec SAM2. Quand il ne peut pas être chargé, l'onglet se replie sur SAM2 standard et l'indique dans son badge.

Utilisez-le pour une cible sur une longue séquence, surtout avec des occultations partielles, des changements de pose ou des distracteurs proches. Le prompt est la boîte englobante de la cible sur la frame de référence. La propagation peut aller vers l'avant ou vers l'arrière depuis la frame de référence.

### Comment SAMURAI choisit un masque avec le filtre de Kalman

SAMURAI entretient un filtre de Kalman sur la boîte de la cible, avec un état à 8 dimensions dans l'espace `xyah` : centre x, centre y, ratio d'aspect, hauteur, plus leurs quatre vitesses. Le modèle de mouvement suppose une vitesse constante (un pas par frame). Son bruit est proportionnel à la hauteur de la boîte (`_std_weight_position = 1/20`, `_std_weight_velocity = 1/160`) : un grand objet a droit à plus d'incertitude absolue qu'un objet lointain.

À chaque frame :

1. SAM2 propose plusieurs masques, chacun avec un IoU prédit.
2. Le filtre prédit la boîte attendue à partir de l'état précédent.
3. Chaque candidat reçoit un score combiné `kf_score_weight x IoU_kalman + (1 - kf_score_weight) x IoU_modele`. Dans la configuration SAMURAI utilisée par l'application, `kf_score_weight` vaut 0,25 : le mouvement départage, il ne décide pas seul.
4. Le meilleur score combiné l'emporte, pas simplement le masque le plus sûr.
5. Si le score est assez élevé, le filtre est corrigé avec la boîte retenue. Sinon le compteur `stable_frames` retombe à 0 et le filtre continue en prédiction pure ; il faut 15 frames correctes consécutives (`stable_frames_threshold`) pour considérer la cible de nouveau verrouillée.

L'état du filtre appartient au modèle, pas à un objet suivi : il n'existe qu'un seul état de Kalman en mémoire. C'est pourquoi SAMURAI suit exactement une cible. Avec plusieurs cibles, l'application bascule sur SAM2 multi-objets natif (en **Auto (rapide)**) ou lance une passe SAMURAI par cible (**SAMURAI / objet**), et remet l'état du filtre à zéro avant chaque passage pour que rien ne fuie d'un passage à l'autre.

### Mémoire, précision et paramètres de SAMURAI

SAMURAI et SAM2 vidéo tiennent une banque de mémoire des frames passées. L'attention croisée ne regarde que les 7 dernières frames mémorisées (`num_maskmem = 7`) plus la frame de référence que vous avez annotée : le coût par frame est donc constant et n'augmente pas avec la longueur de la séquence. SAMURAI filtre aussi ce qui entre dans cette banque (`memory_bank_iou_threshold = 0.5`) : une frame où le suivi est douteux n'est pas mémorisée, ce qui évite d'empoisonner les frames suivantes.

L'inférence tourne sous `autocast(bfloat16)` sur GPU, pour l'initialisation, le prompt et la propagation. Sans cela, les noyaux d'attention rapides sont refusés et l'inférence est 3 à 5 fois plus lente ; mélanger les précisions entre étapes corromprait la banque de mémoire. La session vidéo est fermée à la fin de chaque passage pour libérer la VRAM.

| Paramètre | Valeur | Signification |
|---|---|---|
| `image_size` | 1024 | Résolution interne appliquée à chaque frame |
| `num_maskmem` | 7 | Frames conservées dans la banque de mémoire |
| `stable_frames_threshold` | 15 | Frames correctes consécutives avant de considérer la cible reverrouillée |
| `kf_score_weight` | 0,25 | Poids de l'IoU Kalman dans le score de sélection du masque |
| `memory_bank_iou_threshold` | 0,5 | IoU minimal pour qu'une frame entre en mémoire |
| Offload CPU | désactivé | Frames en RAM plutôt qu'en VRAM (réglage **Mode GPU rapide** décoché) : plus lent mais nécessaire pour de longues plages sur un petit GPU |

En mode GPU rapide, la VRAM limite le nombre de frames par passage (environ 350 à 450 frames en 1024 x 1024 sur 10 Go) ; le panneau Tracks affiche une estimation pour votre GPU.

### Hypothèses et cas d'échec de SAMURAI

SAMURAI fonctionne bien tant que ses hypothèses tiennent. Chacune, et ce qui se passe quand elle est fausse :

- **Le mouvement est lisse, à vitesse quasi constante.** Si faux : un changement brutal de direction fait diverger la prédiction et le suivi décroche.
- **La cible reste visible ou n'est occultée que brièvement.** Si faux : après une longue occultation, le filtre a trop dérivé pour reverrouiller.
- **Le ratio d'aspect varie peu.** Si faux : une rotation dans le plan de l'image fait de la boîte un mauvais descripteur de l'objet.
- **La boîte de départ cadre bien l'objet.** Si faux : un prompt approximatif fixe une cible ambiguë pour toute la séquence.
- **L'apparence reste comparable sur 7 frames.** Si faux : un changement rapide d'échelle ou d'éclairage vide la mémoire de son utilité.

Quand le suivi décroche, corrigez la boîte sur la première frame fautive et propagez de nouveau à partir de là : la frame corrigée devient la nouvelle référence.

## Suivi multi-objets SAM2 vidéo et SAMURAI par objet

SAM2 vidéo est le tracker utilisé automatiquement quand plusieurs cibles sont propagées en **Auto (rapide)**, et le seul tracker vidéo quand SAMURAI n'est pas disponible. Chaque objet reçoit un identifiant et son propre jeu de masques, et la propagation est mutualisée : une passe traite tous les objets, sans coût proportionnel au nombre d'objets.

La différence avec SAMURAI tient en une phrase : SAM2 choisit le masque dont il est le plus sûr, sans se demander si ce masque est plausible compte tenu du mouvement précédent. Sur des objets bien contrastés et isolés, la différence est négligeable. Sur deux objets semblables qui se croisent, SAM2 peut sauter de l'un à l'autre là où le filtre de Kalman de SAMURAI aurait rejeté le saut.

**SAMURAI / objet** contourne autrement la limite mono-cible : N passes indépendantes, une session et un filtre par cible. La qualité du suivi est meilleure sur les croisements et les occultations, pour environ N fois le temps de calcul.

Les annotations enregistrent le tracker réellement utilisé : `samurai` ou `sam2_video`.

Hypothèses de SAM2 vidéo et cas d'échec :

- **Les objets restent distinguables par leur apparence.** Si faux : deux objets identiques qui se croisent échangent leurs identités.
- **Les identités sont fixées par le prompt initial.** Si faux : un objet qui entre en cours de séquence n'est jamais suivi ; annotez-le sur une frame ultérieure et relancez.
- **Une mémoire de 7 frames suffit à garder l'identité.** Si faux : une occultation plus longue casse la piste sans rattrapage possible.

## Détection par texte Grounding DINO

Grounding DINO est un détecteur à vocabulaire ouvert piloté par un prompt texte. Annotation App utilise le modèle tiny `IDEA-Research/grounding-dino-tiny`, chargé depuis `backend/checkpoints/grounding_dino/` quand il est présent, sinon téléchargé depuis Hugging Face au premier usage. Il associe un encodeur de texte et un encodeur d'image et renvoie les boîtes dont la représentation correspond aux mots du prompt ; le prompt n'a pas besoin d'appartenir à une liste de classes prédéfinie.

Deux seuils ont deux rôles :

- **Seuil boîte** : filtre sur la confiance de la boîte (0,30 par défaut dans les Paramètres).
- **Seuil texte** : filtre sur la force de l'association entre la boîte et les mots du prompt (0,25 par défaut).

Des valeurs basses maximisent le rappel avec davantage de faux positifs. En mode Detect., des valeurs basses sont acceptables car l'appariement par centroïde écarte ensuite les détections éloignées de toute cible.

Écrivez le prompt sous forme de concepts, pas de phrase : des noms au singulier en minuscules, séparés par des points, comme `car . truck . person`. Une description complète dégrade la détection.

En mode **Seg**, chaque boîte Grounding DINO est raffinée en masque par SAM2, puis convertie en polygone. Les annotations sont créées avec la provenance `grounding_dino`.

Hypothèses et cas d'échec :

- **L'objet appartient au vocabulaire visuel appris.** Si faux : une cible très spécifique (une pièce industrielle, une signature infrarouge) n'est pas trouvée, quel que soit le prompt.
- **Chaque frame est indépendante.** Aucune cohérence temporelle ; les identités ne viennent que de l'appariement par centroïde du mode Detect.
- **Le domaine visuel est proche des données d'entraînement.** Si faux : sur de l'infrarouge ou du 16 bits mal remappé, les scores s'effondrent ; corrigez d'abord la LUT.

## Détection et segmentation par concept SAM3

SAM3 (ici SAM3.1, checkpoint `sam3.1_multiplex.pt` dans `backend/checkpoints/sam3.1/`) est un modèle autonome piloté par texte : il prend une image et un prompt texte et renvoie boîtes, masques et scores en une seule passe, sans Grounding DINO et sans SAM2. C'est une alternative à Grounding DINO dans la barre de détection par texte, dans le lot texte et dans le mode Detect.

Sa sortie peut être des boîtes ou des polygones de segmentation (**BBox** / **Seg** dans la barre d'outils, **Mode de sortie** dans l'onglet Detect.). Dans la barre de détection par texte, son lot et le mode Detect., les détections sous un seuil de score (0,25 par défaut, le champ **Box:**) sont écartées ; SAM3 n'a pas de seuil texte. Les annotations sont créées avec la provenance `sam3`.

Le choix entre SAM3 et Grounding DINO est empirique : SAM3 se comporte généralement mieux sur les objets aux contours nets et donne directement des masques ; Grounding DINO est plus léger et souvent meilleur sur des concepts plus abstraits.

SAM3.1 est un modèle à accès restreint sur Hugging Face : ses poids doivent être téléchargés avec un compte autorisé (voir [Configuration](configuration.fr.md)). Sans eux, les requêtes SAM3 échouent avec un message explicite.

Hypothèses et cas d'échec :

- **Le concept peut s'exprimer en langue naturelle.** Si faux : une distinction purement visuelle sans mot pour la nommer reste hors de portée.
- **Les frames sont indépendantes.** Même absence de continuité temporelle que Grounding DINO.

## Mode Detect. : détection puis appariement par centroïde

Le mode Detect. (onglet **Detect.**, aussi appelé tracking guidé) prolonge les cibles sélectionnées avec un détecteur piloté par texte. Il utilise exactement les mêmes modèles et les mêmes appels que la barre de détection par texte ; seul ce qui suit la détection change. La barre texte garde tout ce qu'elle trouve, sans pistes. Detect. ne garde que les détections rattachées à une cible.

Pour chaque frame de la plage :

1. Grounding DINO ou SAM3 produit N boîtes anonymes.
2. Pour chaque cible, la distance entre son centre et le centre de chaque boîte est calculée en coordonnées normalisées. La référence est la boîte de la cible sur la frame traitée précédente, pas la boîte de départ.
3. L'appariement est glouton, cible par cible dans l'ordre : chacune prend la détection libre la plus proche, seulement si elle est plus proche que **Dist. centroide** (0,15 de l'image par défaut).
4. Une cible sans détection sous le seuil est enregistrée comme anomalie `missing` sur cette frame et laisse un trou dans sa piste.
5. Quand la surface de la boîte appariée varie de plus de **Var. taille max** (0,5, soit plus ou moins 50 %), l'annotation est tout de même créée mais la frame est enregistrée comme anomalie `size_variation` dans le résultat de la tâche, que l'interface n'affiche pas ; cela signifie souvent que la boîte a sauté sur un objet voisin.
6. Les détections non appariées sont écartées : les objets qui ne sont pas des cibles ne sont jamais ajoutés. Chaque cible garde sa piste existante ou en reçoit une nouvelle.
7. Avec l'auto-stop activé, le passage s'arrête quand plus de la part indiquée des cibles est perdue pendant le nombre indiqué de frames consécutives.

Les annotations sont enregistrées avec la provenance `guided_tracking`. Le mode fonctionne bien quand les cibles restent proches de leur position attendue et que le prompt est fiable ; il a du mal avec les objets rapides (augmentez la distance) et les scènes encombrées d'objets semblables (les identités peuvent s'échanger).

## Propagation par homographie avec XFeat ou SIFT

La propagation par homographie (onglet **Homogr.**) transporte des boîtes d'une frame à la suivante en estimant la transformation géométrique globale de l'image, une matrice 3 x 3. Aucun réseau de détection n'intervient : les boîtes suivent le mouvement de la caméra (panoramique, inclinaison, zoom, rotation).

Pour chaque paire de frames consécutives, des points d'intérêt sont appariés avec XFeat sur GPU (depuis `backend/models/xfeat/`), ou avec SIFT sur CPU quand XFeat n'est pas disponible, puis RANSAC estime la matrice et sépare les correspondances cohérentes (inliers) des aberrantes (outliers). Chaque boîte est transformée par la matrice.

| Paramètre (interface) | Clé de réglage | Défaut | Signification |
|---|---|---|---|
| **Top-K pts** | `xfeat_top_k` | 2048 | Points d'intérêt extraits par image (XFeat) |
| **Min cossim** | `xfeat_min_cossim` | 0,82 | Similarité cosinus minimale pour accepter une correspondance (XFeat) |
| **Seuil reproj.** | `ransac_threshold` | 4,0 px | Erreur de reprojection tolérée |
| **Inliers min.** | `min_inlier_count` | 20 | Nombre absolu d'inliers requis |
| **Ratio inliers** | `min_inlier_ratio` | 0,3 | Proportion d'inliers requise |

Quand l'estimation ne passe pas ces seuils, l'homographie de ce pas est rejetée : une matrice calculée sur trop peu de correspondances produirait des boîtes aberrantes. Les boîtes sont alors recopiées telles quelles sur cette frame. La confiance de chaque boîte propagée vaut la confiance source multipliée par `0.6 + 0.4 x ratio d'inliers`.

Hypothèses et cas d'échec :

- **La scène est plane, ou la caméra tourne autour de son centre optique.** Si faux : avec de la parallaxe, une seule matrice ne peut pas décrire la scène.
- **L'objet ne bouge pas par rapport à la scène.** Si faux : un objet qui se déplace de lui-même ne suit pas la transformation globale ; utilisez le flux optique.
- **La texture est suffisante.** Si faux : ciel, mer ou mur uniforme ne donnent aucun point d'intérêt et aucune homographie.
- **Les frames consécutives se recouvrent largement.** Si faux : un mouvement rapide laisse trop peu de correspondances.

## Propagation par flux optique Lucas-Kanade

La propagation par flux optique (onglet **Flux opt.**) suit chaque boîte individuellement, ce qui en fait le complément de l'homographie : utilisez-la quand les objets bougent et que la caméra ne bouge pas.

Pour chaque boîte, 29 points sont suivis d'une frame à l'autre par Lucas-Kanade pyramidal : les quatre coins et une grille 5 x 5 à l'intérieur de la boîte (avec une marge de 15 %). À partir des points correctement suivis, l'application estime une transformation affine partielle (translation, rotation et échelle uniforme) par RANSAC et l'applique aux coins ; la nouvelle boîte est le rectangle qui englobe les coins transformés, elle grandit ou rétrécit donc avec l'objet. Si l'estimation échoue, la boîte est translatée du déplacement médian des points. Si moins de points que **Pts min.** survivent, la boîte est recopiée telle quelle. Chaque objet est traité séparément : plusieurs objets peuvent partir dans des directions différentes.

| Paramètre (interface) | Clé de réglage | Défaut | Signification |
|---|---|---|---|
| **Fenêtre (px)** | `optflow_win_size` | 21 | Fenêtre de recherche. Plus grande, elle gère des mouvements plus rapides mais perd en précision ; 15 à 21 pour des scènes nettes, 25 à 31 pour une vidéo compressée |
| **Niveaux pyra.** | `optflow_max_level` | 3 | Chaque niveau double le déplacement gérable ; 2 au-delà de 30 fps, 4 pour un timelapse |
| **Pts min.** | `optflow_min_pts` | 4 | Points suivis minimum pour déplacer la boîte ; 2 à 3 pour de petits objets, 8 ou plus dans les zones peu texturées |

Hypothèses et cas d'échec :

- **Constance de la luminance : un point garde son intensité.** Si faux : un changement d'éclairage ou un reflet fait perdre les points.
- **Le déplacement reste dans la fenêtre de recherche.** Si faux : trop rapide pour 21 px sur 3 niveaux, le suivi décroche ; augmentez les niveaux de pyramide.
- **Les points voisins bougent ensemble.** Si faux : sur un objet déformable, la transformation estimée ne décrit plus l'objet.
- **L'objet est texturé.** Si faux : une surface uniforme ne fournit aucun point suivable.

## Interpolation linéaire entre frames clés

L'interpolation linéaire remplit les frames situées entre deux frames clés annotées d'une même piste en interpolant les coordonnées de la boîte : pour une frame à la position `t` entre le début (0) et la fin (1), la boîte vaut `début + t x (fin - début)` pour `cx`, `cy`, `w` et `h` (les polygones sont rééchantillonnés et interpolés point par point), et la confiance descend de 1,0 aux frames clés à 0,7 au milieu de l'intervalle. Les annotations interpolées portent le badge **Interp.**.

L'interpolation est disponible par l'API (`POST /api/projects/{id}/interpolate`, voir [Référence API](api-reference.fr.md)) et n'est pas exposée par un bouton dans l'interface actuelle.

Elle suppose un mouvement uniforme entre les deux frames clés. Elle convient pour combler de courts trous (5 à 20 frames) entre deux annotations manuelles d'un objet lent ; pour des trajectoires courbes ou des changements de vitesse, le flux optique ou SAMURAI donnent de meilleurs résultats.

## Choisir la bonne méthode d'annotation ou de suivi

Annotation App offre plusieurs façons de produire les mêmes annotations. La bonne dépend de ce qui bouge et de ce que les modèles savent reconnaître.

| Situation | Méthode recommandée |
|---|---|
| Une cible, longue séquence, occultations | SAMURAI (onglet **SAMURAI**, une cible) |
| Plusieurs cibles bien séparées | SAM2 multi-objets (**Auto (rapide)**) |
| Plusieurs cibles semblables qui se croisent | **SAMURAI / objet**, si le temps de calcul est acceptable |
| Nombreux objets nommables par des mots, sur des images indépendantes | Barre de détection par texte avec Grounding DINO ou SAM3, en lot |
| Cibles existantes à prolonger avec un prompt fiable | Onglet **Detect.** |
| Caméra qui bouge, scène fixe | Onglet **Homogr.** |
| Caméra fixe, objets qui bougent | Onglet **Flux opt.** |
| Court trou entre deux frames clés manuelles | Interpolation linéaire (API) |
| Contour précis d'un objet isolé | **SAM Point** en mode **Seg** |
| Image dense, démarrage rapide | **SAM Auto**, puis NMS |

Un workflow général fiable pour une vidéo : annotez une à trois frames de référence réparties dans la séquence, lancez SAMURAI (ou Detect. quand le prompt est fiable), utilisez l'homographie ou le flux optique sur les tronçons où ils conviennent, relisez et nettoyez la timeline, puis exportez. Voir [Procédures](workflows.fr.md) pour les étapes détaillées.

## Architecture et fonctionnement des modèles d'Annotation App

Annotation App combine cinq modèles neuronaux et deux algorithmes classiques. Chacun résout un sous-problème différent, et savoir comment il fonctionne explique ses points forts et ses échecs.

| Modèle | Paramètres | Ce qu'il produit | Utilisé par |
|---|---|---|---|
| SAM2.1 Hiera Small | environ 46 millions | masques à partir de clics, et un masque par image en vidéo | SAM Point, SAM Auto, onglet SAMURAI, mode Seg |
| SAMURAI | aucun ajouté | mêmes masques, choisis avec un filtre de mouvement | onglet SAMURAI (cible unique) |
| Grounding DINO tiny | environ 172 millions | boîtes et scores à partir d'un prompt texte | barre de détection par texte, mode Detect., batch texte |
| SAM3.1 | voir plus bas | boîtes, masques et scores à partir d'un prompt texte | mêmes endroits, en alternative |
| XFeat | environ 1,6 million | points clés et descripteurs pour apparier deux images | propagation par homographie |

Le flux optique de Lucas-Kanade et SIFT sont des algorithmes classiques sans poids appris ; ils sont décrits dans leurs propres sections de cette page.

### SAM2.1 Hiera Small : encodeur d'image, prompts, décodeur et mémoire vidéo

SAM2 se compose de quatre blocs. L'**encodeur d'image** est Hiera, un transformer de vision hiérarchique : l'image est redimensionnée en 1024 x 1024 pixels et traitée en quatre étages de 1, 2, 11 et 2 blocs, dont la largeur commence à 96 et double à chaque étage. La plupart des blocs regardent dans des fenêtres locales ; les blocs 7, 10 et 13 regardent toute l'image. Un réseau pyramidal de caractéristiques fusionne les quatre échelles en cartes de 256 canaux. L'**encodeur de prompts** transforme les points (premier plan ou arrière-plan), les boîtes ou un masque précédent en jetons. Le **décodeur de masques**, un petit transformer à double sens, fait échanger ces jetons et les caractéristiques de l'image, et produit jusqu'à trois masques candidats. Chaque candidat est accompagné d'un IoU prédit, l'estimation de sa propre qualité par le modèle, et d'un score d'objet qui dit si un objet est présent. L'IoU prédit sert à SAM Point pour classer ses candidats, et SAMURAI le réutilise.

En vidéo, trois éléments ajoutent une mémoire. Un **encodeur de mémoire** compresse chaque image traitée et son masque en caractéristiques de 64 canaux. Une **banque de mémoire** garde les 7 images les plus récentes plus les images où vous avez donné un prompt. Une **attention mémoire** de 4 couches de transformer avec encodage de position rotatif permet à l'image courante de lire cette banque, avec un vecteur pointeur par objet. L'image courante est ensuite décodée comme une image seule, mais conditionnée par ce qui précède. C'est pourquoi SAM2 suit un objet à travers une déformation modérée et de courtes occlusions, et aussi pourquoi un mauvais masque entré dans la mémoire peut contaminer les images suivantes.

### SAMURAI : un filtre de Kalman qui change le masque retenu

SAMURAI ne change aucun poids : il change la façon de choisir l'un des trois masques candidats et les images qui entrent dans la mémoire. Il suit la boîte de la cible avec un filtre de Kalman, un estimateur classique qui prédit où la boîte devrait être à l'image suivante d'après sa position, sa forme et sa vitesse, puis corrige cette prédiction avec ce qui est observé.

- Tant que 15 images consécutives n'ont pas été jugées stables, SAMURAI garde le candidat au meilleur IoU prédit et alimente le filtre avec sa boîte.
- Une fois stable, chaque candidat est noté par `0,25 x score de mouvement + 0,75 x IoU prédit`, où le score de mouvement est l'IoU entre la boîte du candidat et la boîte prédite par le filtre. Le meilleur score l'emporte. La valeur 0,25 est celle de la configuration livrée avec l'application.
- Le filtre n'est corrigé avec la boîte choisie que si son IoU prédit dépasse 0,3 ; sinon le compteur de stabilité repart à zéro.
- Une image n'entre dans la banque de mémoire que si son IoU prédit dépasse 0,5 et que son score d'objet est positif, si bien que les images floues ou occultées ne polluent pas la mémoire.

L'application applique SAMURAI à une cible unique. Avec plusieurs cibles, elle utilise le mode multi-objets natif de SAM2, sans le filtre.

### Grounding DINO tiny : backbone image, backbone texte et requêtes guidées par le langage

Grounding DINO associe un détecteur de la famille DINO à un modèle de langage. Le **backbone image** est Swin-T (quatre étages de 2, 2, 6 et 2 blocs de transformer) et produit des cartes de caractéristiques à quatre échelles. Le **backbone texte** est BERT : il transforme le prompt en un vecteur par jeton, jusqu'à 256 jetons. Un **amplificateur de caractéristiques** de 6 couches fait dialoguer les caractéristiques de l'image et du texte. Une **sélection de requêtes guidée par le langage** garde ensuite les 900 positions de l'image qui correspondent le mieux aux jetons du prompt comme points de départ, appelés requêtes, et un **décodeur intermodal** de 6 couches les affine en boîtes en relisant l'image et le texte.

Chacune des 900 requêtes se termine par une boîte et un score par jeton du prompt. C'est de là que viennent les deux seuils : le seuil boîte s'applique au meilleur score de jeton d'une requête, et le seuil texte décide quels jetons sont assez forts pour être comptés dans l'étiquette de la boîte. Comme les scores sont calculés par rapport à des mots et non à une liste fixe de classes, n'importe quelle expression peut servir de classe, mais le modèle ne connaît que ce que ses données d'entraînement ont montré : les noms anglais courts et courants fonctionnent le mieux, et le point dans `car . truck . person` marque la frontière entre les concepts.

### SAM3.1 : un détecteur unique pour des concepts décrits par du texte

SAM3 trouve et segmente chaque instance d'un concept décrit par un groupe nominal court. La configuration du checkpoint `sam3.1_multiplex.pt` décrit un modèle vidéo à deux parties qui partagent un encodeur de vision : un détecteur et un tracker de style SAM2 travaillant sur des images de 1008 pixels avec des patchs de 14 pixels. Annotation App construit le modèle image seul : elle n'utilise donc que le détecteur, sur des images indépendantes, et uniquement avec des prompts texte.

Le détecteur lit le texte avec un encodeur de texte de style CLIP de 24 couches (largeur 1024), fusionne texte et image dans un encodeur de style DETR de 6 couches, et décode 200 requêtes d'objets dans un décodeur de 6 couches. Un décodeur de masques transforme chaque requête retenue en masque. Un jeton de présence dans le décodeur prédit si le concept apparaît dans l'image, de sorte que reconnaître le concept et le localiser sont deux décisions séparées. Un encodeur de géométrie de 3 couches existe pour des exemples en boîte ou en point, que l'application n'envoie pas. Comme les masques viennent directement du détecteur, SAM3 n'a pas besoin de SAM2 pour affiner ses boîtes, contrairement à Grounding DINO en mode **Seg**.

### XFeat : points clés et descripteurs appris pour apparier deux images

XFeat est un petit réseau convolutif d'environ 1,6 million de paramètres, conçu pour être rapide sur du matériel modeste. Il convertit l'image en niveaux de gris et calcule trois sorties à partir d'un tronc commun : une carte dense de descripteurs de 64 dimensions au huitième de la résolution, une carte de points clés qui prédit, pour chaque cellule de 8 x 8, quel pixel est un point clé, et une carte de fiabilité qui dit à quel point chaque endroit est digne de confiance. L'application garde les 4096 meilleurs points clés de chaque image.

Pour apparier deux images, les descripteurs de la première sont comparés à ceux de la seconde par similarité cosinus, et une paire n'est gardée que si les deux points clés sont chacun le meilleur appariement de l'autre (plus proches voisins mutuels) et que leur similarité dépasse 0,82. Les points appariés alimentent ensuite une estimation robuste de l'homographie par RANSAC avec une tolérance de reprojection de 3 pixels. Les descripteurs appris permettent à XFeat d'apparier des images où SIFT trouve trop peu de points fiables (faible texture, flou, changement d'éclairage modéré) ; l'homographie elle-même, et ses limites sur les scènes non planes, sont décrites dans la section sur l'homographie plus haut.
