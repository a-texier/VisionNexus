---
app: mlflow
doc_type: readme
audience: both
lang: fr
title: MLflow App
order: 0
tags: [mlflow, suivi d'experiences, model registry, lineage, superviseur]
sources: [MLflow_App/backend/main.py, MLflow_App/launcher.py, _lib/launcher_engine.py, MLflow_App/frontend/src/App.tsx]
---

# MLflow App

## Ce que fait MLflow App

MLflow App est le visualiseur de suivi d'experiences et de model registry de la suite Computer Vision. Il donne une interface web a un simple store MLflow : experiences, runs avec leurs parametres, metriques et artefacts, et un registre de versions de modeles.

MLflow App n'entraine jamais rien et ne demarre jamais de run d'entrainement. C'est un **superviseur** : les autres apps de la suite (surtout Training App) loguent leurs runs directement dans un store partage, et MLflow App se contente de lire et d'afficher ce store. Il n'y a rien a configurer pour "recevoir" un run ; si un run a ete logue, il est deja la la prochaine fois que vous ouvrez ou rafraichissez la page.

Quatre pages couvrent toute l'interface :

- **Lineage** montre chaque run de pipeline de la suite en graphe ou en liste, depuis son dataset source jusqu'a ses etapes MLflow et ses metriques, avec des liens vers la version DVC correspondante et le run Orchestrator.
- **Model Registry** liste les versions de modeles enregistrees, chacune liee au run et au dataset qui l'ont produite, avec des boutons pour deplacer une version entre stages.
- **Comparer** met cote a cote les parametres et metriques de plusieurs runs selectionnes, avec un graphique par metrique.
- **Doc** explique, dans l'app, comment MLflow est reellement utilise dans cette suite : nommage, tags de lineage et un exemple concret.

Une page de detail de run (ouverte depuis n'importe quelle ligne de run) montre ses graphiques de metriques par epoch, ses metriques finales, ses parametres, les plots d'entrainement produits par le moteur, et sa liste complete d'artefacts.

## Place de MLflow App dans le pipeline de la suite

MLflow App se situe apres l'entrainement, pas dans le pipeline lui-meme :

1. **Dataset Explorer** et **Annotation App** produisent un dataset.
2. **Optuna App** cherche eventuellement des hyperparametres sur ce dataset.
3. **Training App** entraine un modele et logue le run (parametres, metriques, plots, et les meilleurs poids comme version de modele enregistree) dans le store MLflow partage.
4. **MLflow App** affiche ce run, en direct, sans que rien n'ait besoin de lui etre pousse.
5. **DVC App** peut alors versionner le dataset et le modele ensemble, et tague le run MLflow correspondant avec le commit Git et la version de dataset qui en resultent, bouclant la boucle de lineage montree sur la page Lineage.

Dans un pipeline Orchestrator, un noeud MLflow n'a aucune arete entrante et ne genere aucune etape de pipeline : c'est seulement une fenetre en direct sur le run que le pipeline vient de produire, ouverte a cote des propres vues Insight et Sandgraph de l'Orchestrator.

Chaque utilisateur a un store isole : `mlflow_<user>/mlflow_data/mlflow.db`, un sibling du workspace propre de l'utilisateur `mlflow_<user>` a cote de celui de chaque autre app. Voir [Configuration](configuration.fr.md) pour la structure exacte.

## Demarrage rapide en cinq etapes

Ce demarrage rapide suppose qu'au moins un run d'entrainement a deja ete logue (par exemple via Training App, en autonome ou depuis un pipeline Orchestrator), et que MLflow App est lance depuis VisionNexus ou avec `python launcher.py --app mlflow --workspace <racine> --user <nom>` depuis la racine de la suite.

1. Ouvrez MLflow App : la page **Lineage** se charge et montre les runs du store de l'utilisateur courant sous forme de graphe.
2. Cliquez un noeud de run pour ouvrir son panneau lateral, puis utilisez ses liens pour aller vers l'Insight Orchestrator correspondant, la vue Sandgraph, ou le lineage DVC App pour le meme run.
3. Cliquez le noeud d'etape d'un run, ou ouvrez **Comparer**, selectionnez une experience et deux runs ou plus, pour voir leurs metriques cote a cote.
4. Ouvrez **Model Registry** pour voir les versions d'un modele entraine et deplacer l'une d'elles vers **Production** ou **Staging**.
5. Ouvrez **Doc** pour une courte explication propre a la suite sur le nommage et les tags de lineage, avec un exemple reel.

## Pages de documentation de MLflow App

La documentation de MLflow App est repartie en neuf pages. Les pages utilisateur viennent d'abord, les pages developpeur en dernier.

- [Guide utilisateur](user-guide.fr.md) : chaque page et panneau de l'interface, et quand utiliser chacun.
- [Workflows](workflows.fr.md) : taches completes en etapes numerotees, de la lecture des metriques d'un run a la comparaison de runs et la promotion d'une version de modele.
- [Concepts](concepts.fr.md) : experience, run, parametres/metriques/artefacts, le model registry et ses versions, et les conventions de tags `run_type`/lineage de la suite.
- [Configuration](configuration.fr.md) : installation, commandes de lancement, ports, variables d'environnement et structure du store.
- [Depannage](troubleshooting.fr.md) : problemes connus decrits par leur symptome, avec cause et solution.
- [Architecture](architecture.fr.md) : le store SQLite serverless, composants backend, le module de logging partage utilise par les apps emettrices, et invariants.
- [Reference API](api-reference.fr.md) : endpoints HTTP regroupes par domaine.
- [Carte du code](code-map.fr.md) : ou vit chaque fonctionnalite dans le code et ou la modifier.
