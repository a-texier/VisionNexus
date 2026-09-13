import { useQuery } from '@tanstack/react-query'
import {
  BookOpen, Workflow, MonitorPlay, SlidersHorizontal, Rocket,
  Gauge, FileCode2, Check, Minus,
} from 'lucide-react'
import { trackerAPI } from '../api/client'

// ── Curated YAML parameter reference (source: tracker config/config.yaml) ────
// `app` = modifiable directement depuis l'IHM (formulaire ou reglages).
interface Param { key: string; desc: string; values: string; app: boolean }
interface ParamGroup { title: string; note?: string; params: Param[] }

const PARAM_GROUPS: ParamGroup[] = [
  {
    title: 'Source & données',
    params: [
      { key: 'sequence_dir', desc: 'Séquence à traiter : dossier d\'images, vidéo, format optionnel détecté, "tcp"/"tcp://host" (flux ZMQ), ou http://host/stream', values: 'chemin / URL', app: true },
      { key: 'weights_yolo', desc: 'Poids du détecteur YOLO (.pt/.onnx/.engine). Vide = DummyDetector (aucune détection)', values: 'chemin', app: true },
      { key: 'camera_name', desc: 'Reader de métadonnées CSV (az/el). multi_csv = 3 CSV degrés · single_csv = 1 CSV radians', values: 'multi_csv | single_csv | ""', app: true },
      { key: 'annotation_file', desc: 'Vérité terrain .ver ou YOLO .txt. Vide = pas de métriques', values: 'chemin', app: true },
      { key: 'start_frame_idx / stop_frame_idx', desc: 'Fenêtre de frames traitées (-1 = jusqu\'à la fin)', values: 'entier', app: false },
    ],
  },
  {
    title: 'Pipeline (trackers)',
    params: [
      { key: 'tracker_mot', desc: 'Tracker multi-objets. none = mode SOT-only', values: 'custom_kalman | bytetrack | botsort | boosttrack | none', app: true },
      { key: 'tracker_sot', desc: 'Tracker mono-objet (déclenché au clic)', values: 'dummy | csrt | tracking_tophat | dimp | ostrack | sam2', app: true },
      { key: 'detector_mot', desc: 'Détecteur alimentant le MOT', values: 'yolo | tophat | none | dummy', app: true },
      { key: 'detector_roi', desc: 'Détecteur de la zone SOT (obligatoire si tracker_mot=none)', values: 'tophat | none', app: true },
      { key: 'n_targets', desc: 'Nombre de cibles SOT simultanées (clic G / clic D)', values: '1 | 2', app: true },
      { key: 'mot_background', desc: 'MOT en fond pendant le SOT (true) ou en veille (false)', values: 'bool', app: true },
      { key: 'device', desc: 'Device PyTorch pour trackers GPU (YOLO, DiMP, OSTrack, SAM2)', values: 'cuda | cpu', app: true },
      { key: 'sot_click_max_dist_px', desc: 'Distance max clic ↔ track MOT pour accrocher (200 recommandé)', values: 'entier px', app: false },
    ],
  },
  {
    title: 'Mode & cadence',
    params: [
      { key: 'mode', desc: 'interactive = SOT live (clic souris/MJPEG) · command = clics rejoués depuis un .txt · headless = batch pur', values: 'interactive | command | headless', app: true },
      { key: 'clicks', desc: 'Fichier de commandes .txt (mode command) — voir Mode command ci-dessous', values: 'chemin', app: true },
      { key: 'fps', desc: 'Fréquence cible (Hz)', values: 'nombre', app: true },
      { key: 'command_delta', desc: 'Tolérance de timing d\'activation d\'une commande (frames)', values: 'entier', app: false },
    ],
  },
  {
    title: 'Rendu & flux',
    note: 'light_render bypasse tous les flags d\'affichage pour un rendu ultra-rapide (Jetson/bench).',
    params: [
      { key: 'light_render', desc: 'Rendu minimal (bboxes seules, ~30-50 % du budget render économisé)', values: 'bool', app: true },
      { key: 'save_video / save_frames', desc: 'Encoder un MP4 / sauver chaque frame PNG dans le run', values: 'bool', app: true },
      { key: 'trail', desc: 'Longueur de la trace de trajectoire (0 = off)', values: 'frames', app: true },
      { key: 'stream_mode', desc: 'none = pas de flux · mjpeg = serveur HTTP (forcé par l\'IHM web)', values: 'none | mjpeg', app: false },
      { key: 'stream_quality / stream_every', desc: 'Qualité JPEG du flux · 1 frame sur N envoyée', values: 'entier', app: true },
    ],
  },
  {
    title: 'Métriques',
    note: 'Réglés depuis les Réglages de l\'app (persistés dans le workspace).',
    params: [
      { key: 'compute_metrics', desc: 'Active le calcul MOTA/IDF1 (nécessite annotation_file)', values: 'bool', app: true },
      { key: 'metrics_iou_threshold', desc: 'Seuil IoU pred↔GT. Cibles IR minuscules → 0.1/0.2 (COCO = 0.5)', values: '0.0–1.0', app: true },
    ],
  },
]

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-[#0d1117] border border-[#30363d] rounded-xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-100 mb-3">
        <span className="text-cyan-400">{icon}</span>{title}
      </h2>
      <div className="text-[13px] text-gray-300 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

export default function DocsPage() {
  const { data: info } = useQuery({ queryKey: ['export-info'], queryFn: trackerAPI.exportInfo })

  return (
    <div className="max-w-[1000px] mx-auto p-6 space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-100">
          <BookOpen size={20} className="text-cyan-400" /> Documentation
        </h1>
        <p className="text-sm text-gray-400">
          IHM web d'un tracker générique <b className="text-gray-200">MOT / SOT</b> (multi-objets + mono-objet cliquable),
          piloté par un fichier <code className="text-cyan-300">config.yaml</code> unique. Cette app enveloppe le tracker
          en backend + frontend et l'expose comme nœud de la chaîne Orchestrator (MLOps).
        </p>
      </header>

      <Card icon={<Workflow size={16} />} title="Place dans la chaîne Orchestrator">
        <p>Le nœud <b className="text-gray-200">Inference</b> se branche de deux façons :</p>
        <div className="grid md:grid-cols-2 gap-3 mt-2">
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
            <div className="text-cyan-300 font-medium text-xs mb-1">① En aval d'un entraînement</div>
            <p className="text-xs text-gray-400">Un nœud <b>Training</b> (ou Eval/DVC) fournit le modèle YOLO
              (<code>best.pt</code>) et les paramètres de config → test/benchmark du tracker sur une zone.</p>
          </div>
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-3">
            <div className="text-cyan-300 font-medium text-xs mb-1">② En amont, comme acquisition</div>
            <p className="text-xs text-gray-400">Acquisition de données brutes (flux MJPEG, vidéo ou format optionnel) →
              <b> Annotation</b> → dataset → <b>Training</b> + fine-tuning → retest du tracker sur la zone (boucle).</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
          {['Acquisition (Inference)', 'Annotation', 'Dataset', 'Training / fine-tune', 'Retest (Inference)'].map((s, i, a) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="px-2 py-1 rounded bg-cyan-900/30 border border-cyan-800/40 text-cyan-200">{s}</span>
              {i < a.length - 1 && <span className="text-gray-600">→</span>}
            </span>
          ))}
        </div>
      </Card>

      <Card icon={<MonitorPlay size={16} />} title="Les trois modes">
        <ul className="space-y-1.5">
          <li><b className="text-gray-200">interactive</b> — vous faites le SOT en direct : clic gauche = cible 1,
            clic droit = cible 2, clic molette = kill. Le flux MJPEG est rendu dans l'IHM.</li>
          <li><b className="text-gray-200">command</b> — les clics sont <i>rejoués</i> depuis un fichier <code>.txt</code>
            (déterministe, reproductible). Voir « Mode command » ci-dessous.</li>
          <li><b className="text-gray-200">headless</b> — traitement pur sans interaction (batch/benchmark),
            MOT automatique. C'est le mode par défaut du nœud orchestrateur.</li>
        </ul>
      </Card>

      <Card icon={<FileCode2 size={16} />} title="Mode command — fichier de commandes .txt (cmd_send)">
        <p>Un run <b>command</b> lit un fichier texte de commandes. Deux types de lignes
          (séparateur : virgule, TAB ou espaces) :</p>
        <pre className="bg-black/50 border border-[#30363d] rounded p-3 text-[12px] text-gray-300 overflow-x-auto">
{`# Clic SOT (4 champs)      : frame_emit  frame_click  x  y
120  118  432  260

# Contrôle MOT (3 champs)  : frame_emit  frame_real  mot_state
200  200  0   # 0 = désactiver le MOT (SOT single)
350  350  1   # 1 = réactiver le MOT`}
        </pre>
        <p className="text-xs text-gray-400">Déposez ce <code>.txt</code> depuis l'onglet Tracker (mode command) ; il est
          enregistré dans <code className="text-cyan-300">{info?.runs_dir ? 'cmd_send/' : '<workspace>/cmd_send/'}</code>
          {' '}et réutilisable comme rejeu. Chaque session <b>interactive</b> avec Record produit aussi un tel fichier.</p>
      </Card>

      <Card icon={<SlidersHorizontal size={16} />} title="Paramètres du config.yaml">
        <p className="text-xs text-gray-400 mb-2">
          <span className="inline-flex items-center gap-1"><Check size={12} className="text-emerald-400" /> modifiable depuis l'app</span>
          <span className="mx-2 text-gray-600">·</span>
          <span className="inline-flex items-center gap-1"><Minus size={12} className="text-gray-500" /> éditable dans le YAML uniquement (défaut sûr)</span>
        </p>
        <div className="space-y-4">
          {PARAM_GROUPS.map(g => (
            <div key={g.title}>
              <div className="text-xs font-semibold text-gray-200 mb-1">{g.title}</div>
              {g.note && <p className="text-[11px] text-gray-500 mb-1.5 italic">{g.note}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <tbody>
                    {g.params.map(p => (
                      <tr key={p.key} className="border-b border-[#21262d] align-top">
                        <td className="py-1.5 pr-3 w-6">
                          {p.app ? <Check size={13} className="text-emerald-400" /> : <Minus size={13} className="text-gray-600" />}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-cyan-300 whitespace-nowrap">{p.key}</td>
                        <td className="py-1.5 pr-3 text-gray-300">{p.desc}</td>
                        <td className="py-1.5 font-mono text-[11px] text-gray-500 whitespace-nowrap">{p.values}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card icon={<Rocket size={16} />} title="Export & déploiement — où vont les fichiers">
        {info ? (
          <div className="space-y-2 text-[12px]">
            <Row label="Export modèle (ONNX / TensorRT)" path={info.model_export.dir} note={info.model_export.note} />
            <Row label="ZIP autonome du tracker" path={info.tracker_zip.dir} note={info.tracker_zip.note} />
            <Row label="Runs (vidéos, benchmark, profiling)" path={info.runs_dir} note="Un sous-dossier horodaté par session." />
            <p className="text-[11px] text-gray-500 pt-1">
              Cible de déploiement : <b className="text-gray-300">x86_64 + GPU NVIDIA recent (Ubuntu 22.04)</b>, build via WSL sur Windows.
              Standalone = conda-pack → zip · Conteneur = image Podman. Pas de chemin Jetson/aarch64 pour l'instant.
            </p>
          </div>
        ) : <p className="text-xs text-gray-500">Chargement des chemins…</p>}
      </Card>

      <Card icon={<Gauge size={16} />} title="Réglages & métriques">
        <p>Les réglages (seuils de métriques, imgsz d'export, rendu, hôte de partage natif) sont persistés dans
          <code className="text-cyan-300"> user_settings.json</code> à la racine de votre workspace — c'est votre
          « base » personnelle. Ils servent de défauts à chaque session et au nœud orchestrateur, et restent
          surchargables au cas par cas depuis le formulaire. Rien n'est caché : le chemin exact est affiché dans
          l'onglet Réglages.</p>
      </Card>
    </div>
  )
}

function Row({ label, path, note }: { label: string; path: string; note: string }) {
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-lg px-3 py-2">
      <div className="text-gray-200 font-medium">{label}</div>
      <div className="font-mono text-[11px] text-cyan-300 break-all">{path}</div>
      <div className="text-[11px] text-gray-500">{note}</div>
    </div>
  )
}
