// ============================================================
// desktop/ui/tour.js
// Tutoriel interactif de VisionNexus -- version LEGERE du moteur de tour
// d'Annotation App (frontend/src/components/tour/), reecrite en JS natif :
// cette UI est une page HTML sans build, sans framework et sans dependance.
//
// Deux parties :
//   1. CvTour  -- moteur generique (spotlight + bulle + navigation).
//   2. NEXUS_STEPS -- le script propre a VisionNexus.
//
// L'etat "deja lance" vit dans les reglages du lanceur
// (%APPDATA%\VisionNexusElectron\settings.json, champ tutorials.nexus) :
// lie a l'utilisateur Windows et a son poste, pas a un workspace.
//
// Portage vers une autre page HTML : copier ce fichier, remplacer NEXUS_STEPS,
// poser des id/data-tour sur les elements cibles, appeler CvTour.start().
// ============================================================

(function () {
  'use strict'

  const ACCENT = '#f97316'
  const ACCENT_SOFT = 'rgba(249,115,22,.18)'
  // Assombrissement du fond : assez pour porter l'attention sur la cible,
  // assez leger pour que le reste de l'interface reste lisible.
  const BACKDROP = 'rgba(2,6,23,.45)'

  const CSS = `
  #cvTourRoot{position:fixed; inset:0; z-index:2147483000; pointer-events:none; font-family:inherit;}
  #cvTourSpot{position:fixed; border-radius:10px; background:transparent; pointer-events:none;
    box-shadow:0 0 0 9999px ${BACKDROP}, 0 0 0 3px ${ACCENT}, 0 0 22px 4px ${ACCENT_SOFT};
    transition:top .2s ease,left .2s ease,width .2s ease,height .2s ease;}
  #cvTourSpot.full{inset:0; border-radius:0; box-shadow:none; background:${BACKDROP};}
  #cvTourBubble{position:fixed; width:340px; max-width:92vw; max-height:80vh; overflow-y:auto;
    background:#0f172a; color:#dbe4f0; border:1px solid #232f42; border-top:3px solid ${ACCENT};
    border-radius:12px; box-shadow:0 24px 48px rgba(0,0,0,.6); padding:12px 16px 14px;
    font-size:12.5px; line-height:1.55; pointer-events:auto;
    transition:top .2s ease,left .2s ease;}
  #cvTourBubble .bar{height:3px; background:#1a2436; border-radius:2px; margin-bottom:9px;}
  #cvTourBubble .bar i{display:block; height:3px; background:${ACCENT}; border-radius:2px; transition:width .2s ease;}
  #cvTourBubble .top{display:flex; align-items:center; gap:8px; margin-bottom:5px;}
  #cvTourBubble .chap{font-size:9.5px; letter-spacing:.8px; text-transform:uppercase; font-weight:700;
    color:${ACCENT}; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  #cvTourBubble .count{font-size:9.5px; color:#7d8ba3; flex-shrink:0;}
  #cvTourBubble .x{background:none; border:none; color:#7d8ba3; cursor:pointer; font-size:16px; line-height:1; padding:0;}
  #cvTourBubble h3{margin:0 0 7px; font-size:14px; font-weight:600; color:#fff;}
  #cvTourBubble p{margin:0 0 7px; color:#b9c5d6;}
  #cvTourBubble .hint{margin:9px 0 3px; padding:7px 9px; background:${ACCENT_SOFT};
    border:1px solid rgba(249,115,22,.35); border-radius:8px; color:#fdba74; font-size:11.5px;}
  #cvTourBubble .hint b{color:#fb923c;}
  #cvTourBubble .acts{display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:11px;}
  #cvTourBubble button.nav{border:none; cursor:pointer; font-size:11.5px; padding:6px 13px; border-radius:7px; font-family:inherit;}
  #cvTourBubble button.quit{background:none; color:#7d8ba3; padding-left:0;}
  #cvTourBubble button.prev{background:#1a2436; color:#b9c5d6;}
  #cvTourBubble button.next{background:${ACCENT}; color:#0f172a; font-weight:700;}
  #cvTourBubble button.next[disabled]{background:#232f42; color:#7d8ba3; cursor:default;}
  /* Bouton d'entree : halo orange tant que le tutoriel n'a jamais ete lance. */
  #tutoBtn.glow{border-color:#fb923c !important; color:#0f172a !important;
    background:linear-gradient(135deg,#fb923c,#f97316 55%,#ea580c) !important;
    animation:cvTutoGlow 2.1s ease-in-out infinite;}
  @keyframes cvTutoGlow{
    0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,.55), 0 0 13px 2px rgba(249,115,22,.45);}
    50%{box-shadow:0 0 0 7px rgba(249,115,22,0), 0 0 22px 6px rgba(249,115,22,.7);}
  }`

  // Les styles portent AUSSI le halo du bouton d'entree : ils doivent donc
  // etre injectes au chargement de la page, pas au premier lancement du tour.
  function injectCss() {
    if (document.getElementById('cvTourCss')) return
    const style = document.createElement('style')
    style.id = 'cvTourCss'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  // ---- Moteur ----------------------------------------------------------
  const CvTour = {
    steps: [],
    index: 0,
    open: false,
    busy: false,
    opts: {},
    _root: null,
    _track: null,

    start(steps, opts) {
      if (!steps || !steps.length) return
      this.steps = steps
      this.opts = opts || {}
      this.index = 0
      this.open = true
      this._ensureDom()
      // Idempotent : re-ajouter la meme reference ne cree pas de doublon,
      // et un tour relance apres stop() retrouve son suivi de redimensionnement.
      window.addEventListener('resize', this._reposition)
      // Une cible peut se DEPLACER sans changer de taille (panneau qui
      // s'ouvre, onglet qui apparait, colonne qui scrolle) : on resonde sa
      // position en continu, sinon le cadre orange reste a cote.
      if (!this._track) this._track = setInterval(() => { if (this.open) this._reposition() }, 150)
      this._enter()
    },

    stop() {
      if (!this.open) return
      this.open = false
      this.busy = false
      if (this._root) this._root.style.display = 'none'
      window.removeEventListener('resize', this._reposition)
      if (this._track) { clearInterval(this._track); this._track = null }
      if (this.opts.onExit) this.opts.onExit()
    },

    next() {
      if (!this.open || this.busy) return
      const step = this.steps[this.index]
      const done = () => {
        if (!this.open) return
        if (this.index >= this.steps.length - 1) {
          if (this.opts.onFinish) this.opts.onFinish()
          this.stop()
        } else {
          this.index += 1
          this._enter()
        }
      }
      const res = step && step.onNext ? step.onNext() : null
      if (res && typeof res.then === 'function') {
        this.busy = true
        this._render()
        res.catch((e) => console.error('[tour] onNext', step.id, e))
          .then(() => { this.busy = false; done() })
      } else {
        done()
      }
    },

    prev() {
      if (!this.open || this.busy || this.index === 0) return
      this.index -= 1
      this._enter()
    },

    // Prepare l'etape puis l'affiche. before() est appelee AVANT le premier
    // rendu : une etape qui choisit sa cible dynamiquement a ainsi la bonne
    // des le depart (le corps d'une fonction async s'execute de facon
    // synchrone jusqu'a son premier await).
    _enter() {
      const step = this.steps[this.index]
      const res = step && step.before ? step.before() : null
      if (res && typeof res.then === 'function') {
        this.busy = true
        this._render()
        res.catch((e) => console.error('[tour] before', step.id, e))
          .then(() => { this.busy = false; this._render() })
      } else {
        this._render()
      }
    },

    _ensureDom() {
      if (this._root) { this._root.style.display = ''; return }
      injectCss()

      const root = document.createElement('div')
      root.id = 'cvTourRoot'
      root.innerHTML =
        '<div id="cvTourSpot"></div>' +
        '<div id="cvTourBubble">' +
        '  <div class="bar"><i></i></div>' +
        '  <div class="top"><span class="chap"></span><span class="count"></span>' +
        '    <button type="button" class="x" title="Fermer le tutoriel">&times;</button></div>' +
        '  <h3></h3><div class="bodyTxt"></div><div class="hintWrap"></div>' +
        '  <div class="acts"><button type="button" class="nav quit">Quitter</button>' +
        '    <span><button type="button" class="nav prev">Precedent</button> ' +
        '    <button type="button" class="nav next">Suivant</button></span></div>' +
        '</div>'
      document.body.appendChild(root)
      this._root = root

      root.querySelector('.x').addEventListener('click', () => this.stop())
      root.querySelector('.quit').addEventListener('click', () => this.stop())
      root.querySelector('.prev').addEventListener('click', () => this.prev())
      root.querySelector('.next').addEventListener('click', () => this.next())

      this._reposition = this._reposition.bind(this)
      // Phase de CAPTURE + stopImmediatePropagation sur les fleches : la page
      // hote peut ecouter les memes touches. preventDefault n'empeche pas les
      // AUTRES ecouteurs -- une fleche avancerait le tour ET declencherait
      // l'action de la page.
      document.addEventListener('keydown', (e) => {
        if (!this.open) return
        if (e.key === 'Escape') { this.stop(); return }
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        // Ignorees quand la frappe vise un champ de saisie du lanceur.
        const tag = e.target && e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === 'ArrowRight') this.next()
        else this.prev()
      }, true)
    },

    _render() {
      const step = this.steps[this.index]
      if (!step || !this._root) return
      const b = this._root.querySelector('#cvTourBubble')
      b.querySelector('.chap').textContent = step.chapter || 'Tutoriel'
      b.querySelector('.count').textContent = (this.index + 1) + ' / ' + this.steps.length
      b.querySelector('.bar i').style.width = ((this.index + 1) / this.steps.length * 100) + '%'
      b.querySelector('h3').textContent = step.title
      const body = Array.isArray(step.body) ? step.body : [step.body]
      b.querySelector('.bodyTxt').innerHTML = body
        .map((t) => '<p>' + escapeHtml(t) + '</p>').join('')
      b.querySelector('.hintWrap').innerHTML = step.hint
        ? '<div class="hint"><b>A vous de jouer : </b>' + escapeHtml(step.hint) + '</div>'
        : ''
      b.querySelector('.prev').style.display = this.index === 0 ? 'none' : ''
      const nextBtn = b.querySelector('.next')
      nextBtn.textContent = this.index === this.steps.length - 1
        ? 'Terminer'
        : (step.nextLabel || 'Suivant')
      nextBtn.disabled = this.busy
      this._reposition()
    },

    _reposition() {
      const step = this.steps[this.index]
      if (!step || !this.open || !this._root) return
      const spot = this._root.querySelector('#cvTourSpot')
      const bubble = this._root.querySelector('#cvTourBubble')
      const el = step.target ? document.querySelector(step.target) : null

      if (!el || step.placement === 'center') {
        spot.className = 'full'
        spot.style.cssText = ''
        bubble.style.top = Math.max(16, (window.innerHeight - bubble.offsetHeight) / 2) + 'px'
        bubble.style.left = ((window.innerWidth - bubble.offsetWidth) / 2) + 'px'
        return
      }

      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const pad = step.pad == null ? 6 : step.pad
      const r = el.getBoundingClientRect()
      const box = { top: r.top - pad, left: r.left - pad, w: r.width + pad * 2, h: r.height + pad * 2 }
      spot.className = ''
      spot.style.top = box.top + 'px'
      spot.style.left = box.left + 'px'
      spot.style.width = box.w + 'px'
      spot.style.height = box.h + 'px'

      const bw = bubble.offsetWidth
      const bh = bubble.offsetHeight
      const gap = 12
      const fits = {
        bottom: box.top + box.h + gap + bh <= window.innerHeight,
        top: box.top - gap - bh >= 0,
        left: box.left - gap - bw >= 0,
        right: box.left + box.w + gap + bw <= window.innerWidth,
      }
      const order = ['bottom', 'top', 'right', 'left']
      const side = (step.placement && fits[step.placement])
        ? step.placement
        : (order.find((s) => fits[s]) || 'bottom')

      let top
      let left
      if (side === 'top') { top = box.top - gap - bh; left = box.left + box.w / 2 - bw / 2 }
      else if (side === 'left') { top = box.top + box.h / 2 - bh / 2; left = box.left - gap - bw }
      else if (side === 'right') { top = box.top + box.h / 2 - bh / 2; left = box.left + box.w + gap }
      else { top = box.top + box.h + gap; left = box.left + box.w / 2 - bw / 2 }

      bubble.style.top = clamp(top, 8, window.innerHeight - bh - 8) + 'px'
      bubble.style.left = clamp(left, 8, window.innerWidth - bw - 8) + 'px'
    },
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)) }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // ---- Script VisionNexus ----------------------------------------------
  const NEXUS_STEPS = [
    {
      id: 'welcome',
      chapter: 'Bienvenue',
      title: 'VisionNexus en deux minutes',
      body: [
        "VisionNexus est le lanceur de la suite : il garde vos reglages une fois pour toutes, demarre chaque application (en local ou sur une VM via SSH), et les affiche dans ses propres onglets.",
        "Ce tour presente le panneau de reglages a droite, champ par champ, puis la grille des applications, la console de lancement et les boutons de la barre du haut.",
      ],
      hint: "Echap ferme le tutoriel a tout moment. La page reste utilisable pendant le tour.",
      placement: 'center',
      before: async () => {
        // Ramene l'onglet VisionNexus au premier plan : une app ouverte est une
        // vue NATIVE posee par-dessus cette page, elle masquerait le tutoriel.
        if (window.cvLauncher && window.cvLauncher.switchTab) {
          try { await window.cvLauncher.switchTab(null) } catch (e) { /* rien de bloquant */ }
        }
        await sleep(120)
      },
    },

    // ---- Reglages ----
    {
      id: 'settings-panel',
      chapter: '1. Les reglages',
      title: 'Le panneau de droite : a remplir une seule fois',
      body: [
        "Ces cinq a six champs sont TOUT ce que VisionNexus a besoin de savoir. Ils sont enregistres dans votre profil Windows et relus a chaque demarrage.",
        "Tant qu'ils ne sont pas complets, aucune application n'est lancable : les tuiles de gauche restent grisees.",
      ],
      target: '#right',
      placement: 'left',
    },
    {
      id: 'bars',
      chapter: '1. Les reglages',
      title: 'Le bandeau d\'etat',
      body: [
        "Bandeau orange : il manque au moins un champ obligatoire (utilisateur, workspace, racine, conda). Bandeau vert : tout est bon, les applications sont lancables.",
        "C'est le premier endroit a regarder quand une tuile refuse de repondre au clic.",
      ],
      target: '#warnBar',
      placement: 'left',
      before: async () => {
        // Le bandeau affiche depend de la validite : on cible celui qui est visible.
        const warn = document.getElementById('warnBar')
        const visible = warn && warn.classList.contains('show')
        NEXUS_STEPS.find((s) => s.id === 'bars').target = visible ? '#warnBar' : '#okBar'
      },
    },
    {
      id: 'f-user',
      chapter: '1. Les reglages',
      title: 'Utilisateur',
      body: [
        "Votre identifiant dans la suite. Il nomme votre workspace, signe vos exports et vos runs, et c'est lui qui apparait dans la liste des utilisateurs connectes d'Annotation App.",
        "En mode VM, c'est aussi le compte utilise pour la connexion SSH.",
      ],
      target: '#fUser',
      placement: 'left',
    },
    {
      id: 'f-ws',
      chapter: '1. Les reglages',
      title: 'Workspace',
      body: [
        "Le dossier ou TOUTES les applications ecrivent : projets, bases de donnees, exports, runs d'entrainement, reglages propres a chaque app.",
        "Changer de workspace change de contexte de travail complet -- c'est la bonne facon d'isoler deux chantiers. Deux personnes peuvent aussi partager un meme workspace.",
        "Attention au sens du chemin : Windows (D:\\ws) si vous travaillez en local, chemin Linux (/data/ws) si vous ciblez une VM.",
      ],
      target: '#fWs',
      placement: 'left',
    },
    {
      id: 'f-root',
      chapter: '1. Les reglages',
      title: 'Racine Computer_Vision_App',
      body: [
        "Le dossier du code source de la suite, vu par la MACHINE QUI EXECUTE. En local, c'est un chemin Windows ; sur une VM, le chemin Linux du depot deploye la-bas.",
        "C'est la confusion la plus frequente : le message d'aide sous le champ change selon que vous ayez choisi une VM ou non, fiez-vous a lui.",
      ],
      target: '#fRoot',
      placement: 'left',
    },
    {
      id: 'f-conda',
      chapter: '1. Les reglages',
      title: 'Chemin conda',
      body: [
        "L'environnement Python qui porte les dependances (PyTorch, FastAPI, SAM2...). VisionNexus l'active avant de demarrer un backend.",
        "Meme regle que les autres chemins : celui de la machine d'execution, pas celui de votre poste si vous lancez sur une VM.",
      ],
      target: '#fConda',
      placement: 'left',
    },
    {
      id: 'f-vm',
      chapter: '1. Les reglages',
      title: 'VM cible et VM connues',
      body: [
        "\"(local, pas de VM)\" execute tout sur votre poste. Choisir une VM fait passer chaque lancement par SSH : le calcul se fait la-bas, sur son GPU, et l'interface s'affiche ici.",
        "Le champ du dessous est la liste de vos machines : un seul nom, ou plusieurs separes par des virgules. Elles alimentent le menu deroulant.",
        "Rappel : basculer local <-> VM impose de reverifier workspace, racine et conda -- ce ne sont pas les memes chemins.",
      ],
      target: '#vmSelect',
      placement: 'left',
    },
    {
      id: 'f-mount',
      chapter: '1. Les reglages',
      title: 'Partage reseau natif (optionnel)',
      body: [
        "Champ de performance, pour le travail sur VM uniquement. Renseigne, les applications compatibles lisent les images DIRECTEMENT sur ce partage reseau au lieu de les faire transiter par la connexion SSH -- beaucoup plus rapide sur de gros datasets.",
        "Le bouton Tester verifie que l'hote repond et liste les zones accessibles. En cas d'echec, rien ne casse : les applications repassent par le transport HTTP habituel.",
        "Laissez vide si vous ne savez pas : c'est un pur bonus.",
      ],
      target: '#fMount',
      placement: 'left',
    },
    {
      id: 'save',
      chapter: '1. Les reglages',
      title: 'Enregistrer',
      body: [
        "Ecrit les reglages dans votre profil utilisateur Windows (dossier Roaming). Ils sont donc lies a vous et a ce poste, et survivent aux mises a jour de l'application.",
        "Le bandeau d'etat se remet a jour immediatement apres l'enregistrement.",
      ],
      target: '#saveBtn',
      placement: 'left',
    },

    // ---- Lancer ----
    {
      id: 'tiles',
      chapter: '2. Lancer une application',
      title: 'La grille des applications',
      body: [
        "Le schema montre la chaine reelle : l'Orchestrator et les sept applications qui s'enchainent, plus l'application autonome a part.",
        "Un clic sur une tuile demarre l'application : VisionNexus alloue les ports, lance le backend puis le frontend, attend qu'ils repondent, et ouvre un onglet. Une console de lancement s'ouvre alors juste en dessous -- nous la verrons en action a la fin de ce tour.",
        "Une tuile marquee \"natif\" sait utiliser le partage reseau du reglage precedent.",
      ],
      // #tiles n'a pas de taille propre (ses tuiles sont en position absolue) :
      // on encadre le diagramme complet.
      target: '.flow',
      placement: 'right',
      pad: 4,
    },
    {
      id: 'tabstrip',
      chapter: '3. La barre du haut',
      title: 'Onglets et dispositions',
      body: [
        "Chaque application ouverte devient un onglet a cote de l'onglet VisionNexus. Un onglet se glisse hors de la barre pour devenir une fenetre independante, et se redepose sur la barre pour revenir.",
        "Les quatre petites icones a droite decoupent la fenetre : une vue, deux cote a cote, deux empilees, ou quatre en grille -- de quoi annoter et surveiller l'entrainement en meme temps.",
        "Clic droit sur un onglet : copier son URL, ou l'ouvrir dans un vrai navigateur.",
      ],
      target: '#winTabStrip',
      placement: 'bottom',
    },
    {
      id: 'ports',
      chapter: '3. La barre du haut',
      title: 'Ports',
      body: [
        "Liste les ports TCP en ecoute, en local et sur la VM, avec le processus qui les tient. C'est l'outil de menage : reperer un backend qui traine apres une fermeture brutale et le tuer avant que ca s'accumule.",
        "\"Tout arreter\" coupe d'un coup tout ce que la suite a lance.",
      ],
      target: '#portsBtn',
      placement: 'bottom',
    },
    {
      id: 'sidebar-btn',
      chapter: '3. La barre du haut',
      title: 'Bandeau',
      body: "Masque ou affiche la barre laterale de l'application affichee (Ctrl+B) : quelques dizaines de pixels gagnes sur un ecran juste, sans rien fermer.",
      target: '#sidebarToggleBtn',
      placement: 'bottom',
    },
    {
      id: 'logs-doc-btn',
      chapter: '3. La barre du haut',
      title: 'Logs et Documentation',
      body: [
        "Logs ouvre le dossier des fichiers de log sur le disque -- utile pour joindre une trace complete a un rapport de bug.",
        "Documentation ouvre la doc embarquee de la suite, application par application, dans sa propre fenetre.",
      ],
      target: '#logsBtn',
      placement: 'bottom',
    },
    {
      id: 'menus',
      chapter: '3. La barre du haut',
      title: 'Les menus',
      body: "Fichier pour quitter proprement (les applications lancees sont arretees avec lui), Aide pour la documentation, le dossier des logs et les outils de developpement en cas de souci d'affichage.",
      target: '#appMenuBar',
      placement: 'bottom',
    },

    // ---- Exemple reel : on lance vraiment Annotation App ----
    {
      id: 'example-launch',
      chapter: '4. Un lancement en vrai',
      title: 'Lancons Annotation App',
      body: [
        "Assez de theorie : cliquez sur Suivant et le tutoriel demarre reellement Annotation App, comme si vous cliquiez sa tuile.",
        "Le point de couleur sur la tuile suit l'etat : bleu clignotant pendant le demarrage, vert quand l'application repond.",
      ],
      target: '.tile[data-app-id="annotation"]',
      placement: 'right',
      onNext: async () => {
        const tile = document.querySelector('.tile[data-app-id="annotation"]')
        // Tuile desactivee = reglages incomplets. On ne force rien : l'etape
        // suivante explique la console meme si aucun lancement n'a eu lieu.
        if (!tile || tile.disabled) return
        tile.click()
        // Le panneau de logs s'ouvre des le clic ; on laisse arriver les
        // premieres lignes pour que l'etape suivante montre du vrai contenu.
        await sleep(2500)
      },
    },
    {
      id: 'example-logs',
      chapter: '4. Un lancement en vrai',
      title: 'La console de lancement',
      body: [
        "Voila la sortie brute du backend et du frontend, en direct. Chaque application lancee a son onglet ici, avec sa ligne de statut (demarrage, en ligne, arrete) et son bouton Stop, qui la ferme proprement au lieu de la laisser en orphelin.",
        "C'est l'endroit ou se lit un vrai probleme : port deja pris, module Python manquant, refus SSH, chemin conda faux.",
      ],
      target: '#logPanel',
      placement: 'right',
      waitTimeoutMs: 12000,
    },
    {
      id: 'example-logs-file',
      chapter: '4. Un lancement en vrai',
      title: 'Ces logs sont enregistres sur le disque',
      body: [
        "La console n'est qu'un reflet : tout est ecrit en continu dans des fichiers .txt, un par application. Ce bouton ouvre le dossier qui les contient (il est aussi dans le menu Aide).",
        "En cas de bug, c'est CE fichier qu'il faut recuperer et transmettre au createur de l'application : il porte la trace complete, bien au-dela des dernieres lignes visibles ici.",
      ],
      target: '#logsBtn',
      placement: 'bottom',
    },
    {
      id: 'example-tab',
      chapter: '4. Un lancement en vrai',
      title: "L'onglet de l'application, a cote de VisionNexus",
      body: [
        "Des que l'application repond, son onglet apparait ici, juste a droite de l'onglet VisionNexus : un clic y bascule, un clic sur l'onglet VisionNexus ramene a cet ecran.",
        "Annotation App a son PROPRE tutoriel interactif : un bouton orange, sur sa page d'accueil, qui construit un projet de demonstration de bout en bout. Dataset Explorer aussi.",
        "Cliquez sur son onglet quand vous voulez : ce tour-ci est fini.",
      ],
      target: '.wtab[data-app-id="annotation"]',
      placement: 'bottom',
      waitTimeoutMs: 60000,
    },
    {
      id: 'done',
      chapter: 'Termine',
      title: 'Vous savez lancer la suite',
      body: [
        "Reglages remplis une fois, tuile cliquee, onglet ouvert, logs sous la main : c'est tout le cycle de VisionNexus.",
        "Chaque application a son propre tutoriel interactif, accessible par son bouton orange une fois ouverte.",
        "Ce tour reste relancable par le bouton Tutoriel de la barre du haut.",
      ],
      placement: 'center',
    },
  ]

  // ---- Bouton d'entree --------------------------------------------------
  const TUTORIAL_KEY = 'nexus'

  async function readState() {
    if (!window.cvLauncher || !window.cvLauncher.getTutorial) return null
    try { return await window.cvLauncher.getTutorial(TUTORIAL_KEY) } catch (e) { return null }
  }

  async function writeState(patch) {
    if (!window.cvLauncher || !window.cvLauncher.setTutorial) return
    try { await window.cvLauncher.setTutorial(TUTORIAL_KEY, patch) } catch (e) { /* non bloquant */ }
  }

  async function initTutorialButton() {
    const btn = document.getElementById('tutoBtn')
    if (!btn) return
    injectCss()
    const state = await readState()
    if (state && !state.launchedOnce) btn.classList.add('glow')
    btn.title = state && !state.launchedOnce
      ? 'Decouvrir VisionNexus : reglages, lancement, onglets'
      : 'Relancer le tutoriel de VisionNexus'
    btn.addEventListener('click', () => {
      btn.classList.remove('glow')
      void writeState({ launchedOnce: true })
      CvTour.start(NEXUS_STEPS, {
        onFinish: () => { void writeState({ completed: true }) },
      })
    })
  }

  window.CvTour = CvTour
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTutorialButton)
  } else {
    void initTutorialButton()
  }
})()
