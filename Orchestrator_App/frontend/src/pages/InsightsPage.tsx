// ============================================================
// InsightsPage.tsx
// Insights par run de template : plots d'evolution (training,
// gains, Optuna, timeline) + journal de comprehension complet.
// Fichiers persistes dans WORKSPACE/insights/{graph}/{run}/.
// ============================================================

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { insightsAPI, graphsAPI } from '../api/client'
import type { MlopsStatus } from '../types/api'
import {
  BarChart3, RefreshCw, Loader2, ChevronRight, FileText,
  TrendingUp, Settings2, Zap, Trash2, Grid3x3, Info, ScrollText,
  GitCommit, Database, FlaskConical, Boxes, ExternalLink, CheckCircle2, XCircle,
  ShieldCheck, GitFork,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Plot, { buildHtmlReport } from '../components/Plot'
import { LogBlocks } from './SandgraphPage'
import type { LogEntry } from './SandgraphPage'
import { useWorkspaceStorageScope, workspaceStorageKey } from '../utils/workspaceStorage'
import { useT } from '../i18n/useLang'

// step5 : point d'histoire d'entraînement (une ligne par epoch dans insights.json).
interface EpochPoint { epoch: number; map50?: number; map5095?: number; precision?: number; recall?: number; box_loss?: number; cls_loss?: number }
interface TrainingInfo {
  run_name: string
  status: { status?: string; best_map50?: number; best_map5095?: number; total_epochs?: number }
  history?: EpochPoint[]
}
const _short = (n: string) => n.replace(/^orch_/, '').slice(0, 10)

// step3 : logs colorés dépliables (mêmes que le Sandgraph) — chargés du localStorage
// (dernier run du graphe). ts re-hydraté en Date.
function _loadGraphLogs(graphId: string, workspaceScope: string | null): LogEntry[] {
  if (!workspaceScope) return []
  try {
    const raw = localStorage.getItem(workspaceStorageKey(workspaceScope, `logs_${graphId}`))
    if (!raw) return []
    return (JSON.parse(raw) as Record<string, unknown>[]).map(e => ({ ...e, ts: new Date(e.ts as string) })) as LogEntry[]
  } catch { return [] }
}

interface InsightSummary {
  graph_id: string
  graph_name: string
  run_id: string
  generated_at: string
  plots: string[]
}

// Titre lisible pour les plots d'analyse rapatriés du Training App (analysis_{run}_{kind}) --
// kinds alignés sur _ANALYSIS_WANTED (Orchestrator_App/backend/core/insights.py), qui prend les
// plots déclarés par le moteur du run (catalogue "artifacts" de Training_App).
function analysisMeta(name: string, t: (fr: string) => string): { title: string; desc: string } | null {
  const m = name.match(/^analysis_(.+)_(summary|confusion|pr_curve|f1_curve|labels|val_labels|val_predictions)\.(png|jpg)$/)
  if (!m) return null
  const run = m[1]; const kind = m[2]
  const K: Record<string, [string, string]> = {
    summary:         [t("Synthèse de l'entraînement"),       t('pertes et métriques par epoch')],
    confusion:       [t('Matrice de confusion'),              t('taux vrais/faux par classe')],
    pr_curve:        [t('Courbe Précision-Rappel'),           t('≈ ROC pour la détection')],
    f1_curve:        [t('Courbe F1 vs seuil'),                t('seuil de confiance optimal')],
    labels:          [t('Distribution des labels'),           t('histogramme classes + tailles des boîtes')],
    val_labels:      [t('Validation — vérité terrain'),       t('échantillon de validation annoté')],
    val_predictions: [t('Validation — prédictions'),          t('sortie du modèle sur le même échantillon')],
  }
  const [title, d] = K[kind] ?? [kind, '']
  return { title: `${title}`, desc: `${run} · ${d}` }
}

// step5 : bloc de section titré (réorganisation par bloc + logique claire).
function Section({ title, icon, note, children }: { title: string; icon?: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {note && <p className="text-[11px] text-gray-500 mb-3">{note}</p>}
      {children}
    </div>
  )
}

// Carte contenant un graphe Plotly (titre + zone chart).
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 text-xs font-semibold text-gray-200">{title}</div>
      <div className="p-2">{children}</div>
    </div>
  )
}

// ── Lineage : objet reel du run (Git / DVC / MLflow) + reproductibilite ────────
interface MlflowRunRef { run_id?: string; run_name?: string; experiment_id?: string; metrics?: Record<string, number> }
interface Lineage {
  run_id?: string; git_commit?: string | null; dataset?: string | null
  dvc_version?: string | null; model_path?: string | null; map50?: number | null
  mlflow_runs?: MlflowRunRef[]; committed_at?: string | null
}
interface ReproCheck { key: string; label: string; ok: boolean; detail: string }
interface Reproducibility { reproducible: boolean; checks: ReproCheck[] }

const _basename = (p?: string | null) => (p ? p.replace(/\\/g, '/').split('/').pop() || p : '')

// Une valeur du lineage : cliquable (lien reel) ou "non relie" (honnete).
function LineageField(
  { icon, label, value, mono, href, missing }:
  { icon: React.ReactNode; label: string; value?: string | null; mono?: boolean; href?: string; missing?: string },
) {
  const t = useT()
  const shown = value ?? null
  const body = (
    <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide">
        {icon}{label}
      </div>
      {shown != null ? (
        <div className={`text-sm text-gray-100 mt-0.5 truncate ${mono ? 'font-mono' : ''} ${href ? 'text-indigo-300 group-hover:text-indigo-200' : ''}`}>
          {shown}{href && <ExternalLink size={11} className="inline ml-1 -mt-0.5" />}
        </div>
      ) : (
        <div className="text-xs text-gray-600 mt-1 italic">{missing ?? t('non relié')}</div>
      )}
    </div>
  )
  return href && shown != null
    ? <a href={href} target="_blank" rel="noreferrer" className="group block">{body}</a>
    : body
}

function LineageHeader(
  { item, lineage, repro, appUrls, graph }:
  { item: InsightSummary; lineage?: Lineage; repro?: Reproducibility; appUrls: Record<string, string>
    graph?: { mlops?: MlopsStatus; forked_from?: { parent_graph_id?: string; run_id?: string } } },
) {
  const t = useT()
  const [showRepro, setShowRepro] = useState(true)
  const [showRepipe, setShowRepipe] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isMlops = graph?.mlops?.is_mlops ?? false
  const forked = graph?.forked_from
  const forkMut = useMutation({
    mutationFn: () => graphsAPI.forkRun(item.graph_id, item.run_id),
    onSuccess: r => {
      toast.success(`${t('Fork créé')} : ${r.name}`)
      openSandgraph(r.graph_id)
    },
    onError: (e: Error & { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? e.message),
  })
  // Promotion en MLOps depuis un run experimental : injecte la paire MLflow + DVC.
  const trackMut = useMutation({
    mutationFn: () => graphsAPI.trackMlops(item.graph_id),
    onSuccess: r => {
      toast.success(r.added.length ? `${t('Suivi MLOps activé')} (${r.added.join(' + ')} ${t('ajoutés')})` : t('Déjà suivi MLOps'))
      qc.invalidateQueries({ queryKey: ['graph', item.graph_id] })
    },
    onError: (e: Error) => toast.error(e.message),
  })
  // Ouvre le Sandgraph sur un graphe precis via l'URL : aucun état global au
  // domaine ne peut alors sélectionner un graphe d'un autre workspace.
  const openSandgraph = (gid: string) => {
    navigate(`/?graph_id=${encodeURIComponent(gid)}`)
  }
  const dvcUrl = appUrls['dvc-app']
  const mlUrl = appUrls['mlflow-app']
  const l = lineage ?? {}
  const mlRun = l.mlflow_runs?.[0]
  const commit = l.git_commit || null

  const mlHref = mlUrl && mlRun?.run_id ? `${mlUrl}/runs/${mlRun.run_id}` : undefined
  const dvcHistoryHref = dvcUrl ? `${dvcUrl}/history` : undefined
  const dvcDiffHref = dvcUrl && commit ? `${dvcUrl}/diff?rev_a=${commit}~1&rev_b=${commit}` : undefined
  const dvcDatasetsHref = dvcUrl ? `${dvcUrl}/` : undefined
  const artifactsHref = `/api/graphs/${item.graph_id}/artifacts`

  const Action = ({ href, icon, label, disabled, title }:
    { href?: string; icon: React.ReactNode; label: string; disabled?: boolean; title?: string }) => (
    <a href={disabled ? undefined : href} target="_blank" rel="noreferrer" title={title}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        disabled
          ? 'border-gray-800 text-gray-600 cursor-not-allowed'
          : 'border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/20'
      }`}>
      {icon}{label}
    </a>
  )

  return (
    <div className="bg-gradient-to-br from-indigo-950/40 to-gray-900 border border-indigo-800/40 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Boxes size={16} className="text-indigo-300" />
        <h2 className="text-sm font-semibold text-white">{t('Identité du run')}</h2>
        <span title={t("ID unifié (orch_run_id) : la clé qui relie ce run à Git, DVC et MLflow (tag + trailer commit).")}
          className="flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-300 border border-amber-700/40">
          ID {item.run_id}
        </span>
        {/* Type derive : MLOps (suivi) vs Experimental (jetable) */}
        {isMlops ? (
          <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-900/30 text-emerald-300 border border-emerald-700/50">
            <ShieldCheck size={10} /> MLOps
          </span>
        ) : (
          <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gray-800 text-gray-400 border border-gray-700">
            <FlaskConical size={10} /> Experimental
          </span>
        )}
        {/* Provenance : ce run vient-il d'un fork ? */}
        {forked?.run_id && (
          <button
            onClick={() => forked.parent_graph_id && openSandgraph(forked.parent_graph_id)}
            title={t('Ce graphe est un fork. Ouvrir le graphe parent.')}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-indigo-900/20 text-indigo-300 border border-indigo-700/40 hover:bg-indigo-900/40">
            <GitFork size={10} /> {t('fork de')} {forked.run_id.slice(0, 6)}
          </button>
        )}
        <span className="ml-auto text-[10px] text-gray-500">
          {l.committed_at ? `${t('versionné')} ${new Date(l.committed_at).toLocaleString('fr')}` : t('non versionné (pas de commit DVC)')}
        </span>
      </div>

      {/* Grille des objets reels */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        <LineageField icon={<GitCommit size={11} />} label="Git" value={commit ? commit.slice(0, 8) : null}
          mono href={dvcHistoryHref} missing={t('aucun commit DVC')} />
        <LineageField icon={<Database size={11} />} label="Dataset" value={l.dataset}
          href={dvcDatasetsHref} missing={t('dataset inconnu')} />
        <LineageField icon={<Database size={11} />} label="DVC version" value={l.dvc_version}
          mono href={dvcDiffHref} missing={t('non versionné DVC')} />
        <LineageField icon={<FlaskConical size={11} />} label="MLflow Run"
          value={mlRun?.run_id ? mlRun.run_id.slice(0, 8) : null} mono href={mlHref}
          missing={t('aucun run MLflow lié')} />
        <LineageField icon={<Boxes size={11} />} label="Model" value={_basename(l.model_path) || null}
          mono missing={t('modèle absent')} />
        <LineageField icon={<TrendingUp size={11} />} label="mAP50"
          value={l.map50 != null ? Number(l.map50).toFixed(4) : null} mono missing="—" />
      </div>

      {/* Actions directes vers les objets reels */}
      <div className="flex flex-wrap gap-2">
        <Action href={mlHref} icon={<FlaskConical size={13} />} label="Open MLflow Run"
          disabled={!mlHref} title={mlHref ? '' : t('Aucun run MLflow lié à ce run')} />
        <Action href={dvcDiffHref || dvcHistoryHref} icon={<GitCommit size={13} />} label="Inspect DVC"
          disabled={!dvcUrl} />
        <Action href={dvcDatasetsHref} icon={<Database size={13} />} label="Inspect Dataset"
          disabled={!dvcDatasetsHref} />
        <Action href={artifactsHref} icon={<Grid3x3 size={13} />} label="View Artifacts" />
        {/* Navigation exacte vers l'objet source (pas juste "l'app") */}
        <button onClick={() => openSandgraph(item.graph_id)}
          title={t('Ouvrir le Sandgraph qui a produit ce run')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/20 transition-colors">
          <Boxes size={13} /> Open Sandgraph
        </button>
        <button onClick={() => navigate('/mlops/lineage')}
          title={t("Voir ce run dans l'arbre de lineage complet")}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/20 transition-colors">
          <GitFork size={13} /> Open Lineage
        </button>
        {!isMlops && (
          <button onClick={() => trackMut.mutate()} disabled={trackMut.isPending}
            title={t('Ce run est experimental : activer le suivi MLOps ajoute la paire MLflow + DVC au graphe, puis committez pour versionner.')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/20 transition-colors disabled:opacity-50">
            {trackMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            Track in MLOps
          </button>
        )}
        <button
          onClick={() => forkMut.mutate()}
          disabled={forkMut.isPending}
          title={t('Duplique ce graphe en figeant le même dataset et les mêmes annotations, et enregistre la provenance du run. Ajustez ensuite les params puis relancez.')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            forkMut.isPending
              ? 'border-gray-800 text-gray-600 cursor-not-allowed'
              : 'border-indigo-700/50 text-indigo-300 hover:bg-indigo-900/20'
          }`}>
          {forkMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <GitFork size={13} />}
          Fork this run
        </button>
        <button
          onClick={() => setShowRepipe(v => !v)}
          disabled={!repro?.reproducible}
          title={repro?.reproducible ? '' : t('Lineage incomplet — voir la checklist ci-dessous')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
            repro?.reproducible
              ? 'border-emerald-700/50 text-emerald-300 hover:bg-emerald-900/20'
              : 'border-gray-800 text-gray-600 cursor-not-allowed'
          }`}>
          <RefreshCw size={13} /> Reproduce Run
        </button>
      </div>

      {/* Recette de repro — 100% UI, aucune commande. Chaque étape ouvre la page. */}
      {showRepipe && repro?.reproducible && (
        <div className="bg-gray-950 border border-emerald-800/40 rounded-lg p-3 text-[11px] text-gray-300 space-y-2">
          <p className="text-emerald-300">{t('Reproduire ce run, sans ligne de commande :')}</p>
          <ol className="space-y-1.5 list-decimal list-inside">
            <li>
              <b>{t('Restaurer la version des données')}</b> — {t("dans l'app DVC, onglet Historique, cliquer « Restaurer cette version » sur le commit")} <span className="font-mono text-indigo-300">{commit?.slice(0, 8)}</span>.
              {dvcHistoryHref && <a href={dvcHistoryHref} target="_blank" rel="noreferrer" className="ml-1 text-indigo-300 hover:text-indigo-200">{t("Ouvrir l'historique")} <ExternalLink size={10} className="inline" /></a>}
            </li>
            <li>
              <b>{t('Récupérer les fichiers')}</b> — {t('si un remote est configuré, onglet Sync → Pull (récupère le contenu exact du dataset')} {l.dataset ? <span className="font-mono">{l.dataset}</span> : ''}).
              {dvcUrl && <a href={`${dvcUrl}/sync`} target="_blank" rel="noreferrer" className="ml-1 text-indigo-300 hover:text-indigo-200">{t('Ouvrir Sync')} <ExternalLink size={10} className="inline" /></a>}
            </li>
            <li>
              <b>{t("Re-lancer à l'identique")}</b> — {t('bouton')} <span className="text-indigo-300">« Fork this run »</span> {t('ci-dessus (fige le même dataset + annotations), puis « Lancer » dans le Sandgraph.')}
            </li>
            <li>
              <b>{t('Comparer le résultat')}</b> — {t("au run MLflow d'origine")}
              {mlHref ? <a href={mlHref} target="_blank" rel="noreferrer" className="ml-1 text-indigo-300 hover:text-indigo-200">run {mlRun?.run_id?.slice(0, 8)} <ExternalLink size={10} className="inline" /></a> : <span className="font-mono"> {mlRun?.run_id?.slice(0, 8)}</span>} — {t('mAP50 attendue')} {l.map50 != null ? Number(l.map50).toFixed(4) : '—'}.
            </li>
          </ol>
        </div>
      )}

      {/* Panneau reproductibilite */}
      {repro && (
        <div className="bg-gray-950 border border-gray-800 rounded-lg">
          <button onClick={() => setShowRepro(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
            <ShieldCheck size={14} className={repro.reproducible ? 'text-emerald-400' : 'text-amber-400'} />
            <span className="text-xs font-semibold text-white">Reproducibility</span>
            <span className={`text-[11px] font-semibold ${repro.reproducible ? 'text-emerald-400' : 'text-amber-400'}`}>
              {repro.reproducible ? 'Reproducible' : t('Incomplet')}
            </span>
            <span className="text-xs text-gray-600 ml-auto">{showRepro ? '▲' : '▼'}</span>
          </button>
          {showRepro && (
            <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {repro.checks.map(c => (
                <div key={c.key} className="flex items-start gap-2 text-xs">
                  {c.ok
                    ? <CheckCircle2 size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                    : <XCircle size={14} className="text-red-500 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <span className="text-gray-200">{c.label}</span>
                    <span className="text-gray-500"> — {c.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Couleurs par type de node (miroir du Sandgraph) pour l'apercu du graphe source.
const NODE_TYPE_CLS: Record<string, string> = {
  dataset_source: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
  explorer:           'bg-violet-900/30 text-violet-300 border-violet-700/40',
  annotation:     'bg-rose-900/30 text-rose-300 border-rose-700/40',
  training:       'bg-blue-900/30 text-blue-300 border-blue-700/40',
  inference:      'bg-cyan-900/30 text-cyan-300 border-cyan-700/40',
  optuna:         'bg-cyan-900/30 text-cyan-300 border-cyan-700/40',
  dvc:            'bg-amber-900/30 text-amber-300 border-amber-700/40',
  mlflow:         'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
  model:          'bg-blue-900/30 text-blue-300 border-blue-700/40',
}

// Apercu compact du Sandgraph qui a produit le run : chaine de nodes colores. Sert
// a IDENTIFIER le graphe d'origine d'un coup d'oeil (point "Insight -> Sandgraph").
function SourceGraphPreview(
  { nodes, onOpen }:
  { nodes: { type: string; label: string; status?: string }[]; onOpen: () => void },
) {
  const t = useT()
  if (!nodes.length) return null
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Boxes size={14} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">{t('Sandgraph source')}</h3>
        <span className="text-[11px] text-gray-500">{nodes.length} nodes</span>
        <button onClick={onOpen}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-indigo-300 border border-indigo-700/50 hover:bg-indigo-900/20 rounded-lg">
          <ExternalLink size={11} /> {t('Ouvrir')}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {nodes.map((n, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className={`px-2 py-1 rounded-lg border text-[11px] font-medium ${NODE_TYPE_CLS[n.type] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}
              title={`${n.type}${n.status ? ' · ' + n.status : ''}`}>
              {n.label}
            </span>
            {i < nodes.length - 1 && <ChevronRight size={11} className="text-gray-700" />}
          </span>
        ))}
      </div>
    </div>
  )
}

function InsightDetail({ item, workspaceScope }: { item: InsightSummary; workspaceScope: string | null }) {
  const { data } = useQuery({
    queryKey: ['insights', item.graph_id, item.run_id],
    queryFn: () => insightsAPI.get(item.graph_id, item.run_id),
  })
  const { data: appUrls = {} } = useQuery<Record<string, string>>({
    queryKey: ['app-urls'],
    queryFn: () => import('../api/client').then(m => m.graphsAPI.getAppUrls()),
    staleTime: 60_000,
  })
  // Graphe source du run : type MLOps (autorite backend) + provenance de fork.
  const { data: graph } = useQuery({
    queryKey: ['graph', item.graph_id],
    queryFn: () => import('../api/client').then(m => m.graphsAPI.get(item.graph_id)),
    staleTime: 30_000,
  })
  const t = useT()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showJournal, setShowJournal] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const graphLogs = _loadGraphLogs(item.graph_id, workspaceScope)   // step3
  // Regenere l'insight de CE run (le JSON persiste peut etre fige d'avant le commit
  // DVC — carte d'identite / deep-links vides). Rafraichit aussi le graphe (lineage).
  const regenMut = useMutation({
    mutationFn: () => insightsAPI.generate(item.graph_id, item.run_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insights', item.graph_id, item.run_id] })
      qc.invalidateQueries({ queryKey: ['insights-list'] })
      qc.invalidateQueries({ queryKey: ['graph', item.graph_id] })
      toast.success(t('Insight régénéré'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const trainings = (data?.trainings ?? []) as TrainingInfo[]
  const optuna = (data?.optuna ?? []) as { study_name: string; direction: string; best_value: number | null; trials: { number?: number; value?: number | null }[] }[]
  const steps = (data?.steps ?? []) as { step_id: string; status: string; output: Record<string, unknown> }[]
  const dvcCommits = (data?.dvc?.commits ?? []) as { short?: string; subject?: string }[]
  const mlflowRuns = (data?.mlflow?.runs ?? []) as unknown[]
  const lineage = data?.lineage as Lineage | undefined
  const repro = data?.reproducibility as Reproducibility | undefined

  // ── step5 : construction des figures Plotly interactives depuis insights.json ──
  const withHist = trainings.filter(t => (t.history?.length ?? 0) > 0)
  const mapTraces = withHist.flatMap(t => {
    const h = t.history!, x = h.map(e => e.epoch)
    return [
      { x, y: h.map(e => e.map50 ?? null), name: `${_short(t.run_name)} · mAP50`, mode: 'lines', type: 'scatter' },
      { x, y: h.map(e => e.map5095 ?? null), name: `${_short(t.run_name)} · mAP50-95`, mode: 'lines', type: 'scatter', line: { dash: 'dot' } },
    ]
  })
  const lossTraces = withHist.flatMap(t => {
    const h = t.history!, x = h.map(e => e.epoch)
    return [
      { x, y: h.map(e => e.box_loss ?? null), name: `${_short(t.run_name)} · box`, mode: 'lines', type: 'scatter' },
      { x, y: h.map(e => e.cls_loss ?? null), name: `${_short(t.run_name)} · cls`, mode: 'lines', type: 'scatter', line: { dash: 'dot' } },
    ]
  })
  const prTraces = withHist.flatMap(t => {
    const h = t.history!, x = h.map(e => e.epoch)
    return [
      { x, y: h.map(e => e.precision ?? null), name: `${_short(t.run_name)} · P`, mode: 'lines', type: 'scatter' },
      { x, y: h.map(e => e.recall ?? null), name: `${_short(t.run_name)} · R`, mode: 'lines', type: 'scatter', line: { dash: 'dot' } },
    ]
  })
  const gainTrace = trainings.length > 0 ? [{
    type: 'bar', x: trainings.map(t => _short(t.run_name)),
    y: trainings.map(t => t.status?.best_map50 ?? 0),
    text: trainings.map(t => (t.status?.best_map50 ?? 0).toFixed(3)), textposition: 'outside',
    marker: { color: '#34d399' },
  }] : []
  const optunaTraces = optuna.flatMap(s => {
    const tv = (s.trials ?? []).filter(t => t.value != null)
    if (!tv.length) return []
    return [{ x: tv.map((t, i) => t.number ?? i), y: tv.map(t => t.value), mode: 'markers+lines', type: 'scatter', name: _short(s.study_name) }]
  })
  const analysisPlots = item.plots.filter(p => analysisMeta(p, t))   // plots du moteur du run (confusion, PR, F1, labels, val…)

  // ── Export RAPPORT HTML autonome (Plotly inline, interactif hors-ligne) ──
  const exportReport = async () => {
    try {
      const plotlyRaw = (await import('plotly.js-dist-min/plotly.min.js?raw')).default as string
      const tblTrain = `<table><tr><th>${t('Entraînement')}</th><th>mAP50</th><th>mAP50-95</th><th>epochs</th></tr>${
        trainings.map(tr => `<tr><td>${tr.run_name}</td><td>${tr.status?.best_map50?.toFixed(4) ?? '—'}</td><td>${tr.status?.best_map5095?.toFixed(4) ?? '—'}</td><td>${tr.status?.total_epochs ?? '—'}</td></tr>`).join('')}</table>`
      const tblOpt = optuna.length ? `<table><tr><th>${t('Étude')}</th><th>trials</th><th>best</th><th>direction</th></tr>${
        optuna.map(s => `<tr><td>${s.study_name}</td><td>${s.trials?.length ?? 0}</td><td>${s.best_value != null ? Number(s.best_value).toPrecision(4) : '—'}</td><td>${s.direction}</td></tr>`).join('')}</table>` : ''
      const tblDvc = dvcCommits.length ? `<table><tr><th>Commit</th><th>${t('Sujet')}</th></tr>${dvcCommits.map(c => `<tr><td>${c.short}</td><td>${c.subject ?? ''}</td></tr>`).join('')}</table>` : ''
      const html = buildHtmlReport({
        title: `${t('Rapport Insights')} — ${item.graph_name}`,
        subtitle: `run ${item.run_id} · ${t('généré')} ${new Date().toLocaleString('fr')}`,
        plotlyJs: plotlyRaw,
        sections: [
          { heading: t('Entraînement'), note: t('Métriques et pertes par epoch (toutes les runs superposées).'),
            html: tblTrain,
            figures: [
              ...(mapTraces.length ? [{ title: t('mAP par epoch'), data: mapTraces, layout: { xaxis: { title: 'epoch' }, yaxis: { title: 'mAP' } } }] : []),
              ...(lossTraces.length ? [{ title: t('Pertes par epoch'), data: lossTraces, layout: { xaxis: { title: 'epoch' }, yaxis: { title: 'loss' } } }] : []),
              ...(gainTrace.length ? [{ title: t('mAP50 finale par entraînement'), data: gainTrace, layout: { yaxis: { title: 'mAP50' } } }] : []),
            ] },
          ...(optuna.length ? [{ heading: 'Optuna (HPO)', note: t("Étude d'hyperparamètres."), html: tblOpt,
            figures: optunaTraces.length ? [{ title: t('Valeur par trial'), data: optunaTraces, layout: { xaxis: { title: 'trial' }, yaxis: { title: 'valeur' } } }] : [] }] : []),
          ...(dvcCommits.length ? [{ heading: `DVC — ${t('versions')}`, html: tblDvc }] : []),
        ],
      })
      const blob = new Blob([html], { type: 'text/html' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `rapport_insights_${item.graph_name.replace(/\s+/g, '_')}_${item.run_id}.html`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(t('Rapport HTML exporté'))
    } catch (e) {
      toast.error(t('Export échoué') + ' : ' + (e as Error).message)
    }
  }

  return (
    <div className="space-y-5">
      {/* Lineage : objet reel du run + actions + reproductibilite */}
      <LineageHeader item={item} lineage={lineage} repro={repro} appUrls={appUrls} graph={graph} />

      {/* Apercu du Sandgraph source (identifier / rouvrir le graphe d'origine) */}
      <SourceGraphPreview
        nodes={((data as { nodes?: unknown[] } | undefined)?.nodes ?? []) as { type: string; label: string; status?: string }[]}
        onOpen={() => navigate(`/?graph_id=${encodeURIComponent(item.graph_id)}`)}
      />

      {/* En-tête : logique + export */}
      <div className="flex items-start justify-between gap-3 bg-gray-900/50 border border-gray-800 rounded-xl px-4 py-3">
        <p className="text-[11px] text-gray-500 leading-relaxed max-w-2xl">
          <span className="text-gray-300 font-semibold">{t('Logique du run')}</span> : {t('le pipeline produit des données (dataset → subset → annotation),')} <b>{t('optimise')}</b> {t('les hyperparamètres (Optuna),')} <b>{t('entraîne')}</b>
          {t('le modèle final, puis l\'')}<b>{t('évalue')}</b>. {t('Les blocs ci-dessous suivent cet ordre — courbes interactives (zoom, survol, toggle légende) construites depuis')} <span className="font-mono">insights.json</span>.
        </p>
        <div className="shrink-0 flex items-center gap-2">
          <button onClick={() => regenMut.mutate()} disabled={regenMut.isPending}
            title={t("Recollecte l'état réel (DVC / MLflow / modèle) et régénère cet insight. À utiliser si le versioning vient de changer.")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 border border-indigo-700/50 hover:bg-indigo-900/20 rounded-lg disabled:opacity-50">
            {regenMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {t('Régénérer')}
          </button>
          <button onClick={exportReport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg">
            <FileText size={13} /> {t('Exporter rapport HTML')}
          </button>
        </div>
      </div>

      {/* BLOC 1 — Résultats clés (tuiles) */}
      {trainings.length > 0 && (
        <Section title={t('Résultats — modèles entraînés')} icon={<Zap size={14} className="text-blue-400" />}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {trainings.map(t => (
              <div key={t.run_name} className="bg-gray-950 border border-gray-800 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 truncate" title={t.run_name}>{_short(t.run_name)}</p>
                <p className="text-lg font-mono text-green-300 mt-1">
                  {t.status?.best_map50 != null ? Number(t.status.best_map50).toFixed(4) : '—'}
                  <span className="text-[10px] text-gray-500 ml-1">mAP50</span>
                </p>
                <p className="text-xs font-mono text-blue-300">
                  {t.status?.best_map5095 != null ? Number(t.status.best_map5095).toFixed(4) : '—'}
                  <span className="text-[10px] text-gray-500 ml-1">mAP50-95</span>
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] mt-3">
            {optuna.map(s => (
              <span key={s.study_name} className="px-2 py-1 rounded-lg bg-cyan-900/30 border border-cyan-700/30 text-cyan-300">
                Optuna · {_short(s.study_name)} : {s.trials?.length ?? 0} trials{s.best_value != null ? ` · best ${Number(s.best_value).toPrecision(4)}` : ''}
              </span>
            ))}
            {mlflowRuns.length > 0 && (
              <span className="px-2 py-1 rounded-lg bg-emerald-900/30 border border-emerald-700/30 text-emerald-300">MLflow · {mlflowRuns.length} {t('runs tracés')}</span>
            )}
            {dvcCommits.slice(0, 3).map(c => (
              <span key={c.short} className="px-2 py-1 rounded-lg bg-amber-900/30 border border-amber-700/30 text-amber-300 font-mono">DVC {c.short} — {c.subject?.slice(0, 40)}</span>
            ))}
          </div>
        </Section>
      )}

      {/* BLOC 2 — Entraînement (Plotly interactif) */}
      {(mapTraces.length > 0 || gainTrace.length > 0) && (
        <Section title={t('Entraînement — courbes par epoch')} icon={<TrendingUp size={14} className="text-blue-400" />}
          note={t('Interactif : zoom, survol pour les valeurs, clic sur la légende pour isoler une run.')}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {mapTraces.length > 0 && <ChartCard title={t('mAP par epoch')}><Plot data={mapTraces} layout={{ xaxis: { title: 'epoch' }, yaxis: { title: 'mAP', rangemode: 'tozero' } }} /></ChartCard>}
            {lossTraces.length > 0 && <ChartCard title={t('Pertes par epoch (box · cls)')}><Plot data={lossTraces} layout={{ xaxis: { title: 'epoch' }, yaxis: { title: 'loss', rangemode: 'tozero' } }} /></ChartCard>}
            {prTraces.length > 0 && <ChartCard title={t('Précision / Rappel par epoch')}><Plot data={prTraces} layout={{ xaxis: { title: 'epoch' }, yaxis: { title: 'valeur', range: [0, 1] } }} /></ChartCard>}
            {gainTrace.length > 0 && <ChartCard title={t('mAP50 finale par entraînement')}><Plot data={gainTrace} layout={{ yaxis: { title: 'mAP50', rangemode: 'tozero' } }} /></ChartCard>}
          </div>
        </Section>
      )}

      {/* BLOC 3 — Optuna (si trials avec valeurs) */}
      {optunaTraces.length > 0 && (
        <Section title={t("Optuna — historique de l'étude")} icon={<Settings2 size={14} className="text-cyan-400" />}
          note={t('Valeur de la métrique par trial (TPE + pruning).')}>
          <ChartCard title={t('Valeur par trial')}><Plot data={optunaTraces} layout={{ xaxis: { title: 'trial' }, yaxis: { title: 'valeur' } }} /></ChartCard>
        </Section>
      )}

      {/* BLOC 4 — Analyse détaillée du modèle (plots du moteur du run) — repliable */}
      {analysisPlots.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl">
          <button onClick={() => setShowAnalysis(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
            <Grid3x3 size={14} className="text-indigo-400" />
            <span className="text-sm font-semibold text-white">{t('Analyse détaillée du modèle')} ({analysisPlots.length}) — {t('matrices, PR, F1, prédictions')}</span>
            <span className="text-xs text-gray-600 ml-auto">{showAnalysis ? '▲' : '▼'}</span>
          </button>
          {showAnalysis && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 pb-4">
              {analysisPlots.map(p => {
                const am = analysisMeta(p, t)!
                return (
                  <div key={p} className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
                      <Grid3x3 size={13} className="text-indigo-400" />
                      <span className="text-xs font-semibold text-gray-200">{am.title}</span>
                      <span className="text-[10px] text-gray-600 ml-2">{am.desc}</span>
                    </div>
                    <img src={`/api/insights/${item.graph_id}/${item.run_id}/plot/${p}`} alt={am.title} className="w-full" />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Journal des etapes */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl">
        <button
          onClick={() => setShowJournal(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-3 text-left"
        >
          <FileText size={14} className="text-indigo-400" />
          <span className="text-sm font-semibold text-white">{t('Journal des étapes')} ({steps.length}) — {t('outputs bruts')}</span>
          <span className="text-xs text-gray-600 ml-auto">{showJournal ? '▲' : '▼'}</span>
        </button>
        {showJournal && (
          <div className="px-4 pb-4 space-y-2 max-h-96 overflow-y-auto">
            {steps.map(s => (
              <div key={s.step_id} className="bg-gray-950 rounded-lg p-2.5">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'success' ? 'bg-green-500' : s.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'}`} />
                  <span className="text-[11px] font-mono text-gray-300">{s.step_id}</span>
                  <span className="text-[10px] text-gray-600 ml-auto">{s.status}</span>
                </div>
                {s.output && Object.keys(s.output).length > 0 && (
                  <pre className="text-[10px] text-gray-500 mt-1.5 whitespace-pre-wrap break-all leading-snug">
                    {JSON.stringify(s.output, null, 1).slice(0, 800)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* step3 : Logs COMPLETS colorés dépliables — les mêmes que le Sandgraph
          (blocs par node, code couleur, chevrons). Source : dernier run du graphe. */}
      {graphLogs.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl">
          <button
            onClick={() => setShowLogs(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left"
          >
            <ScrollText size={14} className="text-indigo-400" />
            <span className="text-sm font-semibold text-white">{t('Logs complets')} ({graphLogs.length}) — {t('blocs colorés par node')}</span>
            <span className="text-xs text-gray-600 ml-auto">{showLogs ? '▲' : '▼'}</span>
          </button>
          {showLogs && (
            <div className="px-4 pb-4 max-h-96 overflow-y-auto text-[11px]">
              <p className="text-[10px] text-gray-600 mb-2">{t('Dernier run de ce graphe (identiques au journal du Sandgraph).')}</p>
              <LogBlocks logs={graphLogs} defaultCollapsed />
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-600">
        {t('Fichiers persistés dans le workspace')} : <span className="font-mono">insights/{item.graph_id}/{item.run_id}/</span> (insights.json · insights.md · plots PNG)
      </p>
    </div>
  )
}

export default function InsightsPage() {
  const qc = useQueryClient()
  const t = useT()
  const workspaceScope = useWorkspaceStorageScope()
  const [selected, setSelected] = useState<InsightSummary | null>(null)
  const [searchParams] = useSearchParams()

  const { data: list = [], isLoading } = useQuery<InsightSummary[]>({
    queryKey: ['insights-list'],
    queryFn: insightsAPI.list,
    refetchInterval: 10_000,
  })

  const { data: graphs = [] } = useQuery({
    queryKey: ['graphs'],
    queryFn: () => import('../api/client').then(m => m.graphsAPI.list()),
  })

  useEffect(() => {
    const runId = searchParams.get('run_id')
    const graphId = searchParams.get('graph_id')
    if (!runId) return
    const match = list.find(i => i.run_id === runId && (!graphId || i.graph_id === graphId))
    if (match) setSelected(match)
  }, [list, searchParams])

  const genMut = useMutation({
    mutationFn: (graphId: string) => insightsAPI.generate(graphId),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ['insights-list'] })
      qc.invalidateQueries({ queryKey: ['insights'] })
      toast.success(`${t('Insights générés')} (${r.plots.length} plots)`)
    },
    onError: (e: Error & { response?: { data?: { detail?: string } } }) =>
      toast.error(e.response?.data?.detail ?? e.message),
  })

  const delMut = useMutation({
    mutationFn: ({ graphId, runId }: { graphId: string; runId: string }) =>
      insightsAPI.delete(graphId, runId),
    onSuccess: () => {
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['insights-list'] })
      toast.success(t('Insight supprimé'))
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const active = selected ?? list[0] ?? null

  return (
    <div className="p-6 h-full overflow-y-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 size={20} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-white">Insights</h1>
        <span className="text-xs text-gray-500">
          {t("Plots d'évolution + journal de compréhension pour chaque run de template")}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-[11px] text-gray-500" title={t('Les insights sont (re)générés automatiquement au fur et à mesure : après chaque étape significative (training, export, commit, HPO) ET à la fin du run. Régénérables/supprimables à la main.')}>
          <Info size={12} /> {t('générés au fil du pipeline')}
        </span>
        {/* Regenerer pour un graph ayant un historique de runs */}
        {graphs.filter(g => (g.run_history?.length ?? 0) > 0 || g.active_run_id).slice(0, 4).map(g => (
          <button
            key={g.graph_id}
            onClick={() => genMut.mutate(g.graph_id)}
            disabled={genMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-indigo-300 border border-indigo-700/50 hover:bg-indigo-900/20 rounded-lg transition-colors"
            title={`${t('Générer les insights du dernier run de')} "${g.name}"`}
          >
            {genMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {g.name.slice(0, 22)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
          <Loader2 size={16} className="animate-spin mr-2" />{t('Chargement…')}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <BarChart3 size={40} className="text-gray-800" />
          <div>
            <p className="text-white font-medium">{t('Aucun insight généré')}</p>
            <p className="text-gray-500 text-sm mt-1">
              {t('Lancez un template dans le Sandgraph — les insights sont générés automatiquement à la fin du run.')}
              {' '}{t('Vous pouvez aussi les générer manuellement avec les boutons ci-dessus.')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-5">
          {/* Liste des runs */}
          <aside className="w-64 shrink-0 space-y-1.5">
            {list.map(item => {
              const isActive = active?.graph_id === item.graph_id && active?.run_id === item.run_id
              return (
                <div
                  key={`${item.graph_id}_${item.run_id}`}
                  onClick={() => setSelected(item)}
                  className={`group w-full text-left px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-indigo-900/30 border-indigo-700/50'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <ChevronRight size={11} className={isActive ? 'text-indigo-400' : 'text-gray-600'} />
                    <span className="text-xs font-semibold text-white truncate flex-1">{item.graph_name}</span>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm(t('Supprimer cet insight ?\n\nC\'est seulement un cache d\'affichage (plots + journal). Le lineage du run, les versions DVC et les runs MLflow sont conservés — tu peux régénérer l\'insight ensuite avec le bouton "Régénérer".'))) delMut.mutate({ graphId: item.graph_id, runId: item.run_id }) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 transition-all"
                      title={t('Supprimer cet insight')}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-0.5 font-mono">run {item.run_id} · {item.plots.length} plots</p>
                  <p className="text-[10px] text-gray-600">{item.generated_at ? new Date(item.generated_at).toLocaleString('fr') : ''}</p>
                </div>
              )
            })}
          </aside>

          {/* Detail */}
          <div className="flex-1 min-w-0">
            {active && <InsightDetail item={active} workspaceScope={workspaceScope} />}
          </div>
        </div>
      )}
    </div>
  )
}
