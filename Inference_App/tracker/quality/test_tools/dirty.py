"""
dirty.py -  fichier pédagogique avec des erreurs intentionnelles.

Chaque section documente les violations qu'un outil détecte.
Complètement autonome : aucun import projet.
"""

# I001 : imports non triés (ordre alphabétique correct : json, os, pickle…)
import pickle
import socket
import subprocess
import sys

##
# SECTION RUFF
# Violations : I001, F401, UP035, UP006, UP045, F841, C408, B007, E711
##


def process_items(items: list[str]) -> int | None:   # UP006, UP045

    config = {"host": "localhost", "port": 8080}           # C408 → {"host": ...}

    for _idx, item in enumerate(items):                   # B007 : idx jamais utilisé
        sys.stdout.write(item + "\n")

    if config is None:                                   # E711 → `is None`
        return None

    return len(items)


##
# SECTION MYPY
# Violations : arg-type, return-value
##


def add(a: int, b: int) -> int:
    return a + b


erreur_type: int = add("oops", 42)     # arg-type  : str passé à int


def wrong_return() -> str:
    return 123                          # return-value : int retourné, str attendu


def no_annotation(x, y):               # no-untyped-def : annotations manquantes
    return x + y


##
# SECTION BANDIT
# Violations : B108, B301, B307, B602, B104
##

TEMP_PATH = "/tmp/vision_data.pkl"      # B108 : chemin /tmp prévisible (race condition)


def deserialize(raw: bytes):
    return pickle.loads(raw)            # B301 : désérialisation pickle non sûre


def evaluate(expr: str):
    return eval(expr)                   # B307 : exécution de code arbitraire


def run_shell(cmd: str) -> None:
    subprocess.Popen(cmd, shell=True)   # B602 : shell=True → injection de commande


def open_server(port: int) -> socket.socket:
    s = socket.socket()
    s.bind(("0.0.0.0", port))          # B104 : écoute sur toutes les interfaces
    return s
