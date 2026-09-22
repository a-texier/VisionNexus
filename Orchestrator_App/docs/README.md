*[Lire en francais](README.fr.md)*

# Documentation - Orchestrator App

Thematic index of the documentation. Back to [../README.md](../README.md) (user-facing
overview).

## Contents

- **[architecture.md](architecture.md)**: internal workings - graph -> pipeline conversion
  (`graph_runner.py`), async DAG execution (`pipeline_runner.py`), SSE architecture and its
  fixes, FREE/LOCKED mode, sub-app auto-launch, node types and pipeline steps, the typed ports
  schema (`ports.ts`) and connection validation rules, canvas behavior, Run Insight and
  cross-experiment lineage (Git/DVC/MLflow), Experiment Plans, and the file-by-file detail of
  the backend and frontend. Contains the reference ports table.
- **[test-scenarios.md](test-scenarios.md)**: test scenarios SC1 to SC5 (`ExperimentsPage`
  templates), covering FREE/LOCKED mode and the full pipeline.
- **[../../docs/ADDING_AN_APP.md](../../docs/ADDING_AN_APP.md)**: how to connect a new app to
  the orchestrator (a cross-cutting topic for the whole suite, documented at the repo level,
  not here).

## Where to find what

| Question | Document |
|----------|----------|
| How does a graph become an executable pipeline? | [architecture.md](architecture.md#node-types-et-leurs-etapes-pipeline) |
| How does SSE / resuming after a human gate work? | [architecture.md](architecture.md#sse-architecture) |
| What is FREE/LOCKED mode? | [architecture.md](architecture.md#free--locked-node-mode-cle-du-systeme) |
| Which connections between nodes are valid? What are typed ports? | [architecture.md](architecture.md#ports-types-des-nodes-portsts) |
| Which (network) ports for which app? | [architecture.md](architecture.md#ports) |
| How do you test the pipeline end to end? | [test-scenarios.md](test-scenarios.md) |
| How do you add a new app connected to the orchestrator? | [../../docs/ADDING_AN_APP.md](../../docs/ADDING_AN_APP.md) |
| What does the Run Insight do? How is Git/DVC/MLflow lineage built? | [architecture.md](architecture.md#run-insight-et-lineage-git--dvc--mlflow) |
| How do Experiment Plans work? | [architecture.md](architecture.md#plans-dexperiences) |
