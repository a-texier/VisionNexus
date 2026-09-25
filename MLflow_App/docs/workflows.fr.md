---
app: mlflow
doc_type: workflows
audience: user
lang: fr
title: Workflows
order: 20
tags: [lineage, comparer runs, model registry, promouvoir, orchestrator, dvc]
sources: [MLflow_App/frontend/src/pages/LineagePage.tsx, MLflow_App/frontend/src/pages/CompareRunsPage.tsx, MLflow_App/frontend/src/pages/ModelRegistryPage.tsx, MLflow_App/frontend/src/pages/RunDetailPage.tsx, MLflow_App/backend/api/runs.py, Orchestrator_App/backend/api/graphs.py]
---

# Workflows

## Tracer un run de pipeline de son dataset a ses metriques

Ce workflow suit un run de pipeline Orchestrator de bout en bout sur la page Lineage, depuis les donnees qu'il a utilisees jusqu'aux chiffres qu'il a produits.

*Prerequis* : au moins un run de pipeline a ete execute avec un graphe Orchestrator qui atteint une etape de training ou d'evaluation.

1. Ouvrez MLflow App : la page Lineage se charge avec chaque run du store courant.
2. Tapez une partie de l'id du run, le nom du dataset ou le nom du graphe dans le champ de recherche pour restreindre le graphe a un run.
3. Regardez le noeud ambre **Dataset source commun** en haut et le noeud **Subset utilisé** sous l'image du run : ensemble, ils disent exactement quelles images ont produit ce run.
4. Cliquez un noeud d'etape violet sous le run pour ouvrir son panneau de detail, puis suivez **Ouvrir le run MLflow détaillé** vers la [page de detail de run](user-guide.fr.md#page-de-detail-dun-run) complete.
5. Sur la page de detail du run, lisez la section **Lineage** pour les tags de commit Git et de version de dataset, puis les graphiques de metriques et les metriques finales.

*Résultat* : vous avez le dataset exact, la version de code et les metriques d'un run sans quitter MLflow App, avec des liens vers l'Insight Orchestrator et la version DVC correspondants si besoin d'aller plus loin.

## Comparer plusieurs runs sur une metrique

Ce workflow met deux runs ou plus cote a cote pour voir l'effet d'un changement d'hyperparametre ou d'une recherche HPO.

*Prerequis* : au moins deux runs existent dans la meme experience.

1. Ouvrez **Comparer**.
2. Choisissez l'experience qui regroupe les runs a comparer dans la liste deroulante de l'etape 1.
3. A l'etape 2, cliquez les lignes des runs a comparer (2 a 10). Le compteur a cote du titre de section confirme la selection.
4. Cliquez **Comparer N run(s)**.
5. A l'etape 3, utilisez la liste deroulante de metrique pour vous concentrer sur une metrique a la fois si l'etude en a touche plusieurs ; chaque ligne coloree est un run, nomme d'apres son nom ou le debut de son id.
6. Descendez jusqu'a **Paramètres comparés** pour voir exactement quel hyperparametre differe entre les runs selectionnes.

*Résultat* : une vue cote a cote des courbes et parametres des runs selectionnes, utile juste apres une etude Optuna ou un balayage manuel de reglages pour decider quel run garder.

## Promouvoir une version de modele en Production

Ce workflow deplace une version de modele entrainee a travers ses stages de cycle de vie apres l'avoir validee.

*Prerequis* : au moins une version de modele est enregistree (Training App enregistre automatiquement les meilleurs poids d'un run quand l'entrainement se termine avec une metrique positive).

1. Ouvrez **Model Registry**.
2. Cliquez le modele dont vous voulez promouvoir une version ; la table des versions se deplie.
3. Verifiez les colonnes **Dataset** et **mAP50** de la version, et suivez son lien **Run** vers la [page de detail de run](user-guide.fr.md#page-de-detail-dun-run) si vous avez besoin du contexte complet d'entrainement avant de decider.
4. Dans la colonne **Transition** de la ligne de cette version, cliquez **Staging** pour l'y deplacer, examinez-la, puis cliquez **Production** une fois satisfait. Le bouton du stage courant reste desactive, donc vous voyez toujours ou en est une version.
5. Pour retirer une ancienne version a la place, cliquez **Archived**.

*Résultat* : le stage de la version change immediatement, visible instantanement aussi dans le badge a cote du nom du modele sur la ligne repliee. Deplacer une version ne supprime ni ne change ses poids, son run, ou toute autre version.

## Lire les courbes d'entrainement et les artefacts d'un run

Ce workflow ouvre un run en detail pour verifier comment son entrainement s'est comporte, pas seulement son score final.

*Prerequis* : un id de run ou une ligne a cliquer (depuis Lineage, Comparer, Model Registry ou Experiments).

1. Ouvrez la page de detail du run.
2. Lisez **Historique métriques** : un graphique par metrique loguee a chaque etape, montrant la tendance plutot que seulement le point final.
3. Verifiez **Métriques finales** pour la derniere valeur enregistree de chaque metrique, y compris celles sans historique complet.
4. Si le moteur d'entrainement a joint des plots, descendez jusqu'a la galerie **Plots** (courbes de loss, matrices de confusion, ou tout ce que le moteur a produit) et cliquez-en un pour l'ouvrir en taille reelle.
5. Ouvrez **Artifacts** pour la liste complete des fichiers avec leurs tailles, utile pour confirmer qu'un checkpoint ou un fichier de configuration a bien ete sauvegarde.

*Résultat* : une image complete d'un run d'entrainement, de ses courbes a ses fichiers sauvegardes, sans avoir besoin d'ouvrir le dossier du workspace sur la machine backend.

## Parcourir les experiences et les forks en arbre

Ce workflow utilise la page Experiments pour lire l'historique de fork d'un pipeline, que la page Lineage montre spatialement mais que la page Experiments montre comme un arbre explicite.

*Prerequis* : le pipeline a ete forke au moins une fois dans l'Orchestrator (un fork Sandgraph cree un nouveau run dont le tag `fork_parent_run` pointe vers le `orch_run_id` du parent).

1. Naviguez directement vers `/experiments` (pas de lien dans la barre laterale, voir [Guide utilisateur](user-guide.fr.md#page-experiments)).
2. Depliez l'experience qui regroupe les runs du pipeline.
3. Lisez l'indentation : un run avec une icone de fork et une puce "fork de <id>" est un enfant du run au-dessus a l'indentation precedente.
4. Utilisez la colonne de badge **Rôle** pour distinguer d'un coup d'oeil les runs de training, evaluation, inference et HPO dans l'arbre.
5. Cliquez n'importe quelle ligne pour ouvrir sa [page de detail de run](user-guide.fr.md#page-de-detail-dun-run).

*Résultat* : une lecture claire parent-vers-enfant de chaque fork d'un pipeline, que la vue graphe de Lineage dessine cote a cote plutot qu'imbriquee.
