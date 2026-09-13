##########################################
# Project  : VisionNexus
# File     : utils/metrics/__init__.py
# Author   : VisionNexus contributors
# Obj  : Public API of the metrics package (computation + plot generation).
##########################################

from utils.metrics.core import (
    compact_metrics,
    compute_mot_metrics,
    dump_benchmark_json,
    iou,
    relabel_metrics_at_iou,
)
from utils.metrics.dashboard import (
    generate_metrics_dashboard_html,
    generate_metrics_plots,
)

__all__ = [
    "iou",
    "compute_mot_metrics",
    "relabel_metrics_at_iou",
    "compact_metrics",
    "dump_benchmark_json",
    "generate_metrics_plots",
    "generate_metrics_dashboard_html",
]
