*[Read in English](README.md)*

# Documentation - Orchestrator App

Index thematique de la documentation. Retour a [../README.md](../README.md) (vue d'ensemble
utilisateur).

## Sommaire

- **[architecture.md](architecture.md)** : fonctionnement interne - conversion graphe -> pipeline
  (`graph_runner.py`), execution async du DAG (`pipeline_runner.py`), architecture SSE et ses
  correctifs, mode FREE/LOCKED, auto-launch des sous-apps, types de nodes et etapes pipeline,
  schema des ports types (`ports.ts`) et regles de validation des connexions, comportement du
  canvas, Run Insight et lineage cross-experiences (Git/DVC/MLflow), Experiment Plans, et le
  detail fichier par fichier du backend et du frontend. Contient la table des ports de reference.
- **[test-scenarios.md](test-scenarios.md)** : scenarios de test SC1 a SC5 (templates
  `ExperimentsPage`), couvrant le mode FREE/LOCKED et le pipeline complet.
- **[../../docs/ADDING_AN_APP.md](../../docs/ADDING_AN_APP.md)** : comment connecter une
  nouvelle app a l'orchestrateur (sujet transverse a toute la suite, documente au niveau du
  repo, pas ici).

## Ou chercher quoi

| Question | Document |
|----------|----------|
| Comment un graphe devient-il un pipeline executable ? | [architecture.md](architecture.md#node-types-et-leurs-etapes-pipeline) |
| Comment fonctionne le SSE / le resume apres gate humaine ? | [architecture.md](architecture.md#sse-architecture) |
| Qu'est-ce que le mode FREE/LOCKED ? | [architecture.md](architecture.md#free--locked-node-mode-cle-du-systeme) |
| Quelles connexions entre nodes sont valides ? Que sont les ports types ? | [architecture.md](architecture.md#ports-types-des-nodes-portsts) |
| Quels ports (reseau) pour quelle app ? | [architecture.md](architecture.md#ports) |
| Comment tester le pipeline de bout en bout ? | [test-scenarios.md](test-scenarios.md) |
| Comment ajouter une nouvelle app connectee a l'orchestrateur ? | [../../docs/ADDING_AN_APP.md](../../docs/ADDING_AN_APP.md) |
| Que fait le Run Insight ? Comment le lineage Git/DVC/MLflow est-il construit ? | [architecture.md](architecture.md#run-insight-et-lineage-git--dvc--mlflow) |
| Comment fonctionnent les Experiment Plans ? | [architecture.md](architecture.md#plans-dexperiences) |
