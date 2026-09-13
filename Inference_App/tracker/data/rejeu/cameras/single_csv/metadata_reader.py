##########################################
# Project  : VisionNexus
# File     : metadata_reader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Parses SingleCsv CSV files to produce LDV series and camera info.
##########################################

import csv
import logging
import math
from pathlib import Path

from ...metadata_base import MetadataReaderBase

log = logging.getLogger(__name__)

_RAD_TO_DEG = 180.0 / math.pi


class SingleCsvMetadataReader(MetadataReaderBase):
    """
    Reads the single SingleCsv CSV alongside a video/image sequence.

    Parameters
    ########
    sequence_dir : Path
        Directory containing the sequence.  Used as fallback for CSV
        auto-discovery when *csv_files* is empty.
    csv_files : list of Path-like, optional
        Explicit path(s) to the CSV file.  The first existing path is used.
        When empty or None, auto-discovers the first *.csv in *sequence_dir*.
    """

    def __init__(self, sequence_dir: Path, csv_files: list | None = None):
        self._dir = Path(sequence_dir)
        self._ldv: dict[int, tuple[float, float]] = {}
        self._cam: dict = {
            "fps": 0.0,
            "width": 0,
            "height": 0,
            "chh_deg": 0.0,
            "chv_deg": 0.0,
        }

        csv_path = self._resolve_csv(csv_files)
        if csv_path is not None:
            self._parse(csv_path)

    ######################################
    # Internal helpers
    ######################################

    def _resolve_csv(self, csv_files: list | None) -> Path | None:
        """Return the CSV path to use (explicit list first, then auto-glob)."""
        if csv_files:
            for f in csv_files:
                p = Path(f)
                if p.exists():
                    log.info("SingleCsv: CSV explicite : %s", p)
                    return p
            log.warning("SingleCsv: aucun CSV explicite trouvé dans metadata_csv")

        # Auto-discover: first *.csv in sequence_dir
        matches = sorted(self._dir.glob("*.csv"))
        if matches:
            log.info("SingleCsv: CSV auto-découvert : %s", matches[0])
            return matches[0]

        log.warning("SingleCsv: aucun CSV trouvé dans %s", self._dir)
        return None

    def _parse(self, path: Path) -> None:
        """Parse the SingleCsv CSV and fill _ldv and _cam."""
        # FOV channel selection from filename
        fov_col = "fov_deg_1" if "TV" in path.name else "fov_deg_0"
        log.info("SingleCsv: colonne FOV='%s'  (fichier='%s')", fov_col, path.name)

        delta_ms_list: list[float] = []
        chh_deg = 0.0

        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for frame_idx, row in enumerate(reader):
                try:
                    az_deg = float(row["az"]) * _RAD_TO_DEG
                    el_deg = float(row["el"]) * _RAD_TO_DEG
                    self._ldv[frame_idx] = (az_deg, el_deg)

                    dm = row.get("delta_ms", "").strip()
                    if dm:
                        delta_ms_list.append(float(dm))

                    fov_val = row.get(fov_col, "").strip()
                    if fov_val:
                        chh_deg = float(fov_val)  # stable across rows; keep last

                except (ValueError, KeyError):
                    continue

        n = len(self._ldv)
        log.info("SingleCsv: %d points LDV parsés", n)

        # Derive FPS from cumulative delta_ms (first entry is 0)
        fps = 0.0
        if len(delta_ms_list) > 1 and delta_ms_list[-1] > 0.0:
            fps = (len(delta_ms_list) - 1) * 1000.0 / delta_ms_list[-1]

        self._cam.update({"fps": fps, "chh_deg": chh_deg})
        log.info(
            "SingleCsv: fps=%.2f  chh_deg=%.3f°  fov_col=%s",
            fps,
            chh_deg,
            fov_col,
        )

    ######################################
    # MetadataReaderBase interface
    ######################################

    def get_ldv_series(self) -> dict[int, tuple[float, float, float]]:
        """Returns {frame_idx: (az_deg, el_deg, roulis_deg)}.

        SingleCsv ne fournit pas de roulis — roulis_deg = 0.0 (dummy).
        """
        return {k: (az, el, 0.0) for k, (az, el) in self._ldv.items()}

    def get_camera_info(self) -> dict:
        """
        Returns {fps, width, height, chh_deg, chv_deg}.

        width and height are 0 - the pipeline fills them from the first frame.
        chv_deg is 0.0 - not available in SingleCsv metadata.
        """
        return dict(self._cam)
