# ============================================================
# tracker_bridge.py -- pont vers le tracker VisionNexus vendored.
# Ajoute tracker/ au sys.path et expose run_session + helpers config.
# Le code du tracker n'est PAS modifie (import in-process uniquement).
# ============================================================

import sys
from pathlib import Path

import yaml

from backend.config import TRACKER_ROOT

# Le tracker resout tous ses chemins contre son propre ROOT (Path(__file__)),
# pas contre le CWD -> pas besoin de chdir, seulement du sys.path.
if str(TRACKER_ROOT) not in sys.path:
    sys.path.insert(0, str(TRACKER_ROOT))

_BASE_CONFIG   = TRACKER_ROOT / "config" / "config.yaml"
_SCENARIO_DIR  = TRACKER_ROOT / "config_examples"


def tracker_available() -> bool:
    return _BASE_CONFIG.exists()


def get_run_session():
    """Import paresseux (charge torch/opencv/... seulement au 1er lancement)."""
    from pipeline.session import run_session  # noqa: E402  (import cote tracker)
    return run_session


def get_build_loader():
    """Loader de flux du tracker (optional_format, video, dossier, http/MJPEG, tcp/ZMQ) —
    interface uniforme : `for frame_id, frame, meta in loader`. Sert a l'acquisition."""
    from pipeline.builders import build_loader  # noqa: E402
    return build_loader


def load_base_config() -> dict:
    """Config de reference du tracker (toutes les cles + defauts documentes)."""
    if _BASE_CONFIG.exists():
        return yaml.safe_load(_BASE_CONFIG.read_text(encoding="utf-8")) or {}
    return {}


def deep_merge(base: dict, override: dict) -> dict:
    """Fusionne *override* dans *base* recursivement (dicts imbriques merges cle
    par cle). Utilise pour appliquer un scenario (config_examples/*.yaml, qui ne
    liste que ses deltas) sur load_base_config() sans ecraser les sous-cles non
    modifiees d'une section imbriquee (ex: render:, botsort:...)."""
    merged = dict(base)
    for key, val in override.items():
        if isinstance(val, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], val)
        else:
            merged[key] = val
    return merged


def list_scenarios() -> list[dict]:
    """Presets prets a l'emploi (config_examples/*.yaml) avec un resume.

    Le resume est lu sur la config FUSIONNEE (base + scenario), pas sur le
    fichier brut : un scenario ne liste que ses deltas, donc une cle qu'il
    laisse a la valeur par defaut de config.yaml (ex: tracker_mot) serait
    sinon absente du resume."""
    out: list[dict] = []
    if not _SCENARIO_DIR.is_dir():
        return out
    base = load_base_config()
    for f in sorted(_SCENARIO_DIR.glob("*.yaml")):
        try:
            override = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        except Exception:
            override = {}
        cfg = deep_merge(base, override)
        out.append({
            "id": f.stem,
            "file": f.name,
            "mode": cfg.get("mode", ""),
            "tracker_mot": cfg.get("tracker_mot", ""),
            "tracker_sot": cfg.get("tracker_sot", ""),
            "n_targets": cfg.get("n_targets", 1),
            "sequence_dir": cfg.get("sequence_dir", ""),
        })
    return out


def load_scenario(scenario_id: str) -> dict:
    f = _SCENARIO_DIR / f"{scenario_id}.yaml"
    if not f.exists():
        raise FileNotFoundError(f"scenario introuvable: {scenario_id}")
    return yaml.safe_load(f.read_text(encoding="utf-8")) or {}
