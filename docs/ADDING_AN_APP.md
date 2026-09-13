# Ajouter une app a l'Orchestrateur

> Doc suite (deplacee ici le 2026-08-13 depuis `Orchestrator_App/DEVELOPER_GUIDE.md` -
> son contenu concerne toutes les apps, pas seulement l'orchestrateur lui-meme).
> Pour l'architecture interne de l'orchestrateur (graph_runner, pipeline_runner, SSE,
> FREE/LOCKED), voir [Orchestrator_App/docs/architecture.md](../Orchestrator_App/docs/architecture.md).

Ce guide explique comment le systeme fonctionne en detail et comment coder une nouvelle connexion entre une app existante (ou nouvelle) et l'orchestrateur, **sans jamais casser le fonctionnement autonome des apps**.

---

## 1. Principe fondamental : indépendance des apps

Chaque sous-application (Dataset_Explorer_App, Annotation_App, etc.) est **autonome** : elle peut être lancée seule, utilisée via son propre frontend, et n'a aucune connaissance de l'orchestrateur.

L'orchestrateur n'appelle jamais de code interne des apps. Il passe **uniquement par leurs API HTTP**. L'interconnexion se fait en deux temps :

1. **L'app expose des endpoints `/api/orchestrator/...`** - routes dédiées à la lecture/écriture de données depuis l'extérieur, sans toucher au comportement normal de l'app.
2. **L'orchestrateur traduit un nœud de graphe en une suite de steps HTTP** - chaque step est un appel vers ces endpoints.

```
┌──────────────────────────────────────────────────┐
│  App indépendante (ex: Dataset_Explorer_App)             │
│                                                   │
│  GET/POST /api/...       ← usage normal (UI)     │
│  POST /api/orchestrator/ ← endpoints dédiés      │
└──────────────────────────────────────────────────┘
          ▲
          │  HTTP (httpx)
          │
┌──────────────────────────────────────────────────┐
│  Orchestrator - graph_runner.py                  │
│                                                   │
│  Graphe → PipelineDef → steps HTTP               │
└──────────────────────────────────────────────────┘
```

> **Règle d'or** : si une modification casse le fonctionnement standalone d'une app, c'est un bug de conception. L'orchestrateur ne doit jamais être une dépendance des apps.

---

## 2. Vue d'ensemble du flux d'exécution

### 2.1 Du graphe au pipeline

```
SandgraphPage.tsx          graph_runner.py              pipeline_runner.py
     │                          │                              │
     │  POST /api/graphs/{id}/run                             │
     │─────────────────────────►│                              │
     │                          │  graph_to_pipeline()         │
     │                          │  (nœuds → PipelineStep[])   │
     │                          │─────────────────────────────►│
     │                          │                              │  start_run()
     │                          │                              │  _execute()  ← DAG async
     │  SSE /run/{id}/stream    │                              │  _run_step() ← HTTP ou gate
     │◄─────────────────────────│◄─────────────────────────────│
```

### 2.2 Structure d'un PipelineStep

Chaque step est défini dans `graph_runner.py` comme un dict, converti en `PipelineStep` :

```python
{
    "id":         "visu1__subset",       # "{node_id}__{action}"
    "label":      "Créer subset ...",    # affiché dans l'UI
    "app":        "Dataset_Explorer_App",        # clé dans APP_URLS
    "method":     "POST",                # GET ou POST
    "endpoint":   "/api/orchestrator/create-subset",
    "params":     { ... },               # body JSON (POST) ou query params (GET)
    "depends_on": ["visu1__verifyembed"],# dépendances DAG
    "type":       "task",                # "task" | "human_gate"
    "hint":       "...",                 # message affiché pendant la gate humaine
    "app_link":   "Dataset_Explorer_App",        # lien "Ouvrir l'app" dans l'UI
}
```

**`type: "task"`** → step automatique : l'orchestrateur POST l'endpoint et attend le retour HTTP 200.

**`type: "human_gate"`** → l'orchestrateur met le pipeline en pause (`status=waiting`), affiche le message `hint` dans l'UI, et attend que l'utilisateur clique **Continuer**.

### 2.3 Fichiers clés à connaître

| Fichier | Rôle |
|---------|------|
| `backend/core/graph_runner.py` | **Convertit les nœuds en steps** - c'est ici qu'on ajoute les nouvelles connexions |
| `backend/core/pipeline_runner.py` | Moteur d'exécution DAG - ne pas modifier pour ajouter une connexion |
| `backend/core/graph_store.py` | Persistance JSON des graphes |
| `backend/config.py` | `APP_URLS` - URLs des sous-apps |
| `frontend/src/pages/SandgraphPage.tsx` | `NODE_ACCEPTS` + `onConnect` propagation |
| `frontend/src/nodes/AppNode.tsx` | Rendu visuel des nœuds |
| `frontend/src/components/NodeConfigPanel.tsx` | Formulaire de config d'un nœud |

---

## 3. Anatomie de `graph_runner.py`

```python
def _steps_for_node(node, deps, ctx=None, parent_nodes=None) -> list[dict]:
    nid   = node["id"]
    data  = node.get("data", {})
    ntype = data.get("node_type") or node.get("type", "")
    
    if ntype == "explorer":
        return [ ... steps ... ]
    
    if ntype == "annotation":
        return [ ... steps ... ]
    
    # Ajouter ici un nouveau type de nœud
    if ntype == "mon_app":
        return [ ... ]
    
    return []

def graph_to_pipeline(graph):
    # Tri topologique des nœuds
    ordered = _topo_sort(nodes, edges)
    
    for node in ordered:
        parent_ids   = [e["source"] for e in edges if e["target"] == nid]
        deps         = [node_last_step[pid] for pid in parent_ids]
        parent_nodes = [node_by_id[pid] for pid in parent_ids]
        
        node_steps = _steps_for_node(node, deps, ctx, parent_nodes)
        ...
```

Le paramètre `ctx` contient des informations globales au pipeline (ex: chemin du workspace Annotation). Le paramètre `parent_nodes` donne accès aux données des nœuds parents (utilisé pour le chaining explorer→explorer).

---

## 4. Comment ajouter une nouvelle connexion - pas à pas

### Étape 1 : Ajouter un endpoint `/api/orchestrator/` dans l'app cible

**Règle** : créer un fichier dédié `api/orchestrator.py` (ou `routers/orchestrator.py`) dans l'app. Ne pas modifier les routes existantes.

```python
# mon_app/api/orchestrator.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])

class MonActionRequest(BaseModel):
    param1: str
    param2: int = 10

@router.post("/mon-action")
def mon_action(body: MonActionRequest):
    # Utiliser les services internes de l'app
    result = mon_service.faire_quelque_chose(body.param1, body.param2)
    return {"status": "done", "result": result}
```

Enregistrer ce router dans `main.py` :
```python
from mon_app.api.orchestrator import router as orchestrator_router
app.include_router(orchestrator_router)
```

**Points clés** :
- Le router est optionnel - l'app démarre sans l'orchestrateur
- Pas de dépendance au code de l'orchestrateur
- Retourner des infos utiles pour les logs d'activité (le retour JSON est sauvegardé dans `activity.json`)

### Étape 2 : Déclarer l'app dans `config.py`

```python
# backend/config.py
APP_URLS = {
    "Dataset_Explorer_App":   "http://localhost:8001",
    "Annotation_App": "http://localhost:8000",
    "mon-app":        "http://localhost:8006",   # ← ajouter
    ...
}
```

### Étape 3 : Ajouter le nœud dans `graph_runner.py`

```python
# backend/core/graph_runner.py

def _steps_for_node(node, deps, ctx=None, parent_nodes=None):
    ...
    
    if ntype == "mon_app":
        param1 = data.get("mon_param", "")
        return [
            {
                "id":         f"{nid}__etape1",
                "label":      f"Faire {param1}",
                "app":        "mon-app",          # clé dans APP_URLS
                "method":     "POST",
                "endpoint":   "/api/orchestrator/mon-action",
                "params":     {"param1": param1, "param2": data.get("param2", 10)},
                "depends_on": deps,
                "type":       "task",
                "hint":       "",
                "app_link":   "mon-app",
            },
            # Gate humaine optionnelle
            {
                "id":         f"{nid}__valider",
                "label":      "Valider le résultat",
                "app":        "mon-app",
                "method":     "GET",
                "endpoint":   "/health",
                "params":     {},
                "depends_on": [f"{nid}__etape1"],
                "type":       "human_gate",
                "hint":       "Ouvrez Mon_App et vérifiez le résultat. Cliquez Continuer.",
                "app_link":   "mon-app",
            },
        ]
```

Enregistrer l'app dans `_needed_app_keys` pour le preflight check :
```python
def _needed_app_keys(graph):
    ...
    elif ntype == "mon_app":
        needed.add("mon-app")
```

### Étape 4 : Ajouter le nœud dans le frontend

**4a. Toolbox (`SandgraphPage.tsx`)** - déclarer le nœud dans la liste des outils :

```typescript
// frontend/src/pages/SandgraphPage.tsx
const TOOLBOX_NODES = [
  ...
  {
    type: 'mon_app',
    label: 'Mon App',
    icon: SomeLucideIcon,
    color: 'text-teal-400 border-teal-700/50 hover:bg-teal-900/20',
    defaults: {
      node_type: 'mon_app',
      label: 'Mon App',
      mon_param: '',
      param2: 10,
    }
  },
]
```

**4b. Règles de connexion (`NODE_ACCEPTS`)** - définir ce que ce nœud accepte en entrée :

```typescript
const NODE_ACCEPTS: Record<string, string[]> = {
  explorer:       ['dataset_source', 'explorer'],
  annotation: ['explorer', 'dataset_source'],
  dvc:        ['annotation', 'explorer'],
  mlflow:     ['dvc', 'annotation'],
  mon_app:    ['annotation', 'dvc'],    // ← ce nœud accepte annotation ou dvc en entrée
}
```

**4c. Auto-propagation (`onConnect`)** - copier automatiquement des champs lors de la connexion :

```typescript
// Dans le handler onConnect
if (sType === 'annotation' && tType === 'mon_app' && src.data?.project_name) {
  return ns.map(n => n.id === conn.target
    ? { ...n, data: { ...n.data, project_name: src.data.project_name } } : n)
}
```

**4d. Rendu visuel (`AppNode.tsx`)** - le nœud est rendu automatiquement par le composant générique `AppNode`. Si on veut un affichage custom, ajouter un cas dans le composant :

```typescript
// frontend/src/nodes/AppNode.tsx
function MonAppNodeSummary({ data }: { data: AppNodeData }) {
  return (
    <div className="text-xs text-zinc-400 mt-1">
      <span>{data.mon_param || '-'}</span>
    </div>
  )
}

// Dans AppNode, ajouter le cas :
{ntype === 'mon_app' && <MonAppNodeSummary data={data} />}
```

**4e. Panneau de configuration (`NodeConfigPanel.tsx`)** - ajouter les champs de config :

```typescript
// frontend/src/components/NodeConfigPanel.tsx
{data.node_type === 'mon_app' && (
  <>
    <label>Mon paramètre</label>
    <input value={data.mon_param || ''} onChange={e => onChange('mon_param', e.target.value)} />
    <label>Param 2</label>
    <input type="number" value={data.param2 ?? 10} onChange={e => onChange('param2', +e.target.value)} />
  </>
)}
```

### Étape 5 : Déclarer le type dans `app_launcher.py`

Pour que l'orchestrateur puisse **auto-lancer** cette app :

```python
# backend/core/app_launcher.py
APP_CONFIGS = {
    ...
    "mon_app": {
        "app_id":   "mon_app",
        "app_dir":  Path("../Mon_App"),
        "script":   "launcher.py",
        "env_vars": {},
    },
}

# Dans graph_runner.py
_KEY_TO_APP_ID = {
    ...
    "mon-app": "mon_app",
}
```

---

## 5. Pattern : lire des données d'une app pour les afficher dans le graphe

Exemple : afficher la liste des projets d'une app dans le nœud Orchestrator.

### Côté app - endpoint de lecture

```python
@router.get("/status")
def get_status():
    return {
        "projects": [
            {"id": p.id, "name": p.name, "frame_count": p.frame_count}
            for p in session.exec(select(Project)).all()
        ]
    }
```

### Côté orchestrateur - endpoint méta

```python
# backend/api/graphs.py (ou nouveau fichier)
@router.get("/meta/mon-app-projects")
async def get_mon_app_projects():
    from backend.config import APP_URLS
    import httpx
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{APP_URLS['mon-app']}/api/orchestrator/status")
            return r.json().get("projects", [])
    except Exception:
        return []
```

### Côté frontend - fetch au chargement du graphe

```typescript
// Dans SandgraphPage.tsx - useEffect au chargement
const [monAppProjects, setMonAppProjects] = useState([])
useEffect(() => {
  fetch(`${BACKEND_BASE}/api/graphs/meta/mon-app-projects`)
    .then(r => r.json()).then(setMonAppProjects)
}, [])

// Passer aux nœuds via nodeDataOverrides ou directement dans AppNode props
```

---

## 6. Pattern : chaining de nœuds (passage d'infos entre nœuds parents → enfants)

Quand un nœud a besoin d'infos du nœud parent (ex: explorer→explorer pour le subset-of-subset) :

```python
# graph_runner.py - dans _steps_for_node

def _steps_for_node(node, deps, ctx=None, parent_nodes=None):
    ...
    if ntype == "mon_app":
        # Chercher un parent de type "autre_app"
        parent_autre = None
        if parent_nodes:
            for pn in parent_nodes:
                if (pn.get("data", {}).get("node_type") or pn.get("type")) == "autre_app":
                    parent_autre = pn
                    break
        
        # Hériter d'un champ du parent
        param_hérité = parent_autre["data"]["result_key"] if parent_autre else ""
        
        return [{
            ...
            "params": {
                "mon_param": data.get("mon_param", ""),
                **({"param_hérite": param_hérité} if param_hérité else {}),
            },
            ...
        }]
```

Et dans `graph_to_pipeline`, les `parent_nodes` sont déjà calculés et transmis :
```python
parent_nodes = [node_by_id[pid] for pid in parent_ids if pid in node_by_id]
node_steps = _steps_for_node(node, deps, ctx, parent_nodes)
```

---

## 7. Pattern : contexte global du pipeline

Pour des infos qui doivent être disponibles dans **tous** les nœuds (ex: chemin workspace d'une app) :

```python
# graph_to_pipeline - construction du ctx
ctx: dict = {}
try:
    import httpx, asyncio
    from backend.config import APP_URLS
    # Interroger l'app au démarrage du pipeline
    r = httpx.get(f"{APP_URLS['mon-app']}/api/workspace/info", timeout=2)
    ctx["mon_app_workspace"] = r.json().get("path", "")
except Exception:
    pass
```

Puis dans `_steps_for_node` :
```python
mon_ws = (ctx or {}).get("mon_app_workspace", "")
# Utiliser mon_ws dans les params du step
```

---

## 8. Invariants à respecter

### Indépendance des apps
- Les apps ne connaissent pas l'orchestrateur
- Aucune variable d'environnement `ORCHESTRATOR_URL` dans les apps
- Les endpoints `/api/orchestrator/` fonctionnent même si l'orchestrateur n'est pas lancé

### Idempotence
- Les steps sont **idempotents** : le pipeline peut être rejoué depuis le début à chaque SSE reconnect
- Si un step "charge un dataset déjà existant", il retourne l'existant sans erreur (HTTP 200, pas 409)
- Si un subset/projet existe déjà → retourner l'existant, pas une erreur

### SSE replay
- Le stream SSE rejoue **tous les events depuis cursor=0** à chaque reconnexion
- Les steps déjà `success` dans `graph_store` ne sont pas re-exécutés (vérification dans `_run_step`)
- Les human gates déjà traitées sont ignorées côté `run_pipeline.py` via `handled_gates: set`

### Séparation des préoccupations
| Où coder | Quoi |
|----------|------|
| App - `/api/orchestrator/` | Logique métier, accès DB, services internes |
| `graph_runner.py` | Traduction nœud → steps HTTP, passage de contexte |
| `pipeline_runner.py` | Moteur d'exécution, ne pas toucher |
| `SandgraphPage.tsx` | Validation connexions, auto-propagation, affichage |

---

## 9. Checklist pour une nouvelle connexion

- [ ] Endpoint `/api/orchestrator/mon-action` dans l'app cible
- [ ] Endpoint idempotent (pas d'erreur si appelé deux fois)
- [ ] App déclarée dans `APP_URLS` (`config.py`)
- [ ] Nœud déclaré dans `_needed_app_keys` (`graph_runner.py`)
- [ ] Steps définis dans `_steps_for_node` (`graph_runner.py`)
- [ ] App dans `_KEY_TO_APP_ID` pour l'auto-launch
- [ ] Nœud dans `TOOLBOX_NODES` avec ses `defaults` (`SandgraphPage.tsx`)
- [ ] Règles dans `NODE_ACCEPTS` (`SandgraphPage.tsx`)
- [ ] Auto-propagation dans `onConnect` si pertinent (`SandgraphPage.tsx`)
- [ ] Champs de config dans `NodeConfigPanel.tsx`
- [ ] Rendu visuel dans `AppNode.tsx` si nécessaire

---

## 10. Exemple complet - ajouter une app "Qualité" fictive

L'app vérifie la qualité des images annotées et retourne un score.

### App (quality-app) - endpoint

```python
# quality_app/api/orchestrator.py
class QualityCheckRequest(BaseModel):
    export_path: str
    min_score: float = 0.7

@router.post("/check")
def quality_check(body: QualityCheckRequest):
    score = run_quality_check(body.export_path)
    if score < body.min_score:
        raise HTTPException(422, f"Qualité insuffisante : {score:.2f} < {body.min_score}")
    return {"score": score, "passed": True, "export_path": body.export_path}
```

### graph_runner.py - nouveau type

```python
if ntype == "quality":
    export_path = (ctx or {}).get("last_yolo_export", "")
    return [{
        "id": f"{nid}__check",
        "label": "Vérifier qualité annotations",
        "app": "quality-app",
        "method": "POST",
        "endpoint": "/api/orchestrator/check",
        "params": {"export_path": export_path, "min_score": data.get("min_score", 0.7)},
        "depends_on": deps,
        "type": "task",
        "hint": "",
        "app_link": "quality-app",
    }]
```

### SandgraphPage.tsx - une ligne

```typescript
const NODE_ACCEPTS = {
  ...
  quality: ['annotation'],   // n'accepte qu'une annotation en entrée
}
```

C'est tout. Le pipeline gère le reste automatiquement.
