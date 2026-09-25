---
app: mlflow
doc_type: user-guide
audience: user
lang: fr
title: Guide utilisateur
order: 10
tags: [lineage, model registry, comparer, detail run, experiences, page doc]
sources: [MLflow_App/frontend/src/App.tsx, MLflow_App/frontend/src/pages/LineagePage.tsx, MLflow_App/frontend/src/pages/ModelRegistryPage.tsx, MLflow_App/frontend/src/pages/CompareRunsPage.tsx, MLflow_App/frontend/src/pages/RunDetailPage.tsx, MLflow_App/frontend/src/pages/ExperimentsPage.tsx, MLflow_App/frontend/src/pages/DocPage.tsx, MLflow_App/frontend/src/components/UserBadge.tsx]
---

# Guide utilisateur

## Barre laterale et navigation de MLflow App

La barre laterale a gauche de MLflow App est toujours visible. Sous le titre de l'app, un point de statut et un texte montrent si le store MLflow est accessible ("MLflow x.y.z" en vert) ou non ("MLflow off" en rouge), rafraichi toutes les 15 secondes. Quatre entrees suivent : **Lineage** (la page d'accueil), **Model Registry**, **Comparer** et **Doc**. Une cinquieme page, **Experiments**, existe sur `/experiments` mais n'a pas d'entree dans la barre laterale ; atteignez-la en tapant l'URL directement, ou depuis la page d'un run quand vous avez besoin de la navigation classique par experience plutot que de la vue Lineage centree sur le pipeline.

Le badge utilisateur en bas montre le nom d'utilisateur donne par le lanceur et quatre commandes : **Ouvrir workspace** ouvre le dossier du workspace dans l'explorateur de fichiers de la machine qui fait tourner le backend, **Historique des workspaces** liste les workspaces recents de cette app, **Utilisateurs connectes** liste les autres utilisateurs qui font tourner MLflow App sur la meme machine, et le bouton de langue bascule entre francais et anglais. Quand l'app est ouverte depuis VisionNexus, VisionNexus impose la langue.

## Page Lineage

La page Lineage est la page d'accueil. Elle construit un graphe depuis l'endpoint de lineage canonique de l'Orchestrator, combine aux runs du store courant, et montre : un dataset source commun, une image par run de pipeline (un fork dessine avec une bordure rose en pointilles, un run parent avec une bordure ciel en pointilles), le subset utilise par chaque run, et les etapes MLflow produites par ce run, chacune portant son badge de role et quelques metriques.

Commandes de la barre d'outils : le champ de recherche filtre par nom, id de run ou dataset ; **Compact/Décompact** replie ou deplie les etapes de tous les runs a la fois, et un chevron sur une seule image de run fait de meme pour ce run seul ; le bascule liste/graphe passe a une vue en cartes plates des memes donnees, utile quand le graphe est charge ; **Comparer les runs** ouvre la propre page de lineage de l'Orchestrator.

Cliquez l'en-tete d'une image de run pour ouvrir son Insight (icone graphique) ou Sandgraph (icone reseau) dans l'Orchestrator App. Cliquez n'importe quel noeud (le dataset source, un subset, un run, une etape) pour ouvrir son panneau de detail a droite : il montre l'id de run MLOps, et des boutons vers la vue de comparaison propre a MLflow, l'Insight et le Sandgraph de l'Orchestrator, et, pour une etape, un lien direct vers la [page de detail du run](#page-de-detail-dun-run) de cette app.

## Page Model Registry

La page Model Registry liste chaque modele enregistre, rafraichie avec un bouton de rafraichissement manuel (pas de rafraichissement auto). Chaque ligne de modele montre son nom, un badge par stage connu parmi ses dernieres versions, et sa date de derniere mise a jour ; cliquer dessus deplie la table complete des versions pour ce modele.

Les colonnes de la table des versions sont **Version**, **Dataset** (le tag dataset enregistre a la creation), **mAP50**, **Stage**, **Run** (un lien vers la [page de detail du run](#page-de-detail-dun-run) qui a produit cette version, quand elle est connue), **Créé le**, et **Transition** : un bouton par stage possible (`None`, `Staging`, `Production`, `Archived`). Cliquez un stage pour y deplacer la version immediatement ; le bouton du stage courant est desactive. Un nom de modele qui se termine par un prefixe de projet (par exemple `<projet>/yolox-s`) signifie que chaque version sous ce nom est un entrainement successif du meme modele au sein de ce projet, pas des modeles sans rapport.

## Page Comparer (comparer des runs)

La page Comparer selectionne des runs par experience plutot que par le graphe du pipeline. L'etape 1 choisit une **expérience** dans une liste deroulante ; l'etape 2 liste ses runs dans une table avec une case a cocher par ligne, son badge de statut et ses premieres metriques, et un compteur du nombre selectionne. Les lignes sont cliquables partout, pas seulement sur la case.

**Comparer N run(s)** exige au moins 2 et au plus 10 runs selectionnes. Une fois lance, l'etape 3 montre un graphique en ligne par metrique (une liste deroulante restreint a une seule metrique quand plusieurs sont disponibles, chaque run dessine dans une couleur distincte avec une legende) et une table de chaque valeur de parametre a travers les runs selectionnes, avec un tiret la ou un run n'a pas ce parametre.

## Page de detail d'un run

Ouverte depuis n'importe quelle ligne de run dans l'app (`/runs/{runId}`), cette page montre : le nom et l'id du run, son badge de statut, l'heure de debut, la duree et l'id d'experience ; une section **Lineage** avec les tags propres a la suite quand ils sont presents (`orch_run_id`, `graph_id`, `git_commit`, `dataset_version`, `node_label`, `stage`) ; un graphique par metrique qui a un historique enregistre sur les etapes d'entrainement ; une grille des valeurs de metriques finales ; une table de chaque parametre ; une galerie des plots d'entrainement que le moteur a joints sous son dossier d'artefacts `plots/`, le cas echeant ; et une table de chaque artefact avec son type et sa taille.

## Page Experiments

La page Experiments (`/experiments`, sans lien dans la barre laterale) liste chaque experience avec son id et sa date de creation, et permet d'en creer une (**Nouvelle expérience**, nom seul) ou d'en supprimer une. Deplier une experience montre ses runs ordonnes en arbre de fork : un run dont le tag `fork_parent_run` correspond au `orch_run_id` d'un autre run est indente sous son parent avec une icone de fork, donc un pipeline forke dans l'Orchestrator se lit ici comme un arbre plutot que comme une liste plate. Chaque ligne montre le badge **Rôle** du run (Training, Evaluation, Inference ou HPO, depuis son tag `run_type`), son **ID unifié** (les 8 premiers caracteres de `orch_run_id`), son statut, sa date de debut et ses premieres metriques ; cliquez une ligne pour ouvrir sa [page de detail de run](#page-de-detail-dun-run).

## Page Doc

La page Doc est une courte explication propre a la suite de la facon dont MLflow est reellement utilise ici, distincte du guide MLOps general de l'Orchestrator (Git vs DVC vs MLflow). Elle couvre le store SQLite serverless, a quoi servent Comparer et le Model Registry, la convention de nommage et de tags de lineage appliquee aux runs Orchestrator (`graph_id/NodeLabel`, tags `orch_run_id`, `graph_id`, `git_commit`, `dataset_version`), et un exemple concret qui retrace un run depuis son id jusqu'a son commit Git et sa version de dataset.
