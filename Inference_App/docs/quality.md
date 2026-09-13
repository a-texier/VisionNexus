# Qualite du code (tracker)

Chaine de verification qualite du tracker vendore (`tracker/quality/`). N'a
aucune raison d'etre executee sur du code du backend/frontend de l'app -- perimetre
strictement `tracker/` (hors `tracker/trackers/` vendored tiers).

```bash
pip install ruff mypy bandit pytest pytest-cov   # une seule fois

python quality/quality.py                  # tout : ruff + pytest + mypy + bandit
python quality/quality.py --fix            # corrige automatiquement les violations ruff
python quality/quality.py --no-mypy --no-bandit   # rapide : ruff + tests seulement
```

Deux fichiers pilotent toute la chaine :
- **`pyproject.toml`** (racine du tracker) -- configuration de chaque outil
  (regles, cibles, seuils).
- **`quality/quality.py`** -- orchestre les appels dans l'ordre et affiche le
  bilan.

Quand `quality.py` lance un outil (ex. `ruff check .`), l'outil lit lui-meme
`pyproject.toml` pour savoir ce qu'il doit faire ; `quality.py` ne lit pas le
toml. Sortie dupliquee dans `quality/logs/quality_<date>.log`. Tests unitaires :
`quality/tests/` (pytest). Un echec sur un outil n'arrete pas les suivants.

Conventions de code : **ASCII strict** dans les `.py` (pas d'accents ni
d'emojis) + PEP8 (4 espaces, max 79 colonnes, snake_case).

---

## Ce que chaque outil corrige, avec exemples

### ruff -- `E` / `W` pycodestyle

Style PEP 8 : espaces, indentation, virgules manquantes.
```python
# Avant (E231 : espace manquant apres virgule)
x = [1,2,3]
# Apres
x = [1, 2, 3]
```
```python
# Avant (E711 : comparaison a None incorrecte)
if x == None:
# Apres
if x is None:
```

### ruff -- `F` pyflakes

Imports inutilises, variables non definies, re-imports.
```python
# Avant (F401 : import inutilise)
import os
import math   # jamais utilise
result = os.path.join("a", "b")
# Apres
import os
result = os.path.join("a", "b")
```
```python
# Avant (F821 : variable non definie)
print(resultat)   # 'resultat' n'existe pas
# Apres
resultat = compute()
print(resultat)
```

### ruff -- `I` isort

Ordre des imports : stdlib d'abord, puis tiers, puis projet local.
```python
# Avant (ordre incorrect)
import numpy as np
import os
from pipeline.ego_motion import EgoMotionCompensator
import logging
# Apres
import logging
import os

import numpy as np

from pipeline.ego_motion import EgoMotionCompensator
```

### ruff -- `UP` pyupgrade

Syntaxe obsolete remplacee par la syntaxe Python 3.10+ moderne.
```python
# Avant (UP006 : typing.List depreciee depuis Python 3.9)
from typing import List, Optional, Tuple

def get_boxes() -> List[Tuple[int, int]]:
    ...

def find(x: Optional[str] = None):
    ...

# Apres
def get_boxes() -> list[tuple[int, int]]:
    ...

def find(x: str | None = None):
    ...
```
```python
# Avant (UP015 : mode "r" inutile dans open())
with open("file.txt", "r", encoding="utf-8") as f:
    ...
# Apres
with open("file.txt", encoding="utf-8") as f:
    ...
```

### ruff -- `B` flake8-bugbear

Patterns dangereux qui causent des bugs subtils.
```python
# Avant (B006 : mutable default argument - partage entre tous les appels)
def process(items: list = []):
    items.append(1)
    return items
# Apres
def process(items: list | None = None):
    if items is None:
        items = []
    items.append(1)
    return items
```
```python
# Avant (B007 : variable de boucle inutilisee)
for i in range(10):
    do_something()
# Apres
for _ in range(10):
    do_something()
```

### ruff -- `C4` flake8-comprehensions

Comprehensions inutilement complexes.
```python
# Avant (C416 : comprehension inutile)
result = list(x for x in items)
# Apres
result = list(items)
```
```python
# Avant (C400 : list() sur generator inutile)
result = list([x * 2 for x in items])
# Apres
result = [x * 2 for x in items]
```

### ruff format

Reformatage automatique : guillemets doubles, indentation, virgules finales.
```python
# Avant
x = {'a':1,'b':2}
def f(a,b,c):
    return a+b+c
# Apres
x = {"a": 1, "b": 2}
def f(a, b, c):
    return a + b + c
```

### mypy -- verification de types

Detecte les incompatibilites de types avant l'execution.
```python
# Avant (retourne Optional[np.ndarray] mais le code suppose jamais None)
def get_frame() -> np.ndarray | None:
    ...

frame = get_frame()
h, w = frame.shape[:2]   # mypy : frame peut etre None -> AttributeError potentiel

# Apres
frame = get_frame()
if frame is None:
    return
h, w = frame.shape[:2]
```

### bandit -- audit securite

Detecte les patterns a risque de securite.
```python
# Avant (B301 : yaml.load sans Loader -> execution de code arbitraire)
import yaml
data = yaml.load(content)
# Apres (safe_load : refuse les tags YAML arbitraires)
data = yaml.safe_load(content)
```
```python
# Avant (B602 : subprocess avec shell=True -> injection de commande)
import subprocess
subprocess.run(f"ls {user_input}", shell=True)
# Apres
import subprocess
subprocess.run(["ls", user_input])
```

### pytest + coverage

Verifie que le code se comporte comme prevu et mesure les lignes testees.
```python
def test_frame_to_uint8_normalizes_uint16():
    img = np.array([[0, 4095]], dtype=np.uint16)
    out = _frame_to_uint8(img)
    assert out.dtype == np.uint8
    assert out[0, 0] == 0
    assert out[0, 1] == 255
```

---

## `pyproject.toml` -- explication de chaque section

**`[tool.ruff]`**
```toml
target-version = "py310"   # regles compatibles Python 3.10 minimum
line-length = 100           # longueur max d'une ligne
exclude = [...]             # dossiers ignores (repos clones + optional_format_adapter)
```

**`[tool.ruff.lint]`**
```toml
select = ["E", "F", "W", "I", "UP", "B", "C4"]   # familles actives (voir exemples ci-dessus)
ignore = ["E501"]   # E501 = ligne trop longue : gere par line-length
```

**`[tool.ruff.format]`**
```toml
quote-style = "double"    # guillemets doubles uniformes
indent-style = "space"    # espaces (pas de tabulations)
```

**`[tool.mypy]`**
```toml
python_version = "3.10"          # stubs stdlib utilises
ignore_missing_imports = true    # silence les libs sans stubs (cv2, optional_format_adapter...)
warn_unused_ignores = true       # signale les "# type: ignore" devenus inutiles
warn_return_any = false          # a activer progressivement
exclude = [...]                  # dossiers exclus meme si passes en argument
```

**`[tool.pytest.ini_options]`**
```toml
testpaths = ["tests"]    # cherche uniquement dans tests/ (pas tout le projet)
pythonpath = ["."]       # ajoute la racine au sys.path -> "from pipeline.x import y" fonctionne
addopts = "-v --tb=short"  # verbose + traceback court a chaque lancement
```

**`[tool.coverage.run]`**
```toml
source = [...]   # modules mesures
omit = [...]     # fichiers exclus de la mesure (repos clones, tests eux-memes)
```

**`[tool.coverage.report]`**
```toml
fail_under = 0        # seuil minimum (0 = pas de blocage). Monter a 70 quand les tests couvrent pipeline/
show_missing = true   # affiche les numeros de ligne non couverts dans le rapport terminal
```

**`[tool.bandit]`**
```toml
targets = [...]         # repertoires analyses (bandit ne decouvre pas le toml seul -> -c pyproject.toml)
severity = "medium"     # MEDIUM et HIGH uniquement (ignore les LOW = trop de faux positifs)
confidence = "medium"
exclude_dirs = [...]    # repos clones exclus
```

---

## Plan d'action

| Priorite | Action | Etat |
|----------|--------|------|
| done | Audit et correction imports (12 fichiers) | OK |
| done | `pyproject.toml` + `quality.py` | OK |
| done | Caracteres non-ASCII dangereux corriges | OK |
| 1 | `python quality.py --fix` (corriger violations ruff UP/F) | a faire |
| 2 | Mypy sur `pipeline/ego_motion.py` en premier | progressif |
| 3 | Bandit -- corriger les risques MEDIUM/HIGH | a faire |
| 4 | Monter `fail_under` a 70 dans `[tool.coverage.report]` | long terme |

---

## Reference generale (outils Python, hors perimetre projet)

Panorama rapide des outils d'evaluation de code Python disponibles sur
l'ecosysteme, pour reference si le besoin depasse la chaine `quality.py`
ci-dessus. Section volontairement generique (pas de specifique au tracker).

| Besoin | Outil recommande | Remarque |
|--------|-----------------|----------|
| Lint rapide en CI | **Ruff** | Deja utilise par `quality.py`. Ecrit en Rust, remplace Flake8+isort+une partie de Pylint, 10-100x plus rapide |
| Analyse statique exhaustive ponctuelle | Pylint | Score /10, tres complet mais verbeux et lent sur grandes codebases |
| Verification de types | **Mypy** | Deja utilise. `--strict` force une couverture de types complete ; adoption progressive via `# type: ignore` |
| Tests | **Pytest** | Deja utilise. Fixtures, parametrize, plugins (`pytest-cov`, `pytest-xdist`) |
| Couverture | **Coverage.py** (`pytest-cov`) | Indicateur necessaire mais pas suffisant (100% de couverture n'implique pas 100% de correction) |
| Securite | **Bandit** | Deja utilise. Injection de commandes, crypto faible, secrets hardcodes, `pickle`/`yaml.load` non securise |
| Profilage performance | cProfile (`python -m cProfile`) puis `line_profiler` si granularite ligne necessaire | `timeit` pour des microbenchmarks ponctuels |
| Documentation | Sphinx (autodoc + Napoleon) ou mkdocs pour un besoin plus leger | Pas utilise actuellement sur ce projet |
| CI orchestration | GitHub Actions | Pas de pipeline CI configure actuellement sur ce depot |

**Ordre d'adoption recommande pour un projet qui n'a pas encore de CI** : Ruff
(setup en 5 minutes) -> Pytest + Coverage (filet de securite contre les
regressions) -> Mypy progressif (fichier par fichier) -> Bandit (audit ponctuel
puis CI) -> Sphinx si la doc devient un enjeu.
