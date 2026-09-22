// ============================================================
// components/presentation/TabTechnical.tsx
// Onglet Technique & Méthodes — sous-onglets Random / Séquence
// ============================================================

import React from 'react'
import { motion } from 'framer-motion'
import {
  Target, ScanSearch, Brain, Route, Wind, Clock, CheckCircle2, Zap,
} from 'lucide-react'
import type { SubTab } from './shared'
import {
  AnimatedSection, SubTabBar, InfoBox, CodeBlock, ParamRow,
  fadeUp,
} from './shared'

// ============================================================
// Technique — Random Image
// ============================================================

const TechRandom: React.FC = () => (
  <div className="space-y-8">
    {/* Grounding DINO */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center">
          <Target size={14} className="text-green-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Grounding DINO — Détection par texte</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">Grounding DINO (<em>IDEA-Research/grounding-dino-tiny</em>, ~340 MB) est un modèle de détection open-vocabulary basé sur DINO (DETR amélioré). Il prend une image et un <strong>prompt textuel</strong> en entrée, et retourne des bounding boxes avec scores pour chaque objet correspondant au texte.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-green-800/40 space-y-2">
            <p className="font-semibold text-green-300">Architecture</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Encodeur image : Swin Transformer</li>
              <li>Encodeur texte : BERT</li>
              <li>Cross-attention image ↔ texte dans le décodeur</li>
              <li>Sortie : N boxes avec scores de confiance</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-green-800/40 space-y-2">
            <p className="font-semibold text-green-300">Hyperparamètres</p>
            <div className="space-y-2 mt-1">
              <ParamRow name="box_threshold" default_="0.35" desc="Seuil de confiance pour conserver une détection. Baisser pour détecter plus (plus de faux positifs). Monter pour filtrer les détections faibles." />
              <ParamRow name="text_threshold" default_="0.25" desc="Seuil de cohérence texte-boîte. Contrôle l'alignement entre le prompt et la région détectée. Généralement légèrement inférieur à box_threshold." />
            </div>
          </div>
        </div>
        <InfoBox type="tip" title="Rédaction du prompt">
          Séparez les classes par des points : <code className="bg-slate-700 px-1 rounded">voiture. camion. moto.</code> — le point est le séparateur de classe dans Grounding DINO. Évitez les phrases longues. Les noms communs donnent de meilleurs résultats que les descriptions.
        </InfoBox>
        <InfoBox type="warn" title="Disponibilité">
          Le service Grounding DINO est optionnel. Si <code className="bg-slate-700 px-1 rounded">transformers</code> n'est pas installé, tous les endpoints retournent <strong>503</strong>. Vérifiez <code className="bg-slate-700 px-1 rounded">GET /api/sam/grounding/status</code>.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* SAM2 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
          <ScanSearch size={14} className="text-blue-400" />
        </div>
        <h3 className="text-lg font-bold text-white">SAM2 — Segment Anything Model 2</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">SAM2 (Meta, 2024) est un modèle de segmentation universel. Il accepte des <strong>points</strong>, des <strong>bboxes</strong> ou aucun prompt (auto) et génère un masque binaire précis. La variante utilisée est <em>sam2.1_hiera_small</em> (fallback <em>tiny</em> sur CPU).</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-blue-800/40">
            <p className="font-semibold text-blue-300 mb-2">Mode Points (interactif)</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Points foreground (<code className="bg-slate-700 px-1 rounded">label=1</code>) : inclus dans le masque</li>
              <li>Points background (<code className="bg-slate-700 px-1 rounded">label=0</code>) : exclus</li>
              <li>Masque recalculé à chaque ajout de point</li>
              <li>Résultat validé → annotation créée (bbox ou polygone)</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-blue-800/40">
            <p className="font-semibold text-blue-300 mb-2">Mode Auto-segmentation</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Grille de points automatique sur toute l'image</li>
              <li>Masques streamés via WebSocket en temps réel</li>
              <li>NMS appliqué pour supprimer les doublons</li>
              <li>Filtrage par taille minimale de masque</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-blue-800/40">
            <p className="font-semibold text-blue-300 mb-2">Pipeline DINO → SAM2</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>DINO fournit des boxes grossières</li>
              <li>SAM2 raffine chaque box en masque précis</li>
              <li>Masque converti en polygone (Douglas-Peucker) ou bbox</li>
              <li>Source : <code className="bg-slate-700 px-1 rounded">grounding_dino</code></li>
            </ul>
          </div>
        </div>
        <InfoBox type="info" title="Checkpoint requis">
          Le fichier <code className="bg-slate-700 px-1 rounded">backend/checkpoints/sam2.1_hiera_small.pt</code> est nécessaire. Sans lui, le serveur démarre mais les endpoints SAM retournent 503.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* SAM3 */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-pink-500/20 flex items-center justify-center">
          <Brain size={14} className="text-pink-400" />
        </div>
        <h3 className="text-lg font-bold text-white">SAM3.1 — Modèle de segmentation texte-guidée</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4 text-slate-400">
        <p className="text-slate-300">SAM3.1 est un modèle <strong>autonome</strong> de segmentation guidée par texte — il ne s'appuie <em>pas</em> sur Grounding DINO ni sur SAM2. C'est un modèle unifié qui prend une image + un prompt texte en entrée et retourne directement des masques de segmentation et des bounding boxes en une seule passe.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-pink-800/40 space-y-2">
            <p className="font-semibold text-pink-300">Architecture & API interne</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Checkpoint : <code className="bg-slate-700 px-1 rounded">sam3.1_hiera_large.pt</code></li>
              <li><code className="bg-slate-700 px-1 rounded">processor.set_image(img)</code> — encodage image une fois</li>
              <li><code className="bg-slate-700 px-1 rounded">processor.set_text_prompt(state, prompt)</code> — segmentation par prompt</li>
              <li>Retourne : <code className="bg-slate-700 px-1 rounded">masks</code>, <code className="bg-slate-700 px-1 rounded">boxes</code>, <code className="bg-slate-700 px-1 rounded">scores</code> directement</li>
              <li>Supporte 4M+ concepts open-vocabulary sans fine-tuning</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-pink-800/40 space-y-2">
            <p className="font-semibold text-pink-300">Comparaison avec GD + SAM2</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-white">GD + SAM2</strong> = deux modèles en pipeline : DINO détecte les boxes, SAM2 raffine en masques</li>
              <li><strong className="text-pink-300">SAM3.1</strong> = un seul modèle, détection ET segmentation en une passe</li>
              <li>SAM3.1 : plus compact, pas besoin de Grounding DINO installé</li>
              <li>Score filtré par <code className="bg-slate-700 px-1 rounded">box_threshold</code> côté backend avant retour</li>
            </ul>
          </div>
        </div>
        <div className="bg-slate-800/50 rounded-xl p-4 border border-pink-800/40">
          <p className="font-semibold text-pink-300 mb-2">Utilisations</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ul className="list-disc list-inside space-y-1">
              <li>Toolbar SAM3 — annotation frame courante par texte</li>
              <li>Batch auto-vidéo sur plage de frames</li>
            </ul>
            <ul className="list-disc list-inside space-y-1">
              <li>Detect. (onglet Tracks → Detect., algo GD ou SAM3)</li>
              <li>Ré-initialisation automatique après perte de track</li>
            </ul>
          </div>
        </div>
      </motion.div>
    </AnimatedSection>
  </div>
)

// ============================================================
// Technique — Séquence Image
// ============================================================

const TechSequence: React.FC = () => (
  <div className="space-y-8">
    {/* Detection + association */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Route size={14} className="text-purple-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Detect. — DINO/SAM3 + Matching</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">Le mode Detect. fait tourner Grounding DINO ou SAM3 sur les frames suivantes, puis associe les nouvelles détections aux cibles sélectionnées par distance de centroïde. C'est <strong>le même modèle et le même appel</strong> que le bouton Texte de la barre d'outils : seule la logique qui suit la détection change — là-bas tout ce qui est trouvé est conservé sans notion de piste, ici seules les détections rattachées à une cible sont gardées.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-purple-800/40 space-y-2">
            <p className="font-semibold text-purple-300">Principe de matching</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400">
              <li>Le détecteur génère N boîtes <strong>anonymes</strong> sur la frame</li>
              <li>Distance de centroïde (coords normalisées) entre chaque cible et ces boîtes — la référence est la boîte de la frame <strong>précédente</strong>, pas celle du départ</li>
              <li>Appariement <strong>glouton</strong>, cible par cible dans l'ordre : la plus proche encore libre, retenue seulement sous <code>Dist. max</code> (0,15 par défaut)</li>
              <li>Cible sans détection sous le seuil → anomalie <code>missing</code>, trou dans la piste</li>
              <li>Variation de surface {'>'} seuil → annotation créée mais signalée <code>size_variation</code></li>
              <li>Détections non appariées <strong>jetées</strong> : ce mode ne crée jamais de piste, il ne fait que continuer les vôtres</li>
              <li>Auto-stop optionnel : arrêt si trop de cibles perdues N frames de suite</li>
            </ol>
            <p className="text-slate-500 leading-snug">
              À ne pas confondre avec ByteTrack (endpoint séparé, badge <code>BT</code> sur les
              annotations) : celui-là fait bien une assignation hongroise sur IoU, avec buffer de
              pistes perdues et création de nouvelles pistes. Le mode Detect. ne crée jamais de piste.
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-purple-800/40 space-y-2">
            <p className="font-semibold text-purple-300">Dock Anom.</p>
            <p className="text-slate-400">Après chaque run, les frames problématiques sont stockées dans le registre de tâches. Le dock Anom. les liste pour une correction manuelle rapide :</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Cible perdue sur la frame (aucune détection sous <code>Dist. max</code>)</li>
              <li>Variation de surface excessive — souvent une boîte passée sur un objet voisin</li>
              <li>Échec du détecteur sur la frame</li>
            </ul>
          </div>
        </div>
      </motion.div>
    </AnimatedSection>

    {/* Homographie */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center">
          <ScanSearch size={14} className="text-orange-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Homographie XFeat / SIFT — Compensation caméra</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">L'homographie estime la <strong>matrice 3×3</strong> qui minimise l'erreur de reprojection des keypoints matchés entre deux frames. Elle modélise exclusivement le <em>mouvement global de la caméra</em> (panoramique, zoom, rotation).</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-orange-800/40 space-y-2">
            <p className="font-semibold text-orange-300">XFeat (GPU — recommandé)</p>
            <ParamRow name="xfeat_top_k" default_="4096" desc="Nombre de keypoints CNN extraits par image. Plus élevé = meilleure robustesse, plus lent." />
            <ParamRow name="xfeat_min_cossim" default_="0.82" desc="Seuil de similarité cosinus pour filtrer les faux matchs. Critique : une valeur trop basse provoque des homographies erronées." />
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-orange-800/40 space-y-2">
            <p className="font-semibold text-orange-300">RANSAC (commun XFeat & SIFT)</p>
            <ParamRow name="ransac_threshold" default_="3.0" desc="Tolérance en pixels pour qu'un match soit considéré inlier. Augmenter pour des vidéos compressées." />
            <ParamRow name="min_inlier_ratio" default_="0.5" desc="Ratio minimum d'inliers pour accepter l'homographie." />
            <ParamRow name="min_inlier_count" default_="30" desc="Plancher absolu d'inliers. En dessous, la frame est ignorée." />
          </div>
        </div>
        <InfoBox type="warn" title="Limitation fondamentale">
          L'homographie ne modélise que la caméra. Les objets en <strong>mouvement propre</strong> (véhicules, piétons) dérivent progressivement. Pour ces cas, utilisez le <strong>Flux Optique</strong>.
        </InfoBox>
      </motion.div>
    </AnimatedSection>

    {/* SAMURAI */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-yellow-500/20 flex items-center justify-center">
          <Zap size={14} className="text-yellow-400" />
        </div>
        <h3 className="text-lg font-bold text-white">SAMURAI — SAM2 + Filtre de Kalman (tracking vidéo robuste)</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">SAMURAI (<a href="https://github.com/yangchris11/samurai" target="_blank" rel="noopener noreferrer" className="text-yellow-400 underline">yangchris11/samurai</a>) est une extension officielle de SAM2 pour le suivi vidéo. Il conserve <strong>exactement la même API</strong> que le video predictor de SAM2 et ajoute un <strong>filtre de Kalman</strong> pour prédire la position de la cible entre les frames — ce qui le rend nettement plus robuste en présence d'occlusions partielles, de changements d'aspect ou de mouvements rapides.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-yellow-800/40 space-y-2">
            <p className="font-semibold text-yellow-300">Architecture</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li>Base : SAM2 video predictor (Meta, 2024)</li>
              <li>Ajout : filtre de Kalman sur les états de mémoire</li>
              <li>Prédit la position frame suivante même sans observation fiable</li>
              <li>Réduit les dérives et les pertes de cible lors des occlusions</li>
              <li>Compatible avec tous les checkpoints SAM2 (tiny, small, large)</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-yellow-800/40 space-y-2">
            <p className="font-semibold text-yellow-300">Workflow dans l'app</p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400">
              <li><strong className="text-white">Double-clic</strong> sur la cible dans le canvas → marque la frame de départ</li>
              <li>Onglet <strong className="text-white">Tracks → SAMURAI</strong> → bouton <strong>Propager</strong></li>
              <li>Les frames défilent une par une : les boxes apparaissent en temps réel</li>
              <li>Bouton <strong>Pause</strong> pour inspecter une frame, <strong>Stop</strong> (carré rouge, toujours visible sur la barre de progression) pour arrêter</li>
              <li><strong className="text-white">1 seule cible</strong> → SAMURAI (Kalman mono-cible). <strong className="text-white">Plusieurs cibles</strong> → bascule automatique en <strong>SAM2 multi-objets natif</strong> (le filtre de Kalman mono-état de SAMURAI ne gère qu'une cible).</li>
            </ol>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InfoBox type="tip" title="SAMURAI inclus (aucune installation)">
            SAMURAI est <strong>fourni avec l'application</strong> et chargé automatiquement avec SAM2 — rien à installer. C'est le mode de suivi vidéo par défaut de l'onglet Tracks.
          </InfoBox>
          <InfoBox type="info" title="Gestion VRAM / GPU automatique">
            Le device (CUDA/CPU) est détecté à l'import ; la session vidéo est ouverte puis fermée automatiquement après chaque propagation (<code className="bg-slate-700 px-1 rounded">close_video_session</code> en <em>finally</em>) pour éviter toute fuite de VRAM. Sur GPU sans SAM2, l'app bascule sur le checkpoint <strong>tiny</strong> / CPU.
          </InfoBox>
        </div>
      </motion.div>
    </AnimatedSection>

    {/* Flux Optique */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center">
          <Wind size={14} className="text-green-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Flux Optique Lucas-Kanade — Suivi objet-par-objet avec adaptation de taille</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">Contrairement à l'homographie, le flux optique LK suit le <strong>mouvement réel de chaque pixel</strong> entre deux frames. Chaque bbox est traquée indépendamment.</p>

        {/* Problème */}
        <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4">
          <p className="font-semibold text-red-300 mb-2">Problème : translation naïve = taille figée</p>
          <p className="text-slate-400 mb-3">Une implémentation naïve calcule la médiane (dx, dy) des déplacements LK et translate le centre de la bbox. La taille reste <em>constante</em> — si l'objet se rapproche ou s'éloigne, la bbox ne suit pas le changement d'échelle.</p>
          <CodeBlock code={`// Naïf : dx/dy médian → translate seulement\ndx = median(pts_next - pts_prev)\nnew_bbox = (cx + dx, cy + dy, w_inchangé, h_inchangé)  // MAUVAIS`} color="text-red-300" />
        </div>

        {/* Solution */}
        <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-4">
          <p className="font-semibold text-green-300 mb-2">Solution : 4 coins + transformation affine partielle</p>
          <ol className="list-decimal list-inside space-y-2 text-slate-400 mb-3">
            <li><strong className="text-white">29 points trackés</strong> — les 4 coins de la bbox + une grille 5×5 intérieure (marge 15%)</li>
            <li><strong className="text-white">Estimation affine partielle</strong> — <code className="bg-slate-700 px-1 rounded">cv2.estimateAffinePartial2D</code> (RANSAC). Encode <em>translation + rotation + facteur d'échelle</em></li>
            <li><strong className="text-white">Application aux coins</strong> — la matrice 2×3 transforme les 4 coins originaux. La nouvelle bbox = rectangle englobant des coins transformés → <strong>taille adaptative</strong></li>
            <li><strong className="text-white">Fallback</strong> — si trop peu d'inliers, retour à la translation médiane</li>
          </ol>
          <CodeBlock code={`// Corrigé : affine partielle → taille adaptative\npts = [4 coins + grille 5x5]           # 29 points\nM, mask = estimateAffinePartial2D(src, dst, RANSAC)  # scale + rot + transl\nnew_corners = (M @ corners_h.T).T       # coins transformés (4, 2)\nnew_bbox = bounding_box(new_corners)    # taille change naturellement`} color="text-green-300" />
        </div>

        {/* Paramètres */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800/50 rounded-xl p-4 border border-green-800/40">
            <p className="font-semibold text-green-300 mb-2">win_size</p>
            <p className="text-slate-400">Fenêtre de recherche LK (défaut <kbd className="px-1 bg-slate-700 rounded font-mono text-white">21</kbd>). ↑ robuste au bruit. ↓ précis petits objets.<br /><strong className="text-white">Réglage :</strong> 15–21 scènes nettes, 25–31 vidéo compressée.</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-green-800/40">
            <p className="font-semibold text-green-300 mb-2">max_level</p>
            <p className="text-slate-400">Niveaux pyramidaux LK (défaut <kbd className="px-1 bg-slate-700 rounded font-mono text-white">3</kbd>). ↑ captures grands déplacements. ↓ plus rapide.<br /><strong className="text-white">Réglage :</strong> 2 pour &gt;30fps, 4 pour timelapse.</p>
          </div>
          <div className="bg-slate-800/50 rounded-xl p-4 border border-green-800/40">
            <p className="font-semibold text-green-300 mb-2">min_pts</p>
            <p className="text-slate-400">Points min. de validation (défaut <kbd className="px-1 bg-slate-700 rounded font-mono text-white">4</kbd>). Si {'<'} N points bien suivis → bbox inchangée.<br /><strong className="text-white">Réglage :</strong> 2–3 petits objets, 8+ zones sans texture.</p>
          </div>
        </div>

        {/* Comparaison */}
        <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={14} className="text-blue-400" />
            <span className="font-semibold text-blue-300">Quand utiliser flux optique vs homographie</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-green-400 font-semibold mb-1">Flux optique si :</p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                <li>Objets en mouvement propre (véhicules, piétons)</li>
                <li>Caméra statique ou quasi-statique</li>
                <li>Objets qui changent de taille (se rapprochent)</li>
              </ul>
            </div>
            <div>
              <p className="text-orange-400 font-semibold mb-1">Homographie si :</p>
              <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                <li>Caméra en mouvement (panoramique, zoom)</li>
                <li>Objets quasi-statiques dans la scène</li>
                <li>Compensation de stabilisation vidéo</li>
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatedSection>

    {/* Interpolation */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center">
          <Clock size={14} className="text-cyan-400" />
        </div>
        <h3 className="text-lg font-bold text-white">Interpolation linéaire — Complétion entre deux keyframes</h3>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs space-y-4">
        <p className="text-slate-300">L'interpolation génère des annotations intermédiaires entre deux frames annotées pour un même track. Les coordonnées YOLO (cx, cy, w, h) sont interpolées linéairement.</p>
        <CodeBlock code={`t = (frame_i - frame_start) / (frame_end - frame_start)  # [0, 1]\nbbox_i = lerp(bbox_start, bbox_end, t)\nconfidence_i = lerp(conf_start, conf_end, t)  # decay progressif`} color="text-cyan-300" />
        <InfoBox type="warn" title="Limitation">
          Suppose un mouvement <strong>uniforme</strong>. Pour des trajectoires courbes ou des changements de vitesse, préférez le flux optique. Idéale pour combler 5–20 frames entre deux annotations manuelles.
        </InfoBox>
      </motion.div>
    </AnimatedSection>
  </div>
)

// ============================================================
// Export
// ============================================================

interface TabTechnicalProps {
  subTab: SubTab
  onSubTabChange: (t: SubTab) => void
}

export const TabTechnical: React.FC<TabTechnicalProps> = ({ subTab, onSubTabChange }) => (
  <>
    <SubTabBar active={subTab} onChange={onSubTabChange} />
    {subTab === 'random' && <TechRandom />}
    {subTab === 'sequence' && <TechSequence />}
  </>
)
