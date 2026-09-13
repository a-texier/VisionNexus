##########################################
# Project  : VisionNexus
# File     : utils/metrics/core.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Computes MOT/SOT metrics (MOTA, IDF1, IDSW) separately per tracking mode.
##########################################

import logging
import math

log = logging.getLogger(__name__)


#################################
# IoU
#################################


def iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a[:4]
    bx1, by1, bx2, by2 = b[:4]
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    iw = max(0.0, ix2 - ix1)
    ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


#################################
# Helpers internes
#################################


def _centroid(bbox: list[float]) -> tuple:
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def _cdist(a: list[float], b: list[float]) -> float:
    ax, ay = _centroid(a)
    bx, by = _centroid(b)
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def _diag(bbox: list[float]) -> float:
    """Diagonale (px) d'une bbox [x1, y1, x2, y2]."""
    return math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1])


#################################
# Calcul sur un ensemble de frames
#################################


def _compute_mode(
    frames_data: list,  # [(preds, gts), ...] ordre chronologique
    iou_threshold: float,
    iou_decrochage: float = 0.2,
    frame_ids: list[int] | None = None,  # indices absolus correspondant a frames_data
) -> dict:
    """
    Calcule MOTA / IDF1 / IDSW sur une liste (preds, gts).

    preds : liste de Track (.bbox, .track_id, .score)
    gts   : liste de tuples (cls, x1, y1, x2, y2 [, track_id])
              - 5-tuple : YOLO, gt_id = index local frame (non persistant)
              - 6-tuple : .ver,  gt_id = ID unique sequence (persistant)

    frame_ids : si fourni, utilise comme index absolu pour centroid_dists et active_frames.
                Permet aux plots HTML d'aligner les donnees sur l'axe X global.
    """
    tp = fp = fn = idsw = n_gt = 0
    last_match: dict[int, int] = {}  # gt_id -> pred_tid (IDSW)
    gt_track_ids: dict[int, set] = {}  # gt_id -> set de track_ids vus
    per_gt_idsw: dict[int, int] = {}  # gt_id -> n switch events

    per_frame_tp: list[int] = []
    per_frame_fp: list[int] = []
    per_frame_fn: list[int] = []

    # {track_id: [(abs_frame_idx, dist_px), ...]}
    centroid_dists: dict[int, list[tuple[int, float]]] = {}

    det_scores: list[float] = []
    det_labels: list[int] = []
    # Diagonale (px) associee a chaque detection de det_scores/det_labels :
    #   - TP (label 1) -> diagonale de la bbox GT appariee
    #   - FP (label 0) -> -1.0 (aucun GT associe a une fausse alarme)
    # Permet les plots par bande de taille (confusion 15-40 px).
    det_gt_diag: list[float] = []
    # Meilleur IoU de CHAQUE detection avec un GT de sa frame (0 si aucun), et
    # l'index local (par frame) de ce GT (-1 si aucun). Permet de RE-CALCULER
    # TP/FP a n'importe quel seuil IoU au moment du build/plot (voir
    # relabel_metrics_at_iou), sans stocker les per_frame_tp figes.
    det_iou: list[float] = []
    det_gt_id: list[int] = []
    # Frame absolue de chaque detection de det_scores (pour recompter TP/FP/TN a
    # un seuil de score donne, notamment les TN = frames sans GT et sans detection).
    det_frames: list[int] = []
    # Diagonale (px) de CHAQUE GT vu (TP + FN) -> population de reference pour
    # les denominateurs par bande de taille.
    gt_diags: list[float] = []
    n_gt_per_frame: list[int] = []
    iou_vals: list[float] = []  # IoU de chaque match TP (un par detection retenue)
    iou_per_frame: dict[int, float] = {}  # abs_frame -> best IoU pour frames avec gts+preds

    # Timeline {gt_id: [(frame_idx, track_id)]} pour le plot de stabilite ID
    gt_id_timeline: dict[int, list[tuple[int, int]]] = {}

    # Frames annotees par GT (TP + FN) pour le plot de couverture
    gt_ann_frames: dict[int, list[int]] = {}

    # Decrochage
    n_decrochages = 0
    in_decrochage = False
    n_miss = 0  # frames : GT present, aucune prediction (tracker perdu)
    n_iou_zero = 0  # frames : GT + preds presents, mais IoU max = 0 (mauvaise cible)
    n_iou_sub_thresh = 0  # frames : GT + preds presents, IoU max < iou_threshold

    # Detecte si les GT ont des IDs persistants (.ver) ou non (YOLO)
    has_persistent_gt_ids = False

    for frame_idx, (preds, gts) in enumerate(frames_data):
        abs_frame = frame_ids[frame_idx] if frame_ids else frame_idx

        pred_bboxes = [t.bbox for t in preds]
        pred_ids = [t.track_id for t in preds]
        pred_scores = [getattr(t, "score", 1.0) for t in preds]
        matched_pr = set()

        n_gt += len(gts)
        n_gt_per_frame.append(len(gts))
        f_tp = f_fn = 0
        _best_iou_frame = 0.0  # meilleur IoU TP (>= iou_threshold)
        _raw_best_iou = 0.0  # meilleur IoU reel toutes paires (pour affichage)

        for gi, gt in enumerate(gts):
            gt_bbox = list(gt[1:5])
            if len(gt) > 5:
                gt_id = int(gt[5])
                has_persistent_gt_ids = True
            else:
                gt_id = gi  # YOLO : index local, pas persistant cross-frame

            gt_ann_frames.setdefault(gt_id, []).append(abs_frame)
            gt_diags.append(_diag(gt_bbox))

            best_iou = iou_threshold
            best_pi = -1

            for pi, pb in enumerate(pred_bboxes):
                if pi in matched_pr:
                    continue
                v = iou(gt_bbox, pb)
                if v > _raw_best_iou:
                    _raw_best_iou = v  # trace le vrai max toutes paires
                if v > best_iou:
                    best_iou = v
                    best_pi = pi

            if best_pi >= 0:
                tp += 1
                f_tp += 1
                matched_pr.add(best_pi)
                pred_tid = pred_ids[best_pi]

                if last_match.get(gt_id, pred_tid) != pred_tid:
                    idsw += 1
                    per_gt_idsw[gt_id] = per_gt_idsw.get(gt_id, 0) + 1
                last_match[gt_id] = pred_tid

                gt_track_ids.setdefault(gt_id, set()).add(pred_tid)
                gt_id_timeline.setdefault(gt_id, []).append((abs_frame, pred_tid))

                dist = _cdist(pred_bboxes[best_pi], gt_bbox)
                centroid_dists.setdefault(pred_tid, []).append((abs_frame, dist))

                det_scores.append(float(pred_scores[best_pi]))
                det_labels.append(1)
                det_gt_diag.append(_diag(gt_bbox))
                det_iou.append(float(best_iou))
                det_gt_id.append(gi)
                det_frames.append(abs_frame)
                iou_vals.append(float(best_iou))
                _best_iou_frame = max(_best_iou_frame, best_iou)
            else:
                fn += 1
                f_fn += 1

        for pi in range(len(pred_bboxes)):
            if pi not in matched_pr:
                fp += 1
                # Meilleur GT chevauche par cette fausse alarme (pour re-calcul a
                # un autre seuil IoU) : elle peut devenir TP a seuil plus bas.
                _b_iou = 0.0
                _b_gi = -1
                _b_diag = -1.0
                for gi2, gt2 in enumerate(gts):
                    v2 = iou(list(gt2[1:5]), pred_bboxes[pi])
                    if v2 > _b_iou:
                        _b_iou = v2
                        _b_gi = gi2
                        _b_diag = _diag(list(gt2[1:5]))
                det_scores.append(float(pred_scores[pi]))
                det_labels.append(0)
                det_gt_diag.append(_b_diag)
                det_iou.append(float(_b_iou))
                det_gt_id.append(_b_gi)
                det_frames.append(abs_frame)

        f_fp = len(pred_bboxes) - len(matched_pr)
        per_frame_tp.append(f_tp)
        per_frame_fp.append(f_fp)
        per_frame_fn.append(f_fn)

        if gts and preds:
            # Stocker le vrai IoU max (pas seulement les TP) pour un affichage fidele
            iou_per_frame[abs_frame] = _raw_best_iou
        if gts and not preds:
            n_miss += 1
        elif gts and preds:
            if _raw_best_iou < 1e-6:
                n_iou_zero += 1
            if _raw_best_iou < iou_threshold:
                n_iou_sub_thresh += 1

        # Decrochage : IoU max < seuil sur cette frame
        if gts and preds:
            if _best_iou_frame < iou_decrochage:
                if not in_decrochage:
                    n_decrochages += 1
                in_decrochage = True
            else:
                in_decrochage = False
        elif gts and not preds:
            if not in_decrochage:
                n_decrochages += 1
            in_decrochage = True
        else:
            in_decrochage = False

    mota = 1.0 - (fn + fp + idsw) / max(1, n_gt)
    idf1 = 2 * tp / max(1, 2 * tp + fp + fn)

    # Fragmentation ID : GT objets avec > 1 track_id unique
    id_frags = sum(1 for ids in gt_track_ids.values() if len(ids) > 1)

    # Mapping GT -> liste triee des track_ids vus (pour le rapport)
    gt_id_track_mapping = {gt_id: sorted(ids) for gt_id, ids in gt_track_ids.items()}

    active_frames = list(frame_ids) if frame_ids is not None else list(range(len(frames_data)))

    return _compact_mode(
        {
            "mota": round(mota, 4),
            "idf1": round(idf1, 4),
            "idsw": idsw,
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "n_gt": n_gt,
            "n_frames": len(frames_data),
            "per_frame_tp": per_frame_tp,
            "per_frame_fp": per_frame_fp,
            "per_frame_fn": per_frame_fn,
            "centroid_dists": centroid_dists,  # {tid: [(abs_frame, dist), ...]}
            "det_scores": det_scores,
            "det_labels": det_labels,
            "det_gt_diag": det_gt_diag,  # diagonale du meilleur GT chevauche par la detection
            "det_iou": det_iou,  # meilleur IoU de chaque detection avec un GT (re-calcul)
            "det_gt_id": det_gt_id,  # index local du GT chevauche (-1 si aucun)
            "det_frames": det_frames,  # frame absolue de chaque detection (TN au seuil)
            "gt_diags": gt_diags,  # diagonale de chaque GT (population, plots par taille)
            "iou_vals": iou_vals,
            "iou_per_frame": iou_per_frame,
            "n_miss": n_miss,
            "n_iou_zero": n_iou_zero,
            "n_iou_sub_thresh": n_iou_sub_thresh,
            "n_gt_per_frame": n_gt_per_frame,
            "n_decrochages": n_decrochages,
            "id_frags": id_frags,
            "gt_id_track_mapping": gt_id_track_mapping,
            "gt_id_timeline": gt_id_timeline,
            "has_persistent_gt_ids": has_persistent_gt_ids,
            "per_gt_idsw": per_gt_idsw,  # {gt_id: n_switch_events}
            "gt_ann_frames": gt_ann_frames,  # {gt_id: [frames annotees TP+FN]}
            "active_frames": active_frames,  # pour zones grises plots HTML
        }
    )


#################################
# Compaction pour serialisation
#################################


# Precision de stockage des tableaux par-detection. Les >500k entrees a conf=0
# dominent la taille de benchmark.json ; la precision brute des floats (17
# chiffres) est inutile (scores/IoU compares a des seuils grossiers, diagonales
# utilisees en bandes de taille). Arrondir divise la taille par ~3 sans changer
# une seule metrique (relabel/F1/sweep restent identiques a l'arrondi).
_ROUND_ARRAYS = {
    "det_scores": 4,
    "det_iou": 4,
    "det_gt_diag": 2,
    "gt_diags": 2,
    "iou_vals": 4,
}


def _compact_mode(m: dict) -> dict:
    """Arrondit en place les tableaux flottants d'un mode. Retourne *m*."""
    if not isinstance(m, dict):
        return m
    for key, ndigits in _ROUND_ARRAYS.items():
        arr = m.get(key)
        if arr:
            m[key] = [round(float(x), ndigits) for x in arr]
    ipf = m.get("iou_per_frame")
    if ipf:
        m["iou_per_frame"] = {f: round(float(v), 4) for f, v in ipf.items()}
    cds = m.get("centroid_dists")
    if cds:
        m["centroid_dists"] = {
            tid: [(f, round(float(dst), 2)) for f, dst in pts] for tid, pts in cds.items()
        }
    return m


def compact_metrics(data: dict) -> dict:
    """Compacte les modes mot/sot/sot2 d'un benchmark deja charge (ex. avant de
    reecrire un benchmark.json existant). Modifie *data* en place et le retourne."""
    for key in ("mot", "sot", "sot2"):
        if isinstance(data.get(key), dict):
            _compact_mode(data[key])
    return data


def dump_benchmark_json(data: dict, path) -> None:
    """Serialise un benchmark vers *path*. JSON compact (sans indentation) : les
    tableaux par-detection (>500k entrees) rendent l'indentation ruineuse (~24 Mo
    de blancs). Le fichier est un artefact machine ; l'humain lit le dashboard.

    On ecrit en streaming (json.dump vers le fichier) plutot que de construire la
    chaine complete en RAM d'abord : evite un pic memoire de la taille du fichier."""
    import json

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), default=str)


#################################
# Re-calcul a un autre seuil IoU (build time)
#################################


def _relabel_mode(m: dict, iou_thr: float) -> None:
    """Recalcule labels TP/FP + per_frame + tp/fp/fn/mota/idf1 d'un mode a partir
    des IoU stockes par detection (det_iou / det_gt_id / det_frames)."""
    scores = m.get("det_scores") or []
    ious = m.get("det_iou") or []
    gtid = m.get("det_gt_id") or []
    frames = m.get("det_frames") or []
    n = len(scores)
    if n == 0 or len(ious) != n or len(gtid) != n or len(frames) != n:
        return  # benchmark.json legacy : pas d'IoU par detection -> rien a faire

    # Appariement glouton par score decroissant, un GT (frame, gt_id) au plus.
    order = sorted(range(n), key=lambda i: -scores[i])
    used: set = set()
    labels = [0] * n
    iou_vals: list[float] = []
    for i in order:
        if ious[i] >= iou_thr and gtid[i] >= 0:
            key = (frames[i], gtid[i])
            if key not in used:
                used.add(key)
                labels[i] = 1
                iou_vals.append(float(ious[i]))
    m["det_labels"] = labels
    m["iou_vals"] = iou_vals

    tp = sum(labels)
    fp = n - tp
    n_gt = int(m.get("n_gt", 0))
    fn = max(0, n_gt - tp)

    active = m.get("active_frames", [])
    ngpf = m.get("n_gt_per_frame", [])
    tp_bf: dict = {}
    fp_bf: dict = {}
    for i in range(n):
        f = frames[i]
        if labels[i]:
            tp_bf[f] = tp_bf.get(f, 0) + 1
        else:
            fp_bf[f] = fp_bf.get(f, 0) + 1
    pf_tp, pf_fp, pf_fn = [], [], []
    for k, f in enumerate(active):
        t = tp_bf.get(f, 0)
        g = ngpf[k] if k < len(ngpf) else 0
        pf_tp.append(t)
        pf_fp.append(fp_bf.get(f, 0))
        pf_fn.append(max(0, g - t))
    m["per_frame_tp"], m["per_frame_fp"], m["per_frame_fn"] = pf_tp, pf_fp, pf_fn

    idsw = int(m.get("idsw", 0))
    m["tp"], m["fp"], m["fn"] = tp, fp, fn
    m["mota"] = round(1.0 - (fn + fp + idsw) / max(1, n_gt), 4)
    m["idf1"] = round(2 * tp / max(1, 2 * tp + fp + fn), 4)


def relabel_metrics_at_iou(metrics: dict, iou_threshold: float) -> dict:
    """Recalcule TP/FP/FN et derives a un seuil IoU donne, depuis les IoU stockes
    par detection. Modifie *metrics* en place et le retourne. Sans effet sur un
    benchmark.json anterieur au stockage des IoU par detection.
    """
    iou_threshold = float(iou_threshold)
    for key in ("mot", "sot", "sot2"):
        m = metrics.get(key)
        if isinstance(m, dict) and m.get("det_scores"):
            _relabel_mode(m, iou_threshold)

    modes = [metrics.get(k) for k in ("mot", "sot", "sot2")]
    modes = [m for m in modes if isinstance(m, dict) and m.get("det_scores")]
    if modes:
        tp = sum(int(m.get("tp", 0)) for m in modes)
        fp = sum(int(m.get("fp", 0)) for m in modes)
        fn = sum(int(m.get("fn", 0)) for m in modes)
        idsw = sum(int(m.get("idsw", 0)) for m in modes)
        n_gt = max(1, sum(int(m.get("n_gt", 0)) for m in modes))
        metrics["tp"], metrics["fp"], metrics["fn"] = tp, fp, fn
        metrics["mota"] = round(1.0 - (fn + fp + idsw) / n_gt, 4)
        metrics["idf1"] = round(2 * tp / max(1, 2 * tp + fp + fn), 4)
    metrics["iou_threshold"] = iou_threshold
    return metrics


#################################
# Point d'entree public
#################################


def compute_mot_metrics(
    pred_tracks_per_frame: dict[int, list],
    gt_per_frame: dict[int, list],
    iou_threshold: float = 0.1,
    iou_decrochage: float = 0.2,
    sot_active_per_frame: dict[int, bool] = None,
    n_sot_losses: int = 0,
    n_sot_inits: int = 0,
    n_sot2_losses: int = 0,
    n_sot2_inits: int = 0,
) -> dict:
    """
    Calcule MOTA, IDF1, IDSW sur une sequence complete, separes par mode.

    IDSW fiable seulement si format .ver (IDs GT persistants, gt[5] = ID unique).
    Avec YOLO .txt (5-tuples), gt_id = index local -> IDSW cross-frame approximatif.
    FN/FP/TP restent corrects dans les deux cas.
    """
    if sot_active_per_frame is None:
        sot_active_per_frame = {}

    mot_data: list = []
    sot1_data: list = []
    sot2_data: list = []
    all_data: list = []
    mot_frame_ids: list[int] = []
    sot1_frame_ids: list[int] = []
    sot2_frame_ids: list[int] = []

    all_frames = sorted(pred_tracks_per_frame.keys())
    has_sot2 = False

    for frame_id in all_frames:
        all_preds = pred_tracks_per_frame.get(frame_id, [])
        gts = gt_per_frame.get(frame_id, [])
        is_sot = bool(sot_active_per_frame.get(frame_id, False))

        sot_all = [t for t in all_preds if getattr(t, "is_sot_target", False)]
        mot_preds = [t for t in all_preds if not getattr(t, "is_sot_target", False)]
        sot1_preds = [t for t in sot_all if getattr(t, "sot_slot", 0) == 0]
        sot2_preds = [t for t in sot_all if getattr(t, "sot_slot", 0) == 1]

        if sot2_preds:
            has_sot2 = True

        if is_sot:
            sot1_data.append((sot1_preds, gts))
            sot1_frame_ids.append(frame_id)
        else:
            mot_data.append((mot_preds, gts))
            mot_frame_ids.append(frame_id)

        if sot2_preds:
            sot2_data.append((sot2_preds, gts))
            sot2_frame_ids.append(frame_id)

        all_data.append((sot1_preds + sot2_preds if is_sot else mot_preds, gts))

    all_frame_ids = list(all_frames)

    mot_m = _compute_mode(mot_data, iou_threshold, iou_decrochage, mot_frame_ids)
    sot_m = _compute_mode(sot1_data, iou_threshold, iou_decrochage, sot1_frame_ids)
    glob_m = _compute_mode(all_data, iou_threshold, iou_decrochage, all_frame_ids)

    sot_m["n_losses"] = n_sot_losses
    sot_m["n_inits"] = n_sot_inits
    sot_m["iou_decrochage"] = iou_decrochage

    log.info(
        "MOT | MOTA=%6.3f  IDF1=%6.3f  IDSW=%3d  TP=%5d  FP=%4d  FN=%5d"
        "  GT=%5d  frames=%d  id_frags=%d  gt_ids_persistants=%s",
        mot_m["mota"],
        mot_m["idf1"],
        mot_m["idsw"],
        mot_m["tp"],
        mot_m["fp"],
        mot_m["fn"],
        mot_m["n_gt"],
        mot_m["n_frames"],
        mot_m["id_frags"],
        mot_m["has_persistent_gt_ids"],
    )
    log.info(
        "SOT | MOTA=%6.3f  IDF1=%6.3f  TP=%5d  FP=%4d  FN=%5d"
        "  GT=%5d  frames=%d  losses=%d/%d  decrochages=%d(IOU<%.1f)",
        sot_m["mota"],
        sot_m["idf1"],
        sot_m["tp"],
        sot_m["fp"],
        sot_m["fn"],
        sot_m["n_gt"],
        sot_m["n_frames"],
        n_sot_losses,
        n_sot_inits,
        sot_m["n_decrochages"],
        iou_decrochage,
    )
    log.info(
        "GLB | MOTA=%6.3f  IDF1=%6.3f  IDSW=%3d  TP=%5d  FP=%4d  FN=%5d  GT=%5d  frames=%d",
        glob_m["mota"],
        glob_m["idf1"],
        glob_m["idsw"],
        glob_m["tp"],
        glob_m["fp"],
        glob_m["fn"],
        glob_m["n_gt"],
        glob_m["n_frames"],
    )

    result = {
        "mota": glob_m["mota"],
        "idf1": glob_m["idf1"],
        "idsw": glob_m["idsw"],
        "tp": glob_m["tp"],
        "fp": glob_m["fp"],
        "fn": glob_m["fn"],
        "n_gt": glob_m["n_gt"],
        "n_frames": glob_m["n_frames"],
        "iou_threshold": iou_threshold,
        "mot": mot_m,
        "sot": sot_m,
    }

    if has_sot2 and sot2_data:
        sot2_m = _compute_mode(sot2_data, iou_threshold, iou_decrochage, sot2_frame_ids)
        sot2_m["n_losses"] = n_sot2_losses
        sot2_m["n_inits"] = n_sot2_inits
        sot2_m["iou_decrochage"] = iou_decrochage
        log.info(
            "SOT2| MOTA=%6.3f  IDF1=%6.3f  TP=%5d  FP=%4d  FN=%5d"
            "  GT=%5d  frames=%d  decrochages=%d(IOU<%.1f)",
            sot2_m["mota"],
            sot2_m["idf1"],
            sot2_m["tp"],
            sot2_m["fp"],
            sot2_m["fn"],
            sot2_m["n_gt"],
            sot2_m["n_frames"],
            sot2_m["n_decrochages"],
            iou_decrochage,
        )
        result["sot2"] = sot2_m

    return result
