from pathlib import Path

import cv2
import numpy as np

from backend.inference_core.media import inspect_media, iter_frames, media_files


def test_image_and_directory_reader(tmp_path: Path):
    image = np.full((30, 50, 3), 120, dtype=np.uint8)
    assert cv2.imwrite(str(tmp_path / "b.jpg"), image)
    assert cv2.imwrite(str(tmp_path / "a.png"), image)
    files = media_files(tmp_path)
    assert [path.name for path in files] == ["a.png", "b.jpg"]
    info = inspect_media(tmp_path)
    assert (info.kind, info.width, info.height, info.frames) == ("images", 50, 30, 2)
    assert len(list(iter_frames(tmp_path))) == 2


def test_unknown_extension_is_rejected(tmp_path: Path):
    source = tmp_path / "sample.xyz"
    source.write_text("x", encoding="utf-8")
    try:
        media_files(source)
    except ValueError as exc:
        assert "format non pris en charge" in str(exc)
    else:
        raise AssertionError("ValueError attendu")

