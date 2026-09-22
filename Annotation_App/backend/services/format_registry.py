"""Discovery of optional, self-contained sequence format adapters."""

from __future__ import annotations

import ast
import importlib
from pathlib import Path
from types import ModuleType
from typing import Any


_PLUGIN_DIR = Path(__file__).resolve().parents[1] / "utils"


def _read_capability(path: Path) -> dict[str, Any] | None:
    """Read literal metadata without importing unrelated utility modules."""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    except (OSError, SyntaxError, UnicodeError):
        return None
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == "FORMAT_CAPABILITY" for target in targets):
            continue
        try:
            value = ast.literal_eval(node.value)
        except (ValueError, TypeError):
            return None
        if isinstance(value, dict) and isinstance(value.get("id"), str):
            return value
    return None


def available_formats() -> list[dict[str, Any]]:
    """Return public metadata for adapters physically present on disk."""
    formats: list[dict[str, Any]] = []
    for path in sorted(_PLUGIN_DIR.glob("*.py")):
        capability = _read_capability(path)
        if capability is None:
            continue
        formats.append({**capability, "module": path.stem})
    return formats


def get_format(format_id: str) -> tuple[dict[str, Any], ModuleType] | None:
    """Load one discovered adapter only when an operation needs it."""
    for capability in available_formats():
        if capability["id"] != format_id:
            continue
        module = importlib.import_module(f"backend.utils.{capability['module']}")
        return capability, module
    return None


def get_format_for_filename(filename: str) -> tuple[dict[str, Any], ModuleType] | None:
    suffix = Path(filename).suffix.lower()
    for capability in available_formats():
        extensions = {str(ext).lower() for ext in capability.get("extensions", [])}
        if suffix not in extensions:
            continue
        module = importlib.import_module(f"backend.utils.{capability['module']}")
        return capability, module
    return None


def invoke_for_filename(filename: str, operation: str, *args: Any, **kwargs: Any) -> Any:
    """Invoke one operation from the adapter matching *filename*."""
    resolved = get_format_for_filename(filename)
    if resolved is None:
        raise ValueError(f"Aucun adaptateur disponible pour {Path(filename).suffix or filename}")
    capability, module = resolved
    operations = getattr(module, "FORMAT_OPERATIONS", {})
    handler = operations.get(operation)
    if not callable(handler):
        raise ValueError(
            f"L'adaptateur {capability.get('label', capability['id'])} "
            f"ne prend pas en charge l'opération {operation}"
        )
    return handler(*args, **kwargs)


def supports_filename(filename: str) -> bool:
    return get_format_for_filename(filename) is not None


def preferred_extension() -> str:
    for capability in available_formats():
        extensions = capability.get("extensions", [])
        if extensions:
            return str(extensions[0])
    raise ValueError("Aucun adaptateur de séquence optionnel n'est installé")
