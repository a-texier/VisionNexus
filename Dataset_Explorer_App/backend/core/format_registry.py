"""Discovery for optional dataset format adapters."""

from __future__ import annotations

import ast
import importlib
from pathlib import Path
from types import ModuleType
from typing import Any


_PLUGIN_DIR = Path(__file__).resolve().parents[1] / "utils"


def _read_capability(path: Path) -> dict[str, Any] | None:
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
    return [
        capability
        for path in sorted(_PLUGIN_DIR.glob("*.py"))
        if (capability := _read_capability(path)) is not None
    ]


def get_format_for_filename(filename: str) -> tuple[dict[str, Any], ModuleType] | None:
    suffix = Path(filename).suffix.lower()
    for path in sorted(_PLUGIN_DIR.glob("*.py")):
        capability = _read_capability(path)
        if capability is None:
            continue
        extensions = {str(ext).lower() for ext in capability.get("extensions", [])}
        if suffix in extensions:
            module = importlib.import_module(f"backend.utils.{path.stem}")
            return capability, module
    return None


def invoke_for_filename(filename: str, operation: str, *args: Any, **kwargs: Any) -> Any:
    resolved = get_format_for_filename(filename)
    if resolved is None:
        raise ValueError(f"Aucun adaptateur disponible pour {Path(filename).suffix or filename}")
    capability, module = resolved
    handler = getattr(module, "FORMAT_OPERATIONS", {}).get(operation)
    if not callable(handler):
        raise ValueError(
            f"L'adaptateur {capability.get('label', capability['id'])} "
            f"ne prend pas en charge l'opération {operation}"
        )
    return handler(*args, **kwargs)


def supports_filename(filename: str) -> bool:
    return get_format_for_filename(filename) is not None
