---
app: optuna
doc_type: readme
audience: both
lang: fr
title: Optuna App
order: 0
tags: [optuna, hpo, hyperparametres, etude, trial, tpe, yolox]
sources: [Optuna_App/backend/main.py, Optuna_App/launcher.py, _lib/launcher_engine.py, Optuna_App/frontend/src/App.tsx]
---

# Optuna App

## Ce que fait Optuna App

Optuna App est l'outil d'optimisation d'hyperparametres (HPO) de la suite Computer Vision. Il execute des etudes Optuna : chaque etude essaie de nombreuses combinaisons d'hyperparametres d'entrainement (taux d'apprentissage, probabilites d'augmentation, rotation...), entraine un modele pour chaque combinaison, mesure une metrique comme le mAP50, et retient la combinaison au meilleur score.

L'app couvre deux facons de travailler :

- **Etudes autonomes** : vous creez une etude dans l'interface, la pointez vers un script Python qui entraine et imprime un score, decrivez l'espace de recherche, puis la lancez. Un prereglage remplit tout pour optimiser un entrainement de detection avec un moteur de Training App (YOLOX par defaut).
- **Etudes pilotees par l'Orchestrator** : un noeud Optuna d'un pipeline Orchestrator demande a l'app d'executer une etude complete sur le dataset exporte par Annotation App, puis transmet les meilleurs parametres au noeud Training aval.

Pour chaque etude, la page d'etude montre la progression, le meilleur trial, une table de tous les trials avec leurs fichiers de resultat, et un tableau de bord d'analyse (historique d'optimisation, espace de recherche, importance des parametres, coordonnees paralleles). Quand des trials echouent, la page les regroupe par cause racine et dit quoi corriger.

Toutes les etudes d'un utilisateur vivent dans un seul fichier SQLite (`optuna.db`) du workspace de l'utilisateur, donc elles survivent aux redemarrages et peuvent etre rouvertes a tout moment.

## Place d'Optuna App dans le pipeline de la suite

Optuna App se situe entre le dataset annote et l'entrainement final :

1. **Dataset Explorer** selectionne des images et **Annotation App** les annote et exporte un dataset YOLO.
2. **Optuna App** lance des entrainements courts (10 epochs par trial par defaut) sur ce dataset pour trouver de bons hyperparametres.
3. **Training App** lance l'entrainement final, long, avec les meilleurs parametres, en utilisant le meme moteur que les trials.
4. **MLflow App** montre les runs d'entrainement et **DVC App** peut versionner les meilleurs parametres avec le dataset et le modele.

Les trials reutilisent directement les moteurs d'entrainement de Training App (aucune copie du code d'entrainement), c'est pourquoi Training App doit etre present a cote d'Optuna App pour les etudes de detection. Les etudes sur votre propre script fonctionnent sans lui.

Chaque utilisateur dispose d'un workspace isole (`optuna_<user>` sous la racine des workspaces) contenant la base de donnees des etudes et les fichiers de chaque trial. La structure est decrite dans [Configuration](configuration.fr.md).

## Demarrage rapide en cinq etapes

Ce demarrage rapide optimise un entrainement de detection YOLOX sur un dataset YOLO. Il suppose que l'app est lancee depuis VisionNexus ou avec `python launcher.py --app optuna --workspace <racine> --user <nom>` depuis la racine de la suite.

1. Sur la page des etudes, cliquez **Nouvelle étude**, tapez un nom, choisissez **maximize** et cliquez **Créer**.
2. Cliquez sur l'etude dans la liste, puis **Lancer une optimisation**.
3. Dans le panneau **Optimiser un entraînement de détection**, choisissez la taille du modele, les epochs par trial et tapez le chemin absolu du `data.yaml` du dataset, puis cliquez **Préremplir l'étude**.
4. Reglez **Nombre de trials** (20 est un bon depart) et cliquez **Lancer**. Le journal de sortie affiche chaque trial au fur et a mesure.
5. Revenez a la page de l'etude : quand elle est terminee, la carte du meilleur trial liste les meilleurs parametres a utiliser dans Training App.

## Pages de documentation d'Optuna App

La documentation d'Optuna App est repartie en neuf pages. Les pages utilisateur viennent d'abord, les pages developpeur en dernier.

- [Guide utilisateur](user-guide.fr.md) : chaque page, panneau, graphique et bouton de l'interface, et quand utiliser chacun.
- [Workflows](workflows.fr.md) : taches completes en etapes numerotees, d'une premiere etude au diagnostic de trials echoues et a l'execution d'une etude depuis un pipeline Orchestrator.
- [Concepts](concepts.fr.md) : etude, trial et etats de trial, espace de recherche, objectif et direction, sampler TPE, pruner, meilleurs parametres, importance des parametres, et le contrat de resultat d'un trial.
- [Configuration](configuration.fr.md) : installation, commandes de lancement, ports, variables d'environnement, structure du workspace et valeurs par defaut des trials.
- [Depannage](troubleshooting.fr.md) : problemes connus decrits par leur symptome, avec cause et solution.
- [Architecture](architecture.fr.md) : composants backend et frontend, les deux moteurs d'optimisation, stockage, diffusion des logs et invariants.
- [Reference API](api-reference.fr.md) : endpoints HTTP regroupes par domaine.
- [Carte du code](code-map.fr.md) : ou vit chaque fonctionnalite dans le code et ou la modifier.
