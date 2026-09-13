// NodeConfigPanel — panneau de configuration d'un nœud sélectionné
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node } from '@xyflow/react'
import { X, Trash2, Plus, RefreshCw, ChevronDown, HelpCircle, FolderOpen } from 'lucide-react'
import { graphsAPI } from '../api/client'
import { NODE_HELP } from '../nodes/nodeHelp'

interface Props {
  node: Node | null
  appUrls: Record<string, string>
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void
  onClose: () => void
  onDelete: (nodeId: string) => void
  graphId?: string | null   // step6 : le hub DVC fetch /api/graphs/{graphId}/artifacts
  // Bouton « Choisir un subset/export existant » cliqué depuis le node lui-même
  // (AppNode.tsx, événement orch:open-node-picker) : `ts` change à chaque clic
  // (même node déjà sélectionné) pour redéclencher le halo — cf. VisuConfig/
  // AnnotationConfig ci-dessous, seuls consommateurs (filtrent par nodeId).
  pickerFocus?: { nodeId: string; ts: number } | null
}

export default function NodeConfigPanel({ node, appUrls, onUpdate, onClose, onDelete, pickerFocus, graphId }: Props) {
  const [showHelp, setShowHelp] = useState(false)
  if (!node) return null
  const d = node.data as Record<string, unknown>
  const ntype = d.node_type as string

  return (
    <div className="flex h-full">
    <aside className="w-56 xl:w-64 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-3 border-b border-gray-800">
        <span className="text-sm font-semibold text-white flex-1 truncate">
          {_nodeTitle(ntype)}
        </span>
        <button
          onClick={() => setShowHelp(h => !h)}
          className={`p-1 transition-colors ${showHelp ? 'text-red-400' : 'text-red-500/70 hover:text-red-400'}`}
          title="Aide — explication des paramètres"
        >
          <HelpCircle size={14} />
        </button>
        <button
          onClick={() => onDelete(node.id)}
          className="p-1 text-gray-600 hover:text-red-400 transition-colors"
          title="Supprimer (Suppr)"
        >
          <Trash2 size={13} />
        </button>
        <button onClick={onClose} className="p-1 text-gray-600 hover:text-white transition-colors">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Renommage — dispo pour TOUS les nœuds (step 6) */}
        <NameField node={node} onUpdate={onUpdate} fallback={_nodeTitle(ntype)} />

        {ntype === 'dataset_source' && <DatasetConfig node={node} onUpdate={onUpdate} />}
        {ntype === 'model'          && <ModelConfig   node={node} onUpdate={onUpdate} />}
        {ntype === 'explorer'           && <VisuConfig     node={node} onUpdate={onUpdate} focusToken={pickerFocus?.nodeId === node.id ? pickerFocus.ts : undefined} />}
        {ntype === 'annotation'     && <AnnotationConfig node={node} onUpdate={onUpdate} focusToken={pickerFocus?.nodeId === node.id ? pickerFocus.ts : undefined} />}
        {ntype === 'dvc'            && <DVCConfig      node={node} onUpdate={onUpdate} appUrls={appUrls} graphId={graphId} />}
        {ntype === 'training'       && <TrainingConfig node={node} onUpdate={onUpdate} appUrls={appUrls} />}
        {ntype === 'inference'      && <InferenceConfig node={node} onUpdate={onUpdate} appUrls={appUrls} />}
        {ntype === 'optuna'         && <OptunaConfig   node={node} onUpdate={onUpdate} appUrls={appUrls} />}
        {ntype === 'mlflow'         && <MLflowConfig   node={node} appUrls={appUrls} graphId={graphId} />}
      </div>
    </aside>
    {showHelp && <HelpPanel ntype={ntype} title={_nodeTitle(ntype)} onClose={() => setShowHelp(false)} />}
    </div>
  )
}

// ── Panneau d'AIDE (step 2) : explique chaque paramètre. Redimensionnable en largeur. ──
function HelpPanel({ ntype, title, onClose }: { ntype: string; title: string; onClose: () => void }) {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 320 : Math.max(240, Math.min(320, Math.round(window.innerWidth * 0.22))))
  const dragging = useRef(false)
  const help = NODE_HELP[ntype]

  const onMouseDown = useCallback((e: React.MouseEvent) => { e.preventDefault(); dragging.current = true }, [])
  useEffect(() => {
    const move = (e: MouseEvent) => { if (dragging.current) setWidth(Math.min(640, Math.max(240, window.innerWidth - e.clientX))) }
    const up = () => { dragging.current = false }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  return (
    <aside className="shrink-0 bg-gray-950 border-l border-gray-800 flex" style={{ width }}>
      {/* Poignée de redimensionnement */}
      <div onMouseDown={onMouseDown} title="Tirer pour redimensionner"
        className="w-1.5 shrink-0 cursor-col-resize bg-gray-800 hover:bg-red-500/60 transition-colors" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800">
          <HelpCircle size={14} className="text-red-400 shrink-0" />
          <span className="text-sm font-semibold text-white flex-1 truncate">Aide — {title}</span>
          <button onClick={onClose} className="p-1 text-gray-600 hover:text-white"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {help?.intro && <p className="text-[11px] text-gray-400 leading-relaxed">{help.intro}</p>}
          {(help?.params ?? []).map((p, i) => (
            <div key={i} className="border border-gray-800 rounded-lg p-2.5 bg-gray-900/40">
              <p className="text-[11px] font-semibold text-red-300 font-mono break-all">{p.name}</p>
              <p className="text-[11px] text-gray-300 mt-1 leading-relaxed">{p.what}</p>
              {p.options && <p className="text-[10px] text-gray-500 mt-1"><b className="text-gray-400">Options :</b> {p.options}</p>}
              {p.effect && <p className="text-[10px] text-gray-500 mt-0.5"><b className="text-gray-400">Effet :</b> {p.effect}</p>}
            </div>
          ))}
          {!help && <p className="text-[11px] text-gray-600 italic">Aucune aide définie pour ce nœud.</p>}
        </div>
      </div>
    </aside>
  )
}

// ── Renommage du nœud (step 6) ─────────────────────────────────────────────────
function NameField({ node, onUpdate, fallback }: { node: Node; onUpdate: Props['onUpdate']; fallback: string }) {
  const d = node.data as Record<string, unknown>
  return (
    <Field label="Nom du nœud (affiché)">
      <Input value={(d.label as string) ?? ''} onChange={v => onUpdate(node.id, { label: v })} placeholder={fallback} />
    </Field>
  )
}

// ── Dataset Source ─────────────────────────────────────────────────────────────
function DatasetConfig({ node, onUpdate }: { node: Node; onUpdate: Props['onUpdate'] }) {
  const d = node.data as Record<string, unknown>
  const path = (d.dataset_path as string) ?? ''
  const [checking, setChecking] = useState(false)

  // Vérifie automatiquement (débounce) si ce chemin correspond DÉJÀ à un dataset
  // connu de Dataset_Explorer_App (même dossier, nom différent) — avertit AVANT même de
  // lancer le graphe. Check best-effort : si Dataset_Explorer_App n'est pas encore lancée,
  // l'endpoint renvoie [] silencieusement (pas une erreur bloquante).
  useEffect(() => {
    if (!path.trim()) { onUpdate(node.id, { duplicate_matches: [] }); return }
    setChecking(true)
    const t = setTimeout(() => {
      graphsAPI.checkDatasetPath(path.trim())
        .then(matches => onUpdate(node.id, { duplicate_matches: matches }))
        .catch(() => {})
        .finally(() => setChecking(false))
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, node.id])

  const duplicates = (d.duplicate_matches as { id: number; name: string; image_count: number; status: string }[] | undefined) ?? []

  return (
    <>
      <Field label="Nom du dataset"><Input value={d.dataset_name as string ?? ''} onChange={v => onUpdate(node.id, { dataset_name: v })} /></Field>
      <Field label="Chemin (dossier)"><PathInput value={d.dataset_path as string ?? ''} onChange={v => onUpdate(node.id, { dataset_path: v })} placeholder="C:/data/images ou \\serveur\partage\images" /></Field>
      {checking && <p className="text-[10px] text-gray-600">Vérification doublon…</p>}
      {duplicates.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-2.5 py-2 text-[11px] text-amber-300/80 leading-relaxed space-y-1.5">
          <p>
            ⚠ Ce chemin existe déjà dans Dataset Explorer sous {duplicates.length > 1 ? 'ces noms' : 'ce nom'} :{' '}
            {duplicates.map(m => `${m.name} (#${m.id}, ${m.image_count} img)`).join(', ')}.
          </p>
          <label className="flex items-center gap-1.5 text-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(d.allow_duplicate)}
              onChange={e => onUpdate(node.id, { allow_duplicate: e.target.checked })}
            />
            Créer quand même un dataset séparé (nouveau scan + ré-embedding CLIP)
          </label>
        </div>
      )}
      <NumField node={node} onUpdate={onUpdate} k="n_clusters" label="n_clusters" def={15} int />
      <Out>Sortie : <b>dataset_name</b> « {(d.dataset_name as string) || '—'} » (embeddings CLIP) → explorer.</Out>
    </>
  )
}

// ── Model (nœud d'entrée : modèle YOLO .pt) ────────────────────────────────────
function ModelConfig({ node, onUpdate }: { node: Node; onUpdate: Props['onUpdate'] }) {
  const d = node.data as Record<string, unknown>
  const ver = (d.yolo_version as string) ?? 'yolov8'
  const SIZES: Record<string, string[]> = {
    yolov8: ['n', 's', 'm', 'l', 'x'], yolov9: ['t', 's', 'm', 'c', 'e'],
    yolov10: ['n', 's', 'm', 'b', 'l', 'x'], yolo11: ['n', 's', 'm', 'l', 'x'],
  }
  return (
    <>
      <Field label="Chemin du modèle (.pt)">
        <PathInput value={(d.model_path as string) ?? ''} onChange={v => onUpdate(node.id, { model_path: v })} placeholder="C:/.../best.pt" />
      </Field>
      <Field label="Architecture (fige le Training)">
        <Select value={ver} onChange={v => onUpdate(node.id, { yolo_version: v, model_size: (SIZES[v] ?? ['n'])[0] })} options={[['yolov8', 'YOLOv8'], ['yolov9', 'YOLOv9'], ['yolov10', 'YOLOv10'], ['yolo11', 'YOLO11']]} />
      </Field>
      <Field label="Taille">
        <Select value={(d.model_size as string) ?? 'n'} onChange={v => onUpdate(node.id, { model_size: v })} options={(SIZES[ver] ?? ['n']).map(s => [s, s.toUpperCase()])} />
      </Field>
      <Out>Nœud d'<b>entrée</b> : branché sur un <b>Training</b> (poids de départ / fine-tuning — la version <b>{ver}{(d.model_size as string) ?? 'n'}</b> fige celle du training) ou une <b>Inference/Éval</b> (modèle à tester).</Out>
    </>
  )
}

// ── explorer ─────────────────────────────────────────────────────────────────────
function VisuConfig({ node, onUpdate, focusToken }: { node: Node; onUpdate: Props['onUpdate']; focusToken?: number }) {
  const d = node.data as Record<string, unknown>
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  const isFree = d.has_input === false
  const [subsets, setSubsets] = useState<{ name: string; image_count: number }[]>([])
  const [loadingSubsets, setLoadingSubsets] = useState(false)
  const [showSubsets, setShowSubsets] = useState(false)
  const [glow, setGlow] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Scan WORKSPACE (fichiers), pas un appel live à Dataset_Explorer_App : fonctionne même
  // app arrêtée, et c'est la MÊME source que la liste déjà affichée sous le nœud
  // (available_subsets, injectée par refreshWorkspaceOutputs) — cohérence garantie.
  async function fetchSubsets() {
    setLoadingSubsets(true)
    try { setSubsets((await graphsAPI.getWorkspaceOutputs()).subsets); setShowSubsets(true) }
    catch { setSubsets([]) }
    finally { setLoadingSubsets(false) }
  }

  // step 7 : même logique que l'Annotation (step 6) — mode FREE = « afficher
  // immédiatement » (fetch au montage, indépendant de full_auto).
  useEffect(() => {
    if (isFree && !showSubsets) { fetchSubsets() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFree])

  // Bouton « Choisir un subset existant » cliqué sur le node lui-même (AppNode.tsx) :
  // s'assure que la liste est visible, la fait défiler dans le champ de vue, puis
  // halo 3s — remplace l'ancienne liste toujours affichée directement sur le node.
  useEffect(() => {
    if (!focusToken) return
    if (!showSubsets) fetchSubsets()
    pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setGlow(true)
    const t = setTimeout(() => setGlow(false), 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken])

  // Dataset source figé si fourni par un nœud amont (dataset_source / explorer / inference).
  const dsLocked = inputTypes(node).some(t => ['dataset_source', 'explorer', 'inference'].includes(t))
  return (
    <>
      <Field label={dsLocked ? 'Dataset source (branché · figé)' : 'Dataset source'}>
        <Input value={d.dataset_name as string ?? ''} onChange={v => onUpdate(node.id, { dataset_name: v })} placeholder="auto depuis nœud source" locked={dsLocked} />
      </Field>

      <div ref={pickerRef} className={`space-y-1 ${glow ? 'bp-focus-glow' : ''}`}>
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-gray-400">Nom du subset (sortie)</label>
          {isFree && (
            <button onClick={fetchSubsets} disabled={loadingSubsets} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50" title="Charger les subsets depuis le workspace">
              <RefreshCw size={10} className={loadingSubsets ? 'animate-spin' : ''} /> Parcourir
            </button>
          )}
        </div>
        <Input value={d.subset_name as string ?? ''} onChange={v => onUpdate(node.id, { subset_name: v })} placeholder="ex: verdure" />
        {/* step 7 : 3 modes bien séparés — Free (liste ci-dessous) / Locked+Auto
            (calculé automatiquement, rien à choisir) / Locked+Manuel (RIEN ici,
            le choix se fait à l'exécution, cf. VisuWaitingChoice SandgraphPage.tsx). */}
        {!isFree && fullAuto && <p className="text-[10px] text-gray-600">Full Auto : calculé automatiquement (requête CLIP), rien à choisir.</p>}
        {isFree && (
          <p className="text-[10px] text-gray-600">Mode FREE : choisissez un subset déjà produit (aucun pipeline ne sera relancé).</p>
        )}
        {isFree && showSubsets && subsets.length > 0 && (
          <div className="mt-1 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-2 py-1 border-b border-gray-700">
              <span className="text-[10px] text-gray-500">Subsets existants</span>
              <button onClick={() => setShowSubsets(false)} className="text-gray-600 hover:text-white"><X size={10} /></button>
            </div>
            <div className="max-h-32 overflow-y-auto">
              {subsets.map(s => (
                <button key={s.name} onClick={() => { onUpdate(node.id, { subset_name: s.name }); setShowSubsets(false) }} className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-gray-700">
                  <span className="text-xs text-white truncate">{s.name}</span>
                  <span className="text-[10px] text-gray-500 shrink-0 ml-1">{s.image_count} img</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {isFree && showSubsets && subsets.length === 0 && <p className="text-[10px] text-gray-600 mt-1">Aucun subset dans le workspace (explorer_&#123;user&#125;/subsets/)</p>}
      </div>

      <ModeToggle node={node} onUpdate={onUpdate} labelAuto="Full Automatique (CLIP)" />
      {fullAuto && (
        <>
          <Field label="Requête sémantique">
            <textarea value={d.query as string ?? ''} onChange={e => onUpdate(node.id, { query: e.target.value })} placeholder="ex: green vegetation trees forest"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-none" rows={2} />
          </Field>
          <NumField node={node} onUpdate={onUpdate} k="top_k" label="top_k" def={50} int />
        </>
      )}
      <Out>Sortie : <b>subset_name</b> « {(d.subset_name as string) || '—'} » → Annotation.</Out>
    </>
  )
}

// ── Annotation ────────────────────────────────────────────────────────────────
function AnnotationConfig({ node, onUpdate, focusToken }: { node: Node; onUpdate: Props['onUpdate']; focusToken?: number }) {
  const d = node.data as Record<string, unknown>
  const classes  = (d.label_classes ?? []) as { name: string; color: string }[]
  const fullAuto = Boolean(d.full_auto)
  const isFree   = d.has_input === false
  const aiModel  = (d.ai_model as string) ?? 'sam3'
  const [exports, setExports] = useState<{ name: string; format: 'yolo' | 'ver'; created_at: string }[]>([])
  const [loadingExports, setLoadingExports] = useState(false)
  const [showExports, setShowExports] = useState(false)
  const [glow, setGlow] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Scan WORKSPACE (fichiers), pas un appel live à Annotation_App : fonctionne même
  // app arrêtée, et c'est la MÊME source que la liste déjà affichée sous le nœud
  // (available_exports, injectée par refreshWorkspaceOutputs).
  async function fetchExports() {
    setLoadingExports(true)
    try { setExports((await graphsAPI.getWorkspaceOutputs()).exports); setShowExports(true) }
    catch { setExports([]) }
    finally { setLoadingExports(false) }
  }

  // step 6 : mode FREE = « afficher immédiatement » la liste + bouton Parcourir,
  // QUELLE QUE SOIT la valeur de full_auto (un node FREE n'exécute de toute façon
  // jamais aucune étape — full_auto n'a pas de sens ici). Charge la liste au
  // montage au lieu d'attendre un clic sur Parcourir.
  useEffect(() => {
    if (isFree && !showExports) { fetchExports() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFree])

  // Bouton « Choisir un export existant » cliqué sur le node lui-même (AppNode.tsx) :
  // s'assure que la liste est visible, la fait défiler dans le champ de vue, puis
  // halo 3s — remplace l'ancienne liste toujours affichée directement sur le node.
  useEffect(() => {
    if (!focusToken) return
    if (!showExports) fetchExports()
    pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setGlow(true)
    const t = setTimeout(() => setGlow(false), 3000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken])

  const verExports  = exports.filter(e => e.format === 'ver')
  const yoloExports = exports.filter(e => e.format === 'yolo')

  // Vérifie automatiquement (débounce) si ce subset a DÉJÀ été importé dans un
  // projet d'annotation existant (nom différent) — même logique que le check de
  // doublon du nœud Dataset Source. Best-effort : [] si Annotation_App ne répond pas.
  // Le projet de CE noeud est exclu du check : sinon un fork (qui reutilise
  // volontairement son propre projet) s'auto-signalait « deja annote » juste
  // apres l'avoir cree.
  const subsetForCheck = (d.subset_name as string) ?? ''
  const projectForCheck = (d.project_name as string) ?? ''
  useEffect(() => {
    if (!subsetForCheck.trim()) { onUpdate(node.id, { duplicate_matches: [] }); return }
    const t = setTimeout(() => {
      graphsAPI.checkAnnotationSource(subsetForCheck.trim(), projectForCheck.trim())
        .then(matches => onUpdate(node.id, { duplicate_matches: matches }))
        .catch(() => {})
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsetForCheck, projectForCheck, node.id])

  const annotationDuplicates = (d.duplicate_matches as { id: number; name: string; frame_count: number; annotated_count: number }[] | undefined) ?? []

  const updateClass = (i: number, f: string, v: string) => onUpdate(node.id, { label_classes: classes.map((c, idx) => idx === i ? { ...c, [f]: v } : c) })
  const addClass = () => onUpdate(node.id, { label_classes: [...classes, { name: 'new_class', color: '#6366f1' }] })
  const removeClass = (i: number) => onUpdate(node.id, { label_classes: classes.filter((_, idx) => idx !== i) })

  return (
    <>
      {/* ── Paramètres de base ── */}
      {(() => {
        const subLocked = inputTypes(node).some(t => ['explorer', 'dataset_source', 'inference'].includes(t))
        const sub = (d.subset_name as string) || ''
        return (<>
          <Field label={subLocked ? 'Subset source (branché · figé)' : 'Subset source'}><Input value={sub} onChange={v => onUpdate(node.id, { subset_name: v })} placeholder="auto depuis explorer" locked={subLocked} /></Field>
          {/* Projet = ce qu'on va ANNOTER (crée/cible le projet dans Annotation_App).
              TOUJOURS éditable, jamais figé — distinct de l'export ci-dessous. */}
          <Field label="Nom du projet (à annoter)"><Input value={d.project_name as string ?? ''} onChange={v => onUpdate(node.id, { project_name: v })} placeholder={sub ? `Annot_${sub}` : 'ex: Annot_IR_sub'} /></Field>
        </>)
      })()}
      {annotationDuplicates.length > 0 && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-2.5 py-2 text-[11px] text-amber-300/80 leading-relaxed">
          ⚠ Ce subset a déjà été annoté dans {annotationDuplicates.length > 1 ? 'ces projets' : 'ce projet'} :{' '}
          {annotationDuplicates.map(p => `${p.name} (#${p.id}, ${p.annotated_count}/${p.frame_count} annotées)`).join(', ')}.
          Est-ce voulu (nouveau jeu de classes) ?
        </div>
      )}
      <Field label="Mode">
        <Select value={(d.annotation_mode as string) ?? 'sequence'} onChange={v => onUpdate(node.id, { annotation_mode: v })}
          options={[['sequence', 'Séquentiel (frame par frame)'], ['random', 'Aléatoire']]} />
      </Field>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField node={node} onUpdate={onUpdate} k="split_train" label="Train" def={0.8} />
        <NumField node={node} onUpdate={onUpdate} k="split_val"   label="Val"   def={0.2} />
        <NumField node={node} onUpdate={onUpdate} k="split_test"  label="Test"  def={0} />
      </div>

      {/* ── Full Auto (après les param de base — step 2) ── */}
      <ModeToggle node={node} onUpdate={onUpdate} labelAuto="Full Automatique (IA)" labelManual="Manuel (annoter dans l'app)" />
      {fullAuto && (
        <div className="bg-gray-800/50 border border-gray-700/60 rounded-lg p-2.5 space-y-2">
          <p className="text-[10px] text-gray-500">Tous les paramètres d'auto-annotation (rien de caché — c'est ce qui est envoyé) :</p>
          <Field label="Modèle IA">
            <Select value={aiModel} onChange={v => onUpdate(node.id, { ai_model: v })} options={[['sam3', 'SAM 3'], ['grounding_dino', 'Grounding DINO']]} />
          </Field>
          <Field label="Prompt texte (open-vocab)"><Input value={d.ai_text as string ?? ''} onChange={v => onUpdate(node.id, { ai_text: v })} placeholder="ex: car. person. tree." /></Field>
          <NumField node={node} onUpdate={onUpdate} k="ai_threshold" label={aiModel === 'grounding_dino' ? 'Seuil box (box_threshold)' : 'Seuil de confiance'} def={0.2} />
          <p className="text-[10px] text-gray-600">Le prompt définit les classes détectées. Le seuil = score min des boîtes (backend : <span className="font-mono">box_threshold</span>).</p>
          <Toggle node={node} onUpdate={onUpdate} field="review_before_export"
            label="Valider les annotations avant export (Continuer)" />
          <p className="text-[10px] text-gray-600">Ajoute un point d'arrêt après l'annotation auto : la chaîne attend votre « Continuer » pour exporter.</p>
        </div>
      )}

      {/* ── Export (sortie) — DISTINCT du projet ci-dessus. step 6 : 3 modes bien
          séparés (Locked+Auto masque tout ; Locked+Manuel n'affiche RIEN ici — le
          choix se fait à l'étape d'exécution, cf. AnnotationWaitingChoice dans
          SandgraphPage.tsx ; Free affiche immédiatement liste + Parcourir). */}
      {isFree ? (
        <div ref={pickerRef} className={`space-y-1.5 ${glow ? 'bp-focus-glow' : ''}`}>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-gray-400">Export à utiliser (aval)</label>
            <button onClick={fetchExports} disabled={loadingExports} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50" title="Parcourir les exports existants du workspace">
              <RefreshCw size={10} className={loadingExports ? 'animate-spin' : ''} /> Parcourir
            </button>
          </div>
          <p className="text-[10px] text-gray-600">Mode FREE : choisissez un export déjà produit (aucun pipeline ne sera relancé).</p>
          {d.export_name ? <p className="text-[10px]">actuel : <span className="text-emerald-400 font-mono">{d.export_name as string}</span></p> : null}
          {showExports && (
            <div className="space-y-1.5">
              <ExportBlock title=".ver (→ Inference/Éval)" color="teal" items={verExports} current={d.export_name as string} onPick={n => { onUpdate(node.id, { export_name: n }); setShowExports(false) }} />
              <ExportBlock title="YOLO (→ Training/Optuna)" color="rose" items={yoloExports} current={d.export_name as string} onPick={n => { onUpdate(node.id, { export_name: n }); setShowExports(false) }} />
              {exports.length === 0 && <p className="text-[10px] text-gray-600">Aucun export dans le workspace (annotation_&#123;user&#125;/exports/)</p>}
            </div>
          )}
        </div>
      ) : fullAuto ? (
        <div className="bg-gray-800/30 border border-gray-800 rounded-lg px-2.5 py-2 text-[10px] text-gray-500 leading-relaxed">
          Export <b>automatique</b> après l'annotation IA — pas de choix ici : le dataset
          YOLO <span className="font-mono">{((d.project_name as string) || (d.subset_name as string) || 'projet')}-yolo</span> se
          crée tout seul.
        </div>
      ) : null /* LOCKED + MANUEL : rien ici — choix à faire pendant l'exécution */}

      {/* ── Classes ── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-medium text-gray-400">Classes (labels)</span>
          <button onClick={addClass} className="text-indigo-400 hover:text-indigo-300"><Plus size={13} /></button>
        </div>
        <div className="space-y-1.5">
          {classes.map((lc, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input type="color" value={lc.color} onChange={e => updateClass(i, 'color', e.target.value)} className="w-6 h-6 rounded cursor-pointer border border-gray-700 bg-transparent p-0" />
              <input value={lc.name} onChange={e => updateClass(i, 'name', e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none" />
              <button onClick={() => removeClass(i)} className="text-gray-600 hover:text-red-400"><X size={11} /></button>
            </div>
          ))}
        </div>
      </div>
      <Out>Deux sorties distinctes : <b className="text-rose-300">dataset YOLO</b> (data.yaml, 3 splits) → Training/Optuna ; <b className="text-teal-300">.ver</b> (GT natif) → Inference/Éval. DVC verse le dossier YOLO tel quel.</Out>
    </>
  )
}

// Bloc d'exports d'un FORMAT donné (Parcourir Annotation, step 2) — .ver et YOLO
// affichés séparément pour que le choix corresponde clairement au port de sortie visé.
function ExportBlock({ title, color, items, current, onPick }: {
  title: string; color: 'teal' | 'rose'
  items: { name: string; created_at: string }[]; current?: string; onPick: (name: string) => void
}) {
  const ring = color === 'teal' ? 'border-teal-800/40 bg-teal-950/10' : 'border-rose-800/40 bg-rose-950/10'
  const dot  = color === 'teal' ? 'bg-teal-400' : 'bg-rose-400'
  return (
    <div className={`border rounded-lg overflow-hidden ${ring}`}>
      <p className="text-[10px] text-gray-500 px-2 py-1 border-b border-gray-800/60">{title} ({items.length})</p>
      {items.length === 0
        ? <p className="text-[10px] text-gray-600 italic px-2 py-1.5">aucun</p>
        : (
          <div className="max-h-24 overflow-y-auto">
            {items.map(it => (
              <button key={it.name} onClick={() => onPick(it.name)} className={`w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-gray-700/60 ${it.name === current ? 'bg-gray-700/40' : ''}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <span className="flex-1 text-xs text-white truncate">{it.name}</span>
                <span className="text-[10px] text-gray-500 shrink-0">{it.created_at ? new Date(it.created_at).toLocaleDateString('fr') : ''}</span>
              </button>
            ))}
          </div>
        )}
    </div>
  )
}

// ── DVC — step6 : OBSERVATEUR + HUB (récup / download / commit à la demande) ──────
interface DvcArtifact {
  kind: string; label: string; present: boolean
  path?: string; exists?: boolean; download?: string | null; size_mb?: number; value?: unknown
  state?: 'planned' | 'produced' | 'failed'
  error?: string | null
}
function DVCConfig({ node, onUpdate, appUrls, graphId }: {
  node: Node; onUpdate: Props['onUpdate']; appUrls: Record<string, string>; graphId?: string | null
}) {
  const d = node.data as Record<string, unknown>
  const [arts, setArts] = useState<DvcArtifact[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [committing, setCommitting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [runCtx, setRunCtx] = useState<{ run_id?: string; status?: string } | null>(null)
  // Etat de version du DERNIER run (lu depuis run_lineage) : le node DVC doit dire
  // clairement si le run est versionne ou non, avec le commit et le dataset.
  const [ver, setVer] = useState<{ run_id?: string; git_commit?: string; dataset?: string; committed_at?: string } | null>(null)
  const url = appUrls['dvc-app']

  const load = async () => {
    if (!graphId) return
    setLoading(true)
    try {
      const g = await fetch(`/api/graphs/${graphId}`).then(r => r.json()) as {
        active_run_id?: string
        status?: string
        run_history?: { run_id: string; status: string }[]
        run_lineage?: Record<string, { git_commit?: string; dataset?: string; committed_at?: string }>
      }
      const latest = g.run_history?.[0]
      const completed = latest && ['done', 'success'].includes(latest.status) ? latest : undefined
      const rid = completed?.run_id
      setRunCtx(rid ? completed : { status: g.active_run_id ? 'running' : 'not_started' })
      const suffix = rid ? `?run_id=${encodeURIComponent(rid)}` : ''
      const j = await fetch(`/api/graphs/${graphId}/artifacts${suffix}`).then(r => r.json()) as { artifacts?: DvcArtifact[] }
      const a = j.artifacts ?? []
      setArts(a)
      const s: Record<string, boolean> = {}
      a.forEach(x => { if (rid && x.present && x.exists === true) s[x.kind] = true })
      setSel(s)
      const lin = rid ? g.run_lineage?.[rid] : undefined
      setVer(lin?.committed_at ? { run_id: rid, ...lin } : null)
    } catch {
      setArts([]); setSel({}); setVer(null); setRunCtx(null)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [graphId, node.id])

  const commit = () => {
    if (!graphId || !runCtx?.run_id) return
    const kinds = Object.keys(sel).filter(k => sel[k])
    setCommitting(true); setMsg(null)
    fetch(`/api/graphs/${graphId}/dvc-commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: runCtx.run_id, kinds, message: (d.commit_message as string) || 'feat: version artifacts' }),
    }).then(r => r.json())
      .then(j => {
        setMsg(j.ok ? `✓ ${j.message || 'commité dans DVC'}` : `✗ ${j.error || 'échec commit'}`)
        // Eteint le halo du node DVC cote Sandgraph (il relit run_lineage).
        if (j.ok) window.dispatchEvent(new CustomEvent('orch:dvc-committed'))
        load()
      })
      .catch(e => setMsg('✗ ' + e.message)).finally(() => setCommitting(false))
  }

  return (
    <>
      <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-2.5 py-2 text-[11px] text-amber-300/80 leading-relaxed space-y-1.5">
        <p><b>Versioning manuel, à la demande.</b> Rien n'est versionné automatiquement au lancement
          du graphe : tant que vous ne cliquez pas, ce run n'est <b>pas</b> tracé.</p>
        <p className="text-amber-200/70">« Créer une version » fait exactement 3 choses :</p>
        <ul className="text-[10px] text-amber-200/60 space-y-0.5 pl-1">
          <li><b>1. Git</b> — un commit du snapshot (fichiers <span className="font-mono">.dvc</span> + graphe) avec les métadonnées du run (Run-Id, dataset, mAP50).</li>
          <li><b>2. Cache DVC</b> — le contenu réel des artefacts cochés (dataset / modèle) est enregistré dans DVC.</li>
          <li><b>3. Remote</b> — poussé vers le stockage distant <b>si</b> un remote est configuré (sinon local uniquement).</li>
        </ul>
      </div>

      {!runCtx?.run_id && !loading && (
        <div className="rounded-lg px-2.5 py-2 border border-blue-800/40 bg-blue-950/20 text-[11px] text-blue-300">
          {runCtx?.status === 'running'
            ? 'Pipeline en cours — les artefacts seront proposés après sa réussite.'
            : 'Lancez le pipeline pour produire les artefacts de ce run.'}
        </div>
      )}

      {/* Etat de version du run courant : honnete, pas de "vert" par defaut. */}
      <div className={`rounded-lg px-2.5 py-2 border text-[11px] ${
        ver ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300' : 'bg-gray-800/40 border-gray-700/50 text-gray-400'
      }`}>
        {ver ? (
          <>
            <div className="flex items-center gap-1.5 font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Versionné</div>
            <p className="text-[10px] mt-1 text-emerald-200/70">
              commit <span className="font-mono">{(ver.git_commit || '').slice(0, 8) || '—'}</span>
              {ver.dataset ? <> · dataset <span className="font-mono">{ver.dataset}</span></> : null}
              {ver.committed_at ? <> · {new Date(ver.committed_at).toLocaleString('fr')}</> : null}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> Non versionné — aucun commit DVC pour ce run</div>
        )}
      </div>

      <Field label="Message de commit"><Input value={d.commit_message as string ?? ''} onChange={v => onUpdate(node.id, { commit_message: v })} placeholder="feat: dataset + modèle v1" /></Field>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-gray-400">Artefacts du graphe</p>
        <button onClick={load} className="text-[10px] text-gray-400 hover:text-white underline">rafraîchir</button>
      </div>
      {!graphId && <p className="text-[10px] text-gray-500 italic">graphe non sauvegardé</p>}
      {loading && <p className="text-[10px] text-gray-500 italic">chargement…</p>}
      {arts && arts.map(a => (
        <div key={a.kind} className={`rounded-md px-2 py-1.5 border ${a.present ? 'bg-gray-800/40 border-gray-700/50' : 'bg-gray-900/40 border-gray-800 opacity-60'}`}>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" disabled={!a.present || a.exists === false} checked={!!sel[a.kind]}
              onChange={e => setSel(s => ({ ...s, [a.kind]: e.target.checked }))} className="accent-amber-500" />
            <span className="text-[11px] text-gray-300 font-medium flex-1">{a.label}</span>
            {a.size_mb != null && <span className="text-[9px] text-gray-500">{a.size_mb} Mo</span>}
          </label>
          {a.path && <p className="text-[9px] text-gray-500 truncate mt-0.5 ml-5" title={a.path}>{a.path}</p>}
          {a.value != null && (
            <pre className="text-[9px] text-emerald-300/80 ml-5 mt-0.5 whitespace-pre-wrap break-all max-h-16 overflow-auto">
              {typeof a.value === 'object' ? JSON.stringify(a.value, null, 1) : String(a.value)}
            </pre>
          )}
          {a.error && <div className="ml-5 mt-1 rounded border border-red-800/50 bg-red-950/30 px-2 py-1 text-[9px] font-semibold text-red-300">{a.error}</div>}
          <div className="ml-5 mt-0.5 flex items-center gap-2">
            {a.download && <a href={a.download} download className="text-[9px] text-cyan-400 hover:text-cyan-200 underline">télécharger</a>}
            {a.present && a.exists === false && !a.error && <span className="text-[9px] text-orange-400/80 italic">pas encore produit — lancez le pipeline</span>}
          </div>
        </div>
      ))}
      {/* Deja versionne = plus rien a faire pour CE run : le bouton est ferme
          (une seconde version du meme run ne produirait qu'un commit vide). */}
      <button onClick={commit} disabled={committing || !graphId || !runCtx?.run_id || !!ver || !Object.values(sel).some(Boolean)}
        title={ver
          ? 'Ce run est déjà versionné — relancez le pipeline pour produire un nouveau run à versionner.'
          : 'Crée un commit Git du snapshot + enregistre le contenu des artefacts cochés dans DVC (et le pousse si un remote est configuré).'}
        className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg disabled:opacity-50">
        {committing ? 'Création de la version en cours…'
          : ver ? 'Run déjà versionné'
          : 'Créer une version DVC (Git + cache DVC)'}
      </button>
      {msg && <p className={`text-[10px] ${msg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{msg}</p>}
      {url && runCtx?.run_id
        ? <AppLink url={`${url.replace(/\/$/, '')}/lineage?run_id=${encodeURIComponent(runCtx.run_id)}`} label="Ouvrir ce run dans DVC App" />
        : <p className="text-[10px] text-gray-600 italic">Lancez d'abord le pipeline pour ouvrir son espace DVC.</p>}
    </>
  )
}

// ── Training ──────────────────────────────────────────────────────────────────
const TRAIN_HP: [string, string, number, boolean?][] = [
  ['patience', 'Patience', 50, true], ['workers', 'Workers', 8, true],
  ['lr0', 'LR initial', 0.01], ['lrf', 'LR final', 0.01],
  ['momentum', 'Momentum', 0.937], ['weight_decay', 'Weight decay', 0.0005],
  ['warmup_epochs', 'Warmup epochs', 3], ['warmup_momentum', 'Warmup momentum', 0.8], ['warmup_bias_lr', 'Warmup bias lr', 0.1],
  ['box', 'Box loss', 7.5], ['cls', 'Cls loss', 0.5], ['dfl', 'DFL loss', 1.5],
  ['hsv_h', 'HSV-H', 0.015], ['hsv_s', 'HSV-S', 0.7], ['hsv_v', 'HSV-V', 0.4],
  ['degrees', 'Degrees', 0], ['translate', 'Translate', 0.1], ['scale', 'Scale', 0.5],
  ['flipud', 'Flip UD', 0], ['fliplr', 'Flip LR', 0.5],
  ['mosaic', 'Mosaic', 1.0], ['mixup', 'Mixup', 0], ['copy_paste', 'Copy-paste', 0],
]

function TrainingConfig({ node, onUpdate, appUrls }: { node: Node; onUpdate: Props['onUpdate']; appUrls: Record<string, string> }) {
  const d = node.data as Record<string, unknown>
  const url = appUrls['Training_App']
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  const [showHP, setShowHP] = useState(false)

  const VERSIONS = ['yolov8', 'yolov9', 'yolov10', 'yolo11']
  const SIZES: Record<string, string[]> = {
    yolov8: ['n', 's', 'm', 'l', 'x'], yolov9: ['t', 's', 'm', 'c', 'e'],
    yolov10: ['n', 's', 'm', 'b', 'l', 'x'], yolo11: ['n', 's', 'm', 'l', 'x'],
  }
  const ver = (d.yolo_version as string) ?? 'yolov8'
  const sizes = SIZES[ver] ?? ['n', 's', 'm', 'l', 'x']
  const verLocked = inputTypes(node).includes('model')   // modèle branché -> archi figée
  // step 5 : branché à Optuna (port "hpo") -> les hyperparamètres seront
  // REMPLACÉS par les best params à l'exécution (graph_runner fusionne
  // optuna_best APRÈS les hyperparams saisis ici) -> figés pour que ce soit
  // clair, pas juste cosmétique.
  const hpoLinked = inputTypes(node).includes('optuna')

  return (
    <>
      {/* ── Paramètres de base ── */}
      <Field label="Nom du run / modèle (sortie)">
        <Input value={(d.run_label as string) ?? ''} onChange={v => onUpdate(node.id, { run_label: v })} placeholder={`${ver}${(d.model_size as string) ?? 'n'}`} />
      </Field>
      <Field label={verLocked ? 'Version YOLO (figée par le modèle)' : 'Version YOLO'}>
        <Select value={ver} onChange={v => onUpdate(node.id, { yolo_version: v, model_size: (SIZES[v] ?? ['n'])[0] })} options={VERSIONS.map(v => [v, v])} locked={verLocked} />
      </Field>
      <Field label="Taille">
        <div className="flex gap-1 flex-wrap">
          {sizes.map(s => (
            <button key={s} disabled={verLocked} onClick={() => onUpdate(node.id, { model_size: s })}
              className={`px-2 py-1 rounded text-xs font-mono border transition-colors ${(d.model_size as string) === s ? 'bg-blue-900/50 border-blue-500/60 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'} ${verLocked ? 'opacity-50 cursor-not-allowed' : ''}`}>
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField node={node} onUpdate={onUpdate} k="epochs" label="Epochs" def={100} int />
        <NumField node={node} onUpdate={onUpdate} k="batch"  label="Batch"  def={16} int />
        <NumField node={node} onUpdate={onUpdate} k="imgsz"  label="Imgsz"  def={640} int />
      </div>
      <Field label="Device"><Input value={(d.device as string) ?? ''} onChange={v => onUpdate(node.id, { device: v })} placeholder="auto / cpu / 0" /></Field>

      {/* ── Full Auto (après les param de base) + tous les paramètres ── */}
      <ModeToggle node={node} onUpdate={onUpdate} labelAuto="Full Automatique (REST)" labelManual="Manuel (lancer dans l'app)" />

      {hpoLinked && (
        <div className="bg-cyan-950/30 border border-cyan-800/40 rounded-lg px-2.5 py-2 text-[11px] text-cyan-300/80 leading-relaxed">
          ⚠ Branché à <b>Optuna</b> : les hyperparamètres ci-dessous seront <b>remplacés par les best
          params</b> trouvés par l'étude au lancement — figés ici pour éviter toute confusion.
        </div>
      )}

      {fullAuto ? (
        <>
          <button onClick={() => setShowHP(h => !h)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 w-full">
            <ChevronDown size={11} className={showHP ? 'rotate-180' : ''} /> Tous les hyperparamètres ({TRAIN_HP.length}){hpoLinked ? ' — figés (Optuna)' : ''}
          </button>
          {showHP && (
            <div className="space-y-1.5 pl-1 border-l border-gray-800">
              <p className="text-[10px] text-gray-600">Rien de magique : ces valeurs sont exactement ce qui est envoyé à Ultralytics.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {TRAIN_HP.map(([k, label, def, int]) => (
                  <NumField key={k} node={node} onUpdate={onUpdate} k={k} label={label} def={def} int={int} locked={hpoLinked} />
                ))}
              </div>
            </div>
          )}
          <Out>Sortie : <b>best.pt</b> (dans le run « {(d.run_label as string) || `${ver}${(d.model_size as string) ?? 'n'}`} ») → Inference/Éval, DVC.</Out>
        </>
      ) : (
        <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg px-2.5 py-2 text-[11px] text-amber-300/80 leading-relaxed">
          Mode Manuel : ouvrez Training App, lancez l'entraînement, puis revenez et cliquez <strong>Terminé → Continuer</strong>.
        </div>
      )}
      {url && <AppLink url={url} label="Ouvrir Training App" />}
    </>
  )
}

// ── step4-C : config.yaml COMPLET d'Inference_App ────────────────────────────
// Prérempli depuis le template (lu sur disque par l'orchestrator, app éteinte OK),
// TOUS les champs groupés + éditables → node.data.full_config. Les champs fournis
// par un branchement (modèle / séquence / GT) sont VERROUILLÉS (override).
interface InfCfg {
  available: boolean
  defaults: Record<string, unknown>
  groups: { title: string; keys: string[] }[]
  enums: Record<string, (string | number)[]>
  branched_keys: string[]
}
let _infCfgCache: InfCfg | null = null

function _branchedValue(k: string, d: Record<string, unknown>): string {
  if (k === 'weights_yolo')    return (d.model_path as string) || '(best.pt du training amont)'
  if (k === 'sequence_dir')    return (d.sequence_dir as string) || '(séquence branchée)'
  if (k === 'annotation_file') return (d.annotation_file as string) || '(GT branché)'
  return ''
}

// Champ JSON (dict/list) avec état local — commit au blur (évite le parse à chaque frappe).
function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [txt, setTxt] = useState(() => JSON.stringify(value))
  const [err, setErr] = useState(false)
  useEffect(() => { setTxt(JSON.stringify(value)) }, [value])
  return (
    <Field label={label}>
      <textarea value={txt} rows={2}
        onChange={e => { setTxt(e.target.value); try { JSON.parse(e.target.value); setErr(false) } catch { setErr(true) } }}
        onBlur={() => { try { onChange(JSON.parse(txt)) } catch { /* garde l'ancienne valeur */ } }}
        className={`w-full bg-gray-800 border rounded-lg px-2 py-1 text-[10px] text-white font-mono resize-none focus:outline-none ${err ? 'border-red-600' : 'border-gray-700 focus:border-cyan-500'}`} />
    </Field>
  )
}

function InfRow({ k, cfg, full, d, onChange, onReset }: {
  k: string; cfg: InfCfg; full: Record<string, unknown>; d: Record<string, unknown>
  onChange: (v: unknown) => void; onReset: () => void
}) {
  const def = cfg.defaults[k]
  const isSet = k in full
  const value = isSet ? full[k] : def
  const enums = cfg.enums[k]
  const tag = isSet ? <button onClick={onReset} title="revenir au template" className="text-cyan-400 hover:text-white">•</button> : null
  const lbl = <span className="flex items-center gap-1">{k}{tag}</span>

  // Champ fourni par un branchement → verrouillé (override)
  if (cfg.branched_keys.includes(k)) {
    return (
      <Field label={k}>
        <div className="flex items-center gap-1">
          <input disabled value={_branchedValue(k, d)}
            className="flex-1 bg-gray-900 border border-amber-800/40 rounded-lg px-2 py-1 text-[10px] text-amber-300/70 cursor-not-allowed truncate" />
          <span className="text-[8px] px-1 py-0.5 rounded bg-amber-900/40 text-amber-300 border border-amber-700/30 shrink-0">branché</span>
        </div>
      </Field>
    )
  }
  if (typeof def === 'boolean') {
    return (
      <label className="flex items-center justify-between text-[11px] text-gray-300 py-0.5 cursor-pointer">
        {lbl}
        <input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} className="accent-cyan-500" />
      </label>
    )
  }
  if (enums) {
    const isNum = typeof def === 'number'
    return <Field label={lbl as unknown as string}>
      <Select value={String(value ?? '')} onChange={v => onChange(isNum ? Number(v) : v)}
        options={enums.map(e => [String(e), String(e) === '' ? '(vide)' : String(e)] as [string, string])} />
    </Field>
  }
  if (typeof def === 'number') {
    return <Field label={lbl as unknown as string}>
      <input type="number" value={value as number}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-cyan-500" />
    </Field>
  }
  if (def !== null && typeof def === 'object') {
    return <JsonField label={`${k} (json)`} value={value} onChange={onChange} />
  }
  return <Field label={lbl as unknown as string}><Input value={String(value ?? '')} onChange={v => onChange(v)} /></Field>
}

function FullYamlConfig({ node, onUpdate }: { node: Node; onUpdate: Props['onUpdate'] }) {
  const d = node.data as Record<string, unknown>
  const [cfg, setCfg] = useState<InfCfg | null>(_infCfgCache)
  const [open, setOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (_infCfgCache) return
    fetch('/api/graphs/meta/inference-config').then(r => r.json())
      .then((j: InfCfg) => { _infCfgCache = j; setCfg(j) }).catch(() => {})
  }, [])
  const full = (d.full_config as Record<string, unknown>) ?? {}
  const nMod = Object.keys(full).length
  const setKey = (k: string, v: unknown) => onUpdate(node.id, { full_config: { ...full, [k]: v } })
  const resetKey = (k: string) => { const f = { ...full }; delete f[k]; onUpdate(node.id, { full_config: f }) }

  return (
    <>
      <button onClick={() => setOpen(s => !s)} className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-200 w-full mt-1 font-medium">
        <ChevronDown size={11} className={open ? 'rotate-180' : ''} /> config.yaml complet (tous les params, prérempli)
        {nMod > 0 && <span className="ml-auto text-[9px] px-1 rounded bg-cyan-900/50 text-cyan-300">{nMod} modifié{nMod > 1 ? 's' : ''}</span>}
      </button>
      {open && (
        <div className="space-y-1 pl-1 border-l border-cyan-900/40">
          {!cfg && <p className="text-[10px] text-gray-500 italic">chargement…</p>}
          {cfg && !cfg.available && <p className="text-[10px] text-orange-400 italic">config.yaml introuvable côté Inference_App</p>}
          {cfg?.available && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-gray-500 leading-tight">Prérempli du template ; seuls les champs <span className="text-cyan-400">modifiés •</span> sont envoyés (override). Branchés = verrouillés.</p>
                {nMod > 0 && <button onClick={() => onUpdate(node.id, { full_config: {} })} className="text-[10px] text-gray-400 hover:text-white underline shrink-0">tout réinit</button>}
              </div>
              {cfg.groups.map(g => {
                const go = openGroups[g.title] ?? false
                const nModGroup = g.keys.filter(k => k in full).length
                return (
                  <div key={g.title}>
                    <button onClick={() => setOpenGroups(s => ({ ...s, [g.title]: !go }))} className="flex items-center gap-1 text-[10px] text-gray-300 hover:text-white w-full mt-0.5 font-medium">
                      <ChevronDown size={10} className={go ? 'rotate-180' : ''} /> {g.title}
                      {nModGroup > 0 && <span className="text-cyan-400">({nModGroup})</span>}
                    </button>
                    {go && (
                      <div className="space-y-0.5 pl-1.5 border-l border-gray-800/60 mt-0.5">
                        {g.keys.map(k => (
                          <InfRow key={k} k={k} cfg={cfg} full={full} d={d}
                            onChange={v => setKey(k, v)} onReset={() => resetKey(k)} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </>
  )
}

// ── Inference / Eval (steps 1-2) ──────────────────────────────────────────────
// LOCKED : 2 tâches — Détection (YOLO) et Tracking (unifié). Auto = headless avec
// options (params yaml par catégorie) ; Manuel = ouvre l'app (SOT/MOT dans l'app).
// FREE : acquisition (recording) -> dataset d'images.
function InferenceConfig({ node, onUpdate, appUrls }: { node: Node; onUpdate: Props['onUpdate']; appUrls: Record<string, string> }) {
  const d = node.data as Record<string, unknown>
  const url = appUrls['Inference_App']
  const isFree = d.has_input === false   // FREE = acquisition ; LOCKED = eval/inference
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  const task = (d.task as string) ?? 'tracking'
  const its = inputTypes(node)
  const handles = inputHandles(node)
  const modelLocked = its.includes('model') || its.includes('training')
  // step 5 : "dataset YOLO" (GT incluse) est EXCLUSIF avec "dataset" (images
  // seules) — les deux fournissent déjà la séquence, donc le champ séquence est
  // figé dès que L'UN OU L'AUTRE est branché.
  const datasetYoloLinked = handles.includes('dataset_yolo')
  const seqLocked = handles.includes('sequence') || datasetYoloLinked
  // Annotation branchée directement sur Inference (port « dataset YOLO ») : l'export
  // YOLO contient train/val/test — on choisit LEQUEL alimente séquence+GT (le
  // Training, lui, consomme le data.yaml complet, pas de split à choisir).
  const gtLinked = its.includes('annotation')
  // step 5 : ".ver (GT)" n'a de sens que branché AVEC "dataset" (images) — sans
  // ça, pas d'images à évaluer contre ce GT. Avertit sans bloquer (le node reste
  // sauvegardable — validateGraph, côté SandgraphPage, ne fait qu'un warning ici
  // aussi, cf. requiresPeer sur le port `gt`).
  const gtWithoutDataset = handles.includes('gt') && !handles.includes('sequence') && !datasetYoloLinked
  const [advRender, setAdvRender] = useState(false)
  const [advSys, setAdvSys] = useState(false)
  const [advRaw, setAdvRaw] = useState(false)

  if (isFree) {
    // ── FREE = acquisition (recording -> dataset d'images) ──
    return (
      <>
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg px-2.5 py-2 text-[11px] text-emerald-300/80">
          Mode <b>FREE</b> = acquisition (recording auto) : capture un flux → dataset d'images à annoter.
        </div>
        <Field label="Source (flux / fichier)">
          <PathInput value={(d.sequence_dir as string) ?? ''} onChange={v => onUpdate(node.id, { sequence_dir: v })} placeholder="http://host/stream · tcp://host · .optional · dossier · vidéo" />
        </Field>
        <Field label="Nom du dataset (sortie)"><Input value={(d.acq_name as string) ?? ''} onChange={v => onUpdate(node.id, { acq_name: v })} placeholder="capture_terrain" /></Field>
        <div className="grid grid-cols-2 gap-1.5">
          <NumField node={node} onUpdate={onUpdate} k="max_frames" label="Max frames" def={200} int />
          <NumField node={node} onUpdate={onUpdate} k="every" label="1 frame / N" def={1} int />
        </div>
        <Field label="Format image (saving)">
          <Select value={(d.frame_ext as string) ?? 'png'} onChange={v => onUpdate(node.id, { frame_ext: v })}
            options={[['png', 'PNG (brut, sans perte)'], ['jpg', 'JPG (compressé, bande passante)']]} />
        </Field>
        <Field label="Nom caméra (métadonnée)"><Input value={(d.camera_name as string) ?? ''} onChange={v => onUpdate(node.id, { camera_name: v })} placeholder="cam1" /></Field>
        <Out>Sortie : dataset <b>{(d.acq_name as string) || 'acquisition'}</b> (images 8-bit) → Dataset Explorer / Annotation.</Out>
        {url && <AppLink url={url} label="Ouvrir Inference App" />}
      </>
    )
  }

  // ── LOCKED ──
  return (
    <>
      <ModeToggle node={node} onUpdate={onUpdate} labelAuto="Auto (headless)" labelManual="Manuel (interactif)" />

      {/* step 5 : GT branché sans dataset — n'a pas de sens seul, warning non bloquant. */}
      {gtWithoutDataset && (
        <div className="bg-orange-950/30 border border-orange-800/40 rounded-lg px-2.5 py-2 text-[11px] text-orange-300/80 leading-relaxed">
          ⚠ « GT (.ver) » est branché mais aucun <b>dataset</b> (images) ne l'est — branchez aussi
          un dataset (ou un dataset YOLO) pour que ce GT serve à quelque chose.
        </div>
      )}

      {!fullAuto ? (
        <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg px-2.5 py-2 text-[11px] text-amber-300/80 leading-relaxed">
          Mode <b>Manuel</b> (interactif) : ouvrez l'Inference App, lancez la session et faites le
          <b> SOT/MOT en direct</b> (clic gauche = cible 1, droit = cible 2). Aucune option ici — tout se
          pilote dans l'app. Puis revenez et cliquez <strong>Continuer</strong>.
        </div>
      ) : (
        <>
          <Field label="Tâche">
            <Select value={task} onChange={v => onUpdate(node.id, { task: v })}
              options={[['tracking', 'Tracking (tracker)'], ['detection', 'Détection (YOLO only)']]} />
          </Field>
          <Field label={modelLocked ? 'Modèle (branché · figé)' : 'Modèle (best.pt)'}>
            <PathInput value={(d.model_path as string) ?? ''} onChange={v => onUpdate(node.id, { model_path: v })} placeholder="(vide = best.pt du training amont)" locked={modelLocked} />
          </Field>

          {task === 'detection' && (
            <>
              <Field label={seqLocked ? 'Séquence (branchée · figée)' : 'Séquence (source)'}><PathInput value={(d.sequence_dir as string) ?? ''} onChange={v => onUpdate(node.id, { sequence_dir: v })} placeholder={gtLinked ? '(vide = images du split Annotation ci-dessous)' : 'tcp / mjpeg / .optional / dossier png / .mp4'} locked={seqLocked} /></Field>
              {gtLinked && (
                <Field label="Split Annotation (train/val/test)">
                  <Select value={(d.gt_split as string) ?? 'val'} onChange={v => onUpdate(node.id, { gt_split: v })}
                    options={[['train', 'Train'], ['val', 'Val'], ['test', 'Test']]} />
                </Field>
              )}
              <Field label={gtLinked ? 'GT (dossier .txt YOLO / .ver — vide = split ci-dessus)' : 'GT (dossier .txt YOLO / .ver)'}><Input value={(d.annotation_file as string) ?? ''} onChange={v => onUpdate(node.id, { annotation_file: v })} placeholder={gtLinked ? "(vide = labels/ du split Annotation)" : "(pas de data.yaml — réservé au Training)"} /></Field>
              <div className="grid grid-cols-3 gap-1.5">
                <NumField node={node} onUpdate={onUpdate} k="conf_thresh" label="conf" def={0.3} />
                <NumField node={node} onUpdate={onUpdate} k="iou_thresh"  label="iou"  def={0.45} />
                <NumField node={node} onUpdate={onUpdate} k="img_size"    label="imgsz" def={640} int />
              </div>
              <Out>Détection YOLO par frame vs GT → <b>précision / rappel / tp-fp-fn</b> → MLflow.</Out>
            </>
          )}

          {task === 'tracking' && (
            <>
              <Field label={seqLocked ? 'Séquence (branchée · figée)' : 'Séquence (source)'}><PathInput value={(d.sequence_dir as string) ?? ''} onChange={v => onUpdate(node.id, { sequence_dir: v })} placeholder={gtLinked ? '(vide = images du split Annotation ci-dessous)' : '.optional / dossier / vidéo / flux'} locked={seqLocked} /></Field>
              {gtLinked && (
                <Field label="Split Annotation (train/val/test)">
                  <Select value={(d.gt_split as string) ?? 'val'} onChange={v => onUpdate(node.id, { gt_split: v })}
                    options={[['train', 'Train'], ['val', 'Val'], ['test', 'Test']]} />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Tracker MOT"><Select value={(d.tracker_mot as string) ?? 'botsort'} onChange={v => onUpdate(node.id, { tracker_mot: v })}
                  options={[['custom_kalman', 'Kalman'], ['bytetrack', 'ByteTrack'], ['botsort', 'BoT-SORT'], ['boosttrack', 'BoostTrack'], ['none', 'Aucun (SOT)']]} /></Field>
                <Field label="Tracker SOT"><Select value={(d.tracker_sot as string) ?? 'tracking_tophat'} onChange={v => onUpdate(node.id, { tracker_sot: v })}
                  options={[['dummy', 'Dummy'], ['csrt', 'CSRT'], ['tracking_tophat', 'Tracking_TOPHAT'], ['dimp', 'DiMP'], ['ostrack', 'OSTrack'], ['sam2', 'SAM2']]} /></Field>
              </div>
              <Field label="Fichier commandes (cmd_send)">
                <Input value={(d.cmd_file as string) ?? ''} onChange={v => onUpdate(node.id, { cmd_file: v })} placeholder="vide = MOT seul · rempli = test SOT+MOT (rejeu)" />
              </Field>
              <div className="grid grid-cols-2 gap-1.5">
                <NumField node={node} onUpdate={onUpdate} k="n_targets" label="Nb cibles SOT" def={1} int />
              </div>
              <Field label={gtLinked ? 'GT (.ver / annotations — vide = split ci-dessus)' : 'GT (.ver / annotations)'}><Input value={(d.annotation_file as string) ?? ''} onChange={v => onUpdate(node.id, { annotation_file: v })} placeholder={gtLinked ? '(vide = labels/ du split Annotation)' : '(pour MOTA/IDF1)'} /></Field>
              <Toggle node={node} onUpdate={onUpdate} field="compute_metrics" label="Calculer les métriques (si GT)" />
              <Out>Sortie : vidéo annotée + benchmark {(d.cmd_file as string) ? '(SOT+MOT)' : '(MOT)'} → MLflow.</Out>
            </>
          )}

          {/* ── Paramètres avancés yaml, par catégorie ── */}
          <button onClick={() => setAdvRender(s => !s)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 w-full mt-1">
            <ChevronDown size={11} className={advRender ? 'rotate-180' : ''} /> Rendu & sauvegarde
          </button>
          {advRender && (
            <div className="space-y-1 pl-1 border-l border-gray-800">
              <Toggle node={node} onUpdate={onUpdate} field="light_render" label="Render light (rapide, défaut)" def />
              <Toggle node={node} onUpdate={onUpdate} field="save_video" label="Sauver la vidéo (MP4)" def />
              <Toggle node={node} onUpdate={onUpdate} field="save_frames" label="Sauver les frames" />
              <Field label="Format frames"><Select value={(d.frame_ext as string) ?? 'png'} onChange={v => onUpdate(node.id, { frame_ext: v })} options={[['png', 'PNG'], ['jpg', 'JPG']]} /></Field>
              <NumField node={node} onUpdate={onUpdate} k="trail" label="Longueur trace" def={20} int />
              <Toggle node={node} onUpdate={onUpdate} field="show_hud" label="HUD" def />
              <Toggle node={node} onUpdate={onUpdate} field="show_legend" label="Légende" def />
              <Toggle node={node} onUpdate={onUpdate} field="show_gt" label="Afficher GT" def />
              <Toggle node={node} onUpdate={onUpdate} field="debug_dialog_on_frames" label="Debug (bande d'état)" />
            </div>
          )}
          <button onClick={() => setAdvSys(s => !s)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 w-full">
            <ChevronDown size={11} className={advSys ? 'rotate-180' : ''} /> Fenêtre & système
          </button>
          {advSys && (
            <div className="space-y-1.5 pl-1 border-l border-gray-800">
              <div className="grid grid-cols-2 gap-1.5">
                <NumField node={node} onUpdate={onUpdate} k="start_frame_idx" label="Frame début" def={0} int />
                <NumField node={node} onUpdate={onUpdate} k="stop_frame_idx" label="Frame fin (-1)" def={-1} int />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="Device"><Select value={(d.device as string) ?? 'cuda'} onChange={v => onUpdate(node.id, { device: v })} options={[['cuda', 'CUDA'], ['cpu', 'CPU']]} /></Field>
                <NumField node={node} onUpdate={onUpdate} k="fps" label="FPS cible" def={10} />
              </div>
            </div>
          )}
          <button onClick={() => setAdvRaw(s => !s)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 w-full">
            <ChevronDown size={11} className={advRaw ? 'rotate-180' : ''} /> yaml brut (tous les params)
          </button>
          {advRaw && (
            <div className="space-y-1 pl-1 border-l border-gray-800">
              <p className="text-[10px] text-gray-600">Toute clé du config.yaml, en JSON. Fusionnée par-dessus (sans oubli).</p>
              <textarea value={(d.overrides_json as string) ?? ''} onChange={e => onUpdate(node.id, { overrides_json: e.target.value })}
                placeholder={'{"kalman_mot_custom": {"max_age": 10}, "detector_roi": "tophat"}'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-[11px] text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 resize-none font-mono" rows={3} />
            </div>
          )}

          {/* step4-C : TOUT le config.yaml, prérempli du template, zones branchées verrouillées. */}
          <FullYamlConfig node={node} onUpdate={onUpdate} />
        </>
      )}
      {url && <AppLink url={url} label="Ouvrir Inference App" />}
    </>
  )
}

// ── Optuna (step 2 + step 3) ──────────────────────────────────────────────────
// Espace de recherche : mêmes clés que les hyperparams Training (rien de magique).
const OPTUNA_SPACE: [string, string][] = [
  ['lr0', 'LR initial'], ['lrf', 'LR final'], ['momentum', 'Momentum'], ['weight_decay', 'Weight decay'],
  ['box', 'Box loss'], ['cls', 'Cls loss'], ['dfl', 'DFL loss'],
  ['mosaic', 'Mosaic'], ['mixup', 'Mixup'], ['scale', 'Scale'], ['degrees', 'Degrees'], ['translate', 'Translate'],
]
function OptunaConfig({ node, onUpdate, appUrls }: { node: Node; onUpdate: Props['onUpdate']; appUrls: Record<string, string> }) {
  const d = node.data as Record<string, unknown>
  const url = appUrls['optuna-app']
  const fullAuto = d.full_auto === undefined ? true : Boolean(d.full_auto)
  const [showSpace, setShowSpace] = useState(false)
  const optimize = (d.optimize as string[]) ?? []
  const toggleParam = (k: string) => onUpdate(node.id, { optimize: optimize.includes(k) ? optimize.filter(x => x !== k) : [...optimize, k] })

  return (
    <>
      {/* ── Paramètres de base (étude) ── */}
      <div className="grid grid-cols-2 gap-1.5">
        <NumField node={node} onUpdate={onUpdate} k="n_trials" label="Nb trials" def={20} int />
        <Field label="Direction">
          <Select value={(d.direction as string) ?? 'maximize'} onChange={v => onUpdate(node.id, { direction: v })} options={[['maximize', 'Maximiser'], ['minimize', 'Minimiser']]} />
        </Field>
      </div>
      <Field label="Métrique objectif">
        <Select value={(d.metric as string) ?? 'map50'} onChange={v => onUpdate(node.id, { metric: v })} options={[['map50', 'mAP@50'], ['map5095', 'mAP@50-95'], ['recall', 'Recall'], ['precision', 'Precision']]} />
      </Field>
      <p className="text-[10px] text-gray-600">Sampler <b>TPE</b> + pruning (median). Chaque trial entraîne un YOLO.</p>

      <label className="flex items-start gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-2.5 py-2 cursor-pointer">
        <input type="checkbox" checked={d.stop_on_failure === undefined ? true : Boolean(d.stop_on_failure)}
          onChange={e => onUpdate(node.id, { stop_on_failure: e.target.checked })} className="mt-0.5 accent-red-500" />
        <span className="text-[10px] leading-relaxed text-gray-300">
          <b className="text-red-300">Arrêter le pipeline si aucun trial n'aboutit</b> — recommandé et activé par défaut.
          Si décoché, le Training continue sans paramètres Optuna, avec ses paramètres configurés puis ses défauts.
        </span>
      </label>

      {/* ── Full Auto (après les param de base) + espace de recherche ── */}
      <ModeToggle node={node} onUpdate={onUpdate} labelAuto="Full Automatique (étude auto)" labelManual="Manuel (gate — étude dans l'app)" />

      {fullAuto ? (
        <>
          <button onClick={() => setShowSpace(s => !s)} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 w-full">
            <ChevronDown size={11} className={showSpace ? 'rotate-180' : ''} /> Espace de recherche ({optimize.length} sélectionné{optimize.length !== 1 ? 's' : ''})
          </button>
          {showSpace && (
            <div className="space-y-1 pl-1 border-l border-gray-800">
              <p className="text-[10px] text-gray-600">Cochez les hyperparamètres à optimiser (les autres = défauts).</p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {OPTUNA_SPACE.map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={optimize.includes(k)} onChange={() => toggleParam(k)} className="w-3 h-3 accent-cyan-500" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
          <Out>Sortie : <b>best params</b> optimaux → fusionnés dans les hyperparams du Training aval. En cas d'échec total : {d.stop_on_failure === false ? <b>fallback Training</b> : <b>arrêt du pipeline</b>}.</Out>
        </>
      ) : (
        <>
          <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg px-2.5 py-2 text-[11px] text-amber-300/80 leading-relaxed">
            Mode Manuel : ouvrez Optuna App, lancez l'étude, récupérez les meilleurs params, puis
            <b> inscrivez-les ci-dessous</b> — ils transitent par la flèche vers le Training aval, qui les fusionne.
          </div>
          <Field label="best_params (→ Training)">
            <textarea value={(d.best_params as string) ?? ''} onChange={e => onUpdate(node.id, { best_params: e.target.value })}
              placeholder="lr0=0.0231, mosaic=0.43, scale=0.69"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 resize-none font-mono" rows={2} />
          </Field>
          <p className="text-[10px] text-gray-600">Format : <span className="font-mono">clé=valeur</span> séparés par des virgules, ou JSON.</p>
        </>
      )}
      {url && <AppLink url={url} label="Ouvrir Optuna App" />}
    </>
  )
}

// ── MLflow (superviseur — pas de config, mais aperçu de ce qui sera loggé) ──────
function MLflowConfig({ node, appUrls, graphId }: { node: Node; appUrls: Record<string, string>; graphId?: string | null }) {
  const url = appUrls['mlflow-app']
  const planned = ((node.data as Record<string, unknown>).planned_runs as { label: string; kind: string; run: string }[] | undefined) ?? []
  const [runId, setRunId] = useState<string | null>(null)
  useEffect(() => {
    if (!graphId) { setRunId(null); return }
    fetch(`/api/graphs/${graphId}`).then(r => r.json()).then((g: { active_run_id?: string; run_history?: { run_id: string }[] }) => {
      setRunId(g.active_run_id || g.run_history?.[0]?.run_id || null)
    }).catch(() => setRunId(null))
  }, [graphId])
  return (
    <>
      <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg px-2.5 py-2 text-[11px] text-emerald-300/80 leading-relaxed">
        Nœud <b>SUPERVISEUR</b> : aucun branchement, aucun paramètre. Il observe en continu le store
        MLflow du workspace. Chaque Training / Inference / Éval y logue un run <span className="font-mono">{'{graphe}/{nœud}'}</span>.
      </div>
      <div>
        <p className="text-[11px] font-medium text-gray-400 mb-1">Ce qui sera loggé ({planned.length})</p>
        {planned.length === 0
          ? <p className="text-[10px] text-gray-600 italic">Aucun nœud Training / Inference dans ce graphe.</p>
          : (
            <div className="space-y-1">
              {planned.map((p, i) => (
                <div key={i} className="bg-gray-800/40 border border-gray-800 rounded-md px-2 py-1.5">
                  <p className="text-[11px] text-gray-200 break-all">
                    {p.kind === 'training' ? '⚙' : '◎'} <span className="font-mono">{p.run}</span>
                  </p>
                  <p className="text-[10px] text-gray-500">
                    {p.kind === 'training' ? 'params (lr0, epochs…) + mAP + best.pt (registry)' : 'métriques mAP / MOTA / IDF1 + benchmark'}
                  </p>
                </div>
              ))}
            </div>
          )}
        <p className="text-[10px] text-gray-600 mt-1">Nom de run déterministe <span className="font-mono">{'{graphe}/{label}'}</span> + tags graph_id/node_id.</p>
      </div>
      {url && runId
        ? <AppLink url={`${url.replace(/\/$/, '')}/lineage?run_id=${encodeURIComponent(runId)}`} label="Ouvrir ce run dans MLflow App" />
        : <p className="text-[10px] text-gray-600 italic">Lancez d'abord le pipeline pour ouvrir son espace MLflow.</p>}
    </>
  )
}

// ── Shared ────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><label className="text-[11px] font-medium text-gray-400">{label}</label>{children}</div>
}

function Input({ value, onChange, placeholder, type = 'text', locked }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; locked?: boolean }) {
  return <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={locked}
    title={locked ? 'Fourni par un nœud branché (figé)' : undefined}
    className={`w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none ${locked
      ? 'bg-gray-850 border-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-800 border-gray-700 text-white placeholder-gray-600 focus:border-indigo-500'}`} />
}

// Champ de CHEMIN : saisie libre + glisser-deposer d'un dossier/fichier depuis
// l'explorateur Windows + bouton Parcourir. Le drop passe par le pont Electron
// (webUtils.getPathForFile cote preload) : c'est le seul moyen d'obtenir le vrai
// chemin OS d'un dossier, et donc d'accepter un partage reseau (\hote\partage\...)
// sans le retaper. Meme mecanique que Dataset Explorer (Gallery.tsx) et Annotation.
// Hors VisionNexus (navigateur), le champ reste un input texte normal.
type NativeBridge = {
  getPathForFile?: (f: File) => string
  selectDirectory?: () => Promise<string | null>
}

function nativeBridge(): NativeBridge | undefined {
  return (window as unknown as { __CV_NATIVE_MOUNT__?: NativeBridge }).__CV_NATIVE_MOUNT__
}

function PathInput({ value, onChange, placeholder, locked }:
  { value: string; onChange: (v: string) => void; placeholder?: string; locked?: boolean }) {
  const [hover, setHover] = useState(false)
  const bridge = nativeBridge()
  const drop = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
    setHover(false)
    if (locked) return
    const dropped = e.dataTransfer.files[0]
    const real = dropped && bridge?.getPathForFile?.(dropped)
    if (real) onChange(real)
  }
  return (
    <div className="space-y-1">
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={locked}
        onDrop={drop}
        onDragOver={e => { e.preventDefault(); if (!locked) setHover(true) }}
        onDragLeave={() => setHover(false)}
        title={locked ? "Fourni par un noeud branche (fige)" : "Glissez un dossier depuis l'explorateur Windows, ou collez un chemin (partage reseau accepte)"}
        className={`w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none ${locked
          ? 'bg-gray-850 border-gray-800 text-gray-500 cursor-not-allowed'
          : hover
            ? 'bg-indigo-950/40 border-indigo-500 text-white'
            : 'bg-gray-800 border-gray-700 text-white placeholder-gray-600 focus:border-indigo-500'}`} />
      {!locked && bridge?.selectDirectory && (
        <button
          onClick={() => { void bridge.selectDirectory?.().then(p => { if (p) onChange(p) }) }}
          className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300">
          <FolderOpen size={10} /> Parcourir…
        </button>
      )}
    </div>
  )
}

function Select({ value, onChange, options, locked }: { value: string; onChange: (v: string) => void; options: [string, string][]; locked?: boolean }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={locked}
      title={locked ? 'Fourni par un nœud branché (figé)' : undefined}
      className={`w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none ${locked
        ? 'bg-gray-850 border-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gray-800 border-gray-700 text-white focus:border-indigo-500'}`}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

// Types de parents branchés sur ce nœud (injecté par SandgraphPage). Sert à figer
// les champs fournis par une arête (step 0bis).
function inputTypes(node: Node): string[] {
  return ((node.data as Record<string, unknown>).input_types as string[] | undefined) ?? []
}

// Ports d'entrée BRANCHÉS sur ce nœud, par id (step 5 — injecté par SandgraphPage,
// cf. useEffect([edges])). Contrairement à inputTypes (types de nœuds), nécessaire
// pour distinguer deux ports différents qui acceptent le même type de source
// (ex: "dataset YOLO" vs "GT" sur Inference, tous deux alimentables par Annotation).
function inputHandles(node: Node): string[] {
  return ((node.data as Record<string, unknown>).input_handles as string[] | undefined) ?? []
}

function NumField({ node, onUpdate, k, label, def, int, locked }: { node: Node; onUpdate: Props['onUpdate']; k: string; label: string; def: number; int?: boolean; locked?: boolean }) {
  const d = node.data as Record<string, unknown>
  const raw = d[k]
  return (
    <Field label={label}>
      <input type="number" value={String(raw ?? def)} disabled={locked}
        onChange={e => { const p = int ? parseInt(e.target.value) : parseFloat(e.target.value); onUpdate(node.id, { [k]: Number.isNaN(p) ? def : p }) }}
        className={`w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 ${locked ? 'opacity-50 cursor-not-allowed' : ''}`} />
    </Field>
  )
}

function Toggle({ node, onUpdate, field, label, def = false }: { node: Node; onUpdate: Props['onUpdate']; field: string; label: string; def?: boolean }) {
  const d = node.data as Record<string, unknown>
  const v = d[field] === undefined ? def : Boolean(d[field])
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer select-none">
      <input type="checkbox" checked={v} onChange={e => onUpdate(node.id, { [field]: e.target.checked })} className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer" />
      <span className="text-[11px] font-medium text-gray-300">{label}</span>
    </label>
  )
}

// Bascule Auto / Manuel. Par défaut agit sur `full_auto` (true = auto).
// `invert` + `field` : pour inference `interactive` (true = manuel/SOT live).
function ModeToggle({ node, onUpdate, labelAuto, labelManual = 'Manuel', field = 'full_auto', invert = false }:
  { node: Node; onUpdate: Props['onUpdate']; labelAuto: string; labelManual?: string; field?: string; invert?: boolean }) {
  const d = node.data as Record<string, unknown>
  const raw = d[field]
  const auto = invert ? !Boolean(raw) : (raw === undefined ? true : Boolean(raw))
  const setAuto = (a: boolean) => onUpdate(node.id, { [field]: invert ? !a : a })
  return (
    <div className="flex rounded-lg border border-gray-700 overflow-hidden text-[11px] font-medium">
      <button onClick={() => setAuto(true)} className={`flex-1 px-2 py-1.5 transition-colors ${auto ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>{labelAuto}</button>
      <button onClick={() => setAuto(false)} className={`flex-1 px-2 py-1.5 transition-colors ${!auto ? 'bg-amber-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}>{labelManual}</button>
    </div>
  )
}

function AppLink({ url, label }: { url: string; label: string }) {
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 mt-1">{label} →</a>
}

function Out({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-gray-500 leading-relaxed bg-gray-800/40 border border-gray-800 rounded-md px-2 py-1.5">{children}</p>
}

function _nodeTitle(ntype: string): string {
  const m: Record<string, string> = {
    dataset_source: 'Dataset Source', model: 'Modèle YOLO (entrée)', explorer: 'Dataset Explorer', annotation: 'Annotation App',
    dvc: 'DVC Commit', training: 'Training App', inference: 'Inference / Éval',
    mlflow: 'MLflow (superviseur)', optuna: 'Optuna HPO',
  }
  return m[ntype] ?? ntype
}
