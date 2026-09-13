##########################################
# Project  : VisionNexus
# File     : __init__.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Detector package - re-exports all MOT and ROI detector classes.
##########################################

from pipeline.detector.detector_mot import (
    # Aliases backward-compat
    BaseDetector,
    # Classes MOT
    BaseDetectorMOT,
    # Type alias
    Detection,
    DummyDetector,
    DummyDetectorMOT,
    NoneDetectorMOT,
    TopHatDetectorMOT,
    YOLODetector,
    YOLODetectorMOT,
    # Helpers partages
    _to_uint8_gray,
    _tophat_blobs,
)
from pipeline.detector.detector_roi import (
    BaseDetectorROI,
    NoneDetectorROI,
    TopHatROIDetector,
)

__all__ = [
    # helpers
    "_to_uint8_gray",
    "_tophat_blobs",
    # MOT
    "BaseDetectorMOT",
    "NoneDetectorMOT",
    "DummyDetectorMOT",
    "YOLODetectorMOT",
    "TopHatDetectorMOT",
    # ROI
    "BaseDetectorROI",
    "NoneDetectorROI",
    "TopHatROIDetector",
    # backward compat
    "BaseDetector",
    "DummyDetector",
    "YOLODetector",
    "Detection",
]
