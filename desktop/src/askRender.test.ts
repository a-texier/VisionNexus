// ============================================================
// Tests du surlignage de l'onglet "Demander a la doc" (ui/ask-render.js).
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

type Segment = { text: string; mark: boolean }
const { highlightSegments } = require('../ui/ask-render.js') as {
  highlightSegments: (text: string, terms: string[]) => Segment[]
}

const marked = (segments: Segment[]): string[] => segments.filter((s) => s.mark).map((s) => s.text)

test('surlignage insensible a la casse', () => {
  const s = highlightSegments('Export the dataset to YOLO', ['export', 'yolo'])
  assert.deepEqual(marked(s), ['Export', 'YOLO'])
  assert.equal(s.map((x) => x.text).join(''), 'Export the dataset to YOLO')
})

test('surlignage insensible aux accents, dans les deux sens', () => {
  assert.deepEqual(marked(highlightSegments('Proc\u00e9dures d\'exportation', ['procedures'])), ['Proc\u00e9dures'])
  assert.deepEqual(marked(highlightSegments('Procedures', ['proc\u00e9dures'])), ['Procedures'])
})

test('accent decompose : la marque est incluse dans le mot surligne', () => {
  const s = highlightSegments('Proce\u0301dures', ['procedures'])
  assert.equal(s.length, 1)
  assert.equal(s[0].mark, true)
  assert.equal(s[0].text, 'Proce\u0301dures')
})

test('occurrences qui se chevauchent : fusionnees', () => {
  assert.deepEqual(marked(highlightSegments('exporter', ['export', 'porter'])), ['exporter'])
})

test('terme trop court ou vide ignore, texte rendu intact', () => {
  const s = highlightSegments('a b c', ['a', '', ' '])
  assert.deepEqual(s, [{ text: 'a b c', mark: false }])
})

test('le HTML d\'un extrait reste du texte : aucun echappement necessaire ici', () => {
  const s = highlightSegments('<img src=x onerror=alert(1)> export', ['export'])
  assert.equal(s.map((x) => x.text).join(''), '<img src=x onerror=alert(1)> export')
  assert.deepEqual(marked(s), ['export'])
})

test('aucun terme : un seul segment non marque', () => {
  assert.deepEqual(highlightSegments('rien', []), [{ text: 'rien', mark: false }])
})
