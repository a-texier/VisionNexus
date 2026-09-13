#!/usr/bin/env python3
"""
sync_tracker.py -- pousse une nouvelle version du tracker dans Inference_App/tracker/.

Le tracker est VENDORE (copie) depuis un depot source configurable. Ce script recopie la
source dans tracker/ en excluant les gros artefacts, puis RÉ-APPLIQUE
automatiquement les 2 seules modifications locales (sinon l'app casse) :

  1. builders.py  : record_dir configurable via cfg["record_dir"] (rejeu -> workspace).
  2. tracker/__init__.py SUPPRIMÉ : ce fichier vide faisait de `tracker` un package
     régulier qui masquait le sous-package `tracker` de BoT-SORT/BoostTrack
     (ImportError). Namespace package obligatoire.

Usage :
    python sync_tracker.py --source <dossier-tracker>
    python sync_tracker.py --source D:/autre/tracker
    python sync_tracker.py --dry-run           # affiche ce qui serait fait, ne copie pas

Ce que le script NE touche PAS dans la destination : rien n'est préservé sélectivement
au-delà des 2 ré-applications ci-dessus — la source est la vérité. Sauvegardez vos
poids custom ailleurs que dans tracker/weights si vous ne voulez pas les écraser.
"""
import argparse
import os
import shutil
from pathlib import Path

APP_ROOT = Path(__file__).parent.resolve()
DEST = APP_ROOT / "tracker"
DEFAULT_SOURCE = os.environ.get("INFERENCE_TRACKER_SOURCE", "")

# Dossiers/fichiers exclus de la copie (artefacts lourds / caches / VCS).
EXCLUDE_DIRS = {"__pycache__", ".git", ".pytest_cache", ".mypy_cache",
                "outputs", "runs", ".idea", ".vscode", "node_modules"}
EXCLUDE_SUFFIXES = {".pyc", ".pyo"}
# Le gros zip d'export autonome (~240 Mo) : jamais copié.
EXCLUDE_NAME_CONTAINS = ("export_zip_", "_offline_bundle")


def _ignore(_dir: str, names: list[str]) -> set[str]:
    out: set[str] = set()
    for n in names:
        if n in EXCLUDE_DIRS:
            out.add(n)
        elif Path(n).suffix in EXCLUDE_SUFFIXES:
            out.add(n)
        elif any(tok in n for tok in EXCLUDE_NAME_CONTAINS) and n.endswith(".zip"):
            out.add(n)
    return out


def _reapply_modifs(dest: Path) -> list[str]:
    notes: list[str] = []

    # Modif 2 : supprimer tracker/__init__.py (namespace package).
    init = dest / "__init__.py"
    if init.exists():
        init.unlink()
        notes.append("modif#2 : tracker/__init__.py supprimé (namespace package)")
    else:
        notes.append("modif#2 : tracker/__init__.py déjà absent (OK)")

    # Modif 1 : record_dir configurable dans builders.py.
    builders = dest / "pipeline" / "builders.py"
    if builders.exists():
        txt = builders.read_text(encoding="utf-8")
        if 'cfg.get("record_dir")' in txt:
            notes.append("modif#1 : builders.py record_dir déjà configurable (OK)")
        else:
            naive = '        record_dir = ROOT / "cmd_send"'
            patched = ('        _rec = cfg.get("record_dir")\n'
                       '        record_dir = Path(_rec) if _rec else ROOT / "cmd_send"')
            if naive in txt:
                builders.write_text(txt.replace(naive, patched, 1), encoding="utf-8")
                notes.append("modif#1 : builders.py record_dir rendu configurable (patché)")
            else:
                notes.append("⚠ modif#1 : motif record_dir introuvable dans builders.py — "
                             "à ré-appliquer À LA MAIN (la structure source a changé).")
    else:
        notes.append("⚠ builders.py introuvable dans la destination.")

    return notes


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync du tracker vendoré dans Inference_App/tracker/")
    ap.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help="dossier source du tracker (ou INFERENCE_TRACKER_SOURCE)",
    )
    ap.add_argument("--dry-run", action="store_true", help="n'effectue aucune copie")
    args = ap.parse_args()

    if not args.source:
        ap.error("--source est requis si INFERENCE_TRACKER_SOURCE n'est pas defini")
    src = Path(args.source)
    if not src.is_dir():
        print(f"[ERREUR] source introuvable : {src}")
        return 1

    print(f"Source : {src}")
    print(f"Dest   : {DEST}")
    if args.dry_run:
        print("\n[dry-run] copie NON effectuée. Modifs qui seraient ré-appliquées :")
        for n in ("modif#2 : tracker/__init__.py supprimé",
                  "modif#1 : builders.py record_dir configurable"):
            print("  -", n)
        return 0

    # Copie (Python 3.8+ : dirs_exist_ok). On écrase le contenu existant.
    shutil.copytree(src, DEST, ignore=_ignore, dirs_exist_ok=True)
    print("\nCopie terminée.")
    print("Ré-application des modifications locales :")
    for n in _reapply_modifs(DEST):
        print("  -", n)

    print("\nVérifiez ensuite l'import :")
    print('  python -c "from backend.services import tracker_bridge as tb; '
          'print(tb.tracker_available())"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
