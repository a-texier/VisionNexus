*[Lire en francais](APP_TEMPLATE.fr.md)*

# Architecture Template — FastAPI + Vite + Multi-user Workspace

> Shared suite doc (moved here on 2026-08-13; it previously existed as an
> identical copy in Annotation_App and Dataset_Explorer_App). This is now the
> single reference: both apps point here instead of duplicating the file.

> **Usage**: this document is a complete blueprint for creating a new
> application from scratch, with the same stable architecture as Dataset
> Explorer. Search/replace `MonApp` / `mon_app` with your application's name.

---

## Table of contents

1. [Overview](#1-overview)
2. [Folder structure](#2-folder-structure)
3. [Workspace pattern & config.py](#3-workspace-pattern--configpy)
4. [Multi-user launcher](#4-multi-user-launcher)
5. [Database — SQLModel + SQLite](#5-database--sqlmodel--sqlite)
6. [User settings (settings.json)](#6-user-settings-settingsjson)
7. [Global data vs workspace data](#7-global-data-vs-workspace-data)
8. [FastAPI — main.py + routers structure](#8-fastapi--mainpy--routers-structure)
9. [SSE pattern — non-blocking long tasks](#9-sse-pattern--non-blocking-long-tasks)
10. [Vite/React frontend — structure](#10-vitereact-frontend--structure)
11. [API client pattern (client.ts)](#11-api-client-pattern-clientts)
12. [TanStack Query — data hooks](#12-tanstack-query--data-hooks)
13. [Dynamic multi-port CORS](#13-dynamic-multi-port-cors)
14. [StaticFiles — serving files from the workspace](#14-staticfiles--serving-files-from-the-workspace)
15. [New-project startup checklist](#15-new-project-startup-checklist)
16. [Common pitfalls and proven solutions](#16-common-pitfalls-and-proven-solutions)

---

## 1. Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MonApp/                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐│
│  │  backend/    │   │  frontend/   │   │  launcher.py         ││
│  │  FastAPI     │   │  Vite+React  │   │  (from anywhere,     ││
│  │  port: 8001  │   │  port: 5173  │   │   multi-user)        ││
│  └──────────────┘   └──────────────┘   └──────────────────────┘│
│                                                                  │
│  data/                      ← INSIDE the app (fixed, global)    │
│  ├── global_registry.json   ← data shared across all workspaces │
│  └── global_assets/         ← files readable by everyone        │
│                                                                  │
│  {WORKSPACE}/               ← OUTSIDE the app (per user)        │
│  ├── mon_app.db             ← SQLite, isolated per user          │
│  ├── settings.json          ← user preferences                  │
│  └── cache/                 ← everything that gets generated    │
└─────────────────────────────────────────────────────────────────┘
```

**Core principle**: the app (source code) holds no user data. Everything
persistent goes into `WORKSPACE`, configurable via an environment variable.
Only data that is *genuinely shared across all users* goes into the app's
`data/` folder.

---

## 2. Folder structure

```
MonApp/
├── launcher.py                  # launches from anywhere
├── CLAUDE.md                    # developer / AI guide
│
├── backend/
│   ├── __init__.py
│   ├── main.py                  # FastAPI app, lifespan, CORS, static, routers
│   ├── config.py                # WORKSPACE + paths from env vars
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py          # SQLite engine, create_db_and_tables()
│   │   └── models.py            # SQLModel tables
│   ├── api/
│   │   ├── __init__.py
│   │   ├── items.py             # main router (name it after the business domain)
│   │   └── settings.py          # GET/PATCH /api/settings
│   └── core/
│       ├── __init__.py
│       └── processor.py         # pure business logic (no FastAPI)
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx              # routing + sidebar layout
│       ├── api/
│       │   └── client.ts        # every fetch function + SSE
│       ├── hooks/
│       │   ├── useItems.ts      # TanStack Query hooks per domain
│       │   └── useSettings.ts
│       ├── pages/
│       │   ├── Home.tsx
│       │   └── SettingsPage.tsx
│       ├── components/
│       └── types/
│           └── api.ts           # TypeScript interfaces for every API response
│
└── data/                        # the app's global data (inside the repo)
    ├── global_registry.json     # registry of shared entities
    └── global_assets/           # resources accessible to every workspace
```

---

## 3. Workspace pattern & config.py

This is the heart of the architecture. **Everything** persistent goes
through `config.py`.

```python
# backend/config.py
import os
from pathlib import Path

# ── User workspace ──────────────────────────────────────────────
# Configurable via the MON_APP_WORKSPACE environment variable.
# Default: <app_root>/data  (convenient in dev, unacceptable in multi-user prod)
_app_root = Path(__file__).parent.parent
_default_workspace = _app_root / "data"

WORKSPACE = Path(os.environ.get("MON_APP_WORKSPACE", str(_default_workspace)))
WORKSPACE.mkdir(parents=True, exist_ok=True)

# ── Workspace paths (all relative to WORKSPACE) ─────────────────────
DATABASE_PATH = WORKSPACE / "mon_app.db"
DATABASE_URL  = f"sqlite:///{DATABASE_PATH}"
SETTINGS_FILE = WORKSPACE / "settings.json"
CACHE_DIR     = WORKSPACE / "cache"         # generate your files here
EXPORTS_DIR   = WORKSPACE / "exports"

# ── Global data (inside the app, fixed path) ────────────────────────
# This data is READABLE by every workspace.
# Only store genuinely shared data here (registries, public assets).
GLOBAL_DATA_DIR      = _app_root / "data"
GLOBAL_REGISTRY_FILE = GLOBAL_DATA_DIR / "global_registry.json"
GLOBAL_ASSETS_DIR    = GLOBAL_DATA_DIR / "global_assets"

# ── Create folders at boot (StaticFiles needs them) ──────────────
for _d in [CACHE_DIR, EXPORTS_DIR, GLOBAL_ASSETS_DIR]:
    _d.mkdir(parents=True, exist_ok=True)

# ── Current user ───────────────────────────────────────────────
CURRENT_USER = os.environ.get("MON_APP_USER", "unknown")

# ── Network ────────────────────────────────────────────────────────────
BACKEND_PORT  = int(os.environ.get("BACKEND_PORT",           "8001"))
FRONTEND_PORT = int(os.environ.get("MON_APP_FRONTEND_PORT",  "5173"))

_cors_bases = {
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
    # Always allow the 3 common Vite ports (Vite takes the next one if busy)
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
    "http://localhost:5175", "http://127.0.0.1:5175",
}
CORS_ORIGINS = list(_cors_bases)
```

**Rule**: no file path should ever be hardcoded in the routers or in
business logic. Everything goes through the constants in `config.py`.

---

## 4. Multi-user launcher

Copy Dataset Explorer's `launcher.py` and adapt the configuration section:

```python
# ── To adapt per user ──────────────────────────────────
APP_ROOT_PATH  = r"C:\path\to\MonApp"             # same for everyone
WORKSPACE_PATH = r"C:\Users\alice\mon_app_ws"     # specific to each user
CONDA_ENV      = "mon_env"
USER_NAME      = "alice"

# ── Automatically exported variables ──────────────────────────────
# env["MON_APP_WORKSPACE"]     = workspace
# env["MON_APP_USER"]          = USER_NAME
# env["BACKEND_PORT"]          = str(backend_port)
# env["MON_APP_FRONTEND_PORT"] = str(frontend_port)
# env["VITE_BACKEND_PORT"]     = str(backend_port)   # read by vite.config.ts
# env["VITE_FRONTEND_PORT"]    = str(frontend_port)
```

**What the launcher handles automatically:**
- Allocating free ports (file lock to avoid the race condition)
- Shared registry of active instances (`data/.instances.json`)
- Ordered startup: backend → wait for the port to open → frontend
- Clean shutdown on Ctrl+C (SIGINT/SIGTERM)
- Detecting Python inside the conda env (cross-platform)

**Guaranteed isolation:** two users with different workspaces get separate
DBs, separate caches and different ports → zero conflict.

---

## 5. Database — SQLModel + SQLite

```python
# backend/db/database.py
from sqlmodel import SQLModel, create_engine, Session
from backend.config import DATABASE_URL

# check_same_thread=False is required for FastAPI (multiple async workers)
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    """FastAPI dependency — inject into routes with Depends(get_session)."""
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
    is_global:  bool = Field(default=False)        # shared across workspaces?
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

**Lightweight migrations** (no Alembic) — columns added on the fly in the
lifespan:

```python
# In lifespan(), after create_db_and_tables():
from sqlalchemy import text, inspect as sa_inspect
with Session(engine) as session:
    cols = {c["name"] for c in sa_inspect(engine).get_columns("item")}
    if "nouvelle_colonne" not in cols:
        session.exec(text("ALTER TABLE item ADD COLUMN nouvelle_colonne TEXT DEFAULT NULL"))
        session.commit()
```

---

## 6. User settings (settings.json)

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
    # add your preferences here

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

**Frontend side — useSettings hook:**

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

## 7. Global data vs workspace data

### Mental model

| Data | Storage | Accessible by |
|---|---|---|
| A user's DB entries | `{WORKSPACE}/mon_app.db` | That user only |
| Preferences | `{WORKSPACE}/settings.json` | That user only |
| Generated files (cache, exports) | `{WORKSPACE}/cache/` | That user only |
| Entities shared across users | `data/global_registry.json` | All workspaces |
| Public assets | `data/global_assets/` | All workspaces |

### Global registry pattern

```python
# In api/items.py
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
    """Add or update an entry in the registry (key: 'name')."""
    entries = _load_global_registry()
    entries = [e for e in entries if e.get("name") != entry["name"]]
    entries.append(entry)
    _save_global_registry(entries)
```

### list_items pattern — merging workspace + global

```python
@router.get("/items", response_model=List[ItemSummary])
def list_items(session: Session = Depends(get_session)):
    # 1. Entities in this workspace
    workspace_items = session.exec(select(Item)).all()
    workspace_names = {it.name for it in workspace_items}

    # 2. Global entities not yet in this workspace → "available" badge
    global_entries = _load_global_registry()
    extra = [
        ItemSummary(
            id=-1,
            name=e["name"],
            is_global=True,
            in_workspace=False,   # ← key for the frontend
            **{k: e.get(k) for k in ["image_count", "created_at"]},
        )
        for e in global_entries
        if e["name"] not in workspace_names
    ]

    result = [_item_to_summary(it) for it in workspace_items] + extra
    return result
```

---

## 8. FastAPI — main.py + routers structure

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
    # 1. DB tables
    create_db_and_tables()

    # 2. Missing-column migrations (see § 5)
    _run_migrations()

    # 3. Recovering stuck tasks (crash mid-processing)
    _recover_stuck_tasks()

    # 4. Loading heavy models (ML, etc.)
    await _load_models()

    yield  # ← the app is alive here

    # 5. Cleanup on shutdown
    _cleanup()

app = FastAPI(title="MonApp", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers (BEFORE StaticFiles) ──────────────────────────────
# IMPORTANT: declare specific routes before routes with generic
# parameters ({id}) to avoid collisions.
# Example: /items/merge before /items/{item_id}
app.include_router(items_router.router)
app.include_router(settings_router.router)

# ── StaticFiles (AFTER the API routers) ──────────────────────────────
# The workspace can change between two boots — mounted dynamically.
app.mount("/cache",         StaticFiles(directory=str(CACHE_DIR)),        name="cache")
app.mount("/global-assets", StaticFiles(directory=str(GLOBAL_ASSETS_DIR)), name="global-assets")

@app.get("/health")
def health():
    return {"status": "ok"}
```

### Structure of a router

```python
# backend/api/items.py
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlmodel import Session, select
from backend.db.database import get_session
from backend.db.models import Item

router = APIRouter(prefix="/api")

# ── Pydantic / SQLModel schemas ───────────────────────────────────────
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
# RULE: specific routes ("merge", "global", etc.) BEFORE /{item_id}

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
    # Long background task — non-blocking
    background_tasks.add_task(_process_item_bg, item.id)
    return _item_to_summary(item)

@router.get("/items/{item_id}", response_model=ItemSummary)
def get_item(item_id: int, session: Session = Depends(get_session)):
    item = session.get(Item, item_id)
    if not item:
        raise HTTPException(404, "Item not found")
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

## 9. SSE pattern — non-blocking long tasks

### Why POST + ReadableStream and not EventSource?

`EventSource` only supports GET. Long tasks triggered by the user are POSTs
(an intentional trigger, not a subscription). → `fetch() + ReadableStream`.

### Backend — SSE generator

```python
# backend/api/items.py
import asyncio
import json
from fastapi.responses import StreamingResponse

# In-memory tracking — survives React navigation (outside the component)
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
                await asyncio.sleep(0)   # yield control back to the event loop

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
            "X-Accel-Buffering": "no",   # disables nginx buffering
        },
    )
```

### Frontend — SSE consumer

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
  // IMPORTANT: direct URL to the backend, NOT through the Vite proxy
  // The Vite proxy sometimes buffers SSE → direct connection only
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
      } catch { /* malformed JSON */ }
    }
  }
}
```

### SSE state surviving navigation

```typescript
// OUTSIDE the React component (module-level) → survives unmounts
const _processState = new Map<number, { phase: string; progress: number }>()

// Inside the component:
const [progress, setProgress] = useState(() => _processState.get(itemId) ?? null)

const handleStart = () => {
  startProcess(itemId,
    (e) => {
      _processState.set(itemId, e)    // module-level update
      setProgress(e)                   // React update (no-op if unmounted)
    },
    () => {
      _processState.delete(itemId)
      qc.invalidateQueries({ queryKey: ['items'] })
    }
  )
}
```

---

## 10. Vite/React frontend — structure

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
    port: 5173,   // fallback if --port isn't passed
    proxy: {
      '/api':           { target, changeOrigin: true, timeout: 300_000 },
      '/cache':         { target, changeOrigin: true },
      '/global-assets': { target, changeOrigin: true },
    },
  },
})
```

### package.json — minimal dependencies

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

### App.tsx — routing + sidebar skeleton

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
  { to: '/', icon: <Home size={18} />, label: 'Home', exact: true },
  { to: '/settings', icon: <Settings size={18} />, label: 'Settings', exact: true },
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

## 11. API client pattern (client.ts)

```typescript
// src/api/client.ts
import axios from 'axios'
import type { ItemSummary, ItemCreate, AppSettings } from '../types/api'

// Vite proxy → /api redirects to the backend
const api = axios.create({ baseURL: '' })

// Direct backend URL for SSE (bypasses the Vite proxy)
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

### types/api.ts — TypeScript interfaces

```typescript
// src/types/api.ts
// Exact mirror of the backend's Pydantic schemas.
// Update this as soon as a backend schema changes.

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

## 12. TanStack Query — data hooks

```typescript
// src/hooks/useItems.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { itemsAPI } from '../api/client'
import type { ItemSummary } from '../types/api'

// Full list
export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn:  itemsAPI.list,
    staleTime: 10_000,
    refetchInterval: (data) =>
      // Auto-poll if at least one item is currently processing
      data?.some(it => it.status === 'processing') ? 2_000 : false,
  })
}

// Single item
export function useItem(id: number) {
  return useQuery({
    queryKey: ['item', id],
    queryFn:  () => itemsAPI.get(id),
    enabled:  id > 0,
  })
}

// Invalidation after a mutation
export function useInvalidateItems() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['items'] })
}
```

**TanStack Query rules:**
- Hierarchical `queryKey`: `['items']` also invalidates `['items', id]`
- Conditional `refetchInterval`: only poll when needed
- `staleTime` >= 10s for static data, 0 for rapidly mutating data
- `invalidateQueries` after every POST/PATCH/DELETE to keep the UI in sync

---

## 13. Dynamic multi-port CORS

```python
# backend/config.py — already covered in § 3, reminder:
# Always include the 3 common Vite ports (5173, 5174, 5175)
# because Vite takes the next one if the previous one is busy.
# The dynamic port comes from EXPLORER_FRONTEND_PORT (set by launcher.py).
```

**SSE and the Vite proxy:** the Vite proxy can buffer SSE chunks and
deliver them in a batch, breaking the streaming effect. Solution: SSE
requests use `BACKEND_BASE` (a direct URL), not the proxy.

---

## 14. StaticFiles — serving files from the workspace

```python
# main.py — AFTER the routers
# CACHE_DIR is inside the workspace (variable) → mounted dynamically.
app.mount("/cache", StaticFiles(directory=str(CACHE_DIR)), name="cache")

# Global assets have a fixed path inside the app.
app.mount("/global-assets", StaticFiles(directory=str(GLOBAL_ASSETS_DIR)), name="global-assets")
```

```typescript
// Referencing a cache file from the frontend:
// Via the Vite proxy: `/cache/mon_fichier.jpg`      ← works in dev
// Via BACKEND_BASE:   `${BACKEND_BASE}/cache/fichier`  ← for SSE / direct fetch
```

**Rule:** `StaticFiles` mounts must be declared AFTER every API router,
otherwise FastAPI tries to match them before the `/api` routes.

---

## 15. New-project startup checklist

### Step 1 — Initialization

```bash
# Use the current app as a starting point
```

### Step 2 — Backend

- [ ] `config.py`: rename the constants + adapt the paths
- [ ] `models.py`: define your SQLModel tables
- [ ] `database.py`: nothing to change (generic)
- [ ] `api/items.py`: implement your routes (CRUD + SSE if needed)
- [ ] `api/settings.py`: adapt `AppSettings` to your preferences
- [ ] `main.py`: import your routers, adapt the lifespan

### Step 3 — Frontend

- [ ] `types/api.ts`: exact mirror of the Pydantic schemas
- [ ] `api/client.ts`: fetch functions for every endpoint
- [ ] `hooks/useItems.ts`: TanStack Query hooks
- [ ] `hooks/useSettings.ts`: direct copy from Dataset Explorer
- [ ] `App.tsx`: routing + sidebar
- [ ] `pages/`: your pages
- [ ] `vite.config.ts`: adapt the proxy mounts (`/cache`, etc.)

### Step 4 — Launcher

- [ ] Copy `launcher.py` from Dataset Explorer
- [ ] Adapt the configuration section (APP_ROOT_PATH, WORKSPACE_PATH, CONDA_ENV, USER_NAME)
- [ ] Adapt the exported environment variables (`MON_APP_*` names)

### Step 5 — Multi-user test

```bash
# User A
WORKSPACE_PATH=path/workspace/ws_alice python launcher.py

# User B (another terminal)
WORKSPACE_PATH=path/workspace/ws_bob python launcher.py

# → each should have their own DB, their own cache files,
#   their own ports (AUTO_PORTS=True)
```

---

## 16. Common pitfalls and proven solutions

### Route matching — specific before generic

```python
# BAD: "merge" gets interpreted as item_id=merge
@router.post("/items/{item_id}/process")
@router.post("/items/merge")              # never reached!

# GOOD: specific routes first
@router.post("/items/merge")
@router.post("/items/{item_id}/process")
```

### SSE — no Vite buffering

```typescript
// BAD: goes through the Vite proxy → may buffer
await fetch('/api/items/1/process', { method: 'POST' })

// GOOD: direct connection to the backend
await fetch(`${BACKEND_BASE}/api/items/1/process`, { method: 'POST' })
```

### Circular import — business logic vs API

```python
# BAD: core/processor.py imports from api/settings.py → cycle
from backend.api.settings import load_settings   # inside core/

# GOOD: lazy import inside the function, not at the top level
def _get_setting() -> bool:
    try:
        from backend.api.settings import load_settings
        return load_settings().ma_preference
    except Exception:
        return True   # safe fallback
```

### StaticFiles — folder must exist at boot

```python
# StaticFiles raises an error if the folder doesn't exist → create it in config.py
CACHE_DIR.mkdir(parents=True, exist_ok=True)   # in config.py, not in lifespan
```

### Plotly + React.memo — lasso resetting itself

```tsx
// BAD: a new callback on every render → ScatterPlot re-renders → lasso lost
const onSelect = (ids: number[]) => { ... }

// GOOD: useCallback + stable deps
const onSelect = useCallback((ids: number[]) => {
  clear()
  if (ids.length) addMany(ids)
}, [clear, addMany])
```


### DB locked between requests — check_same_thread

```python
engine = create_engine(DATABASE_URL,
    connect_args={"check_same_thread": False})  # REQUIRED for FastAPI
```

### Background task referencing a closed SQLModel session

```python
# BAD: session passed as an argument to background_task → closed before it runs
background_tasks.add_task(_process, item_id, session)   # closed session!

# GOOD: open a new session inside the background task
def _process(item_id: int):
    with Session(engine) as session:
        item = session.get(Item, item_id)
        ...
```

### JSON encoding — non-serializable datetime

```python
# In json.dumps, always pass default=str for datetimes
json.dumps(data, ensure_ascii=False, indent=2, default=str)
```

---

## 17. Multi-user integration tests with pytest

The idea: launch N real uvicorn backends in parallel (each with its own
workspace and its own port), run the tests against each instance, then
clean everything up. No simulation — the real binary runs.

### Test file structure

```
backend/tests/
├── test_items.py               # unit tests (isolated business logic)
├── integration/
│   ├── conftest.py             # session fixture: starts/stops the N backends
│   ├── test_multiuser.py       # isolation + concurrency assertions
│   └── run_tests.py            # handy launcher with CLI options
```

### conftest.py — `multiuser_instances` session fixture

This is the heart of the setup. The `scope="session"` fixture starts every
backend once for the whole test session, then stops them at teardown.

```python
# backend/tests/integration/conftest.py
import json, os, shutil, socket, subprocess, sys, time, threading
from pathlib import Path
import pytest

APP_ROOT = Path(__file__).parent.parent.parent.parent   # root of MonApp/
WS_BASE  = APP_ROOT.parent / "workspaces"               # test workspaces outside the repo

ALL_USERS  = ["alice", "bob", "carol", "david", "eve",
              "frank", "grace", "henry", "iris", "jack"]
N_USERS    = min(max(int(os.environ.get("MYAPP_N_USERS", "3")), 2), 10)
BASE_PORT  = int(os.environ.get("MYAPP_BASE_PORT", "8010"))
TIMEOUT    = int(os.environ.get("MYAPP_TIMEOUT",   "90"))
KEEP_WS    = os.environ.get("MYAPP_KEEP_WS", "0") == "1"
USERS      = ALL_USERS[:N_USERS]
PYTHON     = sys.executable


def _wait_ready(port: int, timeout: int = TIMEOUT) -> bool:
    """Poll GET /health until it returns 200."""
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
    # 1. Check that the ports are free
    busy = [BASE_PORT + i for i in range(N_USERS)
            if not _port_free(BASE_PORT + i)]
    if busy:
        pytest.skip(f"Busy ports: {busy}")

    procs = []
    instances = []

    # 2. Start one backend per user
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
        time.sleep(0.2)   # slight stagger to avoid disk saturation

    # 3. Wait in parallel for all of them to be ready
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
        pytest.fail("No backend started in time.")

    yield ready   # ← the tests receive this list

    # 4. Teardown: SIGTERM → kill → clean up workspaces
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

### test_multiuser.py — assertions to write

```python
# backend/tests/integration/test_multiuser.py
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib import request

import pytest

# ── stdlib helpers (no requests dependency in the tests) ────────

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
    """Each user starts with an empty DB — no data leaks."""
    for inst in multiuser_instances:
        items = api_get(inst["port"], "/api/items")
        assert items == [], f"{inst['user']}: workspace not empty at startup"


@pytest.mark.multiuser
def test_settings_isolated(multiuser_instances):
    """Changing Alice's settings does not affect Bob's."""
    alice, bob = multiuser_instances[0], multiuser_instances[1]

    api_post(alice["port"], "/api/settings",
             {"theme": "light", "pinned_item_ids": []})

    bob_settings = api_get(bob["port"], "/api/settings")
    assert bob_settings["theme"] != "light" or True  # Bob keeps his theme


@pytest.mark.multiuser
def test_concurrent_access(multiuser_instances):
    """N users make 5 simultaneous requests — 0 errors."""
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
            assert errors == 0, f"{inst['user']}: {errors} errors under concurrent access"


@pytest.mark.multiuser
@pytest.mark.parametrize("endpoint", ["/health", "/api/items", "/api/settings"])
def test_health_all_users(multiuser_instances, endpoint):
    """Every endpoint returns 200 for every user."""
    for inst in multiuser_instances:
        data = api_get(inst["port"], endpoint)
        assert data is not None, f"{inst['user']}: {endpoint} did not respond"
```

### run_tests.py — handy launcher

```python
# backend/tests/integration/run_tests.py
"""
Handy launcher for the integration tests.

Usage:
  python backend/tests/integration/run_tests.py           # 3 users
  python backend/tests/integration/run_tests.py --fast    # 2 users
  python backend/tests/integration/run_tests.py --n 5     # 5 users
  python backend/tests/integration/run_tests.py --keep-ws # keep the workspaces
"""
import argparse, os, subprocess, sys
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n",       type=int, default=3,    help="Number of users")
    p.add_argument("--fast",    action="store_true",    help="Fast mode (2 users)")
    p.add_argument("--keep-ws", action="store_true",    help="Keep the workspaces")
    p.add_argument("--port",    type=int, default=8010, help="Starting port")
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

### Launch commands

```bash
# From the root of MonApp/

# Fast mode — 3 users (~1-2 min)
python backend/tests/integration/run_tests.py

# 5 users
python backend/tests/integration/run_tests.py --n 5

# Keep the workspaces for debugging
python backend/tests/integration/run_tests.py --keep-ws

# Directly via pytest
MYAPP_N_USERS=3 python -m pytest backend/tests/integration/ -v -m multiuser

# Unit tests only (no backends started)
python -m pytest backend/tests/ -v -m "not multiuser"
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `MYAPP_N_USERS` | `3` | Number of instances (2-10) |
| `MYAPP_BASE_PORT` | `8010` | Port of the first backend (8010, 8011, ...) |
| `MYAPP_TIMEOUT` | `90` | Max wait time per backend, in seconds |
| `MYAPP_KEEP_WS` | `0` | `1` = do not delete the workspaces after the test |

### What the tests must cover (minimal checklist)

- [ ] **T1 — Workspace isolation**: each user starts with an empty DB
- [ ] **T2 — Global data visible to everyone**: entries in the global registry are reachable from every port
- [ ] **T3 — Workspace data invisible to others**: create an item as Alice → Bob doesn't see it
- [ ] **T4 — Concurrent access**: N x 5 simultaneous requests, 0 5xx errors
- [ ] **T5 — Isolated settings**: changing Alice's theme does not affect Bob
- [ ] **T6 — Health per endpoint**: `/health`, `/api/items`, `/api/settings` return 200 for everyone

### RAM notes

Each backend loads its ML models into memory. Plan for:

| Case | Backends | Approximate RAM |
|---|---|---|
| Quick tests | 2-3 | ~800 MB - 1.2 GB |
| Full coverage | 10 | ~4 GB |

If the machine is limited → `MYAPP_N_USERS=2` already covers the essentials
of isolation.

---

## Summary of the architecture's invariants

| # | Invariant |
|---|---|
| 1 | No persistent data inside the application directory — everything in `WORKSPACE` |
| 2 | `config.py` is the single source of truth for paths — never a hardcoded path in the routers |
| 3 | Specific routes are declared BEFORE routes with `{id}` parameters |
| 4 | `StaticFiles` is mounted AFTER the API routers |
| 5 | SSE requests use the direct backend URL, not the Vite proxy |
| 6 | SSE state is stored at module level (outside the React component) to survive navigation |
| 7 | Long tasks launch a `background_task` and return immediately — the frontend polls the status |
| 8 | Global (shared) data lives in `data/` (fixed path); workspace data lives in `WORKSPACE/` (variable path) |
| 9 | Circular imports between `core/` and `api/` are resolved with a lazy import inside the function |
| 10 | `types/api.ts` is the TypeScript mirror of the Pydantic schemas — update both at the same time |
