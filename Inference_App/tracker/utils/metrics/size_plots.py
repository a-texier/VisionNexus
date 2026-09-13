##########################################
# Project  : VisionNexus
# File     : utils/metrics/size_plots.py
# Author   : VisionNexus contributors
# Obj  : Metric plots split by GT bounding-box diagonal size band (px).
##########################################

import logging
from pathlib import Path

from utils.metrics.common import (
    CLR_BG,
    _confusion_at_threshold,
    _f1_curve,
    _f1_threshold,
    _import_mpl,
    _render_confusion,
)

log = logging.getLogger(__name__)

# Bornes des bandes de taille, exprimees sur la diagonale GT (px).
SMALL_MAX = 15.0
MID_MAX = 40.0


#################################
# Plot : matrice de confusion bande 15-40 px
#################################


def _plot_confusion_15_40(metrics: dict, out_dir: Path) -> "Path | None":
    """
    PNG : matrice de confusion du detecteur au seuil optimal (maximum du F1),
    restreinte aux GT dont la diagonale est dans 15-40 px.

      TP : GT (15-40px) detecte au seuil        FN : GT (15-40px) manque au seuil
      FP : fausses alarmes passant le seuil      TN : frames sans GT et sans detection

    Meme seuil que la confusion totale -> les FP ont un sens. Rendu sklearn.
    """
    mot = metrics.get("mot", {})
    if not mot.get("det_scores") or not mot.get("gt_diags"):
        log.info("metrics_confusion_15_40_px.png skipped : pas de donnees de taille GT")
        return None
    t = _f1_threshold(mot, (SMALL_MAX, MID_MAX))
    if t is None:
        t = 0.0
    info = _confusion_at_threshold(mot, t, band=(SMALL_MAX, MID_MAX))
    if info["n_gt"] == 0:
        log.info("metrics_confusion_15_40_px.png skipped : aucun GT dans 15-40 px")
        return None
    return _render_confusion(
        info,
        t,
        "Confusion detecteur - GT diagonale 15-40 px",
        out_dir / "metrics_confusion_15_40_px.png",
        note=(
            f"GT 15-40px={info['n_gt']}   FP = fausses alarmes du run (non filtrables par taille)"
        ),
    )


#################################
# Plot : F1 en fonction du seuil
#################################


def _plot_f1_vs_threshold(metrics: dict, out_dir: Path) -> "Path | None":
    """
    PNG : F1 du detecteur (GT 15-40 px) en fonction du seuil de score.

    Le maximum de cette courbe (point rouge) definit le seuil retenu partout
    ailleurs (matrices de confusion, point d'operation de la courbe ROC).
    C'est un critere plus robuste que le point d'inflection.
    """
    try:
        plt, _, np = _import_mpl()
    except ImportError:
        log.warning("matplotlib non disponible - metrics_f1_threshold.png skipped")
        return None

    mot = metrics.get("mot", {})
    cur = _f1_curve(mot, (SMALL_MAX, MID_MAX))
    if cur is None:
        log.info("metrics_f1_threshold.png skipped : pas de donnees de taille GT")
        return None

    thr, f1 = cur
    order = np.argsort(thr)  # seuil croissant pour un trace lisible
    x = thr[order]
    y = f1[order]
    k = int(np.argmax(f1))
    t_star = float(thr[k])
    f1_star = float(f1[k])

    fig, ax = plt.subplots(figsize=(9, 6), facecolor="white")
    fig.suptitle(
        "F1 du detecteur en fonction du seuil (GT 15-40 px)",
        fontsize=13,
        fontweight="bold",
        y=0.98,
    )
    ax.plot(x, y, color="#1565C0", lw=1.6)
    ax.scatter(
        [t_star],
        [f1_star],
        color="red",
        s=90,
        zorder=6,
        label=f"F1 max = {f1_star:.3f}  @ seuil = {t_star:.3f}",
    )
    ax.set_xlabel("Seuil de score detecteur", fontsize=11)
    ax.set_ylabel("F1 (GT 15-40 px)", fontsize=11)
    ax.set_xlim(0, max(float(x.max()), 1e-3))
    ax.set_ylim(0, 1.05)
    ax.grid(True, linestyle="--", alpha=0.5)
    ax.legend(fontsize=10, loc="lower center")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.set_facecolor(CLR_BG)

    plt.tight_layout(rect=[0, 0, 1, 0.96])
    out = out_dir / "metrics_f1_threshold.png"
    fig.savefig(out, dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    log.info("metrics_f1_threshold.png -> %s", out)
    return out
