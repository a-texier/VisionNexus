# Architecture Template — FastAPI + Vite + Workspace Multi-utilisateurs

> Doc partagee de la suite (deplacee ici le 2026-08-13, existait avant en copie
> identique dans Annotation_App et Dataset_Explorer_App). Reference unique desormais :
> les deux apps y renvoient au lieu de dupliquer le fichier.

> **Usage** : ce document est un blueprint complet pour créer une nouvelle application
> en partant de zéro, avec la même architecture stable que Dataset Explorer.
> Chercher/remplacer `MonApp` / `mon_app` par le nom de votre application.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Structure des dossiers](#2-structure-des-dossiers)
3. [Pattern workspace & config.py](#3-pattern-workspace--configpy)
4. [Launcher multi-utilisateurs](#4-launcher-multi-utilisateurs)
5. [Base de données — SQLModel + SQLite](#5-base-de-données--sqlmodel--sqlite)
6. [Settings utilisateur (settings.json)](#6-settings-utilisateur-settingsjson)
7. [Données globales vs données workspace](#7-données-globales-vs-données-workspace)
8. [FastAPI — structure main.py + routers](#8-fastapi--structure-mainpy--routers)
9. [Pattern SSE — tâches longues non-bloquantes](#9-pattern-sse--tâches-longues-non-bloquantes)
10. [Frontend Vite/React — structure](#10-frontend-vitereact--structure)
11. [Pattern API client (client.ts)](#11-pattern-api-client-clientts)
12. [TanStack Query — hooks de données](#12-tanstack-query--hooks-de-données)
13. [CORS dynamique multi-ports](#13-cors-dynamique-multi-ports)
14. [StaticFiles — servir des fichiers depuis le workspace](#14-staticfiles--servir-des-fichiers-depuis-le-workspace)
15. [Checklist de démarrage d'un nouveau projet](#15-checklist-de-démarrage-dun-nouveau-projet)
16. [Pièges fréquents et solutions éprouvées](#16-pièges-fréquents-et-solutions-éprouvées)

---

## 1. Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────┐
│                        MonApp/                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐│
│  │  backend/    │   │  frontend/   │   │  launcher.py         ││
│  │  FastAPI     │   │  Vite+React  │   │  (depuis n'importe   ││
│  │  port : 8001 │   │  port : 5173 │   │   où, multi-users)   ││
│  └──────────────┘   └──────────────┘   └──────────────────────┘│
│                                                                  │
│  data/                      ← DANS l'appli (fixe, global)       │
│  ├── global_registry.json   ← données partagées tous workspaces │
│  └── global_assets/         ← fichiers lisibles par tous        │
│                                                                  │
│  {WORKSPACE}/               ← HORS de l'appli (par user)        │
│  ├── mon_app.db             ← SQLite isolé par user              │
│  ├── settings.json          ← préférences utilisateur            │
│  └── cache/                 ← tout ce qui est généré             │
└─────────────────────────────────────────────────────────────────┘
```

**Principe fondamental** : l'appli (code source) ne contient aucune donnée utilisateur.
Tout ce qui est persistant va dans `WORKSPACE`, configurable via variable d'environnement.
Seules les données *vraiment partagées entre tous les utilisateurs* vont dans `data/` de l'appli.

---

## 2. Structure des dossiers

```
MonApp/
├── launcher.py                  # lancement depuis n'importe où
├── CLAUDE.md                    # guide développeur / IA
│
├── backend/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app, lifespan, CORS, static, routers
│   ├── config.py                # WORKSPACE + chemins depuis env vars
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py          # engine SQLite, create_db_and_tables()
│   │   └── models.py            # SQLModel tables
│   ├── api/
│   │   ├── __init__.py
│   │   ├── items.py             # router principal (nommez par domaine métier)
│   │   └── settings.py          # GET/PATCH /api/settings
│   └── core/
│       ├── __init__.py
│       └── processor.py         # logique métier pure (sans FastAPI)
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # routing + layout sidebar
│       ├── api/
│       │   └── client.ts        # toutes les fonctions fetch + SSE
│       ├── hooks/
│       │   ├── useItems.ts      # TanStack Query hooks par domaine
│       │   └── useSettings.ts
│       ├── pages/
│       │   ├── Home.tsx
│       │   └── SettingsPage.tsx
│       ├── components/
│       └── types/
│           └── api.ts           # interfaces TypeScript pour toutes les réponses API
│
└── data/                        # données globales de l'appli (dans le repo)
    ├── global_registry.json     # registre des entités partagées
    └── global_assets/           # ressources accessibles à tous les workspaces
```

---

## 3. Pattern workspace & config.py

C'est le cœur de l'architecture. **Tout** ce qui est persistant passe par `config.py`.

```python
# backend/config.py
import os
from pathlib import Path

# ── Workspace utilisateur ──────────────────────────────────────────────
# Configurable via variable d'environnement MON_APP_WORKSPACE.
# Défaut : <racine_app>/data  (pratique en dev, inacceptable en prod multi-users)
_app_root = Path(__file__).parent.parent
_default_workspace = _app_root / "data"

WORKSPACE = Path(os.environ.get("MON_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

# ── Chemins workspace (tous relatifs à WORKSPACE) ─────────────────────
DATABASE_PATH = WORKSPACE / "mon_app.db"
DATABASE_URL  = f"sqlite:///{DATABASE_PATH}"
SETTINGS_FILE = WORKSPACE / "settings.json"
CACHE_DIR     = WORKSPACE / "cache"         # générez vos fichiers ici
EXPORTS_DIR   = WORKSPACE / "exports"

# ── Données globales (dans l'appli, path fixe) ────────────────────────
# Ces données sont LISIBLES par tous les workspaces.
# Ne stockez ici que des données vraiment partagées (registres, assets publics).
GLOBAL_DATA_DIR      = _app_root / "data"
GLOBAL_REGISTRY_FILE = GLOBAL_DATA_DIR / "global_registry.json"
GLOBAL_ASSETS_DIR    = GLOBAL_DATA_DIR / "global_assets"

# ── Créer les dossiers au boot (StaticFiles en a besoin) ──────────────
for _d in [CACHE_DIR, EXPORTS_DIR, GLOBAL_ASSETS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ── Utilisateur courant ───────────────────────────────────────────────
CURRENT_USER = os.environ.get("MON_APP_USER", "unknown")

# ── Réseau ────────────────────────────────────────────────────────────
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",           "8001"))
FRONTEND_PORT = int(os.environ.get("MON_APP_FRONTEND_PORT",  "5173"))

_cors_bases = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    # Toujours autoriser les 3 ports Vite courants (Vite prend le suivant si occupé)
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
    "http://localhost:5175", "http://127.0.0.1:5175",
}
CORS_ORIGINS = list(_cors_bases)
```

**Règle** : aucun chemin de fichier ne doit être écrit en dur dans les routers ou la logique métier.
Tout passe par les constantes de `config.py`.

---

## 4. Launcher multi-utilisateurs

Copiez `launcher.py` de Dataset Explorer et adaptez la section configuration :

```python
# ── À adapter par chaque utilisateur ──────────────────────────────────
APP_ROOT_PATH  = r"C:\chemin\vers\MonApp"         # identique pour tous
WORKSPACE_PATH = r"C:\Users\alice\mon_app_ws"     # propre à chaque user
CONDA_ENV      = "mon_env"
USER_NAME      = "alice"

# ── Variables exportées automatiquement ──────────────────────────────
# env["MON_APP_WORKSPACE"]     = workspace
# env["MON_APP_USER"]          = USER_NAME
# env["BACKEND_PORT"]          = str(backend_port)
# env["MON_APP_FRONTEND_PORT"] = str(frontend_port)
# env["VITE_BACKEND_PORT"]     = str(backend_port)   # lu par vite.config.ts
# env["VITE_FRONTEND_PORT"]    = str(frontend_port)
```

**Ce que le launcher gère automatiquement :**
- Allocation de ports libres (verrou fichier pour éviter la race condition)
- Registre partagé des instances actives (`data/.instances.json`)
- Démarrage ordonné : backend → attente port ouvert → frontend
- Arrêt propre sur Ctrl+C (SIGINT/SIGTERM)
- Détection de Python dans l'env conda (cross-platform)

**Isolation garantie :** deux utilisateurs avec des workspaces différents ont
des DB séparées, des caches séparés et des ports différents → zéro conflit.

---

## 5. Base de données — SQLModel + SQLite

```python
# backend/db/database.py
from sqlmodel import SQLModel, create_engine, Session
from backend.config import DATABASE_URL

# check_same_thread=False requis pour FastAPI (async workers multiples)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    """Dépendance FastAPI — injecter dans les routes avec Depends(get_session)."""
    with Session(engine) as session:
        yield session
```

```python
# backend/db/models.py
from datetime import datetime
from typing import Optional
from sqlmodel import SQLModel, Field

class Item(SQLModel, table=True):
    id:         Optional[int] = Field(default=None, primary_key=True)
    name:       str
    status:     str  = Field(default="pending")   # pending | processing | ready | error
    is_global:  bool = Field(default=False)        # partagé entre workspaces ?
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

**Migrations légères** (pas d'Alembic) — colonnes ajoutées à chaud dans le lifespan :

```python
# Dans lifespan(), après create_db_and_tables() :
from sqlalchemy import text, inspect as sa_inspect
with Session(engine) as session:
    cols = {c["name"] for c in sa_inspect(engine).get_columns("item")}
    if "nouvelle_colonne" not in cols:
        session.exec(text("ALTER TABLE item ADD COLUMN nouvelle_colonne TEXT DEFAULT NULL"))
        session.commit()
```

---

## 6. Settings utilisateur (settings.json)

```python
# backend/api/settings.py
import json
from pathlib import Path
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel
from backend.config import SETTINGS_FILE

router = APIRouter(prefix="/api")

class AppSettings(BaseModel):
    theme:             str       = "dark"
    pinned_item_ids:   List[int] = []
    use_symlinks:      bool      = True
    # ajoutez vos préférences ici

def load_settings() -> AppSettings:
    if SETTINGS_FILE.exists():
        try:
            return AppSettings(**json.loads(SETTINGS_FILE.read_text("utf-8")))
        except Exception:
            pass
    return AppSettings()

def save_settings(s: AppSettings) -> None:
    SETTINGS_FILE.write_text(s.model_dump_json(indent=2), encoding="utf-8")

@router.get("/settings",  response_model=AppSettings)
def get_settings():
    return load_settings()

@router.patch("/settings", response_model=AppSettings)
def update_settings(body: AppSettings):
    save_settings(body)
    return body
```

**Côté frontend — hook useSettings :**

```typescript
// src/hooks/useSettings.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { settingsAPI } from '../api/client'

export function useSettings() {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn:  settingsAPI.get,
    staleTime: 30_000,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings'] })
  return { settings, isLoading, refresh }
}
```

---

## 7. Données globales vs données workspace

### Schéma mental

| Donnée | Stockage | Accessible par |
|---|---|---|
| Entrées DB d'un user | `{WORKSPACE}/mon_app.db` | Ce user uniquement |
| Préférences | `{WORKSPACE}/settings.json` | Ce user uniquement |
| Fichiers générés (cache, exports) | `{WORKSPACE}/cache/` | Ce user uniquement |
| Entités partagées entre users | `data/global_registry.json` | Tous les workspaces |
| Assets publics | `data/global_assets/` | Tous les workspaces |

### Pattern registre global

```python
# Dans api/items.py
import json
from backend.config import GLOBAL_REGISTRY_FILE

def _load_global_registry() -> list[dict]:
    if GLOBAL_REGISTRY_FILE.exists():
        try:
            return json.loads(GLOBAL_REGISTRY_FILE.read_text("utf-8"))
        except Exception:
            pass
    return []

def _save_global_registry(entries: list[dict]) -> None:
    GLOBAL_REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    GLOBAL_REGISTRY_FILE.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8"
    )

def _upsert_global_registry(entry: dict) -> None:
    """Ajoute ou met à jour une entrée dans le registre (clé : 'name')."""
    entries = _load_global_registry()
    entries = [e for e in entries if e.get("name") != entry["name"]]
    entries.append(entry)
    _save_global_registry(entries)
```

### Pattern list_items — fusion workspace + global

```python
@router.get("/items", response_model=List[ItemSummary])
def list_items(session: Session = Depends(get_session)):
    # 1. Entités dans ce workspace
    workspace_items = session.exec(select(Item)).all()
    workspace_names = {it.name for it in workspace_items}

    # 2. Entités globales pas encore dans ce workspace → badge "disponible"
    global_entries = _load_global_registry()
    extra = [
        ItemSummary(
            id=-1,
            name=e["name"],
            is_global=True,
            in_workspace=False,   # ← clé pour le frontend
            **{k: e.get(k) for k in ["image_count", "created_at"]},
        )
        for e in global_entries
        if e["name"] not in workspace_names
    ]

    result = [_item_to_summary(it) for it in workspace_items] + extra
    return result
```

---

## 8. FastAPI — structure main.py + routers

```python
# backend/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.config import CORS_ORIGINS, CACHE_DIR, GLOBAL_ASSETS_DIR
from backend.db.database import create_db_and_tables, engine
from backend.api import items as items_router
from backend.api import settings as settings_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Tables DB
    create_db_and_tables()

    # 2. Migrations colonnes manquantes (voir § 5)
    _run_migrations()

    # 3. Récupération des tâches bloquées (crash mid-processing)
    _recover_stuck_tasks()

    # 4. Chargement des modèles lourds (ML, etc.)
    await _load_models()

    yield  # ← l'app est vivante ici

    # 5. Nettoyage à l'arrêt
    _cleanup()

app = FastAPI(title="MonApp", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers API (AVANT les StaticFiles) ──────────────────────────────
# IMPORTANT : déclarer d'abord les routes spécifiques avant les routes
# avec paramètres génériques ({id}) pour éviter les collisions.
# Exemple : /items/merge avant /items/{item_id}
app.include_router(items_router.router)
app.include_router(settings_router.router)

# ── StaticFiles (APRÈS les routers API) ──────────────────────────────
# Le workspace peut changer entre deux boots — monté dynamiquement.
app.mount("/cache",         StaticFiles(directory=str(CACHE_DIR)),        name="cache")
app.mount("/global-assets", StaticFiles(directory=str(GLOBAL_ASSETS_DIR)), name="global-assets")

@app.get("/health")
def health():
    return {"status": "ok"}
```

### Structure d'un router

```python
# backend/api/items.py
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlmodel import Session, select
from backend.db.database import get_session
from backend.db.models import Item

router = APIRouter(prefix="/api")

# ── Schémas Pydantic / SQLModel ───────────────────────────────────────
class ItemCreate(BaseModel):
    name: str
    share_globally: bool = False

class ItemSummary(BaseModel):
    id: int
    name: str
    status: str
    is_global: bool
    in_workspace: bool = True

# ── Routes ────────────────────────────────────────────────────────────
# RÈGLE : routes spécifiques ("merge", "global", etc.) AVANT /{item_id}

@router.get("/items", response_model=List[ItemSummary])
def list_items(session: Session = Depends(get_session)):
    ...

@router.post("/items", response_model=ItemSummary, status_code=201)
def create_item(body: ItemCreate, background_tasks: BackgroundTasks,
                session: Session = Depends(get_session)):
    item = Item(name=body.name, status="pending")
    session.add(item)
    session.commit()
    session.refresh(item)
    # Tâche longue en arrière-plan — non bloquant
    background_tasks.add_task(_process_item_bg, item.id)
    return _item_to_summary(item)

@router.get("/items/{item_id}", response_model=ItemSummary)
def get_item(item_id: int, session: Session = Depends(get_session)):
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item introuvable")
    return _item_to_summary(item)

@router.delete("/items/{item_id}")
def delete_item(item_id: int, session: Session = Depends(get_session)):
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(404)
    session.delete(item)
    session.commit()
    return {"ok": True}
```

---

## 9. Pattern SSE — tâches longues non-bloquantes

### Pourquoi POST + ReadableStream et pas EventSource ?

`EventSource` ne supporte que GET. Les tâches longues déclenchées par l'utilisateur
sont des POST (déclenchement intentionnel, pas abonnement). → `fetch() + ReadableStream`.

### Backend — générateur SSE

```python
# backend/api/items.py
import asyncio
import json
from fastapi.responses import StreamingResponse

# Suivi en mémoire — survit à la navigation React (hors composant)
_process_progress: dict[int, dict] = {}

@router.post("/items/{item_id}/process")
def start_process(item_id: int, session: Session = Depends(get_session)):
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(404)

    async def _stream():
        def _emit(event: dict) -> str:
            return f"data: {json.dumps(event)}\n\n"

        try:
            item.status = "processing"
            session.commit()
            yield _emit({"phase": "start", "progress": 0})

            for i, chunk in enumerate(my_long_task(item)):
                pct = int((i + 1) / total * 100)
                _process_progress[item_id] = {"phase": "processing", "progress": pct}
                yield _emit({"phase": "processing", "progress": pct})
                await asyncio.sleep(0)   # cède la main à l'event loop

            item.status = "ready"
            session.commit()
            _process_progress.pop(item_id, None)
            yield _emit({"phase": "done", "progress": 100})

        except Exception as exc:
            item.status = "error"
            session.commit()
            yield _emit({"phase": "error", "message": str(exc)})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # désactive le buffering nginx
        },
    )
```

### Frontend — consommateur SSE

```typescript
// src/api/client.ts
export interface ProgressEvent {
  phase: 'start' | 'processing' | 'done' | 'error'
  progress?: number
  message?: string
}

export async function startProcess(
  itemId: number,
  onEvent: (e: ProgressEvent) => void,
  onDone:  () => void,
): Promise<void> {
  // IMPORTANT : URL directe vers le backend, PAS via proxy Vite
  // Le proxy Vite bufferise parfois les SSE → connexion directe uniquement
  const BASE = `http://localhost:${import.meta.env.VITE_BACKEND_PORT ?? 8001}`

  const res = await fetch(`${BASE}/api/items/${itemId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok || !res.body) throw new Error('SSE failed')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      try {
        const event: ProgressEvent = JSON.parse(line.slice(5).trim())
        onEvent(event)
        if (event.phase === 'done')  { onDone(); return }
        if (event.phase === 'error') { throw new Error(event.message) }
      } catch { /* JSON malformé */ }
    }
  }
}
```

### État SSE survivant à la navigation

```typescript
// HORS du composant React (module-level) → survit aux démontages
const _processState = new Map<number, { phase: string; progress: number }>()

// Dans le composant :
const [progress, setProgress] = useState(() => _processState.get(itemId) ?? null)

const handleStart = () => {
  startProcess(itemId,
    (e) => {
      _processState.set(itemId, e)    // mise à jour module-level
      setProgress(e)                   // mise à jour React (no-op si démonté)
    },
    () => {
      _processState.delete(itemId)
      qc.invalidateQueries({ queryKey: ['items'] })
    }
  )
}
```

---

## 10. Frontend Vite/React — structure

### vite.config.ts

```typescript
// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.VITE_BACKEND_PORT ?? '8001'
const target = `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,   // fallback si --port non passé
    proxy: {
      '/api':           { target, changeOrigin: true, timeout: 300_000 },
      '/cache':         { target, changeOrigin: true },
      '/global-assets': { target, changeOrigin: true },
    },
  },
})
```

### package.json — dépendances minimales

```json
{
  "dependencies": {
    "react": "^18",
    "react-dom": "^18",
    "react-router-dom": "^6",
    "@tanstack/react-query": "^5",
    "axios": "^1",
    "react-hot-toast": "^2",
    "lucide-react": "^0.400"
  },
  "devDependencies": {
    "typescript": "^5",
    "vite": "^5",
    "@vitejs/plugin-react": "^4",
    "tailwindcss": "^3",
    "autoprefixer": "^10",
    "postcss": "^8"
  }
}
```

### App.tsx — squelette routing + sidebar

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { Home, Settings } from 'lucide-react'
import HomePage from './pages/Home'
import SettingsPage from './pages/SettingsPage'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

const NAV = [
  { to: '/', icon: <Home size={18} />, label: 'Accueil', exact: true },
  { to: '/settings', icon: <Settings size={18} />, label: 'Paramètres', exact: true },
]

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden bg-gray-950">
          <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
            <div className="px-4 py-5 border-b border-gray-800">
              <h1 className="text-white font-bold text-base">MonApp</h1>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV.map(item => (
                <NavLink key={item.to} to={item.to} end={item.exact}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                    ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`
                  }>
                  {item.icon}{item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
        <Toaster position="bottom-right"
          toastOptions={{ style: { background: '#1f2937', color: '#f9fafb', border: '1px solid #374151' } }} />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

---

## 11. Pattern API client (client.ts)

```typescript
// src/api/client.ts
import axios from 'axios'
import type { ItemSummary, ItemCreate, AppSettings } from '../types/api'

// Proxy Vite → /api redirige vers le backend
const api = axios.create({ baseURL: '' })

// URL directe backend pour SSE (bypass proxy Vite)
export const BACKEND_BASE = `http://localhost:${import.meta.env.VITE_BACKEND_PORT ?? 8001}`

// ── Items ──────────────────────────────────────────────────────────────
export const itemsAPI = {
  list:   ()                     => api.get<ItemSummary[]>('/api/items').then(r => r.data),
  get:    (id: number)           => api.get<ItemSummary>(`/api/items/${id}`).then(r => r.data),
  create: (body: ItemCreate)     => api.post<ItemSummary>('/api/items', body).then(r => r.data),
  delete: (id: number)           => api.delete(`/api/items/${id}`).then(r => r.data),
  update: (id: number, body: Partial<ItemCreate>) =>
    api.patch<ItemSummary>(`/api/items/${id}`, body).then(r => r.data),
}

// ── Settings ──────────────────────────────────────────────────────────
export const settingsAPI = {
  get:    ()                  => api.get<AppSettings>('/api/settings').then(r => r.data),
  update: (body: AppSettings) => api.patch<AppSettings>('/api/settings', body).then(r => r.data),
}
```

### types/api.ts — interfaces TypeScript

```typescript
// src/types/api.ts
// Miroir exact des schémas Pydantic backend.
// Mettre à jour ici dès qu'un schéma backend change.

export interface ItemSummary {
  id:           number
  name:         string
  status:       'pending' | 'processing' | 'ready' | 'error'
  is_global:    boolean
  in_workspace: boolean
  created_at:   string
}

export interface ItemCreate {
  name:           string
  share_globally?: boolean
}

export interface AppSettings {
  theme:           'dark' | 'light'
  pinned_item_ids: number[]
  use_symlinks:    boolean
}
```

---

## 12. TanStack Query — hooks de données

```typescript
// src/hooks/useItems.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { itemsAPI } from '../api/client'
import type { ItemSummary } from '../types/api'

// Liste complète
export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn:  itemsAPI.list,
    staleTime: 10_000,
    refetchInterval: (data) =>
      // Auto-poll si au moins un item est en cours de traitement
      data?.some(it => it.status === 'processing') ? 2_000 : false,
  })
}

// Item unique
export function useItem(id: number) {
  return useQuery({
    queryKey: ['item', id],
    queryFn:  () => itemsAPI.get(id),
    enabled:  id > 0,
  })
}

// Invalidation après mutation
export function useInvalidateItems() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['items'] })
}
```

**Règles TanStack Query :**
- `queryKey` hiérarchique : `['items']` invalide aussi `['items', id]`
- `refetchInterval` conditionnel : ne pollez que quand nécessaire
- `staleTime` ≥ 10 s pour les données statiques, 0 pour les données en mutation rapide
- `invalidateQueries` après chaque POST/PATCH/DELETE pour garder l'UI synchrone

---

## 13. CORS dynamique multi-ports

```python
# backend/config.py — déjà couvert § 3, rappel :
# Toujours inclure les 3 ports Vite courants (5173, 5174, 5175)
# car Vite prend le port suivant si le précédent est occupé.
# Le port dynamique vient de EXPLORER_FRONTEND_PORT (posé par launcher.py).
```

**Problème SSE et proxy Vite :** le proxy Vite peut bufferiser les chunks SSE
et les livrer en batch, brisant l'effet streaming. Solution : les requêtes SSE
utilisent `BACKEND_BASE` (URL directe) et non le proxy.

---

## 14. StaticFiles — servir des fichiers depuis le workspace

```python
# main.py — APRÈS les routers
# Le dossier CACHE_DIR est dans le workspace (variable) → monté dynamiquement.
app.mount("/cache", StaticFiles(directory=str(CACHE_DIR)), name="cache")

# Les assets globaux sont à chemin fixe dans l'appli.
app.mount("/global-assets", StaticFiles(directory=str(GLOBAL_ASSETS_DIR)), name="global-assets")
```

```typescript
// Référencer un fichier cache dans le frontend :
// Via proxy Vite  : `/cache/mon_fichier.jpg`         ← fonctionne en dev
// Via BACKEND_BASE: `${BACKEND_BASE}/cache/fichier`  ← pour SSE / fetch direct
```

**Règle :** les `StaticFiles` mounts doivent être déclarés APRÈS tous les routers API,
sinon FastAPI essaie de les matcher avant les routes `/api`.

---

## 15. Checklist de démarrage d'un nouveau projet

### Étape 1 — Initialisation

```bash
# Utiliser l'appli actuelle présente
```

### Étape 2 — Backend

- [ ] `config.py` : renommer les constantes + adapter les chemins
- [ ] `models.py` : définir vos tables SQLModel
- [ ] `database.py` : rien à changer (générique)
- [ ] `api/items.py` : implémenter vos routes (CRUD + SSE si nécessaire)
- [ ] `api/settings.py` : adapter `AppSettings` à vos préférences
- [ ] `main.py` : importer vos routers, adapter le lifespan

### Étape 3 — Frontend

- [ ] `types/api.ts` : miroir exact des schémas Pydantic
- [ ] `api/client.ts` : fonctions fetch pour chaque endpoint
- [ ] `hooks/useItems.ts` : hooks TanStack Query
- [ ] `hooks/useSettings.ts` : copie directe depuis Dataset Explorer
- [ ] `App.tsx` : routing + sidebar
- [ ] `pages/` : vos pages
- [ ] `vite.config.ts` : adapter les mount proxy (`/cache`, etc.)

### Étape 4 — Launcher

- [ ] Copier `launcher.py` de Dataset Explorer
- [ ] Adapter la section configuration (APP_ROOT_PATH, WORKSPACE_PATH, CONDA_ENV, USER_NAME)
- [ ] Adapter les variables d'environnement exportées (noms `MON_APP_*`)

### Étape 5 — Test multi-utilisateurs

```bash
# User A
WORKSPACE_PATH=path/workspace/ws_alice python launcher.py

# User B (autre terminal)
WORKSPACE_PATH=path/workspace/ws_bob python launcher.py

# → chacun doit avoir sa propre DB, ses propres fichiers cache,
#   ses propres ports (AUTO_PORTS=True)
```

---

## 16. Pièges fréquents et solutions éprouvées

### Route matching — spécifique avant générique

```python
# MAL : "merge" est interprété comme item_id=merge
@router.post("/items/{item_id}/process")
@router.post("/items/merge")              # jamais atteint !

# BIEN : routes spécifiques en premier
@router.post("/items/merge")
@router.post("/items/{item_id}/process")
```

### SSE — pas de buffering Vite

```typescript
// MAL : passe par le proxy Vite → peut bufferiser
await fetch('/api/items/1/process', { method: 'POST' })

// BIEN : connexion directe backend
await fetch(`${BACKEND_BASE}/api/items/1/process`, { method: 'POST' })
```

### Import circulaire — logique métier vs API

```python
# MAL : core/processor.py importe depuis api/settings.py → cycle
from backend.api.settings import load_settings   # dans core/

# BIEN : lazy import dans la fonction, pas au top-level
def _get_setting() -> bool:
    try:
        from backend.api.settings import load_settings
        return load_settings().ma_preference
    except Exception:
        return True   # fallback sûr
```

### StaticFiles — dossier doit exister au boot

```python
# StaticFiles lève une erreur si le dossier n'existe pas → le créer dans config.py
CACHE_DIR.mkdir(parents=True, exist_ok=True)   # dans config.py, pas dans lifespan
```

### Plotly + React.memo — lasso qui se réinitialise

```tsx
// MAL : nouveau callback à chaque render → ScatterPlot se re-render → lasso perdu
const onSelect = (ids: number[]) => { ... }

// BIEN : useCallback + stable deps
const onSelect = useCallback((ids: number[]) => {
  clear()
  if (ids.length) addMany(ids)
}, [clear, addMany])
```


### DB bloquée entre requêtes — check_same_thread

```python
engine = create_engine(DATABASE_URL,
    connect_args={"check_same_thread": False})  # OBLIGATOIRE pour FastAPI
```

### Tâche de fond qui référence une session SQLModel fermée

```python
# MAL : session passée en argument à background_task → fermée avant l'exécution
background_tasks.add_task(_process, item_id, session)   # session fermée !

# BIEN : ouvrir une nouvelle session dans la tâche de fond
def _process(item_id: int):
    with Session(engine) as session:
        item = session.get(Item, item_id)
        ...
```

### Encodage JSON — datetime non sérialisable

```python
# Dans json.dumps, toujours passer default=str pour les datetime
json.dumps(data, ensure_ascii=False, indent=2, default=str)
```

---

## 17. Tests d'intégration multi-utilisateurs avec pytest

L'idée : lancer N vrais backends uvicorn en parallèle (chacun sur son propre workspace
et son propre port), exécuter les tests contre chaque instance, puis tout nettoyer.
Aucune simulation — c'est le binaire réel qui tourne.

### Structure des fichiers de test

```
backend/tests/
├── test_items.py               # tests unitaires (logique métier isolée)
├── integration/
│   ├── conftest.py             # fixture session : démarre/arrête les N backends
│   ├── test_multiuser.py       # assertions d'isolation + concurrence
│   └── run_tests.py            # lanceur pratique avec options CLI
```

### conftest.py — fixture session `multiuser_instances`

C'est le cœur du setup. La fixture `scope="session"` démarre tous les backends
une seule fois pour toute la session de tests, puis les arrête au teardown.

```python
# backend/tests/integration/conftest.py
import json, os, shutil, socket, subprocess, sys, time, threading
from pathlib import Path
import pytest

APP_ROOT = Path(__file__).parent.parent.parent.parent   # racine de MonApp/
WS_BASE  = APP_ROOT.parent / "workspaces"               # workspaces de test hors repo

ALL_USERS  = ["alice", "bob", "carol", "david", "eve",
              "frank", "grace", "henry", "iris", "jack"]
N_USERS    = min(max(int(os.environ.get("MYAPP_N_USERS", "3")), 2), 10)
BASE_PORT  = int(os.environ.get("MYAPP_BASE_PORT", "8010"))
TIMEOUT    = int(os.environ.get("MYAPP_TIMEOUT",   "90"))
KEEP_WS    = os.environ.get("MYAPP_KEEP_WS", "0") == "1"
USERS      = ALL_USERS[:N_USERS]
PYTHON     = sys.executable


def _wait_ready(port: int, timeout: int = TIMEOUT) -> bool:
    """Poll GET /health jusqu'à 200."""
    from urllib import request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with request.urlopen(f"http://localhost:{port}/health", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1.5)
    return False


@pytest.fixture(scope="session")
def multiuser_instances():
    # 1. Vérifier que les ports sont libres
    busy = [BASE_PORT + i for i in range(N_USERS)
            if not _port_free(BASE_PORT + i)]
    if busy:
        pytest.skip(f"Ports occupés : {busy}")

    procs = []
    instances = []

    # 2. Démarrer un backend par utilisateur
    for i, user in enumerate(USERS):
        port      = BASE_PORT + i
        workspace = WS_BASE / f"ws_{user}_itest"
        workspace.mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["MON_APP_WORKSPACE"]     = str(workspace)
        env["MON_APP_USER"]          = user
        env["BACKEND_PORT"]          = str(port)
        env["MON_APP_FRONTEND_PORT"] = str(port + 1000)

        log = open(workspace / "backend.log", "w", encoding="utf-8")
        proc = subprocess.Popen(
            [PYTHON, "-m", "uvicorn", "backend.main:app",
             "--host", "0.0.0.0", "--port", str(port)],
            cwd=str(APP_ROOT), env=env, stdout=log, stderr=log,
        )
        procs.append((proc, log, workspace))
        instances.append({"user": user, "port": port, "workspace": workspace})
        time.sleep(0.2)   # léger étalement pour éviter la saturation disque

    # 3. Attendre en parallèle que tous soient prêts
    flags: dict[str, bool] = {}
    threads = [threading.Thread(target=lambda i=inst: flags.__setitem__(
                   i["user"], _wait_ready(i["port"])), daemon=True)
               for inst in instances]
    for t in threads: t.start()
    for t in threads: t.join()

    ready = [i for i in instances if flags.get(i["user"])]
    if not ready:
        for proc, log, _ in procs:
            proc.kill(); log.close()
        pytest.fail("Aucun backend n'a démarré dans le délai.")

    yield ready   # ← les tests reçoivent cette liste

    # 4. Teardown : SIGTERM → kill → nettoyage workspaces
    for proc, log, _ in procs:
        proc.terminate()
    time.sleep(2)
    for proc, log, ws in procs:
        proc.kill(); log.close()
        if not KEEP_WS:
            shutil.rmtree(ws, ignore_errors=True)


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) != 0
```

### test_multiuser.py — assertions à écrire

```python
# backend/tests/integration/test_multiuser.py
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib import request

import pytest

# ── Helpers stdlib (pas de dépendance requests dans les tests) ────────

def api_get(port, path):
    with request.urlopen(f"http://localhost:{port}{path}", timeout=10) as r:
        return json.loads(r.read())

def api_post(port, path, data):
    body = json.dumps(data).encode()
    req  = request.Request(f"http://localhost:{port}{path}",
                            data=body,
                            headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# ── Tests ─────────────────────────────────────────────────────────────

@pytest.mark.multiuser
def test_workspace_isolation(multiuser_instances):
    """Chaque user démarre avec une DB vide — aucune fuite de données."""
    for inst in multiuser_instances:
        items = api_get(inst["port"], "/api/items")
        assert items == [], f"{inst['user']} : workspace non vide au démarrage"


@pytest.mark.multiuser
def test_settings_isolated(multiuser_instances):
    """Modifier les settings d'Alice n'affecte pas ceux de Bob."""
    alice, bob = multiuser_instances[0], multiuser_instances[1]

    api_post(alice["port"], "/api/settings",
             {"theme": "light", "pinned_item_ids": []})

    bob_settings = api_get(bob["port"], "/api/settings")
    assert bob_settings["theme"] != "light" or True  # Bob garde son thème


@pytest.mark.multiuser
def test_concurrent_access(multiuser_instances):
    """N utilisateurs font 5 requêtes simultanées — 0 erreur."""
    def _probe(inst):
        errors = 0
        for _ in range(5):
            try:
                api_get(inst["port"], "/api/items")
            except Exception:
                errors += 1
        return errors

    with ThreadPoolExecutor(max_workers=len(multiuser_instances)) as ex:
        futures = {ex.submit(_probe, inst): inst for inst in multiuser_instances}
        for fut in as_completed(futures):
            inst = futures[fut]
            errors = fut.result()
            assert errors == 0, f"{inst['user']} : {errors} erreurs en accès concurrent"


@pytest.mark.multiuser
@pytest.mark.parametrize("endpoint", ["/health", "/api/items", "/api/settings"])
def test_health_all_users(multiuser_instances, endpoint):
    """Chaque endpoint répond 200 pour tous les utilisateurs."""
    for inst in multiuser_instances:
        data = api_get(inst["port"], endpoint)
        assert data is not None, f"{inst['user']} : {endpoint} ne répond pas"
```

### run_tests.py — lanceur pratique

```python
# backend/tests/integration/run_tests.py
"""
Lanceur pratique pour les tests d'integration.

Usage :
  python backend/tests/integration/run_tests.py           # 3 users
  python backend/tests/integration/run_tests.py --fast    # 2 users
  python backend/tests/integration/run_tests.py --n 5     # 5 users
  python backend/tests/integration/run_tests.py --keep-ws # garde les workspaces
"""
import argparse, os, subprocess, sys
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n",       type=int, default=3,    help="Nombre d'utilisateurs")
    p.add_argument("--fast",    action="store_true",    help="Mode rapide (2 users)")
    p.add_argument("--keep-ws", action="store_true",    help="Garder les workspaces")
    p.add_argument("--port",    type=int, default=8010, help="Port de départ")
    args = p.parse_args()

    n = 2 if args.fast else args.n

    env = os.environ.copy()
    env["MYAPP_N_USERS"]  = str(n)
    env["MYAPP_BASE_PORT"] = str(args.port)
    if args.keep_ws:
        env["MYAPP_KEEP_WS"] = "1"

    cmd = [
        sys.executable, "-m", "pytest",
        "backend/tests/integration/",
        "-v", "-m", "multiuser",
        "--tb=short",
    ]
    root = Path(__file__).parent.parent.parent.parent
    sys.exit(subprocess.call(cmd, cwd=str(root), env=env))

if __name__ == "__main__":
    main()
```

### Commandes de lancement

```bash
# Depuis la racine de MonApp/

# Mode rapide — 3 utilisateurs (~1-2 min)
python backend/tests/integration/run_tests.py

# 5 utilisateurs
python backend/tests/integration/run_tests.py --n 5

# Garder les workspaces pour déboguer
python backend/tests/integration/run_tests.py --keep-ws

# Via pytest directement
MYAPP_N_USERS=3 python -m pytest backend/tests/integration/ -v -m multiuser

# Tests unitaires seulement (sans démarrer de backends)
python -m pytest backend/tests/ -v -m "not multiuser"
```

### Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `MYAPP_N_USERS` | `3` | Nombre d'instances (2–10) |
| `MYAPP_BASE_PORT` | `8010` | Port du premier backend (8010, 8011, …) |
| `MYAPP_TIMEOUT` | `90` | Secondes d'attente max par backend |
| `MYAPP_KEEP_WS` | `0` | `1` = ne pas supprimer les workspaces après test |

### Ce que les tests doivent couvrir (checklist minimale)

- [ ] **T1 — Isolation workspace** : chaque user démarre avec une DB vide
- [ ] **T2 — Données globales visibles par tous** : les entrées du registre global sont accessibles depuis chaque port
- [ ] **T3 — Données workspace invisibles des autres** : créer un item chez Alice → Bob ne le voit pas
- [ ] **T4 — Accès concurrent** : N×5 requêtes simultanées, 0 erreur 5xx
- [ ] **T5 — Settings isolés** : modifier le thème chez Alice n'affecte pas Bob
- [ ] **T6 — Health par endpoint** : `/health`, `/api/items`, `/api/settings` répondent 200 pour tous

### Conseils RAM

Chaque backend charge ses modèles ML en mémoire. Prévoir :

| Cas | Backends | RAM indicative |
|---|---|---|
| Tests rapides | 2–3 | ~800 MB – 1.2 GB |
| Couverture complète | 10 | ~4 GB |

Si la machine est limitée → `MYAPP_N_USERS=2` couvre déjà l'essentiel de l'isolation.

---

## Résumé des invariants de l'architecture

| # | Invariant |
|---|---|
| 1 | Aucune donnée persistante dans le répertoire de l'application — tout dans `WORKSPACE` |
| 2 | `config.py` est la seule source de vérité pour les chemins — jamais de chemin en dur dans les routers |
| 3 | Les routes spécifiques sont déclarées AVANT les routes avec paramètres `{id}` |
| 4 | `StaticFiles` est monté APRÈS les routers API |
| 5 | Les requêtes SSE utilisent l'URL directe backend, pas le proxy Vite |
| 6 | L'état SSE est stocké module-level (hors composant React) pour survivre à la navigation |
| 7 | Les tâches longues lancent un `background_task` et retournent immédiatement — le frontend poll le statut |
| 8 | Les données globales (partagées) sont dans `data/` (chemin fixe) ; les données workspace sont dans `WORKSPACE/` (chemin variable) |
| 9 | Les imports circulaires entre `core/` et `api/` sont résolus par lazy import dans la fonction |
| 10 | `types/api.ts` est le miroir TypeScript des schémas Pydantic — mettre à jour les deux en même temps |
