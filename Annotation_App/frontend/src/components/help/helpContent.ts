// ============================================================
// components/help/helpContent.ts
// Source unique de vérité pour l'aide (Aide sidebar + popup Help).
// Doit refléter useKeyboardShortcuts.ts + Timeline.tsx + TrackPanel.tsx.
// ============================================================

export interface ShortcutItem { key: string; desc: string }
export interface ShortcutGroup { group: string; items: ShortcutItem[] }

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    group: 'Outils',
    items: [
      { key: 'A', desc: 'Outil Sélection' },
      { key: 'R', desc: 'Rectangle (bbox)' },
      { key: 'P', desc: 'Polygone' },
      { key: 'S', desc: 'SAM Point' },
      { key: 'V', desc: 'Mode review rapide (bascule)' },
      { key: 'Échap', desc: 'Annuler le dessin / désélectionner / revenir à Sélection' },
    ],
  },
  {
    group: 'Édition',
    items: [
      { key: 'Suppr', desc: 'Supprimer les annotations sélectionnées' },
      { key: 'Ctrl+Z', desc: 'Annuler' },
      { key: 'Ctrl+Y', desc: 'Rétablir (aussi Ctrl+Shift+Z)' },
      { key: 'Ctrl+C', desc: 'Copier les annotations sélectionnées' },
      { key: 'Ctrl+V', desc: 'Coller sur la frame courante' },
      { key: '1–9', desc: 'Sélectionner une classe — uniquement si cette touche a été assignée à une classe dans le gestionnaire de classes (sans effet sinon)' },
    ],
  },
  {
    group: 'Navigation & canvas',
    items: [
      { key: '← / →', desc: 'Frame précédente / suivante' },
      { key: 'Molette', desc: 'Zoom centré sur le curseur' },
      { key: 'Clic milieu', desc: 'Pan (panoramique) en maintenant' },
      { key: 'Double-clic', desc: 'Ferme le polygone (mode Polygone) ou accepte le masque SAM (mode SAM Point, SAM2 chargé). Sur le canvas hors de ces modes : sans effet.' },
      { key: 'Clic droit', desc: 'SAM Point : point d\'arrière-plan (background)' },
    ],
  },
  {
    group: 'Timeline & pistes',
    items: [
      { key: 'Clic', desc: 'Aller à la frame' },
      { key: 'Ctrl+clic', desc: 'Ajouter/retirer une frame à la sélection' },
      { key: 'Shift+clic', desc: 'Sélectionner une plage de frames' },
      { key: 'Ctrl+A', desc: 'Tout sélectionner (quand la timeline est survolée)' },
      { key: 'Suppr', desc: 'Vider les annotations des frames sélectionnées' },
      { key: 'Clic bloc', desc: 'Sélectionner ce bloc de piste (glow) + aller à son début — Suppr efface CE bloc' },
      { key: 'Double-clic bloc', desc: 'Aller à la fin du bloc de piste' },
      { key: 'Clic gris', desc: 'Sélectionner toute la piste — Suppr efface la piste entière' },
      { key: 'Aller à', desc: 'Champ numérique sous la timeline : taper un numéro de frame pour y sauter' },
    ],
  },
]

// Modes d'annotation + de suivi (« les modes »)
export interface ModeItem { name: string; desc: string }

export const TOOL_MODES: ModeItem[] = [
  { name: 'Sélection (A)', desc: 'Déplacer / redimensionner / sélectionner des annotations existantes.' },
  { name: 'Rectangle (R)', desc: 'Dessiner une bbox. Coordonnées stockées en YOLO normalisé [0,1].' },
  { name: 'Polygone (P)', desc: 'Cliquer les sommets, double-clic pour fermer.' },
  { name: 'SAM Point (S)', desc: 'Clic = point objet (foreground), clic droit = arrière-plan. Double-clic accepte le meilleur des 3 masques. Échap annule.' },
  { name: 'SAM Auto', desc: 'Bouton dédié : auto-segmente toute la frame (grid sampling). Utiliser NMS pour dédupliquer.' },
  { name: 'Texte (Grounding DINO)', desc: 'Prompt « voiture. personne. » → détection par description. Box/Text threshold : bas = plus de détections (faux positifs), haut = plus sûr.' },
  { name: 'Review rapide (V)', desc: 'Bascule le mode revue pour valider/supprimer vite frame par frame.' },
]

export const TRACKING_MODES: ModeItem[] = [
  { name: 'SAMURAI (SAM2 + Kalman)', desc: 'Propage UNE cible (prompt = boîte englobante). Le filtre de Kalman arbitre entre les masques candidats de SAM2 : il retient le plus cohérent avec le mouvement, pas seulement le plus sûr. Mono-cible car l\'état du filtre est porté par le modèle, pas par objet.' },
  { name: 'SAM2 vidéo (multi-objets)', desc: 'Activé automatiquement dès 2 cibles : SAMURAI est désactivé et SAM2 suit N objets nativement, sans modèle de mouvement. Plus rapide que N passes, mais peut confondre deux objets similaires qui se croisent.' },
  { name: 'SAMURAI par objet', desc: 'N passes indépendantes, un filtre de Kalman par cible. Meilleure qualité sur plusieurs objets, coût ≈ N fois le temps de calcul.' },
  { name: 'Detect. (GD / SAM3 / YOLO)', desc: 'Détecteur appliqué frame par frame, puis appariement au centroïde des cibles. Seuils volontairement bas : le tracking écarte les fausses alarmes éloignées de toute cible.' },
  { name: 'Homographie (XFeat/SIFT)', desc: 'Propage une keyframe en compensant le mouvement caméra. Suppose une scène plane et un objet immobile par rapport au décor. Refuse d\'écrire sous 30 % d\'inliers.' },
  { name: 'Flux optique (Lucas-Kanade)', desc: 'Suit chaque bbox par points caractéristiques. Pour les objets en mouvement propre devant une caméra fixe — le cas inverse de l\'homographie.' },
]

export interface FeatureItem { name: string; desc: string }

export const FEATURES: FeatureItem[] = [
  { name: 'Multi-séquence', desc: 'Un projet peut contenir plusieurs séquences (dossiers, vidéos et formats optionnels détectés). Le slider et la timeline sont relatifs à la séquence courante.' },
  { name: 'Cibles de tracking partagées', desc: 'Double-clic sur une bbox coche/décoche la cible pour TOUS les onglets de suivi (SAMURAI, Detect, Homogr., Flux opt.).' },
  { name: 'Suppression de blocs de piste', desc: 'Sur la timeline : clic sur un bloc coloré le sélectionne (glow) → Suppr efface uniquement ce bloc ; clic sur le gris / bouton global efface toute la piste.' },
  { name: 'Timeline sparse', desc: 'Cellules virtualisées : vert = frame annotée (avec compteur), rouge = vide. Sélection multi (Ctrl/Shift) et Suppr pour vider. Barre blanche = frame courante sur chaque piste ; % à droite = frames explorées par le tracker.' },
  { name: 'NMS', desc: 'Bouton NMS (seuil IoU réglable) dans la liste d\'annotations : supprime les doublons après SAM Auto / détection.' },
  { name: 'Export', desc: 'YOLO (un sous-dossier par séquence) ou .ver (natif 10 colonnes, un fichier par séquence). Bouton « Exporter » en haut à droite.' },
  { name: 'Sauvegarde auto', desc: 'Session + backup JSON toutes les 2 min, silencieux. Glisser-déposer un JSON pour restaurer.' },
  { name: 'LUT d\'affichage (16 bits)', desc: 'Bouton LUT flottant : remap 3-sigma / min-max / manuel, réglable par projet OU par séquence (IR et RGB dans le même projet). La LUT est aussi appliquée à l\'entrée des modèles — ils voient exactement votre image.' },
  { name: 'Monitoring', desc: 'Bouton Monitoring sur la page d\'accueil : part de l\'automatique et du manuel, sorties IA conservées / retouchées / supprimées, frames reprises plusieurs fois, historique des runs.' },
]

export interface ModelItem { name: string; desc: string; status: string }

export const MODELS: ModelItem[] = [
  { name: 'SAM2 Small', desc: 'sam2.1_hiera_small.pt (~46 MB). Résolution interne 1024×1024, inférence en bfloat16 sur GPU.', status: 'Configuré' },
  { name: 'SAM2 Tiny', desc: 'sam2.1_hiera_tiny.pt (~38 MB). Repli automatique sur CPU.', status: 'Disponible' },
  { name: 'SAMURAI', desc: 'Fork de SAM2 (mêmes poids) ajoutant un filtre de Kalman 8D et une mémoire filtrée sur 7 frames. Mono-cible par construction.', status: 'Inclus' },
  { name: 'Grounding DINO', desc: 'IDEA-Research/grounding-dino-tiny. Téléchargement auto HuggingFace (~340 MB). Prompt : concepts séparés par des points.', status: 'Auto' },
  { name: 'SAM3', desc: 'Détection et segmentation par concept, sortie bbox ou masque. Poids locaux dans backend/checkpoints/sam3.1/.', status: 'Local' },
  { name: 'YOLO custom', desc: 'Vos propres poids .pt (Ultralytics), chemin réglable dans Paramètres > Algorithmes. Aucun prompt texte.', status: 'Optionnel' },
  { name: 'XFeat', desc: 'Appariement GPU pour l\'homographie. Repli SIFT+RANSAC sur CPU.', status: 'Inclus' },
]

export const VIDEO_STEPS: string[] = [
  'Créer un projet « Séquence Image » et importer une ou plusieurs séquences (dossier, vidéo ou format optionnel détecté).',
  'Sur une frame de référence : annoter les objets (manuel, SAM Point, ou Grounding DINO).',
  'Onglet Tracks → double-clic sur les bbox pour désigner les cibles (partagées entre onglets).',
  'SAMURAI : propage UNE cible avec filtre de Kalman (boxes en temps réel, stop/pause). Plusieurs cibles → SAM2 multi-objets automatiquement.',
  'Homographie (caméra qui bouge, scène fixe) ou Flux optique (caméra fixe, objets qui bougent) : choisir selon ce qui bouge.',
  'Detect. : GD / SAM3 / YOLO sur les frames suivantes, avec appariement par distance de centroïde.',
  'Corriger : re-annoter sur n\'importe quelle frame (breakpoint) puis relancer depuis là.',
  'Nettoyer la timeline : supprimer un bloc précis (clic bloc + Suppr) ou une piste entière (clic gris + Suppr).',
  'Exporter en YOLO ou .ver.',
]
