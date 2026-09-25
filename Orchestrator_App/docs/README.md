---
app: orchestrator
doc_type: readme
audience: both
lang: en
title: Orchestrator App
order: 0
tags: [pipeline, sandgraph, mlops, dataset explorer, annotation, training, dvc, mlflow, optuna]
sources: [Orchestrator_App/launcher.py, Orchestrator_App/backend/main.py, Orchestrator_App/frontend/src/App.tsx]
---

# Orchestrator App

## What Orchestrator App does

Orchestrator App is the central hub of the Computer Vision suite: a visual graph editor (the Sandgraph) for designing, running and monitoring multi-application pipelines, without writing any configuration file.

- **Nodes chain the other apps**: a Dataset Source or a Dataset Explorer selects images, an Annotation node labels them, a Training node trains a model, an Inference / Eval node evaluates or runs it, and DVC Commit and MLflow observe and version the result.
- **FREE and LOCKED nodes**: a Dataset Explorer or Annotation node with no incoming edge exposes outputs already produced in the workspace instead of regenerating them, so a graph can reuse existing data without rerunning earlier stages.
- **Auto-launch and human gates**: the sub-applications a graph needs start automatically, and the pipeline pauses at critical steps (annotate, validate a subset, review an automatic annotation) until you continue it by hand.
- **MLOps traceability**: every run can be linked, in one click, to its Git commit, its DVC dataset version and its MLflow run, with a reproducibility checklist and a cross-experiment lineage graph.

The app is built to run as a hub over a whole suite deployed on a remote Linux GPU machine: the Sandgraph editor and every sub-application it drives run over the same SSH tunnel, and workspace paths and network shares are normalized so that a path typed or dropped from Windows works on the Linux backend.

## Place of Orchestrator App in the suite pipeline

Orchestrator App does not process images or train models itself; it coordinates the apps that do:

1. **Dataset Explorer** (via a Dataset Source or a query) selects a subset of images.
2. **Annotation App** creates a project from that subset, annotates it (by hand or with AI), and exports a YOLO dataset plus a native `.ver` ground truth file.
3. **Training App** trains a model on the exported dataset; **Optuna App** tunes its hyperparameters first if a study is configured.
4. **Inference App** evaluates or runs the trained model.
5. **DVC App** and **MLflow App** version the outputs and track the experiment, both observed passively rather than driven as pipeline steps.

Each user gets an isolated workspace (`orchestrator_<user>` alongside `explorer_<user>`, `annotation_<user>`, `training_<user>`, `inference_<user>`, `dvc_<user>`, `mlflow_<user>`, `optuna_<user>`, all under the workspaces root). The exact layout is in the section *Workspace layout on disk* of [Configuration](configuration.md).

## Quick start in five steps

This quick start assumes the app is installed and launched from VisionNexus, or with `python launcher.py --user <name> --workspace <root>` from `Orchestrator_App/`. For installation, see [Configuration](configuration.md).

1. On the **Experiments** page, pick a template under **Templates prédéfinis** (for example **Entraînement rapide**) and click **Utiliser ce template**; it opens in the Sandgraph.
2. Open the **Dataset Source** node and set a real **Chemin (dossier)** pointing at your images.
3. Adjust the other nodes if needed (the semantic query on Dataset Explorer, the AI model and prompt on Annotation, the epochs on Training), then click **Save**.
4. Click **Run**. The needed sub-applications launch automatically; when the pipeline stops at a human gate, open the linked application, do the work, and click **Terminé -> Continuer**.
5. When the **Chaîne terminée** window appears, open the DVC node and version the outputs you want to keep.

The **MLOps** tab (Insights, Plans, Activity, Lineage, Guide) tracks what each run produced and how it relates to earlier runs, from the very first run onward.

## Documentation pages for Orchestrator App

The Orchestrator App documentation is split into nine pages. User pages come first, developer pages last.

- [User guide](user-guide.md): screen-by-screen tour of the Sandgraph editor, every node type and its configuration fields, the MLOps sub-tabs and the Applications page.
- [Workflows](workflows.md): complete tasks from start to finish in numbered steps, from building a graph by hand to using each predefined template, forking a run, versioning in DVC and planning a series of experiments, including the FREE/LOCKED test scenarios.
- [Concepts](concepts.md): FREE and LOCKED nodes, pipeline execution, human gates, the MLflow supervisor and the DVC observer, Run Insight, cross-experiment lineage, Experiment Plans, and typed ports.
- [Configuration](configuration.md): launching the app, ports, environment variables, the workspace layout, the conda and Node.js setup, and CORS.
- [Troubleshooting](troubleshooting.md): known problems described by their symptom, with cause and solution.
- [Architecture](architecture.md): backend and frontend components, the SSE execution model, the typed ports system, Run Insight and lineage internals, Experiment Plans internals, the file-by-file map, the development test scenarios, and the invariants that must not be broken.
- [API reference](api-reference.md): HTTP and SSE endpoints grouped by domain.
- [Code map](code-map.md): where each feature lives in the code and where to change it.
