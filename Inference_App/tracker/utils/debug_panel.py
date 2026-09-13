##########################################
# Project  : VisionNexus
# File     : debug_panel.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Terminal-style log panel rendered as a sidebar image when debug overlay is active.
##########################################

from __future__ import annotations

import logging
import threading
from collections import deque

import numpy as np

####
# Log capture handler
####


class _LogCapture(logging.Handler):
    """
    Thread-safe logging.Handler that keeps the *max_lines* most recent records.
    Attach to the root logger via logging.getLogger().addHandler(handler).
    """

    _FMT = logging.Formatter(
        fmt="%(levelname).1s %(name)-20s %(message)s",
        datefmt="%H:%M:%S",
    )

    def __init__(self, max_lines: int = 80):
        super().__init__(level=logging.DEBUG)
        self._records: deque = deque(maxlen=max_lines)
        self._lock = threading.Lock()
        self.setFormatter(self._FMT)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            with self._lock:
                self._records.append((record.levelno, msg))
        except Exception:
            self.handleError(record)

    def get_lines(self) -> list:
        """Return a snapshot of (levelno, message) pairs (oldest first)."""
        with self._lock:
            return list(self._records)


####
# Panel renderer
####


class LogPanel:
    """
    Renders recent log records as a dark terminal-style BGR panel.

    Parameters
    ########
    width     : panel width in pixels (default 400)
    max_lines : maximum number of log records to retain (default 80)
    """

    # BGR colours
    _C_BG = (18, 18, 18)
    _C_TITLE_BG = (35, 35, 35)
    _C_SEP = (60, 60, 60)
    _C_TITLE = (140, 220, 140)  # muted green

    _C_DEBUG = (80, 80, 80)
    _C_INFO = (210, 210, 210)
    _C_WARNING = (40, 180, 255)  # orange
    _C_ERROR = (60, 60, 230)  # red
    _C_CRIT = (0, 0, 255)  # bright red

    _TITLE_H = 18  # pixels
    _LINE_H = 13  # pixels per log line
    _FONT = None  # resolved lazily from cv2
    _FSCALE = 0.30
    _THICK = 1

    def __init__(self, width: int = 400, max_lines: int = 80):
        self._width = width
        self.handler = _LogCapture(max_lines=max_lines)

    ####

    def _level_color(self, levelno: int):
        if levelno >= logging.CRITICAL:
            return self._C_CRIT
        if levelno >= logging.ERROR:
            return self._C_ERROR
        if levelno >= logging.WARNING:
            return self._C_WARNING
        if levelno >= logging.INFO:
            return self._C_INFO
        return self._C_DEBUG

    def render(self, height: int) -> np.ndarray:
        """
        Build and return a (height, width, 3) BGR uint8 panel.

        Shows the most recent lines that fit in the panel's height.
        Each WARNING/ERROR line is coloured accordingly.
        """
        import cv2

        font = cv2.FONT_HERSHEY_SIMPLEX

        panel = np.full((height, self._width, 3), self._C_BG, dtype=np.uint8)

        #### Title bar
        cv2.rectangle(
            panel,
            (0, 0),
            (self._width - 1, self._TITLE_H - 1),
            self._C_TITLE_BG,
            -1,
        )
        cv2.putText(
            panel,
            "  LOG PANEL  [debug]",
            (4, self._TITLE_H - 5),
            font,
            0.38,
            self._C_TITLE,
            1,
            cv2.LINE_AA,
        )
        cv2.line(
            panel,
            (0, self._TITLE_H),
            (self._width - 1, self._TITLE_H),
            self._C_SEP,
            1,
        )

        #### Log lines
        body_h = height - self._TITLE_H - 2
        n_fit = max(0, body_h // self._LINE_H)
        lines = self.handler.get_lines()
        visible = lines[-n_fit:] if n_fit else []

        # Approximate max chars that fit (≈5 px per char at scale 0.30)
        max_chars = max(1, (self._width - 6) // 5)

        for i, (levelno, msg) in enumerate(visible):
            y = self._TITLE_H + (i + 1) * self._LINE_H
            if y >= height:
                break
            if len(msg) > max_chars:
                msg = msg[: max_chars - 1] + "~"
            cv2.putText(
                panel,
                msg,
                (4, y),
                font,
                self._FSCALE,
                self._level_color(levelno),
                self._THICK,
                cv2.LINE_AA,
            )

        return panel
