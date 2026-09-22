# ============================================================
# run_artifacts.py -- plots d'analyse d'un run, selon le moteur qui l'a
# produit.
#
# Chaque moteur declare ses fichiers dans CATALOG["artifacts"] (chemins
# relatifs au dossier du run, par categorie, du prefere au moins prefere).
# Un run YOLOX expose donc les plots de detection_metrics/yolox_plots, un run
# de plugin ses plots natifs : la galerie, Insights et MLflow lisent tous
# cette meme liste, jamais des noms en dur.
# ============================================================

from __future__ import annotations

from pathlib import Path
from typing import Any

# Ordre d'affichage stable ; une categorie inconnue d'un plugin passe en fin.
KNOWN_CATEGORIES = (
    "summary", "confusion", "curves", "labels", "val_labels", "val_predictions",
)
MAX_TRAIN_BATCHES = 3


def collect_artifacts(run_dir: Path, catalog: dict[str, Any]) -> dict[str, list[str]]:
    """{categorie: [chemins relatifs presents]}, plus "train_batches"."""
    declared: dict[str, list[str]] = catalog.get("artifacts", {})
    ordered = [c for c in KNOWN_CATEGORIES if c in declared]
    ordered += [c for c in declared if c not in KNOWN_CATEGORIES]
    result = {
        category: [name for name in declared[category] if (run_dir / name).is_file()]
        for category in ordered
    }
    pattern = catalog.get("train_batches_glob") or ""
    batches = sorted(run_dir.glob(pattern)) if pattern else []
    result["train_batches"] = [
        p.relative_to(run_dir).as_posix() for p in batches[:MAX_TRAIN_BATCHES]
    ]
    return result


def artifact_files(run_dir: Path, catalog: dict[str, Any]) -> list[Path]:
    """Fichiers a joindre au run MLflow, sans doublon."""
    seen: dict[str, Path] = {}
    for names in collect_artifacts(run_dir, catalog).values():
        for name in names:
            seen.setdefault(name, run_dir / name)
    return list(seen.values())
