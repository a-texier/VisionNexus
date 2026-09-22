# ============================================================
# trainer_backend.py -- moteurs d'entrainement : contrat, resolution,
# catalogues.
#
# Training_App est proprietaire de l'architecture modele et du moteur
# d'entrainement (voir CLAUDE.md). Le coeur ne fournit que "yolox"
# (yolox_engine.py). Un moteur tiers se branche sans toucher a ce module :
#   - un dossier dans <racine>/plugins/ (voir _lib/plugin_registry.py) ;
#   - un package installe qui declare l'entry point ENTRYPOINT_GROUP.
# Le moteur est choisi PAR RUN (champ `engine` des requetes) : plusieurs
# moteurs coexistent dans la meme instance, et le moteur d'un run voyage
# avec ses poids (DB, MLflow, reponse orchestrateur).
# ============================================================

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from importlib.metadata import entry_points
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

# Nom du groupe, commun aux plugins du dossier plugins/ et aux entry points :
#
#   [project.entry-points."visionnexus.trainer_backends"]
#   mon_moteur = "my_plugin_package:MonEngine"
ENTRYPOINT_GROUP = "visionnexus.trainer_backends"

# Seul moteur fourni par ce depot.
DEFAULT_BACKEND = "yolox"

# Cles obligatoires du CATALOG d'un moteur (voir yolox_catalog.CATALOG pour
# la reference commentee). Les UI se construisent uniquement a partir de la.
CATALOG_KEYS = (
    "label", "weights_suffixes", "sizes", "default_size", "defaults", "groups",
    "keys", "hpo_ranges", "hpo_default_optimize", "artifacts", "train_batches_glob",
)


class TrainerStopped(Exception):
    """Arret propre d'un entrainement demande via stop_flag.

    yolox_trainer.TrainingStopped en derive. Un moteur de plugin n'a pas a
    l'importer : training_service.py traite toute sortie de train() survenue
    alors que stop_flag est arme comme un arret, quel que soit le type leve.
    """


@runtime_checkable
class TrainingEngine(Protocol):
    """Contrat d'un moteur, utilise par training_service.py et
    Optuna_App/hpo_trial.py. Reference : yolox_engine.YoloxEngine."""

    CATALOG: dict[str, Any]

    def __init__(
        self,
        *,
        model_size: str,
        data_yaml: str,
        run_name: str,
        output_dir: str,
        hyperparams: dict[str, Any],
        model_weights: str = "",
        stop_flag=None,
        on_epoch_end: Callable[[dict], None] | None = None,
    ) -> None: ...

    def train(self) -> dict:
        """Entrainement bloquant. Appelle on_epoch_end(payload) a chaque epoque
        avec {"epoch", "total_epochs", "progress_pct", "loss": dict,
        "metrics": dict} (metriques nommees "metrics/mAP50(B)",
        "metrics/mAP50-95(B)"...). Renvoie {"run_dir", "best_model_path",
        "last_model_path"} et, si le moteur revalide ses poids finaux,
        "metrics" (memes noms). Les plots listes dans CATALOG["artifacts"]
        doivent exister sous run_dir a la fin."""
        ...


def _load_default_backend() -> type:
    # Import tardif : yolox_engine reste leger, mais inutile de le charger
    # si seul un plugin est demande.
    from .yolox_engine import YoloxEngine

    return YoloxEngine


def _plugin_registry():
    """_lib/plugin_registry.py du depot, ou None si l'app tourne extraite seule.

    Ce fichier est a Training_App/backend/services/ : la racine du depot est
    trois niveaux au-dessus. Optuna_App importe ce meme fichier, le calcul
    reste donc juste pour lui aussi.
    """
    root = str(Path(__file__).resolve().parents[3])
    if root not in sys.path:
        sys.path.append(root)
    try:
        from _lib import plugin_registry
    except ImportError:
        return None
    return plugin_registry


def normalize_engine(name: str | None) -> str:
    return (name or os.environ.get("TRAINING_APP_TRAINER_BACKEND") or DEFAULT_BACKEND).strip().lower()


def _load_plugin_backend(name: str) -> type:
    registry = _plugin_registry()
    if registry is not None:
        backend = registry.load_extension(ENTRYPOINT_GROUP, name)
        if backend is not None:
            return backend
    for ep in entry_points(group=ENTRYPOINT_GROUP):
        if ep.name == name:
            return ep.load()
    raise RuntimeError(
        f"Moteur d'entrainement '{name}' introuvable : ni dans plugins/, ni "
        f"en entry point '{ENTRYPOINT_GROUP}'. Le coeur ne fournit que "
        f"'{DEFAULT_BACKEND}'."
    )


def resolve_engine(name: str | None = None) -> type:
    """Classe du moteur `name` (ou TRAINING_APP_TRAINER_BACKEND / "yolox").

    Leve RuntimeError avec la raison si le moteur n'existe pas ou si son
    plugin n'est pas utilisable : jamais de repli silencieux sur un autre
    moteur, dont les poids ne seraient pas compatibles.
    """
    name = normalize_engine(name)
    if name == DEFAULT_BACKEND:
        return _load_default_backend()
    return _load_plugin_backend(name)


def engine_catalog(name: str | None = None) -> dict[str, Any]:
    engine = resolve_engine(name)
    catalog = getattr(engine, "CATALOG", None)
    if not isinstance(catalog, dict):
        raise RuntimeError(f"Moteur '{normalize_engine(name)}' sans CATALOG.")
    missing = [key for key in CATALOG_KEYS if key not in catalog]
    if missing:
        raise RuntimeError(
            f"CATALOG du moteur '{normalize_engine(name)}' incomplet : " + ", ".join(missing)
        )
    return catalog


def describe_backends(with_catalog: bool = False) -> list[dict]:
    """Tous les moteurs connus, utilisables ou non, avec la raison sinon.

    Forme destinee a /api/capabilities : une UI n'affiche un choix de moteur
    que si plus d'une entree est `available`, et n'invente jamais un libelle
    que le plugin n'a pas lui-meme fourni. `with_catalog` ajoute le catalogue
    de chaque moteur disponible (importe alors le module du moteur, jamais sa
    bibliotheque d'entrainement).
    """
    backends = [{
        "name": DEFAULT_BACKEND,
        "label": "YOLOX",
        "source": "builtin",
        "available": True,
        "reason": None,
    }]
    registry = _plugin_registry()
    seen = {DEFAULT_BACKEND}
    if registry is not None:
        for entry in registry.describe(ENTRYPOINT_GROUP):
            if entry["name"] in seen:
                continue
            seen.add(entry["name"])
            backends.append({**entry, "source": "plugin"})
    for ep in sorted(entry_points(group=ENTRYPOINT_GROUP), key=lambda e: e.name):
        if ep.name in seen:
            continue
        seen.add(ep.name)
        backends.append({
            "name": ep.name,
            "label": ep.name,
            "source": "entry_point",
            "available": True,
            "reason": None,
        })
    if with_catalog:
        for backend in backends:
            if not backend["available"]:
                continue
            try:
                catalog = engine_catalog(backend["name"])
            except Exception as exc:  # un plugin casse ne doit pas masquer les autres
                backend.update(available=False, reason=f"catalogue illisible : {exc}")
                continue
            backend["catalog"] = catalog
            backend["label"] = catalog.get("label", backend["label"])
    return backends


def list_available_backends() -> list[str]:
    """Noms des moteurs utilisables maintenant : 'yolox' + plugins disponibles."""
    return [b["name"] for b in describe_backends() if b["available"]]


def check_weights_for_engine(engine: str, weights: str) -> str | None:
    """Message d'erreur si `weights` n'a pas une extension du moteur, sinon None.

    Un .pt et un .pth ne sont pas interchangeables : on refuse avant de lancer
    plutot que d'echouer au chargement, au milieu du run.
    """
    if not weights:
        return None
    suffixes = [s.lower() for s in engine_catalog(engine)["weights_suffixes"]]
    if Path(weights).suffix.lower() in suffixes:
        return None
    return (
        f"Poids {Path(weights).name!r} incompatibles avec le moteur '{engine}' "
        f"(extensions attendues : {', '.join(suffixes)})."
    )


def filter_hyperparams(catalog: dict[str, Any], values: dict[str, Any]) -> tuple[dict, list[str]]:
    """Ne garde que les cles connues du moteur. Renvoie (retenues, ignorees)."""
    known = set(catalog["defaults"]) | set(catalog["keys"].values())
    kept = {k: v for k, v in values.items() if k in known}
    return kept, sorted(k for k in values if k not in known)


def merge_hyperparams(
    catalog: dict[str, Any],
    overrides: dict[str, Any] | None = None,
    *,
    epochs: int | None = None,
    batch: int | None = None,
    imgsz: int | None = None,
) -> tuple[dict, list[str]]:
    """Defauts du moteur <- overrides filtres <- epochs/batch/imgsz generiques.

    Renvoie (hyperparametres, cles ignorees). Les cles d'un autre moteur (par
    exemple un best_params HPO calcule pour YOLOX) sont ignorees et signalees
    au lieu d'etre transmises a un moteur qui ne les connait pas.
    """
    merged = dict(catalog["defaults"])
    kept, ignored = filter_hyperparams(catalog, dict(overrides or {}))
    merged.update(kept)
    keys = catalog["keys"]
    for generic, value in (("epochs", epochs), ("batch", batch), ("imgsz", imgsz)):
        if value is not None and generic in keys:
            merged[keys[generic]] = value
    return merged, ignored


def epochs_of(catalog: dict[str, Any], hyperparams: dict[str, Any]) -> int:
    key = catalog["keys"].get("epochs")
    try:
        return int(hyperparams.get(key, catalog["defaults"].get(key, 0)))
    except (TypeError, ValueError):
        return 0


__all__ = [
    "CATALOG_KEYS",
    "DEFAULT_BACKEND",
    "ENTRYPOINT_GROUP",
    "TrainerStopped",
    "TrainingEngine",
    "check_weights_for_engine",
    "describe_backends",
    "engine_catalog",
    "epochs_of",
    "filter_hyperparams",
    "list_available_backends",
    "merge_hyperparams",
    "normalize_engine",
    "resolve_engine",
]
