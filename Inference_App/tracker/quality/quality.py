#!/usr/bin/env python
"""
quality.py  --  python quality/quality.py [--fix] [--no-mypy] [--no-bandit]

Orchestre ruff / pytest / mypy / bandit en local.
Chaque outil lit sa configuration dans pyproject.toml (racine projet).
La sortie est simultanement affichee dans le terminal et ecrite dans
quality/logs/quality_YYYY-MM-DD_HH-MM-SS.log
Un echec n'arrete pas les etapes suivantes.
"""

import argparse
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
LOG_DIR = Path(__file__).parent / "logs"

# Cibles mypy : uniquement les zones activement développées.
# Exclus volontairement : trackers/mot/ (botsort/bytetrack/boosttrack ont leurs propres stubs),
#                         data/, utils/, tools/ (pas encore annotés).
MYPY_TARGETS = ["pipeline/", "trackers/sot/csrt/", "trackers/sot/tracking_tophat/"]

_R = "\033[0m"
_BOLD = "\033[1m"
_GREEN = "\033[92m"
_RED = "\033[91m"
_CYAN = "\033[96m"
_YELLOW = "\033[93m"
_GRAY = "\033[90m"

_ANSI_RE = re.compile(r"\033\[[0-9;]*m")


class _Tee:
    def __init__(self, terminal, logfile):
        self._terminal = terminal
        self._logfile = logfile

    def write(self, data):
        try:
            self._terminal.write(data)
        except UnicodeEncodeError:
            enc = getattr(self._terminal, "encoding", "utf-8") or "utf-8"
            self._terminal.write(data.encode(enc, errors="replace").decode(enc))
        self._logfile.write(_ANSI_RE.sub("", data))

    def flush(self):
        self._terminal.flush()
        self._logfile.flush()

    def isatty(self):
        return self._terminal.isatty()


def _setup_log_file():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = LOG_DIR / f"quality_{ts}.log"
    log_file = open(log_path, "w", encoding="utf-8")
    sys.stdout = _Tee(sys.__stdout__, log_file)
    print(f"Log : {log_path}")
    return log_file


def col(text, code):
    return f"{code}{text}{_R}" if sys.stdout.isatty() else text


def banner(step, title):
    sep = "-" * 60
    print(f"\n{col(sep, _GRAY)}")
    print(f"  {col(f'{step}  {title}', _CYAN + _BOLD)}")
    print(col(sep, _GRAY))


def run(cmd):
    print(col("$ " + " ".join(str(c) for c in cmd), _GRAY))
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="")
    return result.returncode


def step_ruff_lint(fix):
    # Zone : tout le projet (.) — tous les .py hors .gitignore / exclusions pyproject.toml.
    # Fait : style, imports, unused vars, f-strings, type ignores mal placés.
    # Non fait : logique métier, sémantique algorithmes.
    banner("1/5", "RUFF lint")
    cmd = [sys.executable, "-m", "ruff", "check", "."]
    if fix:
        cmd.append("--fix")
        print(col("  --fix : corrections automatiques", _YELLOW))
    return run(cmd)


def step_ruff_format(fix):
    # Zone : tout le projet (.) — même périmètre que ruff lint.
    # Fait : indentation, longueur de ligne, guillemets, virgules trailing.
    banner("2/5", "RUFF format")
    cmd = [sys.executable, "-m", "ruff", "format", "."]
    if not fix:
        cmd.append("--check")
    return run(cmd)


_QUALITY_DIR = Path(__file__).parent
_TESTS_DIR = _QUALITY_DIR / "tests"
_COVERAGE_FILE = _QUALITY_DIR / ".coverage"
_HTML_DIR = _QUALITY_DIR / "coverage_html"


def step_pytest():
    # Zone testée (quality/tests/) :
    #   pipeline/  -> detector_mot (TopHat, seuillage adaptatif), detector_roi, ego_motion
    #                  (homographie LDV, compensation détections, FrameBuffer/LdvBuffer)
    #   data/      -> annotation_loader (.ver long/court + YOLO merged), image_reader,
    #                  sequence_loader (start/stop/fps/iteration)
    #
    # Non testés (pas de tests unitaires) :
    #   state_machine, session, builders, visualizer, command_parser, click_handler
    #   trackers/mot/* (bytetrack, botsort, boosttrack, custom_kalman)
    #   trackers/sot/csrt/*, trackers/sot/tracking_tophat/*  (testés en intégration via scénarios)
    #   utils/* (visu_algo_debug, debug_panel, stream_server…)
    banner("3/5", "PYTEST + couverture")
    rc = run([
        sys.executable, "-m", "pytest",
        str(_TESTS_DIR), "--cov", "--cov-report=term-missing", "-q",
    ])
    run([sys.executable, "-m", "coverage", "html",
         f"--data-file={_COVERAGE_FILE}", "-d", str(_HTML_DIR)])
    print(col(f"  Coverage HTML : {_HTML_DIR / 'index.html'}", _GRAY))
    return rc


def step_mypy():
    # Zone : pipeline/, trackers/sot/csrt/, trackers/sot/tracking_tophat/ (voir MYPY_TARGETS).
    # Fait : signatures, types retour, attributs de classe, narrowing Optional.
    # Non bloquant : avertissements affichés mais rc forcé à 0 (migration progressive).
    # Non couvert : trackers/mot/, data/, utils/, tools/ .
    banner("4/5", "MYPY  [progressif -- non bloquant]")
    print(col("  Cibles : " + " ".join(MYPY_TARGETS), _GRAY))
    run([
        sys.executable, "-m", "mypy", *MYPY_TARGETS,
        "--ignore-missing-imports", "--no-error-summary", "--explicit-package-bases",
    ])
    return 0


def step_bandit():
    # Zone : pipeline, data, utils, trackers/sot/csrt, trackers/sot/tracking_tophat, tools.
    # Fait : injections subprocess, chemins construits depuis user input, pickle/yaml unsafe,
    #        secrets hardcodés, permissions fichiers.
    # Non couvert : trackers/mot/* (code tiers botsort/bytetrack/boosttrack, pas modifié).
    # Niveau : -ll = medium+high sévérité uniquement (les low sont ignorés).
    banner("5/5", "BANDIT audit securite")
    targets = ["pipeline", "data", "utils", "trackers/sot/csrt", "trackers/sot/tracking_tophat", "tools"]
    print(col("  Cibles : " + " ".join(targets), _GRAY))
    return run([sys.executable, "-m", "bandit", "-r", *targets, "-ll"])


def print_summary(results):
    sep = "=" * 60
    print(f"\n{col(sep, _GRAY)}")
    print(f"  {col('BILAN', _BOLD)}")
    print(col(sep, _GRAY))
    all_ok = True
    for name, rc in results.items():
        tag = col("[OK]", _GREEN) if rc == 0 else col(f"[ECHEC code={rc}]", _RED)
        if rc != 0:
            all_ok = False
        print(f"  {name:<30} {tag}")
    print(col(sep, _GRAY))
    msg = "Tout est bon." if all_ok else "Des etapes ont echoue -- voir ci-dessus."
    print(f"  {col(msg, _GREEN + _BOLD if all_ok else _RED)}")
    print(col(sep, _GRAY))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", action="store_true", help="ruff lint --fix + ruff format")
    parser.add_argument("--no-mypy", action="store_true")
    parser.add_argument("--no-bandit", action="store_true")
    args = parser.parse_args()

    log_file = _setup_log_file()

    try:
        results = {}
        results["ruff lint"] = step_ruff_lint(args.fix)
        results["ruff format"] = step_ruff_format(args.fix)
        results["pytest"] = step_pytest()
        if not args.no_mypy:
            results["mypy"] = step_mypy()
        if not args.no_bandit:
            results["bandit"] = step_bandit()

        print_summary(results)
        exit_code = 0 if all(rc == 0 for rc in results.values()) else 1
    finally:
        sys.stdout = sys.__stdout__
        log_file.close()

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
