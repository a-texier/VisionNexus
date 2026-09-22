*[Lire en francais](test-scenarios.fr.md)*

# Test scenarios - Orchestrator App

Back to [docs/README.md](README.md).

Templates available in `ExperimentsPage` (`SANDGRAPH_TEMPLATES`). These scenarios cover
FREE/LOCKED mode (see [architecture.md](architecture.md#free--locked-node-mode-cle-du-systeme))
and the full pipeline chain.

### SC1 - Exploration from an existing subset (`exploration_from_existing_subset`)
**Goal**: FREE mode without a dataset
Flow: explorer FREE -> select "night_dark" -> connect -> Annotation LOCKED -> DVC
Precondition: a "night_dark" subset must exist in `explorer_bob/subsets/`
Expected result: no pipeline dependency on Dataset_Explorer_App, direct annotation of the existing subset

### SC2 - Training from an existing annotation (`train_from_existing_annotation`)
**Goal**: FREE mode on Annotation
Flow: Annotation FREE -> select "annot_v2" -> connect -> MLflow -> DVC
Precondition: an "annot_v2" export must exist in `annotation_bob/exports/`
Expected result: partial pipeline, Annotation_App not launched

### SC3 - Automated pipeline with human validation (`full_auto_with_human_gates`)
**Goal**: full semi-automatic pipeline
Flow: Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto=true, SAM3, prompt="Cars") -> MLflow -> DVC
Gates: verifyembed, validatesubset, train, hpo
Expected result: guided pipeline with human validation between each critical step

### SC4 - Fully manual pipeline (`full_manual_pipeline`)
**Goal**: human-first pipeline, zero automation
Flow: Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto=false) -> MLflow -> DVC
Difference vs SC3: `full_auto=false` -> human gate for annotation instead of auto-annotate
Expected result: orchestrator = observer + connector, all actions driven by the human

### SC5 - Night Cars, 3x Training + HPO + DVC
**Goal**: full pipeline with fan-out training and Optuna optimization
Flow: Dataset -> night explorer -> manual Annotation -> 3x Training (distinct hyperparams) -> MLflow check -> Optuna HPO -> best Training -> final MLflow -> DVC
Gates: verifyembed, validatesubset, annotate, m1 (MLflow), o1 (Optuna), m2 (final MLflow)
Automatic training steps: t1 (yolov8n lr=1e-2), t2 (yolov8s lr=1e-3), t3 (yolov8n mosaic), t_best (best Optuna)
Universal template: `dataset_path` empty -> to be filled in by each user. The bob graph contains its real path.
`t_best` derives its `dataset_path` via a BFS over ancestors (parent = Optuna, but the annotation is found by walking back up).
