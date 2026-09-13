"""
trackers/sot/csrt/tracker.py
------------------------------
SOT based on OpenCV CSRT (Discriminative Correlation Filter with Channel and
Spatial Reliability). CPU-only, 0 VRAM, bundled with OpenCV-contrib.

Bug fix (2025)
--------------
Some OpenCV Python builds return None instead of True from Tracker.init().
The fix: treat the absence of an explicit False (or exception) as success.
Additionally, calling update() on the same frame as init() is unreliable
with CSRT. The first update() call returns the init bbox directly without
querying the underlying tracker.

Cycle per frame:
  1. tracker.update(frame_i) -> roi in frame_i coordinates.
  2. PSR check + min-size filter.
  3. kf.update(cx, cy)   (if Kalman enabled).

H is accepted but used only by the Kalman camera_update (kinematics).
No frame-warp CMC: OpenCV TrackerCSRT exposes no API to shift the internal
search window without a full reinit (which resets the DCF template).

Kalman (optional)
------------------
Set kf_process_noise: null OR kf_measure_noise: null in the YAML to disable
the Kalman entirely. When disabled, no camera_update/predict/update is called.
When enabled, the Kalman tracks target kinematics (future fallback bbox).
It does NOT influence the output bbox in the current implementation.

Hyperparameters (YAML section: csrt)
--------------------------------------
psr_threshold      : float (default 6.0)
    PSR score under this threshold -> target lost -> [KO].
    getScore() is not exposed in all OpenCV Python builds; if unavailable
    the call is silently caught and PSR check is skipped (logged as N/A).

min_width_px       : int   (default 8)
min_height_px      : int   (default 8)
    Minimum accepted CSRT bbox size. Below -> [KO].

kf_process_noise   : float or null (default from sot_kalman:)
kf_measure_noise   : float or null (default from sot_kalman:)
    If either is null, the Kalman is fully disabled.
    Override possible directly in csrt: to differ from Tracking_TOPHAT.

fallback_bbox_size_px : int (default 40)
    Side (px) of the fallback square when no MOT track is near the click.

--- Internal OpenCV parameters (TrackerCSRT_Params) ---

padding            : float (default 3.0)
filter_lr          : float (default 0.02)
admm_iterations    : int   (default 4)
number_of_scales   : int   (default 33)
scale_step         : float (default 1.05)
template_size      : int   (default 200)
use_channel_weights: bool  (default True)
use_segmentation   : bool  (default False)

Unified top-level parameter:
sot_click_max_dist_px : float (default 0.0 = no filter)

Section debug_tracking (YAML):
    csrt_patch_save        : bool
    csrt_patch_interval    : int
    csrt_log_psr           : bool
    csrt_kalman_box_visu   : bool
    csrt_kalman_video_fps  : float
    csrt_kalman_video_name : str
"""

import logging
import math
import os

import cv2
import numpy as np

from trackers.mot.custom_kalman.kalman_filter import KalmanFilter2D

log = logging.getLogger(__name__)


def _warp_shift(H: np.ndarray, cx: float, cy: float) -> float:
    """Return pixel displacement of point (cx, cy) under homography H."""
    denom = H[2, 0] * cx + H[2, 1] * cy + H[2, 2]
    if abs(denom) < 1e-8:
        return 0.0
    cx_w = (H[0, 0] * cx + H[0, 1] * cy + H[0, 2]) / denom
    cy_w = (H[1, 0] * cx + H[1, 1] * cy + H[1, 2]) / denom
    return math.hypot(cx_w - cx, cy_w - cy)


class CsrtSot:
    """
    OpenCV CSRT tracker with optional Kalman 2D.

    H is accepted each frame and used only by the Kalman camera_update.
    No frame-warp CMC: OpenCV TrackerCSRT exposes no API to shift the
    internal search window without a full reinit (which resets the DCF
    template).
    """

    def __init__(self):
        self._tracker = None
        self._initialized: bool = False
        self._init_bbox = None
        self._skip_first_update: bool = False

        self._psr_threshold: float = 6.0
        self._near_thresh_px: float = float("inf")
        self._min_width_px: int = 8
        self._min_height_px: int = 8
        self._fallback_bbox_size_px: int = 40


        # Kalman (optional -- None values mean disabled)
        self._kf = None
        self._kf_process_noise = None
        self._kf_measure_noise = None
        self._last_cx: float | None = None
        self._last_cy: float | None = None
        self._last_w: float = 40.0
        self._last_h: float = 40.0

        # OpenCV internal parameters
        self._cv_padding: float = 3.0
        self._cv_filter_lr: float = 0.02
        self._cv_admm_iterations: int = 4
        self._cv_number_of_scales: int = 33
        self._cv_scale_step: float = 1.05
        self._cv_template_size: int = 200
        self._cv_use_channel_weights: bool = True
        self._cv_use_segmentation: bool = False

        # Debug
        self._debug_dir: str = ""
        self._debug_patch_save: bool = False
        self._debug_patch_interval: int = 10
        self._debug_log_psr: bool = True
        self._debug_frame_count: int = 0
        self._debug_cfg = None
        self._debug_kalman_visu: bool = False
        self._debug_kalman_video_fps: float = 25.0
        self._debug_kalman_video_name: str = "csrt_kalman_debug.mp4"
        self._debug_kalman_writer = None

    def configure(self, cfg: dict) -> None:
        """
        Load hyperparameters from config dict.

        Reads csrt:, sot_kalman:, debug_tracking:, render:, _debug_dir.

        If kf_process_noise or kf_measure_noise is null in YAML, Kalman
        is fully disabled (no overhead at runtime).
        """
        csrt_cfg = cfg.get("csrt", {})
        sot_kf = cfg.get("sot_kalman", {})

        self._psr_threshold = float(csrt_cfg.get("psr_threshold", 6.0))
        self._min_width_px = int(csrt_cfg.get("min_width_px", 8))
        self._min_height_px = int(csrt_cfg.get("min_height_px", 8))
        self._fallback_bbox_size_px = int(csrt_cfg.get("fallback_bbox_size_px", 40))

        # Kalman: raw values may be None from YAML null
        _pn = csrt_cfg.get("kf_process_noise", sot_kf.get("kf_process_noise", 10.0))
        _mn = csrt_cfg.get("kf_measure_noise", sot_kf.get("kf_measure_noise", 5.0))
        if _pn is None or _mn is None:
            self._kf_process_noise = None
            self._kf_measure_noise = None
        else:
            self._kf_process_noise = float(_pn)
            self._kf_measure_noise = float(_mn)

        # OpenCV internal parameters
        self._cv_padding = float(csrt_cfg.get("padding", 3.0))
        self._cv_filter_lr = float(csrt_cfg.get("filter_lr", 0.02))
        self._cv_admm_iterations = int(csrt_cfg.get("admm_iterations", 4))
        self._cv_number_of_scales = int(csrt_cfg.get("number_of_scales", 33))
        self._cv_scale_step = float(csrt_cfg.get("scale_step", 1.05))
        self._cv_template_size = int(csrt_cfg.get("template_size", 200))
        self._cv_use_channel_weights = bool(csrt_cfg.get("use_channel_weights", True))
        self._cv_use_segmentation = bool(csrt_cfg.get("use_segmentation", False))

        sot_dist = float(cfg.get("sot_click_max_dist_px", 0.0))
        self._near_thresh_px = float("inf") if sot_dist <= 0 else sot_dist

        from utils.visu_algo_debug import AlgoDebugConfig

        self._debug_dir = str(cfg.get("_debug_dir", "outputs/debug_tracking"))
        dbg_cfg = cfg.get("debug_tracking", {})
        _light = bool(cfg.get("light_render", False))

        self._debug_patch_save = False if _light else bool(
            dbg_cfg.get("csrt_patch_save", False)
        )
        self._debug_patch_interval = int(dbg_cfg.get("csrt_patch_interval", 10))
        self._debug_log_psr = False if _light else bool(
            dbg_cfg.get("csrt_log_psr", True)
        )
        self._debug_kalman_visu = False if _light else bool(
            dbg_cfg.get("csrt_kalman_box_visu", False)
        )
        self._debug_kalman_video_fps = float(dbg_cfg.get("csrt_kalman_video_fps", 25.0))
        self._debug_kalman_video_name = str(
            dbg_cfg.get("csrt_kalman_video_name", "csrt_kalman_debug.mp4")
        )
        self._debug_cfg = AlgoDebugConfig(cfg, self._debug_dir)
        self._debug_kalman_writer = None

        _kf_str = (
            f"pn={self._kf_process_noise} mn={self._kf_measure_noise}"
            if self._kf_process_noise is not None
            else "DISABLED"
        )
        log.debug(
            "CsrtSot.configure: psr=%.1f  min_bbox=%dx%d  near=%s"
            "  kalman=%s"
            "  cv_pad=%.1f  cv_lr=%.3f  cv_admm=%d  cv_scales=%d"
            "  cv_step=%.3f  cv_tmpl=%d  cv_chan_w=%s  cv_seg=%s"
            "  patch_save=%s  log_psr=%s  kalman_visu=%s",
            self._psr_threshold,
            self._min_width_px,
            self._min_height_px,
            "inf" if self._near_thresh_px == float("inf")
            else f"{self._near_thresh_px:.0f}px",
            _kf_str,
            self._cv_padding,
            self._cv_filter_lr,
            self._cv_admm_iterations,
            self._cv_number_of_scales,
            self._cv_scale_step,
            self._cv_template_size,
            self._cv_use_channel_weights,
            self._cv_use_segmentation,
            self._debug_patch_save,
            self._debug_log_psr,
            self._debug_kalman_visu,
        )

    def _make_tracker(self):
        params = cv2.TrackerCSRT_Params()
        params.padding = self._cv_padding
        params.filter_lr = self._cv_filter_lr
        params.admm_iterations = self._cv_admm_iterations
        params.number_of_scales = self._cv_number_of_scales
        params.scale_step = self._cv_scale_step
        params.template_size = self._cv_template_size
        params.use_channel_weights = self._cv_use_channel_weights
        params.use_segmentation = self._cv_use_segmentation
        return cv2.TrackerCSRT_create(params)

    def init(self, frame: np.ndarray, click_pos: tuple, mot_tracks=None) -> None:
        """
        Initialize CSRT and optional Kalman on the best available bbox.

        Priority:
          1. MOT track whose bbox contains the click (exact hit)
          2. Nearest MOT track within near_thresh_px
          3. fallback_bbox_size_px square centered on click
        """
        cx, cy = click_pos

        bbox, source = self._find_bbox(cx, cy, mot_tracks)
        if bbox is None:
            size = self._fallback_bbox_size_px
            h_f, w_f = frame.shape[:2]
            x1 = max(0, int(cx) - size // 2)
            y1 = max(0, int(cy) - size // 2)
            x2 = min(w_f, x1 + size)
            y2 = min(h_f, y1 + size)
            bbox = [x1, y1, x2, y2]
            source = f"fallback {size}x{size}"

        x1, y1, x2, y2 = [int(v) for v in bbox]
        w, h = x2 - x1, y2 - y1

        if w < self._min_width_px or h < self._min_height_px:
            log.error(
                "CsrtSot.init: degenerate bbox [%d,%d,%d,%d] w=%d h=%d -> abort",
                x1, y1, x2, y2, w, h,
            )
            self._initialized = False
            return

        display = self._to_uint8(frame)

        try:
            self._tracker = self._make_tracker()
            ok_raw = self._tracker.init(display, (x1, y1, w, h))
            self._initialized = ok_raw is not False
        except Exception as exc:
            log.error("CsrtSot.init: TrackerCSRT_create/init -> %s", exc)
            self._tracker = None
            self._initialized = False
            return

        cx_init = (x1 + x2) / 2.0
        cy_init = (y1 + y2) / 2.0
        self._last_cx = cx_init
        self._last_cy = cy_init
        self._last_w = float(w)
        self._last_h = float(h)

        # Kalman optional
        if self._kf_process_noise is not None and self._kf_measure_noise is not None:
            self._kf = KalmanFilter2D(
                process_noise=self._kf_process_noise,
                measure_noise=self._kf_measure_noise,
            )
            self._kf.init(cx_init, cy_init)
        else:
            self._kf = None

        self._init_bbox = [x1, y1, x2, y2]
        self._skip_first_update = True
        self._debug_frame_count = 0

        if self._debug_kalman_writer is not None:
            self._debug_kalman_writer.close()
        if self._debug_kalman_visu:
            from utils.visu_algo_debug import CsrtKalmanVideoWriter

            self._debug_kalman_writer = CsrtKalmanVideoWriter(
                self._debug_dir,
                self._debug_kalman_video_fps,
                self._debug_kalman_video_name,
            )
        else:
            self._debug_kalman_writer = None

        log.info(
            "CsrtSot.init: click=(%d,%d)  src=%s  bbox=[%d,%d,%d,%d] (%dx%d)"
            "  kalman=%s  ok=%s",
            int(cx), int(cy), source,
            x1, y1, x2, y2, w, h,
            "on" if self._kf is not None else "off",
            self._initialized,
        )

    def update(
        self,
        frame: np.ndarray,
        mot_tracks=None,
        H: np.ndarray | None = None,
    ):
        """
        Propagate tracking for one frame.

        Cycle:
          1. tracker.update(frame) -> roi in frame coordinates.
          2. Min-size filter + PSR filter.
          3. Kalman update with CSRT center (if enabled).

        Returns
        -------
        (ok, bbox, mask)
          ok   : True on success
          bbox : [x1, y1, x2, y2]
          mask : always None
        """
        if not self._initialized or self._tracker is None:
            log.debug("CsrtSot.update: not initialized -> skip")
            return False, None, None
        # First frame after init: return init bbox directly
        if self._skip_first_update:
            self._skip_first_update = False
            if self._kf is not None:
                if H is not None:
                    self._kf.camera_update(H)
                self._kf.predict()
            log.debug(
                "CsrtSot.update: first frame -> return init_bbox=%s",
                self._init_bbox,
            )
            return True, list(self._init_bbox), None

        self._debug_frame_count += 1

        # Save previous bbox state for debug viz (before any update)
        _prev_cx = self._last_cx
        _prev_cy = self._last_cy
        _prev_w = self._last_w
        _prev_h = self._last_h

        # cam_shift for logging
        cam_shift = 0.0
        if H is not None and self._last_cx is not None:
            cam_shift = _warp_shift(H, self._last_cx, self._last_cy)

        # Kalman predict (optional, for future fallback bbox)
        cx_pred = self._last_cx if self._last_cx is not None else 0.0
        cy_pred = self._last_cy if self._last_cy is not None else 0.0
        if self._kf is not None:
            if H is not None:
                self._kf.camera_update(H)
            kf_state = self._kf.predict()
            cx_pred = float(kf_state[0])
            cy_pred = float(kf_state[1])

        display = self._to_uint8(frame)
        h_f, w_f = frame.shape[:2]

        ok, roi = self._tracker.update(display)

        if not ok:
            _fail_psr = None
            try:
                _fail_psr = float(self._tracker.getScore())
            except Exception:
                pass
            log.info(
                "CsrtSot.update: tracker.update()=False -> target lost"
                "  cam_shift=%.1fpx  PSR=%s",
                cam_shift,
                f"{_fail_psr:.2f}" if _fail_psr is not None else "N/A",
            )
            if self._debug_kalman_writer is not None and _prev_cx is not None:
                _sw = _prev_w * self._cv_padding
                _sh = _prev_h * self._cv_padding
                self._debug_kalman_writer.write(
                    frame, None, cam_shift, _fail_psr,
                    self._debug_frame_count,
                    kf_pred=(cx_pred, cy_pred) if self._kf is not None else None,
                    last_bbox=[
                        int(_prev_cx - _prev_w / 2),
                        int(_prev_cy - _prev_h / 2),
                        int(_prev_cx + _prev_w / 2),
                        int(_prev_cy + _prev_h / 2),
                    ],
                    search_zone=[
                        int(_prev_cx - _sw / 2), int(_prev_cy - _sh / 2),
                        int(_prev_cx + _sw / 2), int(_prev_cy + _sh / 2),
                    ],
                )
            return False, None, None

        x, y, w, h = [int(v) for v in roi]

        if w <= 0 or h <= 0:
            log.info(
                "CsrtSot.update: degenerate roi x=%d y=%d w=%d h=%d -> fail",
                x, y, w, h,
            )
            return False, None, None

        # Clip to frame bounds
        x = max(0, min(x, w_f - 1))
        y = max(0, min(y, h_f - 1))
        w = max(0, min(w, w_f - x))
        h = max(0, min(h, h_f - y))

        # Min-size filter
        if w < self._min_width_px or h < self._min_height_px:
            log.warning(
                "[KO] CsrtSot: bbox too small %dx%d < min %dx%d  "
                "bbox=[%d,%d,%d,%d] -> fail",
                w, h, self._min_width_px, self._min_height_px,
                x, y, x + w, y + h,
            )
            return False, None, None

        # PSR filter
        psr = None
        if self._debug_log_psr or self._psr_threshold > 0:
            try:
                psr = float(self._tracker.getScore())
            except Exception:
                psr = None

        if psr is not None and psr < self._psr_threshold:
            log.warning(
                "[KO] CsrtSot: PSR=%.2f < threshold=%.1f -> target lost"
                "  bbox=[%d,%d,%d,%d]",
                psr, self._psr_threshold, x, y, x + w, y + h,
            )
            return False, None, None

        if psr is not None and log.isEnabledFor(logging.DEBUG):
            log.debug(
                "CsrtSot.update: PSR=%.2f >= threshold=%.1f",
                psr, self._psr_threshold,
            )

        bbox = [x, y, x + w, y + h]
        cx_csrt = x + w / 2.0
        cy_csrt = y + h / 2.0

        if self._kf is not None:
            self._kf.update(cx_csrt, cy_csrt)

        self._last_cx = cx_csrt
        self._last_cy = cy_csrt
        self._last_w = float(w)
        self._last_h = float(h)

        if self._debug_patch_save and self._debug_dir and self._debug_cfg is not None:
            if self._debug_frame_count % self._debug_patch_interval == 0:
                self._save_debug_patch(frame, bbox, self._debug_frame_count)

        if self._debug_kalman_writer is not None:
            # Build debug overlay data from previous state
            if _prev_cx is not None:
                _sw = _prev_w * self._cv_padding
                _sh = _prev_h * self._cv_padding
                _debug_last_bbox = [
                    int(_prev_cx - _prev_w / 2), int(_prev_cy - _prev_h / 2),
                    int(_prev_cx + _prev_w / 2), int(_prev_cy + _prev_h / 2),
                ]
                _debug_search_zone = [
                    int(_prev_cx - _sw / 2), int(_prev_cy - _sh / 2),
                    int(_prev_cx + _sw / 2), int(_prev_cy + _sh / 2),
                ]
            else:
                _debug_last_bbox = None
                _debug_search_zone = None
            _debug_kf_pred = (cx_pred, cy_pred) if self._kf is not None else None
            self._debug_kalman_writer.write(
                frame, bbox, cam_shift, psr, self._debug_frame_count,
                kf_pred=_debug_kf_pred,
                last_bbox=_debug_last_bbox,
                search_zone=_debug_search_zone,
            )

        log.debug(
            "CsrtSot.update: OK  bbox=[%d,%d,%d,%d] %dx%d"
            "  cam_shift=%.1fpx  PSR=%s  kf_pred=(%.0f,%.0f)",
            x, y, x + w, y + h, w, h,
            cam_shift,
            f"{psr:.2f}" if psr is not None else "N/A",
            cx_pred, cy_pred,
        )
        return True, bbox, None

    def reset(self) -> None:
        self._tracker = None
        self._initialized = False
        self._init_bbox = None
        self._skip_first_update = False
        self._kf = None
        self._last_cx = None
        self._last_cy = None
        self._last_w = 40.0
        self._last_h = 40.0
        self._debug_frame_count = 0
        if self._debug_kalman_writer is not None:
            self._debug_kalman_writer.close()
            self._debug_kalman_writer = None
        log.debug("CsrtSot.reset")

    def _find_bbox(self, cx, cy, mot_tracks):
        """
        Return ([x1,y1,x2,y2], source_str) of the best MOT track near (cx, cy).

        Priority:
          1. Track whose bbox contains the click (exact hit)
          2. Nearest track within near_thresh_px
          3. (None, None) -> fallback square
        """
        if not mot_tracks:
            log.debug("CsrtSot._find_bbox: no MOT tracks -> fallback square")
            return None, None

        for trk in mot_tracks:
            x1, y1, x2, y2 = trk.bbox[:4]
            if x1 <= cx <= x2 and y1 <= cy <= y2:
                src = f"hit track_id={trk.track_id}"
                log.debug("CsrtSot._find_bbox: %s", src)
                return [int(x1), int(y1), int(x2), int(y2)], src

        best_trk = None
        best_dist = float("inf")
        for trk in mot_tracks:
            x1, y1, x2, y2 = trk.bbox[:4]
            d = math.hypot((x1 + x2) / 2 - cx, (y1 + y2) / 2 - cy)
            if log.isEnabledFor(logging.DEBUG):
                log.debug(
                    "CsrtSot._find_bbox: track_id=%s  dist=%.1fpx  thresh=%.0fpx  %s",
                    trk.track_id, d, self._near_thresh_px,
                    "IN" if d <= self._near_thresh_px else "OUT",
                )
            if d < best_dist:
                best_dist = d
                best_trk = trk

        if best_trk is not None and best_dist <= self._near_thresh_px:
            src = (
                f"nearest track_id={best_trk.track_id}"
                f" dist={best_dist:.1f}px <= {self._near_thresh_px:.0f}px"
            )
            log.debug("CsrtSot._find_bbox: %s", src)
            return [int(v) for v in best_trk.bbox[:4]], src

        log.info(
            "CsrtSot._find_bbox: nearest=%.1fpx > thresh=%.0fpx -> fallback"
            " (click=(%d,%d))",
            best_dist, self._near_thresh_px, int(cx), int(cy),
        )
        return None, None

    def _save_debug_patch(
        self,
        frame: np.ndarray,
        bbox: list,
        frame_idx: int,
    ) -> None:
        try:
            from utils.visu_algo_debug import save_csrt_patch_debug

            save_path = os.path.join(
                self._debug_dir, f"csrt_patch_f{frame_idx:06d}.png"
            )
            save_csrt_patch_debug(frame, bbox, save_path, self._debug_cfg)
        except Exception as exc:
            log.debug("CsrtSot._save_debug_patch: %s", exc)

    @staticmethod
    def _to_uint8(frame: np.ndarray) -> np.ndarray:
        """Normalize any IR frame dtype to BGR uint8."""
        img = frame.astype(np.float32)
        lo, hi = img.min(), img.max()
        if hi > lo:
            img = (img - lo) / (hi - lo) * 255.0
        img = img.clip(0, 255).astype(np.uint8)
        if img.ndim == 2:
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        return img
