# Tests d'intégration multiuser — Dataset Explorer

## Vue d'ensemble

Ce dossier contient les tests d'intégration qui valident la robustesse du
système multiuser de Dataset Explorer : isolation des workspaces, visibilité des
datasets globaux, accès concurrent, et cohérence des settings.

Les tests démarrent **N backends uvicorn réels** (un par utilisateur simulé),
les font communiquer via HTTP, puis les arrêtent proprement en teardown.

---

## Structure des fichiers

```
backend/tests/integration/
├── __init__.py           — package Python (vide, requis par pytest)
├── conftest.py           — fixtures pytest partagées (démarrage des backends)
├── test_multiuser.py     — 20 tests organisés en 6 classes
├── run_tests.py          — lanceur CLI pratique avec options
└── test.md               — ce fichier
```

---

## `conftest.py` — Fixtures session

### Rôle
Fournit les fixtures partagées par tous les tests. Déclarées avec
`scope="session"` : les backends ne démarrent **qu'une seule fois** pour
toute la session de tests.

### Fixture `multiuser_instances`

```python
@pytest.fixture(scope="session")
def multiuser_instances():
    # 1. Vérifie que les ports BASE_PORT … BASE_PORT+N-1 sont libres
    # 2. Crée les dossiers workspace pour chaque user
    # 3. Démarre N processus uvicorn en parallèle
    # 4. Attend en parallèle que chaque backend réponde sur GET /api/datasets
    # 5. yield la liste des instances {"user", "port", "workspace"}
    # --- teardown ---
    # 6. SIGTERM sur chaque process, puis SIGKILL si nécessaire
    # 7. Supprime les workspaces (sauf si MULTIUSER_KEEP_WS=1)
```

**Variables d'environnement injectées à chaque backend :**

| Variable | Valeur |
|---|---|
| `EXPLORER_WORKSPACE` | `workspaces/workspace_{user}_itest` |
| `EXPLORER_USER` | nom du user |
| `BACKEND_PORT` | port alloué |
| `EXPLORER_FRONTEND_PORT` | `port + 1000` (fictif, pas de frontend en test) |

### Fixture `dataset_dir`

Retourne le `Path` du dossier d'images de test. Skip automatiquement les
tests qui en dépendent si le dossier n'existe pas.

---

## `test_multiuser.py` — Tests

### Classes et tests

| Classe | Marker | Tests | Durée estimée |
|---|---|---|---|
| `TestWorkspaceIsolation` | `multiuser integration` | 2 | rapide |
| `TestGlobalDataset` | `multiuser integration slow` | 4 | ~2 min (scan 605 imgs) |
| `TestWorkspaceDatasetIsolation` | `multiuser integration slow` | 2 | ~2 min (scan) |
| `TestConcurrentAccess` | `multiuser integration` | 6 | rapide |
| `TestSettingsIsolation` | `multiuser integration` | 2 | rapide |
| `TestApiHealth` | `multiuser integration` | 4 | rapide |

### Détail des tests

**T1 — `TestWorkspaceIsolation`**
- `test_workspaces_start_empty` : chaque workspace neuf ne contient aucun
  dataset local (`in_workspace=True`)
- `test_each_backend_responds` : chaque backend répond sur son port dédié

**T2 — `TestGlobalDataset`**

Utilise une fixture `global_dataset_info` (`scope="class"`) qui :
1. Crée un dataset avec `share_dataset=True` via le premier user (alice)
2. Attend la fin du scan (poll toutes les 2s, max 120s)
3. Nettoie en teardown (`DELETE /api/datasets/global`)

Tests :
- `test_owner_sees_dataset_in_workspace` : alice voit son dataset en workspace
- `test_all_others_see_global_dataset` : les 9 autres le voient en galerie globale
- `test_global_dataset_not_in_others_workspace` : pas de fuite dans les workspaces étrangers
- `test_global_dataset_image_count_consistent` : même `image_count` partout

**T3 — `TestWorkspaceDatasetIsolation`**

Fixture `bob_dataset_info` crée un dataset avec `share_dataset=False` via bob.

- `test_owner_sees_own_dataset` : bob voit son dataset
- `test_others_cannot_see_workspace_dataset` : les 9 autres ne le voient pas

**T4 — `TestConcurrentAccess`**

- `test_concurrent_api_round[1-5]` : 5 rounds paramétrés, chaque round =
  10 requêtes `GET /api/datasets` simultanées (ThreadPoolExecutor)
- `test_concurrent_settings_read` : même chose sur `GET /api/settings`

**T5 — `TestSettingsIsolation`**

- `test_settings_do_not_bleed_between_workspaces` : modifier
  `playground_dataset_ids` d'alice n'affecte pas bob
- `test_settings_write_per_workspace` : tous les users écrivent leurs settings
  simultanément sans erreur

**T6 — `TestApiHealth`**

- `test_endpoints_respond_for_all_users[endpoint]` : paramétrisé sur
  `/api/datasets`, `/api/subsets`, `/api/settings`
- `test_each_backend_has_independent_db` : les workspaces path retournés sont
  tous distincts

---

## `run_tests.py` — Lanceur CLI

### Rôle
Wrapper autour de `pytest` qui configure les variables d'environnement et
assemble la commande avec les bonnes options.

### Construction de la commande pytest

```python
cmd = [
    PYTHON, "-m", "pytest",
    str(THIS_DIR),    # cible : uniquement ce dossier d'intégration
    "-v",             # verbose : un test = une ligne de résultat
    "--tb=short",     # traceback court en cas d'échec (pas de full stack)
    "-m", "multiuser",# ne lance que les tests marqués @pytest.mark.multiuser
    "--no-header",    # supprime le bandeau pytest (chemin Python, version...)
]
```

**Pourquoi `-m multiuser` ?**
Le marker `multiuser` filtre uniquement les tests d'intégration multiuser.
Sans ce filtre, si d'autres tests sont ajoutés dans le dossier `integration/`
sans ce marker, ils ne seraient pas lancés ici — séparation intentionnelle.

**Pourquoi `str(THIS_DIR)` et pas `.` ?**
Permet d'appeler le script depuis n'importe quel répertoire courant.

### Options CLI

| Option | Effet |
|---|---|
| `--fast` | `MULTIUSER_N_USERS=3` — 3 users au lieu de 10, ~2× plus rapide |
| `--keep-ws` | `MULTIUSER_KEEP_WS=1` — workspaces conservés après test (debug) |
| `--dataset "chemin"` | Surcharge `TEST_DATASET_DIR` |

### Variables d'environnement reconnues

| Variable | Défaut | Description |
|---|---|---|
| `TEST_DATASET_DIR` | `…\Annotation_App\data_test\test dev` | Dossier d'images |
| `MULTIUSER_N_USERS` | `10` | Nombre d'utilisateurs simultanés (2–10) |
| `MULTIUSER_BASE_PORT` | `8010` | Premier port backend (8010…8019) |
| `MULTIUSER_TIMEOUT` | `90` | Délai max d'attente par backend (secondes) |
| `MULTIUSER_KEEP_WS` | `0` | `1` = conserver les workspaces après teardown |

---

## Comment lancer

```bash
# Depuis Dataset_Explorer_App/

# Rapide — 3 users (~2 min)
python backend/tests/integration/run_tests.py --fast

# Complet — 10 users (~4-5 min)
python backend/tests/integration/run_tests.py

# Debug — garder les workspaces
python backend/tests/integration/run_tests.py --fast --keep-ws

# Via pytest directement (équivalent)
python -m pytest backend/tests/integration/ -v -m multiuser

# Avec variables d'environnement
MULTIUSER_N_USERS=5 MULTIUSER_TIMEOUT=120 python -m pytest backend/tests/integration/ -v -m multiuser
```

---

## Notes techniques

### Pourquoi uvicorn sans `--reload` ?
Le mode `--reload` de uvicorn utilise `watchfiles` qui surveille le système de
fichiers. Avec 10 instances en parallèle sur le même répertoire source, cela
génère des conflits et ralentit le démarrage. Les tests désactivent `--reload`.

### Pourquoi pas `requests` ?
La stdlib `urllib` suffit et évite une dépendance externe dans les tests.
Chaque helper (`api_get`, `api_post`, `api_put`, `api_delete`) retourne `None`
en cas d'erreur réseau — jamais d'exception non capturée.

### Isolation des workspaces
Chaque backend reçoit `EXPLORER_WORKSPACE=workspaces/workspace_{user}_itest`.
La DB SQLite (`dataset_explorer.db`) est dans ce dossier. Aucun partage de DB entre
instances — isolation garantie par le système de fichiers.

### Dataset global (T2)
Le registre global (`data/dataset_gallery/registry.json`) est partagé par
toutes les instances — c'est précisément ce qu'on teste : un dataset créé
par alice dans *son* workspace doit apparaître dans la liste d'autres users
via ce fichier JSON commun.
