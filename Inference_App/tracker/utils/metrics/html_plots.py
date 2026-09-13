##########################################
# Project  : VisionNexus
# File     : utils/metrics/html_plots.py
# Author   : VisionNexus contributors
# Obj  : Interactive Plotly HTML timelines (centroid, IoU, ID stability).
##########################################

import logging
from pathlib import Path

from utils.metrics.common import (
    _ALERT_C,
    _MOT_BG,
    _PLOTLY_20,
    _SOT1_BG,
    _SOT2_BG,
    CLR_MOT,
    CLR_SOT,
    CLR_SOT2,
    _get_runs,
    _import_plotly,
    _mode_runs,
)

log = logging.getLogger(__name__)


#################################


def _plot_centroid_html(
    mot_cdist: dict[int, list[tuple[int, float]]],
    mot_active: list[int],
    sot_cdist: dict[int, list[tuple[int, float]]],
    sot_active: list[int],
    sot2_cdist: dict[int, list[tuple[int, float]]] | None,
    sot2_active: list[int] | None,
    f_min: int,
    f_max: int,
    out_path: Path,
    gt_id_timeline: dict[int, list[tuple[int, int]]] | None = None,
    gt_ann_frames: dict[int, list[int]] | None = None,
    alert_px: float = 50.0,
) -> Path | None:
    """
    HTML unifié : deux figures Plotly dans un seul fichier.

    Figure 1 - timeline distance centroïde + barre de mode :
      Fond vert/bleu/orange par mode actif.
      Transitions verticales pointillées MOT↔SOT.
      MOT : courbes par GT (ou track), coupées aux limites de runs + gaps.
            Fausses alarmes (tracks sans GT) regroupées en trace "FA".
            Triangles rouges sous y=0 = GT annotée sans détection.
      SOT : courbes par run, X rouges = décrochages.
      Barre de mode (fine) sous la timeline.

    Figure 2 - distributions (figure indépendante) :
      Box plots MOT global, par GT, FA, SOT1, SOT2.
    """
    go, make_subplots, pc = _import_plotly()
    if go is None:
        log.warning("plotly non disponible - metrics_centroid.html skipped (pip install plotly)")
        return None

    has_mot = bool(mot_cdist)
    has_sot = bool(sot_cdist)
    has_sot2 = bool(sot2_cdist)

    if not mot_cdist and not sot_cdist:
        log.info("metrics_centroid.html skipped : aucune donnee centroide")
        return None

    # --- MOT regroupe par GT si gt_id_timeline dispo ###########
    has_gt = bool(gt_id_timeline) and has_mot
    if has_gt:
        fd_lk: dict[int, dict[int, float]] = {tid: dict(pts) for tid, pts in mot_cdist.items()}
        gt_cdist: dict[int, list[tuple[int, float]]] = {}
        for gt_id, tl in gt_id_timeline.items():
            pts_gt = sorted((f, fd_lk[tid][f]) for f, tid in tl if tid in fd_lk and f in fd_lk[tid])
            if pts_gt:
                gt_cdist[gt_id] = pts_gt
        gt_ids = sorted(gt_cdist.keys())

        # Fausses alarmes : tracks MOT non references par aucune GT
        gt_tids = {tid for tl in gt_id_timeline.values() for _, tid in tl}
        fa_tids = [tid for tid in mot_cdist if tid not in gt_tids]
        fa_pts: list[tuple[int, float]] = sorted(pt for tid in fa_tids for pt in mot_cdist[tid])
    else:
        gt_cdist = {}
        gt_ids = []
        fa_tids = []
        fa_pts = []

    # --- Runs de mode #####################
    mot_runs = _mode_runs(sorted(mot_active) if mot_active else [])
    sot_runs = _mode_runs(sorted(sot_active) if sot_active else [])
    sot2_runs = _mode_runs(sorted(sot2_active) if sot2_active else [])

    # --- Helper : coupe aux limites de runs ET aux sauts de frames #######
    def _seg_gaps(pts_list, runs_2, max_gap: int = 8):
        xs, ys = [], []
        for rs, re in runs_2:
            seg = sorted((f, d) for f, d in pts_list if rs <= f <= re)
            if not seg:
                continue
            if xs:
                xs.append(None)
                ys.append(None)
            for k, (f, d) in enumerate(seg):
                if k > 0 and f - seg[k - 1][0] > max_gap:
                    xs.append(None)
                    ys.append(None)
                xs.append(f)
                ys.append(d)
        return xs, ys

    # --- y_max + marge negative pour les triangles d'absence ########
    _all_d = (
        [d for pts in mot_cdist.values() for _, d in pts]
        + [d for pts in sot_cdist.values() for _, d in pts]
        + [d for pts in (sot2_cdist or {}).values() for _, d in pts]
    )
    _y_max = max(_all_d) if _all_d else 80.0
    _y_miss = -_y_max * 0.06

    _CLR_FA = "#CC5500"  # orange brulee pour fausses alarmes

    ###########################################
    # FIGURE 1 : timeline + barre de mode
    ###########################################
    fig1 = make_subplots(
        rows=2,
        cols=1,
        row_heights=[0.82, 0.18],
        vertical_spacing=0.04,
        subplot_titles=["Distances centroide prediction / GT", ""],
    )

    # Fonds colores par mode
    for rs, re in mot_runs:
        fig1.add_vrect(
            x0=rs - 0.5,
            x1=re + 0.5,
            fillcolor=_MOT_BG,
            opacity=1,
            layer="below",
            line_width=0,
            row=1,
            col=1,
        )
    for rs, re in sot_runs:
        fig1.add_vrect(
            x0=rs - 0.5,
            x1=re + 0.5,
            fillcolor=_SOT1_BG,
            opacity=1,
            layer="below",
            line_width=0,
            row=1,
            col=1,
        )
    for rs, re in sot2_runs:
        fig1.add_vrect(
            x0=rs - 0.5,
            x1=re + 0.5,
            fillcolor=_SOT2_BG,
            opacity=1,
            layer="below",
            line_width=0,
            row=1,
            col=1,
        )

    # Traits de transition
    trans = set()
    for rs, re in sot_runs + sot2_runs:
        trans.add(rs - 0.5)
        trans.add(re + 0.5)
    for xv in sorted(trans):
        fig1.add_vline(
            x=xv, line_dash="dash", line_color="rgba(60,60,60,0.55)", line_width=1.5, row=1, col=1
        )

    # Courbes MOT
    if has_mot:
        if has_gt and gt_cdist:
            for i, gt_id in enumerate(gt_ids):
                xs, ys = _seg_gaps(gt_cdist[gt_id], mot_runs)
                clr = _PLOTLY_20[i % len(_PLOTLY_20)]
                fig1.add_trace(
                    go.Scatter(
                        x=xs,
                        y=ys,
                        mode="lines+markers",
                        connectgaps=False,
                        line={"color": clr, "width": 1.8},
                        marker={"color": clr, "size": 4, "opacity": 0.85},
                        name=f"MOT GT{gt_id}",
                        legendgroup=f"mot_gt{gt_id}",
                        hovertemplate=f"MOT GT{gt_id}  F:%{{x}}  dist:%{{y:.1f}}px<extra></extra>",
                    ),
                    row=1,
                    col=1,
                )

            # Fausses alarmes
            if fa_pts:
                xs, ys = _seg_gaps(fa_pts, mot_runs)
                fig1.add_trace(
                    go.Scatter(
                        x=xs,
                        y=ys,
                        mode="markers",
                        connectgaps=False,
                        marker={"color": _CLR_FA, "size": 4, "opacity": 0.60, "symbol": "circle"},
                        name=f"MOT FA ({len(fa_tids)} tracks)",
                        legendgroup="mot_fa",
                        hovertemplate="FA  F:%{x}  dist:%{y:.1f}px<extra></extra>",
                    ),
                    row=1,
                    col=1,
                )

            # Triangles absences sous l'axe
            # Chaque GT est decale verticalement de 4 px pour eviter la superposition.
            if gt_ann_frames:
                miss_shown = False
                _gt_ids_sorted = sorted(gt_ann_frames.keys())
                _y_step_miss = _y_max * 0.025  # ecart vertical entre GT
                for _gi, gt_id in enumerate(_gt_ids_sorted):
                    det = {f for f, _ in gt_id_timeline.get(gt_id, [])}
                    missed = sorted(set(gt_ann_frames[gt_id]) - det)
                    if not missed:
                        continue
                    if len(missed) > 500:
                        missed = missed[:: len(missed) // 500]
                    _y_this = _y_miss - _gi * _y_step_miss
                    fig1.add_trace(
                        go.Scatter(
                            x=missed,
                            y=[_y_this] * len(missed),
                            mode="markers",
                            marker={
                                "color": _ALERT_C,
                                "size": 9,
                                "symbol": "triangle-down",
                                "opacity": 0.80,
                            },
                            name=f"Det manquee GT{gt_id}"
                            if len(_gt_ids_sorted) > 1
                            else "Detection manquee",
                            legendgroup="mot_missed",
                            showlegend=not miss_shown,
                            hovertemplate=f"GT{gt_id} manquee  F:%{{x}}<extra></extra>",
                        ),
                        row=1,
                        col=1,
                    )
                    miss_shown = True
        else:
            for i, tid in enumerate(sorted(mot_cdist.keys(), key=lambda t: -len(mot_cdist[t]))):
                xs, ys = _seg_gaps(mot_cdist[tid], mot_runs)
                clr = _PLOTLY_20[i % len(_PLOTLY_20)]
                fig1.add_trace(
                    go.Scatter(
                        x=xs,
                        y=ys,
                        mode="lines+markers",
                        connectgaps=False,
                        line={"color": clr, "width": 1.5},
                        marker={"color": clr, "size": 4, "opacity": 0.75},
                        name=f"MOT T{tid}",
                        legendgroup=f"mot_t{tid}",
                        hovertemplate=f"T{tid}  F:%{{x}}  dist:%{{y:.1f}}px<extra></extra>",
                    ),
                    row=1,
                    col=1,
                )

    # Courbes SOT
    def _add_sot_traces(cdist, label, clr_line, runs):
        n_bad = sum(1 for pts in cdist.values() for f, d in pts if d > alert_px)
        n_tot = sum(len(pts) for pts in cdist.values())
        pct = f"{100 * n_bad // max(1, n_tot)}% decr."
        first = True
        for _tid, pts in sorted(cdist.items()):
            xs, ys = _seg_gaps(pts, runs)
            fig1.add_trace(
                go.Scatter(
                    x=xs,
                    y=ys,
                    mode="lines+markers",
                    connectgaps=False,
                    line={"color": clr_line, "width": 1.8},
                    marker={"color": clr_line, "size": 4, "opacity": 0.75},
                    name=f"{label} ({pct})" if first else label,
                    legendgroup=f"{label}_line",
                    showlegend=first,
                    hovertemplate=f"{label}  F:%{{x}}  dist:%{{y:.1f}}px<extra></extra>",
                ),
                row=1,
                col=1,
            )
            first = False
            bad = [(f, d) for f, d in pts if d > alert_px]
            if bad:
                fig1.add_trace(
                    go.Scatter(
                        x=[f for f, d in bad],
                        y=[d for f, d in bad],
                        mode="markers",
                        marker={
                            "color": _ALERT_C,
                            "size": 10,
                            "symbol": "diamond-open",
                            "line": {"width": 2.2},
                        },
                        name=f"{label} decrochage",
                        legendgroup=f"{label}_bad",
                        showlegend=True,
                        hovertemplate=(
                            f"{label} decrochage  F:%{{x}}  dist:%{{y:.1f}}px<extra></extra>"
                        ),
                    ),
                    row=1,
                    col=1,
                )

    if has_sot:
        _add_sot_traces(sot_cdist, "SOT1", CLR_SOT, sot_runs)
    if has_sot2 and sot2_cdist:
        _add_sot_traces(sot2_cdist, "SOT2", CLR_SOT2, sot2_runs)

    # Axe Y row 1 - marge basse elargie pour les triangles decales par GT
    _n_gt_ids = len(gt_ann_frames) if gt_ann_frames else 1
    _y_step_miss = _y_max * 0.025
    _y_bot_miss = _y_miss - max(0, _n_gt_ids - 1) * _y_step_miss
    _y_range_bot = min(_y_bot_miss * 1.4, _y_miss * 1.8)
    fig1.update_yaxes(
        title_text="Distance centroide (px)", range=[_y_range_bot, _y_max * 1.05], row=1, col=1
    )
    fig1.update_xaxes(range=[f_min - 1, f_max + 1], showticklabels=False, row=1, col=1)

    # Barre de mode (row 2) - 3 lignes séparées : MOT, SOT1, SOT2
    _mode_cfg = [
        ("MOT", mot_runs, CLR_MOT),
        ("SOT1", sot_runs, CLR_SOT),
        ("SOT2", sot2_runs, CLR_SOT2),
    ]
    shown_m: dict[str, bool] = {}
    for mlabel, runs, mclr in _mode_cfg:
        for rs, re in runs:
            fig1.add_trace(
                go.Bar(
                    orientation="h",
                    y=[mlabel],
                    x=[re - rs + 1],
                    base=[rs],
                    marker_color=mclr,
                    marker_line_width=0,
                    name=mlabel,
                    legendgroup=f"mode_{mlabel}",
                    showlegend=not shown_m.get(mlabel, False),
                    hovertemplate=f"{mlabel}  F:{rs}–{re}<extra></extra>",
                ),
                row=2,
                col=1,
            )
            shown_m[mlabel] = True

    # Décrochages SOT visibles sur les lignes de mode (diamonds rouges)
    if has_sot:
        bad_s1 = sorted({f for pts in sot_cdist.values() for f, d in pts if d > alert_px})
        if bad_s1:
            fig1.add_trace(
                go.Scatter(
                    x=bad_s1,
                    y=["SOT1"] * len(bad_s1),
                    mode="markers",
                    marker={
                        "color": _ALERT_C,
                        "size": 9,
                        "symbol": "diamond-open",
                        "line": {"width": 2.0},
                    },
                    name="SOT1 decr.",
                    legendgroup="sot1_decr_bar",
                    showlegend=True,
                    hovertemplate="SOT1 decrochage  F:%{x}<extra></extra>",
                ),
                row=2,
                col=1,
            )
    if has_sot2 and sot2_cdist:
        bad_s2 = sorted({f for pts in sot2_cdist.values() for f, d in pts if d > alert_px})
        if bad_s2:
            fig1.add_trace(
                go.Scatter(
                    x=bad_s2,
                    y=["SOT2"] * len(bad_s2),
                    mode="markers",
                    marker={
                        "color": _ALERT_C,
                        "size": 9,
                        "symbol": "diamond-open",
                        "line": {"width": 2.0},
                    },
                    name="SOT2 decr.",
                    legendgroup="sot2_decr_bar",
                    showlegend=True,
                    hovertemplate="SOT2 decrochage  F:%{x}<extra></extra>",
                ),
                row=2,
                col=1,
            )

    fig1.update_xaxes(range=[f_min - 1, f_max + 1], title_text="Frame (absolu)", row=2, col=1)
    fig1.update_yaxes(
        showticklabels=True,
        showgrid=False,
        zeroline=False,
        categoryorder="array",
        categoryarray=["SOT2", "SOT1", "MOT"],  # SOT2 bas, MOT haut
        tickfont={"size": 9},
        row=2,
        col=1,
    )

    n_mot_fr = len(mot_active) if mot_active else 0
    n_sot_fr = len(sot_active) if sot_active else 0
    n_sot2_fr = len(sot2_active) if sot2_active else 0
    subtitle = (
        f"MOT: {n_mot_fr} frames"
        + (f"  |  SOT1: {n_sot_fr} frames" if n_sot_fr else "")
        + (f"  |  SOT2: {n_sot2_fr} frames" if n_sot2_fr else "")
    )
    fig1.update_layout(
        barmode="overlay",
        title={
            "text": f"Distances centroide prediction / GT - MOT + SOT<br><sup>{subtitle}</sup>",
            "x": 0.5,
        },
        height=620,
        template="plotly_white",
        hovermode="x unified",
        legend={
            "orientation": "v",
            "x": 1.01,
            "y": 1,
            "font": {"size": 9},
            "itemsizing": "constant",
        },
    )

    ###########################################
    # FIGURE 2 : distributions (figure independante)
    ###########################################
    fig2 = go.Figure()

    def _box2(dists, label, clr, stats_str=""):
        if not dists:
            return
        full_label = f"{label}  ({stats_str})" if stats_str else label
        fig2.add_trace(
            go.Box(
                y=dists,
                name=full_label,
                showlegend=True,
                visible=True,
                marker_color=clr,
                boxpoints="outliers",
                line={"width": 1.5},
                hovertemplate=f"{label}<br>dist: %{{y:.1f}}px<extra></extra>",
            )
        )

    _box2([d for pts in mot_cdist.values() for _, d in pts], "MOT", CLR_MOT)
    if has_gt and gt_cdist:
        for i, gt_id in enumerate(gt_ids):
            _box2([d for _, d in gt_cdist[gt_id]], f"GT{gt_id}", _PLOTLY_20[i % len(_PLOTLY_20)])
    if fa_pts:
        _box2([d for _, d in fa_pts], "FA", _CLR_FA)
    _box2([d for pts in sot_cdist.values() for _, d in pts], "SOT1", CLR_SOT)
    if has_sot2 and sot2_cdist:
        _box2([d for pts in sot2_cdist.values() for _, d in pts], "SOT2", CLR_SOT2)

    fig2.update_layout(
        title={
            "text": "Distributions - distance centroide (px) — clic légende pour masquer",
            "x": 0.5,
        },
        height=520,
        template="plotly_white",
        xaxis={"title": ""},
        yaxis={"title": "Distance (px)", "rangemode": "tozero"},
        showlegend=True,
        legend={
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.02,
            "xanchor": "right",
            "x": 1,
            "font": {"size": 10},
        },
    )

    ###########################################
    # Assemblage HTML
    ###########################################
    _cfg = {"responsive": True}
    div1 = fig1.to_html(
        include_plotlyjs="cdn", full_html=False, config=_cfg, div_id="cen-timeline-fig"
    )
    div2 = fig2.to_html(
        include_plotlyjs=False, full_html=False, config=_cfg, div_id="centroid-box-fig"
    )

    _js = (
        "<script>(function(){"
        # auto-scale boxplot sur clic légende
        'var bx=document.getElementById("centroid-box-fig");'
        "if(bx){"
        'function _rs(){requestAnimationFrame(function(){Plotly.relayout(bx,{"yaxis.autorange":true});});}'
        'bx.on("plotly_legendclick",_rs);bx.on("plotly_legenddoubleclick",_rs);}'
        # smoothing slider (change = uniquement au relâchement)
        'var tl=document.getElementById("cen-timeline-fig");'
        "if(!tl)return;"
        "var _origY=null;"
        "function _smooth(arr,w){"
        "if(w===0)return arr.slice();"
        "return arr.map(function(v,i){"
        "if(v===null||v===undefined)return v;"
        "var s=0,c=0;"
        "for(var j=Math.max(0,i-w);j<=Math.min(arr.length-1,i+w);j++){"
        "if(arr[j]!==null&&arr[j]!==undefined){s+=arr[j];c++;}}"
        "return c?s/c:v;});}"
        "function _apply(w){"
        "if(!_origY)_origY=tl.data.map(function(t){return t.y?t.y.slice():null;});"
        "Plotly.restyle(tl,{y:tl.data.map(function(t,i){"
        'if(!_origY[i]||!t.mode||t.mode.indexOf("lines")<0)return _origY[i];'
        "return _smooth(_origY[i],w);})});}"
        'var sl=document.getElementById("cen-sm-sl");'
        'var lb=document.getElementById("cen-sm-lb");'
        "if(sl){"
        'sl.addEventListener("change",function(){lb.textContent=this.value;_apply(+this.value);});}'
        "})();</script>"
    )

    _smooth_ctrl = (
        '<div style="text-align:center;margin:10px 0 4px;font-size:13px;color:#555;">'
        'Lissage : <b id="cen-sm-lb">0</b> frames &nbsp;'
        '<input id="cen-sm-sl" type="range" min="0" max="20" value="0" step="1"'
        ' style="width:200px;vertical-align:middle;">'
        "</div>"
    )

    html = (
        "<!DOCTYPE html>\n<html>\n"
        '<head><meta charset="utf-8"><title>Centroid Metrics</title></head>\n'
        '<body style="font-family:sans-serif;background:#f8f8f8;padding:12px 20px;">\n'
        + _smooth_ctrl
        + div1
        + '\n<div style="height:40px;"></div>\n'
        + '<hr style="border:none;border-top:2px solid #ddd;">\n'
        + '<p style="text-align:center;color:#666;font-size:13px;margin:8px 0 4px;">'
        "Distributions (clic légende pour masquer — axe Y se recadre automatiquement)</p>\n"
        + div2
        + _js
        + "\n</body>\n</html>"
    )

    with open(str(out_path), "w", encoding="utf-8") as _fh:
        _fh.write(html)
    log.info("metrics_centroid.html -> %s", out_path)
    return out_path


#################################


def _plot_id_stability_mot_html(
    gt_id_timeline: dict[int, list[tuple[int, int]]],
    gt_id_track_mapping: dict[int, list[int]],
    per_gt_idsw: dict[int, int],
    has_persistent_gt_ids: bool,
    out_path: Path,
    mot_cdist: dict[int, list[tuple[int, float]]] | None = None,
    gt_ann_frames: dict[int, list[int]] | None = None,
    f_min: int = 0,
    f_max: int = 0,
    mot_active: list[int] | None = None,
    sot_active: list[int] | None = None,
    sot2_active: list[int] | None = None,
) -> Path | None:
    """
    Un subplot par GT (stacked, x partage) : distance centroide + plages track + IDSW.

    Chaque subplot :
      Ligne bleue = distance centroide GT<->prediction, coupee aux limites de track-runs et gaps.
      Croix rouges = IDSW (y = dist au moment du switch, clampe pour rester visible).
      Triangles rouges = GT annotee sans detection YOLO.
      Barres horizontales non superposees en bas : vert=MOT | bleu=SOT1 | orange=SOT2.
    """
    go, make_subplots, pc = _import_plotly()
    if go is None:
        log.warning("plotly non disponible - metrics_id_stability_mot.html skipped")
        return None
    if not gt_id_timeline or not has_persistent_gt_ids:
        log.info(
            "metrics_id_stability_mot.html skipped : %s",
            "aucune timeline GT" if not gt_id_timeline else "GT sans IDs persistants (YOLO .txt)",
        )
        return None

    gt_ids = sorted(gt_id_timeline.keys())
    n_gt = len(gt_ids)

    # centroid distance lookup: fd_lk[track_id][frame] = dist
    fd_lk: dict[int, dict[int, float]] = {}
    if mot_cdist:
        for tid, pts in mot_cdist.items():
            fd_lk[tid] = dict(pts)

    # Per-GT centroid distances
    gt_cdist: dict[int, list[tuple[int, float]]] = {}
    for gt_id, tl in gt_id_timeline.items():
        pts = sorted((f, fd_lk[tid][f]) for f, tid in tl if tid in fd_lk and f in fd_lk[tid])
        if pts:
            gt_cdist[gt_id] = pts

    # Runs de mode
    mot_runs_s = _mode_runs(sorted(mot_active) if mot_active else [])
    sot_runs_s = _mode_runs(sorted(sot_active) if sot_active else [])
    sot2_runs_s = _mode_runs(sorted(sot2_active) if sot2_active else [])

    # y_max global (echelle distance)
    _all_d = [d for pts in gt_cdist.values() for _, d in pts]
    _y_max = max(_all_d) if _all_d else 80.0

    # Unites de dimensionnement - absolu (pas relatif a _y_max) pour eviter
    # l'ecrasement quand les distances sont tres petites (cibles IR 5x2 px)
    _unit = max(_y_max * 0.10, 1.2)
    _bar_gap = _unit * 0.35  # espace transparent entre y=0 et premiere ligne track
    _row_h = _unit * 1.0  # hauteur de chaque ligne track
    _row_gap = _unit * 0.20  # espace entre lignes track
    _bar_h = _unit * 0.60  # hauteur des barres de mode (MOT/SOT)

    # Par GT : liste des track IDs uniques dans l'ordre de premiere apparition
    def _unique_ordered(tl):
        seen, result = set(), []
        for _, tid in tl:
            if tid not in seen:
                result.append(tid)
                seen.add(tid)
        return result

    gt_unique_tids = {gt_id: _unique_ordered(gt_id_timeline[gt_id]) for gt_id in gt_ids}

    # Hauteurs relatives des subplots (plus de tracks = plus de place)
    _dist_h = _y_max * 1.10 + _bar_gap  # zone distance toujours identique

    def _gt_depth(gt_id):
        n = max(1, len(gt_unique_tids[gt_id]))
        return n * (_row_h + _row_gap) + 3 * _bar_h + _unit * 0.4

    row_units = [_dist_h + _gt_depth(g) for g in gt_ids]
    total_u = sum(row_units)
    row_heights_norm = [u / total_u for u in row_units]

    row_titles = [
        f"GT {gt_id}  -  IDSW: {per_gt_idsw.get(gt_id, 0)}  "
        f"({', '.join(f'T{t}' for t in gt_id_track_mapping.get(gt_id, [])[:6])})"
        for gt_id in gt_ids
    ]
    vspacing = 0.10 if n_gt <= 3 else max(0.03, 0.30 / n_gt)

    fig = make_subplots(
        rows=n_gt,
        cols=1,
        shared_xaxes=True,
        vertical_spacing=vspacing,
        row_heights=row_heights_norm,
        subplot_titles=row_titles,
    )

    _DIST_C = "#1f77b4"

    # Helper : coupe la courbe aux limites de runs ET aux sauts de frames
    def _seg_id(pts_list, runs, max_gap: int = 8):
        xs, ys = [], []
        for rs, re, _tid in runs:
            seg = sorted((f, d) for f, d in pts_list if rs <= f <= re)
            if not seg:
                continue
            if xs:
                xs.append(None)
                ys.append(None)
            for k, (f, d) in enumerate(seg):
                if k > 0 and f - seg[k - 1][0] > max_gap:
                    xs.append(None)
                    ys.append(None)
                xs.append(f)
                ys.append(d)
        return xs, ys

    for i, gt_id in enumerate(gt_ids):
        row = i + 1
        timeline = gt_id_timeline[gt_id]
        runs = _get_runs(timeline)  # [(rs, re, tid), ...]
        unique_tids = gt_unique_tids[gt_id]
        xref = "x" if row == 1 else f"x{row}"
        yref_ax = "y" if row == 1 else f"y{row}"

        # --- Calcul des y-positions des lignes de track (par GT) ########
        # Chaque track unique a sa propre ligne horizontale sous y=0,
        # dans l'ordre de premiere apparition (pas par duree).
        track_y: dict[int, tuple[float, float]] = {}
        y_cursor = -_bar_gap
        for tid in unique_tids:
            y1 = y_cursor
            y0 = y_cursor - _row_h
            track_y[tid] = (y0, y1)
            y_cursor = y0 - _row_gap
        _track_zone_bot = y_cursor

        # Triangles manques : dans le gap au-dessus de la premiere ligne track
        _y_miss_local = -_bar_gap * 0.4

        # Barres de mode sous toutes les lignes de track
        _y_mot_l = (_track_zone_bot - _bar_h, _track_zone_bot)
        _y_sot1_l = (_track_zone_bot - 2 * _bar_h, _track_zone_bot - _bar_h)
        _y_sot2_l = (_track_zone_bot - 3 * _bar_h, _track_zone_bot - 2 * _bar_h)
        _y_bot_l = _track_zone_bot - 3 * _bar_h - _bar_h * 0.4

        # --- Barres de mode en bas ######################
        mode_bars = [
            (mot_runs_s, _y_mot_l, CLR_MOT, "MOT"),
            (sot_runs_s, _y_sot1_l, CLR_SOT, "SOT1"),
            (sot2_runs_s, _y_sot2_l, CLR_SOT2, "SOT2"),
        ]
        for runs_m, (y0, y1), clr_m, lbl_m in mode_bars:
            for rs, re in runs_m:
                fig.add_shape(
                    type="rect",
                    x0=rs - 0.5,
                    x1=re + 0.5,
                    y0=y0,
                    y1=y1,
                    xref=xref,
                    yref=yref_ax,
                    fillcolor=clr_m,
                    opacity=0.75,
                    layer="above",
                    line_width=0,
                )
            if runs_m and f_min < f_max:
                fig.add_annotation(
                    x=f_min - 1,
                    y=(y0 + y1) / 2,
                    xref=xref,
                    yref=yref_ax,
                    text=lbl_m,
                    font={"size": 8, "color": clr_m},
                    showarrow=False,
                    xanchor="right",
                    yanchor="middle",
                )

        # --- Gantt tracks : une ligne par track unique (ordre d'apparition) -
        # Chaque run est colore avec la couleur de SON track ID.
        for rs, re, tid in runs:
            if tid not in track_y:
                continue
            y0, y1 = track_y[tid]
            t_idx = unique_tids.index(tid)
            clr = _PLOTLY_20[t_idx % len(_PLOTLY_20)]
            fig.add_shape(
                type="rect",
                x0=rs - 0.5,
                x1=re + 0.5,
                y0=y0,
                y1=y1,
                xref=xref,
                yref=yref_ax,
                fillcolor=clr,
                opacity=0.80,
                layer="above",
                line_width=0,
            )

        # Labels des tracks sur le cote gauche (un par track unique)
        for t_idx, tid in enumerate(unique_tids):
            y0, y1 = track_y[tid]
            clr = _PLOTLY_20[t_idx % len(_PLOTLY_20)]
            fig.add_annotation(
                x=f_min - 1,
                y=(y0 + y1) / 2,
                xref=xref,
                yref=yref_ax,
                text=f"T{tid}",
                font={"size": 9, "color": clr},
                showarrow=False,
                xanchor="right",
                yanchor="middle",
            )

        # --- Courbe distance centroide (segmentee par track-runs + gaps) ---
        pts = gt_cdist.get(gt_id, [])
        if pts:
            xs, ys = _seg_id(pts, runs)
            fig.add_trace(
                go.Scatter(
                    x=xs,
                    y=ys,
                    mode="lines+markers",
                    line={"color": _DIST_C, "width": 1.8},
                    marker={"color": _DIST_C, "size": 4, "opacity": 0.80},
                    name="dist centroide",
                    legendgroup="dist",
                    showlegend=(i == 0),
                    connectgaps=False,
                    hovertemplate=f"GT{gt_id}  F:%{{x}}  dist:%{{y:.1f}}px<extra></extra>",
                ),
                row=row,
                col=1,
            )

        # --- Triangles d'absence ####################
        if gt_ann_frames and gt_id in gt_ann_frames:
            det = {f for f, _ in timeline}
            missed = sorted(set(gt_ann_frames[gt_id]) - det)
            if len(missed) > 400:
                missed = missed[:: len(missed) // 400]
            if missed:
                fig.add_trace(
                    go.Scatter(
                        x=missed,
                        y=[_y_miss_local] * len(missed),
                        mode="markers",
                        marker={
                            "color": _ALERT_C,
                            "size": 9,
                            "symbol": "triangle-down",
                            "opacity": 0.80,
                        },
                        name="detection manquee",
                        legendgroup="missed",
                        showlegend=(i == 0),
                        hovertemplate=f"GT{gt_id} manquee  F:%{{x}}<extra></extra>",
                    ),
                    row=row,
                    col=1,
                )

        # --- IDSW (croix rouges) ####################
        sw_frames = [
            timeline[k][0] for k in range(1, len(timeline)) if timeline[k][1] != timeline[k - 1][1]
        ]
        if sw_frames:
            tl_dict = dict(timeline)
            sw_dists = []
            for f in sw_frames:
                tid_f = tl_dict.get(f, -1)
                d = fd_lk.get(tid_f, {}).get(f)
                if d is not None:
                    sw_dists.append(max(d, _y_max * 0.04))
                elif tid_f in track_y:
                    y0, y1 = track_y[tid_f]
                    sw_dists.append((y0 + y1) / 2)
                else:
                    sw_dists.append(_y_max * 0.04)
            fig.add_trace(
                go.Scatter(
                    x=sw_frames,
                    y=sw_dists,
                    mode="markers",
                    marker={
                        "color": _ALERT_C,
                        "size": 12,
                        "symbol": "diamond",
                        "opacity": 0.85,
                        "line": {"width": 1.5, "color": "#fff"},
                    },
                    name="IDSW",
                    legendgroup="idsw",
                    showlegend=(i == 0),
                    hovertemplate=f"GT{gt_id} IDSW  F:%{{x}}<extra></extra>",
                ),
                row=row,
                col=1,
            )

        # Axe Y : ticks uniquement pour y >= 0, marge basse pour le Gantt
        n_ticks = 4
        step = max(1.0, round(_y_max / n_ticks, -1) or _y_max / n_ticks)
        tickv = [step * k for k in range(n_ticks + 1) if step * k <= _y_max * 1.05]
        fig.update_yaxes(
            range=[_y_bot_l, _y_max * 1.05],
            tickmode="array",
            tickvals=tickv,
            ticktext=[str(int(v)) for v in tickv],
            title_text="dist (px)",
            title_font={"size": 9},
            zeroline=True,
            zerolinecolor="rgba(0,0,0,0.20)",
            zerolinewidth=1,
            row=row,
            col=1,
        )

    if f_min < f_max:
        for r in range(1, n_gt + 1):
            fig.update_xaxes(range=[f_min - 1, f_max + 1], row=r, col=1)
    fig.update_xaxes(title_text="Frame (absolu)", row=n_gt, col=1)

    total_idsw = sum(per_gt_idsw.values())
    n_frags = sum(1 for t in gt_id_track_mapping.values() if len(t) > 1)
    max_unique = max((len(v) for v in gt_unique_tids.values()), default=1)

    legend_txt = (
        "X rouge = IDSW  |  triangle rouge = detection manquee  |  "
        "Tn = track ID (meme echelle que les logs)  |  Barre basse : vert=MOT  bleu=SOT1  orange=SOT2"
    )
    fig.update_layout(
        title={
            "text": (
                "Stabilite des identites MOT - distance centroide par GT<br>"
                f"<sup>IDSW total: {total_idsw}  |  {n_frags} GT instable(s)"
                f"  |  {legend_txt}</sup>"
            ),
            "x": 0.5,
        },
        height=max(550, (220 + max_unique * 40) * n_gt + 150),
        template="plotly_white",
        showlegend=True,
        legend={
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.02,
            "xanchor": "right",
            "x": 1,
            "font": {"size": 9},
        },
        hoverlabel={"bgcolor": "white"},
    )

    fig.write_html(str(out_path), include_plotlyjs="cdn")
    log.info("metrics_id_stability_mot.html -> %s", out_path)
    return out_path


#################################


def _plot_iou_html(
    mot_m: dict,
    mot_active: list[int],
    sot_m: dict,
    sot_active: list[int],
    sot2_m: "dict | None",
    sot2_active: "list[int] | None",
    f_min: int,
    f_max: int,
    out_path: Path,
    iou_threshold: float = 0.1,
) -> "Path | None":
    """
    HTML similaire à metrics_centroid.html pour l'IoU.

    Figure 1 — timeline IoU par frame :
      Fonds colorés par mode (vert MOT / bleu SOT1 / orange SOT2).
      Lignes IoU par tracker (points TP uniquement connectés).
      Marqueurs ▽ = miss (GT présent, aucune prédiction).
      Marqueurs X = mauvais réaccrochage (prédiction présente, IoU=0).
      Ligne pointillée = seuil IoU.

    Figure 2 — distributions (boxplots) :
      Clic légende → masque/affiche, axe Y se recadre automatiquement.
      Légende : KO (re-clic) / miss (perte cible) / IoU=0 (mauvais réaccroch.)
    """
    go, make_subplots, pc = _import_plotly()
    if go is None:
        log.warning("plotly non disponible - metrics_iou.html skipped (pip install plotly)")
        return None

    # Les clefs viennent du JSON en tant que chaines : on les recast en int pour
    # comparer aux runs (int) et aux frames GT (int) sans lever de TypeError.
    def _int_keys(d):
        return {int(k): v for k, v in (d or {}).items()}

    mot_iou_pf = _int_keys(mot_m.get("iou_per_frame", {}))
    sot_iou_pf = _int_keys(sot_m.get("iou_per_frame", {}))
    sot2_iou_pf = _int_keys((sot2_m or {}).get("iou_per_frame", {}))

    has_mot = bool(mot_iou_pf)
    has_sot = bool(sot_iou_pf)
    has_sot2 = bool(sot2_iou_pf)

    if not has_mot and not has_sot and not has_sot2:
        log.info("metrics_iou.html skipped : aucune donnee IoU par frame")
        return None

    mot_runs = _mode_runs(sorted(mot_active) if mot_active else [])
    sot_runs = _mode_runs(sorted(sot_active) if sot_active else [])
    sot2_runs = _mode_runs(sorted(sot2_active) if sot2_active else [])

    def _seg_iou(iou_pf, runs, max_gap=8):
        # Inclut toutes les frames avec pred (même IoU sub-threshold < iou_threshold)
        pts = sorted((f, v) for f, v in iou_pf.items())
        xs, ys = [], []
        for rs, re in runs:
            seg = [(f, v) for f, v in pts if rs <= f <= re]
            if not seg:
                continue
            if xs:
                xs.append(None)
                ys.append(None)
            for k, (f, v) in enumerate(seg):
                if k > 0 and f - seg[k - 1][0] > max_gap:
                    xs.append(None)
                    ys.append(None)
                xs.append(f)
                ys.append(v)
        return xs, ys

    def _miss_iou_zero_frames(iou_pf, gt_ann_frames):
        all_gt = {f for fl in (gt_ann_frames or {}).values() for f in fl}
        miss = sorted(all_gt - set(iou_pf.keys()))
        # IoU=0 strict : pred existe mais intersection nulle (< 1e-6 pour tolérance flottant)
        iou0 = sorted(f for f, v in iou_pf.items() if v < 1e-6)
        return miss, iou0

    ##########################################
    # FIGURE 1 : timeline IoU
    ##########################################
    fig1 = make_subplots(
        rows=2,
        cols=1,
        row_heights=[0.82, 0.18],
        vertical_spacing=0.04,
        subplot_titles=["IoU prediction / GT par frame", ""],
    )

    # Fonds colorés par mode
    for rs, re in mot_runs:
        fig1.add_vrect(
            x0=rs - 0.5,
            x1=re + 0.5,
            fillcolor=_MOT_BG,
            opacity=1,
            layer="below",
            line_width=0,
            row=1,
            col=1,
        )
    for rs, re in sot_runs:
        fig1.add_vrect(
            x0=rs - 0.5,
            x1=re + 0.5,
            fillcolor=_SOT1_BG,
            opacity=1,
            layer="below",
            line_width=0,
            row=1,
            col=1,
        )
    for rs, re in sot2_runs:
        fig1.add_vrect(
            x0=rs - 0.5,
            x1=re + 0.5,
            fillcolor=_SOT2_BG,
            opacity=1,
            layer="below",
            line_width=0,
            row=1,
            col=1,
        )

    trans = set()
    for rs, re in sot_runs + sot2_runs:
        trans.add(rs - 0.5)
        trans.add(re + 0.5)
    for xv in sorted(trans):
        fig1.add_vline(
            x=xv, line_dash="dash", line_color="rgba(60,60,60,0.55)", line_width=1.5, row=1, col=1
        )

    _y_miss_iou = -0.06

    def _add_iou_mode_traces(iou_pf, gt_ann_frames, label, clr, runs):
        if not iou_pf:
            return
        xs, ys = _seg_iou(iou_pf, runs)
        n_tp = sum(1 for v in iou_pf.values() if v > 0.0)
        miss_fr, iou0_fr = _miss_iou_zero_frames(iou_pf, gt_ann_frames)
        n_sub = sum(1 for v in iou_pf.values() if v < iou_threshold)
        subtitle = f"TP:{n_tp}  miss:{len(miss_fr)}  IoU=0:{len(iou0_fr)}  <seuil:{n_sub}"
        fig1.add_trace(
            go.Scatter(
                x=xs,
                y=ys,
                mode="lines+markers",
                connectgaps=False,
                line={"color": clr, "width": 1.8},
                marker={"color": clr, "size": 4, "opacity": 0.75},
                name=f"{label} ({subtitle})",
                legendgroup=f"{label}_iou",
                hovertemplate=f"{label}  F:%{{x}}  IoU:%{{y:.3f}}<extra></extra>",
            ),
            row=1,
            col=1,
        )

        if iou0_fr:
            fig1.add_trace(
                go.Scatter(
                    x=iou0_fr,
                    y=[0.0] * len(iou0_fr),
                    mode="markers",
                    marker={
                        "color": _ALERT_C,
                        "size": 10,
                        "symbol": "diamond",
                        "opacity": 0.80,
                        "line": {"width": 1.2, "color": "#fff"},
                    },
                    name=f"{label} IoU=0 (mauvais réaccroch.)",
                    legendgroup=f"{label}_iou0",
                    hovertemplate=f"{label} mauvais réaccrochage  F:%{{x}}<extra></extra>",
                ),
                row=1,
                col=1,
            )

        if miss_fr:
            fig1.add_trace(
                go.Scatter(
                    x=miss_fr,
                    y=[_y_miss_iou] * len(miss_fr),
                    mode="markers",
                    marker={
                        "color": _ALERT_C,
                        "size": 9,
                        "symbol": "triangle-down",
                        "opacity": 0.80,
                    },
                    name=f"{label} miss (perte cible)",
                    legendgroup=f"{label}_miss",
                    hovertemplate=f"{label} miss (aucune prédiction)  F:%{{x}}<extra></extra>",
                ),
                row=1,
                col=1,
            )

    if has_mot:
        _add_iou_mode_traces(mot_iou_pf, mot_m.get("gt_ann_frames"), "MOT", CLR_MOT, mot_runs)
    if has_sot:
        _add_iou_mode_traces(sot_iou_pf, sot_m.get("gt_ann_frames"), "SOT1", CLR_SOT, sot_runs)
    if has_sot2 and sot2_m:
        _add_iou_mode_traces(sot2_iou_pf, sot2_m.get("gt_ann_frames"), "SOT2", CLR_SOT2, sot2_runs)

    # Seuil IoU
    fig1.add_hline(
        y=iou_threshold,
        line_dash="dot",
        line_color="#888888",
        line_width=1.2,
        annotation_text=f"seuil={iou_threshold}",
        annotation_position="bottom right",
        row=1,
        col=1,
    )

    fig1.update_yaxes(title_text="IoU (0–1)", range=[_y_miss_iou * 1.8, 1.05], row=1, col=1)
    fig1.update_xaxes(range=[f_min - 1, f_max + 1], showticklabels=False, row=1, col=1)

    # Barre de mode (row 2)
    shown_m: dict[str, bool] = {}
    for mlabel, runs, mclr in [
        ("MOT", mot_runs, CLR_MOT),
        ("SOT1", sot_runs, CLR_SOT),
        ("SOT2", sot2_runs, CLR_SOT2),
    ]:
        for rs, re in runs:
            fig1.add_trace(
                go.Bar(
                    orientation="h",
                    y=[mlabel],
                    x=[re - rs + 1],
                    base=[rs],
                    marker_color=mclr,
                    marker_line_width=0,
                    name=mlabel,
                    legendgroup=f"mode_{mlabel}",
                    showlegend=not shown_m.get(mlabel, False),
                    hovertemplate=f"{mlabel}  F:{rs}–{re}<extra></extra>",
                ),
                row=2,
                col=1,
            )
            shown_m[mlabel] = True

    fig1.update_xaxes(range=[f_min - 1, f_max + 1], title_text="Frame (absolu)", row=2, col=1)
    fig1.update_yaxes(
        showticklabels=True,
        showgrid=False,
        zeroline=False,
        categoryorder="array",
        categoryarray=["SOT2", "SOT1", "MOT"],
        tickfont={"size": 9},
        row=2,
        col=1,
    )

    n_mot_fr = len(mot_active) if mot_active else 0
    n_sot_fr = len(sot_active) if sot_active else 0
    n_sot2_fr = len(sot2_active) if sot2_active else 0
    subtitle = (
        f"MOT: {n_mot_fr} frames"
        + (f"  |  SOT1: {n_sot_fr} frames" if n_sot_fr else "")
        + (f"  |  SOT2: {n_sot2_fr} frames" if n_sot2_fr else "")
    )

    fig1.update_layout(
        barmode="overlay",
        title={"text": f"IoU prediction / GT — MOT + SOT<br><sup>{subtitle}</sup>", "x": 0.5},
        height=620,
        template="plotly_white",
        hovermode="x unified",
        legend={
            "orientation": "v",
            "x": 1.01,
            "y": 1,
            "font": {"size": 9},
            "itemsizing": "constant",
        },
    )

    ##########################################
    # FIGURE 2 : distributions IoU (boxplots toggleables)
    ##########################################
    fig2 = go.Figure()

    def _box_iou(iou_vals, label, clr, stats_str):
        if not iou_vals:
            return
        fig2.add_trace(
            go.Box(
                y=iou_vals,
                name=f"{label}  ({stats_str})",
                showlegend=True,
                visible=True,
                marker_color=clr,
                boxpoints="outliers",
                line={"width": 1.5},
                hovertemplate=f"{label}<br>IoU: %{{y:.3f}}<extra></extra>",
            )
        )

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

    _box_iou(mot_m.get("iou_vals", []), "MOT", CLR_MOT, _mot_stats(mot_m))
    _box_iou(sot_m.get("iou_vals", []), "SOT1", CLR_SOT, _sot_stats(sot_m))
    if sot2_m:
        _box_iou(sot2_m.get("iou_vals", []), "SOT2", CLR_SOT2, _sot_stats(sot2_m))

    fig2.update_layout(
        title={"text": "Distributions IoU (clic légende → masquer, axe Y se recadre)", "x": 0.5},
        height=560,
        template="plotly_white",
        showlegend=True,
        legend={
            "orientation": "h",
            "yanchor": "bottom",
            "y": 1.02,
            "xanchor": "right",
            "x": 1,
            "font": {"size": 10},
        },
        xaxis={"title": ""},
        yaxis={"title": "IoU (0–1)", "range": [0, 1.05], "rangemode": "tozero"},
    )

    ##########################################
    # Assemblage HTML
    ##########################################
    _cfg = {"responsive": True}
    div1 = fig1.to_html(
        include_plotlyjs="cdn", full_html=False, config=_cfg, div_id="iou-timeline-fig"
    )
    div2 = fig2.to_html(include_plotlyjs=False, full_html=False, config=_cfg, div_id="iou-box-fig")

    _js = (
        "<script>(function(){"
        # auto-scale boxplot sur clic légende
        'var bx=document.getElementById("iou-box-fig");'
        "if(bx){"
        'function _rs(){requestAnimationFrame(function(){Plotly.relayout(bx,{"yaxis.autorange":true});});}'
        'bx.on("plotly_legendclick",_rs);bx.on("plotly_legenddoubleclick",_rs);}'
        # smoothing slider (change = uniquement au relâchement)
        'var tl=document.getElementById("iou-timeline-fig");'
        "if(!tl)return;"
        "var _origY=null;"
        "function _smooth(arr,w){"
        "if(w===0)return arr.slice();"
        "return arr.map(function(v,i){"
        "if(v===null||v===undefined)return v;"
        "var s=0,c=0;"
        "for(var j=Math.max(0,i-w);j<=Math.min(arr.length-1,i+w);j++){"
        "if(arr[j]!==null&&arr[j]!==undefined){s+=arr[j];c++;}}"
        "return c?s/c:v;});}"
        "function _apply(w){"
        "if(!_origY)_origY=tl.data.map(function(t){return t.y?t.y.slice():null;});"
        "Plotly.restyle(tl,{y:tl.data.map(function(t,i){"
        'if(!_origY[i]||!t.mode||t.mode.indexOf("lines")<0)return _origY[i];'
        "return _smooth(_origY[i],w);})});}"
        'var sl=document.getElementById("iou-sm-sl");'
        'var lb=document.getElementById("iou-sm-lb");'
        "if(sl){"
        'sl.addEventListener("change",function(){lb.textContent=this.value;_apply(+this.value);});}'
        "})();</script>"
    )

    _smooth_ctrl = (
        '<div style="text-align:center;margin:10px 0 4px;font-size:13px;color:#555;">'
        'Lissage : <b id="iou-sm-lb">0</b> frames &nbsp;'
        '<input id="iou-sm-sl" type="range" min="0" max="20" value="0" step="1"'
        ' style="width:200px;vertical-align:middle;">'
        "</div>"
    )

    html = (
        "<!DOCTYPE html>\n<html>\n"
        '<head><meta charset="utf-8"><title>IoU Metrics</title></head>\n'
        '<body style="font-family:sans-serif;background:#f8f8f8;padding:12px 20px;">\n'
        + _smooth_ctrl
        + div1
        + '\n<div style="height:40px;"></div>\n'
        + '<hr style="border:none;border-top:2px solid #ddd;">\n'
        + '<p style="text-align:center;color:#666;font-size:13px;margin:8px 0 4px;">'
        "Distributions (clic légende pour masquer — axe Y se recadre automatiquement)</p>\n"
        + div2
        + _js
        + "\n</body>\n</html>"
    )
    with open(str(out_path), "w", encoding="utf-8") as _fh:
        _fh.write(html)
    log.info("metrics_iou.html -> %s", out_path)
    return out_path
