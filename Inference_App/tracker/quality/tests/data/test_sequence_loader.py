"""
Tests unitaires pour data/sequence_loader.py.

SequenceLoader enveloppe ImageReader (mode dossier). Tous les tests qui
créent des images PNG utilisent pytest.importorskip("cv2") pour être
ignorés gracieusement si cv2 n'est pas disponible.
"""

import numpy as np
import pytest

from data.rejeu.sequence_loader import SequenceLoader


###### Fixture : dossier de 5 PNG synthétiques 100×80 ##########################


@pytest.fixture
def png_folder(tmp_path):
    cv2 = pytest.importorskip("cv2")
    folder = tmp_path / "frames"
    folder.mkdir()
    for i in range(5):
        img = np.zeros((80, 100), dtype=np.uint8)
        img[i * 10 : i * 10 + 5, :] = i * 40  # pattern distinct par frame
        cv2.imwrite(str(folder / f"frame_{i:04d}.png"), img)
    return folder


###### Longueur / start / stop ##################################################


def test_len_default(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    assert len(sl) == 5
    sl.close()


def test_len_with_stop(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"stop_frame_idx": 3})
    assert len(sl) == 3
    sl.close()


def test_len_with_start(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"start_frame_idx": 2})
    assert len(sl) == 3  # frames 2, 3, 4
    sl.close()


def test_len_start_stop(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"start_frame_idx": 1, "stop_frame_idx": 3})
    assert len(sl) == 2  # frames 1 et 2
    sl.close()


def test_len_stop_clamps_to_n(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"stop_frame_idx": 100})
    assert len(sl) == 5
    sl.close()


def test_len_start_after_end_is_zero(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"start_frame_idx": 5})
    assert len(sl) == 0
    sl.close()


###### FPS ###########################################


def test_fps_from_config(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"fps": 25.0})
    assert sl.get_fps() == pytest.approx(25.0)
    sl.close()


def test_fps_default_when_not_in_config(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    assert sl.get_fps() > 0.0  # valeur par défaut (10.0)
    sl.close()


###### Résolution #####################################


def test_resolution_matches_images(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    w, h = sl.get_resolution()
    assert w == 100 and h == 80
    sl.close()


###### Itération #####################################


def test_iteration_yields_correct_count(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    frames = list(sl)
    assert len(frames) == 5
    sl.close()


def test_iteration_yields_tuple3(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    item = next(iter(sl))
    assert len(item) == 3
    sl.close()


def test_iteration_first_frame_index_zero(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    idx, frame, meta = next(iter(sl))
    assert idx == 0
    sl.close()


def test_iteration_frame_is_ndarray(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    _, frame, _ = next(iter(sl))
    assert isinstance(frame, np.ndarray)
    sl.close()


def test_iteration_meta_has_ldv_key(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    _, _, meta = next(iter(sl))
    assert "ldv" in meta
    sl.close()


def test_iteration_indices_in_order(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    idxs = [idx for idx, _, _ in sl]
    assert idxs == list(range(5))
    sl.close()


def test_iteration_start_stop_indices(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"start_frame_idx": 2, "stop_frame_idx": 4})
    idxs = [idx for idx, _, _ in sl]
    assert idxs == [2, 3]
    sl.close()


def test_iteration_empty_when_start_equals_stop(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {"start_frame_idx": 2, "stop_frame_idx": 2})
    assert list(sl) == []
    sl.close()


###### close ##########################################


def test_close_does_not_raise(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    sl.close()  # ne doit pas lever


def test_close_twice_is_safe(png_folder):
    pytest.importorskip("cv2")
    sl = SequenceLoader(str(png_folder), {})
    sl.close()
    sl.close()  # double close → silencieux


###### Dossier vide ##################################


def test_empty_folder_raises(tmp_path):
    pytest.importorskip("cv2")
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises((FileNotFoundError, ImportError, OSError)):
        SequenceLoader(str(empty), {})
