# Tests d'intégration multiuser — Annotation App

## Vue d'ensemble

Ce dossier valide la robustesse du système multiuser de l'Annotation App :
isolation des workspaces par user, isolation des projects, accès concurrent,
et cohérence des settings.

Les tests démarrent **N backends uvicorn réels** (un par utilisateur),
les testent via HTTP, puis les arrêtent et nettoient proprement.

**Avantage vs Dataset Explorer :** l'Annotation App ne charge pas CLIP au
démarrage → les backends sont prêts en ~5-8s (vs ~20-25s pour Dataset Explorer).
Le timeout par défaut est donc 30s au lieu de 90s.

---

## Structure des fichiers

```
backend/tests/integration/
├── __init__.py         — package Python (vide, requis par pytest)
├── conftest.py         — fixtures pytest partagées
├── test_multiuser.py   — 18 tests organisés en 5 classes
├── run_tests.py        — lanceur CLI pratique
└── test.md             — ce fichier
```

---

## `conftest.py` — Fixtures session

### Fixture `multiuser_instances`

Démarre N backends, attend sur `/health`, yield les instances prêtes.
Teardown : SIGTERM + suppression workspaces.

**Différences par rapport à Dataset Explorer :**

| Point | Dataset Explorer | Annotation App |
|---|---|---|
| Endpoint de readiness | `GET /api/datasets` | `GET /health` |
| Env workspace | `EXPLORER_WORKSPACE` | `ANNOTATION_WORKSPACE` |
| Timeout par défaut | 90s (CLIP) | 30s (pas de ML au démarrage) |
| Port de base | 8010 | 8020 (évite les conflits) |
| Sous-dossiers workspace | `thumbs/, faiss/, subsets/` | `projects/, exports/, backup/` |
| Mode offline | — | `TRANSFORMERS_OFFLINE=1`, `HF_HUB_OFFLINE=1` |

**Pourquoi `TRANSFORMERS_OFFLINE=1` ?**
Sans ce flag, HuggingFace essaie de vérifier les modèles SAM2/GroundingDINO
sur le réseau au démarrage. En mode test on veut un démarrage instantané sans
dépendance réseau ni chargement GPU.

---

## `test_multiuser.py` — Tests

### Classes et tests

| Classe | Tests | Ce qui est vérifié |
|---|---|---|
| `TestHealth` | 5 | `/health`, `/api/projects`, `/api/settings`, `/api/workspace/info` |
| `TestWorkspaceIsolation` | 2 | Workspaces vides, chemins distincts |
| `TestProjectIsolation` | 3 | Isolation des projects entre users |
| `TestConcurrentAccess` | 6 | 5 rounds concurrents + création simultanée |
| `TestSettingsIsolation` | 2 | Settings isolés par workspace |

### Détail des tests

**T1 — `TestHealth`**
- `test_health_all_backends` : `GET /health` répond pour chaque user
- `test_health_status_ok` : le champ `status` vaut `"ok"` partout
- `test_endpoints_respond_for_all_users[endpoint]` : paramétrisé sur
  `/api/projects`, `/api/settings`, `/api/workspace/info`

**T2 — `TestWorkspaceIsolation`**
- `test_workspaces_start_empty` : aucun project dans les workspaces neufs
- `test_each_workspace_has_independent_db` : les chemins workspace retournés
  par `/api/workspace/info` sont tous distincts → DB SQLite différentes

**T3 — `TestProjectIsolation`**

Fixture `alice_project` (`scope="class"`) :
1. Crée un project `POST /api/projects` chez alice
2. Nettoie via `DELETE /api/projects/{id}` en teardown

Tests :
- `test_owner_sees_own_project` : alice voit son project
- `test_others_cannot_see_alice_project` : les 9 autres ne le voient pas
- `test_two_users_create_independent_projects` : alice + bob créent chacun
  leur project simultanément — isolation totale

**T4 — `TestConcurrentAccess`**
- `test_concurrent_api_round[1-5]` : 5 rounds paramétrés — 10 `GET /api/projects`
  simultanés via `ThreadPoolExecutor`
- `test_concurrent_project_creation` : tous les users créent un project
  simultanément, puis vérifie que chacun ne voit que le sien

**T5 — `TestSettingsIsolation`**
- `test_settings_do_not_bleed` : alice modifie `show_minimap`, bob est inchangé
- `test_settings_write_concurrent` : tous les users font `PUT /api/settings`
  simultanément — 0 erreur

---

## `run_tests.py` — Lanceur CLI

### Construction de la commande pytest

```python
cmd = [
    PYTHON, "-m", "pytest",
    str(THIS_DIR),     # uniquement ce dossier integration
    "-v",              # verbose : un test = une ligne
    "--tb=short",      # traceback court si echec
    "-m", "multiuser", # filtre sur le marker @pytest.mark.multiuser
    "--no-header",     # supprime le bandeau pytest
]
```

**Pourquoi `-m multiuser` ?**
Même raison que pour Dataset Explorer : isole les tests d'intégration multiuser
des autres tests qui pourraient être ajoutés dans ce dossier.

**Ports 8020-8029 :**
Volontairement décalés des ports Dataset Explorer (8010-8019) pour éviter tout
conflit si les deux suites de tests tournent en même temps sur la machine.

### Options CLI

| Option | Effet |
|---|---|
| `--fast` | `MULTIUSER_N_USERS=3` — 3 users, ~1 min au lieu de 4 |
| `--keep-ws` | `MULTIUSER_KEEP_WS=1` — workspaces conservés |

---

## Comment lancer

```bash
# Depuis Annotation_App/

# Complet — 10 users (~4 min)
python backend/tests/integration/run_tests.py

# Rapide — 3 users (~1 min)
python backend/tests/integration/run_tests.py --fast

# Debug
python backend/tests/integration/run_tests.py --fast --keep-ws

# Via pytest directement
python -m pytest backend/tests/integration/ -v -m multiuser

# Avec options
MULTIUSER_N_USERS=5 MULTIUSER_TIMEOUT=45 python -m pytest backend/tests/integration/ -v -m multiuser
```

---

## Notes techniques

### Pourquoi pas de test "global dataset" ?
L'Annotation App n'a pas de galerie globale partagée entre workspaces (pas
de `registry.json`). Chaque workspace est complètement indépendant.
Les tests testent donc l'isolation pure : ce qui est créé dans un workspace
n'est pas visible dans un autre.

### Isolation garantie par SQLite
Chaque backend reçoit `ANNOTATION_WORKSPACE=…/workspace_{user}_annot_itest`.
La DB `annotation.db` est dans ce dossier. Deux backends ne partagent jamais
la même DB → isolation au niveau du système de fichiers.

### Mode offline obligatoire
`TRANSFORMERS_OFFLINE=1` + `HF_HUB_OFFLINE=1` empêchent tout appel réseau
vers HuggingFace. Le backend démarre en mode dégradé (SAM2 non chargé),
ce qui est volontaire — les tests ne testent pas les modèles IA mais
l'isolation multiuser de l'API REST.
