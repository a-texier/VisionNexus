---
app: explorer
doc_type: readme
audience: both
lang: fr
title: Dataset Explorer
order: 0
tags: [dataset, clip, faiss, umap, clustering, doublons, subsets]
sources: [Dataset_Explorer_App/backend/main.py, Dataset_Explorer_App/launcher.py, _lib/launcher_engine.py, Dataset_Explorer_App/frontend/src/App.tsx]
---

# Dataset Explorer

## Ce que fait Dataset Explorer

Dataset Explorer est l'outil de curation de datasets de la suite Computer Vision. Il répond à une question simple, avant toute annotation ou tout entraînement : qu'y a-t-il vraiment dans mes dossiers d'images ? Il encode chaque image avec le modèle CLIP ViT-B/32, puis permet de voir tout le dataset sous forme de carte, d'y chercher en texte libre, de traquer les doublons et d'extraire les images qui valent la peine d'être annotées.

Fonctions principales :

- **Scanner un dossier** (disque local, partage monté ou chemin réseau Windows) et indexer ses images avec miniatures, fichiers d'annotations optionnels (`.ver`, YOLO) et un tableau de métadonnées CSV ou Excel optionnel.
- **Pipeline d'embeddings** : embeddings CLIP, index de similarité FAISS, carte 2D (UMAP, t-SNE ou PCA), clusters (KMeans ou HDBSCAN) et score de rareté par image, le tout calculé en tâche de fond.
- **Explorer** : une carte interactive avec sélection au lasso, une recherche par texte dans un dataset, et un **Catalogue** qui interroge tous les datasets prêts à la fois, par contenu d'image ou par métadonnées.
- **Nettoyer** : groupes de doublons dans un dataset, dans un subset ou entre datasets, avec des décisions garder ou rejeter qui ne suppriment jamais de fichier.
- **Extraire** : des subsets (dossiers de liens symboliques ou de copies) que l'on exporte vers Annotation App.
- **Partager** : une galerie globale qui rend un dataset visible à tous les utilisateurs de la même installation, avec des dossiers partagés pour l'organiser.

L'application tourne dans un navigateur ou dans le lanceur VisionNexus, en local ou avec le backend sur une VM Linux à GPU. Elle ne modifie ni ne supprime jamais vos images originales.

## Place de Dataset Explorer dans le pipeline de la suite

Dataset Explorer est la première étape du pipeline de la suite Computer Vision :

1. **Dataset Explorer** scanne les dossiers d'images bruts, élimine la redondance et exporte un subset.
2. **Annotation App** importe ce subset (le dossier d'export est son dossier `imports/` par défaut) et l'annote.
3. **Training App** et **Optuna App** entraînent et optimisent un modèle sur le dataset annoté ; **Inference App** l'exécute ; **MLflow App** et **DVC App** suivent les runs et les versions de données.

L'**Orchestrator App** peut piloter Dataset Explorer automatiquement : il charge un dataset, lance les embeddings, crée un subset à partir d'une requête texte et l'exporte dans le workspace d'Annotation App (voir la section *Piloter Dataset Explorer depuis un pipeline de l'Orchestrateur* de [Procédures](workflows.fr.md)). Dataset Explorer fonctionne aussi seul, sans aucune autre application.

Chaque utilisateur a un workspace isolé (`explorer_<utilisateur>` sous la racine des workspaces) qui contient la base, les miniatures, les index FAISS, les subsets et les paramètres. L'arborescence est décrite dans [Configuration](configuration.fr.md).

## Démarrage rapide en cinq étapes

Ce démarrage rapide suppose que l'application est installée et lancée depuis VisionNexus, ou avec `python launcher.py --app explorer --workspace <racine> --user <nom>` depuis la racine de la suite (voir [Configuration](configuration.fr.md)).

1. Sur la page **Dataset Gallery**, saisissez le chemin du dossier dans **Ajouter un dataset** (ou glissez le dossier sur le champ dans VisionNexus), éventuellement un nom et un nombre de clusters, puis cliquez sur **Scanner**.
2. Sur la carte du nouveau dataset dans **Mon workspace**, cliquez sur l'icône d'épingle pour l'épingler dans le **Playground**.
3. Ouvrez **Playground** dans la barre latérale et cliquez sur **Embeddings** sur le dataset. Attendez que le statut passe à `ready`.
4. Cliquez sur **Carte**, tracez un lasso autour d'un groupe de points, saisissez un nom et cliquez sur **Créer subset**. **Recherche** et **Doublons** fonctionnent de la même façon depuis le Playground.
5. Ouvrez **Subsets**, puis cliquez sur **Exporter** sur votre subset : ses images sont liées dans le dossier d'imports d'Annotation App.

Le tutoriel interactif (bouton **Tutoriel** en haut de la barre latérale) parcourt les mêmes étapes sur dix images d'exemple en quelques minutes.

## Pages de la documentation de Dataset Explorer

La documentation de Dataset Explorer est découpée en neuf pages. Les pages utilisateur viennent d'abord, les pages développeur ensuite.

- [Guide utilisateur](user-guide.fr.md) : visite écran par écran de chaque page, panneau et bouton, et quand s'en servir.
- [Procédures](workflows.fr.md) : tâches complètes de bout en bout en étapes numérotées, du scan d'un dossier à l'export d'un subset ou au partage d'un dataset.
- [Concepts](concepts.fr.md) : datasets, statuts, embeddings CLIP, score de similarité, carte 2D, clustering, rareté, doublons, subsets et galerie globale, avec leurs limites.
- [Configuration](configuration.fr.md) : installation, poids CLIP, commandes de lancement, ports, variables d'environnement, arborescence du workspace et chaque option de la page **Paramètres**.
- [Dépannage](troubleshooting.fr.md) : problèmes connus décrits par leur symptôme, avec cause et solution.
- [Architecture](architecture.fr.md) : composants backend et frontend, pipeline d'embeddings, tâches de fond, stockage et invariants à ne pas casser.
- [Référence API](api-reference.fr.md) : endpoints HTTP groupés par domaine.
- [Carte du code](code-map.fr.md) : où vit chaque fonction dans le code et où la modifier.
