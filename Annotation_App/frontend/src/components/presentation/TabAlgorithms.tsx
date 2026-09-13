// ============================================================
// components/presentation/TabAlgorithms.tsx
// Detail complet des algorithmes reellement implementes.
//
// Regle de redaction : chaque valeur citee ici provient du code ou des configs
// (backend/services/sam_service.py, ext/samurai_repo/.../configs/samurai/*.yaml,
// models/routers/tracking.py, services/homography_service.py). Les hypotheses
// que fait chaque algorithme sont ecrites explicitement — c'est ce qui permet
// de savoir QUAND il va echouer, pas seulement comment il marche.
// ============================================================

import React, { useState } from 'react'
import { motion } from 'framer-motion'
import {
  Crosshair, Radar, Type, Boxes, Move3d, Waves, Layers, ChevronDown,
} from 'lucide-react'
import { AnimatedSection, fadeUp, InfoBox, ParamRow } from './shared'

// ---- Bloc depliable par algorithme ----
const AlgoSection: React.FC<{
  id: string
  icon: React.ReactNode
  title: string
  tagline: string
  color: string
  open: string | null
  setOpen: (v: string | null) => void
  children: React.ReactNode
}> = ({ id, icon, title, tagline, color, open, setOpen, children }) => {
  const isOpen = open === id
  return (
    <motion.div variants={fadeUp} className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/40">
      <button
        onClick={() => setOpen(isOpen ? null : id)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-800/70 transition-colors"
      >
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
          {icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="block text-xs text-slate-400 mt-0.5">{tagline}</span>
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-500 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && <div className="px-5 pb-5 pt-1 space-y-4 border-t border-slate-700/60">{children}</div>}
    </motion.div>
  )
}

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wide mt-4 mb-2">{children}</h4>
)

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-slate-400 leading-relaxed">{children}</p>
)

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="px-1.5 py-0.5 bg-slate-900 rounded text-[11px] text-cyan-300 font-mono">{children}</code>
)

// Liste d'hypotheses : ce que l'algo tient pour acquis, donc ce qui le casse.
const Assumptions: React.FC<{ items: [string, string][] }> = ({ items }) => (
  <div className="space-y-2">
    {items.map(([h, consequence]) => (
      <div key={h} className="flex gap-2.5 text-xs">
        <span className="text-amber-400/70 mt-0.5 flex-shrink-0">▸</span>
        <span className="text-slate-400 leading-relaxed">
          <span className="text-slate-200">{h}</span>
          <span className="text-slate-500"> — si faux : {consequence}</span>
        </span>
      </div>
    ))}
  </div>
)

// ---- Schema du pipeline d'entree, commun a tous les modeles ----
const InputPipeline: React.FC = () => (
  <svg viewBox="0 0 760 132" className="w-full" role="img"
       aria-label="Pipeline image source vers tenseur modele">
    {[
      ['Source', '16 bits PNG/TIFF\nou 8 bits JPEG\nou format optionnel', '#334155'],
      ['LUT', '3-sigma / minmax\n/ manuel\n(sequence > projet)', '#7c3aed'],
      ['8 bits', 'JPEG qualite 95\ndans un dossier\ntemporaire', '#0891b2'],
      ['Resize', '1024 x 1024\nsans preserver\nle ratio', '#059669'],
      ['Tenseur', 'normalise ImageNet\nbfloat16 sur GPU', '#d97706'],
    ].map(([title, sub, color], i) => {
      const x = 8 + i * 152
      return (
        <g key={title}>
          <rect x={x} y={16} width={128} height={82} rx={8} fill={color} fillOpacity={0.18} stroke={color} />
          <text x={x + 64} y={36} textAnchor="middle" fill="#e2e8f0" fontSize={12} fontWeight={600}>{title}</text>
          {String(sub).split('\n').map((line, j) => (
            <text key={j} x={x + 64} y={54 + j * 13} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>{line}</text>
          ))}
          {i < 4 && (
            <path d={`M ${x + 132} 57 l 14 0 m -5 -4 l 5 4 l -5 4`} stroke="#64748b" strokeWidth={1.5} fill="none" />
          )}
        </g>
      )
    })}
    <text x={380} y={120} textAnchor="middle" fill="#64748b" fontSize={10}>
      Le modele voit exactement l'image que vous voyez : la LUT d'affichage est bakee dans l'entree.
    </text>
  </svg>
)

// ---- Schema du filtre de Kalman SAMURAI ----
const KalmanDiagram: React.FC = () => (
  <svg viewBox="0 0 760 250" className="w-full" role="img"
       aria-label="Boucle de selection de masque motion-aware de SAMURAI">
    <rect x={8} y={8} width={200} height={70} rx={8} fill="#1e293b" stroke="#475569" />
    <text x={108} y={30} textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight={600}>SAM2 — frame t</text>
    <text x={108} y={48} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>propose plusieurs masques</text>
    <text x={108} y={63} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>chacun avec son IoU predit</text>

    <rect x={8} y={110} width={200} height={82} rx={8} fill="#7c3aed" fillOpacity={0.15} stroke="#7c3aed" />
    <text x={108} y={132} textAnchor="middle" fill="#c4b5fd" fontSize={11} fontWeight={600}>Kalman — prediction</text>
    <text x={108} y={150} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>etat 8D : x, y, ratio, hauteur</text>
    <text x={108} y={164} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>+ leurs 4 vitesses</text>
    <text x={108} y={181} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>donne une boite attendue</text>

    <path d="M 212 45 l 40 0 l 0 55 l 40 0 m -8 -5 l 8 5 l -8 5" stroke="#64748b" strokeWidth={1.5} fill="none" />
    <path d="M 212 150 l 40 0 l 0 -45 l 40 0 m -8 -5 l 8 5 l -8 5" stroke="#7c3aed" strokeWidth={1.5} fill="none" />

    <rect x={300} y={72} width={214} height={66} rx={8} fill="#059669" fillOpacity={0.15} stroke="#059669" />
    <text x={407} y={94} textAnchor="middle" fill="#6ee7b7" fontSize={11} fontWeight={600}>Score combine</text>
    <text x={407} y={113} textAnchor="middle" fill="#e2e8f0" fontSize={10} fontFamily="monospace">
      0.15 x IoU_kalman
    </text>
    <text x={407} y={128} textAnchor="middle" fill="#e2e8f0" fontSize={10} fontFamily="monospace">
      + 0.85 x IoU_modele
    </text>

    <path d="M 518 105 l 36 0 m -8 -5 l 8 5 l -8 5" stroke="#64748b" strokeWidth={1.5} fill="none" />

    <rect x={560} y={72} width={192} height={66} rx={8} fill="#d97706" fillOpacity={0.15} stroke="#d97706" />
    <text x={656} y={94} textAnchor="middle" fill="#fcd34d" fontSize={11} fontWeight={600}>Masque retenu</text>
    <text x={656} y={113} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>le mieux note, pas</text>
    <text x={656} y={127} textAnchor="middle" fill="#94a3b8" fontSize={9.5}>seulement le plus sur</text>

    <path d="M 656 142 l 0 34 l -548 0 l 0 -22 m -5 8 l 5 -8 l 5 8" stroke="#7c3aed"
          strokeWidth={1.5} fill="none" strokeDasharray="4 3" />
    <text x={400} y={192} textAnchor="middle" fill="#a78bfa" fontSize={10}>
      correction du filtre avec la boite retenue (si le score depasse le seuil)
    </text>

    <rect x={8} y={206} width={744} height={36} rx={6} fill="#0f172a" stroke="#334155" />
    <text x={380} y={222} textAnchor="middle" fill="#94a3b8" fontSize={10}>
      Sous le seuil : le compteur stable_frames retombe a 0, le filtre repart en prediction pure.
    </text>
    <text x={380} y={236} textAnchor="middle" fill="#64748b" fontSize={9.5}>
      Il faut 15 frames consecutives correctes (stable_frames_threshold) pour le considerer reverrouille.
    </text>
  </svg>
)

export const TabAlgorithms: React.FC = () => {
  const [open, setOpen] = useState<string | null>('samurai')

  return (
    <AnimatedSection className="space-y-6">
      <motion.div variants={fadeUp}>
        <h2 className="text-xl font-bold text-white mb-2">Algorithmes</h2>
        <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">
          Fonctionnement reel de chaque methode disponible dans l'onglet Tracks, avec ses
          parametres effectifs et les hypotheses qu'elle pose. Les valeurs citees sont
          celles du code, pas celles des articles d'origine.
        </p>
      </motion.div>

      <motion.div variants={fadeUp}>
        <InfoBox type="info" title="Chaine d'entree commune a tous les modeles">
          <div className="mt-3"><InputPipeline /></div>
          <p className="mt-2">
            Consequence pratique : regler la LUT change ce que le modele recoit. Sur de
            l'imagerie 16 bits, un mauvais reglage donne une image ecrasee, et le modele
            travaille alors sur la meme bouillie que celle affichee a l'ecran.
          </p>
        </InfoBox>
      </motion.div>

      <div className="space-y-3">
        {/* ---------------- SAMURAI ---------------- */}
        <AlgoSection
          id="samurai" open={open} setOpen={setOpen}
          icon={<Crosshair size={18} className="text-violet-300" />}
          color="bg-violet-500/20"
          title="SAMURAI — suivi video mono-cible"
          tagline="SAM2 augmente d'un filtre de Kalman qui arbitre le choix du masque"
        >
          <P>
            SAMURAI est un fork de SAM2, pas un modele different : memes poids
            (<Code>sam2.1_hiera_small.pt</Code>), meme architecture. Ce qu'il ajoute est une
            regle de decision. A chaque frame, SAM2 propose plusieurs masques candidats avec
            un score de confiance ; SAM2 seul prend le plus sur, SAMURAI prend celui qui
            concilie confiance et coherence de mouvement.
          </P>

          <H>La boucle de decision</H>
          <KalmanDiagram />

          <H>Le filtre de Kalman en detail</H>
          <P>
            Etat a 8 dimensions dans l'espace <Code>xyah</Code> : centre x, centre y, ratio
            d'aspect, hauteur, plus les quatre vitesses associees. Modele a vitesse constante
            (<Code>dt = 1</Code> frame). Le bruit est proportionnel a la hauteur de la boite
            (<Code>_std_weight_position = 1/20</Code>, <Code>_std_weight_velocity = 1/160</Code>) :
            un objet qui occupe beaucoup de pixels a droit a plus d'incertitude absolue qu'un
            objet lointain. Le melange des scores est fixe a
            <Code>kf_score_weight = 0.15</Code> — le Kalman departage, il ne decide pas.
          </P>

          <InfoBox type="warn" title="Pourquoi SAMURAI ne suit qu'UNE cible">
            <p>
              <Code>kf_mean</Code>, <Code>kf_covariance</Code> et <Code>stable_frames</Code> sont
              des attributs du <span className="text-slate-200">modele</span>, pas d'un objet suivi.
              Il n'existe donc qu'un seul etat de Kalman en memoire, quel que soit le nombre de
              cibles. Avec deux objets, la comparaison de scores porte sur un tenseur a
              plusieurs elements et leve
              <Code>RuntimeError: Boolean value of Tensor with more than one value is ambiguous</Code>.
            </p>
            <p className="mt-2">
              L'application gere ce cas au lieu de planter : des la 2e cible,
              <Code>configure_video_tracking()</Code> met <Code>samurai_mode = False</Code> et
              bascule sur <span className="text-slate-200">SAM2 multi-objets natif</span>, qui
              suit N objets sans Kalman. L'etat est aussi remis a zero a chaque run — le modele
              est un singleton partage, un reliquat corromprait le run suivant.
            </p>
            <p className="mt-2">
              Le mode <span className="text-slate-200">SAMURAI par objet</span> contourne la
              limite autrement : N passes independantes, une session et un filtre par cible.
              Suivi de meilleure qualite, cout environ N fois le temps de calcul.
            </p>
          </InfoBox>

          <H>Banque de memoire</H>
          <P>
            <Code>num_maskmem = 7</Code> : l'attention croisee ne regarde que les 7 dernieres
            frames memorisees, plus la frame de reference (celle que vous avez annotee). Le cout
            par frame est donc constant, il n'augmente pas avec la longueur de la sequence.
            SAMURAI filtre en plus ce qui entre dans cette banque
            (<Code>memory_bank_iou_threshold = 0.5</Code>) : une frame ou le suivi est douteux
            n'est pas memorisee, ce qui evite d'empoisonner les frames suivantes.
          </P>

          <H>Preparation des images</H>
          <P>
            Les frames sont converties en JPEG qualite 95 numerotes <Code>000000.jpg</Code> dans un
            dossier temporaire — SAMURAI exige des noms qui soient des entiers purs. Un JPEG 8 bits
            deja conforme est symlinke sans recodage ; sinon la LUT est appliquee puis l'image
            reencodee. Chaque frame est ensuite redimensionnee en
            <span className="text-slate-200"> 1024 x 1024 sans preservation du ratio</span> : une
            image 16:9 est donc deformee, de maniere identique a l'entrainement, ce qui est sans
            effet sur la qualite. Les coordonnees reviennent en normalise via la taille d'origine.
          </P>

          <H>Precision numerique</H>
          <P>
            L'inference tourne sous <Code>autocast(bfloat16)</Code>. Sans cela, PyTorch refuse les
            noyaux Flash et memory-efficient de l'attention et retombe sur une implementation
            naive, 3 a 5 fois plus lente. Le meme contexte enveloppe l'initialisation, le prompt
            et la propagation : un dtype different entre ces etapes corromprait la banque de memoire.
          </P>

          <H>Parametres</H>
          <div className="bg-slate-900/40 rounded-lg px-4 py-1">
            <ParamRow name="image_size" default_="1024" desc="Resolution interne, appliquee a chaque frame." />
            <ParamRow name="num_maskmem" default_="7" desc="Frames conservees dans la banque de memoire." />
            <ParamRow name="stable_frames_threshold" default_="15" desc="Frames consecutives correctes avant de considerer le suivi reverrouille." />
            <ParamRow name="kf_score_weight" default_="0.15" desc="Poids du Kalman dans le score de selection du masque." />
            <ParamRow name="memory_bank_iou_threshold" default_="0.5" desc="IoU minimum pour qu'une frame entre en memoire." />
            <ParamRow name="offload_video_to_cpu" default_="false" desc="Frames en RAM plutot qu'en VRAM. Plus lent, indispensable sur petit GPU." />
          </div>

          <H>Hypotheses</H>
          <Assumptions items={[
            ['Le mouvement est lisse a vitesse quasi constante', 'un changement brutal de direction fait diverger la prediction, le suivi decroche'],
            ['La cible reste visible ou n\'est occultee que brievement', 'apres une longue occultation le filtre a trop derive pour reverrouiller'],
            ['Le ratio d\'aspect varie peu', 'une rotation dans le plan image fait de la boite un mauvais descripteur'],
            ['La boite de depart cadre bien l\'objet', 'un prompt approximatif fixe une cible ambigue pour toute la sequence'],
            ['L\'apparence reste comparable sur 7 frames', 'un changement rapide d\'echelle ou d\'eclairage vide la memoire de son utilite'],
          ]} />
        </AlgoSection>

        {/* ---------------- SAM2 video ---------------- */}
        <AlgoSection
          id="sam2" open={open} setOpen={setOpen}
          icon={<Layers size={18} className="text-cyan-300" />}
          color="bg-cyan-500/20"
          title="SAM2 video — suivi multi-objets"
          tagline="Memoire d'attention seule, sans modele de mouvement"
        >
          <P>
            Utilise automatiquement des que plusieurs cibles sont demandees, et disponible seul si
            SAMURAI n'est pas installe. Chaque objet recoit un identifiant et son propre jeu de
            masques ; la propagation est mutualisee, il n'y a donc pas de surcout proportionnel
            au nombre d'objets comme dans le mode par objet.
          </P>
          <P>
            La difference avec SAMURAI tient en une phrase : SAM2 choisit le masque dont il est le
            plus sur, sans jamais se demander si ce masque est plausible compte tenu du deplacement
            precedent. Sur des objets bien contrastes et isolees, la difference est nulle. Sur deux
            objets similaires qui se croisent, SAM2 peut sauter de l'un a l'autre la ou le Kalman
            de SAMURAI aurait rejete le saut.
          </P>
          <InfoBox type="tip" title="Provenance distincte en base">
            Depuis la separation, les annotations portent <Code>samurai</Code> ou
            <Code>sam2_video</Code> selon le tracker reellement actif. Les runs anterieurs
            conservent <Code>sam2_tracking</Code>, qui ne permettait pas de les distinguer.
          </InfoBox>
          <H>Hypotheses</H>
          <Assumptions items={[
            ['Les objets restent distinguables par leur apparence', 'deux objets identiques qui se croisent echangent leurs identifiants'],
            ['Les identites sont fixees par le prompt initial', 'un objet qui entre en cours de sequence ne sera jamais suivi'],
            ['La memoire de 7 frames suffit a maintenir l\'identite', 'une occultation plus longue casse la piste sans possibilite de rattrapage'],
          ]} />
        </AlgoSection>

        {/* ---------------- Grounding DINO ---------------- */}
        <AlgoSection
          id="gd" open={open} setOpen={setOpen}
          icon={<Type size={18} className="text-emerald-300" />}
          color="bg-emerald-500/20"
          title="Grounding DINO — detection par texte"
          tagline="Detecteur ouvert pilote par un prompt, sans notion de temps"
        >
          <P>
            Modele <Code>IDEA-Research/grounding-dino-tiny</Code>, telecharge automatiquement depuis
            HuggingFace au premier usage (environ 340 Mo). Il associe un encodeur texte et un
            encodeur image et retourne les boites dont la representation correspond au prompt.
            Vocabulaire ouvert : le prompt n'a pas besoin d'appartenir a une liste de classes
            predefinies.
          </P>
          <H>Deux seuils, deux roles</H>
          <P>
            <Code>box_threshold</Code> filtre sur la confiance de la boite ;
            <Code>text_threshold</Code> filtre sur la force de l'association entre la boite et les
            mots du prompt. En tracking guide les deux sont volontairement bas (0.20 et 0.15) :
            l'objectif est de maximiser le rappel, le tri est ensuite fait par l'appariement
            geometrique aux cibles.
          </P>
          <H>Redaction du prompt</H>
          <P>
            Les termes doivent etre separes par des points, en minuscules, au singulier :
            <Code>car . truck . person</Code>. Une phrase entiere degrade la detection — le modele
            attend des concepts, pas une description.
          </P>
          <H>Hypotheses</H>
          <Assumptions items={[
            ['L\'objet appartient au vocabulaire visuel appris', 'une cible tres specifique (piece industrielle, signature infrarouge) n\'est pas trouvee, quel que soit le prompt'],
            ['Chaque frame est independante', 'aucune coherence temporelle : les identites viennent uniquement de l\'appariement par centroide'],
            ['Le domaine visuel est proche des donnees d\'entrainement', 'sur de l\'infrarouge ou du 16 bits mal remappe, les scores s\'effondrent'],
          ]} />
        </AlgoSection>

        {/* ---------------- SAM3 ---------------- */}
        <AlgoSection
          id="sam3" open={open} setOpen={setOpen}
          icon={<Radar size={18} className="text-pink-300" />}
          color="bg-pink-500/20"
          title="SAM3 — detection et segmentation par concept"
          tagline="Alternative a Grounding DINO, sortie boite ou masque"
        >
          <P>
            Egalement pilote par texte, mais capable de produire directement des masques de
            segmentation en plus des boites — reglable par <Code>sam3_output_mode</Code>
            (<Code>bbox</Code> ou <Code>segmentation</Code>). Poids locaux dans
            <Code>backend/checkpoints/sam3.1/</Code>.
          </P>
          <P>
            Dans le tracking guide, il occupe exactement la meme place que Grounding DINO : un
            detecteur applique frame par frame, dont les sorties sont ensuite appariees aux cibles.
            Le choix entre les deux est empirique — SAM3 se comporte generalement mieux sur les
            objets aux contours nets, Grounding DINO sur les concepts plus abstraits.
          </P>
          <H>Hypotheses</H>
          <Assumptions items={[
            ['Le concept est exprimable en langue naturelle', 'une distinction purement visuelle sans mot pour la nommer reste hors de portee'],
            ['Frames independantes', 'meme absence de continuite temporelle que Grounding DINO'],
          ]} />
        </AlgoSection>

        {/* ---------------- YOLO ---------------- */}
        <AlgoSection
          id="yolo" open={open} setOpen={setOpen}
          icon={<Boxes size={18} className="text-orange-300" />}
          color="bg-orange-500/20"
          title="YOLO custom — detecteur entraine maison"
          tagline="Vos propres poids .pt, en boucle de tracking"
        >
          <P>
            Charge un modele local via <Code>settings.algorithms.yolo_model_path</Code> (Ultralytics,
            cache par chemin). Aucun prompt texte : les classes sont celles de votre entrainement.
            C'est la voie a privilegier quand vous avez deja un detecteur sur votre domaine — il
            battra systematiquement un modele generaliste.
          </P>
          <H>Seuil de confiance volontairement bas</H>
          <P>
            <Code>yolo_conf_threshold = 0.15</Code> par defaut. Ce n'est pas un reglage de detection
            mais de tracking : on accepte beaucoup de candidats, puis l'appariement par centroide
            elimine ceux qui ne tombent pas pres d'une cible connue. Une fausse alarme loin de toute
            cible est ecartee sans jamais devenir une annotation. <Code>yolo_iou_threshold = 0.7</Code>
            controle le NMS interne.
          </P>
          <H>Hypotheses</H>
          <Assumptions items={[
            ['Les classes du modele correspondent a celles du projet', 'les indices de classe sont decales et les annotations mal etiquetees'],
            ['Le domaine d\'entrainement couvre les images annotees', 'un modele entraine de jour ne detecte rien la nuit'],
          ]} />
        </AlgoSection>

        {/* ---------------- Homographie ---------------- */}
        <AlgoSection
          id="homography" open={open} setOpen={setOpen}
          icon={<Move3d size={18} className="text-blue-300" />}
          color="bg-blue-500/20"
          title="Homographie XFeat / SIFT"
          tagline="Propagation geometrique quand c'est la camera qui bouge"
        >
          <P>
            Aucun reseau de detection : on estime la transformation entre deux frames et on y
            transporte les boites. Appariement par XFeat sur GPU, repli SIFT sur CPU, puis RANSAC
            pour estimer une matrice 3x3.
          </P>
          <H>Parametres</H>
          <div className="bg-slate-900/40 rounded-lg px-4 py-1">
            <ParamRow name="xfeat_top_k" default_="4096" desc="Points d'interet extraits par image." />
            <ParamRow name="xfeat_min_cossim" default_="0.82" desc="Similarite cosinus minimale pour valider un appariement." />
            <ParamRow name="ransac_threshold" default_="3.0" desc="Erreur de reprojection toleree, en pixels." />
            <ParamRow name="min_inlier_count" default_="30" desc="Nombre absolu d'inliers requis." />
            <ParamRow name="min_inlier_ratio" default_="0.5" desc="Proportion d'inliers requise." />
          </div>
          <InfoBox type="warn" title="Refus explicite plutot que resultat faux">
            Sous 30 % d'inliers, <Code>compute_homography()</Code> retourne <Code>None</Code> et la
            propagation s'arrete. Une homographie estimee sur trop peu de correspondances produit
            des boites aberrantes ; mieux vaut ne rien ecrire.
          </InfoBox>
          <H>Hypotheses</H>
          <Assumptions items={[
            ['La scene est plane ou la camera tourne autour de son centre optique', 'en presence de parallaxe une seule matrice ne peut pas decrire la scene'],
            ['L\'objet est immobile par rapport a la scene', 'un objet qui se deplace en propre ne suit pas la transformation globale — utiliser le flux optique'],
            ['La texture est suffisante', 'ciel, mer, mur uniforme : pas de points d\'interet, pas d\'homographie'],
            ['Le recouvrement entre frames est important', 'un mouvement trop rapide ne laisse pas assez de correspondances'],
          ]} />
        </AlgoSection>

        {/* ---------------- Flux optique ---------------- */}
        <AlgoSection
          id="optflow" open={open} setOpen={setOpen}
          icon={<Waves size={18} className="text-teal-300" />}
          color="bg-teal-500/20"
          title="Flux optique Lucas-Kanade"
          tagline="Propagation par objet, quand c'est la cible qui bouge"
        >
          <P>
            Complementaire de l'homographie. Des points sont semes dans chaque boite puis suivis
            individuellement d'une frame a l'autre par Lucas-Kanade pyramidal. Le deplacement median
            des points survivants translate la boite. Chaque objet est traite separement, donc
            plusieurs objets peuvent partir dans des directions differentes.
          </P>
          <H>Parametres</H>
          <div className="bg-slate-900/40 rounded-lg px-4 py-1">
            <ParamRow name="optflow_win_size" default_="21" desc="Fenetre de recherche, en pixels. Plus grand = mouvements rapides mais moins precis." />
            <ParamRow name="optflow_max_level" default_="3" desc="Niveaux de pyramide. Chaque niveau double l'amplitude gerable." />
            <ParamRow name="optflow_min_pts" default_="4" desc="Points suivis minimum pour valider le deplacement." />
          </div>
          <H>Hypotheses</H>
          <Assumptions items={[
            ['Constance de la luminance : un point garde son intensite', 'un changement d\'eclairage ou un reflet fait perdre les points'],
            ['Le deplacement reste dans la fenetre de recherche', 'trop rapide pour 21 px sur 3 niveaux : le suivi decroche — augmenter max_level'],
            ['Les points voisins bougent ensemble', 'sur un objet deformable, le deplacement median n\'a plus de sens'],
            ['L\'objet est texture', 'une surface uniforme ne fournit aucun point suivable'],
          ]} />
        </AlgoSection>
      </div>

      <motion.div variants={fadeUp}>
        <InfoBox type="tip" title="Comment choisir">
          <ul className="space-y-1.5 mt-1">
            <li><span className="text-slate-200">Une cible, sequence longue</span> — SAMURAI, le meilleur compromis.</li>
            <li><span className="text-slate-200">Plusieurs cibles</span> — SAM2 multi-objets ; passer en SAMURAI par objet si la qualite ne suffit pas et que le temps de calcul est acceptable.</li>
            <li><span className="text-slate-200">Objets nombreux et nommables</span> — Grounding DINO ou SAM3 en tracking guide.</li>
            <li><span className="text-slate-200">Detecteur deja entraine sur le domaine</span> — YOLO custom, sans hesiter.</li>
            <li><span className="text-slate-200">Camera qui bouge, scene fixe</span> — homographie.</li>
            <li><span className="text-slate-200">Camera fixe, objets qui bougent</span> — flux optique.</li>
          </ul>
        </InfoBox>
      </motion.div>
    </AnimatedSection>
  )
}
