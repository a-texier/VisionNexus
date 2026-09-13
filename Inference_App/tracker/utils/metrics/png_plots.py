##########################################
# Project  : VisionNexus
# File     : utils/metrics/png_plots.py
# Author   : VisionNexus contributors
# Obj  : Static PNG metric plots (summary, detection curves, confusion, boxplots).
##########################################

import logging
from pathlib import Path

from utils.metrics.common import (
    CLR_BG,
    CLR_FN,
    CLR_GLOBAL,
    CLR_MOT,
    CLR_ROC,
    CLR_SOT,
    CLR_SOT2,
    CLR_TD,
    CLR_TP,
    _confusion_at_threshold,
    _f1_threshold,
    _import_mpl,
    _render_confusion,
    _smooth_curve,
)

log = logging.getLogger(__name__)


#################################


def _plot_summary(metrics: dict, benchmark: dict, out_dir: Path) -> Path | None:
    try:
        plt, mpatches, np = _import_mpl()
    except ImportError:
        log.warning("matplotlib non disponible - metrics_summary.png skipped")
        return None

    mot = metrics.get("mot", {})
    sot = metrics.get("sot", {})
    sot2 = metrics.get("sot2", None)

    # MOT
    mot_mota = mot.get("mota", 0.0)
    mot_idf1 = mot.get("idf1", 0.0)
    mot_frm = mot.get("n_frames", 0)
    mot_idsw = mot.get("idsw", 0)
    mot_id_frags = mot.get("id_frags", 0)
    mot_has_ids = mot.get("has_persistent_gt_ids", False)
    mot_id_map = mot.get("gt_id_track_mapping", {})
    mot_per_idsw = mot.get("per_gt_idsw", {})

    # SOT1
    sot_frm = sot.get("n_frames", 0)
    n_losses = sot.get("n_losses", 0)
    n_inits = sot.get("n_inits", 0)
    n_iou_zero_sot = sot.get("n_iou_zero", 0)
    sot.get("iou_decrochage", 0.2)
    sot_cdist = sot.get("centroid_dists", {})
    sot_dists = [d for pts in sot_cdist.values() for _, d in pts]

    # SOT2
    sot2_dists: list = []
    sot2_n_losses = sot2_n_inits = sot2_n_iou_zero = 0
    if sot2 is not None:
        sot2_cdist = sot2.get("centroid_dists", {})
        sot2_dists = [d for pts in sot2_cdist.values() for _, d in pts]
        sot2_n_losses = sot2.get("n_losses", 0)
        sot2_n_inits = sot2.get("n_inits", 0)
        sot2_n_iou_zero = sot2.get("n_iou_zero", 0)

    glb_frm = metrics.get("n_frames", mot_frm + sot_frm)
    fps_mean = benchmark.get("fps_proc", benchmark.get("fps_mean", 0.0))
    fps_target = benchmark.get("fps_sequence", 0.0)
    run_name = benchmark.get("run_name", "")
    trk_mot = benchmark.get("tracker_mot", "-")
    trk_sot = benchmark.get("tracker_sot", "-")
    duration_s = benchmark.get("duration_s", 0.0)

    fig = plt.figure(figsize=(17, 10), facecolor="white")
    fig.suptitle(f"Résumé métriques  ·  {run_name}", fontsize=14, fontweight="bold", y=0.98)
    gs = fig.add_gridspec(
        2, 3, hspace=0.50, wspace=0.35, left=0.06, right=0.97, top=0.92, bottom=0.07
    )
    ax_a = fig.add_subplot(gs[0, 0])  # Box plot SOT1
    ax_b = fig.add_subplot(gs[0, 1])  # Box plot SOT2
    ax_c = fig.add_subplot(gs[0, 2])  # Donut répartition frames
    ax_d = fig.add_subplot(gs[1, 0])  # MOTA & IDF1 MOT
    ax_e = fig.add_subplot(gs[1, 1:])  # Tableau synthèse (2 cols)

    # ── helper box plot SOT ──────────────────────────────────────────────────
    def _draw_sot_boxplot(ax, dists, label, clr, n_ko, n_miss, n_iou0):
        # n_ko  = nb re-clics opérateur (re-init manuelle ou clic molette)
        # n_miss= nb pertes cible (log "MISS" → retour MOT)
        # n_iou0= nb mauvais réaccrochages (tracker sur mauvaise cible, IoU=0)
        stats_line = f"KO (re-clic): {n_ko}   |   miss (perte cible): {n_miss}   |   IoU=0 (mauvais réaccroch.): {n_iou0}"
        ax.set_title(f"Centroïde — {label}\n{stats_line}", fontweight="bold", fontsize=9)
        if dists:
            ax.boxplot(
                [dists],
                vert=True,
                patch_artist=True,
                boxprops={"facecolor": clr, "alpha": 0.55, "linewidth": 1.5},
                medianprops={"color": "black", "linewidth": 2.0},
                whiskerprops={"linewidth": 1.2, "linestyle": "--"},
                capprops={"linewidth": 1.5},
                flierprops={
                    "marker": "o",
                    "markerfacecolor": clr,
                    "markeredgewidth": 0,
                    "markersize": 4,
                    "alpha": 0.55,
                },
                widths=0.45,
            )
            med = float(np.median(dists))
            ax.annotate(
                f"med={med:.2f} px",
                xy=(1.02, med),
                xycoords=("axes fraction", "data"),
                ha="left",
                va="center",
                fontsize=8,
                color="#222222",
            )
            ax.set_xticks([1])
            ax.set_xticklabels([f"{label}  ({len(dists)} pts)"], fontsize=9)
        else:
            ax.text(
                0.5,
                0.5,
                f"Aucune frame {label}",
                ha="center",
                va="center",
                fontsize=11,
                color="#888888",
                transform=ax.transAxes,
            )
            ax.set_xticks([])
        ax.set_ylabel("Distance centroïde (px)", fontsize=9)
        ax.set_ylim(bottom=0)
        ax.grid(axis="y", linestyle="--", alpha=0.45, zorder=0)
        ax.set_facecolor(CLR_BG)

    # [A] SOT1
    _draw_sot_boxplot(ax_a, sot_dists, "SOT1", CLR_SOT, n_inits, n_losses, n_iou_zero_sot)

    # [B] SOT2
    if sot2 is not None:
        _draw_sot_boxplot(
            ax_b,
            sot2_dists,
            "SOT2",
            CLR_SOT2,
            sot2_n_inits,
            sot2_n_losses,
            sot2_n_iou_zero,
        )
    else:
        ax_b.axis("off")
        ax_b.text(
            0.5,
            0.5,
            "Pas de SOT2",
            ha="center",
            va="center",
            fontsize=13,
            color="#cccccc",
            transform=ax_b.transAxes,
        )

    # [C] Donut répartition frames
    sot2_frm = sot2.get("n_frames", 0) if sot2 else 0
    _dv = [mot_frm, sot_frm]
    _dl = [f"MOT\n{mot_frm} fr", f"SOT1\n{sot_frm} fr"]
    _dc = [CLR_MOT, CLR_SOT]
    if sot2_frm:
        _dv.append(sot2_frm)
        _dl.append(f"SOT2\n{sot2_frm} fr")
        _dc.append(CLR_SOT2)
    if sum(_dv) > 0:
        ax_c.pie(
            _dv,
            labels=_dl,
            colors=_dc,
            autopct="%1.1f%%",
            pctdistance=0.78,
            wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 2},
            startangle=90,
        )
    else:
        ax_c.text(
            0.5,
            0.5,
            "Aucune frame",
            ha="center",
            va="center",
            fontsize=11,
            transform=ax_c.transAxes,
        )
    ax_c.set_title(f"Répartition frames (total={glb_frm})", fontweight="bold")

    # [D] MOTA / IDF1 / Précision / Rappel — MOT
    # MOTA     = 1 − (FN+FP+IDSW)/GT  : précision globale (miss, FA, switches)
    # IDF1     = 2·TP/(2·TP+FP+FN)    : cohérence des identités sur la durée
    # Précision = TP/(TP+FP)           : parmi les détections, fraction correctes
    # Rappel    = TP/(TP+FN)           : parmi les GT, fraction détectée
    # TP : détection matchant une GT (IoU > seuil)
    # FP : détection sans GT correspondante
    # FN : GT sans détection correspondante
    mot_tp = mot.get("tp", 0)
    mot_fp = mot.get("fp", 0)
    mot_fn = mot.get("fn", 0)
    # Precision / Rappel / F1 evalues AU SEUIL F1 max : sinon a conf_thresh=0
    # toutes les detections faibles sont des FP -> P/R s'effondrent et MOTA part
    # tres negatif, ce qui ecrase les barres 0-1 sur l'axe partage.
    _tf1 = _f1_threshold(mot, (15.0, 40.0))
    if _tf1 is not None:
        _ci = _confusion_at_threshold(mot, _tf1, band=None)
        p_prec, p_rec, p_f1 = _ci["prec"], _ci["rec"], _ci["f1"]
        p_tp, p_fp, p_fn = _ci["tp"], _ci["fp"], _ci["fn"]
        _seuil_txt = f"P/R/F1 @seuil F1={_tf1:.3f}"
    else:
        p_prec = mot_tp / max(1, mot_tp + mot_fp)
        p_rec = mot_tp / max(1, mot_tp + mot_fn)
        p_f1 = 2 * p_prec * p_rec / max(1e-9, p_prec + p_rec)
        p_tp, p_fp, p_fn = mot_tp, mot_fp, mot_fn
        _seuil_txt = "P/R/F1 sur toutes les detections"

    _labels = ["MOTA", "IDF1", "Précision", "Rappel", "F1"]
    _vals = [mot_mota, mot_idf1, p_prec, p_rec, p_f1]
    _colors = [CLR_GLOBAL, CLR_SOT, CLR_TP, CLR_FN, CLR_TD]
    x = np.arange(len(_labels))
    w = 0.6
    bars = ax_d.bar(x, _vals, w, color=_colors, alpha=0.85, zorder=3)
    ax_d.set_xticks(x)
    ax_d.set_xticklabels(_labels, fontsize=9)
    # Plancher borne a -0.5 : un MOTA tres negatif (conf=0) ne doit pas ecraser
    # les barres P/R/F1 qui vivent dans [0, 1].
    ax_d.set_ylim(max(-0.5, min(-0.05, min(_vals) - 0.08)), 1.15)
    ax_d.set_ylabel("Score", fontsize=9)
    ax_d.axhline(0, color="black", linewidth=0.8)
    ax_d.grid(axis="y", linestyle="--", alpha=0.45, zorder=0)
    ax_d.set_facecolor(CLR_BG)
    ax_d.set_title(
        f"Métriques MOT   ·   {_seuil_txt}\n"
        "MOTA=1−(FN+FP+IDSW)/GT  ·  IDF1=2·TP/(2·TP+FP+FN)  ·  P=TP/(TP+FP)  ·  R=TP/(TP+FN)",
        fontweight="bold",
        fontsize=7.5,
    )
    for bar in bars:
        h = bar.get_height()
        if abs(h) > 0.001:
            ax_d.text(
                bar.get_x() + bar.get_width() / 2,
                max(h, 0) + 0.015,
                f"{h:.3f}",
                ha="center",
                va="bottom",
                fontsize=8.5,
                color="black" if h >= 0 else "red",
            )
    ax_d.text(
        0.5,
        -0.12,
        f"TP={p_tp}   FP={p_fp}   FN={p_fn}   IDSW={mot_idsw}",
        ha="center",
        va="top",
        fontsize=7.5,
        color="#555555",
        transform=ax_d.transAxes,
    )

    # [E] Tableau synthèse
    ax_e.axis("off")

    _mot_id_lines = []
    _has_cycles = False
    if mot_id_frags > 0 and mot_id_map:
        fragmented = {gid: tids for gid, tids in mot_id_map.items() if len(tids) > 1}
        fragmented_sorted = sorted(fragmented.items(), key=lambda kv: -len(kv[1]))
        for gid, tids in fragmented_sorted[:4]:
            gt_sw = mot_per_idsw.get(gid, None)
            n_ids = len(tids)
            sw_str = f"  —  {gt_sw} switch(es)" if gt_sw is not None else ""
            id_str = f"IDs {min(tids)}..{max(tids)}" if n_ids > 4 else ", ".join(map(str, tids))
            _mot_id_lines.append((f"  ↳ GT{gid}", f"{n_ids} IDs [{id_str}]{sw_str}"))
            if gt_sw is not None and n_ids > 1 and gt_sw > (n_ids - 1):
                _has_cycles = True
        if len(fragmented) > 4:
            _mot_id_lines.append(("  ↳ ...", f"({len(fragmented) - 4} autres GTs instables)"))

    _idsw_note = "" if mot_has_ids else " /! YOLO: IDs non persistants"

    frames_detail = f"{glb_frm} total  ({mot_frm} MOT + {sot_frm} SOT1"
    if sot2_frm:
        frames_detail += f" + {sot2_frm} SOT2"
    frames_detail += ")"

    lines = [
        ("Session", run_name),
        ("Tracker MOT", str(trk_mot) if trk_mot else "-"),
        ("Tracker SOT", str(trk_sot) if trk_sot else "-"),
        ("", ""),
        ("## MOT ##", ""),
        ("  MOTA", f"{mot_mota:.3f}"),
        ("  IDF1", f"{mot_idf1:.3f}"),
        ("  Switches ID", f"{mot_idsw} événements  ({mot_id_frags} GT instable){_idsw_note}"),
        *_mot_id_lines,
        *([("  ↳ note", "N IDs ≤ N switches → cycles d'anciens IDs")] if _has_cycles else []),
        *([("  ↳ Détails", "metrics_id_stability_mot.html")] if mot_id_frags > 0 else []),
        ("", ""),
        ("## SOT1 ##", ""),
        ("  KO (re-clic opérateur)", f"{n_inits}"),
        ("  miss (perte cible)", f"{n_losses}  (→ retour MOT)"),
        ("  Taux perte", f"{n_losses / n_inits * 100:.1f}%" if n_inits > 0 else "-"),
        ("  IoU=0 (mauvais réaccroch.)", f"{n_iou_zero_sot}"),
    ]

    if sot2 is not None:
        lines += [
            ("", ""),
            ("## SOT2 ##", ""),
            ("  KO (re-clic opérateur)", f"{sot2_n_inits}"),
            ("  miss (perte cible)", f"{sot2_n_losses}"),
            ("  IoU=0 (mauvais réaccroch.)", f"{sot2_n_iou_zero}"),
        ]

    lines += [
        ("", ""),
        ("## Perf ##", ""),
        ("  FPS proc", f"{fps_mean:.1f}  (séquence {fps_target:.0f} fps)"),
        ("  Temps total", f"{duration_s:.1f} s"),
        ("  Frames", frames_detail),
    ]

    y_step = 1.0 / (len(lines) + 1)
    for idx, (key, val) in enumerate(lines):
        y = 1.0 - (idx + 1) * y_step
        if key.startswith("##"):
            ax_e.text(
                0.02,
                y,
                key,
                fontsize=8.5,
                fontweight="bold",
                color=CLR_GLOBAL,
                transform=ax_e.transAxes,
                va="center",
            )
        elif key in ("  Note", "  ↳ note"):
            ax_e.text(
                0.04,
                y,
                val,
                fontsize=7.0,
                color="#888888",
                style="italic",
                transform=ax_e.transAxes,
                va="center",
            )
        elif key == "  ↳ Détails":
            ax_e.text(
                0.04,
                y,
                val,
                fontsize=7.5,
                color="#2196F3",
                style="italic",
                transform=ax_e.transAxes,
                va="center",
            )
        elif key != "":
            ax_e.text(
                0.02,
                y,
                key,
                fontsize=8.0,
                color="#555555",
                transform=ax_e.transAxes,
                va="center",
            )
            ax_e.text(
                0.38,
                y,
                val,
                fontsize=8.0,
                fontweight="bold",
                color="#111111",
                transform=ax_e.transAxes,
                va="center",
            )

    ax_e.set_facecolor(CLR_BG)
    ax_e.patch.set_visible(True)
    ax_e.set_title("Synthèse session", fontweight="bold")

    out = out_dir / "metrics_summary.png"
    fig.savefig(out, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    log.info("metrics_summary.png -> %s", out)
    return out


#################################


def _plot_detection_curves(metrics: dict, out_dir: Path) -> Path | None:
    """
    PNG : courbe ROC du detecteur, restreinte aux detections de score >= seuil
    F1 optimal (bande 15-40 px). Trait plein fin, courbe lissee.
    """
    try:
        plt, _, np = _import_mpl()
        from sklearn.metrics import auc as sk_auc
        from sklearn.metrics import roc_curve
    except ImportError as e:
        log.warning("sklearn/mpl indisponible - roc_curve_total.png skipped (%s)", e)
        return None

    mot = metrics.get("mot", {})
    scores = np.asarray(mot.get("det_scores", []), dtype=float)
    labels = np.asarray(mot.get("det_labels", []), dtype=int)
    if scores.size < 2 or int((labels == 1).sum()) == 0:
        log.info("roc_curve_total.png skipped : pas assez de scores MOT")
        return None

    # Seuil F1 optimal (bande 15-40) : on ne trace QUE les detections >= ce seuil.
    t_star = _f1_threshold(mot, (15.0, 40.0))
    if t_star is None:
        t_star = 0.0
    keep = scores >= t_star
    s_k, l_k = scores[keep], labels[keep]

    fig, ax_roc = plt.subplots(figsize=(7.5, 6.5), facecolor="white")
    fig.suptitle(
        f"Courbe ROC (scores >= seuil F1, IoU >= {metrics.get('iou_threshold', 0.1)})",
        fontsize=13,
        fontweight="bold",
        y=0.99,
    )

    # --- ROC (detections >= seuil) ---
    ax_roc.plot([0, 1], [0, 1], color="navy", lw=1.2, linestyle="--", label="Aleatoire", zorder=2)
    if int((l_k == 0).sum()) > 0 and int((l_k == 1).sum()) > 0:
        try:
            fpr, tpr, _ = roc_curve(l_k, s_k)
            roc_auc = float(sk_auc(fpr, tpr))
            fxs, fys = _smooth_curve(fpr, tpr)
            ax_roc.plot(
                fxs, fys, color=CLR_ROC, lw=1.3, zorder=3, label=f"ROC  (AUC={roc_auc:.3f})"
            )
        except (ValueError, Exception):
            ax_roc.text(
                0.5,
                0.5,
                "ROC non calculable",
                ha="center",
                va="center",
                fontsize=11,
                color="#888888",
                transform=ax_roc.transAxes,
            )
    else:
        ax_roc.text(
            0.5,
            0.5,
            "ROC non calculable\n(0 fausse alarme au-dessus du seuil)",
            ha="center",
            va="center",
            fontsize=11,
            color="#888888",
            transform=ax_roc.transAxes,
        )
    ax_roc.set_xlabel("FPR (taux de fausses alarmes)", fontsize=11)
    ax_roc.set_ylabel("TPR (taux de detection)", fontsize=11)
    ax_roc.set_title("Courbe ROC", fontsize=12, fontweight="bold", pad=8)
    ax_roc.set_xlim([0.0, 1.0])
    ax_roc.set_ylim([0.0, 1.05])
    ax_roc.grid(True, linestyle="--", alpha=0.5)
    ax_roc.legend(fontsize=9, loc="lower right")
    ax_roc.spines["top"].set_visible(False)
    ax_roc.spines["right"].set_visible(False)
    ax_roc.set_facecolor(CLR_BG)

    plt.tight_layout(rect=[0, 0, 1, 0.96])
    out = out_dir / "roc_curve_total.png"
    fig.savefig(out, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    log.info("roc_curve_total.png -> %s", out)
    return out


#################################


def _plot_confusion_matrix(metrics: dict, out_dir: Path) -> "Path | None":
    """
    PNG : matrice de confusion du detecteur au seuil OPTIMAL (maximum du F1 sur
    la bande 15-40 px). Compter TP/FP/FN/TN a ce seuil est indispensable : a
    conf_thresh=0 toute detection faible serait sinon un FP et la matrice n'aurait
    aucun sens. Rendu standard sklearn (ConfusionMatrixDisplay).
    """
    mot = metrics.get("mot", {})
    if not mot.get("det_scores"):
        log.info("metrics_confusion.png skipped : aucune donnee detecteur")
        return None
    # Seuil = maximum du F1 sur la bande 15-40 px (meme seuil partout).
    t = _f1_threshold(mot, (15.0, 40.0))
    if t is None:
        t = 0.0
    info = _confusion_at_threshold(mot, t, band=None)
    return _render_confusion(
        info,
        t,
        "Matrice de confusion",
        out_dir / "metrics_confusion.png",
        note=f"GT total={info['n_gt']}   seuil = F1 max (bande 15-40px)",
    )


#################################


def _plot_iou_boxplot(metrics: dict, out_dir: Path) -> "Path | None":
    try:
        plt, mpatches, np = _import_mpl()
    except ImportError:
        log.warning("matplotlib non disponible - metrics_iou_boxplot.png skipped")
        return None

    mot_m = metrics.get("mot", {})
    sot_m = metrics.get("sot", {})
    sot2_m = metrics.get("sot2") or {}

    mot_iou = mot_m.get("iou_vals", [])
    sot_iou = sot_m.get("iou_vals", [])
    sot2_iou = sot2_m.get("iou_vals", [])

    def _sot_stats(m):
        return (
            f"KO={m.get('n_inits', 0)}  miss={m.get('n_losses', 0)}"
            f"  IoU=0={m.get('n_iou_zero', 0)}"
            f"  <seuil={m.get('n_iou_sub_thresh', 0)}"
        )

    def _mot_stats(m):
        return (
            f"FN={m.get('fn', 0)}  IoU=0={m.get('n_iou_zero', 0)}"
            f"  <seuil={m.get('n_iou_sub_thresh', 0)}"
        )

    # (label, iou_vals, color, stats_str)
    groups = []
    if mot_iou or mot_m.get("fn", 0) or mot_m.get("n_iou_zero", 0):
        groups.append(("MOT", mot_iou, CLR_MOT, _mot_stats(mot_m)))
    if sot_iou or sot_m.get("n_inits", 0) or sot_m.get("n_losses", 0) or sot_m.get("n_iou_zero", 0):
        groups.append(("SOT1", sot_iou, CLR_SOT, _sot_stats(sot_m)))
    if (
        sot2_iou
        or sot2_m.get("n_inits", 0)
        or sot2_m.get("n_losses", 0)
        or sot2_m.get("n_iou_zero", 0)
    ):
        groups.append(("SOT2", sot2_iou, CLR_SOT2, _sot_stats(sot2_m)))

    if not groups:
        log.info("Aucune valeur IoU disponible - metrics_iou_boxplot.png skipped")
        return None

    fig, ax = plt.subplots(figsize=(max(5, 3.2 * len(groups)), 5), facecolor="white")
    fig.suptitle("IoU par tracker (matches TP)", fontsize=13, fontweight="bold")

    [g[1] for g in groups]
    labels = [f"{g[0]}\n({len(g[1])} TP  |  {g[3]})" for g in groups]
    [g[2] for g in groups]

    # boxplot seulement pour les groupes qui ont des données
    box_pos = [i + 1 for i, g in enumerate(groups) if g[1]]
    box_data = [g[1] for g in groups if g[1]]

    if box_data:
        bp = ax.boxplot(
            box_data,
            positions=box_pos,
            vert=True,
            patch_artist=True,
            widths=0.45,
            medianprops={"color": "black", "linewidth": 2.0},
            whiskerprops={"linewidth": 1.2, "linestyle": "--"},
            capprops={"linewidth": 1.5},
            flierprops={"marker": "o", "markeredgewidth": 0, "markersize": 4, "alpha": 0.55},
        )
        box_colors = [g[2] for g in groups if g[1]]
        for patch, clr in zip(bp["boxes"], box_colors, strict=False):
            patch.set(facecolor=clr, alpha=0.55, linewidth=1.5)
        for flier, clr in zip(bp["fliers"], box_colors, strict=False):
            flier.set(markerfacecolor=clr)

        for pos, g in zip(box_pos, [g for g in groups if g[1]], strict=False):
            med = float(np.median(g[1]))
            ax.annotate(
                f"med={med:.3f}",
                xy=(pos + 0.26, med),
                xycoords=("data", "data"),
                ha="left",
                va="center",
                fontsize=8,
                color="#222222",
            )

    ax.set_xticks(range(1, len(groups) + 1))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("IoU (0–1)", fontsize=10)
    ax.set_ylim(0.0, 1.05)
    ax.axhline(0.5, color="#888888", linewidth=0.8, linestyle=":", alpha=0.6)
    ax.grid(axis="y", linestyle="--", alpha=0.45, zorder=0)
    ax.set_facecolor(CLR_BG)

    out_path = out_dir / "metrics_iou_boxplot.png"
    fig.tight_layout()
    fig.savefig(str(out_path), dpi=120, bbox_inches="tight")
    plt.close(fig)
    log.info("metrics_iou_boxplot.png -> %s", out_path)
    return out_path


#################################


def _plot_centroids_boxplot(metrics: dict, out_dir: Path) -> "Path | None":
    try:
        plt, mpatches, np = _import_mpl()
    except ImportError:
        log.warning("matplotlib non disponible - metrics_centroids_box_plot.png skipped")
        return None

    mot_m = metrics.get("mot", {})
    sot_m = metrics.get("sot", {})
    sot2_m = metrics.get("sot2") or {}

    def _flat(cdist: dict) -> list[float]:
        return [d for pts in cdist.values() for _, d in pts]

    mot_dists = _flat(mot_m.get("centroid_dists", {}))
    sot_dists = _flat(sot_m.get("centroid_dists", {}))
    sot2_dists = _flat(sot2_m.get("centroid_dists", {}))

    def _sot_stats(m):
        return (
            f"KO={m.get('n_inits', 0)}  miss={m.get('n_losses', 0)}  IoU=0={m.get('n_iou_zero', 0)}"
        )

    def _mot_stats(m):
        return f"FN={m.get('fn', 0)}  IoU=0={m.get('n_iou_zero', 0)}"

    groups = []  # (label, dists, color, stats_str)
    if mot_dists:
        groups.append(("MOT", mot_dists, CLR_MOT, _mot_stats(mot_m)))
    if sot_dists:
        groups.append(("SOT1", sot_dists, CLR_SOT, _sot_stats(sot_m)))
    if sot2_dists:
        groups.append(("SOT2", sot2_dists, CLR_SOT2, _sot_stats(sot2_m)))

    if not groups:
        log.info("Aucune distance centroïde disponible - metrics_centroids_box_plot.png skipped")
        return None

    fig, ax = plt.subplots(figsize=(max(5, 3.2 * len(groups)), 5), facecolor="white")
    fig.suptitle("Distance centroïde par tracker (px)", fontsize=13, fontweight="bold")

    data = [g[1] for g in groups]
    labels = [f"{g[0]}\n({len(g[1])} pts  |  {g[3]})" for g in groups]
    colors = [g[2] for g in groups]

    bp = ax.boxplot(
        data,
        vert=True,
        patch_artist=True,
        widths=0.45,
        medianprops={"color": "black", "linewidth": 2.0},
        whiskerprops={"linewidth": 1.2, "linestyle": "--"},
        capprops={"linewidth": 1.5},
        flierprops={"marker": "o", "markeredgewidth": 0, "markersize": 4, "alpha": 0.55},
    )
    for patch, clr in zip(bp["boxes"], colors, strict=False):
        patch.set(facecolor=clr, alpha=0.55, linewidth=1.5)
    for flier, clr in zip(bp["fliers"], colors, strict=False):
        flier.set(markerfacecolor=clr)

    for i, g in enumerate(groups):
        med = float(np.median(g[1]))
        ax.annotate(
            f"med={med:.1f} px",
            xy=(i + 1 + 0.26, med),
            xycoords=("data", "data"),
            ha="left",
            va="center",
            fontsize=8,
            color="#222222",
        )

    ax.set_xticks(range(1, len(groups) + 1))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("Distance centroïde (px)", fontsize=10)
    ax.set_ylim(bottom=0)
    ax.grid(axis="y", linestyle="--", alpha=0.45, zorder=0)
    ax.set_facecolor(CLR_BG)

    out_path = out_dir / "metrics_centroids_box_plot.png"
    fig.tight_layout()
    fig.savefig(str(out_path), dpi=120, bbox_inches="tight")
    plt.close(fig)
    log.info("metrics_centroids_box_plot.png -> %s", out_path)
    return out_path
