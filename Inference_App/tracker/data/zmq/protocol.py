##########################################
# Project  : VisionNexus
# File     : protocol.py
# Author   : VisionNexus contributors
# Obj  : Generic ZMQ JSON+JPEG wire protocol shared with tools/zmq_cpp.
#        Mirrors tools/zmq_cpp/json_utils.hpp (meta, boxes) and args.hpp (ports).
#        No binary struct, no port auto-discovery: host/ports must match on
#        both ends (see zmq_port/zmq_anno_port/zmq_click_port in the YAML and
#        --port/--anno-port/--click-port on the C++ side).
##########################################

import json

# Defauts identiques a tools/zmq_cpp/args.hpp
DEFAULT_FRAME_PORT = 5555
DEFAULT_ANNO_PORT = 5556
DEFAULT_CLICK_PORT = 5557

RAD_TO_DEG = 180.0 / 3.141592653589793


def parse_meta(meta_raw: bytes) -> dict:
    """Decode le message meta JSON (1ere partie du multipart frame).

    Format envoye par tools/zmq_cpp (voir json_utils.hpp::make_meta_json) :
      {"az": <radians>, "el": <radians>, "chh": <degres, FOV horizontal>, "frame_id": <int>}
    """
    return json.loads(meta_raw)


def build_annotation(frame_id: int, boxes: list[dict]) -> bytes:
    """Encode le message d'annotations envoye vers tools/zmq_cpp.

    boxes: liste de {"x1","y1","x2","y2","b","g","r","label"} (voir
    json_utils.hpp::parse_boxes et display.hpp::poll qui dessinent ces champs).
    """
    payload = {"frame_id": int(frame_id), "boxes": boxes}
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def parse_click(click_raw: bytes) -> dict:
    """Decode un message de clic emis par tools/zmq_cpp (voir display.hpp::on_mouse).

    Format : {"frame_id": <int>, "type": "left"|"right"|"scroll", "x": <int>, "y": <int>}
    """
    return json.loads(click_raw)
