---
app: inference
doc_type: workflows
audience: user
lang: fr
title: Workflows
order: 20
tags: [inférence, tracking, évaluation, orchestrateur, config]
sources: [Inference_App/frontend/src/App.tsx, Inference_App/backend/main.py, Inference_App/backend/inference_core/runner.py, Inference_App/backend/inference_core/evaluation.py, Inference_App/backend/config.py]
---

# Workflows

## Lancer une inférence pure sur une image ou une vidéo

Ce workflow exécute un modèle entraîné sur une source et enregistre le résultat annoté, sans tracking.

*Prérequis* : un checkpoint YOLOX `.pth` accessible au backend (par exemple le meilleur modèle d'un run Training App) ; une source image, vidéo ou dossier d'images accessible au backend.

1. Dans la barre latérale, saisissez le chemin de la source dans **Source image, vidéo ou dossier** et cliquez sur **Lire le média**. L'aperçu et la ligne d'informations sur le média apparaissent.
2. Saisissez le chemin du checkpoint dans **Fichier de poids**, laissez **Moteur** sur `yolox`, et réglez **Architecture** sur la même taille avec laquelle le checkpoint a été entraîné (par exemple `yolox-s`).
3. Ajustez **Confiance** (augmentez-la pour garder moins de détections, plus sûres) et **NMS IoU** (baissez-le pour retirer plus de doublons qui se chevauchent) si besoin.
4. Sur l'onglet **Inférence**, cliquez sur **Inférence pure**, puis sur **Lancer**.
5. Lisez le résultat : nombre de frames, fps global, temps détecteur par frame, et l'image ou la vidéo annotée.

*Résultat* : un fichier annoté est écrit dans le dossier de sortie du run (`result.mp4` pour une source vidéo, `result<ext>` pour une image), et l'interface le lit ou l'affiche directement.

## Suivre des objets dans une vidéo avec ByteTrack

Ce workflow donne à chaque objet détecté une identité stable à travers une vidéo, pour du comptage ou de l'analyse de trajectoire.

*Prérequis* : identique au workflow précédent, avec une vidéo ou une séquence d'images comme source (ByteTrack a besoin de plusieurs frames pour être utile).

1. Chargez la source et réglez les poids comme dans le workflow précédent.
2. Cliquez sur **Multi-objet**. Une ligne **Tracker** apparaît.
3. Cliquez sur **ByteTrack**.
4. Cliquez sur **Lancer**.
5. Dans le résultat, le temps tracker par frame n'est plus nul ; la sortie annotée affiche un préfixe `#<id>` sur chaque boîte, stable d'une frame à l'autre tant que l'objet reste détecté avec une confiance raisonnable.

*Résultat* : la même sortie que l'inférence pure, avec des identités d'objets persistantes. Une identité peut quand même changer si l'objet est perdu plus longtemps que le buffer du tracker, ou quand deux objets similaires se croisent (voir [Concepts](concepts.fr.md)).

## Suivre un seul objet en cliquant dessus

Ce workflow suit un objet choisi à travers une vidéo sans s'appuyer sur le détecteur après la première frame, utile quand le détecteur est peu fiable sur les frames suivantes (flou de mouvement, occlusion partielle) mais que l'objet reste visuellement suivable.

*Prérequis* : une source vidéo ; l'objet d'intérêt doit être détecté par le modèle sur la première frame.

1. Chargez la source et réglez les poids.
2. Cliquez sur **SOT par clic**. L'aperçu devient cliquable.
3. Cliquez directement sur l'objet que vous voulez suivre ; un marqueur en croix apparaît, et la détection sous le clic est sélectionnée (le clic doit tomber dans une boîte détectée, pas seulement près de l'objet).
4. Cliquez sur **Lancer**.
5. Le résultat montre l'objet suivi avec une boîte mise en évidence et son étiquette de classe ; CSRT s'exécute sur chaque frame suivante sans rappeler le détecteur.

*Résultat* : une vidéo suivant un objet, robuste à des changements que le détecteur seul pourrait manquer, mais incapable de se rétablir automatiquement si CSRT dérive hors de l'objet (voir [Dépannage](troubleshooting.fr.md)).

## Évaluer un modèle sur un dataset YOLO

Ce workflow mesure la qualité de détection d'un modèle entraîné (mAP, précision-rappel, matrice de confusion) sur un jeu de validation annoté.

*Prérequis* : un `data.yaml` décrivant un dataset YOLO avec un split `val` d'images annotées (par exemple un export Training App ou Annotation App), accessible au backend ; les poids et le moteur à évaluer.

1. Réglez **Fichier de poids**, **Moteur** et **Architecture** dans la barre latérale comme pour l'inférence.
2. Ouvrez l'onglet **Évaluation** et saisissez le chemin du `data.yaml` dans le champ **data.yaml**.
3. Cliquez sur **Évaluer**.
4. Lisez **mAP50** et **mAP50-95**, et examinez la courbe précision-rappel, la courbe F1 en fonction de la confiance et la matrice de confusion.

*Résultat* : `metrics.json`, `pr_curve.png`, `f1_curve.png` et `confusion_matrix.png` sont écrits dans un nouveau dossier de run sous `runs/` du workspace, et affichés directement dans l'onglet. Seul le split `val` est évalué ; pour évaluer `test` à la place, utilisez directement l'API (voir [Référence API](api-reference.fr.md)).

## Enregistrer les réglages par défaut pour la prochaine session

Ce workflow fait des valeurs actuelles de la barre latérale (moteur, architecture, mode, tracker, confiance, IoU) les défauts affichés à la prochaine ouverture de l'application.

*Prérequis* : aucun.

1. Réglez les champs de la barre latérale, ainsi que le mode et le tracker sur l'onglet **Inférence**, comme vous les voulez par défaut.
2. Ouvrez l'onglet **Config YAML** : la zone de texte reflète déjà les valeurs actuellement en mémoire seulement si vous n'avez pas rechargé la page depuis leur modification ; sinon modifiez directement les champs YAML (`engine`, `model_size`, `mode`, `tracker`, `confidence`, `iou`, plus tout champ spécifique au tracking de [Configuration](configuration.fr.md)).
3. Cliquez sur **Enregistrer et appliquer**.

*Résultat* : `config.yaml` est écrit dans le workspace ; la prochaine fois que l'application est ouverte pour ce workspace, la barre latérale et le mode partent de ces valeurs. Cela n'affecte pas la configuration de nœud propre à l'Orchestrator, qui lit plutôt le `config/defaults.yaml` embarqué de l'application (voir le workflow suivant).

## Exécuter Inference App depuis un pipeline Orchestrator

Ce workflow utilise Inference App comme étape d'inférence ou d'évaluation d'un pipeline Orchestrator.

*Prérequis* : Orchestrator App est lancée ; le graphe contient un nœud Inference relié à un nœud Training (pour le modèle) et une source de média ou un dataset.

1. Dans l'Orchestrator, configurez le nœud Inference : moteur, taille de modèle, mode (tracking ou évaluation), et les surcharges issues des groupes de `config/defaults.yaml` (seuils, paramètres de tracker).
2. Exécutez le pipeline. L'Orchestrator appelle directement `POST /api/orchestrator/infer` (tracking, mode headless) ou `POST /api/orchestrator/evaluate` (évaluation détection ou benchmark tracker) ; Inference App n'a pas besoin d'avoir sa propre interface ouverte pour cela.
3. Pour un nœud de tracking, l'Orchestrator transmet le chemin du modèle résolu depuis le nœud Training amont, le dossier de séquence, et le choix de tracker ; l'appel bloque jusqu'à la fin de l'inférence et renvoie des chiffres de benchmark (fps, détections, pistes uniques).
4. Pour un nœud d'évaluation, l'Orchestrator transmet `data_yaml` (résolu depuis le dataset du nœud Training quand disponible) et les surcharges d'évaluation ; l'appel renvoie les mêmes métriques que celles affichées dans l'onglet **Évaluation**.

*Résultat* : le pipeline reçoit des chiffres de benchmark ou d'évaluation pour les nœuds suivants ou pour le rapport de pipeline, sans aucune étape manuelle dans Inference App. Voir [Référence API](api-reference.fr.md) pour les formes exactes de requête et de réponse.
