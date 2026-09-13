// ============================================================
// PlansPage.tsx — Experiment Plans : construire une suite d'etapes
// (graphe de base + overrides) et la lancer d'un clic. Le resultat
// peuple l'arbre de Lineage. Tout est app-natif (chaque etape duplique
// un graphe que l'utilisateur a construit dans le Sandgraph).
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ListChecks, Plus, Trash2, Play, Loader2, CheckCircle2, XCircle,
  ChevronRight, Save, FlaskConical,
} from 'lucide-react'
import { plansAPI, graphsAPI, type PlanStep } from '../api/client'

// Champs d'override exposes (mappes sur les noeuds standard v1/a1/t1 cote backend).
const OV_FIELDS: { key: string; label: string; ph: string }[] = [
  { key: 'subset', label: 'Subset', ph: 'subset_lineage_v1' },
  { key: 'project', label: 'Projet annot.', ph: 'Annot_lineage_v2' },
  { key: 'top_k', label: 'Nb images', ph: '130' },
  { key: 'threshold', label: 'Seuil annot.', ph: '0.45' },
  { key: 'epochs', label: 'Epochs', ph: '10' },
  { key: 'lr0', label: 'lr0', ph: '0.0005' },
  { key: 'batch', label: 'Batch', ph: '8' },
  { key: 'run_label', label: 'Run label', ph: 'exp_a' },
]

type EditStep = { id: string; label: string; base_graph_id: string; overrides: Record<string, string> }

const _newStep = (): EditStep => ({ id: '', label: '', base_graph_id: '', overrides: {} })

export default function PlansPage() {
  const qc = useQueryClient()
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: plansAPI.list, refetchInterval: 5000 })
  const { data: graphs = [] } = useQuery({ queryKey: ['graphs'], queryFn: () => graphsAPI.list() })
  const [selId, setSelId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<EditStep[]>([])

  const selected = useMemo(() => plans.find(p => p.plan_id === selId) ?? null, [plans, selId])

  // Charge le plan selectionne dans l'editeur.
  useEffect(() => {
    if (selected) {
      setName(selected.name)
      setSteps(selected.steps.map(s => ({ id: s.id, label: s.label, base_graph_id: s.base_graph_id, overrides: { ...(s.overrides as Record<string, string>) } })))
    }
  }, [selId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Statut d'execution (poll quand un plan est en cours).
  const running = selected?.last_run?.status === 'running'
  const { data: status } = useQuery({
    queryKey: ['plan-status', selId],
    queryFn: () => plansAPI.status(selId!),
    enabled: !!selId,
    refetchInterval: running ? 2500 : false,
  })

  const createMut = useMutation({
    mutationFn: () => plansAPI.create('Nouveau plan', []),
    onSuccess: p => { qc.invalidateQueries({ queryKey: ['plans'] }); setSelId(p.plan_id) },
  })
  const saveMut = useMutation({
    mutationFn: () => plansAPI.update(selId!, name, steps.map(s => ({ ...s })) as PlanStep[]),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); toast.success('Plan enregistré') },
    onError: (e: Error) => toast.error(e.message),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => plansAPI.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plans'] }); setSelId(null) },
  })
  const runMut = useMutation({
    mutationFn: () => plansAPI.run(selId!),
    onSuccess: r => { r.ok ? toast.success('Plan lancé') : toast(r.message ?? 'Déjà en cours'); qc.invalidateQueries({ queryKey: ['plans'] }) },
    onError: (e: Error) => toast.error(e.message),
  })

  const setStep = (i: number, patch: Partial<EditStep>) =>
    setSteps(s => s.map((st, j) => j === i ? { ...st, ...patch } : st))
  const setOv = (i: number, k: string, v: string) =>
    setSteps(s => s.map((st, j) => {
      if (j !== i) return st
      const ov = { ...st.overrides }
      if (v === '') delete ov[k]; else ov[k] = v
      return { ...st, overrides: ov }
    }))

  const results = status?.results ?? selected?.last_run?.results ?? []

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <ListChecks size={20} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Plans d'expériences</h1>
          <span className="text-xs text-gray-500">planifier une suite d'expériences et la lancer d'un clic</span>
          <button onClick={() => createMut.mutate()}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg">
            <Plus size={14} /> Nouveau plan
          </button>
        </div>

        <p className="text-[12px] text-gray-500 leading-relaxed">
          Chaque étape <b>duplique un graphe de base</b> (que vous avez construit dans le Sandgraph :
          pipeline complet, ou graphe « réutilisation » annotation FREE → training) et applique des
          <b> overrides</b>, puis lance le run et commit dans DVC. Le résultat apparaît dans le graphe de Lineage.
        </p>

        <div className="flex gap-5">
          {/* Liste des plans */}
          <aside className="w-52 shrink-0 space-y-1.5">
            {plans.length === 0 && <p className="text-xs text-gray-600">Aucun plan. Créez-en un.</p>}
            {plans.map(p => (
              <button key={p.plan_id} onClick={() => setSelId(p.plan_id)}
                className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${selId === p.plan_id ? 'bg-indigo-900/30 border-indigo-700/50' : 'bg-gray-900 border-gray-800 hover:border-gray-700'}`}>
                <div className="flex items-center gap-1.5">
                  <ChevronRight size={11} className={selId === p.plan_id ? 'text-indigo-400' : 'text-gray-600'} />
                  <span className="text-xs font-semibold text-white truncate flex-1">{p.name}</span>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5">{p.steps.length} étape(s){p.last_run ? ` · ${p.last_run.status}` : ''}</p>
              </button>
            ))}
          </aside>

          {/* Editeur + execution */}
          <div className="flex-1 min-w-0 space-y-4">
            {!selected ? (
              <div className="text-sm text-gray-500 py-10 text-center">Sélectionnez ou créez un plan.</div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <input value={name} onChange={e => setName(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-200 border border-gray-700 hover:bg-gray-800 rounded-lg">
                    <Save size={13} /> Enregistrer
                  </button>
                  <button onClick={() => runMut.mutate()} disabled={running || steps.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg">
                    {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Lancer le plan
                  </button>
                  <button onClick={() => { if (confirm('Supprimer ce plan ?')) delMut.mutate(selected.plan_id) }}
                    className="p-2 text-gray-600 hover:text-red-400"><Trash2 size={14} /></button>
                </div>

                {/* Etapes */}
                <div className="space-y-3">
                  {steps.map((st, i) => (
                    <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 font-mono">#{i + 1}</span>
                        <input value={st.label} onChange={e => setStep(i, { label: e.target.value })}
                          placeholder="libellé de l'étape (ex. baseline)"
                          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white" />
                        <select value={st.base_graph_id} onChange={e => setStep(i, { base_graph_id: e.target.value })}
                          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 max-w-[200px]">
                          <option value="">graphe de base…</option>
                          {graphs.map(g => <option key={g.graph_id} value={g.graph_id}>{g.name}</option>)}
                        </select>
                        <button onClick={() => setSteps(s => s.filter((_, j) => j !== i))}
                          className="p-1 text-gray-600 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {OV_FIELDS.map(f => (
                          <label key={f.key} className="text-[10px] text-gray-500">
                            {f.label}
                            <input value={st.overrides[f.key] ?? ''} onChange={e => setOv(i, f.key, e.target.value)}
                              placeholder={f.ph}
                              className="block mt-0.5 w-full bg-gray-950 border border-gray-800 rounded px-2 py-1 text-xs text-gray-200 font-mono" />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setSteps(s => [...s, _newStep()])}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-300 border border-indigo-700/50 hover:bg-indigo-900/20 rounded-lg">
                    <Plus size={13} /> Ajouter une étape
                  </button>
                </div>

                {/* Progression / resultats */}
                {(running || results.length > 0) && (
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      {running ? <Loader2 size={14} className="animate-spin text-emerald-400" /> : <CheckCircle2 size={14} className="text-emerald-400" />}
                      <span className="text-gray-200 font-semibold">
                        Exécution {status?.status ?? selected.last_run?.status}
                        {status?.total ? ` — étape ${status.current}/${status.total}` : ''}
                      </span>
                    </div>
                    {results.map(r => (
                      <div key={r.step_id} className="flex items-center gap-2 text-[11px] bg-gray-900 rounded-lg px-2.5 py-1.5">
                        {r.status === 'done' ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                          : r.status === 'error' || r.status === 'failed' ? <XCircle size={13} className="text-red-500 shrink-0" />
                          : <Loader2 size={13} className="animate-spin text-gray-400 shrink-0" />}
                        <span className="text-gray-200">{r.label}</span>
                        <span className="text-gray-600">{r.status}</span>
                        {r.map50 != null && <span className="text-blue-300 font-mono ml-auto">mAP50 {Number(r.map50).toFixed(3)}</span>}
                        {r.dvc_version && <span className="text-emerald-300 font-mono">dvc {r.dvc_version}</span>}
                        {r.git_commit && <span className="text-indigo-300 font-mono">git {String(r.git_commit).slice(0, 7)}</span>}
                        {r.error && <span className="text-red-400 truncate">{r.error}</span>}
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-600 flex items-center gap-1">
                      <FlaskConical size={11} /> Les résultats sont navigables dans l'onglet Lineage.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
