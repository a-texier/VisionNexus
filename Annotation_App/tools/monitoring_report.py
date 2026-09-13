#!/usr/bin/env python
# ============================================================
# tools/monitoring_report.py
# Rapport HTML interactif d'usage de l'application d'annotation,
# pour un ou plusieurs workspaces, un ou plusieurs utilisateurs.
#
# Usage :
#   python tools/monitoring_report.py WK1 [WK2 ...] [--outdir DOSSIER]
#
# Exemples :
#   # Une racine partagee : agrege tous les annotation_<user> qu'elle contient
#   python tools/monitoring_report.py D:/All_workspaces/fable_test4
#
#   # Plusieurs racines, sortie choisie
#   python tools/monitoring_report.py D:/All_ws/fable_test3 D:/All_ws/fable_test4 \
#       --outdir D:/rapports
#
# Sans --outdir, le rapport est ecrit dans <racine>/monitoring/annot_monitoring.html
# (au meme niveau que les dossiers annotation_<user>).
#
# Le HTML produit est autonome : aucun CDN, aucun serveur, ouvrable hors ligne.
# ============================================================

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

# Import du service, que le script soit lance depuis Annotation_App/ ou ailleurs
_APP_ROOT = Path(__file__).resolve().parent.parent
if str(_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_APP_ROOT))

from backend.services.monitoring_service import (  # noqa: E402
    AUTO_SOURCES,
    aggregate_workspace,
    discover_workspaces,
    group_by_root,
    group_by_user,
)

SOURCE_LABELS = {"manual": "Manuel", **AUTO_SOURCES}


def build_payload(bases: List[str]) -> Dict[str, Any]:
    """Agrege chaque workspace trouve sous les racines donnees."""
    workspaces = discover_workspaces(bases)
    if not workspaces:
        raise SystemExit(
            "Aucun workspace d'annotation trouve.\n"
            "Attendu : un dossier contenant annotation.db, ou une racine "
            "contenant des dossiers annotation_<user>."
        )

    entries: List[Dict[str, Any]] = []
    for ws in workspaces:
        data = aggregate_workspace(ws)
        # Deux workspaces peuvent porter le meme nom d'utilisateur sous des
        # racines differentes : on qualifie par la racine pour les distinguer.
        data["root"] = ws.parent.name
        data["label"] = f"{data['user']} ({ws.parent.name})"
        entries.append(data)

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "bases": [str(Path(b).resolve()) for b in bases],
        "source_labels": SOURCE_LABELS,
        "workspaces": entries,
        # Onglet Global : par utilisateur (tous ses workspaces sommes) et par
        # racine. Un meme utilisateur present sous wk1 et wk2 compte une fois.
        "by_user": group_by_user(entries),
        "by_root": group_by_root(entries),
    }


def render_html(payload: Dict[str, Any]) -> str:
    data_json = json.dumps(payload, ensure_ascii=False)
    return _TEMPLATE.replace("__DATA__", data_json)


_TEMPLATE = r"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monitoring annotation</title>
<style>
  :root {
    --bg:#0f172a; --panel:#1e293b; --border:#334155; --text:#e2e8f0;
    --muted:#94a3b8; --accent:#6366f1;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f8fafc; --panel:#fff; --border:#e2e8f0; --text:#0f172a; --muted:#64748b; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size:14px; }
  header { padding:20px 24px; border-bottom:1px solid var(--border); }
  h1 { margin:0 0 4px; font-size:19px; }
  .sub { color:var(--muted); font-size:12px; }
  main { padding:20px 24px; max-width:1400px; margin:0 auto; }
  .controls { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:18px; }
  select, button { background:var(--panel); color:var(--text); border:1px solid var(--border);
                   border-radius:6px; padding:6px 10px; font-size:13px; font-family:inherit; }
  button { cursor:pointer; }
  button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:16px; }
  .card h2 { margin:0 0 12px; font-size:13px; font-weight:600; color:var(--muted);
             text-transform:uppercase; letter-spacing:.04em; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; margin-bottom:16px; }
  .kpi { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:12px 14px; }
  .kpi .v { font-size:24px; font-weight:650; }
  .kpi .l { font-size:11px; color:var(--muted); margin-top:2px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); }
  th { color:var(--muted); font-weight:600; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  .tablewrap { overflow-x:auto; }
  .legend { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; font-size:12px; }
  .legend span { display:flex; align-items:center; gap:5px; color:var(--muted); }
  .sw { width:10px; height:10px; border-radius:2px; display:inline-block; }
  .empty { color:var(--muted); font-style:italic; padding:12px 0; }
  svg { display:block; max-width:100%; }
  .bar-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:12px; }
  .bar-row .name { width:150px; flex-shrink:0; color:var(--muted);
                   overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar-track { flex:1; height:16px; background:var(--border); border-radius:3px;
               overflow:hidden; display:flex; }
  .bar-track div { height:100%; }
  .bar-row .tot { width:56px; text-align:right; font-variant-numeric:tabular-nums; }
</style>
</head>
<body>
<header>
  <h1>Monitoring des annotations</h1>
  <div class="sub" id="subtitle"></div>
</header>
<main>
  <div class="controls">
    <button data-view="detail" class="active">Detail</button>
    <button data-view="global">Global</button>
    <span style="width:14px"></span>
    <select id="userSel"></select>
    <select id="projSel"></select>
    <span style="flex:1"></span>
    <span id="metricBtns">
      <button data-metric="all" class="active">Toutes provenances</button>
      <button data-metric="auto">Auto seulement</button>
      <button data-metric="manual">Manuel seulement</button>
    </span>
  </div>

  <!-- ---------- Vue GLOBALE : repartition entre personnes ---------- -->
  <div id="globalView" style="display:none">
    <div class="kpis" id="globalKpis"></div>
    <div class="grid">
      <div class="card">
        <h2>Part de chaque utilisateur (toutes annotations)</h2>
        <div id="pieUsers"></div>
        <div class="legend" id="pieUsersLegend"></div>
      </div>
      <div class="card">
        <h2>Part de chaque utilisateur (annotations manuelles)</h2>
        <div id="pieUsersManual"></div>
        <div class="legend" id="pieUsersManualLegend"></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h2>Detail par utilisateur</h2>
        <div class="tablewrap"><table id="userTable"></table></div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <h2>Par racine de workspace</h2>
        <div class="tablewrap"><table id="rootTable"></table></div>
      </div>
    </div>
  </div>

  <div id="detailView">
  <div class="kpis" id="kpis"></div>

  <div class="grid">
    <div class="card">
      <h2>Repartition par provenance</h2>
      <div id="pie"></div>
      <div class="legend" id="pieLegend"></div>
    </div>
    <div class="card">
      <h2>Reprise humaine sur les sorties automatiques</h2>
      <div id="rework"></div>
    </div>
    <div class="card" style="grid-column:1/-1">
      <h2>Annotations par sequence</h2>
      <div id="bySeq"></div>
    </div>
    <div class="card" style="grid-column:1/-1">
      <h2>Activite dans le temps</h2>
      <div id="timeline"></div>
    </div>
    <div class="card" style="grid-column:1/-1">
      <h2>Runs automatiques</h2>
      <div class="tablewrap"><table id="runs"></table></div>
    </div>
  </div>
  </div>
</main>

<script>
const DATA = __DATA__;
const LABELS = DATA.source_labels || {};
const PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4',
                 '#a855f7','#84cc16','#ec4899','#14b8a6','#f97316'];
const colorCache = {};
let colorIdx = 0;
function colorFor(src) {
  if (src === 'manual') return '#64748b';
  if (!(src in colorCache)) colorCache[src] = PALETTE[colorIdx++ % PALETTE.length];
  return colorCache[src];
}
function label(src) { return LABELS[src] || src; }
const isManual = (s) => s === 'manual' || !s;

let metric = 'all';

document.getElementById('subtitle').textContent =
  `Genere le ${DATA.generated_at} — ${DATA.workspaces.length} workspace(s) : ` +
  DATA.bases.join('  |  ');

// ---- Selecteurs ----
const userSel = document.getElementById('userSel');
userSel.innerHTML = '<option value="__all__">Tous les utilisateurs</option>' +
  DATA.workspaces.map((w, i) => `<option value="${i}">${w.label}</option>`).join('');
const projSel = document.getElementById('projSel');

function activeWorkspaces() {
  return userSel.value === '__all__' ? DATA.workspaces : [DATA.workspaces[+userSel.value]];
}

function refreshProjects() {
  const names = new Set();
  activeWorkspaces().forEach(w =>
    (w.snapshot.projects || []).forEach(p => names.add(p.project_name)));
  projSel.innerHTML = '<option value="__all__">Tous les projets</option>' +
    [...names].sort().map(n => `<option value="${n}">${n}</option>`).join('');
}

// ---- Collecte filtree ----
function collect() {
  const proj = projSel.value;
  const rows = [];      // une ligne par sequence
  const totals = {};    // source -> n
  const runs = [];
  const timeline = {};  // day -> { source: n }
  let edited = 0, deletedAuto = 0, manualEdited = 0;

  activeWorkspaces().forEach(w => {
    (w.snapshot.projects || []).forEach(p => {
      if (proj !== '__all__' && p.project_name !== proj) return;
      (p.sequences || []).forEach(s => {
        const by = {};
        Object.entries(s.by_source || {}).forEach(([src, n]) => {
          if (metric === 'auto' && isManual(src)) return;
          if (metric === 'manual' && !isManual(src)) return;
          by[src] = n;
          totals[src] = (totals[src] || 0) + n;
        });
        const tot = Object.values(by).reduce((a, b) => a + b, 0);
        if (tot > 0) rows.push({
          user: w.label, project: p.project_name,
          seq: s.sequence_name, by, total: tot,
          frames: s.frames_annotated || 0,
        });
      });
    });
    (w.snapshot.timeline || []).forEach(t => {
      if (metric === 'auto' && isManual(t.source)) return;
      if (metric === 'manual' && !isManual(t.source)) return;
      timeline[t.day] = timeline[t.day] || {};
      timeline[t.day][t.source] = (timeline[t.day][t.source] || 0) + t.count;
    });
    (w.runs || []).forEach(r => runs.push({ ...r, user: w.label }));
    edited += w.summary.auto_edited || 0;
    deletedAuto += w.summary.auto_deleted || 0;
    manualEdited += w.summary.manual_edited || 0;
  });

  return { rows, totals, runs, timeline, edited, deletedAuto, manualEdited };
}

// ---- Rendu ----
function renderKpis(d) {
  const auto = Object.entries(d.totals).filter(([s]) => !isManual(s))
                     .reduce((a, [, n]) => a + n, 0);
  const man = Object.entries(d.totals).filter(([s]) => isManual(s))
                    .reduce((a, [, n]) => a + n, 0);
  const total = auto + man;
  // Une part non nulle ne doit jamais s'afficher "0 %" : sur 519 annotations,
  // l'unique boite manuelle reste une information, pas un arrondi.
  const pct = (n) => {
    if (!total || !n) return '0 %';
    const p = n / total * 100;
    if (p < 1) return '<1 %';
    if (p > 99 && n < total) return '>99 %';
    return Math.round(p) + ' %';
  };
  const reworkPct = auto ? Math.round(d.edited / auto * 100) : 0;
  const kpis = [
    [total.toLocaleString('fr-FR'), 'Annotations'],
    [pct(auto), `Auto (${auto.toLocaleString('fr-FR')})`],
    [pct(man), `Manuel (${man.toLocaleString('fr-FR')})`],
    [`${reworkPct} %`, `Auto retouchees (${d.edited})`],
    [d.deletedAuto.toLocaleString('fr-FR'), 'Auto supprimees'],
    [d.runs.length.toLocaleString('fr-FR'), 'Runs automatiques'],
  ];
  document.getElementById('kpis').innerHTML = kpis
    .map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`)
    .join('');
}

function renderPie(d) {
  const entries = Object.entries(d.totals).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const host = document.getElementById('pie');
  if (!total) { host.innerHTML = '<div class="empty">Aucune annotation</div>';
                document.getElementById('pieLegend').innerHTML = ''; return; }

  const R = 78, CX = 100, CY = 95;
  let angle = -Math.PI / 2;
  const arcs = entries.map(([src, n]) => {
    const sweep = (n / total) * Math.PI * 2;
    const x1 = CX + R * Math.cos(angle), y1 = CY + R * Math.sin(angle);
    angle += sweep;
    const x2 = CX + R * Math.cos(angle), y2 = CY + R * Math.sin(angle);
    // Un secteur unique (100 %) ne peut pas s'exprimer en arc : on trace un disque.
    const path = entries.length === 1
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
      : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
    return `<path d="${path}" fill="${colorFor(src)}" stroke="var(--panel)" stroke-width="1.5">
              <title>${label(src)} : ${n} (${Math.round(n / total * 100)} %)</title></path>`;
  }).join('');

  host.innerHTML = `<svg viewBox="0 0 200 190" width="100%" height="190">${arcs}</svg>`;
  document.getElementById('pieLegend').innerHTML = entries.map(([src, n]) =>
    `<span><i class="sw" style="background:${colorFor(src)}"></i>${label(src)} — ${n}
     (${Math.round(n / total * 100)} %)</span>`).join('');
}

function renderRework(d) {
  const auto = Object.entries(d.totals).filter(([s]) => !isManual(s))
                     .reduce((a, [, n]) => a + n, 0);
  const host = document.getElementById('rework');
  if (!auto) { host.innerHTML = '<div class="empty">Aucune sortie automatique</div>'; return; }
  const kept = Math.max(0, auto - d.edited - d.deletedAuto);
  const seg = [
    ['Conservees telles quelles', kept, '#10b981'],
    ['Retouchees a la main', d.edited, '#f59e0b'],
    ['Supprimees', d.deletedAuto, '#ef4444'],
  ];
  host.innerHTML = `
    <div class="bar-track" style="height:26px">
      ${seg.map(([n, v, c]) => v ? `<div style="width:${v / auto * 100}%;background:${c}"
        title="${n} : ${v}"></div>` : '').join('')}
    </div>
    <div class="legend">
      ${seg.map(([n, v, c]) => `<span><i class="sw" style="background:${c}"></i>${n} — ${v}</span>`).join('')}
    </div>
    <p style="color:var(--muted);font-size:11.5px;margin:10px 0 0">
      Retouches et suppressions proviennent du journal d'evenements : elles ne
      comptent que depuis l'activation du monitoring.
    </p>`;
}

function renderBySeq(d) {
  const host = document.getElementById('bySeq');
  if (!d.rows.length) { host.innerHTML = '<div class="empty">Aucune sequence</div>'; return; }
  const rows = [...d.rows].sort((a, b) => b.total - a.total).slice(0, 40);
  const max = rows[0].total || 1;
  host.innerHTML = rows.map(r => `
    <div class="bar-row">
      <span class="name" title="${r.user} / ${r.project} / ${r.seq}">${r.seq}</span>
      <span class="bar-track" style="width:${r.total / max * 100}%">
        ${Object.entries(r.by).sort((a, b) => b[1] - a[1]).map(([s, n]) =>
          `<div style="width:${n / r.total * 100}%;background:${colorFor(s)}"
             title="${label(s)} : ${n}"></div>`).join('')}
      </span>
      <span class="tot">${r.total}</span>
    </div>`).join('');
}

function renderTimeline(d) {
  const host = document.getElementById('timeline');
  const days = Object.keys(d.timeline).sort();
  if (!days.length) { host.innerHTML = '<div class="empty">Aucune donnee datee</div>'; return; }
  const sources = [...new Set(days.flatMap(day => Object.keys(d.timeline[day])))];
  const dayTotal = (day) => Object.values(d.timeline[day]).reduce((a, b) => a + b, 0);
  const max = Math.max(...days.map(dayTotal)) || 1;
  const W = 900, H = 200, PAD = 34;
  const bw = Math.max(3, Math.min(46, (W - PAD * 2) / days.length - 4));

  const bars = days.map((day, i) => {
    const x = PAD + i * ((W - PAD * 2) / days.length);
    let y = H - 22;
    return sources.map(src => {
      const n = d.timeline[day][src] || 0;
      if (!n) return '';
      const h = (n / max) * (H - 50);
      y -= h;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${colorFor(src)}">
                <title>${day} — ${label(src)} : ${n}</title></rect>`;
    }).join('');
  }).join('');

  const step = Math.ceil(days.length / 10);
  const ticks = days.map((day, i) => i % step ? '' : `<text x="${
    PAD + i * ((W - PAD * 2) / days.length) + bw / 2}" y="${H - 6}"
    fill="var(--muted)" font-size="10" text-anchor="middle">${day.slice(5)}</text>`).join('');

  host.innerHTML = `<div class="tablewrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
      <text x="4" y="14" fill="var(--muted)" font-size="10">${max}</text>
      <line x1="${PAD}" y1="${H - 22}" x2="${W - 4}" y2="${H - 22}" stroke="var(--border)"/>
      ${bars}${ticks}</svg></div>`;
}

function renderRuns(d) {
  const t = document.getElementById('runs');
  if (!d.runs.length) {
    t.innerHTML = `<tr><td class="empty">Aucun run enregistre (le journal se remplit
      a partir du prochain lancement d'algorithme).</td></tr>`;
    return;
  }
  const runs = [...d.runs].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 60);
  t.innerHTML = `<thead><tr>
      <th>Date</th><th>Utilisateur</th><th>Algorithme</th><th>Mode</th>
      <th class="num">Cibles</th><th class="num">Frames</th>
      <th class="num">Creees</th><th class="num">Duree</th><th>Fin</th>
    </tr></thead><tbody>` + runs.map(r => `<tr>
      <td>${(r.ts || '').replace('T', ' ').slice(0, 16)}</td>
      <td>${r.user}</td><td>${r.algorithm || ''}</td><td>${r.mode || ''}</td>
      <td class="num">${r.targets ?? ''}</td><td class="num">${r.frames ?? ''}</td>
      <td class="num">${r.created ?? ''}</td>
      <td class="num">${r.duration_s ? r.duration_s + ' s' : ''}</td>
      <td>${r.stopped ? 'arrete' : 'complet'}</td></tr>`).join('') + '</tbody>';
}

// ---- Vue globale : qui a produit quoi ----
const USER_PALETTE = ['#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4',
                      '#a855f7','#84cc16','#ec4899','#14b8a6','#f97316'];
const userColor = {};
(DATA.by_user || []).forEach((u, i) => { userColor[u.user] = USER_PALETTE[i % USER_PALETTE.length]; });

function drawPie(hostId, legendId, entries, colorFn) {
  const host = document.getElementById(hostId);
  const legend = document.getElementById(legendId);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (!total) {
    host.innerHTML = '<div class="empty">Aucune annotation</div>';
    legend.innerHTML = ''; return;
  }
  const R = 78, CX = 100, CY = 95;
  let angle = -Math.PI / 2;
  const arcs = entries.map(([k, n]) => {
    const sweep = (n / total) * Math.PI * 2;
    const x1 = CX + R * Math.cos(angle), y1 = CY + R * Math.sin(angle);
    angle += sweep;
    const x2 = CX + R * Math.cos(angle), y2 = CY + R * Math.sin(angle);
    const path = entries.length === 1
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
      : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
    return `<path d="${path}" fill="${colorFn(k)}" stroke="var(--panel)" stroke-width="1.5">
              <title>${k} : ${n} (${Math.round(n / total * 100)} %)</title></path>`;
  }).join('');
  host.innerHTML = `<svg viewBox="0 0 200 190" width="100%" height="190">${arcs}</svg>`;
  legend.innerHTML = entries.map(([k, n]) =>
    `<span><i class="sw" style="background:${colorFn(k)}"></i>${k} — ${n}
     (${Math.round(n / total * 100)} %)</span>`).join('');
}

function renderGlobal() {
  const users = DATA.by_user || [];
  const roots = DATA.by_root || [];
  const total = users.reduce((a, u) => a + u.annotations_total, 0);
  const manual = users.reduce((a, u) => a + u.annotations_manual, 0);
  const auto = users.reduce((a, u) => a + u.annotations_auto, 0);
  const done = users.reduce((a, u) => a + u.sequences_done, 0);
  const seqs = users.reduce((a, u) => a + u.sequences, 0);

  document.getElementById('globalKpis').innerHTML = [
    [users.length, 'Utilisateurs'],
    [roots.length, 'Racines de workspace'],
    [total.toLocaleString('fr-FR'), 'Annotations'],
    [auto.toLocaleString('fr-FR'), 'Automatiques'],
    [manual.toLocaleString('fr-FR'), 'Manuelles'],
    [`${done} / ${seqs}`, 'Sequences exportees'],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  drawPie('pieUsers', 'pieUsersLegend',
    users.map(u => [u.user, u.annotations_total]).filter(([, n]) => n > 0),
    (u) => userColor[u] || '#64748b');
  drawPie('pieUsersManual', 'pieUsersManualLegend',
    users.map(u => [u.user, u.annotations_manual]).filter(([, n]) => n > 0),
    (u) => userColor[u] || '#64748b');

  document.getElementById('userTable').innerHTML = `<thead><tr>
      <th>Utilisateur</th><th>Racines</th>
      <th class="num">Projets</th><th class="num">Sequences</th>
      <th class="num">Exportees</th><th class="num">Total</th>
      <th class="num">Auto</th><th class="num">Manuel</th>
      <th class="num">Retouchees</th><th class="num">Supprimees</th><th class="num">Runs</th>
    </tr></thead><tbody>` + users.map(u => `<tr>
      <td><i class="sw" style="background:${userColor[u.user]}"></i> ${u.user}</td>
      <td style="font-size:11px;color:var(--muted)">${u.roots.join(', ')}</td>
      <td class="num">${u.projects}</td><td class="num">${u.sequences}</td>
      <td class="num">${u.sequences_done}</td>
      <td class="num">${u.annotations_total.toLocaleString('fr-FR')}</td>
      <td class="num">${u.annotations_auto.toLocaleString('fr-FR')}</td>
      <td class="num">${u.annotations_manual.toLocaleString('fr-FR')}</td>
      <td class="num">${u.auto_edited}</td><td class="num">${u.auto_deleted}</td>
      <td class="num">${u.runs}</td></tr>`).join('') + '</tbody>';

  document.getElementById('rootTable').innerHTML = `<thead><tr>
      <th>Racine</th><th>Utilisateurs</th>
      <th class="num">Sequences</th><th class="num">Exportees</th>
      <th class="num">Total</th><th class="num">Auto</th><th class="num">Manuel</th>
    </tr></thead><tbody>` + roots.map(r => `<tr>
      <td>${r.root}</td>
      <td style="font-size:11px;color:var(--muted)">${r.users.map(u => u.user).join(', ')}</td>
      <td class="num">${r.sequences}</td><td class="num">${r.sequences_done}</td>
      <td class="num">${r.annotations_total.toLocaleString('fr-FR')}</td>
      <td class="num">${r.annotations_auto.toLocaleString('fr-FR')}</td>
      <td class="num">${r.annotations_manual.toLocaleString('fr-FR')}</td></tr>`).join('') + '</tbody>';
}

function renderAll() {
  const d = collect();
  renderKpis(d); renderPie(d); renderRework(d);
  renderBySeq(d); renderTimeline(d); renderRuns(d);
}

userSel.onchange = () => { refreshProjects(); renderAll(); };
projSel.onchange = renderAll;
document.querySelectorAll('button[data-metric]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('button[data-metric]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    metric = b.dataset.metric;
    renderAll();
  };
});

// Bascule Detail / Global
document.querySelectorAll('button[data-view]').forEach(b => {
  b.onclick = () => {
    document.querySelectorAll('button[data-view]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    const isGlobal = b.dataset.view === 'global';
    document.getElementById('globalView').style.display = isGlobal ? '' : 'none';
    document.getElementById('detailView').style.display = isGlobal ? 'none' : '';
    // Les filtres utilisateur/projet/provenance n'ont pas de sens en vue globale.
    [userSel, projSel, document.getElementById('metricBtns')]
      .forEach(el => { el.style.display = isGlobal ? 'none' : ''; });
    if (isGlobal) renderGlobal();
  };
});

refreshProjects();
renderAll();
</script>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rapport HTML d'usage de l'application d'annotation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("workspaces", nargs="+",
                        help="Racines partagees ou workspaces d'annotation")
    parser.add_argument("--outdir", default=None,
                        help="Dossier de sortie (defaut : <racine>/monitoring)")
    parser.add_argument("--name", default="annot_monitoring.html",
                        help="Nom du fichier HTML")
    args = parser.parse_args()

    payload = build_payload(args.workspaces)
    html = render_html(payload)

    outdir = Path(args.outdir) if args.outdir else Path(args.workspaces[0]) / "monitoring"
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / args.name
    out.write_text(html, encoding="utf-8")

    total = sum(w["summary"]["annotations_total"] for w in payload["workspaces"])
    print(f"[monitoring] {len(payload['workspaces'])} workspace(s), "
          f"{total} annotations")
    for w in payload["workspaces"]:
        s = w["summary"]
        print(f"  - {w['label']:<28} {s['annotations_total']:>7} "
              f"(auto {s['annotations_auto']}, manuel {s['annotations_manual']})")
    print(f"[monitoring] rapport ecrit : {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
