---
app: orchestrator
doc_type: readme
audience: both
lang: fr
title: Orchestrator App
order: 0
tags: [pipeline, sandgraph, mlops, dataset explorer, annotation, training, dvc, mlflow, optuna]
sources: [Orchestrator_App/launcher.py, Orchestrator_App/backend/main.py, Orchestrator_App/frontend/src/App.tsx]
---

# Orchestrator App

## Ce que fait Orchestrator App

Orchestrator App est le hub central de la suite Computer Vision : un editeur de graphe visuel (le Sandgraph) pour concevoir, lancer et surveiller des pipelines multi-applications, sans ecrire aucun fichier de configuration.

- **Les nœuds enchainent les autres applications** : un Dataset Source ou un Dataset Explorer selectionne des images, un nœud Annotation les etiquette, un nœud Training entraine un modele, un nœud Inference / Eval l'evalue ou l'execute, et DVC Commit et MLflow observent et versionnent le resultat.
- **Nœuds FREE et LOCKED** : un nœud Dataset Explorer ou Annotation sans arete entrante expose des sorties deja produites dans le workspace au lieu de les regenerer, pour qu'un graphe puisse reutiliser des donnees existantes sans relancer les etapes precedentes.
- **Auto-lancement et points d'arret humains** : les sous-applications dont un graphe a besoin demarrent automatiquement, et le pipeline s'arrete aux etapes critiques (annoter, valider un subset, relire une annotation automatique) jusqu'a ce que vous le continuiez a la main.
- **Traçabilité MLOps** : chaque run peut etre relie, en un clic, a son commit Git, sa version de dataset DVC et son run MLflow, avec une checklist de reproductibilite et un graphe de lineage cross-experiences.

L'application est concue pour tourner comme un hub par-dessus toute une suite deployee sur une machine GPU Linux distante : l'editeur Sandgraph et chaque sous-application qu'il pilote passent par le meme tunnel SSH, et les chemins de workspace et les partages reseau sont normalises pour qu'un chemin tape ou depose depuis Windows fonctionne sur le backend Linux.

## Place d'Orchestrator App dans le pipeline de la suite

Orchestrator App ne traite pas d'images ni n'entraine de modeles lui-meme ; il coordonne les applications qui le font :

1. **Dataset Explorer** (via un Dataset Source ou une requete) selectionne un sous-ensemble d'images.
2. **Annotation App** cree un projet depuis ce sous-ensemble, l'annote (a la main ou avec l'IA), et exporte un dataset YOLO plus un fichier de verite terrain natif `.ver`.
3. **Training App** entraine un modele sur le dataset exporte ; **Optuna App** ajuste d'abord ses hyperparametres si une etude est configuree.
4. **Inference App** evalue ou execute le modele entraine.
5. **DVC App** et **MLflow App** versionnent les sorties et tracent l'experience, tous deux observes passivement plutot que pilotes comme des etapes de pipeline.

Chaque utilisateur recoit un workspace isole (`orchestrator_<user>` aux cotes de `explorer_<user>`, `annotation_<user>`, `training_<user>`, `inference_<user>`, `dvc_<user>`, `mlflow_<user>`, `optuna_<user>`, tous sous la racine des workspaces). L'arborescence exacte est dans la section *Arborescence du workspace sur disque* de [Configuration](configuration.fr.md).

## Démarrage rapide en cinq étapes

Ce demarrage rapide suppose que l'application est installee et lancee depuis VisionNexus, ou avec `python launcher.py --user <nom> --workspace <racine>` depuis `Orchestrator_App/`. Pour l'installation, voir [Configuration](configuration.fr.md).

1. Sur la page **Expériences**, choisissez un gabarit sous **Templates prédéfinis** (par exemple **Entraînement rapide**) et cliquez **Utiliser ce template** ; il s'ouvre dans le Sandgraph.
2. Ouvrez le nœud **Dataset Source** et mettez un vrai **Chemin (dossier)** pointant vers vos images.
3. Ajustez les autres nœuds si besoin (la requete semantique sur Dataset Explorer, le modele IA et le prompt sur Annotation, les epochs sur Training), puis cliquez **Sauvegarder**.
4. Cliquez **Lancer**. Les sous-applications necessaires se lancent automatiquement ; quand le pipeline s'arrete a un point d'arret humain, ouvrez l'application liee, faites le travail, et cliquez **Terminé -> Continuer**.
5. Quand la fenetre **Chaîne terminée** apparait, ouvrez le nœud DVC et versionnez les sorties que vous voulez garder.

L'onglet **MLOps** (Insights, Plans, Activité, Lineage, Guide) suit ce que chaque run a produit et comment il se relie aux runs precedents, des le tout premier run.

## Pages de documentation d'Orchestrator App

La documentation d'Orchestrator App est repartie en neuf pages. Les pages utilisateur viennent d'abord, les pages developpeur en dernier.

- [Guide utilisateur](user-guide.fr.md) : visite ecran par ecran de l'editeur Sandgraph, de chaque type de nœud et de ses champs de configuration, des sous-onglets MLOps et de la page Applications.
- [Procédures](workflows.fr.md) : taches completes de bout en bout en etapes numerotees, de la construction d'un graphe a la main a l'utilisation de chaque gabarit predefini, forker un run, versionner dans DVC et planifier une serie d'experiences, y compris les scenarios de test FREE/LOCKED.
- [Concepts](concepts.fr.md) : nœuds FREE et LOCKED, execution du pipeline, points d'arret humains, le superviseur MLflow et l'observateur DVC, Run Insight, lineage cross-experiences, Plans d'experiences, et ports types.
- [Configuration](configuration.fr.md) : lancer l'application, ports, variables d'environnement, l'arborescence du workspace, la configuration conda et Node.js, et le CORS.
- [Dépannage](troubleshooting.fr.md) : problemes connus decrits par leur symptome, avec cause et solution.
- [Architecture](architecture.fr.md) : composants backend et frontend, le modele d'execution SSE, le systeme de ports types, les mecanismes internes du Run Insight et du lineage, les mecanismes internes des Plans d'experiences, la carte fichier par fichier, les scenarios de test de developpement, et les invariants a ne pas casser.
- [Référence API](api-reference.fr.md) : endpoints HTTP et SSE groupes par domaine.
- [Carte du code](code-map.fr.md) : ou vit chaque fonctionnalite dans le code et ou la modifier.
