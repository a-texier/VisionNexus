##########################################
# Project  : VisionNexus
# File     : utils/metrics/common.py
# Author   : VisionNexus contributors
# Obj  : Shared imports, colour palette and small plotting helpers.
##########################################

import logging

log = logging.getLogger(__name__)

#################################
# Palette
#################################

CLR_MOT = "#4CAF50"
CLR_SOT = "#9C27B0"
CLR_SOT2 = "#FF6600"
CLR_GLOBAL = "#2196F3"
CLR_TP = "#66BB6A"
CLR_FP = "#FFA726"
CLR_FN = "#EF5350"
CLR_BG = "#F5F5F5"
CLR_TD = "#1565C0"
CLR_ROC = "#E65100"

# 20-color cycle for Plotly traces
_PLOTLY_20 = [
    "#636EFA",
    "#EF553B",
    "#00CC96",
    "#AB63FA",
    "#FFA15A",
    "#19D3F3",
    "#FF6692",
    "#B6E880",
    "#FF97FF",
    "#FECB52",
    "#1F77B4",
    "#FF7F0E",
    "#2CA02C",
    "#D62728",
    "#9467BD",
    "#8C564B",
    "#E377C2",
    "#7F7F7F",
    "#BCBD22",
    "#17BECF",
]


#################################


def _import_mpl():
    import matplotlib

    matplotlib.use("Agg")
    import logging as _logging

    for _name in (
        "matplotlib",
        "matplotlib.font_manager",
        "matplotlib.ticker",
        "matplotlib.axes",
        "PIL",
    ):
        _logging.getLogger(_name).setLevel(_logging.WARNING)
    import matplotlib.patches as mpatches
    import matplotlib.pyplot as plt
    import numpy as np

    return plt, mpatches, np


#################################


def _import_plotly():
    try:
        import plotly.colors as pc
        import plotly.graph_objects as go
        from plotly.subplots import make_subplots

        return go, make_subplots, pc
    except ImportError:
        return None, None, None


#################################


def _f1_curve(m, band):
    """Courbe F1 du detecteur en fonction du seuil de score, pour les GT d'une
    bande de taille (lo, hi). FP = toutes les fausses alarmes (sans bande).

    Retourne (thresholds desc, f1) ou None. Balayage cumule O(n log n).
    """
    import numpy as np

    scores = np.asarray(m.get("det_scores", []), dtype=float)
    labels = np.asarray(m.get("det_labels", []), dtype=int)
    diags = np.asarray(m.get("det_gt_diag", []), dtype=float)
    gt_diags = np.asarray(m.get("gt_diags", []), dtype=float)
    if scores.size < 2 or diags.size != scores.size or gt_diags.size == 0:
        return None
    lo, hi = band
    n_band = int(((gt_diags >= lo) & (gt_diags <= hi)).sum())
    if n_band == 0:
        return None

    tp_flags = ((labels == 1) & (diags >= lo) & (diags <= hi)).astype(float)
    fp_flags = (labels == 0).astype(float)
    order = np.argsort(-scores, kind="mergesort")
    s = scores[order]
    tp_cum = np.concatenate([[0.0], np.cumsum(tp_flags[order])])
    fp_cum = np.concatenate([[0.0], np.cumsum(fp_flags[order])])
    change = np.nonzero(s[1:] != s[:-1])[0] + 1
    bnd = np.concatenate([[0], change, [s.size]])

    tp = tp_cum[bnd]
    fp = fp_cum[bnd]
    fn = n_band - tp
    prec = tp / np.maximum(1.0, tp + fp)
    rec = tp / np.maximum(1.0, tp + fn)
    f1 = 2 * prec * rec / np.maximum(1e-9, prec + rec)

    thr = np.empty(bnd.size, dtype=float)
    thr[0] = s[0] + 1e-6
    thr[-1] = 0.0
    if bnd.size > 2:
        thr[1:-1] = s[bnd[1:-1]]
    return thr, f1


def _smooth_curve(x, y, npts=360, win=9, xmax=None):
    """Lisse une courbe en escalier (x croissant) : collapse les x dupliques en
    gardant le max y, reinterpole sur une grille reguliere puis moyenne glissante.
    Rend (xs, ys) lisses. Sans effet si moins de 3 points.

    xmax : borne haute de la grille d'interpolation. Indispensable quand la plage
    de x est enorme mais que seule la fenetre [0, xmax] est affichee : sans clip,
    les 360 points s'etalent sur toute la plage et la fenetre visible ne recoit
    qu'un point ou deux -> courbe reduite a une droite. Clipper la grille sur
    [x0, xmax] restaure la resolution visible.
    """
    import numpy as np

    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if x.size < 3:
        return x, y
    order = np.argsort(x)
    x = x[order]
    y = y[order]
    # x/y sont monotones : garder le dernier point de chaque palier (= max y).
    keep = np.concatenate([np.diff(x) > 0, [True]])
    x = x[keep]
    y = y[keep]
    if x.size < 3:
        return x, y
    hi = float(x[-1])
    if xmax is not None and float(xmax) > float(x[0]):
        hi = min(hi, float(xmax))
    xs = np.linspace(float(x[0]), hi, npts)
    ys = np.interp(xs, x, y)
    if win > 1 and ys.size >= win:
        pad = win // 2
        # padding par valeurs de bord -> pas d'effondrement des extremites.
        yp = np.pad(ys, pad, mode="edge")
        ys = np.convolve(yp, np.ones(win) / win, mode="valid")[: xs.size]
    return xs, ys


def _f1_threshold(m, band=(15.0, 40.0)):
    """Seuil qui MAXIMISE le F1 du detecteur sur la bande de taille GT donnee.

    Plus robuste que le point d'inflection : c'est le seuil retenu partout
    (matrices de confusion, point rouge des courbes). None si pas de donnees.
    """
    import numpy as np

    cur = _f1_curve(m, band)
    if cur is None:
        return None
    thr, f1 = cur
    return float(thr[int(np.argmax(f1))])


def _confusion_at_threshold(m, t, band=None):
    """Compte TP/FP/FN/TN du detecteur au seuil de score *t*.

    band = (lo, hi) restreint TP/FN aux GT dont la diagonale est dans [lo, hi].
    Les FP ne sont pas filtrables par taille (aucun GT associe). TN = frames sans
    GT ou aucune detection ne depasse le seuil.
    """
    import numpy as np

    scores = np.asarray(m.get("det_scores", []), dtype=float)
    labels = np.asarray(m.get("det_labels", []), dtype=int)
    diags = np.asarray(m.get("det_gt_diag", []), dtype=float)
    frames = np.asarray(m.get("det_frames", []), dtype=float)
    gt_diags = np.asarray(m.get("gt_diags", []), dtype=float)

    fire = scores > t
    if band is not None:
        lo, hi = band
        in_band = (diags >= lo) & (diags <= hi)
        tp = int((fire & (labels == 1) & in_band).sum())
        n_gt = int(((gt_diags >= lo) & (gt_diags <= hi)).sum())
    else:
        tp = int((fire & (labels == 1)).sum())
        n_gt = int(gt_diags.size)
    fp = int((fire & (labels == 0)).sum())
    fn = max(0, n_gt - tp)

    tn = 0
    active = list(m.get("active_frames", []))
    ngpf = list(m.get("n_gt_per_frame", []))
    if frames.size == scores.size and active:
        no_gt = {active[k] for k in range(min(len(active), len(ngpf))) if ngpf[k] == 0}
        firing = set(frames[fire].astype(int).tolist())
        tn = len(no_gt - firing)

    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    f1 = 2 * prec * rec / max(1e-9, prec + rec)
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "n_gt": n_gt,
        "prec": prec,
        "rec": rec,
        "f1": f1,
    }


# def _render_confusion(info, threshold, title, out_path, note=None):
#     """Rend une matrice de confusion 2x2 via sklearn ConfusionMatrixDisplay.

#     info : sortie de _confusion_at_threshold. Lignes = verite (Objet/Fond),
#     colonnes = prediction detecteur. Precision/Rappel/F1 affiches dessous.
#     Sauve le PNG et retourne son Path (None si mpl/sklearn indisponibles).
#     """
#     try:
#         plt, _, np = _import_mpl()
#         from sklearn.metrics import ConfusionMatrixDisplay
#     except ImportError:
#         log.warning("matplotlib/sklearn indisponible - %s skipped", out_path.name)
#         return None

#     cm = np.array([[info["tp"], info["fn"]], [info["fp"], info["tn"]]], dtype=int)
#     fig, ax = plt.subplots(figsize=(5.8, 5.6), facecolor="white")
#     disp = ConfusionMatrixDisplay(cm, display_labels=["Objet", "Fond"])
#     disp.plot(ax=ax, cmap="Blues", colorbar=False, values_format="d")
#     ax.set_title(f"{title}  (seuil = {threshold:.3f})", fontsize=12, fontweight="bold")
#     ax.set_xlabel("Prediction detecteur")
#     ax.set_ylabel("Verite terrain")

#     stats = f"Precision={info['prec']:.3f}    Rappel={info['rec']:.3f}    F1={info['f1']:.3f}"
#     if note:
#         stats += "\n" + note
#     ax.text(
#         0.5,
#         -0.20,
#         stats,
#         ha="center",
#         va="top",
#         transform=ax.transAxes,
#         fontsize=9.5,
#         color="#333333",
#     )
#     fig.savefig(out_path, dpi=120, bbox_inches="tight", facecolor="white")
#     plt.close(fig)
#     log.info("%s -> %s", out_path.name, out_path)
#     return out_path


def _render_confusion(info, threshold, title, out_path, note=None):
    """Rend une matrice de confusion 2x2 normalisée par ligne.

    Chaque case affiche :
        XX.X%
        (N)

    où XX.X% est la proportion normalisée sur la ligne (vérité terrain)
    et N le nombre absolu d'exemples.

    info : sortie de _confusion_at_threshold.
    Lignes = vérité (Objet/Fond),
    Colonnes = prédiction détecteur (Objet/Fond).
    """

    try:
        plt, _, np = _import_mpl()
        from sklearn.metrics import ConfusionMatrixDisplay
    except ImportError:
        log.warning("matplotlib/sklearn indisponible - %s skipped", out_path.name)
        return None

    # Matrice de confusion absolue
    cm_abs = np.array(
        [
            [info["tp"], info["fn"]],
            [info["fp"], info["tn"]],
        ],
        dtype=int,
    )

    # # Matrice normalisée par ligne (vérité terrain)
    # row_sums = cm_abs.sum(axis=1, keepdims=True)
    # cm_norm = np.divide(
    #     cm_abs.astype(float),
    #     row_sums,
    #     out=np.zeros_like(cm_abs, dtype=float),
    #     where=row_sums != 0,
    # )
    col_sums = cm_abs.sum(axis=0, keepdims=True)
    cm_norm = np.divide(
        cm_abs.astype(float),
        col_sums,
        out=np.zeros_like(cm_abs, dtype=float),
        where=col_sums != 0,
    )

    fig, ax = plt.subplots(figsize=(5.8, 5.6), facecolor="white")

    disp = ConfusionMatrixDisplay(
        confusion_matrix=cm_norm,
        display_labels=["Objet", "Fond"],
    )

    disp.plot(
        ax=ax,
        cmap="Blues",
        colorbar=False,
        values_format=".1%",
    )

    # Supprime les annotations automatiques
    for txt in disp.text_.ravel():
        txt.remove()

    # Ajoute : pourcentage + valeur absolue
    for i in range(2):
        for j in range(2):
            ax.text(
                j,
                i,
                f"{cm_norm[i, j]:.1%}\n({cm_abs[i, j]})",
                ha="center",
                va="center",
                fontsize=11,
                fontweight="bold",
                color="black",
            )

    ax.set_title(
        f"{title}  (seuil = {threshold:.3f})",
        fontsize=12,
        fontweight="bold",
    )
    ax.set_xlabel("Prédiction détecteur")
    ax.set_ylabel("Vérité terrain")

    stats = f"Precision={info['prec']:.3f}    Rappel={info['rec']:.3f}    F1={info['f1']:.3f}"

    if note:
        stats += "\n" + note

    ax.text(
        0.5,
        -0.20,
        stats,
        ha="center",
        va="top",
        transform=ax.transAxes,
        fontsize=9.5,
        color="#333333",
    )

    fig.savefig(
        out_path,
        dpi=120,
        bbox_inches="tight",
        facecolor="white",
    )

    plt.close(fig)

    log.info("%s -> %s", out_path.name, out_path)

    return out_path


#################################


def _gap_ranges(
    active_sorted: list[int],
    f_min: int,
    f_max: int,
) -> list[tuple[float, float]]:
    """
    Retourne les plages inactives (gaps) entre f_min et f_max.
    active_sorted doit être trié.  Utilise des offsets ±0.5 pour ne pas
    masquer exactement les frames frontières.
    """
    if not active_sorted:
        return [(f_min - 0.5, f_max + 0.5)] if f_min <= f_max else []
    gaps = []
    s = active_sorted
    if s[0] > f_min:
        gaps.append((f_min - 0.5, s[0] - 0.5))
    for i in range(1, len(s)):
        if s[i] > s[i - 1] + 1:
            gaps.append((s[i - 1] + 0.5, s[i] - 0.5))
    if s[-1] < f_max:
        gaps.append((s[-1] + 0.5, f_max + 0.5))
    return gaps


#################################


def _get_runs(
    timeline: list[tuple[int, int]],
) -> list[tuple[int, int, int]]:
    """Groupe une timeline [(frame_idx, track_id)] en runs consécutifs de même tid.
    Retourne [(frame_start, frame_end, track_id), ...]."""
    if not timeline:
        return []
    runs = []
    start = timeline[0][0]
    cur_tid = timeline[0][1]
    prev = timeline[0][0]
    for frame_idx, tid in timeline[1:]:
        if tid != cur_tid:
            runs.append((start, prev, cur_tid))
            start = frame_idx
            cur_tid = tid
        prev = frame_idx
    runs.append((start, prev, cur_tid))
    return runs


#################################


def _add_grey_zones(fig, gaps: list[tuple[float, float]], row: int = 1):
    """Ajoute des rectangles gris pour les zones inactives (plotly)."""
    for x0, x1 in gaps:
        fig.add_vrect(
            x0=x0,
            x1=x1,
            fillcolor="lightgrey",
            opacity=0.35,
            layer="below",
            line_width=0,
            row=row,
            col=1,
        )


#################################


def _mode_runs(frames: list[int]) -> list[tuple[int, int]]:
    """Convertit une liste de frame_ids en runs consécutifs (start, end)."""
    if not frames:
        return []
    s = sorted(frames)
    runs, rs = [], s[0]
    for i in range(1, len(s)):
        if s[i] != s[i - 1] + 1:
            runs.append((rs, s[i - 1]))
            rs = s[i]
    runs.append((rs, s[-1]))
    return runs


#################################
# Couleurs de fond par mode
#################################
_MOT_BG = "rgba(144,238,144,0.13)"
_SOT1_BG = "rgba(100,180,255,0.16)"
_SOT2_BG = "rgba(255,165,  0,0.13)"
_ALERT_C = "#d62728"
