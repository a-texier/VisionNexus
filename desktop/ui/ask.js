// ============================================================
// desktop/ui/ask.js
// Onglet "Demander a la doc" de docs.html : question -> passages de la doc
// (service Docs Assistant). Charge APRES le script inline de docs.html, dont
// il reutilise openDoc, ensureAppDocs et l'etat de langue (CV_LANG).
//
// Tout passe par window.cvDocs (IPC, cf. preloadDocs.ts) : la page ne parle
// jamais au service et ne connait aucun port. Les textes venus du service
// (extraits, titres, messages) sont toujours inseres avec textContent.
// ============================================================
(function () {
  const ASK_K = 8
  const $ = (id) => document.getElementById(id)

  let svc = { id: 'docs', state: 'off', message: '', messageKey: null, messageParams: null, detail: '', target: '', selected: '', index: null }
  let appList = null            // [{id, label, icon}] : apps qui ont de la doc
  let appListKey = ''
  const selectedApps = new Set()
  let audience = 'all'
  // Par defaut on cherche dans les deux langues : filtrer sur la langue de la fenetre
  // faisait perdre ~14 points de top-1 des que la question etait dans l'autre langue, et
  // les resultats s'affichent de toute facon dans la langue de la question (le service la
  // detecte). 'fr'/'en' = filtre explicite, garde jusqu'au prochain FR/EN de la fenetre.
  let langPick = null
  let busy = false
  let lastQuery = ''
  let lastRequestKey = ''
  let outcome = null            // {request, result} | {error: {error, message}} | null
  let seq = 0

  function el(tag, cls, text) {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    return node
  }

  function effectiveLang() {
    return langPick || 'both'
  }

  // Texte d'un message venu du processus principal : cle i18n si elle existe, sinon le repli francais.
  function messageText(key, params, fallback) {
    return key ? cvT(key, params || undefined) : fallback
  }

  function targetLabel(target) {
    return target ? target : cvT('svcTargetLocal')
  }

  function buildRequest(q) {
    return {
      q,
      lang: effectiveLang(),
      apps: [...selectedApps],
      audience,
      k: ASK_K,
      // Langue gardee quand une section existe dans les deux : celle de la question
      // (detectee par le service), sinon celle de la fenetre ; un filtre FR/EN explicite l'impose.
      prefer: langPick === 'fr' || langPick === 'en' ? langPick : 'auto',
      uiLang: CV_LANG,
    }
  }

  // ---- Barre du service (pastille, cible, interrupteur) ----

  function statusText() {
    const idx = svc.index
    switch (svc.state) {
      case 'starting': return cvT('svcStateStarting')
      case 'stopping': return cvT('svcStateStopping')
      case 'error': return cvT('svcStateError')
      case 'ready':
        if (idx && idx.syncing) {
          return idx.total > 0 ? cvT('svcIndexing', { done: idx.done, total: idx.total }) : cvT('svcIndexingBare')
        }
        return idx && idx.chunks ? cvT('svcIndexed', { n: idx.chunks }) : cvT('svcStateReady')
      default: return cvT('svcStateOff')
    }
  }

  function renderBar() {
    $('askDot').className = 'dot ' + svc.state
    $('askStatusText').textContent = statusText()
    $('askTarget').textContent = targetLabel(svc.target)
    const reindex = $('askReindex')
    reindex.hidden = svc.state !== 'ready'
    reindex.disabled = !!(svc.index && svc.index.syncing)
    const running = svc.state === 'starting' || svc.state === 'ready'
    const sw = $('askSwitch')
    sw.setAttribute('aria-checked', running ? 'true' : 'false')
    sw.disabled = svc.state === 'stopping'
    sw.setAttribute('aria-label', cvT('svcSwitchTitle', { name: 'Docs Assistant' }))
    sw.title = sw.getAttribute('aria-label')
    const hint = $('askRetarget')
    const stale = running && svc.target !== svc.selected
    hint.hidden = !stale
    hint.textContent = stale ? cvT('svcRetarget', { target: targetLabel(svc.target), selected: targetLabel(svc.selected) }) : ''
  }

  async function toggleService() {
    if (svc.state === 'off' || svc.state === 'error') await window.cvDocs.startDocsService()
    else if (svc.state === 'starting' || svc.state === 'ready') await window.cvDocs.stopDocsService()
  }

  // ---- Panneaux d'etat (eteint / demarrage / arret / erreur) ----

  function stateActionButton(labelKey) {
    const btn = el('button', 'primary', cvT(labelKey))
    btn.type = 'button'
    btn.addEventListener('click', () => void window.cvDocs.startDocsService())
    return btn
  }

  function renderStatePanel() {
    const host = $('askState')
    host.textContent = ''
    if (svc.state === 'ready') return
    const box = el('div', 'askState' + (svc.state === 'error' ? ' err' : ''))
    if (svc.state === 'starting' || svc.state === 'stopping') {
      box.appendChild(el('div', 'spin'))
      box.appendChild(el('h3', '', cvT(svc.state === 'starting' ? 'askStarting' : 'askStopping')))
      if (svc.state === 'starting') box.appendChild(el('p', '', cvT('askStartingHint')))
    } else if (svc.state === 'error') {
      box.appendChild(el('h3', '', cvT('askErrorTitle')))
      box.appendChild(el('p', 'errMsg', messageText(svc.messageKey, svc.messageParams, svc.message)))
      if (svc.detail) {
        const details = el('details', 'errDetail')
        details.appendChild(el('summary', '', cvT('svcDetailTitle')))
        details.appendChild(el('pre', '', svc.detail.trim()))
        box.appendChild(details)
      }
      box.appendChild(stateActionButton('askRetry'))
    } else {
      box.appendChild(el('h3', '', cvT('askOffTitle')))
      box.appendChild(el('p', '', cvT('askOffText')))
      box.appendChild(el('p', 'target', cvT('askOffTarget', { target: targetLabel(svc.target) })))
      box.appendChild(stateActionButton('askTurnOn'))
    }
    host.appendChild(box)
  }

  function renderMode() {
    renderBar()
    renderStatePanel()
    $('askSearch').hidden = svc.state !== 'ready'
    renderIndexNote()
  }

  // ---- Filtres ----

  function chipButton(label, pressed, onClick, iconFile) {
    const btn = el('button', 'chip')
    btn.type = 'button'
    btn.setAttribute('aria-pressed', pressed ? 'true' : 'false')
    if (iconFile) {
      const img = el('img')
      img.src = '../assets/' + iconFile
      img.alt = ''
      img.addEventListener('error', () => { img.style.display = 'none' })
      btn.appendChild(img)
    }
    btn.appendChild(el('span', '', label))
    btn.addEventListener('click', onClick)
    return btn
  }

  function visibleApps() {
    const perApp = svc.index && svc.index.perApp ? svc.index.perApp : {}
    const known = Object.keys(perApp).length > 0
    return (appList || []).filter((a) => !known || perApp[a.id] > 0)
  }

  function renderChips() {
    const host = $('askApps')
    host.textContent = ''
    const apps = visibleApps()
    // Une app retiree de la liste (index sans elle) ne doit pas rester filtree en silence.
    for (const id of [...selectedApps]) if (!apps.some((a) => a.id === id)) selectedApps.delete(id)
    host.appendChild(chipButton(cvT('askAppsAll'), selectedApps.size === 0, () => { selectedApps.clear(); renderChips(); refilter() }))
    for (const app of apps) {
      host.appendChild(chipButton(app.label, selectedApps.has(app.id), () => {
        if (selectedApps.has(app.id)) selectedApps.delete(app.id)
        else selectedApps.add(app.id)
        renderChips()
        refilter()
      }, app.icon))
    }
  }

  function renderSegments() {
    for (const btn of document.querySelectorAll('#askAudience button')) {
      btn.setAttribute('aria-pressed', btn.dataset.value === audience ? 'true' : 'false')
    }
    const lang = effectiveLang()
    for (const btn of document.querySelectorAll('#askLang button')) {
      btn.setAttribute('aria-pressed', btn.dataset.value === lang ? 'true' : 'false')
    }
  }

  // ---- Resultats ----

  function renderIndexNote() {
    const note = $('askIdxNote')
    const idx = svc.index
    const syncing = svc.state === 'ready' && idx && idx.syncing
    note.hidden = !syncing
    note.textContent = syncing
      ? (idx.total > 0 ? cvT('askIndexingNote', { done: idx.done, total: idx.total }) : cvT('askIndexingNoteBare'))
      : ''
  }

  function appInfo(appId) {
    const found = (appList || []).find((a) => a.id === appId)
    return found || { id: appId, label: appId, icon: '' }
  }

  function errorText(err) {
    switch (err.error) {
      case 'unreachable': return cvT('askErrUnreachable')
      case 'timeout': return cvT('askErrTimeout')
      case 'invalid': return err.key ? cvT(err.key, err.params) : cvT('askErrInvalid', { message: err.message })
      case 'http': return cvT('askErrHttp', { message: err.message })
      default: return cvT('askErrUnknown', { message: err.message || err.error })
    }
  }

  function snippetNode(text, terms) {
    const p = el('p', 'hitSnippet')
    for (const seg of cvAskRender.highlightSegments(text, terms)) {
      if (seg.mark) p.appendChild(el('mark', '', seg.text))
      else p.appendChild(document.createTextNode(seg.text))
    }
    return p
  }

  function hitCard(hit, terms, ctx) {
    const info = appInfo(hit.app)
    const card = el('div', 'hit')

    const open = el('button', 'hitOpen')
    open.type = 'button'
    open.title = cvT('askOpenHit')
    const head = el('div', 'hitHead')
    if (info.icon) {
      const img = el('img')
      img.src = '../assets/' + info.icon
      img.alt = ''
      img.addEventListener('error', () => { img.style.display = 'none' })
      head.appendChild(img)
    }
    head.appendChild(el('span', 'hitApp', info.label))
    head.appendChild(el('span', 'langBadge', hit.lang.toUpperCase()))
    const score = el('span', 'hitScore')
    // `score` n'est qu'un rang (1er = 100 % meme hors sujet) : la barre montre la pertinence
    // mesuree par le modele quand elle existe, sinon une barre a moitie, annoncee comme telle.
    const measured = hit.relevance !== null && hit.relevance !== undefined
    score.title = measured
      ? cvT('askScoreTitle') + ' ' + Math.round(hit.relevance * 100) + '%'
      : cvT('askRelevanceUnknown')
    const bar = el('i')
    bar.style.width = Math.max(6, Math.round((measured ? hit.relevance : 0.5) * 100)) + '%'
    score.appendChild(bar)
    head.appendChild(score)
    open.appendChild(head)
    open.appendChild(el('div', 'hitTitle', hit.title))
    if (hit.headingPath.length) {
      const crumb = el('div', 'hitCrumb')
      for (const part of hit.headingPath) crumb.appendChild(el('span', '', part))
      open.appendChild(crumb)
    }
    open.appendChild(snippetNode(hit.snippet, terms))
    open.addEventListener('click', () => void openResult(hit.app, hit.doc, hit.headingIdx, hit.lang, ctx))
    card.appendChild(open)

    if (hit.otherLang) {
      const foot = el('div', 'hitTwin')
      const twin = el('button', 'twinLink', cvT(hit.otherLang.lang === 'fr' ? 'askTwinFr' : 'askTwinEn'))
      twin.type = 'button'
      twin.addEventListener('click', () => void openResult(hit.app, hit.otherLang.doc, hit.otherLang.headingIdx, hit.otherLang.lang, ctx))
      foot.appendChild(twin)
      card.appendChild(foot)
    }
    return card
  }

  function renderResults() {
    const host = $('askResults')
    const meta = $('askMeta')
    host.textContent = ''
    meta.textContent = ''
    meta.className = 'askMeta'
    if (busy) meta.textContent = cvT('askSearching')
    if (!outcome) {
      if (!busy) host.appendChild(el('p', 'askInitial', cvT('askInitial')))
      return
    }
    if (outcome.error) {
      host.appendChild(el('div', 'askErr', errorText(outcome.error)))
      return
    }
    const { request, result } = outcome
    if (!busy) {
      const mode = cvT(result.mode === 'keyword' ? 'askModeKeyword' : 'askModeHybrid')
      meta.textContent = cvT('askMeta', { n: result.hits.length, ms: Math.round(result.tookMs) }) + ' - ' + mode
    }
    if (result.mode === 'keyword') {
      host.appendChild(el('div', 'askNote', result.notice || cvT('askKeywordNotice')))
    } else if (result.confidence === 'low' && result.hits.length) {
      host.appendChild(el('div', 'askNote low', cvT('askLowConfidence')))
    }
    if (!result.hits.length) {
      const empty = el('div', 'askEmpty')
      empty.appendChild(el('h3', '', cvT('askNoResults', { q: request.q })))
      empty.appendChild(el('p', '', cvT('askNoResultsTips')))
      host.appendChild(empty)
      return
    }
    const list = result.hits.map((h) => ({ app: h.app, doc: h.doc, headingIdx: h.headingIdx, lang: h.lang, title: h.title }))
    result.hits.forEach((hit, index) => host.appendChild(hitCard(hit, result.terms, { hits: list, index })))
  }

  async function runSearch() {
    const q = $('askInput').value.trim()
    if (!q || svc.state !== 'ready') { $('askInput').focus(); return }
    if (q.length < 2) {
      outcome = { error: { ok: false, error: 'invalid', message: '', key: 'askMinChars' } }
      renderResults()
      return
    }
    const request = buildRequest(q)
    const mine = ++seq
    busy = true
    $('askSubmit').disabled = true
    renderResults()
    let reply
    try {
      reply = await window.cvDocs.docsSearch(request)
    } catch (err) {
      reply = { ok: false, error: 'unknown', message: err && err.message ? err.message : String(err) }
    }
    if (mine !== seq) return
    busy = false
    $('askSubmit').disabled = false
    lastQuery = q
    lastRequestKey = JSON.stringify({ ...request, q: '' })
    outcome = reply.ok ? { request, result: reply.result } : { error: reply }
    renderResults()
    if (reply.ok) {
      pushRecent(q)
      window.docNav.recordAsk()
    }
    // Le service a pu s'arreter entre-temps : on relit son etat pour l'afficher.
    if (!reply.ok && reply.error !== 'invalid') void window.cvDocs.docsServiceStatus().then(applyStatus)
  }

  // ---- Ouverture d'un resultat dans "Docs par app" ----

  async function openResult(appId, file, headingIdx, lang, ctx) {
    window.docNav.setResultCtx(ctx || null)
    // La fenetre doit etre dans la langue de la section : setDocsLang vide le
    // cache des docs, openDoc le recharge dans la nouvelle langue avant de defiler.
    if (lang && lang !== CV_LANG) await setDocsLang(lang, { research: false })
    await openDoc(appId, file, headingIdx)
  }

  // ---- Instantane pour l'historique de navigation ----

  window.askSnapshot = function () {
    return {
      query: lastQuery,
      outcome,
      requestKey: lastRequestKey,
      apps: [...selectedApps],
      audience,
      langPick,
    }
  }

  window.askRestore = function (snap) {
    if (!snap) return
    lastQuery = snap.query
    lastRequestKey = snap.requestKey
    outcome = snap.outcome
    selectedApps.clear()
    for (const id of snap.apps) selectedApps.add(id)
    audience = snap.audience
    langPick = snap.langPick
    $('askInput').value = snap.query
    renderChips()
    renderSegments()
    renderResults()
  }

  // ---- Questions recentes (propres a cette machine) ----

  const RECENT_KEY = 'cvDocsRecentQuestions'
  const RECENT_MAX = 8

  function readRecent() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
      return Array.isArray(raw) ? raw.filter((q) => typeof q === 'string').slice(0, RECENT_MAX) : []
    } catch (e) {
      return []
    }
  }

  function writeRecent(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch (e) { /* stockage indisponible : sans effet */ }
  }

  function pushRecent(q) {
    const list = [q, ...readRecent().filter((x) => x !== q)].slice(0, RECENT_MAX)
    writeRecent(list)
    renderRecent()
  }

  function renderRecent() {
    const host = $('askRecent')
    const list = readRecent()
    host.textContent = ''
    host.hidden = list.length === 0
    if (!list.length) return
    host.appendChild(el('span', '', cvT('askRecent') + ' :'))
    for (const q of list) {
      const chip = el('button', 'chip', q)
      chip.type = 'button'
      chip.title = q
      chip.addEventListener('click', () => { $('askInput').value = q; void runSearch() })
      host.appendChild(chip)
    }
    const clear = el('button', 'clearRecent', cvT('askClearRecent'))
    clear.type = 'button'
    clear.addEventListener('click', () => { writeRecent([]); renderRecent() })
    host.appendChild(clear)
  }

  // ---- Etat du service et cycle de vie de l'onglet ----

  function applyStatus(status) {
    const perAppBefore = JSON.stringify(svc.index && svc.index.perApp)
    const modelWasLoaded = !!(svc.index && svc.index.modelLoaded)
    svc = status
    renderMode()
    if (JSON.stringify(svc.index && svc.index.perApp) !== perAppBefore) renderChips()
    // Une recherche faite pendant le chargement du modele n'a utilise que les mots-cles :
    // on la rejoue des qu'il est pret, sans que l'utilisateur ait a reappuyer.
    const nowLoaded = !!(svc.index && svc.index.modelLoaded)
    if (!modelWasLoaded && nowLoaded && svc.state === 'ready' && !busy
      && outcome && outcome.result && outcome.result.mode === 'keyword' && lastQuery) {
      $('askInput').value = lastQuery
      void runSearch()
    }
  }

  // Un changement de filtre rejoue la recherche en cours : les resultats affiches ne
  // correspondraient plus a ce qui est selectionne.
  function refilter() {
    if (svc.state === 'ready' && !busy && outcome && outcome.result && lastQuery) {
      $('askInput').value = lastQuery
      void runSearch()
    }
  }

  async function loadApps() {
    const docs = await ensureAppDocs()
    appList = docs.filter((e) => e.files.length).map((e) => ({ id: e.appId, label: e.label, icon: e.icon }))
    renderChips()
  }

  // Appele par docs.html a chaque affichage de l'onglet.
  window.askOnShow = function () {
    if (!appList) void loadApps()
    void window.cvDocs.docsServiceStatus().then(applyStatus)
    // Au retour d'une ouverture de resultat qui a change la langue de la fenetre.
    if (outcome && outcome.result && svc.state === 'ready' && lastRequestKey !== JSON.stringify({ ...buildRequest(lastQuery), q: '' })) {
      $('askInput').value = lastQuery
      void runSearch()
    }
    if (svc.state === 'ready') $('askInput').focus()
  }

  // Appele par docs.html quand la langue de la fenetre change.
  window.askOnLangChange = function (research) {
    if (langPick === 'fr' || langPick === 'en') langPick = null
    renderMode()
    renderChips()
    renderSegments()
    renderResults()
    renderRecent()
    if (research && outcome && outcome.result && svc.state === 'ready') {
      $('askInput').value = lastQuery
      void runSearch()
    }
  }

  function init() {
    $('askSwitch').addEventListener('click', () => void toggleService())
    $('askReindex').addEventListener('click', () => void window.cvDocs.docsSync())
    $('askForm').addEventListener('submit', (ev) => { ev.preventDefault(); void runSearch() })
    for (const btn of document.querySelectorAll('#askAudience button')) {
      btn.addEventListener('click', () => { audience = btn.dataset.value; renderSegments(); refilter() })
    }
    for (const btn of document.querySelectorAll('#askLang button')) {
      btn.addEventListener('click', () => {
        // "Les deux" est l'etat par defaut ; FR ou EN restreignent la recherche a cette langue.
        langPick = btn.dataset.value === 'both' ? null : btn.dataset.value
        renderSegments()
        refilter()
      })
    }
    window.cvDocs.onDocsServiceStatus(applyStatus)
    void window.cvDocs.docsServiceStatus().then(applyStatus)
    renderMode()
    renderChips()
    renderSegments()
    renderResults()
    renderRecent()
  }

  init()
})()
