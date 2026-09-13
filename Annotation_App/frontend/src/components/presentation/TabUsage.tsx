// ============================================================
// components/presentation/TabUsage.tsx
// Onglet Utilisation — sous-onglets Random Image / Séquence Image
// ============================================================

import React from 'react'
import { motion } from 'framer-motion'
import {
  Download, MousePointer, Brain, Settings, Film, ArrowRight,
  Route, Network,
} from 'lucide-react'
import type { SubTab } from './shared'
import {
  AnimatedSection, SubTabBar, InfoBox, PipelineStep, Arrow,
  fadeUp, stagger,
} from './shared'

// ============================================================
// Random Image
// ============================================================

const UsageRandom: React.FC = () => (
  <div className="space-y-8">
    {/* Import */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <Download size={14} className="text-blue-400" />
        </div>
        <h3 className="text-lg font-bold text-white">1. Import d'images</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-3">
        <p className="text-slate-300">Depuis la page des projets, créez un projet de type <strong className="text-white">Random Image</strong>, puis accédez à l'annotation. Cliquez sur <kbd className="px-2 py-0.5 bg-slate-700 rounded font-mono text-white">Importer des images</kbd> dans la barre latérale.</p>
        <ul className="list-disc list-inside space-y-1 text-slate-400">
          <li>Formats supportés : <strong className="text-white">JPEG, PNG, BMP, TIFF, WEBP</strong></li>
          <li>Upload multipart en lot — plusieurs fichiers sélectionnables en une fois</li>
          <li>Miniatures (160×90) générées automatiquement côté serveur</li>
          <li>Les images sont servies à <code className="px-1 bg-slate-700 rounded">/media/…</code></li>
        </ul>
        <InfoBox type="tip" title="Astuce organisation">
          Créez autant de classes que nécessaire via le bouton <strong>+ Classe</strong> avant de commencer l'annotation. Les classes sont associées au projet et numérotées 0…N-1 pour le format YOLO.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* Annotation manuelle */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center">
          <MousePointer size={14} className="text-green-400" />
        </div>
        <h3 className="text-lg font-bold text-white">2. Annotation manuelle</h3>
      </motion.div>
      <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-green-300">Bounding Box <kbd className="px-1.5 bg-slate-700 rounded font-mono text-white">R</kbd></p>
          <p className="text-slate-400">Activez l'outil Rectangle (<kbd className="px-1 bg-slate-700 rounded font-mono text-white">R</kbd>), puis <strong>cliquez-glissez</strong> sur le canvas pour dessiner une bbox. Relâchez pour valider. La bbox est sauvegardée automatiquement en YOLO normalisé (cx cy w h).</p>
          <p className="text-slate-400">Pour modifier : <strong>sélectionnez</strong> (<kbd className="px-1 bg-slate-700 rounded font-mono text-white">V</kbd>) → poignées de redimensionnement + déplacement. <kbd className="px-1 bg-slate-700 rounded font-mono text-white">Del</kbd> pour supprimer.</p>
        </motion.div>
        <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-purple-300">Polygone <kbd className="px-1.5 bg-slate-700 rounded font-mono text-white">P</kbd></p>
          <p className="text-slate-400">Activez l'outil Polygone (<kbd className="px-1 bg-slate-700 rounded font-mono text-white">P</kbd>), puis <strong>cliquez</strong> pour ajouter des sommets. <strong>Double-clic</strong> ou clic sur le premier point pour fermer le polygone.</p>
          <p className="text-slate-400">Utile pour la segmentation précise. Les points du polygone sont sérialisés en JSON dans la DB (coordonnées normalisées).</p>
        </motion.div>
      </motion.div>
    </AnimatedSection>

    {/* Annotation IA */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Brain size={14} className="text-purple-400" />
        </div>
        <h3 className="text-lg font-bold text-white">3. Annotation assistée par IA</h3>
      </motion.div>
      <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-green-300">Grounding DINO <kbd className="px-1.5 bg-slate-700 rounded font-mono text-white">T</kbd></p>
          <p className="text-slate-400">Tapez un prompt textuel dans la toolbar (ex: <code className="bg-slate-700 px-1 rounded">voiture. personne. vélo.</code>) et appuyez sur Entrée. DINO détecte les bounding boxes, SAM2 les raffine en masques.</p>
          <p className="text-slate-400">Paramètres : <strong className="text-white">box_threshold</strong> (confiance détection, 0.3–0.5) et <strong className="text-white">text_threshold</strong> (lien texte-objet, 0.2–0.4).</p>
        </motion.div>
        <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-blue-300">SAM2 Points <kbd className="px-1.5 bg-slate-700 rounded font-mono text-white">S</kbd></p>
          <p className="text-slate-400"><strong>Clic gauche</strong> = point foreground (l'objet est ici). <strong>Clic droit</strong> = point background (pas ici). SAM2 génère le masque en temps réel et le convertit en bbox ou polygone selon le mode.</p>
          <p className="text-slate-400">Ajoutez plusieurs points pour affiner le masque avant validation.</p>
        </motion.div>
        <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-orange-300">SAM2 Auto <kbd className="px-1.5 bg-slate-700 rounded font-mono text-white">A</kbd></p>
          <p className="text-slate-400">Segmente l'intégralité de l'image sans aucun prompt. Les masques sont streamés via WebSocket et affichés progressivement. Passez en mode review pour filtrer les résultats.</p>
          <p className="text-slate-400">Idéal pour démarrer rapidement sur des images denses.</p>
        </motion.div>
      </motion.div>
    </AnimatedSection>

    {/* Interactions & Boutons */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/20 flex items-center justify-center">
          <Settings size={14} className="text-yellow-400" />
        </div>
        <h3 className="text-lg font-bold text-white">4. Interactions et gestion des annotations</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="font-semibold text-yellow-300">Dans la liste sidebar</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong>Clic</strong> sur une annotation → sélection + mise en évidence canvas</li>
              <li><strong>Shift+clic</strong> → multi-sélection</li>
              <li><strong>Double-clic (sur une box du canvas)</strong> → (dé)marque la box comme cible de tracking, partagée entre tous les onglets Tracks. Pas de zoom automatique.</li>
              <li><strong>Clic sur la pastille de classe</strong> → changement de classe</li>
              <li><kbd className="px-1 bg-slate-700 rounded font-mono text-white">Del</kbd> → suppression des annotations sélectionnées</li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-yellow-300">Boutons de la sidebar</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong>NMS</strong> — Non-Maximum Suppression, supprime les doublons selon un seuil IoU (0.0–1.0).</li>
              <li><strong>Tout supprimer</strong> — supprime toutes les annotations de la frame courante (confirmation inline requise).</li>
              <li><strong>Copier frame</strong> — copie les annotations dans le presse-papier de session.</li>
              <li><strong>Coller</strong> — colle les annotations copiées sur la frame courante.</li>
              <li><strong>Undo/Redo</strong> — 50 niveaux d'historique via <kbd className="px-1 bg-slate-700 rounded font-mono text-white">Ctrl+Z</kbd> / <kbd className="px-1 bg-slate-700 rounded font-mono text-white">Ctrl+Y</kbd>.</li>
            </ul>
          </div>
        </div>
        <InfoBox type="info" title="Zoom & Navigation">
          La molette de souris zoome sur le canvas. <kbd className="px-1 bg-slate-700 rounded font-mono text-white">Space</kbd> + glisser pour se deplacer. Les miniatures du bas sont sparse : Ctrl/clic selectionne, Shift/clic selectionne une plage, Suppr vide les annotations selectionnees.
        </InfoBox>
      </motion.div>
    </AnimatedSection>
  </div>
)

// ============================================================
// Sequence Image
// ============================================================

const UsageSequence: React.FC = () => (
  <div className="space-y-8">
    {/* Import */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Film size={14} className="text-purple-400" />
        </div>
        <h3 className="text-lg font-bold text-white">1. Import vidéo ou dossier d'images</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="font-semibold text-purple-300 mb-2">Import vidéo MP4</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Drag & drop ou chemin serveur</li>
              <li>OpenCV extrait les frames une par une (jamais la vidéo entière en RAM)</li>
              <li>Frames stockées en <strong>JPEG</strong> dans <code className="bg-slate-700 px-1 rounded">data/projects/{'{id}'}/frames/</code></li>
              <li>Miniatures 160x90 generees a la demande pour la timeline</li>
              <li>Params : <code className="bg-slate-700 px-1 rounded">jpeg_quality</code>, <code className="bg-slate-700 px-1 rounded">frame_keep</code>, <code className="bg-slate-700 px-1 rounded">chunk_size_mb</code></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-purple-300 mb-2">Import dossier d'images</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Sélection multiple de fichiers images</li>
              <li>Triés par nom de fichier (ordre alphabétique)</li>
              <li>Même pipeline que la vidéo ensuite</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-orange-300 mb-2">Formats séquentiels optionnels</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Découverts automatiquement au démarrage du backend</li>
              <li>Extensions et libellés ajoutés dynamiquement au glisser-déposer</li>
              <li>Import immédiat ou conversion selon le contrat de l'adaptateur</li>
              <li>Absents de l'interface si aucun adaptateur n'est installé</li>
            </ul>
          </div>
        </div>

        {/* Bloc mémoire */}
        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-3">
          <p className="font-semibold text-purple-300">Gestion mémoire — comment fonctionne le chargement</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-slate-400">
            <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
              <p className="text-green-400 font-semibold mb-1">Upload (réseau → disque)</p>
              <p>La vidéo est reçue par <strong>chunks</strong> de <code className="bg-slate-700 px-1 rounded">chunk_size_mb</code> (défaut 8 MB) et écrite directement sur disque. Pour un MP4 de 10 Go : <strong>max 8 MB en RAM</strong>, jamais le fichier entier.</p>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
              <p className="text-blue-400 font-semibold mb-1">Extraction (disque → frames)</p>
              <p><code className="bg-slate-700 px-1 rounded">cv2.VideoCapture</code> décode <strong>1 frame à la fois</strong>. La RAM utilisée = 1 frame décodée = <code className="bg-slate-700 px-1 rounded">W × H × 3</code> octets (~6 MB pour 1080p, ~25 MB pour 4K). Libérée immédiatement après écriture JPEG.</p>
            </div>
            <div className="bg-slate-900/60 rounded-lg p-3 border border-slate-700">
              <p className="text-orange-400 font-semibold mb-1">Navigation frontend</p>
              <p>Les metadonnees des frames sont chargees en une passe large (pagination automatique jusqu'a epuisement), mais la timeline ne rend que les cellules visibles. Elle n'affiche AUCUNE vignette : vert = frame annotee avec son compteur, rouge = frame vide. Pendant le scrubbing et la propagation, le canvas bascule sur des previews JPEG 480 px (~15 Ko) — indispensable en acces distant SSH.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-400">
            <div>
              <p className="font-semibold text-slate-300 mb-1">Hyperparamètres d'extraction</p>
              <ul className="list-disc list-inside space-y-1">
                <li><code className="bg-slate-700 px-1 rounded">target_fps</code> — FPS d'extraction. <strong>Ex: 1.0 sur une vidéo 30fps → 30× moins de frames.</strong> Réduire pour économiser disque et annotation.</li>
                <li><code className="bg-slate-700 px-1 rounded">max_frames</code> — Plafond absolu (défaut 10 000). Protection contre les vidéos très longues.</li>
                <li><code className="bg-slate-700 px-1 rounded">jpeg_quality</code> — Qualité JPEG des frames (50–95, défaut 85). N'affecte pas la RAM, seulement la taille disque. 85 = bon compromis. 95 = fidélité maximale pour les annotations précises.</li>
                <li><code className="bg-slate-700 px-1 rounded">chunk_size_mb</code> — Taille des chunks d'upload (défaut 8 MB). Uniquement pour l'upload réseau.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-slate-300 mb-1">Estimation rapide de la taille disque</p>
              <ul className="list-disc list-inside space-y-1">
                <li>1 frame 1080p JPEG q=85 ≈ <strong>200–400 KB</strong></li>
                <li>1000 frames ≈ <strong>200–400 MB</strong></li>
                <li>Vidéo 60s à 30fps = 1800 frames → ~500 MB</li>
                <li>Avec <code className="bg-slate-700 px-1 rounded">target_fps=5</code> → 300 frames → ~80 MB</li>
                <li>Les miniatures (160×90) ajoutent ~5 KB/frame</li>
              </ul>
            </div>
          </div>
        </div>

        <InfoBox type="info" title="Différence avec Random Image">
          Le mode Séquence Image active l'onglet <strong>Tracks</strong> dans la sidebar, la timeline de frames en bas du canvas, et les outils de propagation. Ces fonctionnalités sont cachées en mode Random Image.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* Navigation frames */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <ArrowRight size={14} className="text-blue-400" />
        </div>
        <h3 className="text-lg font-bold text-white">2. Navigation entre frames</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-2 text-slate-400">
        <ul className="list-disc list-inside space-y-1">
          <li><kbd className="px-1 bg-slate-700 rounded font-mono text-white">← / →</kbd> — frame précédente / suivante (raccourcis clavier)</li>
          <li>Clic sur une miniature dans la <strong>timeline</strong> en bas du canvas pour naviguer directement</li>
          <li>Les miniatures annotees affichent un badge vert avec le nombre d'annotations</li>
          <li>Pendant une propagation, la <strong>barre verte en haut de la page</strong> indique la frame en cours de traitement en temps réel</li>
        </ul>
      </motion.div>
    </AnimatedSection>

    {/* Workflow annotation + propagation */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center">
          <Route size={14} className="text-orange-400" />
        </div>
        <h3 className="text-lg font-bold text-white">3. Workflow : Annoter → Propager</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-6 text-xs space-y-4">
        <motion.div variants={stagger} className="flex flex-wrap items-center gap-3 justify-center mb-4">
          <PipelineStep label="Frame de référence" sub="1ère ou keyframe" color="border-blue-600/50 bg-blue-900/20" />
          <Arrow />
          <PipelineStep label="Annotation" sub="SAM2 / DINO / manuel" color="border-purple-600/50 bg-purple-900/20" />
          <Arrow />
          <PipelineStep label="Propagation" sub="Detect. / Assoc. / SAMURAI" color="border-orange-600/50 bg-orange-900/20" />
          <Arrow />
          <PipelineStep label="Vérification" sub="Review + correction" color="border-yellow-600/50 bg-yellow-900/20" />
          <Arrow />
          <PipelineStep label="Export YOLO" sub="split par frame" color="border-green-600/50 bg-green-900/20" />
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-orange-800/40">
            <p className="font-semibold text-orange-300 mb-2">Detect. + association</p>
            <p className="text-slate-400">Annotez une frame de référence, puis lancez <strong>Tracks → Detect.</strong>. L'algorithme utilise Grounding DINO ou SAM3 sur les frames suivantes et associe les détections par distance minimale / IoU.</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-orange-800/40">
            <p className="font-semibold text-orange-300 mb-2">Propagation Homographie</p>
            <p className="text-slate-400">Onglet <strong>Tracks → Homogr.</strong> — warpe les annotations de la frame courante vers les suivantes en estimant le mouvement global de la caméra (XFeat GPU ou SIFT CPU).</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-orange-800/40">
            <p className="font-semibold text-orange-300 mb-2">Propagation Flux Optique</p>
            <p className="text-slate-400">Onglet <strong>Tracks → Flux opt.</strong> — suit chaque bbox individuellement via Lucas-Kanade. Adapte la taille des boxes si l'objet s'approche ou s'éloigne. Idéal pour véhicules, piétons.</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-yellow-800/40">
            <p className="font-semibold text-yellow-300 mb-2">SAMURAI (SAM2 + Kalman)</p>
            <p className="text-slate-400">Onglet <strong>Tracks → SAMURAI</strong> — double-clic sur la cible pour la marquer, puis lancez la propagation. Les boxes apparaissent <strong>frame par frame en temps réel</strong>. Boutons Stop et Pause disponibles à tout moment. SAMURAI résiste aux occlusions grâce au filtre de Kalman.</p>
          </div>
        </div>
      </motion.div>
    </AnimatedSection>

    {/* Gestion des tracks */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center">
          <Network size={14} className="text-teal-400" />
        </div>
        <h3 className="text-lg font-bold text-white">4. Gestion des Tracks</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-3 text-slate-400">
        <p className="text-slate-300">L'onglet <strong className="text-white">Tracks</strong> (sidebar) liste tous les tracks du projet. Un track regroupe les annotations d'un même objet à travers les frames.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="font-semibold text-teal-300 mb-1">Actions disponibles</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Renommer un track</li>
              <li>Fusionner deux tracks (opération par paire)</li>
              <li>Supprimer un track (et toutes ses annotations)</li>
              <li><strong>"Tout suppr."</strong> — supprime tous les tracks d'un coup</li>
              <li>Naviguer vers la frame d'une annotation de track</li>
              <li>Stop/Pause pendant la propagation SAMURAI</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-teal-300 mb-1">Nettoyage timeline</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Barre blanche = frame courante sur chaque piste ; % à droite = frames explorées par le tracker</li>
              <li>Clic sur un bloc coloré → le sélectionne (Suppr efface ce bloc) ; double-clic → fin du bloc</li>
              <li>Clic sur le gris / bouton global → supprime toute la piste (les uids restants sont renumérotés)</li>
            </ul>
          </div>
        </div>
        <InfoBox type="tip" title="Workflow recommandé">
          1. Annotez 1-3 frames de reference reparties dans la video. 2. Lancez SAMURAI ou Detect. selon le cas. 3. Utilisez Homographie ou Flux optique pour compenser le mouvement camera. 4. Corrigez et nettoyez la timeline (blocs / pistes). 5. Exportez.
        </InfoBox>
      </motion.div>
    </AnimatedSection>
  </div>
)

// ============================================================
// Export
// ============================================================

interface TabUsageProps {
  subTab: SubTab
  onSubTabChange: (t: SubTab) => void
}

export const TabUsage: React.FC<TabUsageProps> = ({ subTab, onSubTabChange }) => (
  <>
    <SubTabBar active={subTab} onChange={onSubTabChange} />
    {subTab === 'random' && <UsageRandom />}
    {subTab === 'sequence' && <UsageSequence />}
  </>
)
