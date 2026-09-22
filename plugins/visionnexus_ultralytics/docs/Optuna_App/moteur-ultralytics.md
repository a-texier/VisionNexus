# Moteur Ultralytics (plugin)

Cette page decrit ce que le plugin Ultralytics ajoute a Optuna_App. Le fonctionnement des etudes
est inchange : meme sampler TPE, meme suivi, meme contrat de script.

## Etudes pilotees par l'Orchestrator

`POST /api/orchestrator/hpo` accepte `"engine": "ultralytics"`. Chaque trial entraine alors un
modele Ultralytics au lieu d'un YOLOX, via le meme script de trial (`hpo_trial.py --engine`).

L'etude et le Training aval doivent utiliser le **meme moteur** : l'Orchestrator refuse le
lancement sinon, car des `best_params` d'un moteur n'ont pas de sens pour l'autre.

## Espace de recherche

Les plages viennent du catalogue du moteur (reprises de l'espace par defaut du tuner Ultralytics),
et remplacent celles de YOLOX dans la liste a cocher :

| Parametre | Plage | |
|---|---|---|
| `lr0` | 1e-5 .. 1e-1 (log) | selectionne par defaut |
| `lrf` | 1e-4 .. 0.1 (log) | |
| `momentum` | 0.7 .. 0.98 | |
| `weight_decay` | 0 .. 0.001 | |
| `warmup_epochs` | 0 .. 5 | |
| `box`, `cls` | 1 .. 20, 0.2 .. 4 | poids des pertes |
| `hsv_h`, `hsv_s`, `hsv_v` | 0 .. 0.1 / 0.9 / 0.9 | |
| `degrees` | 0 .. 45 | selectionne par defaut |
| `translate`, `scale` | 0 .. 0.9, 0 .. 0.95 | |
| `fliplr`, `mosaic`, `mixup` | 0 .. 1 | `mosaic` selectionne par defaut |

Selection par defaut : `lr0`, `mosaic`, `degrees`. Un parametre inconnu du moteur (par exemple
`basic_lr_per_img`, qui est une cle YOLOX) est ignore et signale dans le resultat du trial
(`ignored_params`).

## Etude manuelle depuis l'app

Le bloc "Optimiser un entrainement de detection" de la page de lancement propose le moteur dans sa
liste des que le plugin est disponible. Il preremplit le script de trial, ses arguments
(`--engine ultralytics --model_size ... --data_yaml ...`), l'espace de recherche du moteur et la
metrique (`map50`, a maximiser). Tout reste modifiable avant de lancer.

## Ce qu'un trial produit

Chaque trial ecrit son `result.json` habituel, avec en plus `engine` et des poids `best.pt` (au
lieu de `best_ckpt.pth`). Les plots natifs d'Ultralytics sont dans le dossier du trial
(`artifact_dir`) : c'est le meme dossier que celui affiche par le diagnostic d'un trial.
