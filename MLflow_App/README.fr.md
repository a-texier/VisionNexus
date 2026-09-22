*[Read in English](README.md)*

# MLflow App - Suivi d'experiences et registre de modeles

Interface web pour MLflow : experiences, runs, metriques et registre de modeles. Dans la
suite VisionNexus, cette app joue un role de superviseur : elle affiche en direct les runs
loggues par les autres apps, sans piloter elle-meme d'etape de pipeline.

## Fonctionnalites

- Liste des experiences MLflow, avec drill-down vers les runs
- Detail d'un run : metriques sous forme de graphiques, parametres, artifacts
- Registre de modeles : versions enregistrees, transition de stage
- Comparaison cote a cote de plusieurs runs selectionnes

## Architecture

- **Backend** : FastAPI (Python 3.11+) au-dessus du SDK MLflow.
- **Store serverless** : le tracking MLflow est un simple fichier **sqlite** local au
  workspace (`mlflow_data/mlflow.db`). Aucun processus `mlflow server` ne tourne et aucun
  port n'est reserve : `MlflowClient` lit et ecrit directement ce fichier, ce qui evite les
  deconnexions et collisions de port qu'imposait l'ancien mode serveur. Un
  `MLFLOW_TRACKING_URI` explicite en `http(s)://` reactive ce mode serveur legacy si besoin.
- **Frontend** : React 18 + TypeScript + Vite + TailwindCSS + Recharts.
- **Orchestrator** : MLflow est un noeud **superviseur** de la suite. Il n'a aucune arete
  entrante et n'expose pas de route `/api/orchestrator/...` : les autres apps (Training,
  Inference, Evaluation) loggent directement dans le meme fichier sqlite via leur propre
  module de logging, sans passer par cette app. MLflow App se contente d'observer ce store
  en continu et d'en afficher un resume live, aucun branchement reseau n'est necessaire.

## Lancer

Via le lanceur unifie de la suite (recommande) :

```bash
python launcher.py --app mlflow --workspace <chemin_workspace> --user <nom_utilisateur>
```

En standalone :

```bash
bash start.sh
# ou manuellement
BACKEND_PORT=8001 python -m uvicorn backend.main:app --host 0.0.0.0 --port 8001 --reload
cd frontend && VITE_BACKEND_PORT=8001 npm run dev -- --port 3001
```

Frontend : http://localhost:3001
Backend : http://localhost:8001
Store : `<workspace>/mlflow_data/mlflow.db` (sqlite, serverless, aucun port dedie)

Voir aussi [docs/ECOSYSTEM.md](../docs/ECOSYSTEM.md) pour la place de cette app dans la suite.
