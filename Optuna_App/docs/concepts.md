---
app: optuna
doc_type: concepts
audience: user
lang: en
title: Concepts
order: 30
tags: [study, trial, sampler, tpe, pruner, search space, objective, fanova]
sources: [Optuna_App/backend/core/optuna_runner.py, Optuna_App/backend/api/orchestrator.py, Optuna_App/backend/api/studies.py, Optuna_App/backend/hpo_trial.py, Training_App/backend/services/yolox_catalog.py]
---

# Concepts

## Hyperparameter optimization in Optuna App

A model learns its weights during training, but many settings are chosen before training and never learned: the learning rate, the probability of each augmentation, the rotation range, the weight decay. These are the hyperparameters. Good values depend on the dataset, and guessing them is slow.

Hyperparameter optimization (HPO) automates the search: it proposes a combination of values, trains a model with it, measures a score, and uses the scores already observed to propose the next combination. Optuna is the library that drives this loop; Optuna App gives it an interface, a storage per user, and a direct link with the training engines and the Orchestrator of the suite.

HPO trials are short trainings (10 epochs per trial by default in the preset and in the Orchestrator). They compare settings; they do not produce the final model. The best combination is then used for a full training in Training App.

## Study and its storage

A study is one optimization campaign. It is defined by its name, its direction (minimize or maximize), its sampler, its search space and its trials. All studies of a user are stored in the Optuna SQLite database `optuna.db` of the workspace.

A study also keeps descriptive attributes recorded by the app when a run starts: the source (`manual` or `orchestrator`), the script or the dataset, the metric, the requested number of trials, the sampler and pruner, and for Orchestrator studies the engine, the model size, the graph, run, node and attempt identifiers. The study page reads them to fill the overview of the dashboard.

The direction is fixed when the study is created. Launching an optimization on an existing study reuses its direction, whatever the launch page says. Launching again on the same study adds new trials to it, and the sampler reuses all previous results, which is only meaningful if the objective, the dataset and the search space did not change.

## Trial and trial states

A trial is one combination of hyperparameters and one execution of the objective: one training and one score. Optuna gives each trial a number, from 0, and one of five states:

| State | Meaning |
|---|---|
| `WAITING` | Planned, not started. |
| `RUNNING` | The trial is executing. |
| `COMPLETE` | A numeric objective was recorded. Only these trials count for the best trial. |
| `FAIL` | Technical error or invalid result (crash, missing dataset, unreadable metric). The failure is diagnosed and stored with the trial. |
| `PRUNED` | Stopped early. In Optuna App this never comes from an algorithmic decision, since pruning is disabled. |

The study page adds three read-only qualifications, computed when the page is displayed; the database is never rewritten:

- `INTERRUPTED`: a trial still `RUNNING` in the database for more than 30 minutes while no process of this backend runs it (backend restarted, process killed). It is neither a result nor a pruning.
- `LEGACY_PRUNED_UNKNOWN`: a `PRUNED` trial without any intermediate value, so the real cause is unknown. Trials skipped after **Stop** fall in this category.
- `LEGACY_FAILURE_RECOVERED`: an old pruned trial whose historical log shows a dataset loading failure.

## Search space and parameter distributions

The search space lists the hyperparameters a study may change, each with a distribution:

- `float`: a continuous interval between a minimum and a maximum. With **log**, values are drawn uniformly on a logarithmic scale, which suits quantities that span orders of magnitude such as `basic_lr_per_img` (1e-5 to 1e-2).
- `int`: an integer between two bounds.
- `categorical`: one value from a closed list, for example an optimizer name.

Every trial draws one value per parameter. Bounds that are too wide waste the trial budget and can produce settings that do not train at all; bounds that are too narrow hide the best region. For detection studies, the default ranges come from the engine catalog of Training App. For YOLOX, the tunable parameters are `basic_lr_per_img`, `min_lr_ratio`, `momentum`, `weight_decay`, `mosaic_prob`, `mixup_prob`, `hsv_prob`, `flip_prob`, `degrees`, `translate` and `shear`; the default selection is `basic_lr_per_img`, `mosaic_prob` and `degrees`. A parameter that the engine does not know is ignored by the trial and listed in its result as `ignored_params`.

## Objective, metric and direction

The objective is the single number that ranks the trials. The direction says whether higher or lower is better: maximize an accuracy, an mAP, a precision or a recall; minimize a loss or a latency.

Detection studies use one of two metrics measured on the validation split at the end of each trial:

- `map50`: mean Average Precision at an IoU of 0.50, tolerant to imprecise boxes.
- `map5095`: mean of the AP over IoU thresholds from 0.50 to 0.95, stricter on localization.

Only the chosen metric decides. If the objective is `map50`, two trials with the same `map50` are not separated by their `map5095`, even though both values are shown in the trial results. A short trial also measures a model far from convergence: the ranking of settings is informative, the absolute values are lower than those of the final training.

## TPE sampler and its startup phase

The sampler proposes the values of each new trial. Optuna App always uses the Tree-structured Parzen Estimator (TPE) sampler of Optuna.

TPE looks at the trials already completed, splits them into a group of good results and the rest, estimates where each group is dense in the search space, and proposes values that are likely in the good group and unlikely in the other, while keeping some exploration. It builds probabilities from observations; it does not understand the model.

TPE needs observations first. The first 10 trials form the startup phase and are drawn at random. Failed, interrupted and legacy pruned trials give no score, so they do not count. The dashboard shows the phase ("démarrage / exploration initiale" or "TPE adaptatif") and the number of adaptive decisions, that is the completed trials beyond the tenth. A study of 10 trials or fewer never leaves the startup phase: it is a random search.

## Pruner: why pruning is disabled

A pruner stops a trial early when its intermediate results are clearly worse than those of other trials at the same stage. To work, the objective must report a metric at every epoch (`trial.report(value, step)`) and ask the pruner whether to continue (`trial.should_prune()`).

The training engines do not report per-epoch metrics to Optuna, so every study of Optuna App runs with pruning disabled (Optuna `NopPruner`), and the dashboard says so. Enabling a median pruner without intermediate values would have no effect.

As a consequence, a `PRUNED` state never means that the algorithm judged a trial bad. A dataset error, a CUDA error or a user stop is a failure or an interruption, never a pruning.

## Best value and best parameters

The best trial is the `COMPLETE` trial with the best objective in the study direction. Its value is the best value; its suggested hyperparameters are the best parameters (`best_params`).

The best parameters contain only the tuned hyperparameters. They do not include the fixed settings of the trial (epochs, image size, batch), the secondary metrics, or the weights: the checkpoint of the best trial comes from a short training and is not the final model.

When a study has zero `COMPLETE` trial, there is no official winner and no best parameters. The study page then separates the possible causes (no trial run, technical failures, interruptions) and, for old studies whose trainings finished but whose value was lost, may show metrics recovered from their `results.csv`, clearly marked as informative. They never modify the study.

## Parameter importance with fANOVA

The panel **Importance des paramètres** estimates how much each hyperparameter explains the variation of the objective among the completed trials, with the fANOVA evaluator of Optuna (fixed seed 0). Importances sum to about 1.

The estimate is exploratory. It needs at least 5 completed trials with finite values, and at least two different values; otherwise the panel explains why it is unavailable. The page warns when there are fewer than 20 completed trials, when TPE is still in its startup phase, and when the spread of the objective is below 0.02, because the ranking is then unstable.

An importance describes an association in the observed trials, not a cause, and not a direction: a high importance does not say that larger values are better. Use the heat map and the parallel coordinates to see which values go with good scores.

## Attempts and Orchestrator traceability

A study launched by the Orchestrator is one attempt of one HPO node in one pipeline run. Its name joins the graph id, the run id, the node id and a random 8-character attempt id (`<graph>__<run>__<node>__<attempt>`); without graph information the name is `hpo_<dataset folder>__<attempt>`. The same identifiers are stored as attributes of the study and of each trial.

An attempt is immutable: running the node again, or forking the pipeline in the Orchestrator, creates a new attempt and a new study, never extra trials in an old one. This keeps each result tied to exactly one run, dataset and configuration, so that attempts can be compared later. The human-readable name of a graph is not an identity; the run id is.

Deleting a study removes its trials from the database only. The files of its trials stay in `hpo_runs/`.

## Trial result contract

Each trial runs a separate Python process. What it must return depends on how the study was launched.

For a study launched from the launch page, the script receives the fixed arguments, then each hyperparameter as `--name value`. It must print the objective as a plain number on the last line of its standard output:

```python
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float)
parser.add_argument("--depth", type=int)
args = parser.parse_args()
score = train_and_evaluate(lr=args.lr, depth=args.depth)
print(score)  # last line = objective
```

If the last line is not a number, the app searches the output for a line `metric_name=value`. A script that exits with a non-zero code, that runs for more than one hour, or whose value cannot be read makes the trial fail.

For Orchestrator studies, the trial script `hpo_trial.py` writes its result atomically to `result.json` in the trial folder (status, objective, `map50` and `map5095`, paths of `results.csv` and of the weights, ignored parameters). The objective is read from that file, not from the console output, which avoids losing values to encoding problems on Windows. The script still prints `map50=value` and the value on its last lines, which is how it also satisfies the contract above when the preset uses it.
