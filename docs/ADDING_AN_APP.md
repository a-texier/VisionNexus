*[Lire en francais](ADDING_AN_APP.fr.md)*

# Adding an app to the Orchestrator

> Suite-wide doc (moved here on 2026-08-13 from `Orchestrator_App/DEVELOPER_GUIDE.md` -
> its content concerns every app, not just the orchestrator itself).
> For the orchestrator's internal architecture (graph_runner, pipeline_runner, SSE,
> FREE/LOCKED), see [Orchestrator_App/docs/architecture.md](../Orchestrator_App/docs/architecture.md).

This guide explains in detail how the system works and how to code a new connection between an existing (or new) app and the orchestrator, **without ever breaking an app's ability to run standalone**.

---

## 1. Core principle: apps are independent

Each sub-application (Dataset_Explorer_App, Annotation_App, etc.) is **autonomous**: it can be launched on its own, used through its own frontend, and has no knowledge of the orchestrator.

The orchestrator never calls an app's internal code. It goes **only through their HTTP APIs**. The interconnection works in two steps:

1. **The app exposes `/api/orchestrator/...` endpoints** - routes dedicated to reading/writing data from the outside, without touching the app's normal behavior.
2. **The orchestrator translates a graph node into a series of HTTP steps** - each step is a call to one of these endpoints.

```
┌──────────────────────────────────────────────────┐
│  Independent app (e.g. Dataset_Explorer_App)             │
│                                                   │
│  GET/POST /api/...       ← normal usage (UI)     │
│  POST /api/orchestrator/ ← dedicated endpoints      │
└──────────────────────────────────────────────────┘
          ▲
          │  HTTP (httpx)
          │
┌──────────────────────────────────────────────────┐
│  Orchestrator - graph_runner.py                  │
│                                                   │
│  Graph → PipelineDef → HTTP steps               │
└──────────────────────────────────────────────────┘
```

> **Golden rule**: if a change breaks an app's standalone behavior, that is a design bug. The orchestrator must never become a dependency of the apps.

---

## 2. Overview of the execution flow

### 2.1 From graph to pipeline

```
SandgraphPage.tsx          graph_runner.py              pipeline_runner.py
     │                          │                              │
     │  POST /api/graphs/{id}/run                             │
     │─────────────────────────►│                              │
     │                          │  graph_to_pipeline()         │
     │                          │  (nodes → PipelineStep[])   │
     │                          │─────────────────────────────►│
     │                          │                              │  start_run()
     │                          │                              │  _execute()  ← async DAG
     │  SSE /run/{id}/stream    │                              │  _run_step() ← HTTP or gate
     │◄─────────────────────────│◄─────────────────────────────│
```

### 2.2 Structure of a PipelineStep

Each step is defined in `graph_runner.py` as a dict, converted into a `PipelineStep`:

```python
{
    "id":         "visu1__subset",       # "{node_id}__{action}"
    "label":      "Create subset ...",   # shown in the UI
    "app":        "Dataset_Explorer_App",        # key in APP_URLS
    "method":     "POST",                # GET or POST
    "endpoint":   "/api/orchestrator/create-subset",
    "params":     { ... },               # JSON body (POST) or query params (GET)
    "depends_on": ["visu1__verifyembed"],# DAG dependencies
    "type":       "task",                # "task" | "human_gate"
    "hint":       "...",                 # message shown during the human gate
    "app_link":   "Dataset_Explorer_App",        # "Open the app" link in the UI
}
```

**`type: "task"`** → automatic step: the orchestrator POSTs the endpoint and waits for an HTTP 200 response.

**`type: "human_gate"`** → the orchestrator pauses the pipeline (`status=waiting`), shows the `hint` message in the UI, and waits for the user to click **Continue**.

### 2.3 Key files to know

| File | Role |
|---------|------|
| `backend/core/graph_runner.py` | **Converts nodes into steps** - this is where you add new connections |
| `backend/core/pipeline_runner.py` | DAG execution engine - do not modify it to add a connection |
| `backend/core/graph_store.py` | JSON persistence of graphs |
| `backend/config.py` | `APP_URLS` - URLs of the sub-apps |
| `frontend/src/pages/SandgraphPage.tsx` | `NODE_ACCEPTS` + `onConnect` propagation |
| `frontend/src/nodes/AppNode.tsx` | Visual rendering of nodes |
| `frontend/src/components/NodeConfigPanel.tsx` | Node config form |

---

## 3. Anatomy of `graph_runner.py`

```python
def _steps_for_node(node, deps, ctx=None, parent_nodes=None) -> list[dict]:
    nid   = node["id"]
    data  = node.get("data", {})
    ntype = data.get("node_type") or node.get("type", "")
    
    if ntype == "explorer":
        return [ ... steps ... ]
    
    if ntype == "annotation":
        return [ ... steps ... ]
    
    # Add a new node type here
    if ntype == "mon_app":
        return [ ... ]
    
    return []

def graph_to_pipeline(graph):
    # Topological sort of the nodes
    ordered = _topo_sort(nodes, edges)
    
    for node in ordered:
        parent_ids   = [e["source"] for e in edges if e["target"] == nid]
        deps         = [node_last_step[pid] for pid in parent_ids]
        parent_nodes = [node_by_id[pid] for pid in parent_ids]
        
        node_steps = _steps_for_node(node, deps, ctx, parent_nodes)
        ...
```

The `ctx` parameter carries information global to the pipeline (e.g. the Annotation workspace path). The `parent_nodes` parameter gives access to the parent nodes' data (used for explorer→explorer chaining).

---

## 4. How to add a new connection - step by step

### Step 1: Add an `/api/orchestrator/` endpoint in the target app

**Rule**: create a dedicated file `api/orchestrator.py` (or `routers/orchestrator.py`) in the app. Do not modify existing routes.

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
    # Use the app's internal services
    result = mon_service.faire_quelque_chose(body.param1, body.param2)
    return {"status": "done", "result": result}
```

Register this router in `main.py`:
```python
from mon_app.api.orchestrator import router as orchestrator_router
app.include_router(orchestrator_router)
```

**Key points**:
- The router is optional - the app starts fine without the orchestrator
- No dependency on the orchestrator's code
- Return useful info for the activity logs (the JSON response is saved in `activity.json`)

### Step 2: Declare the app in `config.py`

```python
# backend/config.py
APP_URLS = {
    "Dataset_Explorer_App":   "http://localhost:8001",
    "Annotation_App": "http://localhost:8000",
    "mon-app":        "http://localhost:8006",   # ← add
    ...
}
```

### Step 3: Add the node in `graph_runner.py`

```python
# backend/core/graph_runner.py

def _steps_for_node(node, deps, ctx=None, parent_nodes=None):
    ...
    
    if ntype == "mon_app":
        param1 = data.get("mon_param", "")
        return [
            {
                "id":         f"{nid}__etape1",
                "label":      f"Run {param1}",
                "app":        "mon-app",          # key in APP_URLS
                "method":     "POST",
                "endpoint":   "/api/orchestrator/mon-action",
                "params":     {"param1": param1, "param2": data.get("param2", 10)},
                "depends_on": deps,
                "type":       "task",
                "hint":       "",
                "app_link":   "mon-app",
            },
            # Optional human gate
            {
                "id":         f"{nid}__valider",
                "label":      "Validate the result",
                "app":        "mon-app",
                "method":     "GET",
                "endpoint":   "/health",
                "params":     {},
                "depends_on": [f"{nid}__etape1"],
                "type":       "human_gate",
                "hint":       "Open Mon_App and check the result. Click Continue.",
                "app_link":   "mon-app",
            },
        ]
```

Register the app in `_needed_app_keys` for the preflight check:
```python
def _needed_app_keys(graph):
    ...
    elif ntype == "mon_app":
        needed.add("mon-app")
```

### Step 4: Add the node in the frontend

**4a. Toolbox (`SandgraphPage.tsx`)** - declare the node in the tool list:

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

**4b. Connection rules (`NODE_ACCEPTS`)** - define what this node accepts as input:

```typescript
const NODE_ACCEPTS: Record<string, string[]> = {
  explorer:       ['dataset_source', 'explorer'],
  annotation: ['explorer', 'dataset_source'],
  dvc:        ['annotation', 'explorer'],
  mlflow:     ['dvc', 'annotation'],
  mon_app:    ['annotation', 'dvc'],    // ← this node accepts annotation or dvc as input
}
```

**4c. Auto-propagation (`onConnect`)** - automatically copy fields when connecting:

```typescript
// In the onConnect handler
if (sType === 'annotation' && tType === 'mon_app' && src.data?.project_name) {
  return ns.map(n => n.id === conn.target
    ? { ...n, data: { ...n.data, project_name: src.data.project_name } } : n)
}
```

**4d. Visual rendering (`AppNode.tsx`)** - the node is rendered automatically by the generic `AppNode` component. For a custom display, add a case in the component:

```typescript
// frontend/src/nodes/AppNode.tsx
function MonAppNodeSummary({ data }: { data: AppNodeData }) {
  return (
    <div className="text-xs text-zinc-400 mt-1">
      <span>{data.mon_param || '-'}</span>
    </div>
  )
}

// In AppNode, add the case:
{ntype === 'mon_app' && <MonAppNodeSummary data={data} />}
```

**4e. Config panel (`NodeConfigPanel.tsx`)** - add the config fields:

```typescript
// frontend/src/components/NodeConfigPanel.tsx
{data.node_type === 'mon_app' && (
  <>
    <label>My parameter</label>
    <input value={data.mon_param || ''} onChange={e => onChange('mon_param', e.target.value)} />
    <label>Param 2</label>
    <input type="number" value={data.param2 ?? 10} onChange={e => onChange('param2', +e.target.value)} />
  </>
)}
```

### Step 5: Declare the type in `app_launcher.py`

So that the orchestrator can **auto-launch** this app:

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

# In graph_runner.py
_KEY_TO_APP_ID = {
    ...
    "mon-app": "mon_app",
}
```

---

## 5. Pattern: reading data from an app to display it in the graph

Example: showing the list of an app's projects inside the Orchestrator node.

### App side - read endpoint

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

### Orchestrator side - meta endpoint

```python
# backend/api/graphs.py (or a new file)
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

### Frontend side - fetch when the graph loads

```typescript
// In SandgraphPage.tsx - useEffect on load
const [monAppProjects, setMonAppProjects] = useState([])
useEffect(() => {
  fetch(`${BACKEND_BASE}/api/graphs/meta/mon-app-projects`)
    .then(r => r.json()).then(setMonAppProjects)
}, [])

// Pass to the nodes via nodeDataOverrides or directly in AppNode props
```

---

## 6. Pattern: node chaining (passing info between parent and child nodes)

When a node needs info from its parent node (e.g. explorer→explorer for subset-of-subset):

```python
# graph_runner.py - inside _steps_for_node

def _steps_for_node(node, deps, ctx=None, parent_nodes=None):
    ...
    if ntype == "mon_app":
        # Look for a parent of type "autre_app"
        parent_autre = None
        if parent_nodes:
            for pn in parent_nodes:
                if (pn.get("data", {}).get("node_type") or pn.get("type")) == "autre_app":
                    parent_autre = pn
                    break
        
        # Inherit a field from the parent
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

And in `graph_to_pipeline`, `parent_nodes` is already computed and passed in:
```python
parent_nodes = [node_by_id[pid] for pid in parent_ids if pid in node_by_id]
node_steps = _steps_for_node(node, deps, ctx, parent_nodes)
```

---

## 7. Pattern: global pipeline context

For information that must be available in **every** node (e.g. an app's workspace path):

```python
# graph_to_pipeline - building ctx
ctx: dict = {}
try:
    import httpx, asyncio
    from backend.config import APP_URLS
    # Query the app when the pipeline starts
    r = httpx.get(f"{APP_URLS['mon-app']}/api/workspace/info", timeout=2)
    ctx["mon_app_workspace"] = r.json().get("path", "")
except Exception:
    pass
```

Then in `_steps_for_node`:
```python
mon_ws = (ctx or {}).get("mon_app_workspace", "")
# Use mon_ws in the step's params
```

---

## 8. Invariants to respect

### App independence
- Apps have no knowledge of the orchestrator
- No `ORCHESTRATOR_URL` environment variable in the apps
- The `/api/orchestrator/` endpoints work even when the orchestrator is not running

### Idempotence
- Steps are **idempotent**: the pipeline can be replayed from the start on every SSE reconnect
- If a step "loads an already-existing dataset", it returns the existing one without an error (HTTP 200, not 409)
- If a subset/project already exists → return the existing one, not an error

### SSE replay
- The SSE stream replays **every event from cursor=0** on each reconnection
- Steps already marked `success` in `graph_store` are not re-executed (checked in `_run_step`)
- Human gates already handled are ignored on the `run_pipeline.py` side via `handled_gates: set`

### Separation of concerns
| Where to code | What |
|----------|------|
| App - `/api/orchestrator/` | Business logic, DB access, internal services |
| `graph_runner.py` | Node → HTTP steps translation, context passing |
| `pipeline_runner.py` | Execution engine, do not touch |
| `SandgraphPage.tsx` | Connection validation, auto-propagation, display |

---

## 9. Checklist for a new connection

- [ ] `/api/orchestrator/mon-action` endpoint in the target app
- [ ] Idempotent endpoint (no error when called twice)
- [ ] App declared in `APP_URLS` (`config.py`)
- [ ] Node declared in `_needed_app_keys` (`graph_runner.py`)
- [ ] Steps defined in `_steps_for_node` (`graph_runner.py`)
- [ ] App in `_KEY_TO_APP_ID` for auto-launch
- [ ] Node in `TOOLBOX_NODES` with its `defaults` (`SandgraphPage.tsx`)
- [ ] Rules in `NODE_ACCEPTS` (`SandgraphPage.tsx`)
- [ ] Auto-propagation in `onConnect` where relevant (`SandgraphPage.tsx`)
- [ ] Config fields in `NodeConfigPanel.tsx`
- [ ] Visual rendering in `AppNode.tsx` if needed

---

## 10. Full example - adding a fictional "Quality" app

The app checks the quality of annotated images and returns a score.

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
        raise HTTPException(422, f"Insufficient quality: {score:.2f} < {body.min_score}")
    return {"score": score, "passed": True, "export_path": body.export_path}
```

### graph_runner.py - new type

```python
if ntype == "quality":
    export_path = (ctx or {}).get("last_yolo_export", "")
    return [{
        "id": f"{nid}__check",
        "label": "Check annotation quality",
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

### SandgraphPage.tsx - one line

```typescript
const NODE_ACCEPTS = {
  ...
  quality: ['annotation'],   // only accepts an annotation node as input
}
```

That's it. The pipeline handles the rest automatically.
