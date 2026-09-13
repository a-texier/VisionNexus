"""Discover optional input-format adapters without importing them."""

from __future__ import annotations

import ast
import importlib
from pathlib import Path
from types import ModuleType
from typing import Any


_PLUGIN_DIR = Path(__file__).resolve().parents[1] / "utils"


def available_formats() -> list[dict[str, Any]]:
    formats: list[dict[str, Any]] = []
    for path in sorted(_PLUGIN_DIR.glob("*.py")):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError, UnicodeError):
            continue
        for node in tree.body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if not any(isinstance(target, ast.Name) and target.id == "FORMAT_CAPABILITY" for target in targets):
                continue
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                break
            if isinstance(value, dict) and isinstance(value.get("id"), str):
                formats.append(value)
            break
    return formats


def get_format_for_filename(filename: str) -> tuple[dict[str, Any], ModuleType] | None:
    suffix = Path(filename).suffix.lower()
    for path in sorted(_PLUGIN_DIR.glob("*.py")):
        capability = None
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError, UnicodeError):
            continue
        for node in tree.body:
            if not isinstance(node, (ast.Assign, ast.AnnAssign)):
                continue
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if not any(isinstance(target, ast.Name) and target.id == "FORMAT_CAPABILITY" for target in targets):
                continue
            try:
                capability = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                capability = None
            break
        if isinstance(capability, dict) and suffix in {
            str(ext).lower() for ext in capability.get("extensions", [])
        }:
            return capability, importlib.import_module(f"backend.utils.{path.stem}")
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
