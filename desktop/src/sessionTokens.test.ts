// ============================================================
// Tests de sessionTokens.ts : rangement des jetons par port, en-tete
// reserve aux instances locales, chemin de redirection du lien d'amorcage.
// ============================================================

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  TOKEN_HEADER, authHeaders, backendPortFor, clearTokens, forgetPorts, rememberToken,
  safeNextPath, tokenForPort, tokenForUrl,
} from './sessionTokens'

beforeEach(() => clearTokens())

test('un jeton couvre le port frontend et le port backend de son instance', () => {
  rememberToken('t1', 8005, 5175)
  assert.equal(tokenForPort(8005), 't1')
  assert.equal(tokenForPort(5175), 't1')
  assert.equal(backendPortFor(5175), 8005)
})

test('en-tete uniquement vers la boucle locale et un port connu', () => {
  rememberToken('t1', 8005, 5175)
  assert.deepEqual(authHeaders('http://127.0.0.1:5175/api/projects'), { [TOKEN_HEADER]: 't1' })
  assert.deepEqual(authHeaders('http://localhost:8005/health'), { [TOKEN_HEADER]: 't1' })
  assert.equal(tokenForUrl('ws://127.0.0.1:5175/ws/tasks/1'), 't1')
  assert.deepEqual(authHeaders('http://10.0.0.5:5175/api/projects'), {})
  assert.deepEqual(authHeaders('https://example.org/'), {})
  assert.deepEqual(authHeaders('http://127.0.0.1:9999/'), {})
})

test('sans jeton ou sans port backend, rien n\'est range', () => {
  rememberToken(undefined, 8005, 5175)
  rememberToken('t', null, 5175)
  assert.equal(tokenForPort(5175), undefined)
})

test('forgetPorts efface l\'instance', () => {
  rememberToken('t1', 8005, 5175)
  forgetPorts([8005, 5175])
  assert.equal(tokenForUrl('http://127.0.0.1:5175/'), undefined)
})

test('safeNextPath : redirection interne uniquement', () => {
  assert.equal(safeNextPath('/runs?x=1'), '/runs?x=1')
  assert.equal(safeNextPath('//site-externe.example/'), '/')
  assert.equal(safeNextPath('https://site-externe.example/'), '/')
  assert.equal(safeNextPath('/\\site-externe.example'), '/')
})
