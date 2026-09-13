##########################################
# Project  : VisionNexus
# File     : zmq_display_bridge.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Updated  : 2026-09-13
# Obj  : Bidirectional bridge with the generic C++ viewer (tools/zmq_cpp
#        --display) : sends annotations (Python -> C++, JSON) and receives
#        clicks (C++ -> Python, JSON). No port auto-discovery: host/ports
#        must match the C++ --anno-port/--click-port on both ends.
##########################################

import logging
import queue
import threading

import zmq

from .protocol import DEFAULT_ANNO_PORT, DEFAULT_CLICK_PORT, build_annotation, parse_click

log = logging.getLogger(__name__)

_DEFAULT_N_BOXES = 5


class ZmqDisplayBridge:
    """
    Pont bidirectionnel (JSON) entre le pipeline Python et le viewer C++
    generique (tools/zmq_cpp --display).

    - Annotations (Python -> C++) : PUSH connectee sur anno_port. Message JSON
      {"frame_id": int, "boxes": [{"x1","y1","x2","y2","b","g","r","label"}, ...]}
      Le C++ bind cette socket en PULL (display.hpp::DisplayManager) et dessine
      les boites (json_utils.hpp::parse_boxes).
      Ordre des boxes : SOT (par slot croissant) puis MOT (par score decroissant).
      n_boxes limite le nombre de boxes envoyees par frame (pas de limite cote
      protocole JSON, contrairement a l'ancien struct binaire de taille fixe).
    - Clics (C++ -> Python) : PULL connectee sur click_port. Message JSON
      {"frame_id": int, "type": "left"|"right"|"scroll", "x": int, "y": int}
      Le C++ bind cette socket en PUSH (display.hpp::on_mouse).

    Le C++ bind les deux ports ; Python se connecte directement au demarrage,
    aucune decouverte de port n'est necessaire (contrairement a l'ancien
    protocole a synchronisation dynamique).

    Interface publique du pont d'affichage ZMQ :
      send_annotations(frame_id, tracks, sot_active)
      pop_click() -> dict | None
      apply_clicks(frame_id, state_machine, ldv_buffer, cur_ldv,
                   compensator, frame_shape) -> str | None
      close()

    Parameters
    ----------
    host             IP du viewer C++ (defaut : "127.0.0.1")
    anno_port        Port annotations Python->C++ (defaut : DEFAULT_ANNO_PORT)
    click_port       Port clics C++->Python (defaut : DEFAULT_CLICK_PORT)
    colors           Dict couleurs BGR depuis section render: du YAML
    n_boxes          Nombre max de boxes envoyees par frame (defaut : _DEFAULT_N_BOXES)
    click_timeout_ms Timeout socket clic (ms)
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        anno_port: int = DEFAULT_ANNO_PORT,
        click_port: int = DEFAULT_CLICK_PORT,
        colors: dict | None = None,
        n_boxes: int | None = None,
        click_timeout_ms: int = 100,
    ):
        self._colors = colors or {}
        self._n_boxes = int(n_boxes) if n_boxes else _DEFAULT_N_BOXES
        self._click_queue: queue.Queue = queue.Queue(maxsize=32)
        self._running = threading.Event()
        self._running.set()

        # Contexte ZMQ dedie
        self._ctx = zmq.Context()

        # Socket annotation PUSH : Python envoie les bboxes vers le viewer C++ (PULL)
        self._anno_sock = self._ctx.socket(zmq.PUSH)
        self._anno_sock.set_hwm(4)
        self._anno_sock.connect(f"tcp://{host}:{anno_port}")

        # Socket clic PULL : Python recoit les clics depuis le viewer C++ (PUSH)
        self._click_sock = self._ctx.socket(zmq.PULL)
        self._click_sock.set_hwm(32)
        self._click_sock.setsockopt(zmq.RCVTIMEO, click_timeout_ms)
        self._click_sock.connect(f"tcp://{host}:{click_port}")

        self._thread = threading.Thread(
            target=self._click_recv_loop, daemon=True, name="vision_zmq_click_recv"
        )
        self._thread.start()

        log.info(
            "ZmqDisplayBridge: anno=tcp://%s:%d  clicks=tcp://%s:%d  n_boxes=%d",
            host,
            anno_port,
            host,
            click_port,
            self._n_boxes,
        )

    # ------------------------------------------------------------------ #
    # Thread de reception des clics                                        #
    # ------------------------------------------------------------------ #

    def _click_recv_loop(self) -> None:
        """Boucle daemon de reception des clics depuis le viewer C++.

        recv() bloque avec RCVTIMEO pour permettre de tester _running entre
        chaque appel et sortir proprement sur close().
        Si la queue est pleine, on ejecte le plus vieux clic (drop-oldest)
        pour ne pas bloquer et toujours conserver les clics les plus recents.
        """
        while self._running.is_set():
            try:
                raw = self._click_sock.recv()
            except zmq.Again:
                continue
            except Exception as exc:
                if self._running.is_set():
                    log.debug("ZmqDisplayBridge: click recv error: %s", exc)
                continue

            try:
                msg = parse_click(raw)
                ctype = msg.get("type", "left")
                click = {
                    "type": ctype,
                    "x": int(msg.get("x", 0)),
                    "y": int(msg.get("y", 0)),
                    "frame_id": int(msg.get("frame_id", -1)),
                }

                if self._click_queue.full():
                    try:
                        self._click_queue.get_nowait()
                    except queue.Empty:
                        pass
                self._click_queue.put_nowait(click)
                log.debug(
                    "ZmqDisplayBridge: clic type=%s (%d,%d) frame_id=%d",
                    ctype,
                    click["x"],
                    click["y"],
                    click["frame_id"],
                )
            except Exception as exc:
                log.debug("ZmqDisplayBridge: parse clic: %s", exc)

    # ------------------------------------------------------------------ #
    # Envoi des annotations                                                #
    # ------------------------------------------------------------------ #

    def _track_color(self, track) -> tuple[int, int, int]:
        """Retourne la couleur BGR (B, G, R) pour un track selon son etat de tracking.

        Priorite de selection de la cle couleur :
          SOT slot 2 + tsu=0  -> color_sot2_lock   (SOT2 verrouillee)
          SOT slot 2 + tsu>0  -> color_sot2_miss   (SOT2 perdue)
          SOT slot 1 + tsu=0  -> color_sot_lock    (SOT1 verrouillee)
          SOT slot 1 + tsu>0  -> color_sot_miss    (SOT1 perdue)
          MOT + tsu=0         -> color_mot_active  (MOT mis a jour ce frame)
          MOT + tsu>0         -> color_mot_predict (MOT en prediction Kalman)

        Les couleurs sont lues dans self._colors (section render: du YAML).
        Si une cle manque, on utilise la valeur par defaut hardcodee en fallback.
        """
        is_sot = getattr(track, "is_sot_target", False)
        slot = getattr(track, "sot_slot", 1)
        tsu = getattr(track, "time_since_update", 0)

        c = self._colors
        if is_sot and slot == 2:
            key = "color_sot2_lock" if tsu == 0 else "color_sot2_miss"
            default = (0, 165, 255) if tsu == 0 else (0, 100, 180)
        elif is_sot:
            key = "color_sot_lock" if tsu == 0 else "color_sot_miss"
            default = (255, 60, 220) if tsu == 0 else (160, 30, 130)
        else:
            key = "color_mot_active" if tsu == 0 else "color_mot_predict"
            default = (50, 210, 50) if tsu == 0 else (50, 130, 50)

        raw = c.get(key, default)
        return tuple(int(v) for v in raw)

    def _sorted_tracks(self, tracks) -> list:
        """Trie les tracks pour l'affichage et limite a self._n_boxes slots.

        Ordre garantit que les tracks les plus importantes occupent les premiers
        slots envoyes au C++ :
          1. Tracks SOT triees par sot_slot croissant (SOT1 en premier, SOT2 ensuite).
          2. Tracks MOT triees par score decroissant (meilleur score en premier)
             -> si n_boxes est atteint, ce sont les moins fiables qui sont tronquees.

        Utilise getattr avec fallback pour rester compatible avec tous les trackers
        (certains n'exposent pas score ou sot_slot).
        """
        sot = sorted(
            [t for t in tracks if getattr(t, "is_sot_target", False)],
            key=lambda t: getattr(t, "sot_slot", 1),
        )
        mot = sorted(
            [t for t in tracks if not getattr(t, "is_sot_target", False)],
            key=lambda t: getattr(t, "score", getattr(t, "conf", 0.0)),
            reverse=True,
        )
        return (sot + mot)[: self._n_boxes]

    def send_annotations(self, frame_id: int, tracks, sot_active: bool) -> None:
        """Encode et envoie les bboxes de tracking vers le viewer C++.

        Construit la liste JSON "boxes" (au plus n_boxes entrees, voir
        _sorted_tracks). L'envoi est non-bloquant (NOBLOCK) : si le HWM du
        socket est atteint (viewer C++ absent ou trop lent), le message est
        silencieusement abandonne pour ne jamais bloquer la boucle principale
        du pipeline.

        Args:
            frame_id:   frame_id de la frame traitee (reference pour le viewer C++).
            tracks:     liste de tracks (MOT/SOT), n'importe quel tracker VisionNexus.
            sot_active: non utilise directement (l'etat SOT est lu depuis track.is_sot_target).
        """
        selected = self._sorted_tracks(tracks)

        boxes: list[dict] = []
        for t in selected:
            try:
                x1, y1, x2, y2 = (int(v) for v in t.bbox)
                b, g, r = self._track_color(t)
                is_sot = getattr(t, "is_sot_target", False)
                slot = getattr(t, "sot_slot", 1)
                tid = getattr(t, "track_id", 0)
                label = f"SOT{slot}" if is_sot else str(tid)
                boxes.append(
                    {
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                        "b": b,
                        "g": g,
                        "r": r,
                        "label": label,
                    }
                )
            except Exception:
                continue

        try:
            payload = build_annotation(frame_id, boxes)
            self._anno_sock.send(payload, flags=zmq.NOBLOCK)
        except zmq.Again:
            pass  # viewer C++ absent ou buffer plein
        except Exception as exc:
            log.debug("ZmqDisplayBridge: send anno: %s", exc)

    # ------------------------------------------------------------------ #
    # Reception des clics                                                  #
    # ------------------------------------------------------------------ #

    def pop_click(self) -> dict | None:
        """Retourne le prochain clic en queue (non bloquant), ou None si vide.

        Le clic contient le frame_id de la frame affichee cote C++ au moment du
        clic, pas la frame courante Python. Utiliser apply_clicks() pour la
        reprojection LDV automatique.

        Returns:
            {"type": "left"|"right"|"scroll", "x": int, "y": int, "frame_id": int}
            ou None si aucun clic en attente.
        """
        try:
            return self._click_queue.get_nowait()
        except queue.Empty:
            return None

    def apply_clicks(
        self,
        frame_id: int,
        state_machine,
        ldv_buffer,
        cur_ldv,
        compensator,
        frame_shape: tuple,
    ) -> str | None:
        """Consomme le prochain clic et l'applique a la state machine avec reprojection LDV.

        Le viewer C++ affiche une frame en retard sur Python (latence annotation).
        Le clic porte donc un cfid < frame_id courant. On compense via :
          H = K * R_relative * K^-1  (ldv_click -> ldv_courant)
          (x, y) -> compensator.reproject_click_ldv(...)

        La reprojection est sautee si cfid == frame_id (clic sur la frame courante)
        ou si ldv_buffer ne contient pas cfid (trop ancien, > max_delay_frames).

        Actions selon le type de clic :
          "left"   -> state_machine.trigger_sot()   (SOT1)
          "right"  -> state_machine.trigger_sot2()  (SOT2)
          "scroll" -> state_machine.kill_all_sot()  (relache toutes les cibles)

        Returns:
            Texte de banniere "KILL SOT (molette ZMQ)" si scroll, None sinon.
        """
        click = self.pop_click()
        if click is None:
            return None

        x = int(click.get("x", 0))
        y = int(click.get("y", 0))
        ctype = click.get("type", "left")
        cfid = int(click.get("frame_id", frame_id))

        if ctype != "scroll" and cfid != frame_id:
            ldv_click = ldv_buffer.get(cfid)
            if ldv_click is not None and cur_ldv is not None:
                x, y = compensator.reproject_click_ldv(ldv_click, cur_ldv, (x, y), frame_shape)
            log.debug(
                "[F%05d] Clic ZMQ reprojete fid_click=%d delta=%d -> (%d,%d)",
                frame_id,
                cfid,
                frame_id - cfid,
                int(x),
                int(y),
            )

        if ctype == "scroll":
            state_machine.kill_all_sot()
            log.debug("[F%05d] Clic ZMQ type=%s fid_cpp=%d", frame_id, ctype, cfid)
            return "KILL SOT (molette ZMQ)"

        if ctype == "right":
            state_machine.trigger_sot2((int(x), int(y)), frame_id)
        else:
            state_machine.trigger_sot((int(x), int(y)), frame_id)
        log.debug(
            "[F%05d] Clic ZMQ type=%s (%d,%d) fid_cpp=%d delta=%d frames",
            frame_id,
            ctype,
            int(x),
            int(y),
            cfid,
            frame_id - cfid,
        )
        return None

    # ------------------------------------------------------------------ #
    # Fermeture propre                                                     #
    # ------------------------------------------------------------------ #

    def close(self) -> None:
        """Arrete le thread de reception des clics et ferme les sockets.

        _running.clear() fait sortir la boucle au prochain RCVTIMEO.
        On ferme les sockets avant join() car le thread peut etre bloque sur
        recv() avec un RCVTIMEO long ; fermer le socket le debloque immediatement.
        linger=0 : les messages en attente d'envoi sont abandonnes sans delai.
        """
        self._running.clear()
        self._anno_sock.close(linger=0)
        self._click_sock.close(linger=0)
        self._ctx.term()
        self._thread.join(timeout=2.0)
        log.info("ZmqDisplayBridge: ferme.")
