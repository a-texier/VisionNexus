---
app: dvc
doc_type: readme
audience: both
lang: fr
title: DVC App
order: 0
tags: [dvc, git, versioning de dataset, lineage, remote, push, pull]
sources: [DVC_App/backend/main.py, DVC_App/launcher.py, _lib/launcher_engine.py, DVC_App/frontend/src/App.tsx]
---

# DVC App

## Ce que fait DVC App

DVC App est l'outil de versioning de datasets et de modeles de la suite Computer Vision. Il donne une interface web a un simple repository Git + DVC (Data Version Control) : quels fichiers sont suivis, ce qui a change entre deux commits, et comment pousser ou recuperer le contenu reel vers ou depuis un remote.

Git seul ne stocke que de petits fichiers pointeurs (les fichiers `.dvc`) ; le contenu reel d'un dataset ou des poids d'un modele vit dans le propre cache de DVC et, en option, sur un remote. DVC App rend cette separation visible et pilotable depuis un navigateur, sans aucune ligne de commande :

- **Lineage** montre chaque run de pipeline de la suite en graphe ou en liste, depuis son dataset source jusqu'a la version Git/DVC qu'il a produite et aux objets que cette version suit, avec des liens vers le run MLflow et le run Orchestrator correspondants.
- **Datasets** liste chaque fichier ou dossier actuellement suivi par DVC dans le repository, avec sa taille, son hash et s'il est a jour, modifie, ou manquant sur disque.
- **Historique** est une timeline des commits Git qui ont touche un fichier `.dvc`, chacun lisible comme une version de dataset ou de modele, avec le run et la metrique qui l'ont produite quand l'Orchestrator les a enregistres.
- **Diff** compare deux revisions : quels fichiers ont ete ajoutes, supprimes, modifies ou renommes, avec un resume en langage clair avant le detail fichier par fichier.
- **Sync** execute `dvc push` et `dvc pull` contre un remote configure, avec un journal en direct, et montre combien d'espace disque le cache local utilise reellement.
- **Doc** explique, dans l'app, comment DVC est reellement utilise dans cette suite, distinct du guide MLOps general de l'Orchestrator.

DVC App ne cree jamais lui-meme un dataset ou un modele. Il versionne ce que d'autres apps produisent : un export d'Annotation App, un modele entraine de Training App, un fichier de meilleurs parametres d'Optuna App, ou un instantane complet du pipeline depuis l'Orchestrator.

## Place de DVC App dans le pipeline de la suite

DVC App est un hub de versioning, pas une etape de pipeline avec sa propre entree et sortie :

1. **Annotation App** exporte un dataset annote, **Training App** entraine un modele dessus et logue le run dans **MLflow App**, et **Optuna App** a peut-etre deja cherche ses hyperparametres.
2. Depuis le noeud DVC de l'Orchestrator, vous choisissez lesquels de ces artefacts versionner : le dataset, les poids du modele, les annotations, les metriques du run, les meilleurs parametres Optuna, et un instantane complet du graphe de pipeline.
3. DVC App copie les artefacts choisis dans son propre repository, les suit avec `dvc add`, et les commit avec Git, en ecrivant des trailers de lineage dans le message de commit (quel run, quel graphe, quel dataset, le mAP50 resultant, les ids des runs MLflow correspondants).
4. Il tague ensuite le run MLflow correspondant avec le hash de commit Git et la version de dataset qui en resultent, bouclant la boucle de lineage montree sur la page Lineage de cette app et de MLflow App.
5. **Sync** pousse ensuite le contenu de ce commit vers un remote pour qu'il puisse etre recupere sur une autre machine (une VM GPU, le poste d'un collegue) pour reproduire exactement le meme run.

Dans un pipeline Orchestrator, un noeud DVC n'a aucune arete entrante et ne genere aucune etape de pipeline propre : c'est un observateur de tout le graphe, et vous decidez depuis son hub quoi versionner, quand. DVC App est quand meme auto-lance des qu'un noeud DVC existe, pour que le hub ait une app a qui parler.

Chaque utilisateur a un repository isole : `dvc_<user>/repo/`, dans le propre workspace de cet utilisateur. Voir [Configuration](configuration.fr.md) pour la structure exacte.

## Demarrage rapide en cinq etapes

Ce demarrage rapide suppose qu'au moins un run de pipeline a produit un dataset et, idealement, un modele entraine, et que DVC App est lance depuis VisionNexus ou avec `python launcher.py --app dvc --workspace <racine> --user <nom>` depuis la racine de la suite.

1. Ouvrez DVC App : la page **Lineage** se charge et montre les runs du repository de l'utilisateur courant sous forme de graphe, avec un avertissement ambre si le repository n'existe pas encore (il est cree automatiquement au premier commit).
2. Depuis le noeud DVC de l'Orchestrator (ou depuis un run de pipeline Orchestrator), selectionnez les artefacts a versionner et commitez : le repository est initialise au besoin et le commit est cree.
3. Retour dans DVC App, ouvrez le noeud de version d'un run sur Lineage et suivez son lien **Historique** pour voir le nouveau commit avec ses puces de lineage (dataset, run, mAP), ou naviguez directement vers `/datasets` pour voir les fichiers nouvellement suivis.
4. Ouvrez **Diff**, choisissez ce commit et son parent, pour voir exactement ce qui a change en termes clairs (images ajoutees, annotations modifiees).
5. Ouvrez **Sync**, ajoutez un remote si aucun n'est encore configure, et cliquez **Push** pour rendre la nouvelle version recuperable depuis une autre machine.

## Pages de documentation de DVC App

La documentation de DVC App est repartie en neuf pages. Les pages utilisateur viennent d'abord, les pages developpeur en dernier.

- [Guide utilisateur](user-guide.fr.md) : chaque page et panneau de l'interface, et quand utiliser chacun.
- [Workflows](workflows.fr.md) : taches completes en etapes numerotees, du versioning de la sortie d'un pipeline au diff de deux versions et a la restauration d'une ancienne.
- [Concepts](concepts.fr.md) : donnees suivies et fichiers pointeurs `.dvc`, commits, remotes, et lineage avec Git et MLflow.
- [Configuration](configuration.fr.md) : installation, commandes de lancement, ports, variables d'environnement et structure du repository.
- [Depannage](troubleshooting.fr.md) : problemes connus decrits par leur symptome, avec cause et solution.
- [Architecture](architecture.fr.md) : le wrapper subprocess autour de `git`/`dvc`, le format des trailers de commit, la liaison du cache, et invariants.
- [Reference API](api-reference.fr.md) : endpoints HTTP regroupes par domaine.
- [Carte du code](code-map.fr.md) : ou vit chaque fonctionnalite dans le code et ou la modifier.
