// ============================================================
// Tests de classifyTunnelLine (node:test, sans dependance externe).
// Garde-fou de non-regression : le build de l'exe (dist:win/dist:linux) les
// execute et echoue si un "backend pas encore pret" redevient fatal.
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { classifyTunnelLine } from './tunnelClassify'

test('forward refuse au demarrage : transitoire, jamais fatal', () => {
  // La ligne exacte vue sur une VM quand le backend charge encore ses modeles.
  const v = classifyTunnelLine('channel 4: open failed: connect failed: Connection refused')
  assert.equal(v.fatal, false)
  assert.equal(v.transient, true)
})

test('autre forme d\'echec de forward par canal : transitoire', () => {
  const v = classifyTunnelLine('channel 12: open failed: administratively prohibited: open failed')
  assert.equal(v.fatal, false)
  assert.equal(v.transient, true)
})

test('hote injoignable : fatal', () => {
  const v = classifyTunnelLine('ssh: connect to host vm-gpu-01 port 22: Connection refused')
  assert.equal(v.fatal, true)
  assert.equal(v.transient, false)
})

test('port local deja pris : fatal', () => {
  assert.equal(classifyTunnelLine('bind: Address already in use').fatal, true)
  assert.equal(
    classifyTunnelLine('channel_setup_fwd_listener_tcpip: cannot listen to port: 8015').fatal,
    true,
  )
})

test('cle d\'hote refusee : fatal', () => {
  assert.equal(classifyTunnelLine('Host key verification failed.').fatal, true)
})

test('resolution DNS impossible : fatal', () => {
  assert.equal(classifyTunnelLine('ssh: Could not resolve hostname vm-gpu-01: Name or service not known').fatal, true)
})

test('bruit benin : ni fatal ni transitoire', () => {
  const known = classifyTunnelLine('Warning: Permanently added \'vm-gpu-01\' to the list of known hosts.')
  assert.equal(known.benign, true)
  assert.equal(known.fatal, false)
  const pty = classifyTunnelLine('Pseudo-terminal will not be allocated because stdin is not a terminal.')
  assert.equal(pty.benign, true)
  assert.equal(pty.fatal, false)
})

test('ligne inconnue : non fatale, bufferisee comme cause possible', () => {
  const v = classifyTunnelLine('some unexpected ssh notice')
  assert.equal(v.benign, false)
  assert.equal(v.transient, false)
  assert.equal(v.fatal, false)
})
