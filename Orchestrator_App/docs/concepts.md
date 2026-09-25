---
app: orchestrator
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [free locked, pipeline, human gate, mlflow, dvc, lineage, insight, plans]
sources: [Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/core/pipeline_runner.py, Orchestrator_App/backend/core/graph_store.py, Orchestrator_App/backend/core/insights.py, Orchestrator_App/backend/api/lineage.py, Orchestrator_App/backend/core/plan_runner.py, Orchestrator_App/frontend/src/nodes/ports.ts]
---

# Concepts

## FREE and LOCKED nodes

A Dataset Explorer, Annotation or Inference / Eval node has two modes, derived purely from its connectivity, never stored:

- **FREE**: the node has no incoming edge. It exposes the existing outputs already sitting in the workspace (subsets for Dataset Explorer, exports for Annotation, an interactive session for Inference / Eval) instead of producing new ones. No pipeline step is generated for it, and its sub-application is not launched automatically just because the node exists.
- **LOCKED**: the node has at least one incoming edge. It runs a new pipeline step from its input and produces a fresh output.

A Dataset Source or Modèle node is never FREE or LOCKED: it always has no input by design and is a pure value source. `dataset_source` is always treated as needing its own step regardless of edges.

This matters in practice because a FREE node lets you reuse data already produced, without waiting through Dataset Explorer or Annotation again: pick an existing subset or export and connect it downstream. As soon as you draw an edge into a Dataset Explorer or Annotation node, it flips to LOCKED and the pipeline will regenerate its output on the next run.

## Pipeline execution: steps, dependencies and parallelism

Running a graph converts it into a `PipelineDef`, a flat list of steps with dependencies (`depends_on`), by walking the graph in topological order. Each step id follows the convention `<node_id>__<action>`, for example `a1__exportyolo`. A single node can produce several steps (Annotation produces up to four: `project`, `annotate` or `auto_annotate`, `exportyolo`, `exportver`).

The executor runs steps level by level: at each level, every step whose dependencies already succeeded starts at the same time. Two independent Training nodes fed by the same Annotation therefore run in parallel, not one after another. If a step fails, everything that depends on it (directly or transitively) is marked failed and skipped, but unrelated branches still run to completion.

A step whose target sub-application is not reachable yet waits (up to four minutes) rather than failing immediately, since the app may still be launching. A few especially long-running endpoints (training, inference, evaluation, HPO, dataset embedding, project creation) get a much longer HTTP timeout, because an evaluation or an auto-annotation run on a remote GPU machine can easily take longer than the default ten minutes.

## Human gates

A human gate is a pipeline step that has no automatic action: it simply pauses the run and shows you a hint and a link to the relevant sub-application. You do the work by hand there (annotate images, review a subset, launch a training), then click **Terminé -> Continuer** in Orchestrator App to resume.

Gates appear in several situations: a Dataset Explorer or Annotation node configured in manual mode, the "verify embedding" and "validate subset" checkpoints of an automatic Dataset Explorer run, a manual Training or Inference / Eval node, and a manual Optuna study. A LOCKED Annotation or Dataset Explorer node in manual mode additionally requires you to pick, from a list, which already-produced export or subset to use before the gate lets you continue - this exists because a graph can be resumed after edits, and the pipeline needs an explicit choice rather than guessing from a field that may already hold a stale default.

## MLflow: an isolated supervisor, not a pipeline step

The MLflow node never has an edge and never produces a pipeline step. As soon as one exists in the graph, MLflow App is launched and kept running, and it continuously watches the workspace's MLflow store (a local, serverless SQLite database, not a hosted server). Every Training and Inference / Eval step run in a graph that has this node logs its own MLflow run automatically, named deterministically `<graph name>/<node label>`, grouped into one MLflow experiment per graph so that training, evaluation and HPO runs of the same project sit together instead of being scattered across separate experiments.

DVC Commit behaves the same way: it is an observer with no port, not a step that consumes a specific artifact type. Whatever node type you connect to it historically meant nothing anymore since the ports system removed its ports entirely - it scans the whole graph's outputs and lets you choose, from its own panel, which ones to version.

## Dataset Explorer and Annotation output naming

Both Dataset Explorer and Annotation write to fixed locations under the workspace, never inside an application's own directory: subsets in `explorer_<user>/subsets/<name>/`, and annotation exports in `annotation_<user>/exports/<name>.zip` or `<name>.ver`. The Orchestrator only ever reads these two folders to discover "existing outputs" for FREE mode; it never asks a sub-application over HTTP what it has produced.

An Annotation node's export name is not necessarily its project name: `export_name`, when set (typically by picking an existing export in FREE or manual mode), takes priority over `project_name` for locating a dataset on disk, because a project named `essai_2` might reuse an export produced as `essai_1-yolo`.

## Sub-app auto-launch

Before running a pipeline, Orchestrator checks which sub-applications the graph's LOCKED nodes need and launches the missing ones in the background, one at a time rather than all at once - starting several sub-applications simultaneously (each one a full uvicorn plus a Vite dev server, some loading GPU models) saturates the machine and causes the first pipeline step to time out waiting for an app that is still cold-starting. Apps are launched in the order the pipeline actually needs them, so the first step never waits behind an app that only a later step requires. FREE nodes are excluded from this calculation, except Inference / Eval, which always needs its app available for the manual session it can open even with no input; MLflow and DVC nodes always need their apps, since they are permanent observers regardless of connectivity.

## Run Insight: what a run left behind

A Run Insight is the frozen record of one specific graph run: everything the sub-applications know about that run, collected into a single bundle right after it finishes (and progressively while it runs, after each significant step). It bundles the node statuses and step log, epoch-by-epoch training curves, the Optuna studies whose `run_id` matches this run exactly, the MLflow runs tagged with this run's id, and the DVC commits whose trailer matches it. Nothing here falls back to "the most recent file in the workspace": a fork's Insight never accidentally shows its parent's curves just because they happen to be the newest thing on disk.

Part of the Insight is a **reproducibility checklist** with seven independent, honestly computed checks: Git code committed, the graph snapshot versioned, the dataset versioned in DVC, a linked MLflow run, the model file actually present on disk, analysis artifacts present, and a DVC remote configured. The run is marked reproducible only when all seven are true; there is no default "green" state.

## Lineage: linking runs across the whole workspace

While a Run Insight is about one run, the Lineage graph links every run of every graph in the workspace: shared source datasets, the subsets each run actually extracted, models, MLflow stages and produced artifacts, plus the fork relationships between runs. A run only appears in the default (published) view once it has a terminal, successful status; failed and interrupted runs are visible in the audit view but hidden by default, listed instead in `excluded_runs`. A run with genuinely no lineage information at all is still shown, marked as not versioned, rather than causing the whole page to error out over one incomplete run.

A **fork** duplicates a graph (keeping the same dataset and annotation nodes, hence the same subset and the same annotations already produced) and records where it came from: the parent's commit, dataset, DVC version and mAP50. Forking never triggers a DVC pull or any re-download; it only records provenance for the divergence view, and you adjust parameters and relaunch yourself. A run's **comparison snapshot** is a normalized, stable view of its dataset, annotations, HPO best params (only if produced by this exact run, never inherited from a parent), training parameters, model, MLflow stages and artifacts, used to diff two runs section by section and highlight only what actually changed.

## Experiment Plans

An Experiment Plan is an ordered list of steps; each step duplicates one base graph you already built in the Sandgraph and applies named overrides to a small set of standard node ids (`v1` for Dataset Explorer, `a1` for Annotation, `t1` for Training). Running a plan does not call any internal function directly: it replays, as a background task, exactly the sequence a human would do by hand through the app's own HTTP endpoints, so all the existing validation, auto-launch and human-gate logic is reused unchanged. A plan auto-resumes every gate it hits, because a scheduled batch of experiments must never sit stuck waiting for a click. The DVC commit is deliberately left out of this automation: a plan produces runs, and you choose from their own DVC node which outputs are worth versioning.

## Typed ports, required inputs and exclusive inputs

Every node declares its inputs and outputs as a small schema, not just a list of accepted source types. This lets a node such as Training have three independently typed inputs (a required dataset from Annotation, an optional model from a Modèle node, and optional best params from Optuna), each with its own port and its own acceptance rule, and lets Annotation expose two distinct outputs (a full YOLO dataset and a native `.ver` ground truth) that different downstream nodes pick up automatically depending on which port they connect to.

Two extra rules keep configurations meaningful: **exclusive** ports on the same node can never both be connected (Inference / Eval's raw-images input and its YOLO-dataset input are exclusive, since the YOLO dataset already includes ground truth), and a **required peer** port only makes sense alongside another (Inference / Eval's GT input is a plain warning, not an error, when connected without a sequence input, since a ground truth with nothing to evaluate against is unusual but not forbidden). A required input that is missing blocks saving and running the graph, except on a FREE node, which is exempt because it deliberately has no input.
