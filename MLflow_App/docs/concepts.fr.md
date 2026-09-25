---
app: mlflow
doc_type: concepts
audience: user
lang: fr
title: Concepts
order: 30
tags: [experience, run, metriques, artefacts, model registry, tags lineage, run_type]
sources: [MLflow_App/backend/core/mlflow_client.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/backend/api/models.py, Training_App/backend/services/mlflow_logging.py, Orchestrator_App/backend/core/graph_runner.py]
---

# Concepts

## Ce que MLflow repond dans cette suite

MLflow repond a une seule question : quelle experience a ete executee, avec quels parametres, quelles metriques, et quels artefacts ? C'est un enregistrement de ce qui s'est deja passe, pas un outil qui execute quoi que ce soit lui-meme. MLflow App est une interface de lecture et d'organisation sur cet enregistrement : chaque fait montre ici a ete ecrit par une autre app (surtout Training App) au moment ou elle a entraine, evalue ou fait de l'inference.

La question plus large de la suite, quel code et quelles donnees ont produit un resultat donne, appartient a Git et DVC, pas a MLflow : les propres tags de MLflow ne portent que des pointeurs vers eux (voir *Tags de lineage*, plus bas), il ne versionne ni le code ni les donnees lui-meme.

## Experience

Une experience est un conteneur nomme qui regroupe des runs lies. Dans cette suite, une experience regroupe chaque run d'un projet MLOps : les runs de training, evaluation, inference et HPO du meme graphe sont logues dans la meme experience (le nom du graphe), plutot qu'une experience par etape, pour qu'ouvrir une experience montre l'historique complet d'un projet en un seul endroit au lieu de fragments eparpilles. Une experience a un id, un nom, des tags, et un emplacement d'artefacts ou ses runs stockent des fichiers par defaut.

## Run, parametres, metriques et artefacts

Un run est une execution : un entrainement, une evaluation, un passage d'inference. Il appartient a exactement une experience et a un statut (`RUNNING`, `FINISHED`, `FAILED`, `KILLED`, `SCHEDULED`), une heure de debut et de fin, et trois types de donnees enregistrees :

- **Les parametres** sont les reglages utilises pour ce run (hyperparametres, moteur, taille de modele, chemin du dataset) : des chaines fixes enregistrees une fois au demarrage, montrees comme une table plate.
- **Les metriques** sont des mesures numeriques ; chacune peut avoir un historique de valeurs sur les etapes d'entrainement (une courbe epoch par epoch) en plus d'une valeur finale unique. Une metrique sans historique a quand meme sa derniere valeur enregistree.
- **Les artefacts** sont des fichiers : plots d'entrainement, fichiers de configuration, et les poids du modele quand il est enregistre. La page de detail du run montre une galerie pour les plots qu'un moteur joint sous un dossier `plots/`, et une table pour tout le reste.

## Model registry et versions

Le model registry conserve des modeles nommes, chacun avec une ou plusieurs versions. Une version est un jeu specifique de poids, produit par exactement un run, portant des tags enregistres au moment de l'enregistrement (son dataset source, son mAP50) et un stage : `None`, `Staging`, `Production` ou `Archived`.

La suite enregistre toujours un modele sous un nom scelle a son projet (par exemple `<projet>/yolox-s`), pour que des entrainements successifs sur le meme projet deviennent des versions `v1`, `v2`, ... d'un seul modele au lieu de modeles sans rapport avec des noms aleatoires. Deplacer une version entre stages est une decision manuelle prise depuis la page Model Registry ; rien dans la suite ne promeut automatiquement une version. Archiver une version ne supprime pas ses poids ou son run ; cela la marque seulement comme retiree.

## Conventions de la suite : nommage des runs, run_type et tags de lineage

Les runs crees depuis un pipeline Orchestrator suivent des conventions appliquees par l'Orchestrator au moment du logging (`_trace_of()` dans `graph_runner.py`), pas par MLflow App lui-meme, pour qu'un run demarre hors de la suite se comporte comme du MLflow ordinaire sans aucun de ces tags.

- **Nommage** : un run de pipeline est nomme `<nom_graphe>/<label_noeud>` au lieu d'un nom genere aleatoirement par MLflow, pour que la liste des runs se lise comme un projet et une etape plutot que comme un id opaque.
- **`run_type`** : `training`, `evaluation` ou `hpo`, derive du type de noeud qui a produit le run. Les pages Experiments et Lineage l'utilisent pour le badge de role et sa couleur, donc les runs d'un projet sont lisibles par type d'un coup d'oeil au lieu de tous se ressembler.
- **`orch_run_id`** : le run Orchestrator exact qui a produit ce run MLflow. C'est la cle unique qui relie un run a travers MLflow, DVC et les propres vues de l'Orchestrator ; chaque lien "ouvrir dans l'Orchestrator" ou "ouvrir dans DVC" de cette app est construit a partir de lui.
- **`graph_id`** et **`graph_name`** : identifient le pipeline (Sandgraph) lui-meme, independamment de quel run l'a produit.
- **`fork_parent_run`** : defini quand le pipeline a ete forke, pointant vers le `orch_run_id` du run parent. C'est ce qui permet a la page Experiments de dessiner un arbre de fork plutot qu'une liste plate.
- **`git_commit`** et **`dataset_version`** : ajoutes apres coup, quand un commit DVC est fait depuis l'Orchestrator pour le meme run (`POST /api/graphs/{id}/dvc-commit` reporte ces tags sur les runs MLflow correspondants). Un run sans commit DVC pour l'instant n'a simplement pas ces deux tags : rien n'est invente a leur place.

Un run sans aucun de ces tags (par exemple un run logue par un script hors de la suite, ou via l'ancien mode serveur `MLFLOW_TRACKING_URI=http://...`) reste un run MLflow parfaitement utilisable ; il n'apparait simplement pas avec un badge de role ou des liens de lineage.
