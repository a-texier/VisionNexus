// ============================================================
// components/presentation/TabOptimisations.tsx
// Onglet Optimisations — transport HTTP / SMB, charge backend,
// temps reel de la propagation. Chaque point porte la MESURE qui
// le justifie (cf. docs/optimisation_http_smb.md).
// ============================================================

import React from 'react'
import { motion } from 'framer-motion'
import {
  Gauge, Network, Database, Image as ImageIcon, Radio, HardDrive, Cpu,
  ArrowDown, ArrowRight, CheckCircle2, Layers, Monitor, MousePointer2,
  RefreshCw, Server,
} from 'lucide-react'
import { AnimatedSection, InfoBox, CodeBlock, ParamRow, fadeUp } from './shared'

// ---- Donnees mesurees ----

const COUT_FRAME = [
  { quoi: 'Message WebSocket (annonce)', poids: '415 o', http: '0', natif: true },
  { quoi: 'Image preview 480 px', poids: '9 726 o', http: '1', natif: false },
  { quoi: 'Image display 1600 px', poids: '22 330 o', http: '1', natif: false },
  { quoi: 'Image pleine resolution', poids: '35 233 o', http: '1', natif: false },
]

const GAINS_CARTE = [
  { op: 'Selection 50 % des points', avant: '354 ms', apres: '43 ms', gain: 'x8' },
  { op: 'Deselection', avant: '335 ms', apres: '54 ms', gain: 'x6' },
  { op: 'Zoom', avant: '246 ms', apres: '16 ms', gain: 'x16' },
  { op: 'Dezoom', avant: '245 ms', apres: '12 ms', gain: 'x21' },
  { op: 'Re-render complet', avant: '90 ms', apres: '4,5 ms', gain: 'x20' },
]

const BASELINE = [
  { op: 'Embedding 9402 images (Dataset Explorer)', val: '~47 img/s — 238 s au total' },
  { op: 'Import Annotation 9402 frames (symlink)', val: '~110 s' },
  { op: 'Propagation SAMURAI', val: '~8 frames/s' },
  { op: 'Latence backend, 2 jobs simultanes', val: 'mediane 8-16 ms, p95 30-59 ms, 0 echec' },
  { op: 'Seuil du popup "backend ne repond pas"', val: '30 000 ms' },
]

const CODE_UNC = `# backend/utils/native_share.py — traduction serveur -> client
/srv/datasets/.../projects/1/frames/f_000042.png
        -> \\\\<share-host>\\datasets\\...\\projects\\1\\frames\\f_000042.png

# Ne traduit QUE les chemins sous une racine partagee :
#   home, mnt, srv, media, data
# /tmp/... -> None  (d'ou le deplacement du dossier temporaire)`

const CODE_TRACE = `[SAM2Track] apercu temps reel : chemin NATIF (SMB) -> \\\\<share-host>\\...
            -- lecture directe par le client, hors tunnel, 0 requete HTTP par frame

# Route calculee par le backend, UNE seule ligne par run :
#   NATIF (SMB)           lecture directe sur le partage
#   NATIF (disque local)  lancement local, lecture disque
#   REPLI HTTP            + la raison (aucun partage ne couvre le chemin)

# Confirmation de la lecture REELLE par Electron :
[app-image] lecture native confirmee: \\\\<share-host>\\.../_tracking_tmp/.../000042.jpg
# ou : [app-image] repli HTTP: <raison> (...)`

const CODE_POOL = `# backend/database.py
# SQLAlchemy 2.x utilise un QueuePool MEME pour un SQLite fichier.
# Defaut : pool_size 5 + max_overflow 10 = 15 connexions, pool_timeout 30 s
# Or les endpoints "def" tournent dans le threadpool anyio : 40 threads.
# 40 demandeurs pour 15 places -> attente de 30 s = le timeout axios.

_POOL_SIZE    = 20
_MAX_OVERFLOW = 40   # 60 connexions > 40 threads : plus aucune attente`

const CODE_TOPOLOGY = `POSTE WINDOWS (VisionNexus Electron + frontend)
  |-- API JSON + WebSocket --> 127.0.0.1:<port local>
  |                           tunnel SSH -> <backend-vm>:<port backend>
  |
  \\-- pixels des frames ----> \\\\<native_share_host>\\<partage>\\...
                              lecture directe app-image://, hors tunnel SSH

# backend-vm = VM qui execute FastAPI, SAMURAI/SAM2 et SQLite
# native_share_host = hote UNC joignable depuis Windows
# Les deux noms peuvent etre differents.`

// ---- Petits composants locaux ----

const Stat: React.FC<{ value: string; label: string; color: string }> = ({ value, label, color }) => (
  <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-center">
    <p className={`text-lg font-bold ${color}`}>{value}</p>
    <p className="text-[11px] text-slate-400 leading-tight mt-0.5">{label}</p>
  </div>
)

const Table: React.FC<{ head: string[]; rows: React.ReactNode[][] }> = ({ head, rows }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-700">
          {head.map((h) => (
            <th key={h} className="text-left py-2 px-3 text-slate-400 font-semibold">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-800 last:border-0">
            {r.map((c, j) => (
              <td key={j} className="py-2 px-3 text-slate-300">{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const Block: React.FC<{
  icon: React.ReactNode; title: string; color: string; children: React.ReactNode
}> = ({ icon, title, color, children }) => (
  <AnimatedSection>
    <motion.div variants={fadeUp} className="flex items-center gap-3 mb-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>{icon}</div>
      <h3 className="text-base font-bold text-white">{title}</h3>
    </motion.div>
    <motion.div variants={fadeUp} className="space-y-4">{children}</motion.div>
  </AnimatedSection>
)

type FlowItem = {
  title: string
  detail: string
  channel: 'LOCAL' | 'HTTP' | 'WS' | 'SMB' | 'SQL'
  icon: React.ReactNode
}

const FLOW_TONES: Record<FlowItem['channel'], string> = {
  LOCAL: 'border-slate-600 bg-slate-800/70 text-slate-300',
  HTTP: 'border-blue-700/60 bg-blue-950/35 text-blue-300',
  WS: 'border-green-700/60 bg-green-950/35 text-green-300',
  SMB: 'border-cyan-700/60 bg-cyan-950/35 text-cyan-300',
  SQL: 'border-orange-700/60 bg-orange-950/35 text-orange-300',
}

const FlowRow: React.FC<{ items: FlowItem[]; start: number }> = ({ items, start }) => (
  <div className="flex flex-col md:flex-row md:items-stretch gap-2">
    {items.map((item, index) => (
      <React.Fragment key={`${item.title}-${index}`}>
        {index > 0 && (
          <div className="flex items-center justify-center text-slate-600" aria-hidden="true">
            <ArrowDown size={16} className="md:hidden" />
            <ArrowRight size={16} className="hidden md:block" />
          </div>
        )}
        <div className={`min-w-0 flex-1 border rounded-lg p-3 ${FLOW_TONES[item.channel]}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-slate-950/70 flex items-center justify-center text-[10px] font-bold">
              {start + index}
            </span>
            {item.icon}
            <span className="ml-auto text-[9px] font-bold tracking-normal">{item.channel}</span>
          </div>
          <p className="text-xs font-semibold text-white leading-tight">{item.title}</p>
          <p className="text-[10px] text-slate-400 leading-relaxed mt-1">{item.detail}</p>
        </div>
      </React.Fragment>
    ))}
  </div>
)

const FlowDiagram: React.FC<{ rows: FlowItem[][] }> = ({ rows }) => {
  return (
    <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-4 space-y-2">
      {rows.map((items, rowIndex) => {
        const start = 1 + rows
          .slice(0, rowIndex)
          .reduce((total, previousRow) => total + previousRow.length, 0)
        return (
          <React.Fragment key={rowIndex}>
            {rowIndex > 0 && (
              <div className="flex justify-center text-slate-600" aria-hidden="true">
                <ArrowDown size={16} />
              </div>
            )}
            <FlowRow items={items} start={start} />
          </React.Fragment>
        )
      })}
    </div>
  )
}

const NAVIGATION_FLOW: FlowItem[][] = [
  [
    { title: 'Action utilisateur', detail: 'Slider, timeline ou fleche change frame_index.', channel: 'LOCAL', icon: <MousePointer2 size={14} /> },
    { title: 'Metadonnees frame', detail: 'Store memoire ; GET by-index uniquement si la fenetre sparse manque.', channel: 'HTTP', icon: <Layers size={14} /> },
    { title: 'Annotations', detail: 'LRU immediat, puis un GET annulable pour rafraichir la frame.', channel: 'HTTP', icon: <Database size={14} /> },
    { title: 'URL image', detail: 'Preview pendant scrub, display a l’arret, full au zoom.', channel: 'LOCAL', icon: <ImageIcon size={14} /> },
  ],
  [
    { title: 'Resolution native', detail: 'Electron resout le chemin partage ; le navigateur utilise le repli.', channel: 'HTTP', icon: <Server size={14} /> },
    { title: 'Lecture pixels', detail: 'fs.readFile sur UNC hors tunnel ; sinon un GET /image.', channel: 'SMB', icon: <HardDrive size={14} /> },
    { title: 'Commit canvas', detail: 'Konva affiche seulement image et annotations de la meme frame.', channel: 'LOCAL', icon: <Monitor size={14} /> },
    { title: 'Prefetch borne', detail: 'Voisins seulement au repos ; aucune vignette ni balayage complet.', channel: 'LOCAL', icon: <CheckCircle2 size={14} /> },
  ],
]

const RUN_FLOW: FlowItem[][] = [
  [
    { title: 'Demarrage', detail: 'POST /sam2-tracking/run renvoie immediatement task_id.', channel: 'HTTP', icon: <MousePointer2 size={14} /> },
    { title: 'Preparation VM', detail: 'Le backend produit les JPEG dans projet/_tracking_tmp.', channel: 'LOCAL', icon: <Server size={14} /> },
    { title: 'Calcul GPU', detail: 'SAMURAI/SAM2 propage et met les ecritures DB en lots.', channel: 'LOCAL', icon: <Cpu size={14} /> },
    { title: 'File live', detail: 'Chaque resultat garde frame_id, native_path et objets.', channel: 'LOCAL', icon: <Layers size={14} /> },
  ],
  [
    { title: 'Socket unique', detail: 'Un broker vide toute la file et diffuse live_frames.', channel: 'WS', icon: <Radio size={14} /> },
    { title: 'Navigation cadencee', detail: 'Live ON : 150 ms par defaut. Live OFF : canvas immobile.', channel: 'LOCAL', icon: <RefreshCw size={14} /> },
    { title: 'Image + overlay', detail: 'JPEG par SMB ; annotations du meme message WS, sans GET DB.', channel: 'SMB', icon: <Monitor size={14} /> },
    { title: 'Fin atomique', detail: 'Flush DB, recharge unique, purge des tampons temporaires.', channel: 'SQL', icon: <CheckCircle2 size={14} /> },
  ],
]

// ---- Onglet ----

export const TabOptimisations: React.FC = () => (
  <div className="space-y-10 px-6 py-10 max-w-5xl mx-auto">

    {/* Intro */}
    <AnimatedSection>
      <motion.div variants={fadeUp} className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
          <Gauge size={16} className="text-cyan-400" />
        </div>
        <h2 className="text-xl font-bold text-white">Optimisations</h2>
      </motion.div>
      <motion.div variants={fadeUp} className="bg-slate-900/60 border border-slate-700 rounded-xl p-5 text-xs text-slate-300 space-y-3">
        <p>
          Toutes les optimisations ci-dessous partent d'un <strong>symptome observe</strong>, d'une
          cause etablie par la mesure, et d'un gain constate. Les chiffres viennent d'un test de
          charge reel : <strong>9402 images 640x512 (2,6 Go)</strong>, Annotation App et Dataset Explorer
          lances en parallele.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
          <Stat value="0" label="requete HTTP par frame en chemin natif" color="text-cyan-400" />
          <Stat value="18 % -> 0 %" label="frames perdues par le WebSocket" color="text-green-400" />
          <Stat value="x8 a x21" label="carte Dataset Explorer (SVG -> WebGL)" color="text-violet-400" />
          <Stat value="x5" label="histogrammes (cache LRU)" color="text-orange-400" />
        </div>
        <CodeBlock label="Topologie distante cible" code={CODE_TOPOLOGY} color="text-cyan-300" />
        <p>
          Les tests locaux valident les contrats et le repli HTTP. La validation distante doit
          etre faite depuis VisionNexus sur Windows avec FastAPI sur la <strong>VM distante</strong> : la
          trace <code>NATIF (SMB)</code> confirme que les pixels ne traversent pas le tunnel SSH.
        </p>
      </motion.div>
    </AnimatedSection>

    {/* Flux de communication */}
    <Block icon={<Network size={16} className="text-teal-400" />} title="Flux de communication pas a pas" color="bg-teal-500/20">
      <div>
        <p className="text-xs font-semibold text-white mb-2">Navigation normale</p>
        <FlowDiagram rows={NAVIGATION_FLOW} />
      </div>
      <InfoBox type="info" title="Ce qui ne part pas sur le reseau">
        La timeline est virtualisee et sans vignette. Deplacer le slider ne parcourt pas le
        dataset et ne demande pas les frames precedentes : seule la frame cible, puis quelques
        voisines au repos, sont concernees.
      </InfoBox>
      <div>
        <p className="text-xs font-semibold text-white mb-2">Propagation SAMURAI / SAM2</p>
        <FlowDiagram rows={RUN_FLOW} />
      </div>
      <InfoBox type="success" title="Contrat du vrai live">
        Une frame affichee recoit son image par <strong>SMB</strong> et ses annotations par le
        <strong> meme lot WebSocket</strong>. Tant que le run est actif, aucun GET annotations ne
        peut remplacer cet apercu par une version SQLite non encore commitee.
      </InfoBox>
    </Block>

    {/* 1. La contrainte */}
    <Block icon={<Network size={16} className="text-blue-400" />} title="1. La contrainte : 6 connexions par origine" color="bg-blue-500/20">
      <p className="text-xs text-slate-400 leading-relaxed">
        Un navigateur ouvre au maximum <strong className="text-slate-200">6 connexions HTTP
        simultanees par origine</strong>. Quand le backend est sur une <strong>VM distante</strong>, ce trafic traverse en
        plus un <strong className="text-slate-200">tunnel SSH</strong>. Ces 6 creneaux sont donc
        partages entre les images de frames (le gros du volume) et les requetes vitales
        (annotations, stop, sauvegarde). Toute optimisation qui suit revient a la meme idee : ne
        pas depenser un creneau pour quelque chose qui peut passer autrement.
      </p>
      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
        <p className="text-[11px] text-slate-500 mb-2 font-semibold uppercase tracking-wide">Ce que coute une frame</p>
        <Table
          head={['Transport', 'Poids', 'Requetes HTTP']}
          rows={COUT_FRAME.map((c) => [
            c.quoi,
            c.poids,
            <span className={c.natif ? 'text-green-400 font-semibold' : 'text-orange-400'}>{c.http}</span>,
          ])}
        />
      </div>
      <InfoBox type="info" title="A 8 frames/s, la cadence SAMURAI mesuree">
        Les annonces WebSocket coutent <strong>3,2 Ko/s et zero requete</strong>. Faire suivre le
        canvas image par image en HTTP couterait <strong>79 Ko/s et 8 requetes/s</strong>, soit
        plus que les 6 creneaux disponibles.
      </InfoBox>
    </Block>

    {/* 2. Chemin natif */}
    <Block icon={<HardDrive size={16} className="text-cyan-400" />} title="2. Chemin natif (SMB) : zero requete par frame" color="bg-cyan-500/20">
      <p className="text-xs text-slate-400 leading-relaxed">
        En coquille Electron, le protocole <code className="px-1 bg-slate-700 rounded text-white">app-image://</code> lit
        les pixels <strong className="text-slate-200">directement sur le partage reseau</strong> au
        lieu de les demander en HTTP. Le trafic ne passe alors ni par le tunnel SSH, ni par les
        6 creneaux, ni par le threadpool du backend.
      </p>
      <CodeBlock label="backend/utils/native_share.py" code={CODE_UNC} color="text-cyan-300" />
      <p className="text-xs text-slate-400 leading-relaxed">
        <strong className="text-slate-200">Pendant une propagation</strong>, la preparation ecrit
        deja un JPEG 8 bits par frame (LUT appliquee) : celui que SAM2 consomme. Le backend annonce
        donc simplement ce fichier dans le message WebSocket via le champ{' '}
        <code className="px-1 bg-slate-700 rounded text-white">native_path</code> — rien a
        re-encoder. Cote client, un parametre{' '}
        <code className="px-1 bg-slate-700 rounded text-white">nativePath</code> court-circuite la
        resolution : <strong className="text-slate-200">deux requetes HTTP economisees par
        frame</strong>.
      </p>
      <InfoBox type="warn" title="Piege corrige : le dossier temporaire etait sous /tmp">
        <code className="px-1 bg-slate-700 rounded text-white">to_native_share_path('/tmp/...')</code>{' '}
        renvoie <code className="px-1 bg-slate-700 rounded text-white">None</code> : aucune racine
        de partage ne couvre <code className="px-1 bg-slate-700 rounded text-white">/tmp</code>. Le
        chemin natif n'aurait donc jamais fonctionne en SMB. Le dossier vit desormais dans{' '}
        <code className="px-1 bg-slate-700 rounded text-white">&lt;projet&gt;/_tracking_tmp/</code>.
      </InfoBox>
      <InfoBox type="success" title="Mesure">
        80/80 messages portent un <code>native_path</code> ; 79/80 fichiers reellement lisibles au
        moment du push. Le seul absent est la derniere frame, dont le dossier temporaire etait deja
        en cours de nettoyage — le repli HTTP prend le relais.
      </InfoBox>
      <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide pt-1">Trace dans les logs</p>
      <CodeBlock label="log du run" code={CODE_TRACE} color="text-emerald-300" />
    </Block>

    {/* 3. WebSocket */}
    <Block icon={<Radio size={16} className="text-green-400" />} title="3. Le WebSocket perdait 18 % des frames" color="bg-green-500/20">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <p className="text-[11px] text-red-400 font-semibold uppercase tracking-wide mb-1.5">Symptome</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Pendant une propagation, les pastilles de la timeline restaient rouges puis viraient au
            vert d'un coup a la fin.
          </p>
        </div>
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <p className="text-[11px] text-yellow-400 font-semibold uppercase tracking-wide mb-1.5">Cause</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            Le socket <strong>echantillonnait</strong> l'etat toutes les 150 ms (6,7/s) alors que le
            backend <strong>ecrase un slot unique</strong> a chaque frame. SAMURAI tourne a 8 f/s :
            les frames intercalees etaient ecrasees avant d'etre lues.
          </p>
        </div>
      </div>
      <InfoBox type="success" title="Correctif et mesure">
        Une file bornee remplie a chaque frame, videe integralement par la boucle WebSocket et
        envoyee dans un tableau <code>live_frames</code>. Avant : <strong>18 % des frames jamais
        annoncees</strong> sur 201. Apres : <strong>200/201 poussees, 0 % de perte</strong> (la
        seule absente est la frame de reference, sautee par conception car deja annotee).
      </InfoBox>
      <InfoBox type="success" title="Une seule connexion physique par tache">
        Le panneau Tracks et la barre du haut ouvraient deux sockets concurrents. Comme la file{' '}
        <code>live_frames</code> est videe a la lecture, le mauvais socket pouvait consommer les{' '}
        <code>native_path</code> avant le canvas. Un broker partage maintenant un seul WebSocket et
        diffuse localement les messages aux deux composants.
      </InfoBox>
    </Block>

    {/* 4. Annotations d'apercu */}
    <Block icon={<ImageIcon size={16} className="text-amber-400" />} title="4. Annotations d'apercu et cadence du canvas" color="bg-amber-500/20">
      <p className="text-xs text-slate-400 leading-relaxed">
        Meme apres le correctif precedent, les boites n'apparaissaient pas tout de suite sur
        l'image : l'apercu n'etait applique que si le canvas etait <strong>deja</strong> sur la
        frame concernee. Or la navigation est throttlee, donc l'apercu arrivait presque toujours{' '}
        <strong>avant</strong> que le canvas n'y aille — et etait jete. Un tampon conserve
        desormais les apercus recus et les applique des que le canvas arrive, sans attendre le
        flush en base.
      </p>
      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
        <p className="text-[11px] text-slate-500 mb-1 font-semibold uppercase tracking-wide">Reglage</p>
        <ParamRow
          name="propagation_nav_throttle_ms"
          default_="150 ms"
          desc="Cadence du canvas pendant une propagation. 150 ms suit la boucle WebSocket ; 700 ms economise le repli HTTP ; 0 suit chaque resultat GPU."
        />
        <ParamRow
          name="realtime_live_enabled"
          default_="true"
          desc="Active par defaut le suivi live pendant les propagations : annotations par WebSocket et images via nativePath/app-image quand Electron dispose du chemin natif."
        />
      </div>
      <InfoBox type="tip" title="La cadence echantillonne le flux, pas les annotations">
        Le WebSocket conserve <strong>chaque</strong> resultat et met a jour la timeline. Le canvas
        affiche au plus une frame par intervalle, mais chaque frame retenue recoit toujours son
        overlay correspondant. Le defaut passe de 700 a 150 ms grace au chemin natif SMB.
        Les profils restes sur l'ancien defaut 700 ms sont migres une fois ; les autres
        valeurs personnalisees sont conservees.
      </InfoBox>
      <InfoBox type="info" title="Pourquoi toutes les frames GPU ne sont pas necessairement dessinees">
        Le WebSocket continue a recevoir <code>live_frames</code> a la cadence du GPU. Le tampon
        associe chaque apercu au vrai <code>frame_index</code>, y compris sur un dataset charge par
        fenetres. Si le GPU va plus vite que 150 ms, le canvas echantillonne le mouvement pour ne
        pas empiler les decodages, mais la timeline et la base conservent tous les resultats.
      </InfoBox>
      <InfoBox type="success" title="Bug une annotation sur dix corrige">
        Un lot <code>live_frames</code> etait traite, puis transmis comme <code>null</code> a la
        navigation. Ce <code>null</code> declenchait un GET annotations ; SAMURAI ne commitant que
        par lots de 10, la reponse vide effacait aussitot l'overlay live. Un indicateur explicite
        <code>hasLivePayload</code> interdit maintenant cette relecture des qu'un lot WS existe.
      </InfoBox>
      <InfoBox type="success" title="Ecran gris corrige a la source">
        Pendant une propagation, le cache DB et le tampon WebSocket pouvaient alterner deux
        versions d'une meme frame jusqu'a <code>Maximum update depth exceeded</code>. Le WebSocket
        est maintenant l'unique source du canvas pendant la tache ; le cache et la DB reprennent
        apres la resynchronisation finale. Les mesures Electron temporaires a <code>0x0</code> sont
        aussi ignorees pour que Konva ne dessine jamais dans un buffer detruit. Aucun error
        boundary ne masque ces erreurs.
      </InfoBox>
      <InfoBox type="info" title="Comportement live ON / OFF">
        <strong>ON :</strong> le canvas suit les frames a la cadence configuree, utilise le chemin
        natif SMB sous Electron et applique les boites du WebSocket. <strong>OFF :</strong> le
        canvas reste sur la frame choisie, tandis que progression et compteurs continuent ; le
        resultat final est recharge depuis la base en une seule passe.
      </InfoBox>
      <InfoBox type="success" title="Chemin direct independant de la sonde generique">
        Quand Annotation App fournit <code>nativePath</code>, Electron tente directement la
        lecture de ce chemin, meme si la sonde SMB globale utilise un autre hostname. Un timeout
        de 1,5 s protege la navigation et declenche automatiquement le repli HTTP en cas d'echec.
      </InfoBox>
    </Block>

    {/* 5. Pool SQL */}
    <Block icon={<Database size={16} className="text-orange-400" />} title="5. Saturation du pool de connexions SQL" color="bg-orange-500/20">
      <p className="text-xs text-slate-400 leading-relaxed">
        Symptome : application entierement figee, popup « Le backend ne repond pas »,{' '}
        <strong className="text-slate-200">sans aucun calcul GPU en cours</strong>.
      </p>
      <CodeBlock label="backend/database.py" code={CODE_POOL} color="text-orange-300" />
      <p className="text-xs text-slate-400 leading-relaxed">
        Ce qui remplissait le pool : <code className="px-1 bg-slate-700 rounded text-white">frame_histogram</code> et{' '}
        <code className="px-1 bg-slate-700 rounded text-white">serve_frame_image</code> gardent leur
        connexion pendant un <code className="px-1 bg-slate-700 rounded text-white">cv2.imread</code>{' '}
        d'un PNG 16 bits situe sur un <strong className="text-slate-200">montage reseau</strong>.
        Quelques frames en vol suffisaient.
      </p>
      <InfoBox type="success" title="Second correctif : cache LRU des histogrammes">
        Un histogramme porte sur les valeurs <strong>brutes</strong> : il ne depend ni de la LUT ni
        d'aucun reglage d'affichage, et les pixels sources ne changent jamais apres l'import. Il est
        donc calculable une seule fois. Mesure : <strong>x5 en unitaire, x4,5 en rafale</strong> sur
        SSD local — le gain est bien superieur sur montage reseau.
      </InfoBox>
      <InfoBox type="warn" title="A retenir pour la suite">
        Le dimensionnement du pool est relatif au threadpool anyio par defaut (40 threads). Si ce
        reglage change, le pool doit rester au-dessus.
      </InfoBox>
    </Block>

    {/* 6. Frontend */}
    <Block icon={<Cpu size={16} className="text-violet-400" />} title="6. Cote frontend" color="bg-violet-500/20">
      <p className="text-xs text-slate-400 leading-relaxed">
        La carte Dataset Explorer utilisait Plotly en <code className="px-1 bg-slate-700 rounded text-white">type: 'scatter'</code>,
        qui rend en <strong className="text-slate-200">SVG</strong> : un noeud <code>&lt;path&gt;</code> par
        point. Sur 9402 points cela faisait 9402 noeuds, soit <strong className="text-slate-200">96 % du
        DOM de la page</strong>. Chaque selection, zoom ou survol devait retoucher ces milliers de
        noeuds sur le thread principal.
      </p>
      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
        <p className="text-[11px] text-slate-500 mb-2 font-semibold uppercase tracking-wide">
          Passage en scattergl (WebGL, meme bundle, aucune dependance ajoutee)
        </p>
        <Table
          head={['Operation', 'SVG', 'WebGL', 'Gain']}
          rows={GAINS_CARTE.map((g) => [
            g.op,
            <span className="text-red-400">{g.avant}</span>,
            <span className="text-green-400">{g.apres}</span>,
            <span className="text-violet-300 font-semibold">{g.gain}</span>,
          ])}
        />
        <p className="text-[11px] text-slate-500 mt-2">DOM total de la page : 9798 -&gt; 392 noeuds.</p>
      </div>
      <InfoBox type="info" title="C'est un gain de latence, pas de memoire">
        Le heap JS ne bouge que de 3 Mo : les noeuds SVG vivent en memoire native, hors{' '}
        <code>performance.memory</code>. Ne pas presenter ce correctif comme une optimisation
        memoire.
      </InfoBox>
      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 space-y-2">
        <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Autres correctifs</p>
        <p className="text-xs text-slate-400 leading-relaxed">
          <strong className="text-slate-200">Cache d'annotations</strong> : c'etait une{' '}
          <code>Map</code> sans limite, videe uniquement au changement de projet. Bornee a 600
          entrees (LRU).
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          <strong className="text-slate-200">Remanence d'image</strong> : le hook de chargement
          annulable ne remettait jamais son etat a <code>null</code> et gardait indefiniment sa
          derniere image. En navigation normale, le repli faisait reapparaitre une image d'une{' '}
          <strong>autre frame</strong>. Corrige en retenant l'URL associee et en ne rendant l'image
          que si elle correspond encore.
        </p>
      </div>
    </Block>

    {/* 7. Memoire */}
    <Block icon={<Cpu size={16} className="text-pink-400" />} title="7. Ou passe la memoire" color="bg-pink-500/20">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <p className="text-[11px] text-orange-400 font-semibold uppercase tracking-wide mb-1.5">Backend Python</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            ~1,0 Go au repos, ~2,1-2,2 Go en pic (torch/CUDA/SAM2 charges a la demande). Sur une VM,
            cette memoire est <strong>sur la VM</strong>, pas sur le poste client.
          </p>
        </div>
        <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <p className="text-[11px] text-blue-400 font-semibold uppercase tracking-wide mb-1.5">Electron</p>
          <p className="text-xs text-slate-400 leading-relaxed">
            787 Mo mesures sur 7 process (3 renderers, GPU, main, utility). Le Gestionnaire des
            taches Windows les <strong>additionne</strong> sous un seul nom.
          </p>
        </div>
      </div>
      <InfoBox type="info" title="Facteur 135 entre le JPEG et l'image decodee">
        Un navigateur garde l'image <strong>decodee</strong>, pas le JPEG : une frame 640x512 pese
        9,7 Ko en preview mais <strong>1,25 Mo decodee en RGBA</strong>.
      </InfoBox>
      <InfoBox type="success" title="Ce que l'application retient ne croit PAS avec le dataset">
        Le canvas ne garde qu'une image, le prefetch cree des <code>Image</code> jamais stockees, la
        timeline est virtualisee, et la liste de frames coute ~20 Mo a 20 000 frames. Passer de
        9 000 a 20 000 frames n'ajoute que quelques dizaines de megaoctets.
      </InfoBox>
    </Block>

    {/* Baseline */}
    <Block icon={<Gauge size={16} className="text-slate-300" />} title="Mesures de reference" color="bg-slate-500/20">
      <p className="text-xs text-slate-400 leading-relaxed">
        A reutiliser pour comparer apres une modification.
      </p>
      <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
        <Table head={['Operation', 'Valeur']} rows={BASELINE.map((b) => [b.op, b.val])} />
      </div>
      <InfoBox type="warn" title="Points de vigilance">
        <ul className="list-disc list-inside space-y-1 mt-1">
          <li>Les JPEG de <code>_tracking_tmp</code> ne vivent que pendant le run : le repli HTTP dans l'URL <code>app-image://</code> est obligatoire.</li>
          <li>Le pool SQL est dimensionne par rapport au threadpool anyio (40 threads).</li>
          <li><code>to_native_share_path()</code> ne traduit que les chemins sous une racine partagee : tout fichier destine a une lecture native doit vivre sous l'une d'elles.</li>
          <li><code>&lt;backend-vm&gt;</code> designe le backend SSH ; <code>paths.native_share_host</code> designe l'hote UNC vu par Windows. Ne pas supposer que ces deux noms sont identiques.</li>
          <li>Le throttle de navigation ne concerne que l'image : ne pas l'invoquer pour expliquer un retard d'annotations.</li>
        </ul>
      </InfoBox>
      <p className="text-[11px] text-slate-500">
        Detail complet et historique des mesures : <code className="px-1 bg-slate-800 rounded">docs/optimisation_http_smb.md</code>
      </p>
    </Block>

  </div>
)
