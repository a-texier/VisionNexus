*[Read in English](README.md)*

# Optuna App - Optimisation d'hyperparametres

Interface web d'hyperparameter optimization au-dessus d'Optuna, avec stockage SQLite.
Lance un script d'entrainement en subprocess pour chaque trial et streame les logs en
temps reel.

## Fonctionnalites

- Creation, suivi et suppression d'etudes Optuna
- Lancement d'une optimisation a partir d'un script utilisateur (voir "Contrat du script"
  ci-dessous), avec espace de recherche configurable
- Suivi en direct d'une etude : progression, graphiques, table des trials
- Logs de trial en streaming (SSE)
- Mode integre pilote par l'Orchestrator : etude Optuna (TPE, pruning desactive) qui entraine
  directement un modele avec un moteur de Training_App (YOLOX par defaut), sans script externe
- Preremplissage "Optimiser un entrainement de detection" dans la page de lancement : script de
  trial, arguments, espace de recherche et metrique (mAP50) du moteur choisi

## Moteurs d'entrainement

Les trials HPO entrainent avec un moteur de Training_App (`hpo_trial.py --engine`). Le moteur
integre est YOLOX ; d'autres peuvent etre ajoutes par plugin (voir
[../docs/architecture.fr.md](../docs/architecture.fr.md#mécanisme-de-plugins)). `GET /api/orchestrator/engines` liste les
moteurs utilisables et leur catalogue : les plages de recherche par defaut (`hpo_ranges`) et la
selection par defaut (`hpo_default_optimize`) viennent du moteur, pas d'Optuna_App. Pour YOLOX :
`basic_lr_per_img`, `mosaic_prob` et `degrees` par defaut, parmi `min_lr_ratio`, `momentum`,
`weight_decay`, `mixup_prob`, `hsv_prob`, `flip_prob`, `translate`, `shear`.

Un trial optimise toujours le moteur du Training aval : l'Orchestrator refuse un graphe ou une
etude Optuna et son Training ne partagent pas le meme moteur. Un parametre inconnu du moteur est
ignore et liste dans le resultat du trial (`ignored_params`).

## Contrat du script utilisateur (mode standalone)

Le script passe en parametre doit :
- accepter ses hyperparametres en arguments CLI `--nom valeur` ;
- imprimer la valeur finale de la metrique sur la **derniere ligne** de sa sortie standard.

```python
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--lr", type=float)
parser.add_argument("--depth", type=int)
args = parser.parse_args()

score = train_and_evaluate(lr=args.lr, depth=args.depth)
print(score)  # derniere ligne = metrique
```

## Architecture

- **Backend** : FastAPI (Python 3.11+) + Optuna. Chaque etude (`study.optimize()`, appel
  synchrone) tourne dans un thread arriere-plan ; chaque trial est un `subprocess.run(...)`
  distinct sur le script utilisateur.
- **Frontend** : React 18 + TypeScript + Vite + TailwindCSS + Recharts + TanStack Query.
- **Persistance** : SQLite (`optuna.db`) dans le workspace, stockage natif d'Optuna.
- **Orchestrator** : `POST /api/orchestrator/hpo` (`engine`, `model_size`, `optimize`...) lance une
  etude Optuna qui entraine le moteur demande via le script de trial de reference `hpo_trial.py`.
  Cet appel est **bloquant** : il ne repond
  qu'une fois tous les trials termines, et les `best_params` obtenus sont fusionnes dans
  le noeud d'entrainement en aval. Dans le graphe de la suite, cette etape est protegee par
  une validation humaine avant declenchement.

## Lancer

Via le lanceur unifie de la suite (recommande) :

```bash
python launcher.py --app optuna --workspace <chemin_workspace> --user <nom_utilisateur>
```

En standalone :

```bash
pip install fastapi uvicorn optuna
cd frontend && npm install && cd ..
python launcher.py
# ou
bash start.sh
```

Frontend : http://localhost:3003
Backend : http://localhost:8003

Voir aussi [docs/README.fr.md](../docs/README.fr.md) pour la place de cette app dans la suite.
