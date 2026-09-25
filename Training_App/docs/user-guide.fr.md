---
app: training
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [interface, page training, historique, hyperparamètres, progression, analyse]
sources: [Training_App/frontend/src/App.tsx, Training_App/frontend/src/pages/TrainingPage.tsx, Training_App/frontend/src/pages/RunsPage.tsx, Training_App/frontend/src/components/common/LanguageToggle.tsx, Training_App/frontend/src/i18n/translate.ts, Training_App/backend/services/yolox_catalog.py]
---

# Guide utilisateur

## Barre de navigation et langue de Training App

Training App comporte deux pages, accessibles depuis la barre de navigation en haut de la fenêtre :

- **Training** : configurer et lancer un run, puis le suivre en direct. L'application s'ouvre sur cette page.
- **Historique** : la liste de tous les runs de votre workspace, avec une fenêtre de détail par run.

Le bouton à l'extrémité droite de la barre affiche la langue courante (**EN** ou **FR**) ; cliquez dessus pour changer. Quand l'application est ouverte depuis VisionNexus, la langue choisie dans VisionNexus est appliquée au chargement et le bouton ne change que la fenêtre courante. Quand l'application tourne hors de VisionNexus, le choix est enregistré dans les réglages du workspace (voir [Configuration](configuration.fr.md)).

Sous le titre, le sous-titre de la page **Training** rappelle le moteur du formulaire courant (par exemple "Entrainement YOLOX") et le mode de l'application : **mode solo** quand vous saisissez vous-même le dataset, **mode orchestrateur** quand l'application a été démarrée par un pipeline Orchestrator.

## Page Training : panneau modèle

Le panneau modèle, en haut à gauche de la page **Training**, choisit ce qui sera entraîné. Son titre affiche le libellé du moteur, par exemple **Modele YOLOX**.

- **Moteur** : un bouton par moteur d'entraînement disponible. Cette ligne n'apparaît que lorsque plusieurs moteurs sont disponibles, c'est-à-dire lorsqu'un plugin de moteur est installé. Changer de moteur recharge les tailles, le formulaire d'hyperparamètres et ses valeurs par défaut, et vide **Poids de depart (optionnel)**. La note sous les boutons rappelle que des poids ne se rechargent qu'avec le moteur qui les a produits.
- Une ligne orange "<moteur> indisponible : <raison>" apparaît pour chaque moteur installé mais inutilisable (bibliothèque absente, catalogue illisible). Les autres moteurs continuent de fonctionner.
- **Taille** : un bouton par taille de modèle du moteur. Pour YOLOX, les boutons affichent `nano`, `tiny`, `s`, `m`, `l` et `x` ; la ligne **Modele :** en dessous donne le nom complet (`yolox-s` par défaut). Les tailles sont comparées dans [Concepts](concepts.fr.md).
- **Poids de depart (optionnel)** : chemin d'un fichier de poids sur la machine du backend. Vide signifie le comportement par défaut du moteur : pour YOLOX, le texte indicatif affiche "vide = entrainement depuis zero (.pth)", le modèle part donc de poids aléatoires. Un fichier dont l'extension n'est pas celle du moteur est refusé au clic sur **Lancer**.

Seuls les fichiers accessibles au backend sont utilisables : quand le backend tourne sur une VM distante, saisissez un chemin de la VM, pas de votre poste.

## Page Training : panneau Dataset YOLO et boutons de lancement

Le panneau **Dataset YOLO**, sous le panneau modèle, indique à l'application sur quelles données entraîner.

- **Chemin data.yaml** : chemin du fichier `data.yaml` du dataset, tel que le voit le backend (par exemple `C:/data/dataset/data.yaml` ou `/srv/datasets/run01/data.yaml`). Le format attendu est décrit dans [Concepts](concepts.fr.md) et une procédure de préparation dans [Workflows](workflows.fr.md).
- **Nom du dataset (optionnel)** : un nom lisible enregistré avec le run. Il s'affiche sous le nom du run dans le tableau de l'**Historique** et dans le détail du run, et devient le tag `dataset` de la version de modèle enregistrée dans MLflow. Il ne change pas le nom du run, toujours généré (`train_` suivi de 8 caractères hexadécimaux).
- En mode orchestrateur, un encadré bleu indique "Mode orchestrateur" (chemin fourni automatiquement) et affiche le dossier des runs du workspace. Vous pouvez tout de même lancer des runs manuels depuis la page.

Sous les panneaux :

- **Lancer** démarre le run. Le bouton est désactivé pendant un run lancé depuis cette page (son libellé devient **En cours...**), tant que **Chemin data.yaml** est vide, ou pendant le chargement du catalogue du moteur. Une notification "Run demarre : <nom du run>" confirme le démarrage. Si certains hyperparamètres sont inconnus du moteur, une seconde notification les liste ("Parametres ignores par ce moteur : ..."). Si le backend refuse la requête (`data.yaml` absent, taille invalide, poids incompatibles), son message s'affiche en rouge.
- **Stop** apparaît pendant le run. Il demande au backend d'arrêter le run après l'itération d'entraînement en cours, affiche "Run arrete" et marque le panneau de progression **Arrete**. Le run apparaît ensuite **Arrêté** dans l'**Historique**.

## Page Training : panneau Hyperparametres

Le panneau **Hyperparametres**, à droite de la page **Training**, présente les réglages d'entraînement du moteur choisi, regroupés en sections repliables. Cliquez sur le titre d'un groupe pour l'ouvrir ou le fermer. Pour YOLOX, **Entrainement** et **Data augmentation** sont ouverts par défaut et **Optimiseur** est fermé.

Chaque champ est prérempli avec la valeur par défaut du catalogue du moteur. Les nombres se saisissent dans des champs numériques avec le minimum, le maximum et le pas du catalogue ; les réglages oui/non (comme **EMA** ou **FP16 (mixed precision)**) sont des listes `true` / `false` ; les réglages texte (**Device**, **Scheduler**) sont libres. Un champ laissé vide n'envoie rien, la valeur par défaut du moteur s'applique. Une valeur non numérique dans un champ numérique est envoyée comme 0.

Les champs du formulaire YOLOX sont :

- **Entrainement** : **Epochs**, **Warmup epochs**, **Sans mosaic/mixup (fin, ép.)**, **Intervalle eval (ép.)**, **Intervalle log (iter.)**, **Batch size**, **Taille image**, **Workers**, **Device**, **FP16 (mixed precision)**.
- **Optimiseur** : **LR par image**, **Scheduler**, **Warmup LR**, **LR min (ratio)**, **Weight decay**, **Momentum**, **EMA**.
- **Data augmentation** : **Rotation (°)**, **Translation**, **Shear (°)**, **Perspective**, **Proba HSV jitter**, **Proba flip**, **Proba mosaic**, **Proba mixup**, **Mixup active**.

Le sens, la valeur par défaut et l'effet de chaque champ sont expliqués dans [Concepts](concepts.fr.md), sections *Hyperparamètres YOLOX : entraînement et optimiseur* et *Hyperparamètres YOLOX : augmentation de données*. Quelques réglages du moteur ne figurent pas dans le formulaire (la graine aléatoire et les plages d'échelle de mosaic et mixup) : ils gardent toujours leur valeur par défaut.

## Page Training : panneau Progression pendant un run

Le panneau **Progression** apparaît au-dessus de **Hyperparametres** dès le clic sur **Lancer**, et suit le run en direct grâce à un flux d'événements envoyé par le backend.

- La première ligne donne le nom du run, "Epoch N / total" et l'état : **En cours** (bleu), **Termine** (vert), **Erreur** (rouge) ou **Arrete**.
- La barre de progression se remplit avec le pourcentage d'epochs effectuées.
- Les tuiles de métriques affichent les valeurs envoyées à la fin de la dernière epoch, avec quatre décimales. Pour YOLOX : les pertes d'entraînement `total_loss`, `iou_loss`, `l1_loss`, `conf_loss` et `cls_loss`, plus, aux epochs où le modèle est évalué, `metrics/mAP50(B)`, `metrics/mAP50-95(B)`, `metrics/precision(B)` et `metrics/recall(B)`. Aux epochs sans évaluation, seules les pertes s'affichent. `l1_loss` reste à 0 jusqu'aux dernières epochs sans augmentation. Ces valeurs sont expliquées dans [Concepts](concepts.fr.md).
- À la fin du run, un encadré vert affiche **Modele sauvegarde :** avec le chemin des meilleurs poids, ainsi que les **mAP50** et **mAP50-95** finaux.
- Si le run échoue, le message d'erreur du backend s'affiche en rouge.

Le panneau n'existe que dans la page courante : si vous passez sur **Historique** ou rechargez la fenêtre, il disparaît, alors que le run continue sur le backend. Suivez-le alors depuis la page **Historique**, qui se rafraîchit toutes les cinq secondes.

## Page Historique : tableau des runs

La page **Historique** liste tous les runs enregistrés dans le workspace, qu'ils aient été lancés depuis l'interface, depuis l'Orchestrator ou directement par l'API. L'en-tête affiche le nombre de runs et un bouton **Actualiser** ; la liste se rafraîchit aussi automatiquement toutes les cinq secondes.

Chaque ligne affiche :

- **Run** : le nom du run (`train_...` pour les runs lancés depuis l'interface, `orch_...` pour ceux lancés par l'Orchestrator) et, en dessous, le nom du dataset s'il a été saisi.
- **Modèle** : la taille du modèle et, en dessous, le moteur.
- **Status** : **En attente**, **En cours** (avec une petite barre de progression), **Terminé**, **Erreur** ou **Arrêté**.
- **mAP50** et **mAP50-95** : les valeurs de la dernière évaluation, ou de la validation finale quand le run est terminé ("-" avant la première évaluation).
- **Durée** : du démarrage à la fin du run ; vide pendant le run.
- **Créé** : la date de création, au format jour/mois/année.
- Une icône de corbeille (**Supprimer**) : après confirmation ('Supprimer le run "<nom>" ?'), retire le run de la liste. Le dossier du run, avec ses poids et ses graphiques, reste sur le disque, et le run MLflow n'est pas touché.

Les runs sont listés du plus ancien en haut au plus récent en bas. Cliquez sur une ligne pour ouvrir sa fenêtre de détail.

## Fenêtre de détail d'un run : état, métriques et courbes

La fenêtre de détail d'un run s'ouvre au clic sur une ligne du tableau de l'**Historique**. Fermez-la avec la croix en haut à droite.

Le haut de la fenêtre affiche le nom du run et une ligne d'état : état, moteur et taille, nom du dataset, et **Durée:**. Deux tuiles donnent **mAP50** et **mAP50-95** comme dans le tableau.

Deux graphiques suivent quand le run a au moins deux epochs enregistrées dans son fichier `results.csv` :

- **Évolution mAP par epoch** : mAP50 (vert) et mAP50-95 (bleu) à chaque epoch évaluée. Les epochs sans évaluation sont ignorées, la ligne relie donc les points d'évaluation.
- **Pertes (train)** : la perte de boîte (orange) et la perte de classification (rouge) par epoch. Pour YOLOX, la perte de boîte est `iou_loss`.

Les graphiques se rafraîchissent toutes les dix secondes et permettent donc de suivre un run en cours.

La partie basse de la fenêtre affiche la barre de progression ("epoch courante / total epochs"), le chemin du `data.yaml`, **Meilleur modèle** (chemin du fichier de poids retenu en fin de run), le message d'erreur si le run a échoué, les **Hyperparamètres** réellement utilisés (valeurs par défaut du moteur fusionnées avec les vôtres) et les dates **Créé**, **Démarré** et **Terminé**.

## Fenêtre de détail d'un run : galerie Analyse du modèle

La section **Analyse du modèle** de la fenêtre de détail n'apparaît que pour les runs à l'état **Terminé**. Elle présente les graphiques d'analyse écrits par le moteur dans le dossier du run, regroupés par catégorie. Cliquez sur une image pour l'ouvrir en taille réelle dans une nouvelle fenêtre.

Pour un run YOLOX, les sections sont :

- **Matrice de confusion** : comment les objets de validation ont été classés, y compris les objets manqués et les fausses alarmes.
- **Courbes PR / P / R / F1** : courbe précision-rappel, puis précision, rappel et F1 en fonction du seuil de confiance.
- **Distribution des labels** : nombre de boîtes par classe et nuage des largeurs et hauteurs de boîtes.
- **Batches d'entraînement (augmentés)** : une grille d'images d'entraînement après mosaic, mixup, variation de couleur et retournement, telles que le réseau les voit.
- **Validation**, vérité terrain puis prédictions : le même échantillon de 16 images de validation au plus, avec les boîtes annotées, puis avec les boîtes prédites par le modèle.

La lecture de chaque graphique est expliquée dans [Concepts](concepts.fr.md), section *Graphiques d'analyse d'un run YOLOX*. Un autre moteur peut ajouter une section **Synthèse de l'entraînement**. Quand aucun graphique n'existe, le message "Aucun plot d'analyse (run non terminé ou plots désactivés)." s'affiche ; quand le moteur du run n'est plus installé, la raison s'affiche en orange à la place.

## Fenêtre de détail d'un run : meilleurs et pires cas d'inférence

Le bloc d'inférence (meilleurs et pires cas) de la fenêtre de détail exécute le meilleur modèle d'un run terminé sur les images de validation et montre où il réussit et où il peine.

1. Cliquez sur **Analyser best / worst cases (inférence sur le set de validation)**. Un message d'inférence en cours sur les images de validation s'affiche pendant le calcul.
2. Le résultat donne le nombre d'images évaluées (au plus les 200 premières images de validation), puis deux grilles de quatre images annotées :
   - **Meilleurs cas (détections nettes, haute confiance)** : images avec détections et la plus forte confiance moyenne.
   - **Pires cas (rien détecté / faible confiance)** : d'abord les images sans aucune détection, puis celles de plus faible confiance moyenne.
3. Chaque image affiche les boîtes prédites avec classe et confiance ; sa légende donne le nom du fichier, le nombre de détections et la confiance moyenne. Cliquez sur une image pour l'ouvrir en taille réelle.

Le résultat est calculé une fois et enregistré dans le dossier du run (`inference_cases/`) ; rouvrir le bloc affiche le résultat enregistré. Le classement repose uniquement sur la confiance, pas sur la vérité terrain : une image avec des fausses détections très confiantes peut figurer parmi les meilleurs cas. Pour une mesure face à la vérité terrain, utilisez l'évaluation d'Inference App.
