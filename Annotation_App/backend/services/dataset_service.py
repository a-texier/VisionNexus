# ============================================================
# services/dataset_service.py
# Service de gestion des datasets : import d'images et de vidéos,
# génération de miniatures, export au format YOLO avec split train/val/test.
#
# Formats supportés en entrée :
#   - Images : .jpg, .jpeg, .png, .bmp, .tiff, .webp
#   - Vidéos : .mp4, .avi, .mov, .mkv
#   - Dossiers de frames nommées par timestamp UNIX ou YYYYMMDD_HHMMSS_mmm
# ============================================================

import os
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, Generator, List, Optional, Tuple

import cv2
import numpy as np

from backend.utils.color_utils import get_class_color
from backend.utils.image_utils import get_image_dimensions
from backend.utils.yolo_utils import write_data_yaml, write_yolo_label_file, write_yolo_segmentation_label_file

# Extensions d'images acceptées
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


def natural_sort_key(name: str):
    """Clé de tri NATUREL (numérique), identique à l'explorateur Windows
    (StrCmpLogicalW). « frame_2.png » < « frame_10.png » (et non l'inverse du
    tri ASCII). Gère aussi les timestamps UNIX et YYYYMMDD_HHMMSS (les nombres
    y sont comparés numériquement → ordre chronologique correct)."""
    return [
        int(chunk) if chunk.isdigit() else chunk.lower()
        for chunk in re.split(r'(\d+)', name)
    ]

from backend.config import DATA_DIR  # workspace configurable via ANNOTATION_WORKSPACE


class FrameExtractionProgress:
    """Progression de l'extraction des frames d'une vidéo."""
    def __init__(self, current: int, total: int, filename: str):
        self.current = current
        self.total = total
        self.filename = filename
        self.progress = current / total if total > 0 else 0.0


class DatasetService:
    """
    Service principal de gestion des données.
    Gère l'import, l'organisation et l'export des datasets d'annotation.
    """

    def __init__(self):
        self.projects_dir = DATA_DIR / "projects"
        self.exports_dir = DATA_DIR / "exports"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)

    def get_project_dir(self, project_id: int) -> Path:
        """Retourne le répertoire principal d'un projet."""
        return self.projects_dir / str(project_id)

    def get_frames_dir(self, project_id: int) -> Path:
        """Répertoire contenant les frames/images du projet."""
        d = self.get_project_dir(project_id) / "frames"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def get_thumbnails_dir(self, project_id: int) -> Path:
        """Répertoire contenant les miniatures 160×90."""
        d = self.get_project_dir(project_id) / "thumbnails"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def get_frame_path(self, project_id: int, filename: str) -> Path:
        """Retourne le chemin absolu d'une frame."""
        return self.get_frames_dir(project_id) / filename

    def get_thumbnail_path(self, project_id: int, filename: str) -> Path:
        """Retourne le chemin absolu d'une miniature."""
        # Remplace l'extension par .jpg pour la miniature
        thumb_name = Path(filename).stem + "_thumb.jpg"
        return self.get_thumbnails_dir(project_id) / thumb_name

    # --------------------------------------------------------
    # Import d'images
    # --------------------------------------------------------

    def import_images_from_files(
        self,
        project_id: int,
        source_paths: List[str],
        thumbnail_quality: int = 85,
        use_symlink: bool = False,
        pre_sorted: bool = False,
        lazy_thumbnails: bool = True,
        progress_callback: Optional[Callable[[int, int], None]] = None,
        filename_prefix: str = "",
    ) -> List[Dict]:
        """
        Importe une liste de fichiers image dans le projet.
        Les frames sont copiees (ou liees en symlink) sans re-encodage — format d'origine preserve.
        Seules les miniatures sont generees en JPEG.

        Args:
            project_id: ID du projet cible
            source_paths: Chemins des fichiers images sources
            thumbnail_quality: Qualite JPEG des miniatures (50-95)
            use_symlink: Si True, cree des liens symboliques au lieu de copier

        Returns:
            Liste de dicts avec frame_index, filename, width, height, thumbnail_path
        """
        frames_dir = self.get_frames_dir(project_id)
        results = []

        # Filtrage et tri des images valides
        valid_paths = [
            p for p in source_paths
            if Path(p).suffix.lower() in IMAGE_EXTENSIONS
        ]
        if not pre_sorted:
            # Tri NATUREL (comme l'explorateur Windows) et non ASCII : sinon
            # frame_10 passait avant frame_2 → vidéo discontinue.
            valid_paths.sort(key=lambda p: natural_sort_key(Path(p).name))

        for idx, src_path in enumerate(valid_paths):
            src = Path(src_path)
            dest_name = f"{filename_prefix}frame_{idx:06d}{src.suffix.lower()}"
            dest_path = frames_dir / dest_name

            # Copie ou lien symbolique si pas déjà présent
            if not dest_path.exists():
                if use_symlink:
                    try:
                        os.symlink(str(src.resolve()), str(dest_path))
                    except (OSError, PermissionError) as e:
                        print(f"[dataset_service] Symlink echoue ({e}), copie a la place")
                        shutil.copy2(src_path, str(dest_path))
                else:
                    shutil.copy2(src_path, str(dest_path))

            # Dimensions de l'image
            try:
                width, height = get_image_dimensions(str(dest_path))
            except Exception:
                width, height = 640, 480  # Valeurs par défaut en cas d'erreur

            results.append({
                "frame_index": idx,
                "filename": dest_name,
                "width": width,
                "height": height,
                "thumbnail_path": self.get_thumbnail_path(project_id, dest_name).name,
                "timestamp_ms": None,
            })

            if progress_callback:
                progress_callback(idx + 1, len(valid_paths))

        return results

    def import_images_from_folder(
        self,
        project_id: int,
        folder_path: str,
        thumbnail_quality: int = 85,
        use_symlink: bool = False,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> List[Dict]:
        """
        Importe toutes les images d'un dossier, en essayant de détecter
        les timestamps dans les noms de fichiers pour un tri correct.

        Les formats de noms supportés :
        - Timestamp UNIX : "1704067200000.jpg"
        - Datetime : "20240101_120000_000.jpg"
        - Séquentiel : "frame_001.jpg", "img_0042.png"

        Args:
            project_id: ID du projet cible
            folder_path: Chemin du dossier source

        Returns:
            Liste de dicts de métadonnées des frames
        """
        folder = Path(folder_path)
        if not folder.is_dir():
            raise ValueError(f"Dossier introuvable : {folder_path}")

        # Collecte de tous les fichiers image avec leur timestamp estimé
        image_files = []
        for f in folder.iterdir():
            if f.suffix.lower() in IMAGE_EXTENSIONS:
                ts = self._extract_timestamp_from_filename(f.stem)
                image_files.append((ts, f))

        # Tri par timestamp (None en fin de liste pour les noms non-horodatés)
        # Tri NATUREL sur le nom de fichier (parité explorateur Windows). Les
        # noms horodatés (UNIX/datetime) restent chronologiques car leurs nombres
        # sont comparés numériquement. Corrige les vidéos discontinues.
        image_files.sort(key=lambda x: natural_sort_key(x[1].name))

        # Extraction des chemins triés
        sorted_paths = [str(f) for _, f in image_files]
        return self.import_images_from_files(
            project_id, sorted_paths,
            thumbnail_quality=thumbnail_quality,
            use_symlink=use_symlink,
            pre_sorted=True,  # Deja trie par timestamp ci-dessus
            lazy_thumbnails=True,
            progress_callback=progress_callback,
        )

    def iter_import_images_from_folder(
        self,
        project_id: int,
        folder_path: str,
        thumbnail_quality: int = 85,
        use_symlink: bool = False,
        filename_prefix: str = "",
    ):
        """
        Importe un dossier image frame par frame et yield les metadonnees au fil de l'eau.
        Utilise par les gros datasets pour inserer en base par batch sans attendre la fin.
        """
        folder = Path(folder_path)
        if not folder.is_dir():
            raise ValueError(f"Dossier introuvable : {folder_path}")

        image_files = []
        for f in folder.iterdir():
            if f.suffix.lower() in IMAGE_EXTENSIONS:
                ts = self._extract_timestamp_from_filename(f.stem)
                image_files.append((ts, f))
        # Tri NATUREL sur le nom de fichier (parité explorateur Windows). Les
        # noms horodatés (UNIX/datetime) restent chronologiques car leurs nombres
        # sont comparés numériquement. Corrige les vidéos discontinues.
        image_files.sort(key=lambda x: natural_sort_key(x[1].name))

        frames_dir = self.get_frames_dir(project_id)
        for idx, (_, src) in enumerate(image_files):
            dest_name = f"{filename_prefix}frame_{idx:06d}{src.suffix.lower()}"
            dest_path = frames_dir / dest_name

            if not dest_path.exists():
                if use_symlink:
                    try:
                        os.symlink(str(src.resolve()), str(dest_path))
                    except (OSError, PermissionError) as e:
                        print(f"[dataset_service] Symlink echoue ({e}), copie a la place")
                        shutil.copy2(str(src), str(dest_path))
                else:
                    shutil.copy2(str(src), str(dest_path))

            try:
                width, height = get_image_dimensions(str(dest_path))
            except Exception:
                width, height = 640, 480

            thumb_path = self.get_thumbnail_path(project_id, dest_name)

            yield {
                "frame_index": idx,
                "filename": dest_name,
                "width": width,
                "height": height,
                "thumbnail_path": thumb_path.name,
                "timestamp_ms": None,
            }

    def _extract_timestamp_from_filename(self, stem: str) -> Optional[int]:
        """
        Extrait un timestamp en millisecondes depuis le nom de fichier.

        Formats supportés :
        - Timestamp UNIX pur : "1704067200000" (13 chiffres)
        - Datetime compact : "20240101_120000_000"
        - Datetime ISO-like : "2024-01-01_12-00-00-000"

        Retourne None si aucun pattern reconnu.
        """
        # Pattern frame_{id}_{anything} — séquence vidéo nommée par frame_id numérique
        # Exemple : "frame_0_1970-01-01T01_14_25" → 0  |  "frame_1000_..." → 1000
        match = re.match(r'^frame_(\d+)(?:_|$)', stem)
        if match:
            return int(match.group(1))

        # Pattern timestamp UNIX (13 chiffres = millisecondes)
        if re.fullmatch(r'\d{13}', stem):
            return int(stem)

        # Pattern UNIX secondes (10 chiffres)
        if re.fullmatch(r'\d{10}', stem):
            return int(stem) * 1000

        # Pattern YYYYMMDD_HHMMSS_mmm
        match = re.search(r'(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{3})', stem)
        if match:
            year, month, day, hour, minute, second, ms = match.groups()
            try:
                dt = datetime(int(year), int(month), int(day),
                              int(hour), int(minute), int(second))
                return int(dt.timestamp() * 1000) + int(ms)
            except ValueError:
                pass

        return None

    # --------------------------------------------------------
    # Extraction de frames vidéo
    # --------------------------------------------------------

    def extract_video_frames(
        self,
        project_id: int,
        video_path: str,
        target_fps: Optional[float] = None,
        max_frames: int = 10000,
        jpeg_quality: int = 85,
    ) -> Generator[FrameExtractionProgress, None, None]:
        """
        Extrait les frames d'une vidéo avec OpenCV et génère les miniatures.
        Traite une frame à la fois (mémoire O(1) — jamais la vidéo entière en RAM).

        Paramètres mémoire/qualité :
            target_fps     : FPS cible d'extraction (None = toutes les frames).
                             Ex: 1.0 → 1 frame/s, réduit drastiquement le nombre de frames.
            max_frames     : Plafond absolu de frames extraites (défaut 10000).
            jpeg_quality   : Qualité JPEG des frames extraites (50–95, défaut 85).
                             85 = bon compromis qualité/taille disque.
                             50 = petit fichier (utile pour datasets légers).
                             95 = haute fidélité (détails fins).

        Architecture mémoire :
            - cv2.VideoCapture décode une frame à la fois (pas de buffer interne).
            - La frame numpy (H×W×3 uint8) est écrite sur disque en JPEG immédiatement.
            - La RAM utilisée = 1 frame décodée = largeur × hauteur × 3 octets.
              (1080p → ~6 MB, 4K → ~25 MB, libérée à chaque itération)
            - Le fichier vidéo source lui-même n'est pas chargé en mémoire ;
              OpenCV utilise un handle de fichier + buffer de décodage interne.

        Args:
            project_id : ID du projet cible
            video_path : Chemin du fichier vidéo source (déjà sur disque)
            target_fps : FPS cible (None = toutes les frames)
            max_frames : Nombre maximum de frames à extraire
            jpeg_quality : Qualité d'encodage JPEG (50–95)

        Yields:
            FrameExtractionProgress avec progression et nom de fichier
        """
        frames_dir = self.get_frames_dir(project_id)

        # Ouverture de la vidéo avec OpenCV (pas besoin de ffprobe)
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Impossible d'ouvrir la video : {video_path}")

        # Métadonnées via OpenCV — pas de dépendance ffprobe
        source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_frames_cv = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        total_frames_approx = total_frames_cv if total_frames_cv > 0 else 0

        # Calcul du pas de frames selon le FPS cible
        if target_fps and target_fps < source_fps:
            frame_step = max(1, int(round(source_fps / target_fps)))
            estimated_frames = min(int(total_frames_approx / frame_step), max_frames)
        else:
            frame_step = 1
            estimated_frames = min(total_frames_approx, max_frames)

        # estimated_frames = 0 peut arriver sur certains conteneurs (MKV, etc.)
        if estimated_frames <= 0:
            estimated_frames = max_frames

        # Clampage de la qualité JPEG dans une plage raisonnable
        jpeg_quality = max(50, min(95, jpeg_quality))
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]

        frame_count = 0
        read_count = 0

        try:
            while max_frames == 0 or frame_count < max_frames:
                ret, frame = cap.read()
                if not ret:
                    break

                read_count += 1

                # Sous-échantillonnage par pas de frames
                if (read_count - 1) % frame_step != 0:
                    # Libérer le buffer numpy immédiatement (frames sautées)
                    del frame
                    continue

                # Nom de fichier et chemin de destination
                filename = f"frame_{frame_count:06d}.jpg"
                frame_path = frames_dir / filename

                # Écriture JPEG sur disque — la frame numpy est libérée après cette ligne
                cv2.imwrite(str(frame_path), frame, encode_params)
                del frame  # libération explicite du buffer decoded

                frame_count += 1

                # Émission de la progression
                progress = FrameExtractionProgress(
                    current=frame_count,
                    total=estimated_frames,
                    filename=filename,
                )
                yield progress

        finally:
            cap.release()

    # --------------------------------------------------------
    # Import vidéo / optional_format — lazy (extraction à la demande)
    # --------------------------------------------------------

    def scan_video_lazy(
        self,
        project_id: int,
        video_path: str,
        frame_keep: Optional[int] = None,
        jpeg_quality: int = 85,
        initial_frames: int = 3,
        lossless: bool = False,
        filename_prefix: str = "",
    ) -> tuple:
        """
        Scan rapide de la vidéo : lit uniquement les métadonnées OpenCV (O(1))
        puis crée des enregistrements DB pour TOUTES les frames sans les extraire,
        sauf les `initial_frames` premières qui sont physiquement extraites.

        frame_keep : None = garder tout, 2 = 1 sur 2, 3 = 1 sur 3, ...
        lossless   : True = PNG sans perte, False = JPEG compressé
        filename_prefix : préfixe unique par séquence (multi-séquence) —
                          évite les collisions frame_000000.jpg entre imports.
        Retourne : (frame_records, width, height, source_fps)
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Impossible d'ouvrir : {video_path}")

        source_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_source = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))  or 1920
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1080

        frame_step = max(1, frame_keep) if frame_keep and frame_keep >= 2 else 1
        total_db   = max(1, total_source // frame_step)

        ext = ".png" if lossless else ".jpg"
        if lossless:
            encode_params = None
        else:
            jpeg_quality  = max(50, min(95, jpeg_quality))
            encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]

        frames_dir    = self.get_frames_dir(project_id)

        frame_records = []
        extracted_so_far = 0

        for db_idx in range(total_db):
            source_idx = db_idx * frame_step
            filename   = f"{filename_prefix}frame_{db_idx:06d}{ext}"
            thumb_name = f"{filename_prefix}frame_{db_idx:06d}_thumb.jpg"
            is_extracted = False

            if extracted_so_far < initial_frames:
                cap.set(cv2.CAP_PROP_POS_FRAMES, source_idx)
                ret, frame = cap.read()
                if ret:
                    frame_path = frames_dir / filename
                    if encode_params is not None:
                        cv2.imwrite(str(frame_path), frame, encode_params)
                    else:
                        cv2.imwrite(str(frame_path), frame)
                    del frame
                    is_extracted = True
                    extracted_so_far += 1

            frame_records.append({
                "frame_index":       db_idx,
                "filename":          filename,
                "thumbnail_path":    thumb_name,
                "width":             width,
                "height":            height,
                "is_extracted":      is_extracted,
                "source_frame_index": source_idx,
                "timestamp_ms":      None,
            })

        cap.release()
        return frame_records, width, height, source_fps

    def extract_video_frames_sequential(
        self,
        project_id: int,
        video_path: str,
        frames_to_extract: list,   # List[(filename, source_frame_index)]
        jpeg_quality: int = 85,
        lossless: bool = False,
        batch_callback=None,       # callback(list[str]) — appelé tous les batch_size frames
        batch_size: int = 10,
    ) -> None:
        """
        Extrait des frames depuis une vidéo en LECTURE SEQUENTIELLE.

        Contrairement au seek aléatoire (cv2.CAP_PROP_POS_FRAMES), cette méthode
        décode la vidéo linéairement depuis le début, ce qui est 10-100× plus rapide
        sur les vidéos H.264/H.265 compressées (le seek force un décodage depuis
        le keyframe précédent à chaque appel).

        frames_to_extract : liste de tuples (filename, source_frame_index)
        batch_callback    : appelé avec la liste des filenames après chaque batch_size
        """
        if not frames_to_extract:
            return

        # Index: source_frame_index -> filename
        target_map = {src_idx: fname for fname, src_idx in frames_to_extract}
        target_set = set(target_map.keys())
        max_target  = max(target_set)

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Impossible d'ouvrir : {video_path}")

        if lossless:
            encode_params = None   # PNG — pas de paramètre de qualité
        else:
            jpeg_quality  = max(50, min(95, jpeg_quality))
            encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]

        frames_dir = self.get_frames_dir(project_id)
        current_idx = 0
        batch_done: List[str] = []

        while target_set and current_idx <= max_target:
            ret, frame = cap.read()
            if not ret:
                break

            if current_idx in target_set:
                filename   = target_map[current_idx]
                frame_path = frames_dir / filename
                if encode_params is not None:
                    cv2.imwrite(str(frame_path), frame, encode_params)
                else:
                    cv2.imwrite(str(frame_path), frame)  # PNG lossless
                del frame

                target_set.discard(current_idx)
                batch_done.append(filename)

                if batch_callback and len(batch_done) >= batch_size:
                    batch_callback(list(batch_done))
                    batch_done.clear()
            else:
                del frame   # frame non ciblée — libérer immédiatement

            current_idx += 1

        cap.release()

        # Callback pour la dernière batch partielle
        if batch_callback and batch_done:
            batch_callback(list(batch_done))

    def extract_video_frames_on_demand(
        self,
        project_id: int,
        video_path: str,
        frames_to_extract: list,   # List[(filename, source_frame_index)]
        jpeg_quality: int = 85,
    ) -> None:
        """
        Extrait des frames spécifiques via seek aléatoire (utilisé uniquement
        pour ensure_extracted sur de petits ensembles).
        Préférer extract_video_frames_sequential pour les gros volumes.
        """
        if not frames_to_extract:
            return

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Impossible d'ouvrir : {video_path}")

        jpeg_quality  = max(50, min(95, jpeg_quality))
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
        frames_dir    = self.get_frames_dir(project_id)

        for filename, source_idx in sorted(frames_to_extract, key=lambda x: x[1]):
            cap.set(cv2.CAP_PROP_POS_FRAMES, source_idx)
            ret, frame = cap.read()
            if ret:
                frame_path = frames_dir / filename
                cv2.imwrite(str(frame_path), frame, encode_params)
                del frame
            else:
                print(f"[dataset_service] Frame source {source_idx} non lisible")

        cap.release()

    # ---- optional_format ----

    @staticmethod
    def _read_optional_format_header_fast(optional_format_path: str) -> dict:
        """Lit uniquement les 48 premiers octets du header optional_format (O(1))."""
        import struct as _struct
        with open(optional_format_path, "rb") as f:
            b = f.read(48)
        return {
            "n_img":     _struct.unpack(">I", b[28:32])[0],
            "deg_mult":  _struct.unpack(">H", b[32:34])[0],
            "n_row":     _struct.unpack(">H", b[34:36])[0],
            "n_col":     _struct.unpack(">H", b[36:38])[0],
            "n_bits_pix":_struct.unpack(">H", b[40:42])[0],
            "type_img":  _struct.unpack(">H", b[44:46])[0],
        }

    @staticmethod
    def _load_optional_format_frame(optional_format_path: str, frame_index: int):
        """Charge une frame optional_format (O(1) seek). Retourne (img_ndarray, meta)."""
        from backend.services.format_registry import invoke_for_filename
        return invoke_for_filename(
            optional_format_path, "read", optional_format_path, seq_range=(frame_index, frame_index + 1)
        )

    def read_optional_format_frame_bgr(self, optional_format_path: str, frame_index: int, lut: Optional[dict] = None) -> np.ndarray:
        """
        Décode UNE frame optional_format à la volée (seek O(1)) → BGR uint8 (LUT si 16 bits).
        Utilisé pour le serving et le tracking « on the fly » sans extraction PNG.
        """
        img, _ = self._load_optional_format_frame(optional_format_path, frame_index)
        return self._optional_format_frame_to_bgr(img, lut)

    def read_optional_format_frame_raw(self, optional_format_path: str, frame_index: int) -> np.ndarray:
        """Décode UNE frame optional_format à la volée en valeurs BRUTES (avant LUT) — pour l'histogramme."""
        img, _ = self._load_optional_format_frame(optional_format_path, frame_index)
        return img

    @staticmethod
    def _optional_format_frame_to_bgr(img: np.ndarray, lut: Optional[dict] = None) -> np.ndarray:
        """Convertit une frame optional_format (dtype quelconque, nb canaux quelconque) en BGR uint8."""
        _manual = bool(lut) and lut.get("mode", "sigma") != "sigma"
        if img.dtype != np.uint8 or _manual:
            # uint8 + LUT auto : valeurs exactes préservées (cast direct si déjà 8 bits).
            if img.dtype != np.uint8 and img.min() >= 0 and img.max() <= 255 and not _manual:
                img = img.astype(np.uint8)
            else:
                # 16 bits (RGB ou IR), OU LUT manuelle/minmax sur 8 bits : appliquer la LUT.
                from backend.utils.image_utils import apply_lut
                img = apply_lut(img, lut)
        if img.ndim == 2:
            return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        ch = img.shape[2]
        if ch == 1:
            return cv2.cvtColor(img[:, :, 0], cv2.COLOR_GRAY2BGR)
        if ch == 3:
            return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)   # optional_format stocke en RGB
        if ch == 4:
            return cv2.cvtColor(img[:, :, :3], cv2.COLOR_RGB2BGR)
        return img

    def scan_optional_format_for_png_extraction(
        self,
        project_id: int,
        optional_format_path: str,
        frame_keep: Optional[int] = None,
        filename_prefix: str = "",
    ) -> tuple:
        """
        Lit le header optional_format (O(1)) et prepare les enregistrements Frame.
        L'extraction reelle vers PNG est faite en arriere-plan.
        filename_prefix : prefixe unique par sequence (multi-sequence).
        Retourne : (frame_records, width, height, png_dir)
        """
        header = self._read_optional_format_header_fast(optional_format_path)
        total_optional_format = header["n_img"]
        height    = header["n_row"]
        width     = header["n_col"]

        frame_step = max(1, frame_keep) if frame_keep and frame_keep >= 2 else 1
        total_db   = max(1, total_optional_format // frame_step)

        # NB : on ne CRÉE pas le dossier _png ici — le mode on-the-fly (défaut) ne
        # doit rien écrire dans le dossier source. Le dossier est créé par la tâche
        # d'extraction uniquement si convert_png=True.
        png_dir = Path(optional_format_path).parent / f"{Path(optional_format_path).stem}_png"

        frame_records = []
        for db_idx in range(total_db):
            source_idx = db_idx * frame_step
            frame_records.append({
                "frame_index":        db_idx,
                "filename":           f"{filename_prefix}frame_{db_idx:06d}.png",
                "thumbnail_path":     f"{filename_prefix}frame_{db_idx:06d}_thumb.jpg",
                "width":              width,
                "height":             height,
                "is_extracted":       False,
                "source_frame_index": source_idx,
                "timestamp_ms":       None,
            })

        return frame_records, width, height, png_dir

    def scan_optional_format_lazy(
        self,
        project_id: int,
        optional_format_path: str,
        frame_keep: Optional[int] = None,
        jpeg_quality: int = 85,
        initial_frames: int = 3,
        lossless: bool = False,
    ) -> tuple:
        """
        Scan du header optional_format (O(1)) + extraction des `initial_frames` premières frames.
        Retourne : (frame_records, width, height)
        """
        from backend.services.format_registry import invoke_for_filename

        header = self._read_optional_format_header_fast(optional_format_path)
        total_optional_format = header["n_img"]
        height    = header["n_row"]
        width     = header["n_col"]

        frame_step = max(1, frame_keep) if frame_keep and frame_keep >= 2 else 1
        total_db   = max(1, total_optional_format // frame_step)

        ext = ".png" if lossless else ".jpg"
        if lossless:
            encode_params = None
        else:
            jpeg_quality  = max(50, min(95, jpeg_quality))
            encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
        frames_dir    = self.get_frames_dir(project_id)

        frame_records = []
        for db_idx in range(total_db):
            source_idx = db_idx * frame_step
            filename   = f"frame_{db_idx:06d}{ext}"
            thumb_name = f"frame_{db_idx:06d}_thumb.jpg"
            is_extracted = False

            if db_idx < initial_frames:
                try:
                    img, _ = invoke_for_filename(
                        optional_format_path,
                        "read",
                        optional_format_path,
                        seq_range=(source_idx, source_idx + 1),
                    )
                    frame_bgr  = self._optional_format_frame_to_bgr(img)
                    frame_path = frames_dir / filename
                    if encode_params is not None:
                        cv2.imwrite(str(frame_path), frame_bgr, encode_params)
                    else:
                        cv2.imwrite(str(frame_path), frame_bgr)
                    del frame_bgr
                    is_extracted = True
                except Exception as e:
                    print(f"[dataset_service] optional_format initial extract {source_idx}: {e}")

            frame_records.append({
                "frame_index":        db_idx,
                "filename":           filename,
                "thumbnail_path":     thumb_name,
                "width":              width,
                "height":             height,
                "is_extracted":       is_extracted,
                "source_frame_index": source_idx,
                "timestamp_ms":       None,
            })

        return frame_records, width, height

    def extract_optional_format_frames_on_demand(
        self,
        project_id: int,
        optional_format_path: str,
        frames_to_extract: list,  # List[(filename, source_frame_index)]
        jpeg_quality: int = 85,
    ) -> None:
        """Extrait des frames optional_format spécifiques par leur index dans le fichier."""
        from backend.services.format_registry import invoke_for_filename

        if not frames_to_extract:
            return

        jpeg_quality  = max(50, min(95, jpeg_quality))
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
        frames_dir    = self.get_frames_dir(project_id)

        for filename, source_idx in sorted(frames_to_extract, key=lambda x: x[1]):
            try:
                img, _ = invoke_for_filename(
                    optional_format_path,
                    "read",
                    optional_format_path,
                    seq_range=(source_idx, source_idx + 1),
                )
                frame_bgr  = self._optional_format_frame_to_bgr(img)
                frame_path = frames_dir / filename
                cv2.imwrite(str(frame_path), frame_bgr, encode_params)
                del frame_bgr
            except Exception as e:
                print(f"[dataset_service] Erreur extraction optional_format {source_idx}: {e}")

    # --------------------------------------------------------
    # Conversion MP4 → optional_format (streaming, O(1) RAM par frame)
    # --------------------------------------------------------

    def convert_video_to_optional_format(
        self,
        video_path: str,
        output_path: str,
        frame_keep: Optional[int] = None,
        grayscale: bool = True,
        progress_callback=None,   # callback(current, total)
    ) -> str:
        """
        Convertit un fichier vidéo en optional_format par lecture séquentielle.

        Avantages optional_format vs MP4 :
          - Frames de taille fixe → seek O(1) vers n'importe quelle frame
          - Pas de décodage H.264 = lecture instantanée à la volée
          - Format binaire brut : lecture directe sans décompression

        grayscale=True  → 1 canal uint8, optional_format plus compact
        grayscale=False → 3 canaux uint8 RGB, couleur préservée

        Retourne le chemin du fichier optional_format créé.
        """
        import struct as _struct
        from datetime import date as _date

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Impossible d'ouvrir : {video_path}")

        total_source = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        frame_step = max(1, frame_keep) if frame_keep and frame_keep >= 2 else 1
        n_img_out  = max(1, total_source // frame_step)
        n_channels = 1 if grayscale else 3

        n_bits_pix   = 8 * n_channels
        n_bits_ligne = n_bits_pix * width

        out_path = Path(output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        with open(str(out_path), "wb") as f:
            # ---- Header optional_format (128 bytes) ----
            date_str = _date.today().strftime("%b-%Y").ljust(8)[:8]
            ident_str = b"ETCA    "[:8]
            f.write(b"ETCA")
            f.write(_struct.pack(">H", 1))               # type
            f.write(date_str.encode("utf-8"))             # date 8B
            f.write(ident_str)                            # ident 8B
            f.write(_struct.pack(">H", 128))              # blk_sz
            f.write(_struct.pack(">I", 0))                # doc_sz
            f.write(_struct.pack(">I", n_img_out))        # n_img
            f.write(_struct.pack(">H", n_channels))       # deg_mult
            f.write(_struct.pack(">H", height))           # n_row
            f.write(_struct.pack(">H", width))            # n_col
            f.write(_struct.pack(">H", n_bits_ligne))     # n_bits_ligne
            f.write(_struct.pack(">H", n_bits_pix))       # n_bits_pix
            f.write(_struct.pack(">H", 0))                # padding_img_bin
            f.write(_struct.pack(">H", 1))                # type_img = 1 (uint8)
            f.write(_struct.pack(">H", 0))                # dumyimag
            f.write(bytes(128 - 48))                      # pad to 128 bytes

            # ---- Frames ----
            current_src = 0
            written = 0
            while written < n_img_out:
                ret, frame = cap.read()
                if not ret:
                    break
                if (current_src % frame_step) == 0:
                    if grayscale:
                        px = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)   # (H, W)
                        f.write(px.tobytes())
                    else:
                        px = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)    # (H, W, 3)
                        # optional_format stores channel-first (3, H, W)
                        px_chw = np.ascontiguousarray(np.transpose(px, (2, 0, 1)))
                        f.write(px_chw.tobytes())
                    del px
                    written += 1
                    if progress_callback:
                        progress_callback(written, n_img_out)
                else:
                    del frame
                current_src += 1

        cap.release()
        return str(out_path)

    # --------------------------------------------------------
    # Export YOLO
    # --------------------------------------------------------

    def export_yolo_dataset(
        self,
        project_id: int,
        class_names: List[str],
        class_index_map: Dict[int, int],
        frames_annotations: List[Dict],
        split_ratios: Tuple[float, float, float] = (0.8, 0.1, 0.1),
        include_unannotated: bool = False,
        export_name: Optional[str] = None,
        use_symlink: bool = False,
        optional_format_source_path: Optional[str] = None,
        output_base_dir: Optional[str] = None,
        make_zip: Optional[bool] = None,
    ) -> Dict:
        """
        Exporte le dataset au format YOLO avec structure train/val/test.

        Si use_symlink=False (defaut) : copie les images + cree un ZIP.
        Si use_symlink=True : cree des liens symboliques pour les images, pas de ZIP.
          Le dossier d'export est conserve et son chemin est retourne.
        make_zip : force/désactive le ZIP indépendamment de use_symlink
          (export multi-séquence : un seul ZIP du dossier parent à la fin).

        Returns:
            Dict {"zip_path": str|None, "folder_path": str|None}
        """
        import random

        # Filtrage selon les options
        if not include_unannotated:
            frames_annotations = [
                fa for fa in frames_annotations
                if fa.get("annotations") or fa.get("is_empty", False)
            ]

        if not frames_annotations:
            raise ValueError("Aucune frame annotée à exporter")

        # Mélange aléatoire pour le split, DETERMINISTE : on trie d'abord par nom de
        # fichier (ordre stable, independant de l'ordre DB qui change apres une
        # re-annotation) PUIS shuffle seedé. Sinon un meme dataset re-exporté place
        # les images differemment en train/val -> md5 DVC different (faux "nouvelle
        # version"). Le tri prealable garantit un split identique a contenu identique.
        random.seed(42)
        shuffled = sorted(frames_annotations, key=lambda fa: str(fa.get("filename", "")))
        random.shuffle(shuffled)

        # Calcul des splits
        n = len(shuffled)
        train_end = int(n * split_ratios[0])
        val_end = train_end + int(n * split_ratios[1])

        splits = {
            "train": shuffled[:train_end],
            "val": shuffled[train_end:val_end],
            "test": shuffled[val_end:],
        }

        # Création du dossier d'export temporaire
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_id = export_name or f"project_{project_id}_{timestamp}"
        base_dir = Path(output_base_dir) if output_base_dir else self.exports_dir
        base_dir.mkdir(parents=True, exist_ok=True)
        export_dir = base_dir / export_id
        export_dir.mkdir(parents=True, exist_ok=True)

        frames_dir = self.get_frames_dir(project_id)

        # Detection de la presence d'annotations polygone dans le dataset
        has_any_polygon = any(
            a.get("annotation_type") == "polygon" and a.get("points")
            for fa in frames_annotations
            for a in fa.get("annotations", [])
        )

        # Copie (ou symlink) des fichiers dans la structure YOLO
        for split_name, split_frames in splits.items():
            (export_dir / "images" / split_name).mkdir(parents=True, exist_ok=True)
            (export_dir / "labels" / split_name).mkdir(parents=True, exist_ok=True)
            if has_any_polygon:
                (export_dir / "seg_labels" / split_name).mkdir(parents=True, exist_ok=True)

            for frame_data in split_frames:
                filename = frame_data["filename"]
                stem = Path(filename).stem

                # Image : symlink, copie, ou lecture optional_format à la volée
                src_img = frames_dir / filename
                dst_img = export_dir / "images" / split_name / filename
                if src_img.exists():
                    if use_symlink:
                        try:
                            os.symlink(str(src_img.resolve()), str(dst_img))
                        except (OSError, PermissionError) as e:
                            try:
                                os.link(str(src_img.resolve()), str(dst_img))
                            except (OSError, PermissionError):
                                print(f"[export] Lien echoue ({e}), copie a la place")
                                shutil.copy2(src_img, dst_img)
                    else:
                        shutil.copy2(src_img, dst_img)
                elif optional_format_source_path:
                    # optional_format : PNGs dans le dossier externe
                    optional_format_png = Path(optional_format_source_path) / filename
                    if optional_format_png.exists():
                        if use_symlink:
                            try:
                                os.symlink(str(optional_format_png.resolve()), str(dst_img))
                            except (OSError, PermissionError) as e:
                                try:
                                    os.link(str(optional_format_png.resolve()), str(dst_img))
                                except (OSError, PermissionError):
                                    print(f"[export] Lien optional_format echoue ({e}), copie")
                                    shutil.copy2(optional_format_png, dst_img)
                        else:
                            shutil.copy2(optional_format_png, dst_img)

                # Écriture du fichier de label YOLO bbox
                dst_label = export_dir / "labels" / split_name / f"{stem}.txt"
                write_yolo_label_file(
                    str(dst_label),
                    frame_data.get("annotations", []),
                    class_index_map,
                )

                # Écriture du fichier de label YOLO segmentation (si polygones presents)
                if has_any_polygon:
                    dst_seg_label = export_dir / "seg_labels" / split_name / f"{stem}.txt"
                    write_yolo_segmentation_label_file(
                        str(dst_seg_label),
                        frame_data.get("annotations", []),
                        class_index_map,
                    )

        # Génération du data.yaml (bbox)
        write_data_yaml(
            output_path=str(export_dir / "data.yaml"),
            dataset_path=".",
            class_names=class_names,
        )

        # Génération du seg_data.yaml (segmentation) si polygones présents
        if has_any_polygon:
            seg_yaml_data = {
                "path": ".",
                "train": "images/train",
                "val": "images/val",
                "test": "images/test",
                "nc": len(class_names),
                "names": class_names,
                # YOLO seg attend les labels dans seg_labels/
                "train_labels": "seg_labels/train",
                "val_labels": "seg_labels/val",
                "test_labels": "seg_labels/test",
            }
            import yaml
            with open(export_dir / "seg_data.yaml", "w", encoding="utf-8") as f:
                yaml.dump(seg_yaml_data, f, allow_unicode=True, default_flow_style=False)

        do_zip = (not use_symlink) if make_zip is None else make_zip
        if not do_zip:
            # Garder le dossier d'export, pas de ZIP
            return {"zip_path": None, "folder_path": str(export_dir)}

        # Mode copie : créer le ZIP et supprimer le dossier temporaire
        zip_path = base_dir / f"{export_id}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in export_dir.rglob("*"):
                if file.is_file():
                    zf.write(file, file.relative_to(export_dir.parent))

        # Nettoyage du dossier temporaire
        shutil.rmtree(export_dir, ignore_errors=True)

        return {"zip_path": str(zip_path), "folder_path": None}

    def _place_image(self, filename: str, dst_img: Path, frames_dir: Path,
                     use_symlink: bool, optional_format_source_path: Optional[str]) -> bool:
        """Place l'image d'une frame (symlink/copie, ou PNG optional_format externe) dans dst_img.
        Retourne True si placée. Logique commune YOLO/COCO."""
        import os as _os
        src_img = frames_dir / filename
        candidates = [src_img]
        if optional_format_source_path:
            candidates.append(Path(optional_format_source_path) / filename)
        for src in candidates:
            if not src.exists():
                continue
            if use_symlink:
                try:
                    _os.symlink(str(src.resolve()), str(dst_img))
                    return True
                except (OSError, PermissionError) as e:
                    try:
                        _os.link(str(src.resolve()), str(dst_img))
                        return True
                    except (OSError, PermissionError):
                        print(f"[export] Lien echoue ({e}), copie a la place")
            shutil.copy2(src, dst_img)
            return True
        return False

    def export_coco_dataset(
        self,
        project_id: int,
        class_names: List[str],
        class_index_map: Dict[int, int],
        frames_annotations: List[Dict],
        split_ratios: Tuple[float, float, float] = (0.8, 0.1, 0.1),
        include_unannotated: bool = False,
        export_name: Optional[str] = None,
        use_symlink: bool = False,
        optional_format_source_path: Optional[str] = None,
        output_base_dir: Optional[str] = None,
        make_zip: Optional[bool] = None,
    ) -> Dict:
        """
        Exporte au format COCO (detection + segmentation).

        Structure produite (layout COCO standard detectron2/mmdet) :
            {export}/images/{train,val,test}/*.jpg
            {export}/annotations/instances_{train,val,test}.json

        Chaque annotation COCO : bbox [x,y,w,h] en PIXELS, area, iscrowd=0,
        category_id = class_index+1 (1-based), segmentation [[x1,y1,...]] en
        pixels si l'annotation est un polygone. `track_id` ajouté en extra
        (utile MOT, ignoré par les loaders COCO standard).
        """
        import json as _json
        import random

        if not include_unannotated:
            frames_annotations = [
                fa for fa in frames_annotations
                if fa.get("annotations") or fa.get("is_empty", False)
            ]
        if not frames_annotations:
            raise ValueError("Aucune frame annotée à exporter")

        # Split deterministe : tri stable par nom de fichier avant le shuffle seedé
        # (cf. export_yolo_dataset) -> md5 DVC stable a contenu identique.
        random.seed(42)
        shuffled = sorted(frames_annotations, key=lambda fa: str(fa.get("filename", "")))
        random.shuffle(shuffled)
        n = len(shuffled)
        train_end = int(n * split_ratios[0])
        val_end = train_end + int(n * split_ratios[1])
        splits = {
            "train": shuffled[:train_end],
            "val": shuffled[train_end:val_end],
            "test": shuffled[val_end:],
        }

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        export_id = export_name or f"project_{project_id}_{timestamp}_coco"
        base_dir = Path(output_base_dir) if output_base_dir else self.exports_dir
        base_dir.mkdir(parents=True, exist_ok=True)
        export_dir = base_dir / export_id
        export_dir.mkdir(parents=True, exist_ok=True)
        (export_dir / "annotations").mkdir(parents=True, exist_ok=True)

        frames_dir = self.get_frames_dir(project_id)

        # Categories COCO (1-based), déduites de class_names (indexées par class_index)
        categories = [
            {"id": idx + 1, "name": name, "supercategory": "object"}
            for idx, name in enumerate(class_names)
        ]

        for split_name, split_frames in splits.items():
            (export_dir / "images" / split_name).mkdir(parents=True, exist_ok=True)
            images_json: List[Dict] = []
            annotations_json: List[Dict] = []
            img_id = 0
            ann_id = 0
            for frame_data in split_frames:
                filename = frame_data["filename"]
                w = int(frame_data.get("width") or 0)
                h = int(frame_data.get("height") or 0)
                dst_img = export_dir / "images" / split_name / filename
                self._place_image(filename, dst_img, frames_dir, use_symlink, optional_format_source_path)

                img_id += 1
                images_json.append({
                    "id": img_id,
                    "file_name": filename,
                    "width": w,
                    "height": h,
                })

                for ann in frame_data.get("annotations", []):
                    cls_idx = class_index_map.get(ann["class_id"])
                    if cls_idx is None:
                        continue
                    bw = ann["width"] * w
                    bh = ann["height"] * h
                    bx = (ann["cx"] - ann["width"] / 2) * w
                    by = (ann["cy"] - ann["height"] / 2) * h
                    ann_id += 1
                    coco_ann = {
                        "id": ann_id,
                        "image_id": img_id,
                        "category_id": cls_idx + 1,
                        "bbox": [round(bx, 2), round(by, 2), round(bw, 2), round(bh, 2)],
                        "area": round(bw * bh, 2),
                        "iscrowd": 0,
                        "track_id": ann.get("track_id"),
                    }
                    # Segmentation (polygone normalisé JSON string -> pixels aplatis)
                    if ann.get("annotation_type") == "polygon" and ann.get("points"):
                        try:
                            pts = _json.loads(ann["points"])
                            flat = []
                            for p in pts:
                                flat.append(round(float(p[0]) * w, 2))
                                flat.append(round(float(p[1]) * h, 2))
                            if len(flat) >= 6:
                                coco_ann["segmentation"] = [flat]
                        except Exception:
                            pass
                    annotations_json.append(coco_ann)

            coco_doc = {
                "info": {
                    "description": f"Export COCO — projet {project_id} — {split_name}",
                    "date_created": timestamp,
                },
                "licenses": [],
                "images": images_json,
                "annotations": annotations_json,
                "categories": categories,
            }
            with open(export_dir / "annotations" / f"instances_{split_name}.json",
                      "w", encoding="utf-8") as f:
                _json.dump(coco_doc, f, ensure_ascii=False)

        do_zip = (not use_symlink) if make_zip is None else make_zip
        if not do_zip:
            return {"zip_path": None, "folder_path": str(export_dir)}

        zip_path = base_dir / f"{export_id}.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file in export_dir.rglob("*"):
                if file.is_file():
                    zf.write(file, file.relative_to(export_dir.parent))
        shutil.rmtree(export_dir, ignore_errors=True)
        return {"zip_path": str(zip_path), "folder_path": None}

    # --------------------------------------------------------
    # Gestion des classes YAML
    # --------------------------------------------------------

    def write_classes_yaml(
        self,
        project_id: int,
        class_names: List[str],
        class_colors: List[str],
    ) -> None:
        """
        Écrit le fichier classes.yaml du projet.
        Ce fichier sert de référence pour les noms et couleurs des classes.
        """
        import yaml

        project_dir = self.get_project_dir(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)

        data = {
            "classes": [
                {"name": name, "color": color}
                for name, color in zip(class_names, class_colors)
            ]
        }

        with open(project_dir / "classes.yaml", "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

    def read_classes_yaml(self, project_id: int) -> List[Dict]:
        """
        Lit le fichier classes.yaml du projet.
        Retourne une liste vide si le fichier n'existe pas.
        """
        import yaml

        yaml_path = self.get_project_dir(project_id) / "classes.yaml"
        if not yaml_path.exists():
            return []

        with open(yaml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        return data.get("classes", [])


# Instance singleton du service (partagée entre les routers)
dataset_service = DatasetService()
