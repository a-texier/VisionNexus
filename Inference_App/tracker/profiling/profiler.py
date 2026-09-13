##########################################
# Project  : VisionNexus
# File     : profiler.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Per-frame profiler with section timing and interactive HTML report generation.
##########################################

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from pathlib import Path

log = logging.getLogger(__name__)

# Sections dans leur ordre d'affichage naturel
SECTION_ORDER = [
    "frame_load",
    "ldv_cmc",
    "image_cmc",
    "detect_mot",
    "compensate",
    "mot_update",
    "sot_update",
    "render",
]

# Couleurs par section (palette vive, bien differenciee)
SECTION_COLORS = {
    "frame_load": "#4a5065",  # gris (artefact de rejeu, non représentatif)
    "ldv_cmc": "#06D6A0",  # vert menthe
    "image_cmc": "#EF233C",  # rouge vif
    "detect_mot": "#FF9F1C",  # orange vif
    "compensate": "#B388FF",  # violet lumineux
    "mot_update": "#4361EE",  # bleu electrique
    "sot_update": "#F72585",  # rose magenta
    "render": "#7BDFF2",  # cyan ciel
    "other": "#FFD60A",  # jaune vif
}


#################################
# Null profiler (overhead zero quand profiling desactive)
#################################


class NullProfiler:
    """Profiler no-op : toutes les methodes sont des no-ops."""

    @contextmanager
    def section(self, name: str):
        yield

    def end_frame(self, frame_id: int, total_s: float = 0.0) -> None:
        pass

    def generate_report(self, fps_wall_mean: float = 0.0, fps_wall_per_frame=None) -> None:
        pass

    @property
    def enabled(self) -> bool:
        return False


#################################
# Real profiler
#################################


class FrameProfiler:
    """
    Profiler frame-par-frame avec sortie HTML interactive (Plotly).

    Parameters
    ########
    active_sections : set[str]  sections a mesurer (les autres sont ignorees)
    output_path     : Path      fichier HTML de sortie
    show_per_frame  : bool      inclure le graphe barre par frame
    show_summary    : bool      inclure le graphe global (pie + tableau)
    """

    def __init__(
        self,
        active_sections: set,
        output_path: Path,
        show_per_frame: bool = True,
        show_summary: bool = True,
    ):
        self._active = active_sections
        self._out = Path(output_path)
        self._per_frame = show_per_frame
        self._summary = show_summary

        # Donnees accumulees
        # frame_data[frame_id] = {"detect_mot": 0.012, "render": 0.005, ...}
        self._frame_data: dict[int, dict[str, float]] = {}
        self._frame_order: list[int] = []
        self._frame_totals: dict[int, float] = {}

        # Etat courant (frame en cours)
        self._cur_frame_id: int = -1
        self._cur_frame_secs: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        return True

    @contextmanager
    def section(self, name: str):
        """Context manager qui mesure le temps d'une section."""
        if name not in self._active:
            yield
            return
        t0 = time.perf_counter()
        try:
            yield
        finally:
            elapsed = time.perf_counter() - t0
            # Accumule (une section peut etre appelee plusieurs fois par frame)
            self._cur_frame_secs[name] = self._cur_frame_secs.get(name, 0.0) + elapsed

    def end_frame(self, frame_id: int, total_s: float = 0.0) -> None:
        """
        Termine la mesure d'une frame.

        Parameters
        ########
        frame_id : identifiant de la frame
        total_s  : duree totale de la frame (pour calculer "other")
        """
        data = dict(self._cur_frame_secs)

        # Calcul "other" = tout ce qui n'est pas mesure
        measured = sum(data.values())
        if total_s > 0:
            other = max(0.0, total_s - measured)
            if "other" in self._active:
                data["other"] = other

        self._frame_data[frame_id] = data
        self._frame_totals[frame_id] = total_s if total_s > 0 else measured
        self._frame_order.append(frame_id)
        self._cur_frame_secs = {}

    def generate_report(self, fps_wall_mean: float = 0.0, fps_wall_per_frame=None) -> None:
        """Genere le rapport HTML dans self._out."""
        if not self._frame_data:
            log.warning("Profiler: aucune donnee -> rapport non genere")
            return

        try:
            from profiling.report import generate_html

            generate_html(
                frame_data=self._frame_data,
                frame_order=self._frame_order,
                frame_totals=self._frame_totals,
                output_path=self._out,
                show_per_frame=self._per_frame,
                show_summary=self._summary,
                fps_wall_mean=fps_wall_mean,
                fps_wall_per_frame=fps_wall_per_frame,
            )
            log.info("Profiling report: %s", self._out)
        except Exception as exc:
            log.error("Profiler: erreur generation rapport: %s", exc, exc_info=True)


#################################
# Factory
#################################


def build_profiler(cfg: dict, run_dir: Path) -> FrameProfiler | NullProfiler:
    """
    Construit un profiler (reel ou null) depuis profiling_config.yaml.

    Cherche profiling_config.yaml a la racine du projet (un niveau au-dessus
    de pipeline/).

    Returns NullProfiler si profiling desactive ou fichier absent.
    """
    root = Path(__file__).resolve().parent.parent
    cfg_path = root / "profiling_config.yaml"

    if not cfg_path.exists():
        return NullProfiler()

    try:
        import yaml

        with open(cfg_path, encoding="utf-8") as fh:
            pcfg = yaml.safe_load(fh) or {}
    except Exception as exc:
        log.warning("Profiler: impossible de lire %s : %s -> desactive", cfg_path, exc)
        return NullProfiler()

    if not pcfg.get("enabled", False):
        return NullProfiler()

    # Sections actives
    sections_cfg = pcfg.get("sections", {})
    active = set()
    for name in SECTION_ORDER + ["other"]:
        if sections_cfg.get(name, True):  # True par defaut si non mentionne
            active.add(name)

    # Chemin de sortie
    output_cfg = pcfg.get("output", {})
    html_tpl = output_cfg.get("html_path", "{run_dir}/profiling.html")
    run_name = cfg.get("run_name", "run")
    html_path = html_tpl.format(
        run_dir=str(run_dir),
        run_name=run_name,
    )

    show_per_frame = bool(output_cfg.get("per_frame_chart", True))
    show_summary = bool(output_cfg.get("mean_summary", True))

    log.info(
        "Profiler enabled | sections=%s | output=%s",
        sorted(active),
        html_path,
    )

    return FrameProfiler(
        active_sections=active,
        output_path=Path(html_path),
        show_per_frame=show_per_frame,
        show_summary=show_summary,
    )
