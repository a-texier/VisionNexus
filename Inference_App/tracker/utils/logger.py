##########################################
# Project  : VisionNexus
# File     : logger.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Centralised logging setup - single root logger with console, file, and panel handlers.
##########################################

from __future__ import annotations

import logging
import sys
from pathlib import Path

_FMT = "%(asctime)s  %(levelname)-7s  %(name)s  %(message)s"
_DATEFMT = "%H:%M:%S"

_CONSOLE_FMT = logging.Formatter(fmt=_FMT, datefmt=_DATEFMT)


class _ColorFormatter(logging.Formatter):
    """
    Formatter console qui applique une couleur ANSI par famille de logger.

    Familles :
      profiling.profiler       -> bleu
      pipeline.state_machine   -> bordeaux
      trackers.*               -> vert
      utils.metrics*           -> orange
      (tout le reste)          -> blanc (défaut terminal)
    """

    _RESET = "\033[0m"
    _BLUE = "\033[94m"  # bleu vif
    _BORDEAUX = "\033[38;5;88m"  # rouge foncé / bordeaux
    _GREEN_VIVID = "\033[92m"  # vert vif (trackers)
    _GREEN_DARK = "\033[32m"  # vert foncé (builders)
    _ORANGE = "\033[38;5;208m"  # orange (pas jaune)
    _RED = "\033[91m"  # rouge vif (session / synthèse)

    def _color(self, name: str) -> str:
        if name == "profiling.profiler":
            return self._BLUE
        if name == "pipeline.state_machine":
            return self._BORDEAUX
        if name.startswith("trackers.") or name == "trackers":
            return self._GREEN_VIVID
        if name.startswith("utils.metrics"):
            return self._ORANGE
        if name == "pipeline.builders":
            return self._GREEN_DARK
        if name == "pipeline.session":
            return self._RED
        return ""

    def format(self, record: logging.LogRecord) -> str:
        msg = super().format(record)
        color = self._color(record.name)
        return f"{color}{msg}{self._RESET}" if color else msg


def _make_console_formatter() -> logging.Formatter:
    """Retourne un ColorFormatter si stdout est un TTY, sinon plain formatter."""
    if hasattr(sys.stdout, "isatty") and sys.stdout.isatty():
        return _ColorFormatter(fmt=_FMT, datefmt=_DATEFMT)
    return _CONSOLE_FMT


_ROOT_CONFIGURED = False

# Loggers tiers connus pour etre extremement verbeux en DEBUG.
# Toujours forces a WARNING independamment du log_level utilisateur.
# En les declarant ici (meme avant l'import de ces libs), on fixe le niveau
# du logger parent : tous les enfants futurs (ex. matplotlib.font_manager)
# en heriteront et ne pourront pas descendre sous WARNING.
_QUIET_THIRD_PARTY = [
    "matplotlib",  # font_manager : ~10 000 lignes DEBUG par run
    "PIL",  # Pillow : verbose sur les modes/palettes
    "ultralytics",  # YOLO : download progress, model info
    "torch",  # PyTorch : device probing, CUDA init
    "filelock",  # locks HuggingFace
    "huggingface_hub",  # download progress
    "urllib3",  # HTTP pool, retry
]


def _ensure_root() -> None:
    """Configure the root logger with a console StreamHandler (once)."""
    global _ROOT_CONFIGURED
    if _ROOT_CONFIGURED:
        return
    _ROOT_CONFIGURED = True

    root = logging.getLogger()
    # Remove stale per-module StreamHandlers that might have been added
    # before this function runs (e.g. from a previous get_logger() call).
    root.handlers = [
        h
        for h in root.handlers
        if isinstance(h, logging.FileHandler)  # keep file handlers
    ]

    sh = logging.StreamHandler(sys.stdout)
    sh.setLevel(logging.DEBUG)  # root level controls filtering
    sh.setFormatter(_make_console_formatter())
    root.addHandler(sh)
    root.setLevel(logging.INFO)  # default: INFO to console


####
# Public API
####


def get_logger(name: str, level: int = logging.INFO) -> logging.Logger:
    """
    Return a named logger that propagates to the root logger.

    Parameters
    ########
    name  : module name (typically __name__)
    level : minimum level for this specific logger (default INFO)
    """
    _ensure_root()
    logger = logging.getLogger(name)
    # Clear any per-module handlers from the old setup so they don't
    # produce duplicate console lines.
    logger.handlers.clear()
    logger.setLevel(level)
    logger.propagate = True
    return logger


def set_global_level(level: int) -> None:
    """Lower the effective log level for every logger in the hierarchy."""
    logging.getLogger().setLevel(level)
    for _name, obj in logging.Logger.manager.loggerDict.items():
        if isinstance(obj, logging.Logger):
            obj.setLevel(level)


def apply_console_log_level(level: int) -> None:
    """
    Adapte le niveau de log de la console sans toucher au FileHandler.

    Appeler APRES setup_file_logging() et apres la construction de tous
    les composants (pour que les loggers soient deja enregistres).
    Pilote par ``log_level:`` dans le YAML de configuration.

    Effet :
      - Le StreamHandler console passe au niveau ``level``.
      - Tous les loggers nommes (get_logger() ou logging.getLogger())
        passent au niveau ``level``.

    Exemples :
      log_level: "DEBUG"   -> log.debug() visible sur la console ET dans le fichier.
      log_level: "INFO"    -> seuls INFO+ visibles sur la console (comportement par defaut).
      log_level: "WARNING" -> sortie console tres epuree.
    """
    _ensure_root()
    root = logging.getLogger()
    # StreamHandler console : filtrer selon le niveau choisi
    for h in root.handlers:
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
            h.setLevel(level)
    # Tous les loggers nommes : mettre au meme niveau pour que les records
    # atteignent (ou non) la console ET le fichier de log coheremment.
    for _name, obj in logging.Logger.manager.loggerDict.items():
        if isinstance(obj, logging.Logger):
            obj.setLevel(level)
    # Forcer les loggers tiers verbeux a WARNING, INDEPENDAMMENT du log_level
    # utilisateur. Sans ca, log_level: "DEBUG" provoque des dizaines de milliers
    # de lignes inutiles (ex. matplotlib.font_manager "findfont: score...").
    # On fixe le logger parent (ex. "matplotlib") : tous ses enfants crees
    # apres cet appel (ex. "matplotlib.font_manager") en heriteront.
    for _quiet in _QUIET_THIRD_PARTY:
        logging.getLogger(_quiet).setLevel(logging.WARNING)


def setup_file_logging(
    run_dir,
    level: int = logging.DEBUG,
) -> logging.FileHandler:
    """
    Write all log records (DEBUG and above) to *run_dir/run.log*.

    Call once per run, typically from main.py right after the run directory
    is created.

    Returns
    ######
    The FileHandler (so the caller can remove it after the run if needed).
    """
    _ensure_root()
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    log_file = run_dir / "run.log"

    fh = logging.FileHandler(str(log_file), encoding="utf-8", mode="w")
    fh.setLevel(level)
    fh.setFormatter(_CONSOLE_FMT)

    root = logging.getLogger()
    root.addHandler(fh)
    # Lower root level so DEBUG records reach the file handler.
    if root.level > level:
        root.setLevel(level)

    logging.getLogger(__name__).info("File log -> %s", log_file)
    return fh


def setup_log_panel(panel_handler: logging.Handler) -> None:
    """
    Attach a LogPanelHandler (from utils/debug_panel.py) to the root logger.

    Sets the root logger level to DEBUG so every record (including DEBUG
    messages from trackers) reaches the panel.
    """
    _ensure_root()
    root = logging.getLogger()
    root.addHandler(panel_handler)
    if root.level > logging.DEBUG:
        root.setLevel(logging.DEBUG)
    logging.getLogger(__name__).info("Log panel handler attached (level=DEBUG)")
