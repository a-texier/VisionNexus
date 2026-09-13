##########################################
# Project  : VisionNexus
# File     : builders.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Factory functions that build every pipeline component from a config dict.
##########################################

from __future__ import annotations

import collections
import importlib
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Racine du projet (pipeline/ est un niveau en dessous)
ROOT = Path(__file__).resolve().parent.parent


#################################
# Registres des trackers disponibles
#################################

MOT_REGISTRY: dict[str, str] = {
    "custom_kalman": "trackers.mot.custom_kalman.tracker.CustomKalmanTracker",
    "bytetrack": "trackers.mot.bytetrack.tracker.ByteTrackWrapper",
    "botsort": "trackers.mot.botsort.tracker.BotSortWrapper",
    "boosttrack": "trackers.mot.boosttrack.tracker.BoostTrackWrapper",
}

SOT_REGISTRY: dict[str, str] = {
    "dummy": "trackers.sot.dummy.tracker.DummySot",
    "csrt": "trackers.sot.csrt.tracker.CsrtSot",
    "dimp": "trackers.sot.dimp.tracker.DimpSot",
    "ostrack": "trackers.sot.ostrack.tracker.OSTrackSot",
    "sam2": "trackers.sot.sam2.tracker.Sam2Sot",
    "tracking_tophat": "trackers.sot.tracking_tophat.tracker.TrackingTophatSot",
}


def _load_class(registry: dict[str, str], key: str):
    """Importe et retourne la classe désignée par key dans le registre."""
    if key not in registry:
        raise ValueError(f"Tracker inconnu '{key}'. Choix disponibles : {sorted(registry)}")
    module_path, cls_name = registry[key].rsplit(".", 1)
    return getattr(importlib.import_module(module_path), cls_name)


#################################
# Constructeurs de composants
#################################


def _has_tcp_port(url: str) -> bool:
    """True si l'URL tcp:// contient un numero de port explicite (ex: tcp://host:5555)."""
    if "://" not in url:
        return False
    rest = url.split("://", 1)[1]
    return ":" in rest


def build_loader(cfg: dict):
    """
    Build a SequenceLoader for the given sequence path.

    sequence_dir accepts these forms:
      - "http://host:port/stream"  -> NetworkFrameReader (flux distant)
      - "tcp"                      -> ZmqFrameReader (protocole ZMQ generique tools/zmq_cpp, host=localhost)
      - "tcp://host"               -> ZmqFrameReader (protocole ZMQ generique tools/zmq_cpp, host explicite)
      - A *.optional file               -> optional_format mode (MultiCsvCamera IR)
      - A directory or video file  -> PNG/JPG/MP4 mode

    Pour le mode réseau (Step 2 du pipeline distribué) :
      PC hôte lance tools/frame_sender.py --port 9090
      Jetson configure : sequence_dir: "http://192.168.1.50:9090/stream"
    """
    seq_dir = cfg["sequence_dir"]

    ##### Mode réseau : URL http:// ou https:// ####
    if seq_dir.startswith("http://") or seq_dir.startswith("https://"):
        from data.network.network_reader import NetworkFrameReader

        reader = NetworkFrameReader(seq_dir)
        # Adapter le fps depuis le flux si le config ne le force pas
        fps_cfg = float(cfg.get("fps", 0.0))
        if fps_cfg <= 0:
            cfg = dict(cfg)  # copie pour ne pas modifier l'original
            cfg["fps"] = reader.fps
        log.info("NetworkFrameReader: url=%s  fps=%.1f", seq_dir, reader.fps)
        # Wrapper minimal compatible avec la boucle session.py
        return _NetworkLoaderWrapper(reader, cfg)

    ##### Mode ZMQ generique tools/zmq_cpp : "tcp" ou "tcp://host" (sans port) ####
    # Protocole JSON+JPEG generique (voir tools/zmq_cpp), ports fixes des deux
    # cotes (zmq_port/zmq_anno_port/zmq_click_port <-> --port/--anno-port/--click-port).
    # "tcp"            -> host=127.0.0.1
    # "tcp://host"     -> host explicite (ex: "tcp://192.168.1.10")
    if seq_dir == "tcp" or (seq_dir.startswith("tcp://") and not _has_tcp_port(seq_dir)):
        from data.zmq.protocol import DEFAULT_FRAME_PORT
        from data.zmq.zmq_reader import ZmqFrameReader

        host = "127.0.0.1"
        if seq_dir.startswith("tcp://"):
            host = seq_dir[len("tcp://") :]

        port = int(cfg.get("zmq_port", DEFAULT_FRAME_PORT))
        ring_size = int(cfg.get("zmq_ring_size", 10))
        timeout_ms = int(cfg.get("zmq_recv_timeout_ms", 5000))
        reader = ZmqFrameReader(
            host=host,
            port=port,
            ring_size=ring_size,
            timeout_ms=timeout_ms,
        )
        log.info(
            "ZmqFrameReader: host=%s  port=%d  ring=%d  timeout=%dms",
            host,
            port,
            ring_size,
            timeout_ms,
        )
        wrapper = _ZmqLoaderWrapper(reader, cfg)

        # Pont d'affichage bidirectionnel actif en mode headless.
        # Ports fixes (zmq_anno_port/zmq_click_port), pas de decouverte.
        mode = str(cfg.get("mode", "headless")).lower()
        if mode == "headless":
            from data.zmq.protocol import DEFAULT_ANNO_PORT, DEFAULT_CLICK_PORT
            from data.zmq.zmq_display_bridge import ZmqDisplayBridge

            anno_port = int(cfg.get("zmq_anno_port", DEFAULT_ANNO_PORT))
            click_port = int(cfg.get("zmq_click_port", DEFAULT_CLICK_PORT))
            # n_boxes : nombre max de boxes envoyees par frame (pas de limite
            # protocole, contrairement a l'ancien struct binaire de taille fixe).
            n_boxes = cfg.get("zmq_anno_n_boxes", None)
            wrapper.display_bridge = ZmqDisplayBridge(
                host=host,
                anno_port=anno_port,
                click_port=click_port,
                colors=cfg.get("render", {}),
                n_boxes=n_boxes,
            )
            log.info(
                "ZmqDisplayBridge: active (headless) anno_port=%d  click_port=%d",
                anno_port,
                click_port,
            )

        return wrapper

    ##### Mode fichier/dossier local ####
    seq_path = Path(seq_dir) if Path(seq_dir).is_absolute() else ROOT / seq_dir

    if not seq_path.exists():
        raise FileNotFoundError(f"sequence_dir not found: {seq_path}")

    _ALLOWED_FILE_EXTS = {".optional", ".mp4", ".avi", ".mov", ".mkv", ".m4v"}
    if seq_path.is_file() and seq_path.suffix.lower() not in _ALLOWED_FILE_EXTS:
        raise ValueError(
            f"sequence_dir doit être un dossier, un .optional, ou une vidéo "
            f"({sorted(_ALLOWED_FILE_EXTS)}). Reçu : {seq_path.name}"
        )

    loader_cfg = {
        "slice_size": int(cfg.get("slice_size", 5)),
        "start_frame_idx": int(cfg.get("start_frame_idx", 0)),
        "stop_frame_idx": int(cfg.get("stop_frame_idx", -1)),
        "fps": float(cfg.get("fps", 10.0)),
        "camera_name": cfg.get("camera_name", ""),
        "metadata_csv": cfg.get("metadata_csv", []),
    }

    from data.rejeu.sequence_loader import SequenceLoader

    return SequenceLoader(str(seq_path), loader_cfg)


class _NetworkLoaderWrapper:
    """
    Wrapper léger autour de NetworkFrameReader qui expose l'interface
    attendue par session.py (_run_loop).

    Interface minimum :
      loader[frame_id]            -> (frame, metadata_dict)
      loader.get_fps()            -> float
      loader.start_frame_idx      -> int
      loader.stop_frame_idx       -> int
      loader.close()              -> None
      iter(loader)                -> itère les frames

    Les métadonnées LDV (latlong, euler, etc.) ne sont pas disponibles
    depuis un flux réseau -> dict vide retourné (CMC via H_image seule).
    """

    def __init__(self, reader, cfg: dict):
        self._reader = reader
        self._cfg = cfg
        self._fps = reader.fps
        self._idx = 0
        self.start_frame_idx = int(cfg.get("start_frame_idx", 0))
        self.stop_frame_idx = int(cfg.get("stop_frame_idx", -1))
        self._frame_id = self.start_frame_idx

    def get_fps(self) -> float:
        return self._fps

    def __iter__(self):
        """Itère en lisant frame par frame depuis le réseau."""
        while True:
            frame = self._reader[self._frame_id]
            metadata = {}  # pas de LDV depuis un flux réseau
            yield self._frame_id, frame, metadata
            self._frame_id += 1
            if self.stop_frame_idx >= 0 and self._frame_id >= self.stop_frame_idx:
                break

    def close(self) -> None:
        if hasattr(self._reader, "close"):
            self._reader.close()


class _ZmqLoaderWrapper:
    """
    Wrapper autour de ZmqFrameReader qui expose l'interface attendue par session.py.

    ZmqFrameReader recoit des messages JSON+JPEG du protocole generique tools/zmq_cpp.
    Les metadonnees LDV et FOV extraites du meta JSON sont transmises dans metadata :
      metadata["ldv"]      = (az_deg, el_deg, roulis_deg)  roulis toujours 0.0 (non fourni).
      metadata["hfov_deg"] = FOV horizontal en degres (champ "chh" du meta JSON). 0.0 si invalide.
      metadata["vfov_deg"] = alias de hfov_deg (pas de FOV vertical distinct dans le protocole).

    Le LDV active la CMC (compensation mouvement camera) si use_ldv_cmc: true.

    Gere le recalage automatique inter-frames (drain si avg_gap > seuil) et le
    startup drain (vider les vieilles frames accumulees pendant l'init YOLO).

    Attributs publics :
      display_bridge   ZmqDisplayBridge ou None - attache par build_loader()
                       quand mode=headless + sequence_dir="tcp".
    """

    def __init__(self, reader, cfg: dict):
        self._reader = reader
        self._fps = float(cfg.get("fps", 10.0))
        self.start_frame_idx = int(cfg.get("start_frame_idx", 0))
        self.stop_frame_idx = int(cfg.get("stop_frame_idx", -1))
        self._frame_id = self.start_frame_idx
        # Injecté par build_loader() en mode headless+tcp
        self.display_bridge = None
        # Recalage automatique : si l'écart inter-frame_id dépasse ce seuil,
        # on saute des frames pour rattraper le flux temps réel.
        self._catchup_threshold = float(cfg.get("zmq_catchup_threshold", 2.0))
        self._ring_size = int(cfg.get("zmq_ring_size", 10))

    def get_fps(self) -> float:
        return self._fps

    def get_resolution(self):
        """Résolution inconnue avant la 1ère frame - retourne (0, 0)."""
        return (0, 0)

    def __iter__(self):
        """
        Itere en lisant frame par frame depuis le flux ZMQ avec recalage automatique.

        Ring buffer : ZmqFrameReader garde les N (ring_size) dernieres frames.
        Si Python est lent, les vieilles frames sont deja ecrasees dans le buffer.
        On lit toujours la plus vieille disponible (FIFO) et on mesure le retard
        reel via l'ecart entre frame_ids successifs.

        Chaque item recu de ZmqFrameReader : (frame, (az_deg, el_deg, roulis_deg), hfov_deg, vfov_deg, zmq_fid)
        Tous les angles sont en degres (conversion radians->degres dans ZmqFrameReader).

        Recalage : si l'ecart moyen inter-frame_id depasse zmq_catchup_threshold,
        on saute des frames (drain) pour rattraper le flux en temps reel.
        """
        prev_fid = None
        gap_history = collections.deque(maxlen=5)  # fenêtre glissante des gaps

        ##### Drain au démarrage ####
        # Python peut démarrer son pipeline bien après C++ (YOLO warmup, init CUDA…).
        # On vide le ring buffer sauf la dernière frame pour commencer sur la plus récente
        # plutôt que de traiter toutes les vieilles frames accumulées depuis le début.
        _startup_depth = self._reader.queue_depth()
        if _startup_depth > 1:
            _drained = self._reader.drain(_startup_depth - 1)
            log.info(
                "ZMQ démarrage : drain %d frame(s) pour partir de la plus récente [buffer %d/%d]",
                _drained,
                self._reader.queue_depth(),
                self._ring_size,
            )

        while True:
            frame, ldv, hfov_deg, vfov_deg, zmq_fid = self._reader[self._frame_id]
            pipeline_fid = zmq_fid if zmq_fid >= 0 else self._frame_id

            ##### C++ reconnect: fid counter resets to 0 #####
            # Detected via _reconnect_event set by _process_sync() when the image
            # port changes. Must be checked BEFORE gap / lag calculations because
            # a fid reset (e.g. 5000 -> 0) produces a huge negative gap and would
            # corrupt gap_history for the next 5 frames.
            if hasattr(self._reader, "check_reconnect") and self._reader.check_reconnect():
                log.warning(
                    "ZMQ reconnect: C++ restarted, resetting gap tracking (fid was %s, now %d)",
                    prev_fid,
                    zmq_fid,
                )
                prev_fid = None
                gap_history.clear()

            ##### Absolute lag: compare zmq_fid to latest fid received by recv thread #####
            # The recv thread can be ahead of the queue (ring buffer full, old frames dropped).
            # If the absolute lag exceeds ring_size we are certainly behind -> aggressive drain.
            # Guard: skip if zmq_fid < last_received_fid after a reconnect (fid reset),
            # which is handled above; here both values are coherent (same C++ session).
            if zmq_fid >= 0 and hasattr(self._reader, "last_received_fid"):
                _latest = self._reader.last_received_fid
                if _latest > zmq_fid:
                    _abs_lag = _latest - zmq_fid
                    if _abs_lag > self._ring_size:
                        _skipped = self._reader.drain(self._reader.queue_depth())
                        if _skipped > 0:
                            log.warning(
                                "ZMQ absolute lag: fid processed=%d, last received=%d "
                                "(lag=%d > ring_size=%d) -> drain %d frame(s)",
                                zmq_fid,
                                _latest,
                                _abs_lag,
                                self._ring_size,
                                _skipped,
                            )
                            gap_history.clear()

            ##### Relative catchup: consecutive fid gap #####
            if prev_fid is not None and zmq_fid >= 0:
                gap = pipeline_fid - prev_fid
                gap_history.append(gap)

                if len(gap_history) >= 2:
                    avg_gap = sum(gap_history) / len(gap_history)

                    if avg_gap > self._catchup_threshold:
                        n_skip = max(1, int(avg_gap) - 1)
                        skipped = self._reader.drain(n_skip)
                        if skipped > 0:
                            log.warning(
                                "ZMQ catchup: avg_gap=%.1f (threshold=%.1f) "
                                "-> skip %d frame(s) [buffer %d/%d]",
                                avg_gap,
                                self._catchup_threshold,
                                skipped,
                                self._reader.queue_depth(),
                                self._ring_size,
                            )
                            gap_history.clear()

            prev_fid = pipeline_fid

            if zmq_fid >= 0:
                _latest = getattr(self._reader, "last_received_fid", zmq_fid)
                _retard = max(0, _latest - pipeline_fid)
                _depth = self._reader.queue_depth()
                if pipeline_fid % 50 == 0:
                    log.info(
                        "ZMQ flux | fid=%d last_rx=%d retard=%d buffer=%d/%d",
                        pipeline_fid,
                        _latest,
                        _retard,
                        _depth,
                        self._ring_size,
                    )
                elif log.isEnabledFor(logging.DEBUG):
                    log.debug(
                        "ZMQ ring | fid=%d last_rx=%d retard=%d buffer=%d/%d",
                        pipeline_fid,
                        _latest,
                        _retard,
                        _depth,
                        self._ring_size,
                    )

            metadata = {
                "ldv": ldv,
                "hfov_deg": hfov_deg,
                "vfov_deg": vfov_deg,
            }
            yield pipeline_fid, frame, metadata
            self._frame_id += 1
            if self.stop_frame_idx >= 0 and self._frame_id >= self.stop_frame_idx:
                break

    def close(self) -> None:
        if self.display_bridge is not None:
            self.display_bridge.close()
        self._reader.close()


def build_detector_mot(cfg: dict):
    """
    Construit le detecteur MOT selon la cle detector_mot du config.

    detector_mot:
      "yolo"   (defaut si weights_yolo set) -> YOLODetectorMOT (avec fallback DummyDetectorMOT)
      "tophat"                              -> TopHatDetectorMOT (section tophat_mot du cfg)
      "none"                               -> NoneDetectorMOT
      "dummy"                              -> DummyDetectorMOT
    """
    from pipeline.detector.detector_mot import (
        DummyDetectorMOT,
        NoneDetectorMOT,
        TopHatDetectorMOT,
        YOLODetectorMOT,
    )

    detector_key = cfg.get("detector_mot", "").lower()
    weights = cfg.get("weights_yolo", "")
    device = cfg.get("device", "cuda")

    # Determine default key: yolo if weights present, else dummy
    if not detector_key:
        detector_key = "yolo" if weights else "dummy"

    if detector_key == "none":
        log.info("NoneDetectorMOT (detector_mot=none)")
        return NoneDetectorMOT()

    if detector_key == "dummy":
        log.info("DummyDetectorMOT (detector_mot=dummy)")
        return DummyDetectorMOT()

    if detector_key == "tophat":
        th_cfg = cfg.get("tophat_mot", {})
        tophat_kernels = list(th_cfg.get("tophat_kernels", [7]))
        k_sigma_levels = list(th_cfg.get("k_sigma_levels", [2.0]))
        det = TopHatDetectorMOT(
            tophat_kernels=[int(k) for k in tophat_kernels],
            k_sigma_levels=[float(s) for s in k_sigma_levels],
            threshold_rel=float(th_cfg.get("threshold_rel", 0.4)),
            min_area_px2=int(th_cfg.get("min_area_px2", 16)),
            max_area_px2=int(th_cfg.get("max_area_px2", 5000)),
            min_score=float(th_cfg.get("min_score", 0.5)),
            use_adaptive=bool(th_cfg.get("use_adaptive_thresh", False)),
            min_thresh_abs=int(th_cfg.get("min_thresh_abs", 5)),
            max_candidates=int(th_cfg.get("max_candidates", 0)),
        )
        det.configure(cfg)  # injecte _debug_dir et cree le video writer si active
        log.info(
            "TopHatDetectorMOT (detector_mot=tophat) kernels=%s  adaptive=%s",
            det.tophat_kernels,
            det.use_adaptive,
        )
        return det

    # detector_key == "yolo" (default) - supporte .pt, .onnx, .engine (TensorRT)
    _YOLO_EXTS = {".pt", ".onnx", ".engine"}
    if weights:
        w_path = weights if Path(weights).is_absolute() else str(ROOT / weights)
        if Path(w_path).exists():
            ext = Path(w_path).suffix.lower()
            if ext not in _YOLO_EXTS:
                log.warning(
                    "weights_yolo extension inconnue '%s' (attendu %s). "
                    "Tentative de chargement quand même.",
                    ext,
                    sorted(_YOLO_EXTS),
                )
            try:
                yolo_cfg = cfg.get("yolo", {})
                is_trt = ext == ".engine"
                det = YOLODetectorMOT(
                    weights_path=w_path,
                    conf_thresh=float(yolo_cfg.get("conf_thresh", 0.3)),
                    iou_thresh=float(yolo_cfg.get("iou_thresh", 0.45)),
                    device=device,
                    img_size=int(yolo_cfg.get("img_size", 640)),
                )
                log.info(
                    "YOLODetectorMOT: %s  type=%s  conf=%.2f  iou=%.2f  imgsz=%d%s",
                    w_path,
                    "TensorRT" if is_trt else ext.lstrip(".").upper(),
                    det.conf_thresh,
                    det.iou_thresh,
                    det.img_size,
                    " (device+imgsz baked-in)" if is_trt else "",
                )
                return det
            except Exception as exc:
                log.warning("YOLODetectorMOT unavailable (%s) -> DummyDetectorMOT", exc)

    log.info("DummyDetectorMOT (weights absent or invalid)")
    return DummyDetectorMOT()


def build_detector_roi(cfg: dict):
    """
    Construit le detecteur ROI selon la cle detector_roi du config.

    detector_roi:
      "tophat" -> TopHatROIDetector (section tophat_roi du cfg)
      "none" ou absent -> NoneDetectorROI
    """
    from pipeline.detector.detector_roi import NoneDetectorROI, TopHatROIDetector

    detector_key = cfg.get("detector_roi", "none").lower()

    if detector_key == "tophat":
        roi_cfg = cfg.get("tophat_roi", {})
        # white_kernels (nouveau) avec fallback legacy tophat_kernels
        tophat_kernels = list(roi_cfg.get("white_kernels", roi_cfg.get("tophat_kernels", [5])))
        black_tophat_kernels = list(roi_cfg.get("black_kernels", []))
        k_sigma_levels = list(roi_cfg.get("k_sigma_levels", [2.0]))
        det = TopHatROIDetector(
            roi_size_px=int(roi_cfg.get("roi_size_px", 120)),
            tophat_kernels=[int(k) for k in tophat_kernels],
            black_tophat_kernels=[int(k) for k in black_tophat_kernels],
            k_sigma_levels=[float(s) for s in k_sigma_levels],
            threshold_rel=float(roi_cfg.get("threshold_rel", 0.3)),
            min_area_px2=int(roi_cfg.get("min_area_px2", 4)),
            max_area_px2=int(roi_cfg.get("max_area_px2", 2000)),
            use_adaptive=bool(roi_cfg.get("use_adaptive_thresh", False)),
            min_thresh_abs=int(roi_cfg.get("min_thresh_abs", 5)),
            max_candidates=int(roi_cfg.get("max_candidates", 0)),
        )
        det.configure(cfg)  # injecte _debug_dir, AlgoDebugConfig, flags debug
        log.info(
            "TopHatROIDetector (detector_roi=tophat) roi_size=%d white_kernels=%s  black_kernels=%s  adaptive=%s",
            det.roi_size_px,
            det.tophat_kernels,
            det.black_tophat_kernels,
            det.use_adaptive,
        )
        return det

    log.info("NoneDetectorROI (detector_roi=none)")
    return NoneDetectorROI()


# Backward compatibility alias
def build_detector(cfg: dict):
    """Alias for build_detector_mot (backward compatibility)."""
    return build_detector_mot(cfg)


def build_trackers(cfg: dict) -> tuple:
    """
    Instancie et initialise la paire (mot_tracker, sot_tracker).

    tracker_mot : tracker MOT.
      - Valeur valide  : "custom_kalman" | "bytetrack" | "botsort" | "boosttrack"
      - null / "none"  : pas de tracker MOT. Les détections brutes (detector_mot) sont
                         converties en _DetTrack éphémères (sans ID persistant) et
                         retournées directement par state_machine.update().
                         Pour un vrai IDLE sans rien : detector_mot=none + tracker_mot=null.
                         mot_background est ignoré.

    tracker_sot : tracker SOT unique - utilise dans tous les cas.
                  Quand les tracks MOT sont absentes (tracker_mot=None, MOT off,
                  ou mot_background=false), le detector_roi fournit une bbox
                  synthetique pour l'initialisation.

    Returns
    ######
    (mot_tracker, sot_tracker, sot_tracker2)
      mot_tracker  : None en mode SOT-only
      sot_tracker2 : None si n_targets < 2
    """
    tracker_mot_key = cfg.get("tracker_mot")  # None si yaml: null
    tracker_sot_key = cfg.get("tracker_sot", "dummy")
    n_targets = int(cfg.get("n_targets", 1))

    # Construire le tracker SOT1 (toujours requis)
    SotCls = _load_class(SOT_REGISTRY, tracker_sot_key)
    sot_tracker = SotCls()
    sot_tracker.configure(cfg)

    # Construire le tracker SOT2 si n_targets >= 2 (même classe, instance séparée)
    sot_tracker2 = None
    if n_targets >= 2:
        sot_tracker2 = SotCls()
        sot_tracker2.configure(cfg)
        log.info("SOT2 (clic droit) activé : tracker_sot=%s", tracker_sot_key)

    # --- Mode SOT-only : tracker_mot = null / "none" / "" ---
    _mot_is_none = tracker_mot_key is None or str(tracker_mot_key).strip().lower() in (
        "none",
        "null",
        "",
    )
    if _mot_is_none:
        detector_mot_key = cfg.get("detector_mot", "none").strip().lower()
        detector_roi_key = cfg.get("detector_roi", "none").strip().lower()
        # Avertissement si aucune source de bbox pour le SOT init
        if detector_mot_key in ("none", "") and detector_roi_key == "none":
            log.warning(
                "tracker_mot=null + detector_mot=none + detector_roi=none : "
                "aucune source de bbox pour init SOT. "
                "Les trackers point-only (sam2) fonctionnent quand meme. "
                "Sinon configurer detector_mot ou detector_roi."
            )
        log.info(
            "Trackers: MOT=None  detector_mot=%s  SOT=%s  SOT2=%s  detector_roi=%s",
            detector_mot_key,
            tracker_sot_key,
            "ON" if sot_tracker2 else "OFF",
            detector_roi_key,
        )
        _log_sot_hyperparams(cfg, tracker_sot_key, slot="SOT1")
        if sot_tracker2 is not None:
            _log_sot_hyperparams(cfg, tracker_sot_key, slot="SOT2")
        return None, sot_tracker, sot_tracker2

    # --- Mode normal : tracker MOT + tracker SOT ---
    MotCls = _load_class(MOT_REGISTRY, tracker_mot_key)
    mot_tracker = MotCls()
    mot_tracker.init(cfg)

    log.info(
        "Trackers: MOT=%s  SOT=%s  SOT2=%s  mot_background=%s  n_targets=%d",
        tracker_mot_key,
        tracker_sot_key,
        "ON" if sot_tracker2 else "OFF",
        cfg.get("mot_background", False),
        n_targets,
    )

    # Hyperparamètres MOT (debug)
    _log_mot_hyperparams(cfg, tracker_mot_key)
    _log_sot_hyperparams(cfg, tracker_sot_key, slot="SOT1")
    if sot_tracker2 is not None:
        _log_sot_hyperparams(cfg, tracker_sot_key, slot="SOT2")

    return mot_tracker, sot_tracker, sot_tracker2


def _log_mot_hyperparams(cfg: dict, key: str) -> None:
    """Log debug des hyperparamètres du tracker MOT sélectionné."""
    if key == "botsort":
        bs = cfg.get("botsort", {})
        log.debug(
            "[HYPERPARAMS MOT botsort] track_high=%.3f  track_low=%.3f  new_track=%.3f"
            "  buffer=%d  match=%.2f  proximity=%.2f  appearance=%.2f"
            "  with_reid=%s  cmc=%s",
            bs.get("track_high_thresh", 0.5),
            bs.get("track_low_thresh", 0.1),
            bs.get("new_track_thresh", 0.6),
            bs.get("track_buffer", 30),
            bs.get("match_thresh", 0.8),
            bs.get("proximity_thresh", 0.5),
            bs.get("appearance_thresh", 0.25),
            bs.get("with_reid", False),
            bs.get("cmc_method", "sparseOptFlow"),
        )
    elif key == "bytetrack":
        bt = cfg.get("bytetrack", {})
        log.debug(
            "[HYPERPARAMS MOT bytetrack] track_thresh=%.3f  track_buffer=%d"
            "  match_thresh=%.2f  min_box_area=%d",
            bt.get("track_thresh", 0.5),
            bt.get("track_buffer", 30),
            bt.get("match_thresh", 0.8),
            bt.get("min_box_area", 10),
        )
    elif key == "boosttrack":
        bk = cfg.get("boosttrack", {})
        log.debug(
            "[HYPERPARAMS MOT boosttrack] use_ecc=%s  track_thresh=%.3f"
            "  track_buffer=%d  match_thresh=%.2f",
            bk.get("use_ecc", False),
            bk.get("track_thresh", 0.5),
            bk.get("track_buffer", 30),
            bk.get("match_thresh", 0.8),
        )
    elif key == "custom_kalman":
        ck = cfg.get("kalman_mot_custom", {})
        log.debug(
            "[HYPERPARAMS MOT custom_kalman] max_age=%d  min_hits=%d"
            "  iou_thr=%.2f  dist_thr=%d  proc_noise=%g  meas_noise=%g  mahalanobis=%s",
            ck.get("max_age", 5),
            ck.get("min_hits", 2),
            ck.get("iou_threshold", 0.3),
            ck.get("dist_threshold", 100),
            ck.get("process_noise", 100),
            ck.get("measure_noise", 0.001),
            ck.get("use_mahalanobis", False),
        )


def _log_sot_hyperparams(cfg: dict, key: str, slot: str = "SOT") -> None:
    """Log debug des hyperparamètres du tracker SOT sélectionné."""
    kf = cfg.get("sot_kalman", {})
    kf_proc = kf.get("kf_process_noise", 10.0)
    kf_meas = kf.get("kf_measure_noise", 5.0)
    if key == "csrt":
        cs = cfg.get("csrt", {})
        log.debug(
            "[HYPERPARAMS %s csrt] psr_thr=%.1f  min_bbox=%dx%d  padding=%.1f"
            "  filter_lr=%.3f  scales=%d  template=%d"
            "  kf_proc=%.1f  kf_meas=%.1f",
            slot,
            cs.get("psr_threshold", 6.0),
            cs.get("min_width_px", 10),
            cs.get("min_height_px", 10),
            cs.get("padding", 3.0),
            cs.get("filter_lr", 0.02),
            cs.get("number_of_scales", 33),
            cs.get("template_size", 200),
            kf_proc,
            kf_meas,
        )
    elif key == "tracking_tophat":
        pc = cfg.get("tracking_tophat", {})
        log.debug(
            "[HYPERPARAMS %s tracking_tophat] mode=%s  tophat_kernels=%s  k_sigma=%s"
            "  feat_match_thr=%.2f  max_dist=%d  search_r=%d..%d"
            "  w_geom=%.2f  w_int=%.2f  w_bg=%.2f  w_mot=%.2f"
            "  kf_proc=%.1f  kf_meas=%.1f",
            slot,
            pc.get("mode", "tophat"),
            pc.get("tophat_kernels", [40]),
            pc.get("k_sigma_levels", [5]),
            pc.get("feature_match_threshold", 0.45),
            pc.get("max_dist_px", 40),
            pc.get("search_radius_px", 80),
            pc.get("max_search_radius_px", 160),
            pc.get("w_geometry", 0.20),
            pc.get("w_intensity", 0.20),
            pc.get("w_background", 0.15),
            pc.get("w_motion", 0.30),
            kf_proc,
            kf_meas,
        )
    elif key == "dummy":
        log.debug("[HYPERPARAMS %s dummy] (pas d'hyperparamètres)", slot)
    else:
        log.debug("[HYPERPARAMS %s %s] (pas de log détaillé pour ce tracker)", slot, key)


def build_input_handler(cfg: dict, seq_dir: str) -> tuple:
    """
    Construit le handler d'entrée selon le mode d'opération.

    Returns
    ######
    (click_handler, command_parser)
      En mode interactive : (ClickHandler, None)
      En mode command     : (None, CommandParser)
      En mode headless    : (None, None)
    """
    mode = cfg.get("mode", "headless")

    if mode == "interactive":
        from pipeline.click_handler import ClickHandler

        seq_name = Path(seq_dir).name if seq_dir else "session"
        # record_dir configurable (route les clics vers le workspace quand
        # le tracker est pilote par Inference_App) ; defaut = ROOT/cmd_send.
        _rec = cfg.get("record_dir")
        record_dir = Path(_rec) if _rec else ROOT / "cmd_send"
        record_dir.mkdir(parents=True, exist_ok=True)
        handler = ClickHandler(seq_name=seq_name, record_dir=record_dir)
        log.info("Interactive mode -- click log: %s", record_dir)
        return handler, None

    if mode == "command":
        from pipeline.command_parser import CommandParser

        clicks = cfg.get("clicks", "")
        if not clicks:
            raise ValueError("mode=command requiert 'clicks: <fichier>' dans le config.yaml")
        parser = CommandParser(clicks, delta=cfg.get("command_delta", 1))
        log.info("Command mode -- clicks file: %s", clicks)
        return None, parser

    return None, None  # headless


def build_visualizer(cfg: dict, run_dir: Path):
    """
    Construit le Visualizer si au moins un mode de rendu est actif.
    Retourne None (bench-only) si display=false, save_frames=false, save_video=false.
    """
    local_display = bool(cfg.get("local_display", False))
    save_frames = bool(cfg.get("save_frames", False))
    save_video = bool(cfg.get("save_video", True))
    stream_mode = str(cfg.get("stream_mode", "none"))

    if not any([local_display, save_frames, save_video, stream_mode == "mjpeg"]):
        log.info(
            "Bench-only: rendering disabled (local_display/save_frames/save_video/stream = off)"
        )
        return None

    from utils.visualizer import Visualizer, VisualizerConfig

    rnd = cfg.get("render", {})

    def _to_color_tuple(key, default):
        return tuple(int(v) for v in rnd.get(key, default))

    viz_cfg = VisualizerConfig(
        local_display=local_display,
        save_frames=save_frames,
        save_video=save_video,
        output_dir=run_dir,
        fps=float(cfg.get("fps", 10.0)),
        frame_ext=cfg.get("frame_ext", "png"),
        video_codec=cfg.get("codec", "mp4v"),
        show_raw_det=bool(cfg.get("show_raw_det", True)),
        show_gt=bool(cfg.get("show_gt", True)),
        show_tracks=bool(cfg.get("show_tracks", True)),
        show_legend=bool(cfg.get("show_legend", True)),
        trail_length=int(cfg.get("trail", 20)),
        debug_overlay=bool(cfg.get("debug_dialog_on_frames", False)),
        show_dets_in_sot=bool(cfg.get("show_dets_in_sot", False)),
        light_render=bool(cfg.get("light_render", False)),
        # --- Streaming réseau ---
        stream_mode=str(cfg.get("stream_mode", "none")),
        stream_host=str(cfg.get("stream_host", "0.0.0.0")),
        stream_port=int(cfg.get("stream_port", 8080)),
        stream_quality=int(cfg.get("stream_quality", 70)),
        stream_every=int(cfg.get("stream_every", 1)),
        # --- Epaisseurs (section render: du YAML) ---
        bbox_thickness=int(rnd.get("bbox_thickness", 1)),  # dets brutes/comp + GT
        mot_bbox_thickness=int(rnd.get("mot_bbox_thickness", 2)),  # tracks MOT (etat MOT pur)
        mot_bg_bbox_thickness=int(rnd.get("mot_bg_bbox_thickness", 1)),  # tracks MOT en fond SOT
        sot_bbox_thickness=int(rnd.get("sot_bbox_thickness", 3)),  # SOT1 (magenta)
        sot2_bbox_thickness=int(rnd.get("sot2_bbox_thickness", 3)),  # SOT2 (orange)
        click_radius=int(rnd.get("click_radius", 4)),
        click_thickness=int(rnd.get("click_thickness", 1)),
        # --- Couleurs BGR (section render: du YAML, format [B, G, R]) ---
        color_raw_det=_to_color_tuple("color_raw_det", [50, 50, 220]),
        color_mot_active=_to_color_tuple("color_mot_active", [50, 210, 50]),
        color_mot_predict=_to_color_tuple("color_mot_predict", [50, 130, 50]),
        color_sot_lock=_to_color_tuple("color_sot_lock", [255, 60, 220]),
        color_sot_miss=_to_color_tuple("color_sot_miss", [160, 30, 130]),
        color_sot2_lock=_to_color_tuple("color_sot2_lock", [0, 165, 255]),
        color_sot2_miss=_to_color_tuple("color_sot2_miss", [0, 100, 180]),
        color_gt=_to_color_tuple("color_gt", [220, 200, 30]),
    )
    return Visualizer(viz_cfg)


def load_ground_truth(cfg: dict) -> dict:
    """
    Load ground-truth annotations from a .ver or YOLO .txt file.
    Supports new key 'annotation_file' (preferred) with fallback to legacy 'ver_file'.
    Returns empty dict if no annotation file is configured or found.
    """
    # New key: annotation_file (supports .ver and .txt)
    # Fallback: ver_file (legacy, backward compatible)
    ann_file = cfg.get("annotation_file", "") or cfg.get("ver_file", "")
    if not ann_file:
        return {}

    ann_path = Path(ann_file) if Path(ann_file).is_absolute() else ROOT / ann_file
    if not ann_path.exists():
        log.warning("Annotation file not found: %s", ann_path)
        return {}

    from data.rejeu.annotation_loader import load_annotations

    gt = load_annotations(str(ann_path))
    log.info("GT loaded: %d annotated frames", len(gt))
    return gt
