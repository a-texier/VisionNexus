##########################################
# Project  : VisionNexus
# File     : metadata_base.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Abstract base class for camera metadata readers (LDV series + camera info).
##########################################

from abc import ABC, abstractmethod


class MetadataReaderBase(ABC):
    """
    Interface all camera metadata readers must implement.

    Subclass this in  data/cameras/<camera_name>/metadata_reader.py.
    The pipeline only ever calls the two methods below - everything
    camera-specific (CSV column names, binary headers, bus protocols, ...)
    stays inside the subclass.
    """

    @abstractmethod
    def get_ldv_series(self) -> dict[int, tuple[float, float, float]]:
        """
        Returns {frame_idx: (az_deg, el_deg, roulis_deg)}.

        frame_idx  : sequential integer, 0 = first frame in the sequence.
        az_deg     : azimuth   in degrees (pan).
        el_deg     : elevation in degrees (tilt / site).
        roulis_deg : roll      in degrees. 0.0 if not available for this camera.

        Only frames with valid LDV data appear in the dict.
        Missing frames simply have no entry (LDV defaults to None in loader).
        """

    @abstractmethod
    def get_camera_info(self) -> dict:
        """
        Returns a dict with at least the keys: fps, width, height, chh_deg.

        "chv_deg" is optional; return 0.0 when unavailable (not used by the pipeline).
        width/height may be 0 - the loader auto-fills them from the first decoded frame.
        fps may be 0.0 - the loader falls back to the YAML fps value.
        """
