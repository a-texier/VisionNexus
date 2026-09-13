// ============================================================
// components/presentation/TabDeveloper.tsx
// Onglet Mode Développeur — guide d'intégration de nouvelles
// fonctionnalités backend + frontend.
// ============================================================

import React from 'react'
import { motion } from 'framer-motion'
import {
  Wrench, Database, Code2, Network, AlertTriangle, BookOpen,
} from 'lucide-react'
import { AnimatedSection, InfoBox, CodeBlock, fadeUp } from './shared'

// ---- Snippets de code ----

const CODE_SERVICE = `# backend/services/mon_algo_service.py
import numpy as np

class MonAlgoService:
    """Singleton — instancié une seule fois dans main.py lifespan."""

    def __init__(self):
        self._ready = False

    def load(self):
        # charger modèle, vérifier GPU...
        self._ready = True

    def is_available(self) -> bool:
        return self._ready

    def predict(self, image: np.ndarray, params: dict) -> list[dict]:
        """Retourne une liste {cx, cy, w, h, confidence, class_id} (normalisé)."""
        return []

mon_algo_service = MonAlgoService()  # singleton exporté`

const CODE_LIFESPAN = `# backend/main.py — dans la fonction lifespan()
from backend.services.mon_algo_service import mon_algo_service
mon_algo_service.load()  # chargement au démarrage`

const CODE_ROUTER = `# backend/models/routers/annotation.py  (ou nouveau router)
from fastapi import APIRouter, HTTPException, Depends
from backend.services.mon_algo_service import mon_algo_service

@router.post("/frames/{frame_id}/mon-algo")
async def run_mon_algo(frame_id: int, params: MonAlgoParams, session=Depends(get_session)):
    if not mon_algo_service.is_available():
        raise HTTPException(503, "MonAlgo non disponible")
    frame = session.get(Frame, frame_id)
    if not frame:
        raise HTTPException(404, "Frame introuvable")
    img = load_image(frame.image_path)
    results = mon_algo_service.predict(img, params.dict())
    for r in results:
        ann = Annotation(
            frame_id=frame_id,
            cx=r["cx"], cy=r["cy"], w=r["w"], h=r["h"],  # YOLO normalisé !
            class_id=r["class_id"],
            confidence=r["confidence"],
            source_algorithm="mon_algo",
        )
        session.add(ann)
    session.commit()
    return {"created": len(results)}`

const CODE_API_TS = `// frontend/src/services/api.ts  — ajouter dans le namespace annotations
export const annotationsAPI = {
  // ... endpoints existants ...
  runMonAlgo: (frameId: number, params: MonAlgoParams) =>
    api.post<Annotation[]>(\`/frames/\${frameId}/mon-algo\`, params),
}`

const CODE_BUTTON = `// frontend/src/components/toolbar/Toolbar.tsx
const handleRunMonAlgo = async () => {
  if (!currentFrame) return
  setLoading(true)
  try {
    await annotationsAPI.runMonAlgo(currentFrame.id, { param1: value1 })
    const updated = await annotationsAPI.getByFrame(currentFrame.id)
    loadAnnotations(currentFrame.id, updated)  // frameId EN PREMIER !
  } catch (err) {
    toast.error("Erreur MonAlgo")
  } finally {
    setLoading(false)
  }
}`

const CODE_ASYNC = `# Pour un algo long (propagation vidéo), utiliser le task registry
import uuid
from backend.services.task_registry import create_task, update_task, set_task_result
from concurrent.futures import ThreadPoolExecutor
executor = ThreadPoolExecutor(max_workers=2)

@router.post("/projects/{project_id}/mon-algo/propagate")
async def propagate_mon_algo(project_id: int, ...):
    task_id = str(uuid.uuid4())
    create_task(task_id, "Propagation MonAlgo")

    def run():
        try:
            update_task(task_id, "running", 0, "Demarrage...")
            for i, frame in enumerate(frames):
                update_task(task_id, "running",
                    progress=int(i / len(frames) * 100),
                    message=f"Frame {i+1}/{len(frames)}",
                    current_frame_id=frame.id)  # navigation temps reel
                # ... traitement ...
            update_task(task_id, "completed", 100, "Termine")
        except Exception as e:
            update_task(task_id, "error", 0, str(e), error=str(e))

    executor.submit(run)
    return {"task_id": task_id}`

const CODE_TASK_STREAM = `// frontend — WebSocket principal, polling HTTP en secours seulement
const [taskId, setTaskId] = useState<string | null>(null)

// Lancer la propagation :
const res = await trackingAPI.propagate(projectId, params)
setTaskId(res.task_id)

const socket = new AnnotationWebSocket()
socket.on('update', ({ current_frame_id, live_frames }) => {
  // live_frames : annotations de CHAQUE frame, jamais throttlees
  // current_frame_id : navigation du canvas, cadencee par le reglage Interface
})
socket.connect(\`/ws/tasks/\${res.task_id}\`)

// Si l'upgrade WebSocket est bloque par le proxy SSH, TrackPanel bascule vers
// GET /api/tasks/{id} en boucle sequentielle et l'annule des que le WS revient.`

const CODE_INVARIANTS = `// Invariants CRITIQUES à ne jamais violer :

// 1. Coordonnées TOUJOURS normalisées [0,1] en DB (format YOLO)
const cx_norm = cx_pixel / image_width  // jamais stocker des pixels

// 2. loadAnnotations(frameId, annotations) — frameId EN PREMIER
loadAnnotations(frame.id, annotations)  // OK
loadAnnotations(annotations, frame.id)  // BUG silencieux

// 3. clearAnnotations() obligatoire au changement de projet
useEffect(() => { clearAnnotations() }, [projectId])

// 4. Pas d'emoji dans print() / logging Python (Windows cp1252)
print("OK")      // OK
print("OK")   // UnicodeEncodeError au demarrage uvicorn

// 5. Singleton sam_service — checkpoint requis
//    Si absent : serveur demarre, endpoints SAM retournent 503

// 6. Migrations : ALTER TABLE uniquement, jamais DROP TABLE`

export const TabDeveloper: React.FC = () => (
  <div className="space-y-10 px-6 py-10 max-w-5xl mx-auto">
    {/* Intro */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center">
          <Wrench size={16} className="text-indigo-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Mode Développeur</h2>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs text-slate-300 space-y-3">
        <p>Cette section explique comment intégrer un <strong>nouvel algorithme</strong> (backend + frontend) sans casser l'existant. L'architecture est modulaire : chaque domaine a son service + son router.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
          {[
            { icon: <Database size={14} />, label: 'Backend', desc: 'Service singleton + router FastAPI', color: 'text-orange-400' },
            { icon: <Code2 size={14} />, label: 'Frontend', desc: 'API client typé + store Zustand + composant', color: 'text-blue-400' },
            { icon: <Network size={14} />, label: 'Async', desc: 'Task registry pour algos longs (propagation)', color: 'text-green-400' },
          ].map((item) => (
            <div key={item.label} className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 flex items-start gap-3">
              <span className={`mt-0.5 ${item.color}`}>{item.icon}</span>
              <div>
                <p className={`font-semibold ${item.color} mb-0.5`}>{item.label}</p>
                <p className="text-slate-400">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatedSection>

    {/* Étape 1 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-400 text-[11px] font-bold">1</span>
        <h3 className="text-base font-bold text-white">Créer le service backend (singleton)</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-3">
        <p className="text-xs text-slate-400">Créez <code className="bg-slate-700 px-1 rounded">backend/services/mon_algo_service.py</code> en suivant le pattern singleton :</p>
        <CodeBlock code={CODE_SERVICE} color="text-orange-200" label="backend/services/mon_algo_service.py" />
        <p className="text-xs text-slate-400">Enregistrez-le dans le lifespan de <code className="bg-slate-700 px-1 rounded">backend/main.py</code> :</p>
        <CodeBlock code={CODE_LIFESPAN} color="text-orange-200" label="backend/main.py (lifespan)" />
      </motion.div>
    </AnimatedSection>

    {/* Étape 2 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-[11px] font-bold">2</span>
        <h3 className="text-base font-bold text-white">Ajouter l'endpoint FastAPI</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-3">
        <p className="text-xs text-slate-400">Ajoutez l'endpoint dans un router existant (<code className="bg-slate-700 px-1 rounded">annotation.py</code>) ou créez un nouveau fichier dans <code className="bg-slate-700 px-1 rounded">backend/models/routers/</code>.</p>
        <CodeBlock code={CODE_ROUTER} color="text-blue-200" label="backend/models/routers/annotation.py" />
        <InfoBox type="warn" title="Coordonnées YOLO normalisées">
          Toutes les coordonnées en DB doivent être dans <code className="bg-slate-700 px-1 rounded">[0, 1]</code>. Si votre algo retourne des pixels, divisez par <code className="bg-slate-700 px-1 rounded">image_width</code> / <code className="bg-slate-700 px-1 rounded">image_height</code> avant de créer l'annotation.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* Étape 3 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-[11px] font-bold">3</span>
        <h3 className="text-base font-bold text-white">Exposer dans le client API TypeScript</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-3">
        <CodeBlock code={CODE_API_TS} color="text-green-200" label="frontend/src/services/api.ts" />
        <p className="text-xs text-slate-400">L'intercepteur axios gère les toasts d'erreur automatiquement. Ajoutez le type <code className="bg-slate-700 px-1 rounded">MonAlgoParams</code> dans <code className="bg-slate-700 px-1 rounded">frontend/src/types/api.ts</code> si nécessaire.</p>
      </motion.div>
    </AnimatedSection>

    {/* Étape 4 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400 text-[11px] font-bold">4</span>
        <h3 className="text-base font-bold text-white">Ajouter le bouton / composant frontend</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-3">
        <CodeBlock code={CODE_BUTTON} color="text-purple-200" label="frontend/src/components/toolbar/Toolbar.tsx" />
        <InfoBox type="warn" title="loadAnnotations — ordre des arguments">
          <code className="bg-slate-700 px-1 rounded">loadAnnotations(frameId, annotations)</code> — le <strong>frameId est toujours en premier</strong>. C'est l'erreur la plus courante.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* Étape 5 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-[11px] font-bold">5</span>
        <h3 className="text-base font-bold text-white">Pour un algo long : task registry asynchrone</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="space-y-3">
        <p className="text-xs text-slate-400">Pour les propagations sur toute une vidéo, utilisez le registre de tâches. L'endpoint retourne immédiatement un <code className="bg-slate-700 px-1 rounded">task_id</code> et le frontend suit son état par WebSocket. Le polling HTTP n'est qu'un repli si l'upgrade est bloqué.</p>
        <CodeBlock code={CODE_ASYNC} color="text-teal-200" label="backend — propagation async avec task registry" />
        <CodeBlock code={CODE_TASK_STREAM} color="text-teal-200" label="frontend — WebSocket et repli HTTP" />
        <InfoBox type="info" title="current_frame_id">
          En mettant à jour <code className="bg-slate-700 px-1 rounded">current_frame_id</code> dans <code className="bg-slate-700 px-1 rounded">update_task()</code>, le WebSocket pilote la barre de progression et la navigation. La cadence du canvas est reglable ; les <code>live_frames</code> et les indicateurs d'annotation ne sont pas throttles.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* Invariants */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
          <AlertTriangle size={16} className="text-red-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Invariants critiques à ne pas violer</h3>
      </motion.div>
      <motion.div variants={fadeUp}>
        <CodeBlock code={CODE_INVARIANTS} color="text-slate-300" label="Invariants — à lire avant tout développement" />
      </motion.div>
    </AnimatedSection>

    {/* Architecture résumé */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-slate-500/20 flex items-center justify-center">
          <BookOpen size={16} className="text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Résumé Architecture</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="font-semibold text-orange-300">Backend (FastAPI + SQLite)</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><code className="bg-slate-700 px-1 rounded">backend/main.py</code> — lifespan, migrations, CORS</li>
              <li><code className="bg-slate-700 px-1 rounded">backend/models/routers/</code> — 1 fichier par domaine</li>
              <li><code className="bg-slate-700 px-1 rounded">backend/services/</code> — singletons métier</li>
              <li><code className="bg-slate-700 px-1 rounded">backend/models/models.py</code> — SQLModel (Pydantic + SQLAlchemy)</li>
              <li><code className="bg-slate-700 px-1 rounded">data/annotation.db</code> — SQLite WAL, foreign keys ON</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-blue-300">Frontend (React + TypeScript + Konva.js)</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><code className="bg-slate-700 px-1 rounded">annotationStore</code> — annotations, undo/redo, clipboard</li>
              <li><code className="bg-slate-700 px-1 rounded">projectStore</code> — projets, frames, session</li>
              <li><code className="bg-slate-700 px-1 rounded">samStore</code> — WebSocket SAM, masques streamés</li>
              <li><code className="bg-slate-700 px-1 rounded">uiStore</code> — zoom, onglets, modals</li>
              <li><code className="bg-slate-700 px-1 rounded">services/api.ts</code> — axios typé, namespaces API</li>
            </ul>
          </div>
        </div>
        <InfoBox type="tip" title="Migrations de schéma">
          Ajoutez les nouvelles colonnes via <code className="bg-slate-700 px-1 rounded">ALTER TABLE … ADD COLUMN</code> dans <code className="bg-slate-700 px-1 rounded">_run_migrations()</code> de <code className="bg-slate-700 px-1 rounded">main.py</code>. Les colonnes manquantes sont ajoutées silencieusement au démarrage sans perte de données. N'utilisez jamais <code className="bg-slate-700 px-1 rounded">DROP TABLE</code>.
        </InfoBox>
      </motion.div>
    </AnimatedSection>
  </div>
)
