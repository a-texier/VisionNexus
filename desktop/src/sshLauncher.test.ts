// ============================================================
// Tests des parties pures de sshLauncher.ts : lecture des lignes
// "[config] ..." de launcher.py (dont "frontend = none" d'un service) et
// arguments du tunnel ssh. Le chemin ssh/VM lui-meme n'est pas exerce ici.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

import { createPortsCollector, redactLauncherLine, tunnelArgs, waitForPorts } from './sshLauncher'

const BACKEND = '[config] backend   = http://localhost:8068'
const FRONTEND = '[config] frontend  = http://localhost:5173'
const NONE = '[config] frontend  = none'

test('app normale : les deux lignes donnent les deux ports', () => {
  const feed = createPortsCollector(false)
  assert.equal(feed(BACKEND), null)
  assert.deepEqual(feed(FRONTEND), { backendPort: 8068, frontendPort: 5173 })
})

test('app normale : l\'ordre des lignes est indifferent', () => {
  const feed = createPortsCollector(false)
  assert.equal(feed(FRONTEND), null)
  assert.deepEqual(feed(BACKEND), { backendPort: 8068, frontendPort: 5173 })
})

test('app normale : "frontend = none" n\'est jamais accepte', () => {
  const feed = createPortsCollector(false)
  assert.equal(feed(BACKEND), null)
  assert.equal(feed(NONE), null)
  assert.deepEqual(feed(FRONTEND), { backendPort: 8068, frontendPort: 5173 })
})

test('service : "frontend = none" donne frontendPort null', () => {
  const feed = createPortsCollector(true)
  assert.equal(feed(BACKEND), null)
  assert.deepEqual(feed(NONE), { backendPort: 8068, frontendPort: null })
})

test('service : pas de resultat tant que le backend n\'est pas annonce', () => {
  const feed = createPortsCollector(true)
  assert.equal(feed(NONE), null)
  assert.equal(feed('[config] workspace = D:/ws'), null)
  assert.deepEqual(feed(BACKEND), { backendPort: 8068, frontendPort: null })
})

test('lignes tolerantes : casse, espaces, bruit autour', () => {
  const feed = createPortsCollector(true)
  assert.equal(feed('INFO [Config] Backend=http://localhost:9001'), null)
  assert.deepEqual(feed('[config]   FRONTEND   =   NONE'), { backendPort: 9001, frontendPort: null })
})

test('waitForPorts : resout un service sur les lignes de stdout', async () => {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  const lines: string[] = []
  const pending = waitForPorts(proc as unknown as ChildProcess, (l) => lines.push(l), 2000, true)
  proc.stdout.emit('data', Buffer.from(`${BACKEND}\r\n${NONE}\r\n`))
  assert.deepEqual(await pending, { backendPort: 8068, frontendPort: null })
  assert.equal(lines.length, 2)
})

test('waitForPorts : sortie prematuree du process -> null', async () => {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  const pending = waitForPorts(proc as unknown as ChildProcess, () => undefined, 2000, true)
  proc.emit('exit', 1)
  assert.equal(await pending, null)
})

test('jeton annonce avant les ports : rendu avec eux', () => {
  const feed = createPortsCollector(false)
  assert.equal(feed('[token] abc_DEF-123'), null)
  assert.equal(feed(BACKEND), null)
  assert.deepEqual(feed(FRONTEND), { backendPort: 8068, frontendPort: 5173, token: 'abc_DEF-123' })
})

test('waitForPorts : le jeton et le lien navigateur ne sont jamais journalises', async () => {
  const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  const lines: string[] = []
  const pending = waitForPorts(proc as unknown as ChildProcess, (l) => lines.push(l), 2000)
  proc.stdout.emit('data', Buffer.from(
    '[token] secret-xyz\n[auth] navigateur (lien a usage unique, 30 min) : http://127.0.0.1:5173/api/_auth/bootstrap?code=c0de\n'
    + `${BACKEND}\n${FRONTEND}\n`,
  ))
  assert.deepEqual(await pending, { backendPort: 8068, frontendPort: 5173, token: 'secret-xyz' })
  const joined = lines.join('\n')
  assert.ok(!joined.includes('secret-xyz') && !joined.includes('c0de'))
})

test('redactLauncherLine : les autres lignes passent telles quelles', () => {
  assert.equal(redactLauncherLine(BACKEND), BACKEND)
  assert.notEqual(redactLauncherLine('[token] x'), '[token] x')
})

test('tunnelArgs : un seul -L pour un service, deux pour une app', () => {
  const svc = tunnelArgs('vm-gpu-01', [8068])
  assert.deepEqual(svc.filter((a) => a === '-L').length, 1)
  assert.ok(svc.includes('8068:localhost:8068'))
  assert.equal(svc[svc.length - 1], 'vm-gpu-01')
  assert.ok(svc.includes('ExitOnForwardFailure=yes'))

  const app = tunnelArgs('vm-gpu-01', [8000, 5173])
  assert.deepEqual(app.filter((a) => a === '-L').length, 2)
  assert.ok(app.includes('8000:localhost:8000') && app.includes('5173:localhost:5173'))
})

test('tunnelArgs : ports identiques dedoublonnes', () => {
  assert.equal(tunnelArgs('vm', [8000, 8000]).filter((a) => a === '-L').length, 1)
})
