"""
test_tools.py -  démonstration pédagogique de ruff / mypy / bandit sur dirty.py.

Chaque test cible dirty.py (même dossier) et montre :
  - ce qu'un outil détecte AVANT correction
  - l'effet d'un --fix automatique ruff (AVANT → APRÈS)

Lancement :
    pytest quality/test_tools/ -v -s

Entièrement autonome : aucune fixture conftest, aucun import projet.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

DIRTY = Path(__file__).parent / "dirty.py"


###### helpers #######################################


def _run(*args) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", *args],
        cwd=Path(__file__).parent.parent.parent,  # racine projet (pour pyproject.toml)
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def _ruff_violations(path) -> list[dict]:
    """Retourne la liste des violations ruff (format JSON)."""
    result = subprocess.run(
        [sys.executable, "-m", "ruff", "check", str(path), "--output-format=json"],
        cwd=Path(__file__).parent.parent.parent,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        return json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        return []


##
# RUFF
##


class TestRuff:
    """
    ruff check dirty.py  →  détecte violations de style/qualité.
    ruff check dirty.py --fix  →  corrige automatiquement les fixables.
    """

    def test_I001_imports_non_tries(self):
        """I001 : os/json/sys non triés alphabétiquement → ruff les réordonne."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "I001" in codes, f"I001 attendu. Codes trouvés : {codes}"

    def test_F401_import_inutilise(self):
        """F401 : os et json importés mais jamais utilisés."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "F401" in codes, f"F401 attendu. Codes trouvés : {codes}"

    def test_UP006_List_devient_list(self):
        """UP006 : List[str] → list[str] (python 3.9+, plus besoin de typing)."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "UP006" in codes, f"UP006 attendu. Codes trouvés : {codes}"

    def test_UP045_Optional_devient_union(self):
        """UP045 : Optional[int] → int | None  (UP007 dans ruff < 0.4, UP045 depuis 0.4+)."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "UP045" in codes or "UP007" in codes, (
            f"UP045 (ou UP007) attendu. Codes trouvés : {codes}"
        )

    def test_F841_variable_locale_inutilisee(self):
        """F841 : unused_local assignée mais jamais relue."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "F841" in codes, f"F841 attendu. Codes trouvés : {codes}"

    def test_C408_dict_appel_vs_literal(self):
        """C408 : dict(host=...) → {"host": ...} (plus rapide, plus lisible)."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "C408" in codes, f"C408 attendu. Codes trouvés : {codes}"

    def test_B007_variable_boucle_inutilisee(self):
        """B007 : idx dans enumerate() jamais utilisé → remplacer par _."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "B007" in codes, f"B007 attendu. Codes trouvés : {codes}"

    def test_E711_comparaison_none(self):
        """E711 : config == None → config is None (identité, pas égalité)."""
        viols = _ruff_violations(DIRTY)
        codes = [v["code"] for v in viols]
        assert "E711" in codes, f"E711 attendu. Codes trouvés : {codes}"

    # ## Avant / Après --fix ###################################################

    def test_fix_reduit_les_violations(self, tmp_path):
        """
        AVANT  : N violations dans dirty.py
        APRÈS  : --fix corrige les fixables → M violations (M < N)

        Fixables : I001, F401, UP006, UP007, C408, E711
        Non fixables : F841, B007
        """
        copy = tmp_path / "dirty.py"
        shutil.copy(DIRTY, copy)

        avant = _ruff_violations(copy)
        n_avant = len(avant)

        subprocess.run(
            [sys.executable, "-m", "ruff", "check", str(copy), "--fix"],
            cwd=Path(__file__).parent.parent.parent,
            capture_output=True,
        )

        apres = _ruff_violations(copy)
        n_apres = len(apres)

        print(f"\n  AVANT  --fix : {n_avant} violations")
        for v in avant:
            print(f"    [{v['code']}] ligne {v['location']['row']:>3}  {v['message']}")

        print(f"\n  APRÈS  --fix : {n_apres} violations (non-fixables)")
        for v in apres:
            print(f"    [{v['code']}] ligne {v['location']['row']:>3}  {v['message']}")

        assert n_apres < n_avant, (
            f"--fix aurait dû réduire les violations ({n_avant} → {n_apres})"
        )

    def test_fix_modifie_le_fichier(self, tmp_path):
        """--fix écrit réellement dans le fichier (le contenu change)."""
        copy = tmp_path / "dirty.py"
        shutil.copy(DIRTY, copy)
        avant = copy.read_text(encoding="utf-8")

        subprocess.run(
            [sys.executable, "-m", "ruff", "check", str(copy), "--fix"],
            cwd=Path(__file__).parent.parent.parent,
            capture_output=True,
        )

        apres = copy.read_text(encoding="utf-8")
        assert avant != apres, "--fix aurait dû modifier le contenu du fichier"

    def test_fix_corrige_imports(self, tmp_path):
        """Après --fix : `import os` et `import json` sont retirés (F401)."""
        copy = tmp_path / "dirty.py"
        shutil.copy(DIRTY, copy)

        subprocess.run(
            [sys.executable, "-m", "ruff", "check", str(copy), "--fix"],
            cwd=Path(__file__).parent.parent.parent,
            capture_output=True,
        )

        contenu = copy.read_text(encoding="utf-8")
        assert "import os" not in contenu, "import os aurait dû être supprimé"
        assert "import json" not in contenu, "import json aurait dû être supprimé"

    def test_fix_modernise_typing(self, tmp_path):
        """Après --fix : List[str] → list[str], Optional[int] → int | None."""
        copy = tmp_path / "dirty.py"
        shutil.copy(DIRTY, copy)

        subprocess.run(
            [sys.executable, "-m", "ruff", "check", str(copy), "--fix"],
            cwd=Path(__file__).parent.parent.parent,
            capture_output=True,
        )

        contenu = copy.read_text(encoding="utf-8")
        assert "List[str]" not in contenu, "List[str] aurait dû devenir list[str]"
        assert "list[str]" in contenu, "list[str] devrait être présent après fix"
        assert "Optional[" not in contenu, "Optional[ aurait dû être supprimé"

    def test_fix_laisse_non_fixables(self, tmp_path):
        """F841 et B007 ne sont pas auto-corrigés : restent après --fix."""
        copy = tmp_path / "dirty.py"
        shutil.copy(DIRTY, copy)

        subprocess.run(
            [sys.executable, "-m", "ruff", "check", str(copy), "--fix"],
            cwd=Path(__file__).parent.parent.parent,
            capture_output=True,
        )

        restants = [v["code"] for v in _ruff_violations(copy)]
        assert "F841" in restants, "F841 devrait rester (non fixable automatiquement)"
        assert "B007" in restants, "B007 devrait rester (non fixable automatiquement)"


##
# MYPY
##


class TestMypy:
    """
    mypy dirty.py  →  détecte les incohérences de types statiques.
    mypy ne modifie PAS le fichier (outil analyse-only).
    """

    def _run_mypy(self):
        return _run(
            "mypy", str(DIRTY),
            "--ignore-missing-imports",
            "--no-error-summary",
            "--explicit-package-bases",
        )

    def test_trouve_des_erreurs(self):
        """mypy doit trouver au moins 2 erreurs de type dans dirty.py."""
        result = self._run_mypy()
        lignes_erreur = [l for l in result.stdout.splitlines() if "error:" in l]

        print(f"\n  Erreurs mypy ({len(lignes_erreur)}) :")
        for l in lignes_erreur:
            print(f"    {l.strip()}")

        assert len(lignes_erreur) >= 2, (
            f"Attendu ≥ 2 erreurs mypy, trouvé {len(lignes_erreur)}\n{result.stdout}"
        )

    def test_arg_type_str_vs_int(self):
        """add('oops', 42) → Argument 1 has incompatible type 'str'; expected 'int'."""
        result = self._run_mypy()
        assert "arg-type" in result.stdout or (
            "str" in result.stdout and "int" in result.stdout
        ), result.stdout

    def test_return_value_int_vs_str(self):
        """wrong_return() retourne 123 (int) alors que → str est déclaré."""
        result = self._run_mypy()
        assert "return-value" in result.stdout or "Incompatible return" in result.stdout, (
            result.stdout
        )

    def test_exit_code_non_zero(self):
        """mypy quitte avec code ≠ 0 quand des erreurs sont trouvées."""
        result = self._run_mypy()
        assert result.returncode != 0, "mypy aurait dû retourner code ≠ 0"

    def test_ne_modifie_pas_le_fichier(self):
        """mypy est un outil d'analyse : il ne touche jamais dirty.py."""
        avant = DIRTY.read_text(encoding="utf-8")
        self._run_mypy()
        apres = DIRTY.read_text(encoding="utf-8")
        assert avant == apres, "mypy ne devrait pas modifier dirty.py"


##
# BANDIT
##


class TestBandit:
    """
    bandit dirty.py  →  détecte les problèmes de sécurité.
    bandit ne modifie PAS le fichier (outil analyse-only).
    """

    def _run_bandit(self, *extra):
        return _run("bandit", str(DIRTY), *extra)

    def test_B301_pickle_deserialisation(self):
        """B301 : pickle.loads(raw) -  données non fiables → exécution arbitraire."""
        result = self._run_bandit("-t", "B301")
        print(f"\n  bandit B301 :\n{result.stdout[:500]}")
        assert "B301" in result.stdout or "pickle" in result.stdout.lower(), result.stdout

    def test_B307_eval_dangereux(self):
        """B307 : eval(expr) -  exécute du code Python arbitraire."""
        result = self._run_bandit("-t", "B307")
        print(f"\n  bandit B307 :\n{result.stdout[:500]}")
        assert "B307" in result.stdout or "eval" in result.stdout.lower(), result.stdout

    def test_B602_shell_injection(self):
        """B602 : subprocess.Popen(cmd, shell=True) → injection de commande shell."""
        result = self._run_bandit("-t", "B602")
        print(f"\n  bandit B602 :\n{result.stdout[:500]}")
        assert "B602" in result.stdout or "shell" in result.stdout.lower(), result.stdout

    def test_B108_chemin_tmp_previsible(self):
        """B108 : /tmp/vision_data.pkl - chemin prévisible, race condition possible."""
        result = self._run_bandit("-t", "B108")
        print(f"\n  bandit B108 :\n{result.stdout[:500]}")
        assert "B108" in result.stdout or "/tmp" in result.stdout, result.stdout

    def test_B104_bind_toutes_interfaces(self):
        """B104 : bind('0.0.0.0', port) -  expose le service sur toutes les interfaces."""
        result = self._run_bandit("-t", "B104")
        print(f"\n  bandit B104 :\n{result.stdout[:500]}")
        assert "B104" in result.stdout or "0.0.0.0" in result.stdout, result.stdout

    def test_severity_medium_ou_plus(self):
        """bandit -ll (Medium+) : dirty.py contient des problèmes sérieux."""
        result = self._run_bandit("-ll")
        print(f"\n  bandit -ll (Medium+) : exit={result.returncode}")
        issues = [l for l in result.stdout.splitlines() if "Issue" in l or "Severity" in l]
        for i in issues[:6]:
            print(f"    {i.strip()}")
        assert result.returncode != 0, (
            "bandit aurait dû trouver des issues Medium+ dans dirty.py"
        )

    def test_ne_modifie_pas_le_fichier(self):
        """bandit est un outil d'analyse : il ne touche jamais dirty.py."""
        avant = DIRTY.read_text(encoding="utf-8")
        self._run_bandit()
        apres = DIRTY.read_text(encoding="utf-8")
        assert avant == apres, "bandit ne devrait pas modifier dirty.py"
