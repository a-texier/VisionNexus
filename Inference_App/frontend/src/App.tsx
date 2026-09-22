import { MouseEvent, useEffect, useMemo, useState } from 'react'

type Tab = 'run' | 'evaluate' | 'config'
type Detector = { name: string; label: string; available: boolean; reason?: string }
type MediaInfo = { kind: string; width: number; height: number; frames: number; fps: number }
type ConfigValues = Record<string, any>

const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options)
  const body = await response.json()
  if (!response.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`)
  return body
}

export default function App() {
  const [tab, setTab] = useState<Tab>('run')
  const [detectors, setDetectors] = useState<Detector[]>([])
  const [source, setSource] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [engine, setEngine] = useState('yolox')
  const [modelSize, setModelSize] = useState('yolox-s')
  const [mode, setMode] = useState<'infer' | 'mot' | 'sot'>('infer')
  const [tracker, setTracker] = useState<'none' | 'bytetrack'>('none')
  const [confidence, setConfidence] = useState(0.25)
  const [iou, setIou] = useState(0.45)
  const [media, setMedia] = useState<MediaInfo | null>(null)
  const [click, setClick] = useState<{ x: number; y: number } | null>(null)
  const [job, setJob] = useState<Record<string, any> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dataYaml, setDataYaml] = useState('')
  const [evalResult, setEvalResult] = useState<Record<string, any> | null>(null)
  const [yamlText, setYamlText] = useState('')
  const [configValues, setConfigValues] = useState<ConfigValues>({})

  const applyConfig = (values: ConfigValues) => {
    setConfigValues(values)
    if (typeof values.engine === 'string') setEngine(values.engine)
    if (typeof values.model_size === 'string') setModelSize(values.model_size)
    if (['infer', 'mot', 'sot'].includes(values.mode)) setMode(values.mode)
    if (['none', 'bytetrack'].includes(values.tracker)) setTracker(values.tracker)
    if (typeof values.confidence === 'number') setConfidence(values.confidence)
    if (typeof values.iou === 'number') setIou(values.iou)
  }

  useEffect(() => {
    api<{ detectors: Detector[] }>('/api/capabilities').then(r => {
      setDetectors(r.detectors.filter(d => d.available))
    }).catch(e => setError(String(e)))
    api<{ yaml_text: string; values: ConfigValues }>('/api/config').then(r => {
      setYamlText(r.yaml_text)
      applyConfig(r.values)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (mode !== 'mot') setTracker('none')
    if (mode !== 'sot') setClick(null)
  }, [mode])

  const previewUrl = useMemo(() => source ? `/api/media/preview?source=${encodeURIComponent(source)}&frame=0` : '', [source, media])

  const inspect = async () => {
    setError(''); setClick(null)
    try { setMedia(await api<MediaInfo>('/api/media/inspect', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ source }) })) }
    catch (e) { setError(String(e)) }
  }

  const chooseTarget = (event: MouseEvent<HTMLImageElement>) => {
    if (mode !== 'sot') return
    const rect = event.currentTarget.getBoundingClientRect()
    setClick({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height })
  }

  const run = async () => {
    setError(''); setJob(null); setBusy(true)
    try {
      const started = await api<{ job_id: string }>('/api/runs', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ...configValues, source, model_path: modelPath, engine, model_size: modelSize, mode, tracker, confidence, iou, click_x: click?.x, click_y: click?.y }),
      })
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 700))
        const state = await api<Record<string, any>>(`/api/runs/${started.job_id}`)
        setJob(state)
        if (state.status !== 'running') {
          if (state.status === 'error') throw new Error(state.error)
          break
        }
      }
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }

  const evaluate = async () => {
    setError(''); setEvalResult(null); setBusy(true)
    try {
      const result = await api<Record<string, any>>('/api/orchestrator/evaluate', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ kind: 'detection', data_yaml: dataYaml, model_path: modelPath, engine, model_size: modelSize, overrides: { imgsz: configValues.imgsz, device: configValues.device, conf: 0.001, iou, split: 'val' } }),
      })
      setEvalResult(result)
    } catch (e) { setError(String(e)) }
    finally { setBusy(false) }
  }

  const saveConfig = async () => {
    setError('')
    try {
      const saved = await api<{ values: ConfigValues }>('/api/config', { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ yaml_text: yamlText }) })
      applyConfig(saved.values)
    }
    catch (e) { setError(String(e)) }
  }

  return <div className="app">
    <header>
      <div><span className="mark">VN</span><strong>Inference</strong><small>média · YOLO · tracking</small></div>
      <nav>{(['run','evaluate','config'] as Tab[]).map(value => <button className={tab === value ? 'active' : ''} onClick={() => setTab(value)} key={value}>{value === 'run' ? 'Inférence' : value === 'evaluate' ? 'Évaluation' : 'Config YAML'}</button>)}</nav>
    </header>
    <main>
      <section className="sidebar">
        <h2>Entrées</h2>
        <Field label="Source image, vidéo ou dossier"><input value={source} onChange={e => setSource(e.target.value)} placeholder="C:\data\video.mp4" /></Field>
        <button className="secondary" onClick={inspect}>Lire le média</button>
        <Field label="Fichier de poids"><input value={modelPath} onChange={e => setModelPath(e.target.value)} placeholder="C:\models\best.pth" /></Field>
        <div className="grid2">
          <Field label="Moteur"><select value={engine} onChange={e => setEngine(e.target.value)}>{detectors.map(d => <option key={d.name} value={d.name}>{d.label}</option>)}</select></Field>
          <Field label="Architecture"><input value={modelSize} onChange={e => setModelSize(e.target.value)} /></Field>
        </div>
        <div className="grid2"><Field label="Confiance"><input type="number" min="0" max="1" step="0.05" value={confidence} onChange={e => setConfidence(Number(e.target.value))} /></Field><Field label="NMS IoU"><input type="number" min="0" max="1" step="0.05" value={iou} onChange={e => setIou(Number(e.target.value))} /></Field></div>
      </section>

      <section className="content">
        {error && <div className="error">{error}</div>}
        {tab === 'run' && <>
          <div className="modebar">
            <Mode value="infer" current={mode} set={setMode} title="Inférence pure" sub="YOLO uniquement" />
            <Mode value="mot" current={mode} set={setMode} title="Multi-objet" sub="YOLO + tracker optionnel" />
            <Mode value="sot" current={mode} set={setMode} title="SOT par clic" sub="YOLO initialise CSRT" />
          </div>
          {mode === 'mot' && <div className="tracker"><span>Tracker</span><button className={tracker === 'none' ? 'selected' : ''} onClick={() => setTracker('none')}>Aucun</button><button className={tracker === 'bytetrack' ? 'selected' : ''} onClick={() => setTracker('bytetrack')}>ByteTrack</button></div>}
          <div className="viewer">
            {media ? <div className="imagewrap"><img src={previewUrl} onClick={chooseTarget} className={mode === 'sot' ? 'targetable' : ''} />{click && <span className="cross" style={{left: `${click.x*100}%`, top: `${click.y*100}%`}}>+</span>}</div> : <div className="empty">Indique une source puis clique « Lire le média ».</div>}
            {media && <div className="mediaInfo">{media.kind} · {media.width}×{media.height} · {media.frames} frame(s) · {media.fps.toFixed(1)} fps</div>}
          </div>
          <button className="primary" disabled={busy || !media || !modelPath || (mode === 'sot' && !click)} onClick={run}>{busy ? 'Traitement…' : 'Lancer'}</button>
          {job?.status === 'done' && <Result result={job} />}
        </>}
        {tab === 'evaluate' && <>
          <div className="panel"><h2>Évaluation détection</h2><p>Validation YOLO sur le split <code>val</code>, avec mAP50, mAP50–95, PR, F1 et matrice de confusion.</p><Field label="data.yaml"><input value={dataYaml} onChange={e => setDataYaml(e.target.value)} placeholder="C:\dataset\data.yaml" /></Field><button className="primary" disabled={busy || !dataYaml || !modelPath} onClick={evaluate}>{busy ? 'Évaluation…' : 'Évaluer'}</button></div>
          {evalResult && <EvalResult result={evalResult} />}
        </>}
        {tab === 'config' && <div className="panel"><h2>Configuration YAML</h2><p>Cette copie est enregistrée dans le workspace utilisateur. Après enregistrement, ses valeurs sont appliquées au prochain run et restent disponibles au nœud Orchestrator.</p><textarea value={yamlText} onChange={e => setYamlText(e.target.value)} spellCheck={false}/><button className="primary" onClick={saveConfig}>Enregistrer et appliquer</button></div>}
      </section>
    </main>
  </div>
}

function Field({label, children}: {label: string; children: React.ReactNode}) { return <label className="field"><span>{label}</span>{children}</label> }
function Mode({value,current,set,title,sub}: {value:'infer'|'mot'|'sot';current:string;set:(v:'infer'|'mot'|'sot')=>void;title:string;sub:string}) { return <button className={current === value ? 'mode selected' : 'mode'} onClick={() => set(value)}><strong>{title}</strong><small>{sub}</small></button> }
function outputUrl(path: string) { return `/api/output?path=${encodeURIComponent(path)}` }
function Result({result}: {result: Record<string, any>}) { const video = String(result.output_path || '').toLowerCase().endsWith('.mp4'); return <div className="result"><div className="stats"><b>{result.frames}</b><span>frames</span><b>{result.fps.toFixed(1)}</b><span>fps global</span><b>{result.detector_ms_per_frame.toFixed(1)} ms</b><span>détecteur</span><b>{result.tracker_ms_per_frame.toFixed(2)} ms</b><span>tracker</span></div>{result.output_path && (video ? <video controls src={outputUrl(result.output_path)} /> : <img src={outputUrl(result.output_path)} />)}</div> }
function EvalResult({result}: {result: Record<string, any>}) { const m=result.metrics; return <div className="result"><div className="stats"><b>{(m.map50*100).toFixed(1)}%</b><span>mAP50</span><b>{(m.map50_95*100).toFixed(1)}%</b><span>mAP50–95</span><b>{m.images}</b><span>images</span><b>{m.fps.toFixed(1)}</b><span>fps</span></div><div className="plots">{['pr_curve.png','f1_curve.png','confusion_matrix.png'].map(name => <img key={name} src={outputUrl(`${result.run_dir}/${name}`)} />)}</div></div> }
