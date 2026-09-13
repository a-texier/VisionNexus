##########################################
# Project  : VisionNexus
# File     : report.py
# Author   : VisionNexus contributors
# Created  : 2026-06-12
# Obj  : Generates an interactive Plotly.js HTML profiling report from per-frame timing data.
##########################################

from __future__ import annotations

import json
from pathlib import Path

from profiling.profiler import SECTION_COLORS, SECTION_ORDER

#################################
# Logique JavaScript - PAS de f-string, accolades JS literales
#################################
_JS_LOGIC = """
    //####Layouts Plotly ####
    const barLayout = {
        barmode: 'stack',
        paper_bgcolor: '#1e1e2e',
        plot_bgcolor:  '#1e1e2e',
        font:   { color: '#cdd6f4', size: 12 },
        xaxis:  { title: 'Frame ID', gridcolor: '#313244', zeroline: false },
        yaxis:  { title: 'ms', gridcolor: '#313244',
                  zeroline: true, zerolinecolor: '#45475a', zerolinewidth: 1.5,
                  range: [Y_AXIS_MIN, Y_AXIS_MAX] },
        legend: { orientation: 'h', y: 1.14, x: 0 },
        margin: { t: 50, b: 80, l: 60, r: 20 },
        hovermode: 'x unified',
    };
    const pieLayout = {
        paper_bgcolor: '#1e1e2e',
        font:   { color: '#cdd6f4' },
        margin: { t: 10, b: 10, l: 10, r: 10 },
        showlegend: false,
    };

    //####Calcul des stats sur une plage [startFrame, endFrame] ####
    function computeStats(startFrame, endFrame) {
        const n = FRAME_IDS.length;
        let si = 0, ei = n - 1;
        for (let i = 0; i < n; i++)      { if (FRAME_IDS[i] >= startFrame) { si = i; break; } }
        for (let i = n - 1; i >= 0; i--) { if (FRAME_IDS[i] <= endFrame)   { ei = i; break; } }
        const stats = {};
        for (const sec of SECTION_ORDER) {
            if (!SECTION_DATA[sec]) continue;
            const vals = SECTION_DATA[sec].slice(si, ei + 1).filter(v => v > 0);
            if (vals.length === 0) continue;
            const sum = vals.reduce((a, b) => a + b, 0);
            stats[sec] = {
                mean:  sum / vals.length,
                min:   Math.min(...vals),
                max:   Math.max(...vals),
                total: sum / 1000,
            };
        }
        return stats;
    }

    //####Dessine un pie chart dans l'element cible ####
    function drawPie(divId, stats, config) {
        const secs  = SECTION_ORDER.filter(s => stats[s]);
        const means = secs.map(s => stats[s].mean);
        Plotly.react(divId, [{
            type:  'pie',
            labels: secs,
            values: means,
            marker: { colors: secs.map(s => SECTION_COLORS[s] || '#AAAAAA') },
            textinfo: 'label+percent',
            hovertemplate: '<b>%{label}</b><br>%{value:.2f} ms moy<br>%{percent}<extra></extra>',
            sort: false,
        }], pieLayout, config || { responsive: true });
    }

    //####Mise a jour pie selection + tableau ####
    function updateDashboard(startFrame, endFrame) {
        if (!SHOW_SUMMARY) return;
        const stats  = computeStats(startFrame, endFrame);
        const secs   = SECTION_ORDER.filter(s => stats[s]);
        const totalM = secs.map(s => stats[s].mean).reduce((a, b) => a + b, 0);

        drawPie('pie-chart-sel', stats, { responsive: true });

        // Tableau
        const tbody = document.getElementById('stats-tbody');
        if (!tbody) return;
        const sorted = [...secs].sort((a, b) => stats[b].mean - stats[a].mean);
        tbody.innerHTML = sorted.map(sec => {
            const st  = stats[sec];
            const pct = totalM > 0 ? (st.mean / totalM * 100) : 0;
            const col = SECTION_COLORS[sec] || '#AAAAAA';
            return '<tr>'
                + '<td><span class="dot" style="background:' + col + '"></span>' + sec + '</td>'
                + '<td>' + st.mean.toFixed(2) + ' ms</td>'
                + '<td>' + st.min.toFixed(2)  + ' ms</td>'
                + '<td>' + st.max.toFixed(2)  + ' ms</td>'
                + '<td>' + st.total.toFixed(2) + ' s</td>'
                + '<td><div class="bar-bg"><div class="bar-fill" style="width:'
                +   pct.toFixed(1) + '%;background:' + col + '"></div>'
                + '<span class="bar-label">' + pct.toFixed(1) + '%</span></div></td>'
                + '</tr>';
        }).join('');
    }

    //####Pie global (constante, toute la sequence) ####
    function initGlobalPie() {
        if (!SHOW_SUMMARY) return;
        drawPie('pie-chart-global', computeStats(-Infinity, Infinity), { responsive: true });
    }

    //####Initialisation bar chart ####
    if (SHOW_BAR) {
        Plotly.newPlot('bar-chart', BAR_TRACES, barLayout, { responsive: true });
        _updateFpsDisplay();

        // Recalcul FPS apres chaque changement de visibilite (clic legende)
        document.getElementById('bar-chart').on('plotly_restyle', _updateFpsDisplay);

        document.getElementById('bar-chart').on('plotly_relayout', function(ev) {
            const x0  = ev['xaxis.range[0]'];
            const x1  = ev['xaxis.range[1]'];
            const lbl = document.getElementById('range-label');
            if (x0 !== undefined && x1 !== undefined) {
                updateDashboard(x0, x1);
                if (lbl) {
                    lbl.textContent = 'frames ' + Math.round(x0) + '–' + Math.round(x1);
                    lbl.style.display = 'inline';
                }
            } else if (ev['xaxis.autorange'] === true || 'autosize' in ev) {
                updateDashboard(-Infinity, Infinity);
                if (lbl) lbl.style.display = 'none';
            }
        });
    }

    //####Init dashboard (toutes frames au demarrage) ####
    if (SHOW_SUMMARY) {
        updateDashboard(-Infinity, Infinity);
        initGlobalPie();
    }

    //####FPS dynamique : recalcule quand des sections sont masquees ####
    //
    // Lit la visibilite reelle des traces Plotly pour determiner quelles
    // sections sont cachees, puis calcule le FPS moyen hypothetique.
    //
    //   eff_total[i] = total_ms[i] - sum(section_ms[s][i]) pour s masque
    //   fps_dyn = mean(1000 / eff_total[i])
    //
    // Exemples :
    //   Tout visible -> fps_dyn == fps reel
    //   "render" masque -> fps_dyn == fps hypothetique sans render
    function _calcDynamicFPS() {
        const chart = document.getElementById('bar-chart');
        if (!chart || !chart.data) return '--';
        const traces = chart.data;
        const n = TOTAL_MS.length;
        let sum = 0, count = 0;
        for (let i = 0; i < n; i++) {
            let eff = TOTAL_MS[i];
            for (let ti = 0; ti < SECTION_ORDER.length; ti++) {
                const t = traces[ti];
                if (!t) continue;
                if (t.visible === false || t.visible === 'legendonly') {
                    const d = SECTION_DATA[SECTION_ORDER[ti]];
                    if (d) eff -= d[i];
                }
            }
            if (eff > 0) { sum += 1000.0 / eff; count++; }
        }
        return count > 0 ? (sum / count).toFixed(0) : '--';
    }

    function _updateFpsDisplay() {
        const el = document.getElementById('fps-dynamic');
        if (el) el.textContent = _calcDynamicFPS() + ' FPS';
        const elw = document.getElementById('fps-wall');
        if (elw && FPS_WALL_MEAN > 0) {
            elw.textContent = FPS_WALL_MEAN.toFixed(1) + ' FPS total';
        }
    }
"""


def generate_html(
    frame_data: dict[int, dict[str, float]],
    frame_order: list[int],
    frame_totals: dict[int, float],
    output_path: Path,
    show_per_frame: bool = True,
    show_summary: bool = True,
    fps_wall_mean: float = 0.0,
    fps_wall_per_frame: list = None,
) -> None:
    """
    Genere le fichier HTML de rapport de profiling.

    Parameters
    ########
    frame_data    : {frame_id: {section: seconds}}
    frame_order   : liste ordonnee des frame_id
    frame_totals  : {frame_id: total_seconds}
    output_path   : chemin de sortie du fichier HTML
    show_per_frame: inclure le bar chart par frame (avec toggle ms/FPS)
    show_summary  : inclure les pie charts et le tableau
    """
    #####Sections presentes dans les donnees ####
    all_sections: list[str] = []
    for name in SECTION_ORDER:
        if any(name in frame_data[fid] for fid in frame_order):
            all_sections.append(name)
    if any("other" in frame_data[fid] for fid in frame_order):
        all_sections.append("other")

    frame_ids_js = [int(fid) for fid in frame_order]

    # ms par section par frame
    section_data: dict[str, list[float]] = {}
    for sec in all_sections:
        section_data[sec] = [round(frame_data[fid].get(sec, 0.0) * 1000, 3) for fid in frame_order]

    total_ms = [round(frame_totals.get(fid, 0.0) * 1000, 3) for fid in frame_order]

    # Metriques globales pour le header
    fps_vals = [1000.0 / t for t in total_ms if t > 0]
    fps_mean = round(sum(fps_vals) / len(fps_vals), 1) if fps_vals else 0.0
    fps_min = round(min(fps_vals), 1) if fps_vals else 0.0
    dur_s = round(sum(total_ms) / 1000, 1)
    n_frames = len(frame_order)

    fps_wall_badge = ""
    if fps_wall_mean and fps_wall_mean > 0:
        fps_wall_badge = (
            f'<span class="badge badge-dim" title="FPS wall-clock (loader + traitement)">'
            f"FPS&nbsp;total&nbsp;:&nbsp;{round(fps_wall_mean, 1)}</span>"
        )

    #################################
    # Loader IO par frame (wall - proc) - optionnel si fps_wall_per_frame fourni
    #################################
    has_loader_data = bool(fps_wall_per_frame and len(fps_wall_per_frame) == len(frame_order))
    loader_io_ms: list = []
    all_wall_ms: list = []
    if has_loader_data:
        for i, fid in enumerate(frame_order):
            proc_ms = frame_totals.get(fid, 0.0) * 1000
            wall_ms = fps_wall_per_frame[i] * 1000
            loader_io_ms.append(round(max(0.0, wall_ms - proc_ms), 3))
            all_wall_ms.append(round(wall_ms, 3))

    # Axe Y calé sur le proc (data read dépasse en haut - intentionnel)
    # Labels FPS positionnés proportionnellement au proc, pas au wall-clock
    _proc_max = max(total_ms) if total_ms and max(total_ms) > 0 else 200.0
    y_axis_max = round(_proc_max * 1.3, 1)
    y_proc_pos = round(-_proc_max * 0.08, 2)
    y_total_pos = round(-_proc_max * 0.18, 2)
    y_axis_min = round(-_proc_max * 0.28, 2)

    #################################
    # Traces bar chart ms
    # Ordre d'empilement (bas -> haut) :
    #   sections processing colorées -> frame_load gris -> loader_io gris clair
    #################################
    sections_base = [s for s in SECTION_ORDER if s in all_sections and s != "frame_load"]
    if "other" in all_sections:
        sections_base.append("other")
    if "frame_load" in all_sections:
        sections_base.append("frame_load")  # en haut des sections mesurées

    bar_traces = []
    for sec in sections_base:
        color = SECTION_COLORS.get(sec, "#AAAAAA")
        bar_traces.append(
            {
                "type": "bar",
                "name": sec,
                "x": frame_ids_js,
                "y": section_data[sec],
                "marker": {"color": color},
                "hovertemplate": ("<b>" + sec + "</b><br>Frame %{x}<br>%{y:.2f} ms<extra></extra>"),
            }
        )

    # data read : tout en haut, gris semi-transparent (hors profiling YAML)
    # Couvre tous les loaders : optional_format, MP4, dossier images, etc.
    if loader_io_ms:
        bar_traces.append(
            {
                "type": "bar",
                "name": "data read †",
                "x": frame_ids_js,
                "y": loader_io_ms,
                "marker": {"color": "#9399b2", "opacity": 0.38},
                "hovertemplate": (
                    "<b>data read †</b><br>%{y:.2f} ms - hors profiling YAML<extra></extra>"
                ),
            }
        )

    # Ligne total processing (legendonly)
    bar_traces.append(
        {
            "type": "scatter",
            "mode": "lines",
            "name": "total proc",
            "x": frame_ids_js,
            "y": total_ms,
            "line": {"color": "#FF4444", "width": 1.5, "dash": "dot"},
            "hovertemplate": "Total proc %{y:.2f} ms<extra></extra>",
            "visible": "legendonly",
        }
    )

    #####FPS labels sous les barres (y négatif) ####
    # FPS proc (blanc, grand) : 1000 / total processing
    fps_proc_labels = [f"{1000.0 / t:.0f}" if t > 0 else "" for t in total_ms]
    bar_traces.append(
        {
            "type": "scatter",
            "mode": "text",
            "name": "FPS proc",
            "x": frame_ids_js,
            "y": [y_proc_pos] * len(frame_ids_js),
            "text": fps_proc_labels,
            "textangle": -90,
            "textfont": {"color": "rgba(255,255,255,0.90)", "size": 9},
            "showlegend": False,
            "hoverinfo": "skip",
        }
    )

    # FPS total (gris, petit) : 1000 / wall-clock - uniquement si données disponibles
    if has_loader_data and all_wall_ms:
        fps_total_labels = [f"{1000.0 / w:.0f}" if w > 0 else "" for w in all_wall_ms]
        bar_traces.append(
            {
                "type": "scatter",
                "mode": "text",
                "name": "FPS+load",
                "x": frame_ids_js,
                "y": [y_total_pos] * len(frame_ids_js),
                "text": fps_total_labels,
                "textangle": -90,
                "textfont": {"color": "rgba(100,105,120,0.90)", "size": 7},
                "showlegend": False,
                "hoverinfo": "skip",
            }
        )

    #################################
    # Injection des donnees (f-string)
    #################################
    data_js = (
        f"const FRAME_IDS     = {json.dumps(frame_ids_js)};\n"
        f"    const SECTION_DATA  = {json.dumps(section_data)};\n"
        f"    const TOTAL_MS      = {json.dumps(total_ms)};\n"
        f"    const SECTION_COLORS= {json.dumps(SECTION_COLORS)};\n"
        f"    const SECTION_ORDER = {json.dumps(all_sections)};\n"
        f"    const BAR_TRACES    = {json.dumps(bar_traces)};\n"
        f"    const SHOW_BAR      = {json.dumps(show_per_frame)};\n"
        f"    const SHOW_SUMMARY  = {json.dumps(show_summary)};\n"
        f"    const FPS_WALL_MEAN = {json.dumps(round(fps_wall_mean, 1))};\n"
        f"    const Y_AXIS_MIN    = {json.dumps(y_axis_min)};\n"
        f"    const Y_AXIS_MAX    = {json.dumps(y_axis_max)};\n"
    )

    #################################
    # Blocs HTML conditionnels
    #################################
    summary_section = ""
    if show_summary:
        summary_section = """
  <div class="card pie-row">
    <div class="pie-panel">
      <h2 class="pie-title">
        Vue s&eacute;lection
        <span id="range-label" class="range-badge" style="display:none"></span>
      </h2>
      <p class="pie-hint">Zoomer/d&eacute;zoomer le graphe pour mettre &agrave; jour</p>
      <div id="pie-chart-sel"></div>
    </div>
    <div class="pie-panel">
      <h2 class="pie-title">Vue globale &mdash; s&eacute;quence compl&egrave;te</h2>
      <p class="pie-hint">Constante sur toute la s&eacute;quence</p>
      <div id="pie-chart-global"></div>
    </div>
  </div>

  <div class="card">
    <h2>Statistiques par section</h2>
    <table id="stats-table">
      <thead><tr>
        <th>Section</th><th>Moyenne</th><th>Min</th>
        <th>Max</th><th>Total</th><th>Part</th>
      </tr></thead>
      <tbody id="stats-tbody"></tbody>
    </table>
  </div>"""

    per_frame_section = ""
    if show_per_frame:
        per_frame_section = """
  <div class="card">
    <div class="card-hdr">
      <h2>Temps par frame</h2>
      <div class="fps-display">
        <span id="fps-dynamic" title="FPS processing (masquer une section = FPS hypothetique sans cette section)">-- FPS</span>
        <span id="fps-wall" title="FPS wall-clock (loader + traitement = taux reel de la sequence)"></span>
      </div>
    </div>
    <div id="bar-chart"></div>
    <p class="footnote">&dagger; data&nbsp;read&nbsp;= wall-clock&nbsp;&minus;&nbsp;processing&nbsp;total
      (lecture source : optional_format, MP4, dossier images&hellip;).
      Hors profiling&nbsp;YAML - artefact de rejeu, non repr&eacute;sentatif
      des performances temps&nbsp;r&eacute;el.
      L&rsquo;axe Y est calibr&eacute; sur le processing&nbsp;proc&nbsp;;
      la barre data&nbsp;read peut d&eacute;passer la limite haute.</p>
  </div>"""

    #################################
    # HTML complet
    #################################
    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Profiling VisionNexus Inference</title>
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background: #181825; color: #cdd6f4;
      font-family: 'Segoe UI', system-ui, sans-serif; padding: 24px;
    }}
    h1 {{ font-size: 1.6rem; margin-bottom: 4px; color: #89b4fa; }}
    h2 {{ font-size: 1.05rem; margin-bottom: 8px; color: #89dceb; }}
    .subtitle {{ color: #a6adc8; font-size: 0.9rem; margin-bottom: 24px; }}
    .badge {{
      display: inline-block; background: #313244; border-radius: 6px;
      padding: 2px 10px; margin-right: 8px; font-size: 0.82rem; color: #cdd6f4;
    }}
    .badge-dim {{
      color: #585b70;  /* gris atténué pour les métriques secondaires */
    }}
    .range-badge {{
      display: inline-block; background: #45475a; border-radius: 4px;
      padding: 1px 8px; font-size: 0.78rem; color: #f38ba8;
      margin-left: 6px; vertical-align: middle; font-weight: normal;
    }}
    .card {{
      background: #1e1e2e; border: 1px solid #313244;
      border-radius: 10px; padding: 20px; margin-bottom: 24px;
    }}
    /* Pie charts : deux colonnes egales */
    .pie-row {{
      display: grid; grid-template-columns: 1fr 1fr; gap: 24px;
    }}
    .pie-panel {{ display: flex; flex-direction: column; }}
    .pie-title {{ margin-bottom: 4px; }}
    .pie-hint  {{ font-size: 0.78rem; color: #585b70; margin-bottom: 6px; }}
    #pie-chart-sel, #pie-chart-global {{ width: 100%; min-height: 320px; }}
    /* Bar chart */
    .card-hdr {{
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }}
    .card-hdr h2 {{ margin-bottom: 0; }}
    .fps-display {{
      display: flex; align-items: baseline; gap: 10px;
    }}
    #fps-dynamic {{
      font-size: 2.2rem; font-weight: 700; color: #ffffff;
      letter-spacing: -0.02em; cursor: default;
    }}
    #fps-wall {{
      font-size: 1.0rem; font-weight: 400; color: #585b70;
      cursor: default; white-space: nowrap;
    }}
    #bar-chart {{ width: 100%; min-height: 420px; }}
    .footnote {{
      margin-top: 8px; font-size: 0.75rem; color: #585b70; font-style: italic;
    }}
    /* Tableau */
    #stats-table {{ width: 100%; border-collapse: collapse; font-size: 0.88rem; }}
    #stats-table th, #stats-table td {{
      padding: 8px 12px; text-align: left; border-bottom: 1px solid #313244;
    }}
    #stats-table th {{ color: #89b4fa; font-weight: 600; }}
    #stats-table tbody tr:hover {{ background: #28283e; }}
    .dot {{
      display: inline-block; width: 10px; height: 10px;
      border-radius: 50%; margin-right: 6px; vertical-align: middle;
    }}
    .bar-bg {{
      position: relative; background: #313244;
      border-radius: 4px; height: 18px; min-width: 120px;
    }}
    .bar-fill  {{ height: 100%; border-radius: 4px; opacity: 0.85; }}
    .bar-label {{
      position: absolute; right: 6px; top: 0;
      font-size: 0.75rem; line-height: 18px; color: #cdd6f4;
    }}
    @media (max-width: 860px) {{
      .pie-row {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <h1>Profiling &mdash; VisionNexus Inference</h1>
  <p class="subtitle">
    <span class="badge">Frames&nbsp;: {n_frames}</span>
    <span class="badge">Dur&eacute;e&nbsp;: {dur_s}&thinsp;s</span>
    <span class="badge" title="FPS processing seul (loader exclu)">FPS proc&nbsp;: {fps_mean}</span>
    <span class="badge" title="FPS du frame le plus lent (processing)">FPS min&nbsp;: {fps_min}</span>
    {fps_wall_badge}
  </p>

  {per_frame_section}
  {summary_section}

  <script>
    {data_js}
    {_JS_LOGIC}
  </script>
</body>
</html>"""

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")
