---
app: training
doc_type: readme
audience: both
lang: fr
title: Training App
order: 0
tags: [entraînement, yolox, détection d'objets, moteurs, mlflow, orchestrateur]
sources: [Training_App/backend/main.py, Training_App/frontend/src/App.tsx, Training_App/launcher.py, _lib/launcher_engine.py]
---

# Training App

## Ce que fait Training App

Training App entraîne les modèles de détection d'objets de la suite Computer Vision. Vous lui donnez un dataset décrit par un fichier `data.yaml`, vous choisissez une taille de modèle et ses hyperparamètres, et l'application entraîne le modèle en arrière-plan en affichant la progression epoch par epoch.

Fonctions principales :

- **Moteur YOLOX intégré** : six tailles de modèle, de `yolox-nano` à `yolox-x`, entraînées par un entraîneur maison construit sur le code YOLOX embarqué (Apache-2.0). Aucune bibliothèque d'entraînement externe n'est nécessaire.
- **Moteurs enfichables** : d'autres moteurs d'entraînement peuvent être installés sous forme de plugins. Le moteur se choisit run par run ; quand seul YOLOX est installé, aucun choix de moteur n'est affiché.
- **Formulaire d'hyperparamètres complet** : epochs, taille de batch, taille d'image, planning du taux d'apprentissage, optimiseur et augmentation de données, avec les valeurs par défaut du moteur.
- **Suivi en temps réel** : les pertes et les métriques de détection (mAP50, mAP50-95, précision, rappel) sont envoyées à l'interface à la fin de chaque epoch.
- **Historique et analyse** : chaque run est conservé avec ses paramètres, ses courbes, ses graphiques d'analyse (matrice de confusion, courbes précision-rappel, distribution des labels, batches augmentés, prédictions de validation) et une inférence à la demande des meilleurs et pires cas sur les images de validation.
- **Suivi MLflow** : chaque run est journalisé automatiquement (paramètres, métriques par epoch, graphiques, poids et version de modèle enregistrée) dans le store MLflow de l'utilisateur, lisible par MLflow App.

Training App fonctionne seule, ou comme étape d'entraînement d'un pipeline Orchestrator ; le dataset et les paramètres sont alors fournis automatiquement.

## Place de Training App dans le pipeline de la suite

Training App se situe après l'annotation et avant l'inférence dans la suite Computer Vision :

1. **Dataset Explorer** sélectionne des images, **Annotation App** les annote et exporte un dataset YOLO (un dossier avec un `data.yaml`).
2. **Training App** entraîne un détecteur sur ce dataset. **Optuna App** peut rechercher ses hyperparamètres avec les mêmes moteurs et catalogues.
3. **Inference App** exécute les poids entraînés sur des images et des vidéos et les évalue sur un dataset.
4. **MLflow App** affiche les runs et les versions de modèle journalisés par Training App ; **DVC App** versionne les datasets.

L'**Orchestrator App** enchaîne ces étapes : son nœud Training appelle Training App, attend la fin du run et transmet les poids obtenus et le `data.yaml` résolu aux nœuds suivants.

Chaque utilisateur dispose d'un workspace isolé (`training_<user>` sous la racine des workspaces) qui contient la base des runs, les dossiers de runs et les réglages. L'arborescence est décrite dans [Configuration](configuration.fr.md).

## Démarrage rapide en cinq étapes

Ce démarrage rapide suppose que l'application est installée et lancée depuis VisionNexus, ou avec `python launcher.py --app training --workspace <racine> --user <nom>` depuis la racine de la suite (voir [Configuration](configuration.fr.md)).

1. Exportez un dataset YOLO depuis Annotation App, ou préparez un dossier avec `images/`, `labels/` et un `data.yaml` (voir [Workflows](workflows.fr.md)).
2. Sur la page **Training**, choisissez une taille dans **Taille** (par exemple `s`) et saisissez le chemin du `data.yaml` dans **Chemin data.yaml**.
3. Ouvrez le groupe **Entrainement** de **Hyperparametres** et réglez **Epochs** (par exemple 50) et **Batch size** selon la mémoire de votre GPU.
4. Cliquez sur **Lancer**. Le panneau **Progression** affiche l'epoch en cours, la barre de progression et les dernières métriques.
5. Quand le run est **Termine**, ouvrez la page **Historique** et cliquez sur le run pour voir ses courbes, ses graphiques d'analyse et le chemin du meilleur modèle.

## Pages de documentation de Training App

La documentation de Training App est répartie en neuf pages. Les pages utilisateur viennent d'abord, les pages développeur ensuite.

- [Guide utilisateur](user-guide.fr.md) : chaque page, panneau, champ et bouton de l'interface.
- [Workflows](workflows.fr.md) : tâches complètes en étapes numérotées, de la préparation d'un dataset au fine-tuning, à l'analyse d'un run, à sa recherche dans MLflow et à l'exécution d'un pipeline.
- [Concepts](concepts.fr.md) : runs, moteurs, tailles de modèle, hyperparamètres, évaluation, mAP et autres métriques, checkpoints et graphiques, expliqués simplement.
- [Configuration](configuration.fr.md) : prérequis, commandes de lancement, ports, variables d'environnement, arborescence du workspace, poids, store MLflow et plugins.
- [Dépannage](troubleshooting.fr.md) : problèmes connus classés par symptôme, avec cause et solution.
- [Architecture](architecture.fr.md) : composants, contrat des moteurs, cycle de vie d'un run, flux d'événements, entraîneur YOLOX, journalisation MLflow et invariants.
- [Référence API](api-reference.fr.md) : endpoints HTTP et SSE, y compris le contrat Orchestrator.
- [Carte du code](code-map.fr.md) : où se trouve chaque fonction dans le code et où la modifier.
