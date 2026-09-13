// ============================================================
// components/presentation/TabOverview.tsx
// Onglet Généralités : hero, fonctionnalités, raccourcis,
// format YOLO, API REST. (v2)
// ============================================================

import React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Brain, Film, Layers, Zap, MousePointer, Download, Undo2,
  Copy, Search, Target, Network, Terminal,
  CheckCircle2, HardDrive,
} from 'lucide-react'
import {
  AnimatedSection, TechBadge, FeatureCard, fadeUp, stagger, CodeBlock,
} from './shared'

export const TabOverview: React.FC = () => {
  const navigate = useNavigate()

  const features = [
    { icon: <Layers size={18} />, title: 'Canvas interactif 3 couches', desc: 'Konva.js : image de fond, annotations (BBox + polygones), overlay interactif (SAM points, masques streamés).', color: 'bg-blue-500/20 text-blue-400' },
    { icon: <Film size={18} />, title: 'Timeline sparse', desc: 'Cellules virtualisees vert/rouge avec compteur d annotations en direct, selection batch Ctrl/Shift + Suppr.', color: 'bg-purple-500/20 text-purple-400' },
    { icon: <Network size={18} />, title: 'Propagation multi-méthodes', desc: 'SAMURAI, Detect. GD/SAM3, homographie XFeat/SIFT et flux optique.', color: 'bg-orange-500/20 text-orange-400' },
    { icon: <Target size={18} />, title: 'Annotation par texte', desc: 'Grounding DINO détecte les objets par description textuelle, SAM2 raffine en masques précis.', color: 'bg-green-500/20 text-green-400' },
    { icon: <Download size={18} />, title: 'Export YOLO', desc: 'Format YOLO v8 avec split train/val/test configurable, data.yaml généré, coordonnées normalisées [0,1].', color: 'bg-cyan-500/20 text-cyan-400' },
    { icon: <Undo2 size={18} />, title: 'Undo / Redo (50 niveaux)', desc: 'Snapshots JSON complets par frame, restauration instantanée, persistance de session toutes les 2 minutes.', color: 'bg-pink-500/20 text-pink-400' },
    { icon: <Copy size={18} />, title: 'Copier / Coller', desc: "Copie des annotations entre frames, presse-papier persistant dans la session d'annotation.", color: 'bg-yellow-500/20 text-yellow-400' },
    { icon: <Search size={18} />, title: 'NMS & détection doublons', desc: "Non-Maximum Suppression configurable (seuil IoU) et détection d'overlaps entre annotations.", color: 'bg-red-500/20 text-red-400' },
  ]

  const shortcuts = [
    { key: 'A', action: 'Outil Sélection' },
    { key: 'R', action: 'Outil Rectangle (bounding box)' },
    { key: 'P', action: 'Outil Polygone (segmentation)' },
    { key: 'S', action: 'Outil Point SAM' },
    { key: 'V', action: 'Bascule le mode review rapide' },
    { key: 'Clic milieu', action: 'Panorama (pan) de la vue' },
    { key: '← / →', action: 'Frame précédente / suivante' },
    { key: '1–9', action: 'Sélectionner une classe (si une touche lui est assignée)' },
    { key: 'Del', action: 'Supprimer annotation(s) sélectionnée(s)' },
    { key: 'Ctrl+Z / Y', action: 'Annuler / Rétablir (50 niveaux)' },
    { key: 'Ctrl+C / V', action: 'Copier / Coller annotations' },
    { key: 'Échap', action: 'Annuler dessin en cours / Désélectionner' },
    { key: 'Shift+clic', action: 'Multi-sélection dans la liste' },
    { key: 'Double-clic box', action: '(Dé)marquer la box comme cible de tracking' },
  ]

  const yoloBboxStructure = `dataset/
├── train/
│   ├── images/
│   │   └── frame_0001.jpg
│   └── labels/           # Bounding box
│       └── frame_0001.txt
├── val/   └── test/
└── data.yaml

# data.yaml
path: /dataset
train: train/images
val:   val/images
nc: 3
names: [voiture, personne, velo]

# labels/frame_0001.txt — une ligne par objet
# class_id  cx    cy    w     h      (coords normalisées [0,1])
0           0.512 0.438 0.234 0.312
1           0.210 0.680 0.115 0.220`

  const yoloSegStructure = `dataset/
├── train/
│   ├── images/
│   │   └── frame_0001.jpg
│   └── seg_labels/       # Segmentation (polygones)
│       └── frame_0001.txt
└── seg_data.yaml

# seg_data.yaml — même format que data.yaml

# seg_labels/frame_0001.txt — une ligne par objet
# class_id  x1    y1    x2    y2    x3    y3    ...  (polygone normalisé)
0           0.51  0.42  0.54  0.40  0.58  0.43  0.55 0.47
1           0.21  0.67  0.25  0.65  0.28  0.70  ...`

  const apiEndpoints: [string, string, string][] = [
    ['GET',  '/api/projects',                           'Liste des projets'],
    ['POST', '/api/projects',                           'Créer un projet'],
    ['POST', '/api/projects/{id}/import/images',        'Upload images (multipart)'],
    ['POST', '/api/projects/{id}/import/video',         'Import vidéo → frames (ffmpeg)'],
    ['GET',  '/api/frames/{id}/annotations',            "Annotations d'une frame"],
    ['POST', '/api/frames/{id}/annotations',            'Créer une annotation'],
    ['POST', '/api/frames/{id}/annotations/bulk',       'Remplacer toutes les annotations'],
    ['POST', '/api/frames/{id}/annotations/nms',        'Non-Maximum Suppression'],
    ['POST', '/api/sam/predict/points',                 'SAM2 — prédiction par points'],
    ['POST', '/api/sam/predict/text',                   'Grounding DINO + SAM2'],
    ['WS',   '/ws/sam/stream/{frame_id}',               'WebSocket — auto-segmentation streamée'],
    ['POST', '/api/projects/{id}/homography/propagate', 'Propagation homographie / flux optique'],
    ['POST', '/api/projects/{id}/export',               'Export YOLO (tâche async)'],
    ['GET',  '/api/exports/{task_id}/status',           'Statut tâche export'],
    ['GET',  '/api/exports/{task_id}/download',         'Télécharger le ZIP export'],
    ['GET',  '/health',                                 'Santé du serveur + état SAM/DINO'],
  ]

  return (
    <div className="space-y-16 px-6 py-10 max-w-5xl mx-auto">
      {/* Hero */}
      <AnimatedSection className="text-center">
        <motion.div variants={fadeUp} className="flex items-center justify-center gap-3 mb-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-xl">
            <Brain size={28} className="text-white" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            AnnotationApp
          </h1>
        </motion.div>
        <motion.p variants={fadeUp} className="text-slate-400 max-w-xl mx-auto mb-6 text-sm leading-relaxed">
          Application web d'annotation semi-automatique de datasets visuels avec assistance IA.
          Deux modes : <strong className="text-white">Random Image</strong> pour les jeux de données
          non-séquentiels, <strong className="text-white">Séquence Image</strong> pour les vidéos
          avec propagation automatique des labels.
        </motion.p>
        <motion.div variants={stagger} className="flex flex-wrap justify-center gap-2 mb-6">
          <TechBadge label="SAM2" color="border-blue-500/50 text-blue-300 bg-blue-500/10" />
          <TechBadge label="Grounding DINO" color="border-green-500/50 text-green-300 bg-green-500/10" />
          <TechBadge label="XFeat / SIFT" color="border-orange-500/50 text-orange-300 bg-orange-500/10" />
          <TechBadge label="Lucas-Kanade Optflow" color="border-teal-500/50 text-teal-300 bg-teal-500/10" />
          <TechBadge label="YOLO Export" color="border-cyan-500/50 text-cyan-300 bg-cyan-500/10" />
          <TechBadge label="FastAPI + SQLite" color="border-emerald-500/50 text-emerald-300 bg-emerald-500/10" />
          <TechBadge label="React + Konva.js" color="border-slate-500/50 text-slate-300 bg-slate-500/10" />
        </motion.div>
        <motion.button
          variants={fadeUp}
          onClick={() => navigate('/')}
          className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Créer un projet →
        </motion.button>
      </AnimatedSection>

      {/* Fonctionnalités */}
      <AnimatedSection>
        <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Zap size={16} className="text-cyan-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Fonctionnalités Clés</h2>
        </motion.div>
        <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((f) => <FeatureCard key={f.title} {...f} />)}
        </motion.div>
      </AnimatedSection>

      {/* Raccourcis */}
      <AnimatedSection>
        <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
            <MousePointer size={16} className="text-yellow-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Raccourcis Clavier</h2>
        </motion.div>
        <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/60">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-44">Touche</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {shortcuts.map((s, i) => (
                <tr key={s.key} className={`border-b border-slate-800 ${i % 2 === 0 ? 'bg-slate-900/20' : ''}`}>
                  <td className="px-5 py-2.5">
                    <kbd className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-xs font-mono text-white">{s.key}</kbd>
                  </td>
                  <td className="px-5 py-2.5 text-slate-300 text-xs">{s.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </AnimatedSection>

      {/* Export YOLO */}
      <AnimatedSection>
        <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Terminal size={16} className="text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Format de Sortie — YOLO v8</h2>
        </motion.div>

        {/* Bbox */}
        <motion.p variants={fadeUp} className="text-sm font-semibold text-emerald-300 mb-2">
          Detection — Bounding Box
        </motion.p>
        <motion.div variants={fadeUp} className="mb-4">
          <CodeBlock code={yoloBboxStructure} color="text-emerald-300" label="dataset_bbox.zip" />
        </motion.div>
        <motion.p variants={fadeUp} className="text-xs text-slate-400 mb-6 leading-relaxed">
          Chaque ligne de label = <code className="text-emerald-300 bg-slate-800 px-1 rounded">class_id cx cy w h</code> avec toutes les coordonnées normalisées dans <code className="text-emerald-300 bg-slate-800 px-1 rounded">[0, 1]</code>.
          Le centre <code className="text-slate-300 bg-slate-800 px-1 rounded">cx cy</code> est relatif à la largeur/hauteur de l'image.
          Compatible directement avec <strong className="text-white">YOLOv8 detect</strong>, YOLOv5, YOLOv9.
        </motion.p>

        {/* Segmentation */}
        <motion.p variants={fadeUp} className="text-sm font-semibold text-cyan-300 mb-2">
          Segmentation — Polygones
        </motion.p>
        <motion.div variants={fadeUp} className="mb-4">
          <CodeBlock code={yoloSegStructure} color="text-cyan-300" label="dataset_seg.zip" />
        </motion.div>
        <motion.p variants={fadeUp} className="text-xs text-slate-400 mb-6 leading-relaxed">
          Chaque ligne = <code className="text-cyan-300 bg-slate-800 px-1 rounded">class_id x1 y1 x2 y2 … xN yN</code>.
          Les points du polygone sont les contours de l'objet normalisés dans <code className="text-cyan-300 bg-slate-800 px-1 rounded">[0, 1]</code>.
          Généré automatiquement quand des annotations de type <strong className="text-white">polygone</strong> sont présentes.
          Compatible avec <strong className="text-white">YOLOv8 segment</strong>.
        </motion.p>

        <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Coordonnées normalisées', desc: 'cx cy w h dans [0,1] pour bbox. x1 y1 … xN yN pour polygones. Jamais de pixels en base.', color: 'text-emerald-400' },
            { label: 'Split configurable', desc: 'Ratio train/val/test personnalisable. Stratification par projet pour un split équilibré.', color: 'text-emerald-400' },
            { label: 'data.yaml auto', desc: 'Généré avec mapping classe_index → nom de classe. Un fichier par format (bbox et seg).', color: 'text-emerald-400' },
          ].map((item) => (
            <motion.div key={item.label} variants={fadeUp} className="flex items-start gap-3 bg-slate-800/40 border border-slate-700 rounded-xl p-4">
              <span className={`${item.color} mt-0.5 flex-shrink-0`}><CheckCircle2 size={14} /></span>
              <div>
                <p className="text-xs font-semibold text-white mb-1">{item.label}</p>
                <p className="text-xs text-slate-400">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </AnimatedSection>

      {/* Import et chargement des frames */}
      <AnimatedSection>
        <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <HardDrive size={16} className="text-violet-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Import des Sources — Architecture de Stockage</h2>
        </motion.div>

        <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {[
            {
              title: 'Provenance serveur (zéro copie)',
              color: 'border-violet-700 bg-violet-900/20',
              titleColor: 'text-violet-300',
              points: [
                'MP4 serveur : scan lazy des métadonnées → extraction JPEG en arrière-plan dans data/projects/{id}/frames/.',
                'Dossier images serveur : lien symbolique par défaut (aucune copie), ou copie optionnelle.',
                'Format optionnel serveur : traitement délégué à l’adaptateur détecté, sans logique propriétaire dans le frontend.',
                'Barre de progression commune à toutes les sources séquentielles.',
              ],
            },
            {
              title: 'Upload local (réseau → disque)',
              color: 'border-blue-700 bg-blue-900/20',
              titleColor: 'text-blue-300',
              points: [
                'MP4 upload : envoi par chunks de N MB (défaut 8 MB). RAM Python max = N MB, même pour 10 Go.',
                'Format optionnel : upload par chunks, puis traitement défini par son adaptateur backend.',
                'Images upload : batch multipart, format d\'origine préservé (PNG → PNG, JPG → JPG, aucune recompression).',
                'Aucune miniature generee : la timeline affiche des compteurs d annotations (vert/rouge), zero cout d extraction.',
              ],
            },
            {
              title: 'Adaptateurs de format optionnels',
              color: 'border-orange-700 bg-orange-900/20',
              titleColor: 'text-orange-300',
              points: [
                'Chaque adaptateur est un fichier Python autonome avec métadonnées et fonctions de lecture.',
                'Le frontend interroge /api/capabilities et ne connaît aucun nom de format en dur.',
                'Supprimer un adaptateur retire son extension du glisser-déposer sans bloquer le démarrage.',
                'Les formats présents restent compatibles avec le chemin serveur et l’upload navigateur.',
              ],
            },
            {
              title: 'Navigation et RAM — 0 octet conservé',
              color: 'border-emerald-700 bg-emerald-900/20',
              titleColor: 'text-emerald-300',
              points: [
                'Navigateur web : image HTTP à la volée. VisionNexus Electron : app-image tente le chemin natif local/SMB, puis replie automatiquement sur HTTP. Aucune frame pré-chargée en RAM Python.',
                'RAM extraction : 1 frame décodée à la fois (~6 MB pour 1080p, ~25 MB pour 4K). Libérée après écriture.',
                'Metadonnees chargees en une passe large, timeline virtualisee sans vignettes : seules les cellules visibles sont rendues.',
                'Export symlink (défaut) : dossier YOLO avec liens, 0 copie d\'image. Export copie → ZIP téléchargeable.',
              ],
            },
          ].map((card) => (
            <motion.div key={card.title} variants={fadeUp} className={`border rounded-xl p-4 ${card.color}`}>
              <p className={`text-xs font-semibold mb-3 ${card.titleColor}`}>{card.title}</p>
              <ul className="space-y-1.5">
                {card.points.map((pt, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="text-slate-500 flex-shrink-0 mt-0.5">›</span>
                    {pt}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </AnimatedSection>

      {/* API REST */}
      <AnimatedSection>
        <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <Terminal size={16} className="text-blue-400" />
          </div>
          <h2 className="text-xl font-bold text-white">API REST — Résumé des Endpoints</h2>
        </motion.div>
        <motion.div variants={fadeUp} className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700 bg-slate-800/60">
            <span className="text-xs text-slate-500 font-mono">http://localhost:8000</span>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-0 text-xs font-mono">
            {apiEndpoints.map(([method, path, desc], i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 border-b border-slate-800 last:border-0">
                <span className={`flex-shrink-0 w-10 font-bold ${method === 'GET' ? 'text-green-400' : method === 'WS' ? 'text-yellow-400' : 'text-blue-400'}`}>
                  {method}
                </span>
                <span className="text-slate-300 flex-shrink-0 text-[10px] leading-relaxed">{path}</span>
                <span className="text-slate-500 text-[10px] ml-auto hidden lg:block">{desc}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatedSection>
    </div>
  )
}
