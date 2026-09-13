##########################################
# Project  : VisionNexus
# File     : main.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Entry point - loads YAML config, prepares run directory, delegates to pipeline.session.
##########################################

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).parent
os.chdir(ROOT)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.logger import get_logger  # noqa: E402

log = get_logger(__name__)


BASE_CONFIG = Path("config/config.yaml")


def _read_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _deep_merge(base: dict, override: dict) -> dict:
    """Fusionne *override* dans *base* recursivement (dicts imbriques mergés
    cle par cle, tout autre type remplace la valeur de base)."""
    merged = dict(base)
    for key, val in override.items():
        if isinstance(val, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], val)
        else:
            merged[key] = val
    return merged


def _load_cfg(config_path: Path) -> dict:
    """Charge la config complete (config/config.yaml) comme base, puis fusionne
    par-dessus le fichier demande. Un scenario (config_examples/*.yaml) n'a donc
    besoin de lister QUE les cles qu'il modifie, sans dupliquer config.yaml."""
    cfg_file = config_path if config_path.is_absolute() else ROOT / config_path
    base_file = ROOT / BASE_CONFIG

    base = _read_yaml(base_file) if base_file.exists() else {}

    if cfg_file == base_file:
        return base

    if not cfg_file.exists():
        log.warning("Config not found: %s -- using %s seul", cfg_file, BASE_CONFIG)
        return base

    override = _read_yaml(cfg_file)
    return _deep_merge(base, override)


def _make_run_dir(cfg: dict, output_dir: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = "_".join(
        [
            "run",
            ts,
            cfg.get("run_name", "run"),
            cfg.get("tracker_mot", "mot"),
            cfg.get("tracker_sot", "sot"),
        ]
    )
    run_dir = output_dir / name
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def run(config_path: Path) -> dict:
    cfg = _load_cfg(config_path)

    if cfg.get("sequence_dir") is None:
        raise ValueError(
            "sequence_dir non défini dans le fichier de config.\nVérifiez votre config.yaml."
        )

    output_dir = Path(cfg.get("output_dir", "outputs"))
    if not output_dir.is_absolute():
        output_dir = ROOT / output_dir

    run_dir = _make_run_dir(cfg, output_dir)

    # Ecrit la config EFFECTIVE (config/config.yaml fusionnee avec le scenario
    # demande), pas juste une copie du fichier passe en --config : un scenario
    # ne liste que ses deltas, la copie brute serait incomplete pour la tracabilite.
    dst = run_dir / "config.yaml"
    dst.write_text(yaml.dump(cfg, allow_unicode=True, sort_keys=False), encoding="utf-8")

    log.info("Run : %s", run_dir)

    from pipeline.session import run_session

    return run_session(cfg, run_dir)


def main():
    p = argparse.ArgumentParser(
        description="VisionNexus Tracker - pipeline MOT/SOT",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Exemples :\n"
            "  python main.py\n"
            "  python main.py --config config_examples/sample_minimal.yaml\n"
        ),
    )
    p.add_argument(
        "--config",
        type=Path,
        default=Path("config/config.yaml"),
        help="Fichier de configuration YAML (défaut : config/config.yaml)",
    )
    args = p.parse_args()
    run(args.config)


if __name__ == "__main__":
    main()
