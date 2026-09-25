---
app: mlflow
doc_type: troubleshooting
audience: both
lang: fr
title: Depannage
order: 50
tags: [erreurs, sqlite, store, lineage, orchestrator, artefacts]
sources: [MLflow_App/backend/core/mlflow_client.py, MLflow_App/backend/api/experiments.py, MLflow_App/backend/api/runs.py, MLflow_App/frontend/src/pages/LineagePage.tsx]
---

# Depannage

## Le point de statut de la barre laterale affiche "MLflow off"

**Symptome** : la barre laterale montre un point rouge et "MLflow off" au lieu d'un point vert et d'un numero de version.

**Cause** : `is_mlflow_running()` n'a pas pu confirmer que le store est accessible. Avec le store SQLite serverless par defaut, cela signifie que `search_experiments()` a echoue contre `mlflow_data/mlflow.db` ; avec un `MLFLOW_TRACKING_URI` explicite en `http://...` (mode serveur legacy), cela signifie qu'un `GET /health` vers ce serveur a echoue.

**Solution** :

1. Ouvrez directement `http://localhost:<port-backend>/api/mlflow-status` : `running: false` confirme que le probleme est dans le backend, pas juste un sondage frontend perime (il se rafraichit toutes les 15 secondes).
2. Verifiez que `mlflow_data/mlflow.db` existe sous le workspace attendu (voir [Configuration](configuration.fr.md#structure-du-workspace-sur-disque)) ; un decalage de workspace (mauvais `--user` ou `--workspace`) est la cause la plus frequente.
3. Si `MLFLOW_TRACKING_URI` a ete defini volontairement a une valeur `http://...`, confirmez que ce processus serveur tourne vraiment ; sinon retirez la variable pour revenir au defaut serverless.

## "Serveur MLflow non disponible. Verifier que MLflow tourne sur le port 5000."

**Symptome** : ce message exact apparait comme une erreur 503 en ouvrant la liste des experiences, alors qu'aucun processus serveur MLflow ni port 5000 n'est implique dans la configuration serverless normale.

**Cause** : ce texte d'erreur date d'avant le pivot serverless de l'app et n'a pas ete mis a jour ensuite (`backend/api/experiments.py`) ; il se declenche toujours correctement des que `is_mlflow_running()` retourne false, mais sa formulation decrit l'ancien echec du mode serveur, pas l'echec du fichier SQLite qui en est reellement la cause aujourd'hui.

**Solution** :

1. Ignorez la mention du port 5000 : elle ne s'applique pas a la configuration par defaut.
2. Suivez les etapes de "Le point de statut de la barre laterale affiche 'MLflow off'" ci-dessus ; la vraie cause est le fichier SQLite inaccessible, pas un port serveur.

## Une experience ou un run n'apparait pas apres un entrainement

**Symptome** : un entrainement vient de se terminer dans Training App (ou une autre app emettrice), mais le run est absent de Lineage, Comparer ou la page Experiments.

**Cause** : MLflow App lit uniquement le store SQLite du workspace de l'**utilisateur courant**. La cause la plus frequente est un decalage entre le nom d'utilisateur utilise pour lancer l'entrainement et celui utilise pour lancer MLflow App, qui resolvent vers deux dossiers `mlflow_<user>/mlflow_data/` differents.

**Solution** :

1. Confirmez que les deux apps ont ete lancees avec le meme `--user` (ou, depuis VisionNexus, la meme session).
2. Rechargez la page : Lineage et la page Experiments ne se rafraichissent pas automatiquement pour les nouveaux runs.
3. Verifiez que l'app emettrice a bien logue avec succes : son propre logging est entierement defensif (un entrainement continue meme si `mlflow` est absent ou echoue), donc un echec de logging ne produit aucune erreur dans l'entrainement mais saute silencieusement le run. Verifiez les propres logs de l'app emettrice pour un avertissement `mlflow_logging`.

## La page Lineage affiche "Orchestrator indisponible : lineage canonique inaccessible."

**Symptome** : la page Lineage echoue a charger son graphe avec cette erreur, alors meme que le point de statut MLflow de la barre laterale est vert.

**Cause** : le graphe de la page Lineage vient de l'endpoint `/api/lineage` de l'Orchestrator, redirige via `/orchestrator-api`, pas directement du propre store de MLflow. Cette erreur signifie que le backend de l'Orchestrator n'etait pas accessible sur `VITE_ORCHESTRATOR_BACKEND_PORT` (8060 par defaut), independamment du fait que le store MLflow lui-meme fonctionne.

**Solution** :

1. Confirmez que l'Orchestrator App tourne ; MLflow App ne le demarre pas automatiquement.
2. Si l'Orchestrator tourne sur un port non standard, verifiez que `VITE_ORCHESTRATOR_BACKEND_PORT` a ete correctement defini avant le demarrage du frontend (voir [Configuration](configuration.fr.md)).
3. Utilisez **Comparer** ou **Experiments** en attendant : les deux lisent directement le store MLflow et ne dependent pas de l'accessibilite de l'Orchestrator.

## La galerie de plots ou un lien d'artefact d'un run est casse

**Symptome** : la page de detail d'un run montre correctement ses metriques et parametres, mais la galerie **Plots** est vide ou un artefact echoue a s'ouvrir (404).

**Cause** : les metriques et parametres vivent dans `mlflow.db` ; les fichiers d'artefacts vivent separement sous `mlflow_data/artifacts/<experience>/<run>/`. Les deux peuvent se desynchroniser si le dossier `artifacts/` (ou le sous-dossier d'un run a l'interieur) a ete deplace, supprime, ou pas copie en meme temps lors d'une sauvegarde ou d'une migration de workspace.

**Solution** :

1. Confirmez que `mlflow_data/artifacts/` existe a cote de `mlflow.db` dans le workspace et a ete migre avec lui.
2. Relancez l'entrainement si les artefacts sont vraiment perdus ; l'enregistrement en base du run reste, mais ses fichiers ne peuvent pas etre recuperes depuis MLflow App lui-meme.
3. Quand vous copiez ou sauvegardez un workspace, copiez toujours `mlflow_data/` en entier (base de donnees et `artifacts/` ensemble), jamais `mlflow.db` seul.

## Model Registry ne montre aucune version pour un run qui devrait en avoir une

**Symptome** : un entrainement s'est termine avec une bonne metrique, mais aucune version n'apparait sous son nom de modele dans le Model Registry.

**Cause** : l'app emettrice n'enregistre une version de modele que si son fichier de poids final existe sur disque au moment du logging ; un entrainement qui echoue apres avoir calcule sa metrique mais avant de sauvegarder son checkpoint, ou dont la metrique n'est pas positive, n'appelle jamais `register_model`.

**Solution** :

1. Ouvrez la page de detail du run et verifiez **Artifacts** pour un fichier de poids sous `model/` ; son absence confirme que rien n'a ete enregistre pour ce run.
2. Verifiez les propres logs de l'app emettrice (Training App) autour de la fin de ce run pour une erreur pendant la sauvegarde du checkpoint.
3. C'est le comportement attendu, pas un bug de MLflow App : seuls les runs qui ont produit des poids et une metrique exploitable sont censes devenir des versions du registre.
