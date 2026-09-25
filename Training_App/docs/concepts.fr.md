---
app: training
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [run, moteur, yolox, hyperparamètres, map, précision, rappel, checkpoint]
sources: [Training_App/backend/services/yolox_catalog.py, Training_App/backend/services/trainer_backend.py, Training_App/backend/services/yolox_trainer.py, Training_App/backend/services/detection_metrics.py, Training_App/backend/services/yolox_dataset.py, Training_App/backend/services/yolox_plots.py, Training_App/backend/services/training_service.py, Training_App/backend/vendor/yolox/yolox/exp/yolox_base.py]
---

# Concepts

## Runs d'entraînement, noms de runs et états

Un run est un entraînement d'un modèle sur un dataset avec un jeu d'hyperparamètres. Training App enregistre chaque run dans la base du workspace avec son moteur, sa taille de modèle, ses poids de départ, son `data.yaml`, son nom de dataset, l'ensemble des hyperparamètres réellement utilisés, sa progression, ses métriques finales et le chemin de ses meilleurs poids.

Les noms de runs sont générés et uniques : `train_<8 caractères hexadécimaux>` pour les runs lancés depuis l'interface ou l'API, `orch_<8 caractères hexadécimaux>` pour ceux lancés par l'Orchestrator. Chaque run écrit dans son propre dossier `runs/<nom du run>/` du workspace.

Un run passe par ces états :

- **En attente** : enregistré, le thread d'entraînement démarre.
- **En cours** : le moteur entraîne ; l'epoch courante et la progression sont mises à jour à la fin de chaque epoch.
- **Terminé** : l'entraînement s'est achevé normalement ; le chemin des meilleurs poids et les métriques finales sont enregistrés.
- **Erreur** : une exception a interrompu l'entraînement (problème de dataset, mémoire insuffisante...) ; le message est conservé sur le run.
- **Arrêté** : un arrêt a été demandé et le moteur s'est interrompu avant la fin.

Plusieurs runs peuvent s'entraîner en même temps : chacun a son thread dans le processus du backend. Ils se partagent alors le GPU, chacun est donc plus lent et la mémoire peut manquer. Les événements de progression d'un run ne sont conservés en mémoire que tant que le backend tourne : après un redémarrage du backend, un run qui était **En cours** ne peut pas reprendre et garde cet état dans la base.

## Moteurs d'entraînement et catalogue de moteur

Un moteur est le composant qui entraîne réellement un modèle : il construit le réseau, lit le dataset, exécute la boucle d'entraînement et écrit les poids et les graphiques. Training App fournit un moteur, **YOLOX**. D'autres moteurs peuvent être ajoutés sous forme de plugins (voir [Configuration](configuration.fr.md)) ; le moteur se choisit alors run par run, et plusieurs moteurs cohabitent dans le même historique.

Chaque moteur publie un catalogue : son libellé, l'extension de ses fichiers de poids (`.pth` pour YOLOX), ses tailles de modèle et sa taille par défaut, la valeur par défaut de chaque hyperparamètre, les groupes du formulaire, les plages de recherche utilisées par Optuna App, et la liste de ses graphiques d'analyse. La page **Training**, Optuna App et l'Orchestrator construisent leurs formulaires uniquement à partir de ce catalogue.

Règles communes à tous les moteurs :

- Le moteur d'un run est enregistré avec lui (base, MLflow, réponse à l'Orchestrator). Des poids ne se rechargent qu'avec le moteur qui les a produits.
- Des poids de départ dont l'extension n'appartient pas au moteur sont refusés avant le démarrage du run, tout comme une taille absente du catalogue.
- Les hyperparamètres inconnus du moteur sont ignorés et signalés (cas typique : meilleurs paramètres trouvés par Optuna pour un autre moteur).
- Aucun repli silencieux : un moteur absent ou inutilisable est une erreur explicite.

Quand une requête ne nomme pas de moteur, le moteur par défaut de l'instance est utilisé : `yolox`, sauf si la variable `TRAINING_APP_TRAINER_BACKEND` en désigne un autre.

## Tailles de modèle YOLOX

YOLOX est un détecteur d'objets en une passe et sans ancres : pour chaque cellule de trois cartes de caractéristiques, il prédit la présence d'un objet (objectness), sa classe et sa boîte. Training App propose six tailles, qui diffèrent par la profondeur et la largeur du réseau :

| Taille | Profondeur / largeur | Paramètres (approx.) | Usage typique |
|---|---|---|---|
| `yolox-nano` | 0,33 / 0,25, convolutions depthwise | 0,9 M | cibles embarquées, essais rapides |
| `yolox-tiny` | 0,33 / 0,375 | 5 M | inférence rapide, petit GPU |
| `yolox-s` | 0,33 / 0,50 | 9 M | défaut, bon compromis |
| `yolox-m` | 0,67 / 0,75 | 25 M | meilleure précision, GPU moyen |
| `yolox-l` | 1,0 / 1,0 | 54 M | haute précision, gros GPU |
| `yolox-x` | 1,33 / 1,25 | 99 M | précision maximale, lent |

Les grandes tailles sont plus précises sur de grands datasets mais demandent plus de mémoire GPU, plus de temps par epoch et plus de données pour éviter le surapprentissage. Sur quelques centaines d'images, `s` ou `m` depuis des poids pré-entraînés est en général le meilleur choix.

Dans Training App, toutes les tailles utilisent la **Taille image** du formulaire (640 par défaut) et les mêmes valeurs d'augmentation par défaut. Les recettes YOLOX d'origine entraînent `nano` et `tiny` à 416 pixels avec une augmentation plus légère ; réglez **Taille image** à 416 et **Mixup active** à `false` pour les reproduire. Le nombre de classes du réseau provient de `names` du `data.yaml`.

## Poids de départ : entraînement depuis zéro ou fine-tuning

Sans poids de départ, un run YOLOX part de poids aléatoires ("depuis zéro"). Cela demande un grand dataset et beaucoup d'epochs (les 300 epochs par défaut viennent de l'entraînement sur COCO).

Avec des poids de départ (un checkpoint `.pth`), le run affine un modèle existant (fine-tuning) : les poids du fichier sont copiés dans le nouveau réseau, couche par couche. Une couche de forme différente est ignorée et garde son initialisation aléatoire ; c'est ce qui arrive à la couche de classification quand le nombre de classes a changé, tandis que le backbone qui extrait les caractéristiques visuelles est réutilisé. Le fine-tuning converge beaucoup plus vite et demande bien moins d'images.

À savoir :

- Le checkpoint doit provenir de la même taille : un fichier `yolox-m` chargé dans un réseau `yolox-s` n'a presque aucune couche de la bonne forme.
- Seuls les poids du modèle sont repris du fichier. Le compteur d'epochs, l'état de l'optimiseur et le planning du taux d'apprentissage repartent de zéro : ce n'est pas la reprise d'un run interrompu.
- De bons points de départ sont les meilleurs poids d'un run précédent, ou les checkpoints COCO officiels de YOLOX (`yolox_s.pth`...), que l'application ne télécharge jamais d'elle-même (voir [Configuration](configuration.fr.md)).

## Epochs, intervalle d'évaluation et dernières epochs sans augmentation

Une epoch est un passage sur toutes les images d'entraînement. Le nombre d'itérations par epoch est le nombre d'images d'entraînement divisé par **Batch size**.

Le planning YOLOX d'un run comporte trois phases :

1. **Warmup** (**Warmup epochs**, 5 par défaut) : le taux d'apprentissage monte de **Warmup LR** à sa valeur nominale, ce qui stabilise les premières mises à jour.
2. **Phase principale** : le taux d'apprentissage suit une courbe cosinus jusqu'à **LR min (ratio)** fois la valeur nominale, avec l'augmentation complète (mosaic, mixup...).
3. **Dernières epochs sans augmentation** (**Sans mosaic/mixup (fin, ép.)**, 15 par défaut) : mosaic et mixup sont désactivés pour que le modèle voie des images proches des vraies, une perte L1 supplémentaire sur les boîtes est activée, le taux d'apprentissage reste à son minimum, et le modèle est évalué à chaque epoch. Un checkpoint `last_mosaic_epoch_ckpt.pth` est enregistré au début de cette phase.

Le modèle est évalué sur le split de validation toutes les **Intervalle eval (ép.)** epochs (10 par défaut), à chaque epoch de la phase finale, et toujours à la dernière epoch. Les métriques, les graphiques et le meilleur checkpoint ne sont mis à jour qu'à ces évaluations ; les autres epochs ne remontent que les pertes. Avec moins d'epochs que **Intervalle eval (ép.)**, la seule évaluation est la finale.

## Hyperparamètres YOLOX : entraînement et optimiseur

Les champs des groupes **Entrainement** et **Optimiseur** du formulaire YOLOX, avec leur clé (telle qu'enregistrée sur le run et dans MLflow) et leur valeur par défaut :

| Champ | Clé | Défaut | Effet |
|---|---|---|---|
| **Epochs** | `max_epoch` | 300 | Nombre total d'epochs. |
| **Warmup epochs** | `warmup_epochs` | 5 | Durée du warmup du taux d'apprentissage. |
| **Sans mosaic/mixup (fin, ép.)** | `no_aug_epochs` | 15 | Dernières epochs sans mosaic ni mixup. Doit être inférieur à **Epochs**. |
| **Intervalle eval (ép.)** | `eval_interval` | 10 | Epochs entre deux évaluations. |
| **Intervalle log (iter.)** | `print_interval` | 10 | Itérations entre deux lignes de journal ; les pertes remontées par epoch sont échantillonnées à ces lignes. |
| **Batch size** | `batch_size` | 16 | Images par itération. Principal levier sur la mémoire GPU. |
| **Taille image** | `imgsz` | 640 | Côté de l'entrée carrée du réseau, en pixels (multiple de 32). |
| **Workers** | `data_num_workers` | 4 | Processus qui chargent et augmentent les images en parallèle. |
| **Device** | `device` | vide | Vide ou `auto` : GPU si disponible, sinon CPU. Aussi `cpu`, `cuda`, `cuda:1`. |
| **FP16 (mixed precision)** | `fp16` | false | Demi-précision sur GPU : moins de mémoire, plus rapide. Ignoré sur CPU. |
| **LR par image** | `basic_lr_per_img` | 0,00015625 | Taux d'apprentissage par image ; le taux réel vaut cette valeur fois **Batch size** (0,0025 avec un batch de 16). |
| **Scheduler** | `scheduler` | `yoloxwarmcos` | Planning du taux d'apprentissage : warmup puis cosinus. |
| **Warmup LR** | `warmup_lr` | 0 | Taux d'apprentissage de départ du warmup. |
| **LR min (ratio)** | `min_lr_ratio` | 0,05 | Taux final, en fraction du taux nominal. |
| **Weight decay** | `weight_decay` | 0,0005 | Pénalité L2 sur les poids ; limite le surapprentissage. |
| **Momentum** | `momentum` | 0,9 | Inertie de l'optimiseur SGD. |
| **EMA** | `ema` | true | Tient une moyenne glissante des poids, utilisée pour l'évaluation et les checkpoints ; plus stable et en général meilleure. |

Comme le taux d'apprentissage suit la taille du batch, changer **Batch size** n'oblige pas à changer **LR par image**. Deux clés ne figurent pas dans le formulaire et gardent leur valeur par défaut pendant l'évaluation : `test_conf` (0,01, confiance minimale conservée) et `nmsthre` (0,65, seuil de recouvrement de la NMS).

## Hyperparamètres YOLOX : augmentation de données

L'augmentation de données crée des copies modifiées des images d'entraînement à chaque itération, pour que le modèle généralise au lieu de mémoriser. Les champs du groupe **Data augmentation** :

| Champ | Clé | Défaut | Effet |
|---|---|---|---|
| **Rotation (°)** | `degrees` | 10 | Rotation aléatoire maximale, en degrés. |
| **Translation** | `translate` | 0,1 | Décalage aléatoire maximal, en fraction de la taille d'image. |
| **Shear (°)** | `shear` | 2 | Cisaillement aléatoire maximal, en degrés. |
| **Perspective** | `perspective` | 0 | Déformation de perspective aléatoire (valeurs très faibles). |
| **Proba HSV jitter** | `hsv_prob` | 1,0 | Probabilité d'une variation aléatoire de teinte, saturation et luminosité. |
| **Proba flip** | `flip_prob` | 0,5 | Probabilité d'un retournement horizontal. |
| **Proba mosaic** | `mosaic_prob` | 1,0 | Probabilité de composer une image d'entraînement à partir de quatre images (mosaic). |
| **Proba mixup** | `mixup_prob` | 1,0 | Probabilité de mélanger la mosaïque avec une autre image (mixup). |
| **Mixup active** | `enable_mixup` | true | Interrupteur général du mixup. |

Les plages de zoom appliquées avec mosaic (`mosaic_scale`, de 0,8 à 1,6) et mixup (`mixup_scale`, de 0,5 à 1,5) ne figurent pas dans le formulaire et gardent leur valeur par défaut.

Quand les modifier : ramenez **Rotation (°)** et **Shear (°)** à 0 quand l'orientation compte (texte, cadrans) ou quand les boîtes deviennent trop larges après rotation ; mettez **Proba flip** à 0 quand la gauche et la droite ont un sens ; baissez **Proba mosaic** et **Proba mixup** pour de petits datasets de gros objets, où la mosaïque coupe trop souvent les objets. Regardez **Batches d'entraînement (augmentés)** dans l'analyse du run pour voir l'effet.

## Pertes d'entraînement de YOLOX

La perte mesure l'erreur des prédictions sur le batch d'entraînement ; l'entraînement la fait baisser. YOLOX remonte plusieurs pertes à la fin de chaque epoch :

- `iou_loss` : erreur de localisation des boîtes, fondée sur le recouvrement (IoU) entre boîtes prédites et annotées. Affichée comme perte de boîte dans **Pertes (train)**.
- `conf_loss` : erreur d'objectness, c'est-à-dire de présence d'un objet à chaque position.
- `cls_loss` : erreur de classification des objets détectés.
- `l1_loss` : erreur absolue sur les coordonnées des boîtes, active seulement pendant les dernières epochs sans augmentation (0 avant).
- `total_loss` : la somme pondérée des précédentes.

Les valeurs remontées pour une epoch sont celles de la dernière ligne de journal de l'epoch (toutes les **Intervalle log (iter.)** itérations), pas une moyenne. Si une epoch compte moins d'itérations que **Intervalle log (iter.)** (petit dataset, gros batch), aucune perte n'est remontée : baissez **Intervalle log (iter.)** pour obtenir les courbes.

Les pertes sur des images d'entraînement augmentées sont bruitées et non comparables entre des runs à l'augmentation différente. Jugez le modèle sur les métriques de validation.

## Métriques de détection : IoU, précision, rappel, mAP50 et mAP50-95

Training App évalue le modèle sur tout le split de validation avec sa propre implémentation des métriques de type COCO.

- **IoU** (intersection sur union) : la surface commune à une boîte prédite et une boîte annotée, divisée par la surface de leur union. 1 signifie des boîtes identiques.
- **Vrai positif** : une prédiction de la bonne classe dont l'IoU avec une annotation non encore appariée atteint le seuil. Les prédictions sont appariées de la plus confiante à la moins confiante ; les autres sont des faux positifs, et les annotations non appariées sont des objets manqués.
- **Précision** : part des prédictions correctes. **Rappel** : part des objets annotés retrouvés.
- **AP** (précision moyenne) d'une classe : l'aire sous sa courbe précision-rappel, échantillonnée en 101 points de rappel.
- **mAP50** (`metrics/mAP50(B)`) : la moyenne des AP des classes à IoU 0,50. Elle indique si les objets sont trouvés avec une boîte à peu près juste.
- **mAP50-95** (`metrics/mAP50-95(B)`) : la moyenne des mAP aux dix seuils d'IoU 0,50, 0,55... 0,95. Elle récompense aussi la précision des boîtes et constitue le score de qualité principal.

Les classes absentes des annotations de validation sont exclues des moyennes. Les valeurs de **précision** et de **rappel** remontées par epoch (`metrics/precision(B)`, `metrics/recall(B)`) sont la moyenne de la courbe de chaque classe sur tous les seuils de confiance de 0 à 1 à IoU 0,50, moyennée sur les classes : ce sont des indicateurs pour comparer des runs, pas la précision et le rappel obtenus à un seuil donné. Utilisez pour cela les courbes P, R et F1.

Le mAP affiché sur un run est celui de sa dernière évaluation ; à la fin d'un run YOLOX, c'est le mAP de l'epoch finale. Les meilleurs poids (`best_ckpt.pth`) sont ceux de l'évaluation au meilleur mAP50-95, qui peut être une epoch antérieure. D'autres outils (Inference App, autres moteurs) suivent des conventions légèrement différentes : comparez des valeurs calculées par le même outil.

## Checkpoints écrits par un run YOLOX

Un checkpoint est un fichier `.pth` qui contient les poids du réseau (les poids EMA quand **EMA** est actif) ainsi que l'état de l'optimiseur et les compteurs d'entraînement. Un run YOLOX écrit dans son dossier :

- `latest_ckpt.pth` : à la fin de chaque epoch.
- `last_epoch_ckpt.pth` : à chaque évaluation.
- `best_ckpt.pth` : une copie faite chaque fois qu'une évaluation bat le meilleur mAP50-95 obtenu jusque-là. C'est le **Meilleur modèle** du run.
- `epoch_<N>_ckpt.pth` : un par évaluation, en historique.
- `last_mosaic_epoch_ckpt.pth` : au début des dernières epochs sans augmentation.

Si aucune évaluation n'a jamais dépassé un mAP50-95 de 0 (run très court, validation vide), `best_ckpt.pth` n'existe pas et `last_epoch_ckpt.pth` est enregistré comme meilleur modèle. Le dossier contient aussi `train_log.txt` (journal complet de l'entraînement), `results.csv` (une ligne par epoch avec métriques et pertes) et `artifacts/` (graphiques d'analyse). Chacun de ces checkpoints peut servir de poids de départ ou être utilisé dans Inference App.

## Formats de dataset : labels YOLO .txt et fichiers .ver

Un dataset est décrit par un fichier `data.yaml` avec ces clés :

- `path` (facultatif) : dossier racine du dataset, absolu ou relatif au dossier du `data.yaml` (par défaut : ce dossier).
- `train`, `val`, `test` : dossier d'images de chaque split (ou une image unique), relatif à `path`. Les images (`.jpg`, `.jpeg`, `.png`, `.bmp`, `.tif`, `.tiff`) sont cherchées récursivement. Quand `train` manque, les images de `val` servent aussi à l'entraînement.
- `names` : noms des classes, en liste ou en correspondance `{id: nom}`. Obligatoire.
- `annotation_file` (facultatif) : chemin d'un fichier `.ver` à utiliser comme labels.

**Labels YOLO .txt** (par défaut) : pour chaque image, un fichier texte de même nom avec l'extension `.txt`, dans le dossier obtenu en remplaçant le dernier segment `images` du dossier d'images par `labels` (`images/val` -> `labels/val`). Chaque ligne vaut `classe cx cy w h`, normalisée entre 0 et 1. Les fichiers de labels sont cherchés directement dans ce dossier : des images rangées dans des sous-dossiers du split doivent avoir leurs fichiers de labels à la racine du dossier de labels.

**Fichiers .ver** : le format historique de VisionNexus, un seul fichier texte pour toute une séquence, une ligne par boîte : `frame visibilite x1 y1 x2 y2 [track_id classe]`, en pixels, frames numérotées à partir de 1. La colonne classe est un mot converti en numéro (`drone` 0, `bird` 1, `plane` 2, `helicopter` 3, `unknown` 4, tout autre mot 0) ; les lignes sans colonne classe reçoivent la classe 0. Les images sont appariées par le premier nombre de leur nom de fichier, compté à partir de 0 : l'image `frame_000000.jpg` reçoit les boîtes de la frame 1. Le fichier `.ver` est utilisé quand `annotation_file` le désigne, ou quand le chemin des labels d'un split est lui-même un fichier `.ver` ; le même fichier sert alors à tous les splits.

## Graphiques d'analyse d'un run YOLOX

Un run YOLOX écrit ses graphiques dans `artifacts/` de son dossier à chaque évaluation. Ils s'affichent dans **Analyse du modèle** et sont joints au run MLflow.

- **Matrice de confusion** (`confusion_matrix.png`) : les lignes sont les classes prédites, les colonnes les classes annotées, plus une ligne et une colonne background. Les prédictions de confiance au moins 0,25 sont appariées aux annotations avec un IoU d'au moins 0,45. La diagonale compte les détections correctes ; la ligne background compte les objets manqués ; la colonne background compte les fausses alarmes ; les autres cases sont des confusions de classes.
- **Courbe PR** (`PR_curve.png`) : précision en fonction du rappel à IoU 0,50, par classe, avec son AP. Une courbe proche du coin supérieur droit est bonne.
- **Courbes P, R et F1** (`P_curve.png`, `R_curve.png`, `F1_curve.png`) : précision, rappel et F1 (leur moyenne harmonique) en fonction du seuil de confiance. Le seuil au sommet de la courbe F1 est un bon choix par défaut pour l'inférence.
- **Distribution des labels** (`labels.jpg`) : nombre de boîtes par classe et nuage des tailles de boîtes. Elle révèle le déséquilibre des classes et les très petits objets. Écrit une seule fois.
- **Batches d'entraînement** (`train_batch0.jpg`) : 16 échantillons d'entraînement après augmentation, tels que le réseau les voit. Écrit une seule fois.
- **Validation**, vérité terrain et prédictions (`val_batch0_labels.jpg`, `val_batch0_pred.jpg`) : les mêmes 16 premières images de validation avec les boîtes annotées, puis avec les boîtes prédites par le modèle courant, régénérées à chaque évaluation.

## Architecture et fonctionnement du réseau YOLOX

Le moteur YOLOX de Training App construit un détecteur en trois parties, dont la largeur et la profondeur dépendent de la taille choisie (voir le tableau des tailles plus haut). Les comprendre explique ce que mesurent les pertes et pourquoi certains hyperparamètres comptent.

### Backbone et neck de YOLOX : CSPDarknet avec une pyramide d'agrégation de chemins

Le **backbone** est CSPDarknet : un stem qui réduit l'image, puis quatre étages de convolutions dont les blocs séparent leurs canaux en deux chemins (connexions partielles inter-étages) pour réduire le calcul tout en gardant la circulation du gradient. Les activations sont des SiLU (Nano utilise des convolutions séparables en profondeur pour être plus léger). Les trois derniers étages donnent des cartes de caractéristiques aux pas 8, 16 et 32, soit au huitième, au seizième et au trente-deuxième de la taille d'entrée : des cartes fines pour les petits objets, des cartes grossières pour les grands. Le **neck** est une pyramide d'agrégation de chemins (PAFPN) : elle fait descendre l'information sémantique des cartes grossières vers les cartes fines, puis remonter les positions précises des cartes fines, de sorte que chacune des trois sorties est à la fois précise et informée. La profondeur et la largeur multiplient le nombre de blocs et de canaux : `yolox-s` a la même disposition que `yolox-x`, en plus mince.

### Tête découplée et attribution des étiquettes de YOLOX : comment une boîte est prédite

La **tête** s'applique à chacune des trois cartes et est découplée : après une convolution 1 x 1 commune, une branche prédit les scores de classe et une autre prédit la boîte et l'objectness, au lieu qu'une seule branche fasse tout. Elle est sans ancres : chaque cellule d'une carte prédit directement le décalage du centre de la boîte ainsi que sa largeur et sa hauteur, sans liste de formes de boîtes prédéfinies. La prédiction d'une cellule est la boîte, l'objectness (y a-t-il un objet ici) et les probabilités de classe ; à l'inférence, le score de détection est l'objectness multiplié par la probabilité de classe.

L'entraînement doit décider quelles cellules sont responsables de quelle boîte annotée. YOLOX utilise **SimOTA**, une attribution dynamique : pour chaque boîte annotée, il estime combien de cellules doivent la prédire d'après le recouvrement des meilleurs candidats, puis choisit les cellules dont le coût combiné de classification et de localisation est le plus bas, et refuse que deux boîtes réclament la même cellule. C'est sur ce choix dynamique que sont calculés les `iou_loss`, `conf_loss` et `cls_loss` des courbes d'entraînement. Une forte augmentation (mosaic, mixup) aide parce qu'elle expose l'attribution à des contextes variés ; elle est désactivée pour les dernières époques afin que le réseau se stabilise sur des images naturelles, et la `l1_loss` est activée à ce moment.
