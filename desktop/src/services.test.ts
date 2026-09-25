// ============================================================
// Tests de services.ts (node:test, sans dependance externe) : machine a
// etats, validation des entrees IPC, mapping des reponses, appel HTTP.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  nextServiceState, canStart, summarizeIndexStatus, validateSearchRequest, mapSearchResponse, toServiceBody, startFailureKey,
  serviceGuard, startFailureMessage, forwardToService, MAX_QUERY_CHARS,
  type ServiceState, type ServiceEvent,
} from './services'

// ---- Machine a etats ----

test('parcours nominal : off -> starting -> ready -> stopping -> off', () => {
  let s: ServiceState = 'off'
  for (const [event, expected] of [
    ['start', 'starting'], ['ready', 'ready'], ['stop', 'stopping'], ['stopped', 'off'],
  ] as [ServiceEvent, ServiceState][]) {
    s = nextServiceState(s, event)
    assert.equal(s, expected)
  }
})

test('echec au demarrage ou en marche -> error, puis relance possible', () => {
  assert.equal(nextServiceState('starting', 'fail'), 'error')
  assert.equal(nextServiceState('ready', 'fail'), 'error')
  assert.equal(nextServiceState('error', 'start'), 'starting')
  assert.equal(canStart('error'), true)
})

test('double demarrage : jamais une 2e fois pendant starting/ready/stopping', () => {
  for (const s of ['starting', 'ready', 'stopping'] as ServiceState[]) {
    assert.equal(nextServiceState(s, 'start'), s)
    assert.equal(canStart(s), false)
  }
  assert.equal(canStart('off'), true)
})

test('arret pendant le demarrage passe par stopping ; un echec tardif est ignore', () => {
  assert.equal(nextServiceState('starting', 'stop'), 'stopping')
  assert.equal(nextServiceState('stopping', 'fail'), 'stopping')
  assert.equal(nextServiceState('stopping', 'ready'), 'stopping')
})

test('arret d\'un service en erreur ou deja eteint -> off, idempotent', () => {
  assert.equal(nextServiceState('error', 'stop'), 'off')
  assert.equal(nextServiceState('off', 'stop'), 'off')
  assert.equal(nextServiceState('off', 'stopped'), 'off')
  assert.equal(nextServiceState('off', 'ready'), 'off')
})

// ---- Etat de l'index ----

test('index : avancement en chunks pendant l\'embedding, en fichiers avant', () => {
  const embedding = summarizeIndexStatus({
    syncing: true, chunks: 400, embedded: 120, model_available: true, model_loaded: false,
    progress: { phase: 'embedding', files_total: 50, files_done: 50, chunks_to_embed: 300, chunks_embedded: 120 },
  })
  assert.deepEqual([embedding?.done, embedding?.total, embedding?.syncing], [120, 300, true])
  const scanning = summarizeIndexStatus({
    syncing: true, progress: { files_total: 50, files_done: 12, chunks_to_embed: 0, chunks_embedded: 0 },
  })
  assert.deepEqual([scanning?.done, scanning?.total], [12, 50])
})

test('index : passages par app, apps vides ecartees', () => {
  const s = summarizeIndexStatus({ per_app: { annotation: 120, explorer: 0, junk: 'x' } })
  assert.deepEqual(s?.perApp, { annotation: 120 })
})

test('index : entree invalide ou incomplete toleree', () => {
  assert.equal(summarizeIndexStatus('nope'), null)
  const idle = summarizeIndexStatus({ syncing: false, last_error: 'boom' })
  assert.equal(idle?.syncing, false)
  assert.equal(idle?.lastError, 'boom')
  assert.equal(idle?.total, 0)
})

// ---- Garde du pont ----

test('serviceGuard : seul ready laisse passer, les autres etats ont un code', () => {
  assert.equal(serviceGuard({ state: 'ready', message: '' }), null)
  assert.equal(serviceGuard({ state: 'off', message: '' })?.error, 'off')
  assert.equal(serviceGuard({ state: 'starting', message: '' })?.error, 'starting')
  assert.equal(serviceGuard({ state: 'stopping', message: '' })?.error, 'stopping')
  const err = serviceGuard({ state: 'error', message: 'port pris' })
  assert.equal(err?.error, 'error')
  assert.equal(err?.message, 'port pris')
})

test('startFailureMessage : port occupe cite les ports', () => {
  assert.match(startFailureMessage({ kind: 'busy-port', ports: [8068] }), /8068/)
  assert.match(startFailureMessage({ kind: 'exited', code: 1 }), /code 1/)
})

// ---- Validation de la requete de recherche ----

test('validateSearchRequest : valeurs par defaut', () => {
  const r = validateSearchRequest({ q: '  export yolo  ' })
  assert.ok(r.ok)
  if (r.ok) {
    assert.deepEqual(r.value, { q: 'export yolo', lang: 'both', apps: [], audience: 'all', k: 8, prefer: 'auto', uiLang: 'en' })
  }
})

test('validateSearchRequest : requete complete valide, apps dedoublonnees', () => {
  const r = validateSearchRequest({
    q: 'comment exporter', lang: 'fr', apps: ['annotation', 'annotation', 'explorer'],
    audience: 'user', k: 12, prefer: 'fr',
  })
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual(r.value.apps, ['annotation', 'explorer'])
})

test('validateSearchRequest : prefer auto et langue de repli', () => {
  const r = validateSearchRequest({ q: 'sam2', prefer: 'auto', uiLang: 'fr' })
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.value.prefer, 'auto')
    assert.equal(r.value.uiLang, 'fr')
    // le service attend ui_lang en snake_case, sans champ camelCase en plus
    assert.deepEqual(toServiceBody(r.value), { q: 'sam2', lang: 'both', apps: [], audience: 'all', k: 8, prefer: 'auto', ui_lang: 'fr' })
  }
  assert.equal(validateSearchRequest({ q: 'a', uiLang: 'de' }).ok, false)
})

test('validateSearchRequest : les erreurs de saisie portent une cle i18n', () => {
  const empty = validateSearchRequest({ q: '  ' })
  assert.ok(!empty.ok && empty.key === 'askErrEmpty')
  const long = validateSearchRequest({ q: 'x'.repeat(MAX_QUERY_CHARS + 1) })
  assert.ok(!long.ok && long.key === 'askErrTooLong' && long.params?.max === MAX_QUERY_CHARS)
})

test('startFailureKey : une cle par echec de demarrage, avec ses parametres', () => {
  assert.deepEqual(startFailureKey({ kind: 'settings' }), { key: 'svcErrSettings' })
  assert.deepEqual(startFailureKey({ kind: 'busy-port', ports: [8068, 8069] }), { key: 'svcErrBusyPort', params: { ports: '8068, 8069' } })
  assert.deepEqual(startFailureKey({ kind: 'exited', code: null }), { key: 'svcErrExited', params: { code: '?' } })
  assert.equal(startFailureKey({ kind: 'tunnel', detail: 'boom' }).params?.detail, 'boom')
})

test('validateSearchRequest : refuse types, bornes et valeurs hors liste', () => {
  const bad: unknown[] = [
    null, 'str', {}, { q: 42 }, { q: '   ' }, { q: 'x'.repeat(MAX_QUERY_CHARS + 1) },
    { q: 'a', lang: 'de' }, { q: 'a', audience: 'root' }, { q: 'a', prefer: 'both' },
    { q: 'a', k: 0 }, { q: 'a', k: 31 }, { q: 'a', k: 2.5 }, { q: 'a', k: '8' },
    { q: 'a', apps: 'annotation' }, { q: 'a', apps: ['../etc'] }, { q: 'a', apps: [1] },
    { q: 'a', apps: Array.from({ length: 21 }, (_, i) => `app${i}`) },
  ]
  for (const input of bad) {
    const r = validateSearchRequest(input)
    assert.equal(r.ok, false, JSON.stringify(input))
    if (!r.ok) assert.equal(r.error, 'invalid')
  }
  assert.ok(validateSearchRequest({ q: 'x'.repeat(MAX_QUERY_CHARS) }).ok)
})

// ---- Mapping de la reponse du service ----

const RAW_HIT = {
  app: 'annotation', doc: 'workflows', doc_type: 'workflows', audience: 'user', lang: 'en',
  title: 'Workflows', heading_path: ['Workflows', 'Export'], heading_idx: 14, part: null,
  snippet: 'Click Export in the top toolbar', score: 0.97, vector_score: 0.89, keyword_rank: 1,
  other_lang: { lang: 'fr', doc: 'workflows', heading_idx: 15 },
}

test('mapSearchResponse : champs renommes en camelCase, twin conserve', () => {
  const r = mapSearchResponse({ mode: 'hybrid', took_ms: 21.4, terms: ['export', 'yolo'], notice: null, hits: [RAW_HIT] })
  assert.ok(r)
  assert.equal(r.mode, 'hybrid')
  assert.deepEqual(r.terms, ['export', 'yolo'])
  assert.equal(r.notice, null)
  assert.deepEqual(r.hits[0].headingPath, ['Workflows', 'Export'])
  assert.equal(r.hits[0].headingIdx, 14)
  assert.deepEqual(r.hits[0].otherLang, { lang: 'fr', doc: 'workflows', headingIdx: 15 })
  assert.equal(r.hits[0].score, 0.97)
})

test('mapSearchResponse : pertinence, confiance et langue detectee', () => {
  const r = mapSearchResponse({
    mode: 'hybrid', took_ms: 5, terms: ['a'], confidence: 'low', lang_detected: 'fr',
    hits: [{ ...RAW_HIT, relevance: 0.42 }, { ...RAW_HIT, relevance: null }, { ...RAW_HIT, relevance: 7 }, RAW_HIT],
  })
  assert.equal(r?.confidence, 'low')
  assert.equal(r?.langDetected, 'fr')
  assert.deepEqual(r?.hits.map((h) => h.relevance), [0.42, null, 1, null])   // borne a 1, absent = null
  const none = mapSearchResponse({ mode: 'hybrid', hits: [], confidence: 'weird', lang_detected: 'de' })
  assert.equal(none?.confidence, null)
  assert.equal(none?.langDetected, null)
})

test('mapSearchResponse : mode keyword + notice, hit sans twin', () => {
  const r = mapSearchResponse({
    mode: 'keyword', took_ms: 3, terms: [], notice: 'Modele en chargement',
    hits: [{ ...RAW_HIT, other_lang: null, score: 3.2 }],
  })
  assert.equal(r?.mode, 'keyword')
  assert.equal(r?.notice, 'Modele en chargement')
  assert.equal(r?.hits[0].otherLang, null)
  assert.equal(r?.hits[0].score, 1)   // borne a 1
})

test('mapSearchResponse : ecarte les hits inexploitables, refuse une reponse mal formee', () => {
  const r = mapSearchResponse({
    mode: 'hybrid', took_ms: 1, terms: ['a'],
    hits: [RAW_HIT, { ...RAW_HIT, heading_idx: -1 }, { ...RAW_HIT, lang: 'de' }, { ...RAW_HIT, app: '' }, 'junk', null],
  })
  assert.equal(r?.hits.length, 1)
  assert.equal(mapSearchResponse(null), null)
  assert.equal(mapSearchResponse({ mode: 'hybrid' }), null)
})

test('mapSearchResponse : un twin incomplet est ignore, pas le hit', () => {
  const r = mapSearchResponse({ hits: [{ ...RAW_HIT, other_lang: { lang: 'fr', doc: 'x' } }] })
  assert.equal(r?.hits.length, 1)
  assert.equal(r?.hits[0].otherLang, null)
})

// ---- forwardToService (serveur HTTP local factice) ----

function stubServer(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({
      port: (srv.address() as AddressInfo).port,
      close: () => new Promise((res) => { srv.closeAllConnections(); srv.close(() => res()) }),
    }))
  })
}

test('forwardToService : GET et POST JSON relayes', async () => {
  let seen = ''
  const srv = await stubServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen = `${req.method} ${req.url} ${body}`
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ hello: 'world' }))
    })
  })
  try {
    const get = await forwardToService(srv.port, '/health', { timeoutMs: 2000 })
    assert.deepEqual(get, { ok: true, data: { hello: 'world' } })
    const post = await forwardToService(srv.port, '/search', { method: 'POST', body: { q: 'a' }, timeoutMs: 2000 })
    assert.ok(post.ok)
    assert.equal(seen, 'POST /search {"q":"a"}')
  } finally {
    await srv.close()
  }
})

test('forwardToService : statut HTTP d\'erreur -> code http avec le detail', async () => {
  const srv = await stubServer((_req, res) => {
    res.statusCode = 409
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ detail: 'sync en cours' }))
  })
  try {
    const r = await forwardToService(srv.port, '/index/rebuild', { method: 'POST', timeoutMs: 2000 })
    assert.equal(r.ok, false)
    if (!r.ok) {
      assert.equal(r.error, 'http')
      assert.match(r.message, /409.*sync en cours/)
    }
  } finally {
    await srv.close()
  }
})

test('forwardToService : timeout et service injoignable sont distingues', async () => {
  const slow = await stubServer(() => { /* ne repond jamais */ })
  try {
    const t = await forwardToService(slow.port, '/health', { timeoutMs: 150 })
    assert.equal(t.ok === false && t.error, 'timeout')
  } finally {
    await slow.close()
  }
  // Port qui vient d'etre libere : rien n'ecoute.
  const gone = await stubServer((_req, res) => res.end('{}'))
  await gone.close()
  const u = await forwardToService(gone.port, '/health', { timeoutMs: 1000 })
  assert.equal(u.ok === false && u.error, 'unreachable')
})
