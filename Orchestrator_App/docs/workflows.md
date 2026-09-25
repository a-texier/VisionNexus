---
app: orchestrator
doc_type: workflows
audience: user
lang: en
title: Workflows
order: 20
tags: [templates, free mode, locked mode, fork, dvc, mlops, plans, scenarios]
sources: [Orchestrator_App/frontend/src/pages/ExperimentsPage.tsx, Orchestrator_App/frontend/src/pages/SandgraphPage.tsx, Orchestrator_App/frontend/src/pages/PlansPage.tsx, Orchestrator_App/backend/core/graph_runner.py, Orchestrator_App/backend/api/graphs.py, Orchestrator_App/run_all_scenarios.py]
---

# Workflows

## Build a graph from scratch and run it

This workflow creates an empty experiment and assembles the shortest useful chain by hand.

*Prerequisites*: Orchestrator App is open on the **Sandgraph** page; the sub-applications do not need to be running yet.

1. Click **New experiment** (top bar, or on the empty canvas).
2. Drag **Dataset Source** from the toolbox onto the canvas, then click it and fill **Chemin (dossier)** with the folder of images to load, and **Nom du dataset**.
3. Drag **Dataset Explorer**, connect **Dataset Source** to it, and set **Requête sémantique** and **top_k**.
4. Drag **Annotation**, connect **Dataset Explorer** to it. Keep **Manuel (annoter dans l'app)** for a first run, or switch to **Full Automatique (IA)** and fill the AI model and text prompt.
5. Drag **DVC Commit** anywhere on the canvas (no connection needed).
6. Click **Save**, fix any validation error shown, then click **Run**.

*Result*: the needed sub-applications launch automatically; the pipeline runs node by node, stopping at each human gate until you click **Done -> Continue**. When it finishes, the **Chain complete** window opens with a shortcut to the DVC node.

## Use the Quick training template

This workflow starts from the **Entraînement rapide** template: the shortest chain with no evaluation or HPO.

*Prerequisites*: Orchestrator App is open on the **Experiments** page.

1. Under **Templates prédéfinis** > **Scénarios mainstream**, find **Entraînement rapide** and click **Utiliser ce template**.
2. The Sandgraph opens with five nodes already connected: Dataset Source -> Dataset Explorer -> Annotation -> Training -> DVC Commit, plus an isolated MLflow supervisor node.
3. Open the **Dataset Source** node and set a real **Chemin (dossier)** (the template ships with an empty path).
4. Adjust the query, the annotation prompt and the training epochs if needed, then click **Run**.

*Result*: a dataset is embedded, a subset is created by CLIP query, images are annotated automatically with Grounding DINO, a model is trained, and MLflow logs the run. DVC is present but nothing is versioned until you use its node.

## Use the Standard chain template

This workflow adds an evaluation step after training, so the reported mAP is measured, not just the training-time metric.

*Prerequisites*: same as the Quick training workflow.

1. Use the **Chaîne standard** template.
2. The graph adds an **Inference / Eval** node after Training, with **task = detection** and **gt_split = val**, connected both to Training (for the model) and to Annotation (for the ground truth).
3. Fill the dataset path, then **Run**.

*Result*: after training, the Inference / Eval node re-evaluates the model on the `val` split with `model.val()` and reports mAP50, mAP50-95, precision, recall, a PR curve, an F1 curve and a confusion matrix. This is the recommended chain for a model you intend to keep.

## Use the Chain + Optuna HPO template

This workflow searches for good hyperparameters before the final training.

*Prerequisites*: same as the Quick training workflow. Expect several trainings in a row (each Optuna trial is a full training), so allow enough time.

1. Use the **Chaîne + HPO Optuna** template.
2. The graph inserts an **Optuna HPO** node between Annotation and the final Training: Annotation feeds both the Optuna study (dataset) and the Training node (dataset) directly, and Optuna feeds Training with **best params**.
3. Check the number of trials and the search space on the Optuna node, then **Run**.

*Result*: Optuna runs its trials (TPE sampler), the best parameters are merged into the final Training's hyperparameters at run time, and only that final training is evaluated and logged as the "clean" result.

## Explore a dataset manually before annotating

This workflow uses the **Exploration dataset** template to inspect a dataset in the Dataset Explorer playground before committing to an automatic subset query.

*Prerequisites*: a folder of images accessible from the backend machine.

1. Use the **Exploration dataset** template. It contains only a Dataset Source node connected to a Dataset Explorer node in manual mode (**Full Automatique (CLIP)** unset).
2. Set the dataset path and click **Run**.
3. The pipeline stops at the **Créer subset "..." manuellement** human gate. Click **Ouvrir Dataset Explorer**, browse the CLIP clusters and the semantic search in the Playground, and create a subset there.
4. Return to the Sandgraph and click **Terminé -> Continuer**.

*Result*: a subset exists in `explorer_<user>/subsets/`, ready to be picked up later by a FREE Annotation node or another Dataset Explorer node in a new graph.

## Re-train from an existing annotation export (FREE Annotation)

This workflow trains a new model from annotations already exported, without touching Dataset Explorer again.

*Prerequisites*: a YOLO export already exists in `annotation_<user>/exports/` (produced by any previous run or by a manual export from Annotation App).

1. Use the **Re-train depuis annotation existante** template, or drag a bare **Annotation** node with no incoming edge.
2. The Annotation node is FREE: its card lists the exports available in the workspace. Click **Choisir une annotation existante**, then pick the wanted `.ver` or YOLO export.
3. Adjust the Training node (engine, size, epochs), then click **Run**.

*Result*: no Dataset Explorer or annotation step runs; Training starts directly from the picked export. This is the fastest way to try new hyperparameters on data you already annotated.

## Annotate from an existing subset (FREE Dataset Explorer)

This workflow reuses a subset already created in Dataset Explorer, skipping the dataset load and CLIP query.

*Prerequisites*: a subset already exists in `explorer_<user>/subsets/` (see "Explore a dataset manually before annotating" above, or any previous run).

1. Use the **Annotation depuis subset existant** template, or drag a bare **Dataset Explorer** node with no incoming edge.
2. The Dataset Explorer node is FREE: click **Choisir un subset existant** and pick the subset by name.
3. Connect it to an **Annotation** node (LOCKED, since it now has an incoming edge) and configure the annotation mode.
4. Click **Run**.

*Result*: the pipeline skips straight to project creation and annotation; no Dataset Explorer step is generated and Dataset Explorer App is not auto-launched, only Annotation App and (if present) DVC/MLflow are.

## Fork a run to try new parameters on the same data

This workflow reruns an experiment with different parameters while keeping exactly the same dataset and annotations as a reference run.

*Prerequisites*: a finished run with a generated Insight (MLOps > Insights, or the InsightsPage detail of a run).

1. Open the run's Insight (MLOps > Insights, click the run in the list).
2. Click **Fork this run**.
3. A new graph opens, named `<original> - fork de <run_id>`. An indigo **Fork de <run>** banner appears under the top bar, listing every parameter that differs from the parent (initially none, since nothing has changed yet).
4. Edit the parameters you want to test (for example `epochs`, `basic_lr_per_img`, or the training engine). Watch the banner: if you change a training parameter but not `project_name` or `run_label`, that is expected (the dataset stays identical); if you change `query` or `subset_name` on the Dataset Explorer/Annotation nodes without renaming the output, the red warning tells you the run would silently reuse the existing artifact.
5. Click **Run**.

*Result*: the fork's graph reuses the same dataset and annotation nodes (same subset, same annotations), so no re-annotation happens; only the downstream nodes you changed produce new outputs. The Insight of the new run records `forked_from` with the parent's commit, dataset and mAP50, and the Lineage graph shows the fork edge between the two runs.

## Promote an experimental graph to MLOps tracking

This workflow turns a graph with no DVC/MLflow tracking into one that is versioned and traceable.

*Prerequisites*: an existing graph, with or without any run history.

1. Open the graph in the Sandgraph. If it has neither an MLflow nor a DVC node, the top bar shows **Experimental** with a **Track in MLOps** link.
2. Click it (or the amber **Suivi incomplet , compléter** badge if only one of the two nodes is present).
3. The missing node (or both) is added to the graph automatically, positioned below the existing nodes, and the graph is saved.

*Result*: the badge turns green (**MLOps**). Every future run of this graph now logs to MLflow and can be versioned from the DVC node; the graph's MLOps status also drives the badge shown on its Insight in the Lineage and Insights sub-tabs. No run is launched and nothing is versioned by this action alone.

## Version a finished run in DVC

This workflow versions the dataset, the model and the graph snapshot of a run that already completed.

*Prerequisites*: a graph that finished a run (status **done**) and contains a DVC Commit node.

1. Click the DVC Commit node to open its panel (it opens automatically at the end of a run via the **Chain complete** window).
2. Click **rafraîchir** if the artifact list looks stale.
3. Check the artifacts to version: the YOLO dataset, the GT annotations, the best model, the Optuna best params, the metrics, and/or the graph snapshot. Only artifacts marked as produced (not "pas encore produit") can be checked.
4. Edit **Message de commit** if needed.
5. Click **Créer une version DVC (Git + cache DVC)**.

*Result*: a Git commit is created with trailers (`Run-Id`, `Graph-Id`, `Dataset`, `mAP50`, `MLflow-Run`), the checked artifacts are stored in the DVC cache and pushed to the remote if one is configured, and the MLflow runs of this Orchestrator run receive back the `git_commit` and `dataset_version` tags. The panel then shows **Versionné** with the commit hash, and the button becomes **Run déjà versionné**.

## Plan and launch a series of experiments

This workflow automates "duplicate a base graph, change two or three parameters, relaunch", repeated for several variants.

*Prerequisites*: at least one base graph already built and saved in the Sandgraph (a full pipeline, or a FREE-reuse graph such as Annotation FREE -> Training).

1. Open **MLOps** > **Plans**, click **Nouveau plan**.
2. For each variant, click **Ajouter une étape**: pick the **base graph**, type a step label, and fill the override fields you want to change (**Subset**, **Projet annot.**, **Nb images**, **Seuil annot.**, **Epochs**, **LR par image**, **Batch**, **Run label**). Leave a field empty to keep the base graph's value.
3. Click **Enregistrer**, then **Lancer le plan**.
4. Watch the progress block: each step duplicates its base graph, applies the overrides, runs the pipeline, and auto-resumes any human gate it hits (a plan never stays stuck waiting for you).

*Result*: one new graph per step, each with its own run history, mAP50, DVC version and Git commit once generated. Nothing is committed to DVC automatically; browse the results in the **Lineage** sub-tab and version the ones you want to keep from their own DVC node.

## Test scenarios: FREE and LOCKED modes end to end

These five scenarios are the reference test suite for FREE/LOCKED behavior and the full pipeline chain. They match the templates offered on the **Experiments** page (SC1 to SC4) plus a fifth, fan-out scenario driven only through the API (`run_all_scenarios.py`).

### SC1: exploration from an existing subset (FREE Dataset Explorer)

*Prerequisites*: a subset named `night_dark` already exists in `explorer_<user>/subsets/`.

1. Use the **Annotation depuis subset existant** template (or build it: FREE Dataset Explorer -> LOCKED Annotation -> DVC).
2. On the FREE Dataset Explorer node, select `night_dark`.
3. Connect it to Annotation, configure it, and run.

*Result*: no pipeline step is generated for Dataset Explorer, Dataset_Explorer_App is not auto-launched, and the run goes straight to creating the annotation project from the existing subset.

### SC2: training from an existing annotation (FREE Annotation)

*Prerequisites*: an export named `annot_v2` already exists in `annotation_<user>/exports/`.

1. Use the **Re-train depuis annotation existante** template (or build it: FREE Annotation -> MLflow -> DVC).
2. On the FREE Annotation node, select `annot_v2`.
3. Connect it downstream and run.

*Result*: a partial pipeline runs; Annotation_App is not auto-launched for a new project, only for reading the existing export.

### SC3: automated pipeline with human validation

*Prerequisites*: a Dataset Source with a valid path.

1. Build Dataset Source -> LOCKED Dataset Explorer -> LOCKED Annotation (`full_auto=true`, AI model SAM3, prompt `"Cars"`) -> MLflow -> DVC.
2. Run the graph.

*Result*: the pipeline guides you through a human gate at each critical step (verify embedding, validate subset, train, HPO if present), while the rest runs automatically.

### SC4: fully manual pipeline

*Prerequisites*: same as SC3.

1. Build the same chain as SC3 but with `full_auto=false` on the Annotation node.
2. Run the graph.

*Result*: the Orchestrator acts purely as an observer and connector; every action (subset creation, annotation) is driven by hand in the sub-applications, with a human gate instead of the automatic annotation step.

### SC5: night dataset, three trainings, HPO and DVC

*Prerequisites*: a dataset path for a night/cars source; this scenario is normally run through `run_all_scenarios.py`, not built by hand.

1. Build Dataset Source -> LOCKED Dataset Explorer ("night" query) -> manual Annotation -> three Training nodes with distinct hyperparameters (`t1`: yolov8n lr=1e-2, `t2`: yolov8s lr=1e-3, `t3`: yolov8n with mosaic augmentation) -> an MLflow check gate -> Optuna HPO -> a fourth Training (`t_best`) using the HPO best params -> a final MLflow check -> DVC.
2. `t_best` derives its `dataset_path` by walking back up its ancestors (its direct parent is the Optuna node, but the dataset comes from the Annotation node further up the chain).
3. Run the graph; resolve each gate (verify embedding, validate subset, annotate, the two MLflow checks) as it appears.

*Result*: three independently configured trainings plus one HPO-tuned training all log to the same MLflow experiment, and DVC can version the final result. This scenario exercises fan-out (several Training nodes from one Annotation) and multi-hop ancestor resolution at once.
