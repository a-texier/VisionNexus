"""
plugin_registry.py -- decouverte des plugins poses dans <racine>/plugins/.

Un plugin est un package Python ordinaire, range a cote du reste du code :
aucune installation pip, aucun entry point a declarer. Sa presence dans
plugins/ suffit a le rendre visible ; le retirer du dossier (branche Git
`main`, bundles publics) le rend invisible sans toucher une ligne ailleurs.

Contrat d'un plugin : son __init__.py expose un dict PLUGIN, par exemple

    PLUGIN = {
        "label": "Nom affiche",
        "requires": ["module_tiers"],          # modules qui doivent etre installes
        "extensions": {
            "visionnexus.trainer_backends": {
                "mon_moteur": "mon_plugin.trainer:MonTrainer",
            },
        },
    }

Le __init__.py ne doit rien importer de lourd : il est lu a chaque
decouverte. Les cibles "module:attribut" ne sont importees qu'au moment ou
une extension est reellement demandee, et les dependances declarees dans
`requires` sont verifiees sans etre importees (find_spec). Un plugin dont
une dependance manque reste liste, marque indisponible, avec la raison :
c'est ce qui permet a une UI de ne rien afficher tant qu'il n'est pas
reellement utilisable.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

PLUGINS_DIRNAME = "plugins"
# Permet de pointer vers un autre dossier (tests, deploiement atypique).
PLUGINS_DIR_ENV = "VISIONNEXUS_PLUGINS_DIR"


@dataclass(frozen=True)
class PluginInfo:
    name: str
    label: str
    requires: tuple[str, ...] = ()
    missing: tuple[str, ...] = ()
    extensions: dict[str, dict[str, str]] = field(default_factory=dict)
    error: str | None = None

    @property
    def available(self) -> bool:
        return self.error is None and not self.missing

    @property
    def unavailable_reason(self) -> str | None:
        if self.error:
            return self.error
        if self.missing:
            return "dependance(s) absente(s) : " + ", ".join(self.missing)
        return None


def plugins_root() -> Path:
    override = os.environ.get(PLUGINS_DIR_ENV, "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / PLUGINS_DIRNAME


def _missing_requirements(requires: tuple[str, ...]) -> tuple[str, ...]:
    missing = []
    for module_name in requires:
        try:
            found = importlib.util.find_spec(module_name) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(module_name)
    return tuple(missing)


def _read_plugin(package_dir: Path) -> PluginInfo:
    name = package_dir.name
    try:
        module = importlib.import_module(name)
    except Exception as exc:  # un plugin casse ne doit pas faire tomber l'app
        return PluginInfo(name=name, label=name, error=f"import impossible : {exc}")

    manifest = getattr(module, "PLUGIN", None)
    if not isinstance(manifest, dict):
        return PluginInfo(name=name, label=name, error="dict PLUGIN absent de __init__.py")

    requires = tuple(str(r) for r in manifest.get("requires", ()))
    extensions = {
        str(group): {str(k): str(v) for k, v in dict(targets).items()}
        for group, targets in dict(manifest.get("extensions", {})).items()
    }
    return PluginInfo(
        name=name,
        label=str(manifest.get("label", name)),
        requires=requires,
        missing=_missing_requirements(requires),
        extensions=extensions,
    )


def discover_plugins() -> list[PluginInfo]:
    root = plugins_root()
    if not root.is_dir():
        return []
    root_str = str(root)
    if root_str not in sys.path:
        sys.path.append(root_str)
    return [
        _read_plugin(child)
        for child in sorted(root.iterdir())
        if child.is_dir() and (child / "__init__.py").is_file()
    ]


def extensions_for(group: str) -> dict[str, PluginInfo]:
    """{nom_extension: plugin qui la fournit} pour un groupe, disponibles ou non."""
    found: dict[str, PluginInfo] = {}
    for plugin in discover_plugins():
        for ext_name in plugin.extensions.get(group, {}):
            found.setdefault(ext_name, plugin)
    return found


def load_extension(group: str, name: str):
    """Importe et renvoie l'objet cible, ou None si aucun plugin ne declare ce nom.

    Leve RuntimeError si le plugin existe mais n'est pas utilisable : mieux vaut
    une erreur qui dit pourquoi qu'un repli silencieux sur un autre moteur.
    """
    plugin = extensions_for(group).get(name)
    if plugin is None:
        return None
    if not plugin.available:
        raise RuntimeError(
            f"Extension '{name}' du plugin '{plugin.name}' indisponible : "
            f"{plugin.unavailable_reason}."
        )
    target = plugin.extensions[group][name]
    module_name, _, attr = target.partition(":")
    module = importlib.import_module(module_name)
    return getattr(module, attr) if attr else module


def describe(group: str) -> list[dict]:
    """Forme serialisable pour un endpoint /api/capabilities."""
    return [
        {
            "name": ext_name,
            "plugin": plugin.name,
            "label": plugin.label,
            "available": plugin.available,
            "reason": plugin.unavailable_reason,
        }
        for ext_name, plugin in sorted(extensions_for(group).items())
    ]
