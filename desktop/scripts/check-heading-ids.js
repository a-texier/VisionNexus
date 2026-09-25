// ============================================================
// desktop/scripts/check-heading-ids.js
// Verifie que le viewer (ui/doc-render.js + marked vendorise) numerote les
// titres comme tools/docs/docs_lib.py : meme fixture, meme resultat attendu.
// Si les deux divergent, les ancres h-<n> du Docs Assistant tombent a cote.
// ============================================================
const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')

const marked = require('../ui/vendor/marked.min.js')
const { renderDoc } = require('../ui/doc-render.js')

const FIXTURES = path.join(__dirname, '..', '..', 'tools', 'docs', 'fixtures')
const md = fs.readFileSync(path.join(FIXTURES, 'headings.md'), 'utf-8')
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'headings.expected.json'), 'utf-8'))

const html = renderDoc(marked, md)
const actual = [...html.matchAll(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g)].map((m) => {
  const id = /id="h-(\d+)"/.exec(m[2])
  return { idx: id ? Number(id[1]) : null, level: Number(m[1]), text: m[3].replace(/<[^>]+>/g, '').trim() }
})

assert.deepEqual(actual, expected)
console.log(`check-heading-ids : ${actual.length} titres conformes`)
