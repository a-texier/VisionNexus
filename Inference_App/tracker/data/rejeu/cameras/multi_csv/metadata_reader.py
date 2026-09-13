##########################################
# Project  : VisionNexus
# File     : metadata_reader.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Parses MultiCsv optional_format camera CSV files to produce LDV series and camera info.
##########################################

import csv
import logging
from dataclasses import dataclass
from pathlib import Path

from ...metadata_base import MetadataReaderBase

log = logging.getLogger(__name__)


####
# Internal data containers  (MultiCsv-specific, not part of any public API)
####


@dataclass
class _LdvPoint:
    """One row from POINTAGECAM_IR.csv."""

    date_reception: str = ""
    block_id: int = 0
    az_deg: float = 0.0
    el_deg: float = 0.0
    chh_deg: float = 0.0
    chv_deg: float = 0.0
    roll: float = 0.0
    champ_valid: int = 1


@dataclass
class _CameraInfo:
    """One row from INFO_VID_IR.csv."""

    width: int = 0
    height: int = 0
    fps: float = 0.0
    chh_deg: float = 0.0
    chv_deg: float = 0.0
    top_hat: str = ""
    exposure: float = 0.0
    gain: float = 0.0


####
# CSV column -> Python attribute  (MultiCsv bus names - stay in this file)
####

_POINTAGE_COLS: dict[str, str] = {
    "Bus_GAV_TI:MG:_DateReception": "date_reception",
    "Bus_GAV_TI:MG:POINTAGECAM:IDIMG": "block_id",
    "Bus_GAV_TI:MG:POINTAGECAM:Az": "az_deg",
    "Bus_GAV_TI:MG:POINTAGECAM:El": "el_deg",
    "Bus_GAV_TI:MG:POINTAGECAM:CHH": "chh_deg",
    "Bus_GAV_TI:MG:POINTAGECAM:CHV": "chv_deg",
    "Bus_GAV_TI:MG:POINTAGECAM:Roll": "roll",
    "Bus_GAV_TI:MG:POINTAGECAM :champ valid": "champ_valid",
}

_VIDINFO_COLS: dict[str, str] = {
    "Bus_GAV_SERVER:GAV:INFO_VID_2:WIDTH": "width",
    "Bus_GAV_SERVER:GAV:INFO_VID_2:HEIGHT": "height",
    "Bus_GAV_SERVER:GAV:INFO_VID_2:FRAMERATE": "fps",
    "Bus_GAV_SERVER:GAV:INFO_VID_2:TOP_HAT": "top_hat",
    "Bus_GAV_SERVER:GAV:INFO_VID_2:EXPOSURE": "exposure",
    "Bus_GAV_SERVER:GAV:INFO_VID_2:GAIN": "gain",
}


####
# Reader
####


class MultiCsvMetadataReader(MetadataReaderBase):
    """
    Reads the three MultiCsv CSV files for a sequence.

    Parameters
    ########
    sequence_dir : Path
        Directory containing (or adjacent to) the CSV files.
        Used as a fallback search location when *csv_files* is empty.
    csv_files : list of Path-like, optional
        Explicit paths to the three CSV files (already resolved, absolute or
        relative to the caller).  When provided, auto-discovery via glob is
        skipped entirely.  When empty or None, all *.csv files in
        *sequence_dir* are searched by suffix (backward compatibility).
    """

    def __init__(
        self,
        sequence_dir: Path,
        csv_files: list | None = None,
    ):
        self._dir = Path(sequence_dir)

        # Resolve explicit CSV paths
        self._csv_paths: list[Path] = []
        if csv_files:
            for f in csv_files:
                p = Path(f)
                if not p.exists():
                    raise FileNotFoundError(f"MultiCsv: CSV not found: {p}")
                self._csv_paths.append(p)
            log.info(
                "MultiCsv: using %d explicit CSV file(s) from metadata_csv",
                len(self._csv_paths),
            )
        else:
            log.info("MultiCsv: no explicit metadata_csv - auto-glob in %s", self._dir)

        # Internal tables  (block_id is an opaque MultiCsv concept here)
        self._ldv: dict[int, _LdvPoint] = {}  # block_id -> _LdvPoint
        self._blockid_map: dict[int, int] = {}  # block_id -> num_image
        self._cam: _CameraInfo | None = None

        self._parse_all()

    ####
    # Parsing
    ####

    def _parse_all(self) -> None:
        self._parse_blockid_numim()
        self._parse_pointage()
        self._parse_vidinfo()

    def _find_csv(self, suffix: str) -> Path | None:
        """
        Locate a CSV file by its name suffix.

        Priority 1: explicit list from metadata_csv (provided paths).
        Priority 2: auto-glob in self._dir (fallback when metadata_csv=[]).
        """
        if self._csv_paths:
            for p in self._csv_paths:
                if p.name.endswith(suffix):
                    return p
            log.warning("MultiCsv: no CSV ending with '%s' in metadata_csv list", suffix)
            return None

        # Fallback: search by suffix in the sequence directory
        for p in self._dir.glob("*.csv"):
            if p.name.endswith(suffix):
                return p
        log.warning("MultiCsv: CSV not found (suffix='%s') in %s", suffix, self._dir)
        return None

    @staticmethod
    def _read_csv(path: Path) -> list:
        with open(path, newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f, delimiter=";"))

    def _parse_blockid_numim(self) -> None:
        path = self._find_csv("BlockID_NumIm.csv")
        if path is None:
            return
        for row in self._read_csv(path):
            try:
                block_id = int(row.get("blockID", row.get("blockid", 0)))
                num_image = int(row.get("NumIm", row.get("numim", 0)))
                self._blockid_map[block_id] = num_image
            except (ValueError, KeyError):
                continue
        log.info("MultiCsv BlockID map: %d entries", len(self._blockid_map))

    def _parse_pointage(self) -> None:
        path = self._find_csv("POINTAGECAM_IR.csv")
        if path is None:
            return
        for row in self._read_csv(path):
            try:
                pt = _LdvPoint()
                for col, attr in _POINTAGE_COLS.items():
                    val = row.get(col, "").strip()
                    if not val:
                        continue
                    if attr in ("az_deg", "el_deg", "chh_deg", "chv_deg", "roll"):
                        setattr(pt, attr, float(val))
                    elif attr in ("block_id", "champ_valid"):
                        setattr(pt, attr, int(float(val)))
                    else:
                        setattr(pt, attr, val)
                self._ldv[pt.block_id] = pt
            except (ValueError, KeyError):
                continue
        log.info("MultiCsv POINTAGECAM: %d LDV entries", len(self._ldv))

    def _parse_vidinfo(self) -> None:
        path = self._find_csv("INFO_VID_IR.csv")
        if path is None:
            return
        rows = self._read_csv(path)
        if not rows:
            return
        row = rows[-1]  # last row - camera params are stable
        ci = _CameraInfo()
        for col, attr in _VIDINFO_COLS.items():
            val = row.get(col, "").strip()
            if not val:
                continue
            try:
                if attr in ("width", "height"):
                    setattr(ci, attr, int(float(val)))
                elif attr in ("fps", "exposure", "gain"):
                    setattr(ci, attr, float(val))
                else:
                    setattr(ci, attr, val)
            except ValueError:
                continue
        # Populate FOV from first valid LDV point
        if self._ldv:
            sample = next(iter(self._ldv.values()))
            ci.chh_deg = sample.chh_deg
            ci.chv_deg = sample.chv_deg
        self._cam = ci
        log.info(
            "MultiCsv CameraInfo: %dx%d  %.1f fps  CHH=%.1f deg",
            ci.width,
            ci.height,
            ci.fps,
            ci.chh_deg,
        )

    ####
    # MetadataReaderBase  -  public interface
    ####

    def get_ldv_series(self) -> dict[int, tuple[float, float, float]]:
        """
        Returns {frame_idx: (az_deg, el_deg, roulis_deg)}.

        frame_idx  is sequential (0 = first frame chronologically).
        roulis_deg comes from POINTAGECAM:Roll (en degrés dans le CSV MultiCsv).
        """
        ordered = sorted(self._blockid_map.items(), key=lambda kv: kv[1])
        result: dict[int, tuple[float, float, float]] = {}
        for frame_idx, (block_id, _) in enumerate(ordered):
            pt = self._ldv.get(block_id)
            if pt is not None:
                result[frame_idx] = (pt.az_deg, pt.el_deg, pt.roll)
        return result

    def get_camera_info(self) -> dict:
        """Returns {fps, width, height, chh_deg, chv_deg}."""
        if self._cam is None:
            return {"fps": 0.0, "width": 0, "height": 0, "chh_deg": 0.0, "chv_deg": 0.0}
        ci = self._cam
        return {
            "fps": ci.fps,
            "width": ci.width,
            "height": ci.height,
            "chh_deg": ci.chh_deg,
            "chv_deg": ci.chv_deg,
        }
