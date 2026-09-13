#!/usr/bin/env python3
##########################################
# Project  : VisionNexus
# File     : test_stream.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Quick smoke-test for the MJPEG server - streams synthetic colour frames in a loop.
##########################################

import sys
import time

import cv2
import numpy as np

sys.path.insert(0, ".")
from utils.stream_server import MJPEGServer

server = MJPEGServer(host="0.0.0.0", port=8080, quality=70)
server.start()

colors = [
    (50, 50, 220, "ROUGE"),
    (50, 220, 50, "VERT"),
    (220, 50, 50, "BLEU"),
    (220, 220, 50, "CYAN"),
]

print("Stream actif. Ctrl+C pour arrêter.")
frame_idx = 0
try:
    while True:
        c, label = colors[frame_idx % len(colors)][:3], colors[frame_idx % len(colors)][3]
        img = np.full((480, 640, 3), c, dtype=np.uint8)
        cv2.putText(
            img, "VisionNexus MJPEG TEST", (80, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (255, 255, 255), 3
        )
        cv2.putText(
            img,
            f"Frame {frame_idx:05d} - {label}",
            (120, 280),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (255, 255, 255),
            2,
        )
        cv2.putText(
            img,
            "http://192.168.100.10:8080/",
            (100, 360),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (200, 200, 200),
            2,
        )
        server.push(img)
        frame_idx += 1
        time.sleep(0.033)  # ~30 fps
except KeyboardInterrupt:
    print("\nArrêt.")
    server.stop()
