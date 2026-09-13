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
- Mode integre pilote par l'Orchestrator : etude Optuna (TPE + MedianPruner) qui entraine
  directement un modele YOLO, sans script externe

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
- **Orchestrator** : `POST /api/orchestrator/hpo` lance une etude Optuna qui entraine un
  YOLO via un script de trial de reference. Cet appel est **bloquant** : il ne repond
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

Voir aussi [docs/ECOSYSTEM.md](../docs/ECOSYSTEM.md) pour la place de cette app dans la suite.
