##########################################
# Project  : VisionNexus
# File     : __init__.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Factory for camera-specific metadata readers.
##########################################

import importlib
import inspect
from pathlib import Path
from typing import List, Optional

# camera_name (lower) -> Python package path
CAMERA_REGISTRY = {
    "multi_csv": "data.rejeu.cameras.multi_csv",
    "single_csv": "data.rejeu.cameras.single_csv",
}


def load_metadata_reader(
    camera_name: str,
    sequence_dir,
    csv_files: list[str] | None = None,
):
    """
    Instantiate the metadata reader for *camera_name*.

    Parameters
    ########
    camera_name  : camera identifier (e.g. "multi_csv")
    sequence_dir : Path-like - folder containing camera data files
    csv_files    : optional list of required CSV filenames (assertion only)

    Returns
    ######
    MetadataReaderBase instance

    Raises
    #####
    ValueError  if camera_name is not in CAMERA_REGISTRY
    """
    pkg = _resolve(camera_name)
    mod = importlib.import_module(f"{pkg}.metadata_reader")
    cls = _find_class(mod, "MetadataReader")
    return cls(Path(sequence_dir), csv_files or [])


####
# Helpers
####


def _resolve(camera_name: str) -> str:
    name = camera_name.lower().strip()
    if name not in CAMERA_REGISTRY:
        raise ValueError(
            f"Unknown camera: '{camera_name}'. "
            f"Registered: {sorted(CAMERA_REGISTRY)}. "
            f"Add data/rejeu/cameras/<name>/metadata_reader.py to support it."
        )
    return CAMERA_REGISTRY[name]


def _find_class(module, suffix: str):
    """Return the first class in *module* whose name ends with *suffix*."""
    for _name, obj in inspect.getmembers(module, inspect.isclass):
        if _name.endswith(suffix) and obj.__module__ == module.__name__:
            return obj
    raise AttributeError(f"No class ending with '{suffix}' found in {module.__name__}")
