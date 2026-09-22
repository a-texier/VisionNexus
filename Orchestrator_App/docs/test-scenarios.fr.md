*[Read in English](test-scenarios.md)*

# Scenarios de test - Orchestrator App

Retour a [docs/README.md](README.md).

Templates disponibles dans `ExperimentsPage` (`SANDGRAPH_TEMPLATES`). Ces scenarios couvrent le
mode FREE/LOCKED (voir [architecture.md](architecture.md#free--locked-node-mode-cle-du-systeme))
et l'enchainement complet du pipeline.

### SC1 - Exploration depuis subset existant (`exploration_from_existing_subset`)
**Objectif** : mode FREE sans dataset
Flow : explorer FREE -> selectionner "night_dark" -> connecter -> Annotation LOCKED -> DVC
Precondition : un subset "night_dark" doit exister dans `explorer_bob/subsets/`
Resultat attendu : aucune dependance pipeline sur Dataset_Explorer_App, annotation directe du subset existant

### SC2 - Training depuis annotation existante (`train_from_existing_annotation`)
**Objectif** : mode FREE sur Annotation
Flow : Annotation FREE -> selectionner "annot_v2" -> connecter -> MLflow -> DVC
Precondition : un export "annot_v2" doit exister dans `annotation_bob/exports/`
Resultat attendu : pipeline partiel, Annotation_App non lancee

### SC3 - Pipeline auto avec validation humaine (`full_auto_with_human_gates`)
**Objectif** : pipeline semi-automatique complet
Flow : Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto=true, SAM3, prompt="Cars") -> MLflow -> DVC
Gates : verifyembed, validatesubset, train, hpo
Resultat attendu : pipeline guide avec validation humaine entre chaque etape critique

### SC4 - Pipeline entierement manuel (`full_manual_pipeline`)
**Objectif** : pipeline human-first, zero automation
Flow : Dataset -> explorer LOCKED -> Annotation LOCKED (full_auto=false) -> MLflow -> DVC
Difference vs SC3 : `full_auto=false` -> gate humaine pour l'annotation au lieu d'auto-annotate
Resultat attendu : orchestrator = observateur + connecteur, toutes les actions pilotees par l'humain

### SC5 - Night Cars, 3x Training + HPO + DVC
**Objectif** : pipeline complet avec fan-out training et optimisation Optuna
Flow : Dataset -> explorer nuit -> Annotation manuelle -> 3x Training (hyperparams distincts) -> MLflow check -> Optuna HPO -> Training best -> MLflow final -> DVC
Gates : verifyembed, validatesubset, annotate, m1 (MLflow), o1 (Optuna), m2 (MLflow final)
Training steps automatiques : t1 (yolov8n lr=1e-2), t2 (yolov8s lr=1e-3), t3 (yolov8n mosaic), t_best (best Optuna)
Template universel : `dataset_path` vide -> a remplir par chaque user. Graph bob contient son chemin reel.
`t_best` derive son `dataset_path` via BFS ancetres (parent = Optuna, mais annotation trouvee en remontant).
