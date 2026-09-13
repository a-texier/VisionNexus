##########################################
# Project  : VisionNexus
# File     : utils/metrics/dashboard.py
# Author   : VisionNexus contributors
# Obj  : Orchestrates plot generation and builds the HTML metrics dashboard.
##########################################

import logging
from pathlib import Path

from utils.metrics.html_plots import (
    _plot_centroid_html,
    _plot_id_stability_mot_html,
    _plot_iou_html,
)
from utils.metrics.png_plots import (
    _plot_centroids_boxplot,
    _plot_confusion_matrix,
    _plot_detection_curves,
    _plot_iou_boxplot,
    _plot_summary,
)
from utils.metrics.size_plots import (
    _plot_confusion_15_40,
    _plot_f1_vs_threshold,
)

log = logging.getLogger(__name__)


#################################
# Dashboard HTML 4 onglets
#################################


def generate_metrics_dashboard_html(
    metrics: dict,
    benchmark: dict,
    out_dir: Path,
    html_dir: "Path | None" = None,
) -> "Path | None":
    """
    Dashboard HTML a 4 onglets (iframes) :
      Resume     -> plot/ PNGs (summary, detection, tailles, confusion, boxplots)
      Centroides -> html/metrics_centroid.html
      IoU        -> html/metrics_iou.html
      Stabilite  -> html/metrics_id_stability_mot.html
    Fichier produit : metrics_dashboard.html a la racine de out_dir.
    """
    out_dir = Path(out_dir)
    if html_dir is None:
        html_dir = out_dir / "html"
    html_dir = Path(html_dir)
    run_name = benchmark.get("run_name", "")
    mot_m = metrics.get("mot", {})

    plot_dir = out_dir / "plot"
    has_size_conf = (plot_dir / "metrics_confusion_15_40_px.png").exists()
    has_f1 = (plot_dir / "metrics_f1_threshold.png").exists()

    has_idstab = (
        bool(mot_m.get("gt_id_timeline"))
        and mot_m.get("has_persistent_gt_ids", False)
        and (html_dir / "metrics_id_stability_mot.html").exists()
    )

    tab_defs = [
        ("summary", "Resume"),
        ("centroid", "Centroides"),
        ("iou", "IoU"),
        ("idstab", "Stabilite ID"),
    ]

    btns = " ".join(
        f'<button class="tab-btn{" active" if i == 0 else ""}" '
        f"onclick=\"showTab('{tid}', this)\">{tlabel}</button>"
        for i, (tid, tlabel) in enumerate(tab_defs)
    )

    _idstab_content = (
        '<iframe src="./html/metrics_id_stability_mot.html" id="iframe-idstab"></iframe>'
        if has_idstab
        else '<div style="padding:40px; color:#888; font-size:15px;">'
        "Stabilite ID non disponible (necessite format .ver avec IDs GT persistants).</div>"
    )

    _img_size_conf = (
        '<img src="./plot/metrics_confusion_15_40_px.png" alt="Confusion 15-40px">'
        if has_size_conf
        else ""
    )
    _img_f1 = '<img src="./plot/metrics_f1_threshold.png" alt="F1 vs seuil">' if has_f1 else ""

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Metriques - {run_name}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: system-ui, sans-serif; background: #f0f2f5; overflow: hidden; height: 100vh; }}
  .topbar {{ background: #2c3e50; padding: 8px 16px; display: flex; gap: 6px; align-items: center; height: 46px; }}
  .topbar h1 {{ color: white; font-size: 14px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .tab-btn {{ padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;
               background: rgba(255,255,255,0.15); color: white; transition: background 0.15s; }}
  .tab-btn.active {{ background: #3498db; font-weight: bold; }}
  .tab-btn:hover:not(.active) {{ background: rgba(255,255,255,0.28); }}
  .tab-content {{ display: none; height: calc(100vh - 46px); overflow: hidden; }}
  .tab-content.active {{ display: flex; flex-direction: column; }}
  iframe {{ width: 100%; height: 100%; border: none; flex: 1; }}
  .summary-pane {{ overflow-y: auto; padding: 20px; background: #f8f8f8; height: 100%; }}
  .summary-pane img {{ max-width: 100%; border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); display: block; margin-bottom: 20px; }}
</style>
</head>
<body>
<div class="topbar">
  <h1>Metriques &mdash; {run_name}</h1>
  {btns}
</div>
<div id="tab-summary" class="tab-content active">
  <div class="summary-pane">
    <img src="./plot/metrics_summary.png" alt="Resume metriques">
    <img src="./plot/metrics_confusion.png" alt="Matrice de confusion">
    {_img_size_conf}
    <img src="./plot/roc_curve_total.png" alt="Courbe ROC">
    {_img_f1}
    <img src="./plot/metrics_iou_boxplot.png" alt="IoU boxplot">
    <img src="./plot/metrics_centroids_box_plot.png" alt="Centroides boxplot">
  </div>
</div>
<div id="tab-centroid" class="tab-content">
  <iframe src="./html/metrics_centroid.html" id="iframe-centroid"></iframe>
</div>
<div id="tab-iou" class="tab-content">
  <iframe src="./html/metrics_iou.html" id="iframe-iou"></iframe>
</div>
<div id="tab-idstab" class="tab-content">
  {_idstab_content}
</div>
<script>
function showTab(name, btn) {{
  document.querySelectorAll('.tab-content').forEach(function(el) {{ el.classList.remove('active'); }});
  document.querySelectorAll('.tab-btn').forEach(function(el) {{ el.classList.remove('active'); }});
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}}
</script>
</body>
</html>"""

    out_path = out_dir / "metrics_dashboard.html"
    with open(str(out_path), "w", encoding="utf-8") as _fh:
        _fh.write(html)
    log.info("metrics_dashboard.html -> %s", out_path)
    return out_path


#################################
# Point d'entree public
#################################


def generate_metrics_plots(
    metrics: dict,
    benchmark: dict,
    out_dir: Path,
    centroid_alert_px: float = 50.0,
) -> list[Path]:
    """
    Genere tous les plots de metriques dans *out_dir*.

    Parametres
    ########
    centroid_alert_px : distance (px) au-dela de laquelle un point centroide
        est colore en rouge dans les plots HTML SOT.

    Arborescence produite dans *out_dir* :
      metrics_dashboard.html                Dashboard 4 onglets (iframe) - OUVERTURE PRINCIPALE
      plot/metrics_summary.png              PNG - resume MOTA/IDF1 + tableau
      plot/roc_curve_total.png              PNG - courbe ROC (detections >= seuil F1)
      plot/metrics_confusion.png            PNG - matrices de confusion par mode
      plot/metrics_confusion_15_40_px.png   PNG - confusion GT diagonale 15-40 px
      plot/metrics_iou_boxplot.png          PNG - IoU boxplots par tracker
      plot/metrics_centroids_box_plot.png   PNG - centroides boxplots par tracker
      html/metrics_centroid.html            HTML - timeline centroide + distributions
      html/metrics_iou.html                 HTML - timeline IoU + distributions
      html/metrics_id_stability_mot.html    HTML - Gantt GT->track_id (si format .ver)
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    plot_dir = out_dir / "plot"
    html_dir = out_dir / "html"
    plot_dir.mkdir(parents=True, exist_ok=True)
    html_dir.mkdir(parents=True, exist_ok=True)

    # Accumulateur - dashboard insere EN PREMIER a la fin
    html_files: list[Path] = []
    png_files: list[Path] = []

    p = _plot_summary(metrics, benchmark, plot_dir)
    if p:
        png_files.append(p)

    p = _plot_detection_curves(metrics, plot_dir)
    if p:
        png_files.append(p)

    p = _plot_f1_vs_threshold(metrics, plot_dir)
    if p:
        png_files.append(p)

    p = _plot_confusion_matrix(metrics, plot_dir)
    if p:
        png_files.append(p)

    p = _plot_confusion_15_40(metrics, plot_dir)
    if p:
        png_files.append(p)

    # ## Plage de frames globale pour les zones grises ######################
    mot_m = metrics.get("mot", {})
    sot_m = metrics.get("sot", {})
    sot2_m = metrics.get("sot2") or {}

    mot_active = mot_m.get("active_frames", [])
    sot_active = sot_m.get("active_frames", [])
    sot2_active = sot2_m.get("active_frames", [])

    all_active = sorted(set(mot_active) | set(sot_active) | set(sot2_active))
    f_min = all_active[0] if all_active else 0
    f_max = all_active[-1] if all_active else 0

    # ## Centroides unifies MOT + SOT #########################################
    mot_cdist = mot_m.get("centroid_dists", {})
    sot_cdist = sot_m.get("centroid_dists", {})
    sot2_cdist = sot2_m.get("centroid_dists", {}) if sot2_m else None
    if mot_cdist or sot_cdist or sot2_cdist:
        p = _plot_centroid_html(
            mot_cdist or {},
            mot_active,
            sot_cdist or {},
            sot_active,
            sot2_cdist or None,
            sot2_active or None,
            f_min,
            f_max,
            html_dir / "metrics_centroid.html",
            gt_id_timeline=mot_m.get("gt_id_timeline"),
            gt_ann_frames=mot_m.get("gt_ann_frames"),
            alert_px=centroid_alert_px,
        )
        if p:
            html_files.append(p)

    # ## IoU timeline + distributions ########################################
    p = _plot_iou_html(
        mot_m,
        mot_active,
        sot_m,
        sot_active,
        sot2_m or None,
        sot2_active or None,
        f_min,
        f_max,
        html_dir / "metrics_iou.html",
        iou_threshold=float(metrics.get("iou_threshold", 0.1)),
    )
    if p:
        html_files.append(p)

    # ## Stabilite ID MOT (uniquement si format .ver) ######################
    if mot_m.get("gt_id_timeline") and mot_m.get("has_persistent_gt_ids", False):
        p = _plot_id_stability_mot_html(
            mot_m.get("gt_id_timeline", {}),
            mot_m.get("gt_id_track_mapping", {}),
            mot_m.get("per_gt_idsw", {}),
            mot_m.get("has_persistent_gt_ids", False),
            html_dir / "metrics_id_stability_mot.html",
            mot_cdist=mot_m.get("centroid_dists"),
            gt_ann_frames=mot_m.get("gt_ann_frames"),
            f_min=f_min,
            f_max=f_max,
            mot_active=mot_active,
            sot_active=sot_active,
            sot2_active=sot2_active,
        )
        if p:
            html_files.append(p)

    # ## PNGs boxplots #######################################################
    p = _plot_iou_boxplot(metrics, plot_dir)
    if p:
        png_files.append(p)

    p = _plot_centroids_boxplot(metrics, plot_dir)
    if p:
        png_files.append(p)

    # ## Dashboard (genere en dernier car verifie l'existence des html/) ######
    dashboard = generate_metrics_dashboard_html(metrics, benchmark, out_dir, html_dir)

    # Dashboard EN PREMIER dans la liste retournee
    created: list[Path] = []
    if dashboard:
        created.append(dashboard)
    created.extend(html_files)
    created.extend(png_files)

    log.info("Metrics plots : %d fichier(s) cree(s) dans %s", len(created), out_dir)
    return created
