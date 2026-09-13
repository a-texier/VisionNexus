##########################################
# Project  : VisionNexus
# File     : session.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Orchestrates a full tracking session - main frame loop, metrics, benchmark JSON.
##########################################

from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np

from pipeline.builders import (
    build_detector_mot,
    build_detector_roi,
    build_input_handler,
    build_loader,
    build_trackers,
    build_visualizer,
    load_ground_truth,
)
from pipeline.ego_motion import (
    EgoMotionCompensator,
    FrameBuffer,
    LdvBuffer,
    _compute_image_homography,
)
from pipeline.state_machine import TrackerStateMachine
from profiling import build_profiler
from profiling.profiler import NullProfiler
from utils.logger import setup_file_logging, setup_log_panel

log = logging.getLogger(__name__)

# Racine du projet (pipeline/ est un niveau en dessous)
ROOT = Path(__file__).resolve().parent.parent


#################################
# Boucle principale
#################################


def _run_loop(
    cfg: dict,
    loader,
    detector,
    compensator: EgoMotionCompensator,
    state_machine: TrackerStateMachine,
    click_handler,
    command_parser,
    frame_buffer: FrameBuffer,
    ldv_buffer: LdvBuffer,
    gt_annotations: dict,
    viz,
    log_panel=None,
    mot_tracker=None,
    profiler=None,
    display_bridge=None,
) -> tuple[dict, list[float]]:
    """
    Boucle de tracking frame par frame.

    Gère la détection, la compensation ego-motion, les clics utilisateur
    (interactif ou command), le tracking MOT/SOT et le rendu.

    Parameters
    ########
    mot_tracker : instance BaseTracker du MOT actif.
        Utilisé pour interroger has_internal_cmc et get_last_homography() -
        évite la double compensation et le recalcul de H image.

    Returns
    ######
    (pred_per_frame, fps_times)
    """
    display = bool(cfg.get("local_display", False))
    prev_ldv = None
    _prev_frame = None
    _homography_method = cfg.get("homography_method_image", "")
    _min_inliers = int(cfg.get("min_inliers", 10))
    fps_times: list[float] = []
    pred_per_frame: dict = {}
    sot_active_per_frame: dict = {}  # frame_id -> bool (SOT actif ou non)
    # Accumulation pred_per_frame uniquement si annotations dispo ET compute_metrics=True
    _do_metrics: bool = bool(cfg.get("compute_metrics", True)) and bool(gt_annotations)

    #### Politique CMC - chaine de fallback 4 niveaux
    # Niv.1 LDV       : use_ldv_cmc=True ET LDV disponible -> H_ldv transmis au tracker
    # Niv.2 Intern.   : tracker.has_own_image_cmc=True (botsort GMC / boosttrack ECC)
    #                   -> H=None, le tracker calcule son propre H depuis l'image
    # Niv.3 H ext.    : homography_method_image configure (ORB/ECC externe)
    #                   -> H_image calcule par session.py et transmis au tracker
    # Niv.4 Aucune    : H=None, pas de compensation (camera fixe ou 1ere frame)
    #
    # H_image externe n'est calcule que si niveaux 1 ET 2 inactifs (evite surcoût inutile).
    # Les detections YOLO sont toujours brutes (Methode B : H sur etats Kalman uniquement).
    _use_ldv_cmc = bool(cfg.get("use_ldv_cmc", True))
    _tracker_has_own_cmc = mot_tracker is not None and mot_tracker.has_own_image_cmc
    _mot_background = bool(cfg.get("mot_background", False))

    # Log de la chaine CMC active - UNE SEULE FOIS au demarrage
    _lvl1 = f"LDV(use_ldv_cmc={'true' if _use_ldv_cmc else 'false'})"
    _lvl2 = (
        f"TRACKER_INTERNE({type(mot_tracker).__name__})"
        if _tracker_has_own_cmc
        else "TRACKER_INTERNE(non)"
    )
    _lvl3 = f"H_EXT_IMAGE({_homography_method})" if _homography_method else "H_EXT_IMAGE(non)"
    _lvl4 = "AUCUNE_CMC"
    log.debug("")
    log.debug("## CMC : chaine de fallback ##############################")
    log.debug(
        "  Niv.1 %-30s  <- LDV inertiell (prioritaire)",
        _lvl1,
    )
    log.debug(
        "  Niv.2 %-30s  <- CMC image interne tracker",
        _lvl2,
    )
    log.debug(
        "  Niv.3 %-30s  <- H image externe (ORB/ECC)",
        _lvl3,
    )
    log.debug(
        "  Niv.4 %-30s  <- pas de compensation",
        _lvl4,
    )

    # Ce qui sera RÉELLEMENT fait (premier niveau actif)
    if _use_ldv_cmc:
        _cmc_active_desc = "Niv.1 LDV prioritaire (si données LDV présentes dans métadonnées)"
    elif _tracker_has_own_cmc:
        _cmc_active_desc = f"Niv.2 CMC interne tracker ({type(mot_tracker).__name__})"
    elif _homography_method:
        _cmc_active_desc = f"Niv.3 H image externe ({_homography_method})"
    else:
        _cmc_active_desc = "Niv.4 aucune compensation (caméra fixe)"

    log.debug("  => Niveau ACTIF : %s", _cmc_active_desc)
    log.debug(
        "  Tracker MOT : %-20s  has_own_image_cmc=%s",
        type(mot_tracker).__name__ if mot_tracker else "None",
        _tracker_has_own_cmc,
    )
    log.debug("##########################################################")
    log.debug("")

    # Bannière de transition MOT ↔ SOT
    BANNER_TTL = 60
    banner_text = ""
    banner_ttl = 0
    prev_sot_state = False

    # Fenêtre cv2 pour le mode interactif
    if display and click_handler and viz is not None:
        import cv2

        # WINDOW_GUI_NORMAL désactive la toolbar Qt et le menu clic droit
        # (WINDOW_GUI_EXPANDED=0 est le défaut Qt -> il ouvre un menu "paramètres"
        #  au clic droit, bloque le flux et intercepte nos clics SOT2)
        _win_flags = cv2.WINDOW_AUTOSIZE | getattr(cv2, "WINDOW_GUI_NORMAL", 16)
        cv2.namedWindow(viz.cfg.window_name, _win_flags)
        cv2.setMouseCallback(viz.cfg.window_name, click_handler.callback)

    # Ensure profiler is never None inside the loop (use NullProfiler if absent)
    if profiler is None:
        profiler = NullProfiler()
    _prof = profiler

    _loop_t0 = time.perf_counter()  # wall-clock total (inclut lecture loader)
    _frame_wall_t = time.perf_counter()  # début de ce frame (avant loader.__next__)
    fps_wall_times: list[float] = []  # temps wall-clock par frame (loader + traitement)

    try:
        for frame_id, frame, meta in loader:
            _frame_wall_end = time.perf_counter()
            t0 = time.perf_counter()

            #### Mise à jour des buffers [profiling: frame_load]
            with _prof.section("frame_load"):
                frame_buffer.push(frame_id, frame)
                cur_ldv = meta.get("ldv")  # (az_deg, el_deg, roulis_deg) ou None
                ldv_buffer.push(frame_id, cur_ldv)
                compensator.update_fov_from_meta(meta)  # met à jour HFOV/VFOV si disponibles

            #### Détection YOLO [profiling: detect_mot]
            # Optimisation : détecteur MOT inutile en SOT si mot_background=false
            # (le tracker MOT ne tourne pas, les detections ne seraient pas consommees).
            # Exception : fenêtre keepalive dual-SOT (n_targets=2) -> le MOT reste
            # actif quelques secondes pour permettre le 2e clic sur une bbox MOT.
            # La décision est centralisée dans la state machine (cohérence garantie
            # avec le should_run_mot interne de update()).
            _run_mot_det = state_machine.should_run_mot_detection()
            with _prof.section("detect_mot"):
                raw_dets = detector.detect(frame, frame_id) if _run_mot_det else []

            #### Ego-motion : calcul H_ldv (inertiel) [profiling: ldv_cmc]
            H_ldv = None
            with _prof.section("ldv_cmc"):
                if cur_ldv and prev_ldv:
                    H_ldv = compensator.build_homography(prev_ldv, cur_ldv, frame.shape)

            # H_image externe [profiling: image_cmc]
            # Calcule uniquement si niveaux 1 (LDV) ET 2 (CMC interne tracker) inactifs.

            _need_H_image = (
                bool(_homography_method)
                and _prev_frame is not None
                and not (_use_ldv_cmc and H_ldv is not None)  # niveau 1 inactif
                and not _tracker_has_own_cmc  # niveau 2 inactif
            )

            H_image = None
            with _prof.section("image_cmc"):
                if _need_H_image:
                    try:
                        H_image = _compute_image_homography(
                            _prev_frame,
                            frame,
                            _homography_method,
                            _min_inliers,
                        )
                    except Exception as _he:
                        log.debug("[F%05d] H_image echec : %s", frame_id, _he)
                        H_image = None

            # Chaine de fallback CMC 4 niveaux :
            if _use_ldv_cmc and H_ldv is not None:
                # Niveau 1 : H inertiel LDV -> bypass total CMC image
                H_cmc = H_ldv
            elif _tracker_has_own_cmc:
                # Niveau 2 : CMC interne tracker (sparseOptFlow / ECC)
                # Exception : 1ere frame quand LDV actif ET donnees presentes mais
                # prev_ldv pas encore rempli -> on passe eye(3) pour ne pas declencher
                # l'optical flow sur une premiere frame potentiellement noire.
                # cur_ldv is not None garantit que la condition ne tire pas en permanence
                # quand LDV est absent de toute la sequence (prev_ldv resterait None).
                if _use_ldv_cmc and cur_ldv is not None and prev_ldv is None:
                    H_cmc = np.eye(3, dtype=np.float64)
                else:
                    H_cmc = None
            elif H_image is not None:
                # Niveau 3 : H image externe (ORB/ECC externe calcule ci-dessus)
                H_cmc = H_image
            else:
                # Niveau 4 : aucune compensation (camera fixe, 1ere frame, LDV absent)
                H_cmc = None

            # H_dets : best H available for click reprojection (LDV > H_image).
            # use_ldv_cmc=False -> on exclut H_ldv même pour les clics
            H_dets = (H_ldv if H_ldv is not None else H_image) if _use_ldv_cmc else H_image

            # Log per-frame : source H réellement utilisée et diagnostic LDV
            if log.isEnabledFor(logging.DEBUG):
                # Diagnostic LDV : use_ldv_cmc=True mais pas de données LDV
                if _use_ldv_cmc and cur_ldv is None:
                    log.debug(
                        "[F%05d] CMC | use_ldv_cmc=True mais LDV absent (métadonnées vides)"
                        " -> fallback Niv.%s",
                        frame_id,
                        "2" if _tracker_has_own_cmc else ("3" if _homography_method else "4"),
                    )
                elif _use_ldv_cmc and prev_ldv is None:
                    log.debug(
                        "[F%05d] CMC | LDV présent mais première frame (prev_ldv=None)"
                        " -> H_ldv=None cette frame",
                        frame_id,
                    )

                # Source H effective
                if _use_ldv_cmc and H_ldv is not None:
                    _h_src = "LDV (Niv.1)"
                elif _tracker_has_own_cmc:
                    _h_src = f"TRACKER_INTERNE (Niv.2, {type(mot_tracker).__name__})"
                elif H_image is not None:
                    _h_src = f"H_IMAGE (Niv.3, {_homography_method})"
                else:
                    _h_src = "AUCUNE (Niv.4)"

                log.debug(
                    "[F%05d] CMC | H_actif=%-30s",
                    frame_id,
                    _h_src,
                )

            prev_ldv = cur_ldv
            _prev_frame = frame

            #### Clics interactifs
            if click_handler:
                _b = click_handler.apply_clicks(frame_id, state_machine)
                if _b:
                    banner_text, banner_ttl = _b, BANNER_TTL

            #### Clics ZMQ (headless + tcp)
            if display_bridge is not None:
                _b = display_bridge.apply_clicks(
                    frame_id,
                    state_machine,
                    ldv_buffer,
                    cur_ldv,
                    compensator,
                    frame.shape,
                )
                if _b:
                    banner_text, banner_ttl = _b, BANNER_TTL

            #### Commandes fichier
            _recent_cmd_clicks = (
                command_parser.apply_commands(
                    frame_id,
                    frame,
                    state_machine,
                    ldv_buffer,
                    cur_ldv,
                    compensator,
                    frame_buffer,
                    H_dets,
                    _homography_method,
                    _min_inliers,
                )
                if command_parser
                else []
            )

            #### Tracking MOT/SOT [profiling: mot_update / sot_update]
            _cur_state = state_machine.get_state()
            _prof_section = "sot_update" if _cur_state == "SOT" else "mot_update"
            with _prof.section(_prof_section):
                tracks = state_machine.update(frame, frame_id, raw_dets, H=H_cmc)
            if _do_metrics:
                pred_per_frame[frame_id] = tracks
                sot_active_per_frame[frame_id] = state_machine.get_state() == "SOT"

            #### Détection des transitions MOT ↔ SOT
            cur_sot_state = state_machine.get_state() == "SOT"

            if cur_sot_state and not prev_sot_state:
                sot_trk = next((t for t in tracks if t.track_id == 0), None)
                if sot_trk is not None:
                    x1, y1, x2, y2 = sot_trk.bbox
                    cx_s = int((x1 + x2) / 2)
                    cy_s = int((y1 + y2) / 2)
                    banner_text = f"SOT triggered ({cx_s}, {cy_s})"
                else:
                    banner_text = "SOT triggered"
                banner_ttl = BANNER_TTL
            elif not cur_sot_state and prev_sot_state:
                banner_text = "<- Back to MOT"
                banner_ttl = BANNER_TTL

            if banner_ttl > 0:
                banner_ttl -= 1
            else:
                banner_text = ""

            prev_sot_state = cur_sot_state

            #### Envoi annotations vers viewer C++ (mode headless + tcp)
            # En mode headless, viz=None : aucun rendu Python.
            # Les bboxes sont envoyées au viewer C++ (--display) qui dessine
            # les incrustations sur ses frames en buffer et fait imshow.
            if display_bridge is not None and viz is None:
                display_bridge.send_annotations(frame_id, tracks, cur_sot_state)

            #### Rendu [profiling: render]
            with _prof.section("render"):
                if viz is not None:
                    gt_boxes = gt_annotations.get(frame_id, [])
                    viz.render(
                        frame,
                        raw_dets,
                        tracks,
                        gt_boxes,
                        frame_id,
                        H_dets,
                        click_handler=click_handler,
                        sot_active=cur_sot_state,
                        event_text=banner_text,
                        log_panel=log_panel,
                        extra_clicks=_recent_cmd_clicks,
                    )
                    # Consommer les actions clavier (touche M locale ou réseau)
                    for _action in viz.pop_actions():
                        if _action == "toggle_mot_background":
                            _mot_background = not _mot_background
                            state_machine.set_mot_background(_mot_background)
                            banner_text = f"[M] mot_background -> {'ON (MOT en fond)' if _mot_background else 'OFF (MOT en veille)'}"
                            banner_ttl = BANNER_TTL
                            log.info("Touche M : mot_background -> %s", _mot_background)

            ##### Clics et touches reçus via réseau (MJPEGServer inbound) ####
            if viz is not None and viz._stream_server is not None:
                _srv = viz._stream_server
                for _nc in _srv.pop_clicks():
                    _nb = _nc.get("button", 0)
                    if _nb == 1:
                        state_machine.kill_all_sot()
                        banner_text, banner_ttl = "KILL SOT (molette reseau)", BANNER_TTL
                    elif click_handler is not None:
                        if _nb == 2:
                            click_handler.inject_right_click(frame_id, _nc["x"], _nc["y"])
                        else:
                            click_handler.inject_click(frame_id, _nc["x"], _nc["y"])
                    log.debug(
                        "Clic réseau btn=%d : (%d,%d) frame=%d", _nb, _nc["x"], _nc["y"], frame_id
                    )
                for _nk in _srv.pop_keys():
                    if _nk == "m":
                        _mot_background = not _mot_background
                        state_machine.set_mot_background(_mot_background)
                        banner_text = f"[M net] mot_bg -> {'ON' if _mot_background else 'OFF'}"
                        banner_ttl = BANNER_TTL
                        log.info("Touche M réseau : mot_background -> %s", _mot_background)
                    elif _nk == "r" and click_handler is not None:
                        click_handler.toggle_record()
                    elif _nk == "q":
                        raise KeyboardInterrupt("q réseau (opérateur distant)")

            frame_total = time.perf_counter() - t0
            # wall-clock = temps loader (lecture optional_format) + temps traitement
            frame_wall = (_frame_wall_end - _frame_wall_t) + frame_total
            fps_times.append(frame_total)  # processing seul -> profiler
            fps_wall_times.append(frame_wall)  # wall-clock -> fps réel
            _prof.end_frame(frame_id, total_s=frame_total)
            _frame_wall_t = time.perf_counter()  # reset pour le prochain frame

    except KeyboardInterrupt:
        log.info("Tracking interrompu (Ctrl+C ou touche q).")
    finally:
        if click_handler is not None:
            click_handler.close()

    return pred_per_frame, sot_active_per_frame, fps_times, fps_wall_times


#################################
# Métriques et sortie benchmark
#################################


def compute_metrics(
    pred_per_frame: dict,
    gt_annotations: dict,
    sot_active_per_frame: dict = None,
    n_sot_losses: int = 0,
    n_sot_inits: int = 0,
    n_sot2_losses: int = 0,
    n_sot2_inits: int = 0,
    iou_decrochage: float = 0.2,
    iou_threshold: float = 0.1,
) -> dict:
    """
    Calcule les metriques MOT/SOT sur la sequence, separees par mode.

    En mode MOT (frame non-SOT) : toutes les tracks predites vs tous les GT.
    En mode SOT (frame SOT)     : uniquement la track SOT (is_sot_target=True)
                                  vs tous les GT.
    Retourne un dict avec cles globales + sous-dicts "mot", "sot" et "sot2" (si dual SOT).
    """
    if not (gt_annotations and pred_per_frame):
        return {}
    try:
        from utils.metrics import compute_mot_metrics

        return compute_mot_metrics(
            pred_per_frame,
            gt_annotations,
            sot_active_per_frame=sot_active_per_frame or {},
            n_sot_losses=n_sot_losses,
            n_sot_inits=n_sot_inits,
            n_sot2_losses=n_sot2_losses,
            n_sot2_inits=n_sot2_inits,
            iou_decrochage=iou_decrochage,
            iou_threshold=iou_threshold,
        )
    except Exception as exc:
        log.warning("Metrics computation failed: %s", exc)
        return {}


def write_benchmark(
    cfg: dict,
    run_dir: Path,
    n_frames: int,
    duration_s: float,
    fps_mean: float,
    fps_min: float,
    fps_wall_mean: float = 0.0,
    metrics: dict = None,
) -> dict:
    """
    Ecrit benchmark.json dans run_dir/benchmark/ et genere les plots metriques.
    Retourne le dict complet.

    fps_mean      = FPS processing seul (loader optional_format exclu)
    fps_wall_mean = FPS total (loader + traitement, taux réel de la séquence)
    """
    if metrics is None:
        metrics = {}
    fps_sequence = float(cfg.get("fps", 10.0))  # FPS source caméra (pas un objectif perf)
    data = {
        "run_dir": str(run_dir),
        "tracker_mot": cfg.get("tracker_mot"),
        "tracker_sot": cfg.get("tracker_sot"),
        "run_name": cfg.get("run_name", ""),
        "n_frames": n_frames,
        "duration_s": round(duration_s, 2),
        "fps_proc": round(fps_mean, 1),  # processing pipeline seul (loader exclu)
        "fps_total": round(fps_wall_mean, 1),  # avec loader optional_format (taux réel séquence)
        "fps_min": round(fps_min, 1),
        "fps_sequence": fps_sequence,  # FPS source caméra de la séquence
        "real_time": bool(fps_mean >= fps_sequence),
        "has_gt": bool(metrics),
        **metrics,
    }

    # Dossier benchmark/ dans le run_dir
    bm_dir = run_dir / "benchmark"
    bm_dir.mkdir(exist_ok=True)

    from utils.metrics import dump_benchmark_json

    bm_path = bm_dir / "benchmark.json"
    dump_benchmark_json(data, bm_path)

    # Plots metriques si GT disponible
    if metrics:
        try:
            from utils.metrics import generate_metrics_plots

            created = generate_metrics_plots(metrics, data, bm_dir)
            for p in created:
                log.info("  plot -> %s", p.name)
        except Exception as exc:
            log.warning("Metrics plot generation failed: %s", exc)

    return data


#################################
# Point d'entrée principal de la session
#################################


def run_session(cfg: dict, run_dir: Path) -> dict:
    """
    Orchestre une session de tracking complète.

    Construit tous les composants depuis le dictionnaire de configuration,
    exécute la boucle principale, calcule les métriques et écrit benchmark.json.
    """
    seq_dir = cfg["sequence_dir"]
    fps_sequence = float(cfg.get("fps", 10.0))  # FPS source de la séquence (caméra)

    setup_file_logging(run_dir, level=logging.DEBUG)

    #### Log panel
    debug_overlay = bool(cfg.get("debug_dialog_on_frames", False))
    log_panel = None
    if debug_overlay:
        from utils.debug_panel import LogPanel

        log_panel = LogPanel(
            width=int(cfg.get("debug_panel_width", 420)),
            max_lines=80,
        )
        setup_log_panel(log_panel.handler)
        log.info("Log panel enabled  (width=%d)", log_panel._width)

    log.info("")
    log.info("-" * 60)
    log.info(
        "  SESSION  |  mot=%-12s | sot=%-8s | mode=%s",
        cfg.get("tracker_mot", "?"),
        cfg.get("tracker_sot", "?"),
        cfg.get("mode", "headless"),
    )
    log.info(
        "           |  mot_background=%-5s | n_targets=%d",
        cfg.get("mot_background", False),
        cfg.get("n_targets", 1),
    )
    log.info("-" * 60)
    log.info("")

    #### Injection du chemin debug_tracking dans cfg (Step 1 : toujours sous run_dir)
    # On travaille sur une copie pour ne pas polluer le dict YAML original.
    cfg = dict(cfg)
    cfg["_debug_dir"] = str(run_dir / "debug_tracking")

    log.info("## INIT composants ######################################")
    log.info("")

    #### Composants
    # Detector en premier : warmup YOLO avant l'ouverture de la connexion ZMQ
    detector = build_detector_mot(cfg)
    detector.warmup()
    loader = build_loader(cfg)
    compensator = (
        EgoMotionCompensator()
    )  # FOV mis à jour frame par frame via update_fov_from_meta(meta)

    mot_tracker, sot_tracker, sot_tracker2 = build_trackers(cfg)

    roi_detector = build_detector_roi(cfg)
    _det_mot_key = str(cfg.get("detector_mot", "none")).strip().lower()
    state_machine = TrackerStateMachine(
        mot_tracker=mot_tracker,
        sot_tracker=sot_tracker,
        mot_background=bool(cfg.get("mot_background", False)),
        sot_loss_threshold=int(cfg.get("sot_loss_threshold", 10)),
        sot_click_max_dist_px=float(cfg.get("sot_click_max_dist_px", 0.0)),
        roi_detector=roi_detector,
        sot_tracker2=sot_tracker2,
        mot_keepalive_after_sot_s=float(cfg.get("mot_keepalive_after_sot_s", 2.0)),
        has_mot_detector=(_det_mot_key not in ("none", "")),
    )

    click_handler, command_parser = build_input_handler(cfg, seq_dir)

    max_delay = cfg.get("max_delay_frames", 30)
    frame_buffer = FrameBuffer(max_delay=max_delay)
    ldv_buffer = LdvBuffer(max_delay=max_delay)

    gt_annotations = load_ground_truth(cfg)
    viz = build_visualizer(cfg, run_dir)
    profiler = build_profiler(cfg, run_dir)

    #### Niveau de log console (depuis log_level: dans le YAML)
    log_level_str = cfg.get("log_level", "INFO").upper()
    log_level_int = getattr(logging, log_level_str, logging.INFO)
    from utils.logger import apply_console_log_level  # must stay lazy (called after logger setup)

    apply_console_log_level(log_level_int)
    log.info("Log level console : %s", log_level_str)

    try:
        n_frames = len(loader)
        log.info(
            "Loader  : %d frames  fps_sequence=%.1f  resolution=%s",
            n_frames,
            loader.get_fps(),
            loader.get_resolution(),
        )
    except TypeError:
        # _NetworkLoaderWrapper n'a pas de __len__ (flux réseau, taille inconnue)
        log.info("Loader (stream réseau)  fps_sequence=%.1f", loader.get_fps())
    if profiler.enabled:
        log.info("Profiler: ACTIF -> rapport HTML dans %s", run_dir / "profiling.html")

    log.info("")
    log.info("## BOUCLE PRINCIPALE ####################################")
    log.info("")
    log.info("Pipeline prêt. Démarrage boucle principale.")

    #### Boucle principale
    # Récupère le pont ZMQ bidirectionnel si le loader est un flux tcp+headless.
    # Injecte les annotations (Python->C++) et les clics opérateur (C++->Python).
    _display_bridge = getattr(loader, "display_bridge", None)

    pred_per_frame, sot_active_per_frame, fps_times, fps_wall_times = _run_loop(
        cfg,
        loader,
        detector,
        compensator,
        state_machine,
        click_handler,
        command_parser,
        frame_buffer,
        ldv_buffer,
        gt_annotations,
        viz,
        log_panel=log_panel,
        mot_tracker=mot_tracker,
        profiler=profiler,
        display_bridge=_display_bridge,
    )

    #### FPS processing seul (loader exclu - artefact de rejeu, base du benchmark)
    # Calculé ici avant generate_report (qui en a besoin) et avant viz.close()
    fps_arr = np.array(fps_times) if fps_times else np.array([1.0])
    fps_proc = float(1.0 / fps_arr.mean())  # FPS pipeline sans overhead loader
    fps_min = float(1.0 / fps_arr.max())

    #### FPS total (loader + traitement = taux réel de lecture de la séquence)
    _wall_arr = np.array(fps_wall_times) if fps_wall_times else None
    fps_total = float(1.0 / _wall_arr.mean()) if _wall_arr is not None else 0.0

    #### Profiling report
    profiler.generate_report(
        fps_wall_mean=fps_total,
        fps_wall_per_frame=fps_wall_times,
    )

    #### Clôture detecteur (ferme la video binaire debug tophat_mot si active)
    if hasattr(detector, "close"):
        detector.close()

    #### Clôture loader (libère VideoCapture si MP4/AVI)
    if hasattr(loader, "close"):
        loader.close()

    #### Clôture
    if viz is not None:
        summary = viz.close()
    else:
        summary = {
            "n_frames": len(fps_times),
            "duration_s": sum(fps_times),
        }

    #### Compteurs SOT (depuis state_machine)
    n_sot_losses = state_machine.get_n_losses()
    n_sot_inits = state_machine.get_n_inits()
    n_sot2_losses = state_machine.get_n_sot2_losses()
    n_sot2_inits = state_machine.get_n_sot2_inits()

    #### Métriques MOT + SOT separees
    metrics = compute_metrics(
        pred_per_frame,
        gt_annotations,
        sot_active_per_frame,
        n_sot_losses=n_sot_losses,
        n_sot_inits=n_sot_inits,
        n_sot2_losses=n_sot2_losses,
        n_sot2_inits=n_sot2_inits,
        iou_decrochage=float(cfg.get("iou_decrochage", 0.2)),
        iou_threshold=float(cfg.get("metrics_iou_threshold", 0.1)),
    )
    benchmark = write_benchmark(
        cfg,
        run_dir,
        n_frames=summary["n_frames"],
        duration_s=summary["duration_s"],
        fps_mean=fps_proc,
        fps_min=fps_min,
        fps_wall_mean=fps_total,
        metrics=metrics,
    )

    log.info("")
    log.info("## SYNTHÈSE #############################################")
    log.info("")

    #### Log de synthèse
    bm_dir = run_dir / "benchmark"
    log.info("=" * 60)
    log.info("Frames   : %d", summary["n_frames"])
    log.info("Duration : %.1f s", summary["duration_s"])
    log.info(
        "FPS proc : %.1f  (séquence %.1f fps) - processing pipeline seul", fps_proc, fps_sequence
    )
    if fps_total > 0:
        log.info(
            "FPS total: %.1f  - avec lecture loader (optional_format,mp4...) (taux réel séquence)", fps_total
        )
    if metrics:
        mot_m = metrics.get("mot", {})
        sot_m = metrics.get("sot", {})
        sot2_m = metrics.get("sot2", None)
        _iou_d = float(cfg.get("iou_decrochage", 0.2))
        log.info(
            "MOT | MOTA=%.3f  IDF1=%.3f  IDSW=%d  TP=%d  FP=%d  FN=%d  frames=%d  id_frags=%d",
            mot_m.get("mota", 0),
            mot_m.get("idf1", 0),
            mot_m.get("idsw", 0),
            mot_m.get("tp", 0),
            mot_m.get("fp", 0),
            mot_m.get("fn", 0),
            mot_m.get("n_frames", 0),
            mot_m.get("id_frags", 0),
        )
        log.info(
            "SOT | MOTA=%.3f  IDF1=%.3f  IDSW=%d  TP=%d  FP=%d  FN=%d"
            "  frames=%d  losses=%d/%d  decrochages=%d(IOU<%.1f)  id_frags=%d",
            sot_m.get("mota", 0),
            sot_m.get("idf1", 0),
            sot_m.get("idsw", 0),
            sot_m.get("tp", 0),
            sot_m.get("fp", 0),
            sot_m.get("fn", 0),
            sot_m.get("n_frames", 0),
            n_sot_losses,
            n_sot_inits,
            sot_m.get("n_decrochages", 0),
            _iou_d,
            sot_m.get("id_frags", 0),
        )
        if sot2_m is not None:
            log.info(
                "SOT2| MOTA=%.3f  IDF1=%.3f  IDSW=%d  TP=%d  FP=%d  FN=%d"
                "  frames=%d  decrochages=%d(IOU<%.1f)  id_frags=%d",
                sot2_m.get("mota", 0),
                sot2_m.get("idf1", 0),
                sot2_m.get("idsw", 0),
                sot2_m.get("tp", 0),
                sot2_m.get("fp", 0),
                sot2_m.get("fn", 0),
                sot2_m.get("n_frames", 0),
                sot2_m.get("n_decrochages", 0),
                _iou_d,
                sot2_m.get("id_frags", 0),
            )
        log.info(
            "GLB | MOTA=%.3f  IDF1=%.3f  IDSW=%d",
            metrics.get("mota", 0),
            metrics.get("idf1", 0),
            metrics.get("idsw", 0),
        )
    if summary.get("frames_dir"):
        log.info("Frames   : %s", summary["frames_dir"])
    if summary.get("video_path"):
        log.info("Video    : %s", summary["video_path"])
    log.info("Benchmark: %s", bm_dir)
    log.info("=" * 60)

    return benchmark
