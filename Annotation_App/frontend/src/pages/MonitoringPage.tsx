// ============================================================
// pages/MonitoringPage.tsx
// Usage reel de l'application : ce qui a ete produit automatiquement,
// ce qui a ete fait a la main, et ce que l'humain a du reprendre.
//
// Deux sources, volontairement distinctes (cf. monitoring_service.py) :
//   - le SNAPSHOT vient de la base -> disponible retroactivement ;
//   - les RETOUCHES viennent du journal d'evenements -> seulement depuis
//     l'activation du monitoring. L'UI le dit explicitement pour eviter de
//     lire un "0 retouche" comme "aucune reprise n'a jamais eu lieu".
// ============================================================

import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, Users, User, Download } from 'lucide-react'
import {
  monitoringAPI,
  type MonitoringWorkspace, type MonitoringUser, type MonitoringRoot,
} from '../services/api'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useT } from '../i18n/useLang'

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manuel',
  samurai: 'SAMURAI',
  sam2_video: 'SAM2 video',
  sam2_tracking: 'SAMURAI/SAM2 (avant separation)',
  sam_point: 'SAM2 (point)',
  sam_auto: 'SAM2 (auto)',
  grounding_dino: 'Grounding DINO',
  sam3: 'SAM3',
  guided_tracking: 'Tracking guide',
  yolo: 'YOLO custom',
  interpolation: 'Interpolation',
  homography: 'Homographie',
  optical_flow: 'Flux optique',
}

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
                 '#a855f7', '#84cc16', '#ec4899', '#14b8a6', '#f97316']

const isManual = (s: string) => s === 'manual' || !s
const labelOf = (s: string, t: (fr: string) => string) => t(SOURCE_LABELS[s] ?? s)

// Couleur stable par provenance : la meme source garde sa teinte d'un
// graphique a l'autre, sinon la lecture croisee devient impossible.
const colorOf = (() => {
  const cache: Record<string, string> = {}
  let i = 0
  return (src: string) => {
    if (isManual(src)) return '#64748b'
    if (!(src in cache)) cache[src] = PALETTE[i++ % PALETTE.length]
    return cache[src]
  }
})()

const fmt = (n: number) => n.toLocaleString('fr-FR')

const pctLabel = (n: number, total: number) => {
  if (!total || !n) return '0 %'
  const p = (n / total) * 100
  if (p < 1) return '<1 %'
  if (p > 99 && n < total) return '>99 %'
  return `${Math.round(p)} %`
}

// Couleur stable par utilisateur (vue globale)
const userColorOf = (() => {
  const cache: Record<string, string> = {}
  let i = 0
  return (user: string) => {
    if (!(user in cache)) cache[user] = PALETTE[i++ % PALETTE.length]
    return cache[user]
  }
})()

// ---- Camembert SVG ----
// `colorFn` et `detailFor` permettent de réutiliser le même composant pour les
// provenances et pour les utilisateurs, avec un détail au survol adapté.
const Pie: React.FC<{
  data: [string, number][]
  colorFn?: (k: string) => string
  detailFor?: (k: string) => string
}> = ({ data, colorFn, detailFor }) => {
  const t = useT()
  const color = colorFn ?? colorOf
  const name = colorFn ? (k: string) => k : (k: string) => labelOf(k, t)
  const total = data.reduce((a, [, n]) => a + n, 0)
  if (!total) return <p className="text-xs text-slate-500 italic py-6">{t('Aucune annotation')}</p>

  const R = 78, CX = 100, CY = 92
  let angle = -Math.PI / 2
  const arcs = data.map(([src, n]) => {
    const sweep = (n / total) * Math.PI * 2
    const x1 = CX + R * Math.cos(angle), y1 = CY + R * Math.sin(angle)
    angle += sweep
    const x2 = CX + R * Math.cos(angle), y2 = CY + R * Math.sin(angle)
    // Un secteur a 100 % ne s'exprime pas en arc : on trace un disque plein.
    const d = data.length === 1
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
      : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`
    const extra = detailFor?.(src)
    return <path key={src} d={d} fill={color(src)} stroke="#1e293b" strokeWidth={1.5}>
      <title>{`${name(src)} : ${fmt(n)} (${pctLabel(n, total)})${extra ? `\n${extra}` : ''}`}</title>
    </path>
  })

  return (
    <div>
      <svg viewBox="0 0 200 184" className="w-full" height={184}>{arcs}</svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {data.map(([src, n]) => (
          <span key={src} className="flex items-center gap-1.5 text-[11px] text-slate-400"
                title={detailFor?.(src) ?? undefined}>
            <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color(src) }} />
            {name(src)} — {fmt(n)} ({pctLabel(n, total)})
          </span>
        ))}
      </div>
    </div>
  )
}

const Card: React.FC<{ title: string; children: React.ReactNode; wide?: boolean }> =
  ({ title, children, wide }) => (
  <div className={`bg-slate-800 border border-slate-700 rounded-xl p-4 ${wide ? 'lg:col-span-2' : ''}`}>
    <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">{title}</h2>
    {children}
  </div>
)

export const MonitoringPage: React.FC = () => {
  const navigate = useNavigate()
  const t = useT()
  const [scope, setScope] = useState<'me' | 'all'>('me')
  const [view, setView] = useState<'detail' | 'global'>('detail')
  const [workspaces, setWorkspaces] = useState<MonitoringWorkspace[]>([])
  const [byUser, setByUser] = useState<MonitoringUser[]>([])
  const [byRoot, setByRoot] = useState<MonitoringRoot[]>([])
  const [loading, setLoading] = useState(true)
  const [projectFilter, setProjectFilter] = useState('__all__')
  const [userFilter, setUserFilter] = useState('__all__')

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await monitoringAPI.getStats(scope)
      setWorkspaces(res.workspaces)
      setByUser(res.by_user ?? [])
      setByRoot(res.by_root ?? [])
    } catch {
      setWorkspaces([]); setByUser([]); setByRoot([])
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => { void load() }, [load])

  const projectNames = useMemo(() => {
    const s = new Set<string>()
    workspaces.forEach((w) => w.snapshot.projects.forEach((p) => s.add(p.project_name)))
    return [...s].sort()
  }, [workspaces])

  const agg = useMemo(() => {
    const totals: Record<string, number> = {}
    const rows: {
      user: string; project: string; seq: string; path: string
      by: Record<string, number>; total: number; framesAnnotated: number
      frameCount: number; coverage: number[]; isDone: boolean
      lastExportAt: string | null; lastExportFormat: string | null
    }[] = []
    let edited = 0, deleted = 0, manualEdited = 0, framesMulti = 0, framesTouched = 0
    const runs: MonitoringWorkspace['runs'] = []
    const rework: MonitoringWorkspace['rework_by_dataset'] = []

    workspaces.forEach((w) => {
      // Filtre utilisateur : voir le travail d'un collègue du même workspace.
      if (userFilter !== '__all__' && w.user !== userFilter) return
      w.snapshot.projects.forEach((p) => {
        if (projectFilter !== '__all__' && p.project_name !== projectFilter) return
        p.sequences.forEach((s) => {
          Object.entries(s.by_source).forEach(([src, n]) => {
            totals[src] = (totals[src] ?? 0) + n
          })
          rows.push({
            user: w.user, project: p.project_name, seq: s.sequence_name,
            path: s.source_path, by: s.by_source, total: s.total,
            framesAnnotated: s.frames_annotated,
            frameCount: s.frame_count ?? 0,
            coverage: s.coverage ?? [],
            isDone: s.is_done ?? false,
            lastExportAt: s.last_export_at ?? null,
            lastExportFormat: s.last_export_format ?? null,
          })
        })
      })
      edited += w.summary.auto_edited
      deleted += w.summary.auto_deleted
      manualEdited += w.summary.manual_edited
      framesMulti += w.summary.frames_multi_touched
      framesTouched += w.summary.frames_touched
      w.runs.forEach((r) => runs.push({ ...r, user: w.user }))
      w.rework_by_dataset.forEach((r) => rework.push(r))
    })

    const auto = Object.entries(totals).filter(([s]) => !isManual(s)).reduce((a, [, n]) => a + n, 0)
    const manual = Object.entries(totals).filter(([s]) => isManual(s)).reduce((a, [, n]) => a + n, 0)
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1])
    return { totals: sorted, rows, auto, manual, edited, deleted, manualEdited,
             framesMulti, framesTouched, runs, rework }
  }, [workspaces, projectFilter, userFilter])

  // Totaux de la vue globale : sommes sur les utilisateurs, pas sur les lignes
  // filtrees (le Global ignore volontairement les filtres utilisateur/projet).
  const globalTotals = useMemo(() => ({
    total: byUser.reduce((a, u) => a + u.annotations_total, 0),
    auto: byUser.reduce((a, u) => a + u.annotations_auto, 0),
    manual: byUser.reduce((a, u) => a + u.annotations_manual, 0),
    done: byUser.reduce((a, u) => a + u.sequences_done, 0),
    seqs: byUser.reduce((a, u) => a + u.sequences, 0),
  }), [byUser])

  const total = view === 'global'
    ? globalTotals.total
    : agg.auto + agg.manual
  const kept = Math.max(0, agg.auto - agg.edited - agg.deleted)
  const hasEvents = agg.edited + agg.deleted + agg.manualEdited + agg.runs.length > 0

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center gap-3">
        <button onClick={() => navigate('/')}
          data-tour="monitoring-back"
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold">Monitoring</h1>
          <p className="text-xs text-slate-500">
            {t('Repartition automatique / manuel et reprise humaine')}
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5" data-tour="monitoring-scope">
          {(['me', 'all'] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                scope === s ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {s === 'me' ? <User size={13} /> : <Users size={13} />}
              {s === 'me' ? t('Moi') : t('Tous les utilisateurs')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5" data-tour="monitoring-view">
          {(['detail', 'global'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              title={v === 'global'
                ? t('Repartition entre utilisateurs, tous projets sommes')
                : t('Detail par sequence et par provenance')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                view === v ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              {v === 'detail' ? t('Detail') : t('Global')}
            </button>
          ))}
        </div>

        {/* Selecteur d'utilisateur : n'a de sens qu'en vue detail multi-users */}
        {view === 'detail' && byUser.length > 1 && (
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="__all__">{t('Tous les utilisateurs')}</option>
            {byUser.map((u) => (
              <option key={u.user} value={u.user}>{u.user}</option>
            ))}
          </select>
        )}

        {view === 'detail' && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs">
            <option value="__all__">{t('Tous les projets')}</option>
            {projectNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}

        <a href={`/api/monitoring/report?scope=${scope}`}
           data-tour="monitoring-export"
           title={t('Exporter ce rapport en HTML autonome (ouvrable hors ligne)')}
           className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors">
          <Download size={13} />
          {t('Exporter HTML')}
        </a>

        <button onClick={() => void load()} title={t('Rafraichir')}
          className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
          <RefreshCw size={14} />
        </button>
      </header>

      <main className="p-6 max-w-[1400px] mx-auto" data-tour="monitoring-main">
        {loading ? (
          <div className="flex justify-center py-20"><LoadingSpinner size="md" /></div>
        ) : total === 0 ? (
          <p className="text-sm text-slate-500 italic py-20 text-center">
            {t('Aucune annotation dans ce perimetre.')}
          </p>
        ) : view === 'global' ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
              {[
                [fmt(byUser.length), t('Utilisateurs')],
                [fmt(byRoot.length), t('Racines de workspace')],
                [fmt(globalTotals.total), t('Annotations')],
                [fmt(globalTotals.auto), t('Automatiques')],
                [fmt(globalTotals.manual), t('Manuelles')],
                [`${fmt(globalTotals.done)} / ${fmt(globalTotals.seqs)}`, t('Sequences exportees')],
              ].map(([v, l]) => (
                <div key={l} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                  <div className="text-2xl font-semibold">{v}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{l}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title={t('Part de chaque utilisateur (toutes annotations)')}>
                <Pie data={byUser.map((u) => [u.user, u.annotations_total])
                              .filter(([, n]) => (n as number) > 0) as [string, number][]}
                     colorFn={userColorOf}
                     detailFor={(k) => {
                       const u = byUser.find((x) => x.user === k)
                       if (!u) return ''
                       return `auto ${fmt(u.annotations_auto)} · ${t('manuel')} ${fmt(u.annotations_manual)}`
                         + ` · ${t('retouchees')} ${fmt(u.auto_edited)} · ${t('supprimees')} ${fmt(u.auto_deleted)}`
                     }} />
              </Card>

              <Card title={t('Part de chaque utilisateur (annotations manuelles)')}>
                <Pie data={byUser.map((u) => [u.user, u.annotations_manual])
                              .filter(([, n]) => (n as number) > 0) as [string, number][]}
                     colorFn={userColorOf}
                     detailFor={(k) => {
                       const u = byUser.find((x) => x.user === k)
                       return u ? `${fmt(u.annotations_manual)} ${t('manuelles sur')} ${fmt(u.annotations_total)} ${t('au total')}` : ''
                     }} />
              </Card>

              <Card title={t('Detail par utilisateur')} wide>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="text-left py-1.5 px-2 font-medium">{t('Utilisateur')}</th>
                        <th className="text-left py-1.5 px-2 font-medium">{t('Racines')}</th>
                        {['Projets', 'Sequences', 'Exportees', 'Total', 'Auto', 'Manuel',
                          'Retouchees', 'Supprimees', 'Runs'].map((h) => (
                          <th key={h} className="text-right py-1.5 px-2 font-medium">{t(h)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byUser.map((u) => (
                        <tr key={u.user} className="border-t border-slate-700/60">
                          <td className="py-1.5 px-2">
                            <span className="inline-flex items-center gap-1.5">
                              <i className="w-2.5 h-2.5 rounded-sm inline-block"
                                 style={{ background: userColorOf(u.user) }} />
                              {u.user}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-slate-500 text-[11px]">{u.roots.join(', ')}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.projects)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.sequences)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400">
                            {fmt(u.sequences_done)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.annotations_total)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.annotations_auto)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.annotations_manual)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-amber-400">{fmt(u.auto_edited)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.auto_deleted)}</td>
                          <td className="py-1.5 px-2 text-right tabular-nums">{fmt(u.runs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {byRoot.length > 1 && (
                <Card title={t('Par racine de workspace')} wide>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left py-1.5 px-2 font-medium">{t('Racine')}</th>
                          <th className="text-left py-1.5 px-2 font-medium">{t('Utilisateurs')}</th>
                          {['Sequences', 'Exportees', 'Total', 'Auto', 'Manuel'].map((h) => (
                            <th key={h} className="text-right py-1.5 px-2 font-medium">{t(h)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {byRoot.map((r) => (
                          <tr key={r.root} className="border-t border-slate-700/60">
                            <td className="py-1.5 px-2">{r.root}</td>
                            <td className="py-1.5 px-2 text-slate-500 text-[11px]">
                              {r.users.map((u) => u.user).join(', ')}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.sequences)}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-emerald-400">
                              {fmt(r.sequences_done)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.annotations_total)}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.annotations_auto)}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.annotations_manual)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
              {[
                [fmt(total), t('Annotations')],
                [pctLabel(agg.auto, total), `${t('Auto')} (${fmt(agg.auto)})`],
                [pctLabel(agg.manual, total), `${t('Manuel')} (${fmt(agg.manual)})`],
                [agg.auto ? `${Math.round(agg.edited / agg.auto * 100)} %` : '0 %',
                 `${t('Auto retouchees')} (${fmt(agg.edited)})`],
                [fmt(agg.deleted), t('Auto supprimees')],
                [fmt(agg.framesMulti), t('Frames reprises 2 fois+')],
              ].map(([v, l]) => (
                <div key={l} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
                  <div className="text-2xl font-semibold">{v}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{l}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title={t('Repartition par provenance')}>
                <Pie data={agg.totals} />
              </Card>

              <Card title={t('Devenir des sorties automatiques')}>
                {agg.auto === 0 ? (
                  <p className="text-xs text-slate-500 italic py-6">{t('Aucune sortie automatique')}</p>
                ) : (
                  <>
                    <div className="flex h-7 rounded overflow-hidden bg-slate-700">
                      {([[t('Conservees'), kept, '#10b981'],
                         [t('Retouchees'), agg.edited, '#f59e0b'],
                         [t('Supprimees'), agg.deleted, '#ef4444']] as [string, number, string][])
                        .filter(([, v]) => v > 0)
                        .map(([n, v, c]) => (
                          <div key={n} style={{ width: `${(v / agg.auto) * 100}%`, background: c }}
                               title={`${n} : ${fmt(v)}`} />
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2">
                      {([[t('Conservees telles quelles'), kept, '#10b981'],
                         [t('Retouchees a la main'), agg.edited, '#f59e0b'],
                         [t('Supprimees'), agg.deleted, '#ef4444']] as [string, number, string][])
                        .map(([n, v, c]) => (
                          <span key={n} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />
                            {n} — {fmt(v)}
                          </span>
                        ))}
                    </div>
                    {!hasEvents && (
                      <p className="text-[11px] text-amber-400/80 mt-3">
                        {t("Le journal d'evenements est vide : retouches et suppressions ne sont comptees que depuis l'activation du monitoring. Les annotations deja presentes apparaissent comme conservees.")}
                      </p>
                    )}
                  </>
                )}
              </Card>

              <Card title={t('Sequences (dataset)')} wide>
                <div className="space-y-3">
                  {[...agg.rows].sort((a, b) => b.total - a.total).slice(0, 25).map((r, i) => {
                    const pct = r.frameCount > 0
                      ? Math.round((r.framesAnnotated / r.frameCount) * 100) : 0
                    const covMax = Math.max(...r.coverage, 1)
                    // Détail au survol : tout ce qui a produit ces annotations.
                    const detail = [
                      `${r.user} · ${r.project}`,
                      r.path || r.seq,
                      `${fmt(r.total)} ${t('annotations sur')} ${fmt(r.framesAnnotated)} frames`,
                      `${t('Séquence')} : ${fmt(r.frameCount)} ${t('images')} (${pct} % ${t('couvertes')})`,
                      ...Object.entries(r.by).sort((a, b) => b[1] - a[1])
                        .map(([s, n]) => `  ${labelOf(s, t)} : ${fmt(n)}`),
                      r.isDone
                        ? `${t('Exporté')} ${r.lastExportFormat ?? ''} ${t('le')} ${(r.lastExportAt ?? '').slice(0, 10)}`
                        : t('Jamais exporté'),
                    ].join('\n')

                    return (
                      <div key={i} title={detail}>
                        <div className="flex items-center gap-2 text-xs mb-1">
                          {/* Terminée = exportée */}
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 text-[9px] font-bold ${
                            r.isDone ? 'bg-emerald-500 text-slate-900' : 'bg-slate-700 text-slate-500'
                          }`}>
                            {r.isDone ? '✓' : ''}
                          </span>
                          <span className="truncate text-slate-300 flex-1 min-w-0">{r.seq}</span>
                          <span className="text-slate-500 tabular-nums flex-shrink-0">
                            {fmt(r.framesAnnotated)} / {fmt(r.frameCount)} img
                          </span>
                          <span className={`tabular-nums w-10 text-right flex-shrink-0 ${
                            pct >= 80 ? 'text-emerald-400' : pct >= 30 ? 'text-amber-400' : 'text-slate-400'
                          }`}>{pct} %</span>
                          <span className="w-16 text-right tabular-nums text-slate-300 flex-shrink-0">
                            {fmt(r.total)} ann.
                          </span>
                        </div>
                        {/* Barre de couverture : où se trouvent les annotations
                            dans la séquence, à l'échelle de la séquence entière. */}
                        <div className="flex h-3 rounded-sm overflow-hidden bg-slate-900 border border-slate-700">
                          {r.coverage.length > 0 ? r.coverage.map((c, j) => (
                            <i key={j} className="flex-1"
                               style={{
                                 background: c > 0
                                   ? `rgba(16,185,129,${0.35 + 0.65 * (c / covMax)})`
                                   : 'transparent',
                               }} />
                          )) : (
                            <i className="flex-1" style={{ background: 'transparent' }} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-[11px] text-slate-600 mt-3">
                  {t("Coche verte = séquence exportée (YOLO, COCO ou .ver). Une séquence annotée mais jamais exportée n'est pas considérée terminée.")}
                </p>
              </Card>

              {agg.rework.length > 0 && (
                <Card title={t('Reprise humaine par dataset')} wide>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left py-1.5 px-2 font-medium">Dataset</th>
                          <th className="text-left py-1.5 px-2 font-medium">{t('Projet')}</th>
                          <th className="text-right py-1.5 px-2 font-medium">{t('Frames touchees')}</th>
                          <th className="text-right py-1.5 px-2 font-medium">{t('Reprises 2 fois+')}</th>
                          <th className="text-right py-1.5 px-2 font-medium">{t('Interventions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agg.rework.map((r, i) => (
                          <tr key={i} className="border-t border-slate-700/60">
                            <td className="py-1.5 px-2 font-mono text-[11px] text-slate-300 max-w-md truncate"
                                title={r.dataset}>{r.dataset}</td>
                            <td className="py-1.5 px-2 text-slate-400">{r.project_name}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.frames_touched)}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums text-amber-400">
                              {fmt(r.frames_multi)}
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.touches)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              <Card title={t('Runs automatiques')} wide>
                {agg.runs.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-3">
                    {t("Aucun run enregistre. Le journal se remplit a partir du prochain lancement d'algorithme.")}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400">
                          {['Date', 'Utilisateur', 'Algorithme', 'Mode', 'Cibles',
                            'Frames', 'Creees', 'Duree', 'Fin'].map((h, i) => (
                            <th key={h} className={`py-1.5 px-2 font-medium ${
                              i >= 4 && i <= 7 ? 'text-right' : 'text-left'}`}>{t(h)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...agg.runs]
                          .sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''))
                          .slice(0, 40).map((r, i) => (
                          <tr key={i} className="border-t border-slate-700/60">
                            <td className="py-1.5 px-2">{(r.ts ?? '').replace('T', ' ').slice(0, 16)}</td>
                            <td className="py-1.5 px-2 text-slate-400">{r.user}</td>
                            <td className="py-1.5 px-2">{r.algorithm}</td>
                            <td className="py-1.5 px-2 text-slate-400">{r.mode}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{r.targets}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{r.frames}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{r.created}</td>
                            <td className="py-1.5 px-2 text-right tabular-nums">
                              {r.duration_s ? `${r.duration_s} s` : ''}
                            </td>
                            <td className={`py-1.5 px-2 ${r.stopped ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {r.stopped ? t('arrete') : t('complet')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <p className="text-[11px] text-slate-600 mt-5">
              {t('Rapport hors ligne multi-workspaces')} :
              <code className="ml-1 text-slate-500">
                python tools/monitoring_report.py &lt;workspace&gt; [...] --outdir &lt;{t('dossier')}&gt;
              </code>
            </p>
          </>
        )}
      </main>
    </div>
  )
}
