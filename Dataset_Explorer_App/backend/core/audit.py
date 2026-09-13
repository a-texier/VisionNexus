# ============================================================
# core/audit.py
# Journal des opérations sensibles (suppression, partage, fusion, export).
#
# Pourquoi : plusieurs utilisateurs partagent la galerie globale et peuvent
# supprimer ou fusionner des datasets qu'ils n'ont pas créés. Sans trace, une
# disparition est indébuggable ("qui a supprimé quoi, quand ?").
#
# Format : JSONL dans le workspace (une ligne = un événement). Pas de table SQL :
# le journal doit survivre à une base recréée, et rester lisible/greppable à la
# main. Rotation simple par taille pour ne jamais grossir sans fin.
# ============================================================

import json
import logging
import os
from datetime import datetime
from typing import List, Optional

from backend.config import CURRENT_USER, WORKSPACE

logger = logging.getLogger(__name__)

AUDIT_FILE = WORKSPACE / "audit.jsonl"
MAX_BYTES = 5 * 1024 * 1024      # au-delà, on archive en .1 et on repart à zéro


def _rotate_if_needed() -> None:
    try:
        if AUDIT_FILE.exists() and AUDIT_FILE.stat().st_size > MAX_BYTES:
            backup = AUDIT_FILE.with_suffix(".jsonl.1")
            if backup.exists():
                backup.unlink()
            os.replace(AUDIT_FILE, backup)
    except Exception:
        logger.debug("Rotation du journal d'audit ignoree")


def record(action: str, **details) -> None:
    """Enregistre un événement. Ne lève jamais : un audit cassé ne doit pas
    faire échouer l'opération métier qu'il observe."""
    try:
        _rotate_if_needed()
        entry = {
            "ts": datetime.utcnow().isoformat(timespec="seconds"),
            "user": CURRENT_USER,
            "action": action,
            **details,
        }
        with open(AUDIT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        logger.debug("Ecriture du journal d'audit echouee (action=%s)", action)


def read_recent(limit: int = 100, action: Optional[str] = None) -> List[dict]:
    """Derniers événements, du plus récent au plus ancien."""
    if not AUDIT_FILE.exists():
        return []
    try:
        with open(AUDIT_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()[-5000:]
    except Exception:
        return []

    out: List[dict] = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except Exception:
            continue
        if action and entry.get("action") != action:
            continue
        out.append(entry)
        if len(out) >= limit:
            break
    return out
