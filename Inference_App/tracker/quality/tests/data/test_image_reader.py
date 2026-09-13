"""
Tests unitaires pour data/image_reader.py.

ImageReader supporte 3 modes :
  - optional_format    : nécessite optional_format_adapter (ignoré si absent)
  - vidéo  : nécessite cv2 + fichier valide
  - dossier: nécessite cv2 + images lisibles

On teste :
  - Les erreurs de chemin (FileNotFoundError, ValueError) → sans dépendances lourdes
  - Les extensions non reconnues → sans dépendances lourdes
  - La lecture d'un dossier PNG synthétique → nécessite cv2
  - L'API publique (len, __getitem__, mode, resolution, fps) → avec images synthétiques
"""

import numpy as np
import pytest

from data.rejeu.image_reader import ImageReader

###### Erreurs de chemin -  sans cv2 ############################################


class TestImageReaderErrors:
    def test_path_not_found_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            ImageReader(tmp_path / "inexistant.optional")

    def test_unsupported_extension_raises(self, tmp_path):
        f = tmp_path / "fichier.xyz"
        f.write_bytes(b"garbage")
        with pytest.raises(ValueError, match="non reconnu"):
            ImageReader(f)

    def test_empty_folder_raises(self, tmp_path):
        empty = tmp_path / "vide"
        empty.mkdir()
        # Sans images, ImageReader doit lever FileNotFoundError ou ImportError (cv2 absent)
        with pytest.raises((FileNotFoundError, ImportError)):
            ImageReader(empty)

    def test_invalid_mp4_raises(self, tmp_path):
        cv2 = pytest.importorskip("cv2")
        fake = tmp_path / "fake.mp4"
        fake.write_bytes(b"\x00" * 200)
        with pytest.raises((IOError, OSError)):
            ImageReader(fake)


###### Mode dossier avec images PNG synthétiques -  nécessite cv2 ###############


@pytest.fixture
def png_folder(tmp_path):
    """Crée un dossier avec 5 images PNG uint8 640×512 (noir)."""
    cv2 = pytest.importorskip("cv2")
    folder = tmp_path / "frames"
    folder.mkdir()
    for i in range(5):
        img = np.zeros((512, 640), dtype=np.uint8)
        # Mettre une valeur différente par frame pour pouvoir les distinguer
        img[0, 0] = i * 10
        cv2.imwrite(str(folder / f"frame_{i:04d}.png"), img)
    return folder


class TestImageReaderFolder:
    def test_mode_is_folder(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        assert reader.mode == "folder"

    def test_len_correct(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        assert len(reader) == 5

    def test_resolution(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        w, h = reader.resolution
        assert w == 640
        assert h == 512

    def test_fps_is_zero(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        assert reader.fps == pytest.approx(0.0)

    def test_getitem_returns_ndarray(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        frame = reader[0]
        assert isinstance(frame, np.ndarray)
        assert frame.shape[:2] == (512, 640)

    def test_getitem_all_frames(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        for i in range(len(reader)):
            frame = reader[i]
            assert frame is not None

    def test_getitem_out_of_range(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        with pytest.raises(IndexError):
            _ = reader[10]

    def test_getitem_negative_index(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        with pytest.raises(IndexError):
            _ = reader[-1]

    def test_close_is_safe(self, png_folder):
        pytest.importorskip("cv2")
        reader = ImageReader(png_folder)
        reader.close()  # mode folder : pas de VideoCapture → ne doit pas lever
        reader.close()  # double close → toujours silencieux


###### Dossier avec formats mixtes -  seuls les PNG/JPG sont lus ################


def test_folder_ignores_non_image_files(tmp_path):
    cv2 = pytest.importorskip("cv2")
    folder = tmp_path / "mix"
    folder.mkdir()
    # Créer 3 PNG valides
    for i in range(3):
        img = np.zeros((64, 64), dtype=np.uint8)
        cv2.imwrite(str(folder / f"img_{i}.png"), img)
    # Ajouter un fichier texte (doit être ignoré)
    (folder / "notes.txt").write_text("ignore me")
    (folder / "data.csv").write_text("1,2,3")

    reader = ImageReader(folder)
    assert len(reader) == 3
