# ============================================================
# core/embedder.py
# Extraction de features CLIP ViT-B-32.
#
# Singleton clip_embedder — chargé une fois au démarrage.
# Tous les vecteurs retournés sont L2-normalisés (float32).
# ============================================================

import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from backend.config import (
    BATCH_SIZE,
    CLIP_MODEL,
    CLIP_PRETRAINED,
    CLIP_WEIGHTS,
    EMBED_DIM,
    THUMBS_DIR,
)

logger = logging.getLogger(__name__)

# Lecture+decodage PIL d'une image est I/O-bound (surtout sur SMB/VM distante) —
# paralleliser cette etape ne touche pas l'inference GPU/CPU du modele, qui reste
# executee sur le batch assemble une fois tous les tenseurs prets.
IO_WORKERS = 6


class CLIPEmbedder:
    """Extraction de features CLIP, génération de thumbnails, cache MD5."""

    def __init__(self) -> None:
        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._device: str = "cuda" if torch.cuda.is_available() else "cpu"

    # ------------------------------------------------------------------ #
    # Chargement du modèle                                                #
    # ------------------------------------------------------------------ #

    def load(self) -> None:
        """Charge le modèle CLIP en mémoire (CUDA si disponible).

        Mode hors-ligne — aucun téléchargement réseau :
          1. si ``CLIP_WEIGHTS`` pointe sur un fichier existant → chargé directement ;
          2. sinon le tag ``CLIP_PRETRAINED`` est résolu depuis le cache Hugging Face
             (réseau coupé via ``HF_HUB_OFFLINE=1``, voir config.py).
        En cas d'absence totale de poids, une erreur explicite est levée plutôt
        qu'une tentative de téléchargement silencieuse.
        """
        import open_clip

        if CLIP_WEIGHTS and Path(CLIP_WEIGHTS).is_file():
            pretrained = str(CLIP_WEIGHTS)          # fichier local explicite (offline)
            source = f"fichier local {CLIP_WEIGHTS}"
        else:
            pretrained = CLIP_PRETRAINED            # tag → cache HF (offline)
            source = f"tag '{CLIP_PRETRAINED}' (cache HF, hors-ligne)"

        try:
            self._model, _, self._preprocess = open_clip.create_model_and_transforms(
                CLIP_MODEL, pretrained=pretrained
            )
        except Exception as exc:
            raise RuntimeError(
                f"CLIP {CLIP_MODEL} introuvable hors-ligne ({source}). "
                "Provisionner le fichier de poids puis definir CLIP_WEIGHTS, ou peupler "
                "le cache HF une seule fois en relancant avec HF_HUB_OFFLINE=0. "
                f"Detail: {exc}"
            ) from exc

        self._tokenizer = open_clip.get_tokenizer(CLIP_MODEL)
        self._model = self._model.to(self._device).eval()
        logger.info("CLIP %s charge sur %s (%s)", CLIP_MODEL, self._device, source)

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    # ------------------------------------------------------------------ #
    # Embeddings images                                                   #
    # ------------------------------------------------------------------ #

    def embed_images(
        self,
        paths: List[str],
        batch_size: int = BATCH_SIZE,
    ) -> np.ndarray:
        """
        Encode une liste d'images en vecteurs CLIP L2-normalisés.

        Returns:
            np.ndarray de forme (N, EMBED_DIM), dtype float32.
        """
        if not self.is_loaded:
            raise RuntimeError("CLIPEmbedder non charge — appeler load() d'abord")

        all_vecs: List[np.ndarray] = []

        for batch_start in range(0, len(paths), batch_size):
            batch_paths = paths[batch_start : batch_start + batch_size]
            # Lecture/decodage/pretraitement paralleles (I/O-bound) — l'ordre est
            # preserve par executor.map, necessaire pour que chaque tenseur reste
            # aligne avec son chemin dans batch_paths.
            with ThreadPoolExecutor(max_workers=IO_WORKERS) as executor:
                tensors = list(executor.map(self._load_and_preprocess, batch_paths))

            batch_tensor = torch.stack(tensors).to(self._device)
            with torch.no_grad():
                features = self._model.encode_image(batch_tensor)
                features = F.normalize(features, dim=-1)

            all_vecs.append(features.cpu().numpy().astype(np.float32))

        return np.vstack(all_vecs) if all_vecs else np.zeros((0, EMBED_DIM), dtype=np.float32)

    def _load_and_preprocess(self, path: str) -> torch.Tensor:
        """Charge + pretraite une image pour CLIP. Appele en parallele (threads)
        depuis embed_images() -- toujours sur l'image de base, jamais un thumbnail
        (invariant du projet, cf CLAUDE.md : la qualite/coherence des embeddings
        deja stockes en depend)."""
        try:
            # Chargement robuste 16 bits / IR / float (remap 3-sigma) —
            # sinon les images 16 bits donnaient des embeddings de bruit.
            from backend.core.image_io import load_pil_rgb
            img = load_pil_rgb(path)
            return self._preprocess(img)
        except Exception as exc:
            logger.warning("Image ignoree (%s): %s", path, exc)
            # Vecteur nul => sera filtré en amont si besoin
            return torch.zeros(3, 224, 224)

    # ------------------------------------------------------------------ #
    # Embedding texte                                                     #
    # ------------------------------------------------------------------ #

    def embed_text(self, text: str) -> np.ndarray:
        """
        Encode un texte en vecteur CLIP L2-normalisé.

        Returns:
            np.ndarray de forme (EMBED_DIM,), dtype float32.
        """
        if not self.is_loaded:
            raise RuntimeError("CLIPEmbedder non charge")

        tokens = self._tokenizer([text]).to(self._device)
        with torch.no_grad():
            features = self._model.encode_text(tokens)
            features = F.normalize(features, dim=-1)

        return features.cpu().numpy().astype(np.float32)[0]

    # ------------------------------------------------------------------ #
    # MD5                                                                 #
    # ------------------------------------------------------------------ #

    def compute_md5(self, path: str) -> str:
        """Calcule le MD5 d'un fichier (chunks de 8 KB)."""
        h = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()

    # ------------------------------------------------------------------ #
    # Thumbnails                                                          #
    # ------------------------------------------------------------------ #

    def generate_thumbnail(self, path: str, md5: str) -> str:
        """
        Génère une miniature 256px et la sauvegarde dans THUMBS_DIR.

        Returns:
            URL relative de la miniature : "/thumbs/{md5}.jpg"
        """
        THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        dest = THUMBS_DIR / f"{md5}.jpg"

        if not dest.exists():
            try:
                from backend.core.image_io import is_high_bitdepth, load_pil_rgb
                if is_high_bitdepth(path):
                    # 16 bits / IR / float → remap 3-sigma (miniature lisible, pas noire).
                    img = load_pil_rgb(path)
                else:
                    img = Image.open(path)
                    # draft() : décodage JPEG à résolution réduite (jusqu'à ~4x plus
                    # rapide) — no-op pour les formats non-JPEG. Doit précéder load().
                    try:
                        img.draft("RGB", (256, 256))
                    except Exception:
                        pass
                    img = img.convert("RGB")
                img.thumbnail((256, 256), Image.LANCZOS)
                img.save(str(dest), "JPEG", quality=85)
            except Exception as exc:
                logger.warning("Thumbnail echoue pour %s : %s", path, exc)
                return ""

        return f"/thumbs/{md5}.jpg"

    def generate_thumbnail_from_image(self, img: Image.Image, md5: str) -> str:
        """
        Génère une miniature 256px à partir d'un objet PIL déjà ouvert.
        Evite de rouvrir le fichier quand l'image est déjà en mémoire.

        Returns:
            URL relative de la miniature : "/thumbs/{md5}.jpg"
        """
        THUMBS_DIR.mkdir(parents=True, exist_ok=True)
        dest = THUMBS_DIR / f"{md5}.jpg"

        if not dest.exists():
            try:
                thumb = img.copy()
                thumb.thumbnail((256, 256), Image.LANCZOS)
                thumb.save(str(dest), "JPEG", quality=85)
            except Exception as exc:
                logger.warning("Thumbnail echoue (from image) md5=%s : %s", md5, exc)
                return ""

        return f"/thumbs/{md5}.jpg"


# Singleton global
clip_embedder = CLIPEmbedder()
