---
app: training
doc_type: workflows
audience: user
lang: fr
title: Workflows
order: 20
tags: [data.yaml, entraînement, fine-tuning, arrêt, analyse, mlflow, orchestrateur]
sources: [Training_App/frontend/src/pages/TrainingPage.tsx, Training_App/frontend/src/pages/RunsPage.tsx, Training_App/backend/services/yolox_dataset.py, Training_App/backend/services/training_service.py, Training_App/backend/routers/orchestrator.py, Training_App/backend/services/mlflow_logging.py]
---

# Workflows

## Préparer un dataset data.yaml pour Training App

Ce workflow construit un dossier de dataset lisible par Training App, quand il ne provient pas d'un export d'Annotation App.

*Prérequis* : des images et leurs annotations au format YOLO `.txt` (un fichier par image, une ligne `classe cx cy w h` par boîte, coordonnées normalisées entre 0 et 1) ; le dossier est accessible depuis la machine du backend.

1. Créez un dossier avec les images dans `images/train/` et `images/val/` (éventuellement `images/test/`).
2. Placez les fichiers de labels dans `labels/train/` et `labels/val/`, avec le même nom que l'image et l'extension `.txt` (`images/train/0001.jpg` -> `labels/train/0001.txt`). Une image sans fichier de labels est utilisée comme image sans objet.
3. Créez `data.yaml` à la racine du dossier :

   ```yaml
   path: .
   train: images/train
   val: images/val
   names:
     0: car
     1: person
   ```

   `path` est facultatif ; un `path` relatif est résolu depuis le dossier du `data.yaml`. `names` peut aussi être une simple liste (`[car, person]`) ; les numéros de classe des fichiers de labels doivent suivre son ordre.
4. Vérifiez que `val` contient des images annotées : elles servent à chaque évaluation, graphique et métrique du run.

*Résultat* : le chemin du `data.yaml` peut être saisi dans **Chemin data.yaml**. Un export d'Annotation App au format YOLO a déjà cette structure, et un fichier d'annotations `.ver` est aussi utilisable (voir [Concepts](concepts.fr.md), section *Formats de dataset : labels YOLO .txt et fichiers .ver*).

## Entraîner un modèle YOLOX depuis zéro

Ce workflow entraîne un nouveau détecteur YOLOX à partir de poids aléatoires, depuis la page **Training**.

*Prérequis* : un dataset avec un `data.yaml` (voir le workflow précédent) ; un GPU est fortement recommandé.

1. Ouvrez la page **Training**. Si une ligne **Moteur** est affichée, choisissez **YOLOX**.
2. Dans **Taille**, choisissez la taille du modèle. Commencez par `s` sur un GPU de milieu de gamme, `nano` ou `tiny` pour des essais rapides ou un GPU avec peu de mémoire, `m` à `x` quand la précision compte plus que la vitesse (voir [Concepts](concepts.fr.md)).
3. Laissez **Poids de depart (optionnel)** vide.
4. Saisissez le chemin du `data.yaml` dans **Chemin data.yaml**, et éventuellement un **Nom du dataset (optionnel)**.
5. Dans le groupe **Entrainement** de **Hyperparametres**, réglez **Epochs** (300 par défaut ; 50 à 100 suffisent pour un premier essai sur un petit dataset), **Batch size** (à réduire si le GPU manque de mémoire) et **Taille image** (un multiple de 32, 640 par défaut).
6. Gardez les autres valeurs par défaut pour un premier run.
7. Cliquez sur **Lancer** et vérifiez la notification "Run demarre".

*Résultat* : un nouveau run `train_<id>` apparaît **En cours** dans l'**Historique**. Son dossier `runs/<nom du run>/` dans le workspace reçoit les checkpoints, `results.csv`, `train_log.txt` et, dès la première évaluation (epoch 10 par défaut), les graphiques d'analyse. Un entraînement depuis zéro demande beaucoup d'epochs ; avec peu d'images, le fine-tuning depuis des poids pré-entraînés (workflow suivant) donne de bien meilleurs résultats.

## Fine-tuner depuis des poids YOLOX existants

Ce workflow démarre un run depuis un checkpoint YOLOX au lieu de poids aléatoires : les poids d'un run précédent, ou les poids officiels pré-entraînés sur COCO.

*Prérequis* : un checkpoint YOLOX `.pth` dont la taille correspond à celle que vous allez choisir ; le fichier est accessible au backend.

1. Récupérez les poids :
   - d'un run précédent : le chemin **Meilleur modèle** affiché dans sa fenêtre de détail de l'**Historique** (`best_ckpt.pth` de son dossier de run) ;
   - des publications officielles de YOLOX (`yolox_s.pth`, `yolox_m.pth`...), téléchargées manuellement et copiées sur la machine du backend (l'application ne télécharge jamais de poids, voir [Configuration](configuration.fr.md)).
2. Sur la page **Training**, choisissez la même **Taille** que le checkpoint (`s` pour `yolox_s.pth`).
3. Saisissez le chemin complet du fichier dans **Poids de depart (optionnel)**.
4. Renseignez **Chemin data.yaml** et les hyperparamètres. En fine-tuning, il faut en général moins d'epochs (par exemple 30 à 100).
5. Cliquez sur **Lancer**.

*Résultat* : le run démarre depuis les poids indiqués. Les couches dont la forme diffère du nouveau modèle (typiquement la couche de classification quand le nombre de classes a changé) gardent leur initialisation aléatoire, les autres sont chargées ; le journal `train_log.txt` du run liste les couches ignorées. Le compteur d'epochs, l'optimiseur et le planning repartent de zéro. Un fichier d'une autre extension que `.pth` est refusé avant le démarrage ; un chemin inexistant fait démarrer le run depuis zéro (voir [Dépannage](troubleshooting.fr.md)).

## Suivre un run et l'arrêter

Ce workflow suit un run pendant l'entraînement et l'arrête plus tôt si besoin.

*Prérequis* : un run a été lancé.

1. Sur la page **Training**, juste après **Lancer**, surveillez le panneau **Progression** : compteur d'epochs, barre de progression et tuiles de métriques sont mis à jour à la fin de chaque epoch.
2. Si vous quittez la page, ouvrez l'**Historique** : la ligne du run affiche son état et une petite barre de progression, rafraîchies toutes les cinq secondes. Cliquez sur la ligne pour ouvrir la fenêtre de détail : les graphiques **Évolution mAP par epoch** et **Pertes (train)** se rafraîchissent toutes les dix secondes.
3. Surveillez les métriques à chaque évaluation (toutes les 10 epochs par défaut, et à chaque epoch pendant les dernières epochs sans augmentation). Un mAP qui cesse de progresser alors que les pertes continuent de baisser signale un surapprentissage.
4. Pour arrêter le run, cliquez sur **Stop** sur la page **Training** (disponible uniquement sur la page qui a lancé le run, avant de la quitter). L'arrêt est pris en compte avant la prochaine itération d'entraînement.
5. Pour arrêter un run lancé ailleurs (autre page, Orchestrator, API), appelez `POST /api/training/<nom du run>/stop` (voir [Référence API](api-reference.fr.md)).

*Résultat* : un run arrêté est marqué **Arrêté** ; son dossier conserve les derniers checkpoints (`latest_ckpt.pth`, et `best_ckpt.pth` si une évaluation a déjà eu lieu), mais aucun chemin de meilleur modèle n'est enregistré sur le run et aucune version de modèle n'est enregistrée dans MLflow.

## Analyser un run terminé dans la page Historique

Ce workflow évalue la qualité d'un modèle entraîné avec les outils de la page **Historique**.

*Prérequis* : un run à l'état **Terminé**.

1. Ouvrez l'**Historique** et cliquez sur le run.
2. Lisez **mAP50** et **mAP50-95** : ils proviennent de la validation finale du run. Ne comparez des runs que sur le même jeu de validation.
3. Examinez le graphique **Évolution mAP par epoch** : une courbe encore montante à la fin indique que plus d'epochs aideraient ; une courbe qui redescend après un pic indique un surapprentissage.
4. Dans **Analyse du modèle**, ouvrez **Matrice de confusion** pour voir quelles classes sont confondues entre elles, manquées (ligne background) ou détectées à tort (colonne background).
5. Ouvrez **Courbes PR / P / R / F1** pour choisir un seuil de confiance pour l'inférence : le sommet de la courbe F1 est un bon choix par défaut.
6. Comparez les prédictions de **Validation** à la vérité terrain pour repérer les erreurs systématiques (petits objets manqués, boîtes trop grandes).
7. Cliquez sur **Analyser best / worst cases (inférence sur le set de validation)** pour voir les images où le modèle est le plus et le moins confiant.

*Résultat* : vous savez s'il faut entraîner plus longtemps, changer les hyperparamètres, ajouter des annotations pour les classes faibles, ou passer à Inference App. Le sens de chaque métrique et graphique est dans [Concepts](concepts.fr.md).

## Retrouver un run et son modèle dans MLflow App

Ce workflow retrouve l'enregistrement MLflow d'un run d'entraînement, pour comparer des runs ou récupérer un modèle enregistré.

*Prérequis* : MLflow est installé dans l'environnement de Training App ; MLflow App est lancée pour le même utilisateur et la même racine de workspaces.

1. Notez le nom du run dans l'**Historique** (par exemple `train_1a2b3c4d`).
2. Ouvrez MLflow App et sélectionnez l'experiment `training` (runs lancés depuis l'interface). Les runs lancés par l'Orchestrator sont dans l'experiment défini par le pipeline.
3. Retrouvez le run : depuis l'interface, le nom du run MLflow est le nom du run Training ; depuis l'Orchestrator, c'est `<nom du pipeline>/<libellé du nœud>`. Le tag `training_run` contient toujours le nom du run Training.
4. Ouvrez le run : paramètres (tous les hyperparamètres, `engine`, `model_size`, `model_weights`, `data_yaml`), métriques par epoch, `final_mAP50` et `final_mAP50-95`, et les artefacts `plots/` (graphiques d'analyse) et `model/` (meilleurs poids).
5. Dans le registre de modèles, les poids sont enregistrés sous `<experiment>/<taille>`, par exemple `training/yolox-s` : chaque run terminé ajoute une version, taguée avec le nom du dataset, les valeurs de mAP et le moteur.

*Résultat* : le run est retrouvé avec tout son contexte. Les noms de métriques sont légèrement modifiés par les règles de MLflow (parenthèses retirées : `metrics/mAP50(B)` devient `metrics/mAP50B`). L'emplacement du store est décrit dans [Configuration](configuration.fr.md).

## Utiliser le modèle entraîné dans Inference App

Ce workflow transmet les poids d'un run terminé à Inference App.

*Prérequis* : un run YOLOX **Terminé** ; Inference App est disponible.

1. Dans l'**Historique**, ouvrez le run et copiez le chemin **Meilleur modèle** (un fichier `best_ckpt.pth`).
2. Notez la taille du run (colonne **Modèle**, par exemple `yolox-s`) et les noms de classes de son `data.yaml`.
3. Dans Inference App, collez le chemin dans le champ des poids, choisissez le moteur **YOLOX** et saisissez la même taille dans le champ d'architecture.
4. Pour afficher les noms de classes au lieu de `class_0`, `class_1`..., renseignez `class_names` dans la configuration YAML d'Inference App, dans l'ordre de `names` du `data.yaml`.
5. Pour mesurer le modèle face aux annotations, utilisez l'évaluation d'Inference App avec le même `data.yaml`.

*Résultat* : Inference App exécute le modèle sur des images et des vidéos. Des poids produits par un moteur ne se chargent qu'avec ce même moteur : n'utilisez jamais des poids YOLOX avec un autre moteur.

## Entraîner depuis un pipeline Orchestrator

Ce workflow utilise Training App comme étape d'entraînement d'un pipeline Orchestrator.

*Prérequis* : Orchestrator App est lancée ; le graphe contient un nœud Training relié à un nœud Annotation (ou à une source de dataset), éventuellement précédé d'un nœud Optuna.

1. Dans l'Orchestrator, configurez le nœud Training : moteur, taille, epochs, batch, taille d'image et hyperparamètres optionnels. Choisissez le mode manuel ou automatique.
2. Exécutez le pipeline. L'Orchestrator démarre Training App si nécessaire ; la page **Training** affiche alors le mode orchestrateur.
3. En mode manuel, le pipeline s'arrête sur une étape qui vous demande d'entraîner à la main : ouvrez Training App depuis le lien du nœud, lancez le run avec les paramètres de votre choix, attendez **Termine**, puis cliquez sur **Continue** dans l'Orchestrator.
4. En mode automatique, l'Orchestrator envoie le chemin du dataset de l'export d'annotation. Training App cherche le `data.yaml` dans ce dossier ou ses sous-dossiers, ou extrait d'abord un export `.zip` dans `runs/<nom de l'archive>/`. Les meilleurs paramètres d'un nœud Optuna amont remplacent les hyperparamètres du nœud.
5. Suivez le run sous le nœud (l'Orchestrator interroge la liste des runs) ou dans l'**Historique**, où il apparaît sous le nom `orch_<id>`.

*Résultat* : l'Orchestrator reçoit le nom du run, le moteur, la taille, le chemin du meilleur modèle, les mAP finaux et le `data.yaml` résolu, et les transmet aux nœuds suivants (évaluation, inférence, DVC). L'appel attend la fin du run, jusqu'à 90 minutes par défaut (voir [Configuration](configuration.fr.md) pour les variables associées).

## Supprimer un run et libérer de l'espace disque

Ce workflow supprime les runs devenus inutiles et récupère leur espace disque.

*Prérequis* : les runs sont terminés ; vous avez accès au dossier du workspace sur la machine du backend.

1. Copiez ce que vous voulez garder : le fichier **Meilleur modèle**, et les graphiques si besoin. MLflow conserve sa propre copie des meilleurs poids et des graphiques des runs terminés.
2. Dans l'**Historique**, cliquez sur l'icône de corbeille du run et confirmez. Le run disparaît de la liste.
3. Ouvrez le dossier du workspace (`training_<user>` sous la racine des workspaces) et supprimez `runs/<nom du run>/` : l'interface ne le supprime pas.
4. Supprimez aussi les dossiers `runs/<nom de l'archive>/` créés quand l'Orchestrator a extrait des datasets `.zip`, dès qu'aucun pipeline n'en a besoin.

*Résultat* : l'espace disque est récupéré. Un dossier de run YOLOX contient un checkpoint par évaluation (`epoch_<N>_ckpt.pth`) en plus de `latest_ckpt.pth`, `last_epoch_ckpt.pth`, `best_ckpt.pth` et `last_mosaic_epoch_ckpt.pth` ; avec de gros modèles et de nombreuses évaluations, il peut atteindre plusieurs gigaoctets.
