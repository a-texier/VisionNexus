// ============================================================
// Tests du frontmatter et du tri des pages de doc (node:test).
// ============================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as path from 'path'

import { parseFrontmatter, selectDocsForLang, sortDocFiles, sourceBundleDir, sourceDocsPath } from './docFiles'
import type { AppDocFile } from './preloadDocs'

test('frontmatter : scalaires, listes en ligne, corps sans le bloc', () => {
  const { meta, body } = parseFrontmatter(
    '---\napp: annotation\ntitle: "Guide: utilisateur"\norder: 20\ntags: [sam2, suivi]\nsources: []\n---\n# Titre\n')
  assert.equal(meta.app, 'annotation')
  assert.equal(meta.title, 'Guide: utilisateur')
  assert.equal(meta.order, '20')
  assert.deepEqual(meta.tags, ['sam2', 'suivi'])
  assert.deepEqual(meta.sources, [])
  assert.equal(body, '# Titre\n')
})

test('frontmatter absent ou non ferme : contenu intact', () => {
  assert.deepEqual(parseFrontmatter('# Titre\n'), { meta: {}, body: '# Titre\n' })
  assert.deepEqual(parseFrontmatter('---\napp: x\n# Titre\n').meta, {})
})

test('choix de langue avec repli sur l autre fichier', () => {
  const files = ['README.md', 'README.fr.md', 'concepts.md']
  assert.deepEqual(selectDocsForLang(files, 'fr'), ['README.fr.md', 'concepts.md'])
  assert.deepEqual(selectDocsForLang(files, 'en'), ['README.md', 'concepts.md'])
})

test('tri : order d abord, README sans order en tete, le reste a la fin', () => {
  const mk = (file: string, order?: number): AppDocFile => ({ file, lang: 'en', title: file, content: '', baseUrl: '', order })
  const sorted = sortDocFiles([mk('extra'), mk('workflows', 20), mk('README'), mk('user-guide', 10)])
  assert.deepEqual(sorted.map((f) => f.file), ['README', 'user-guide', 'workflows', 'extra'])
})

test('source : dossier des pages et dossier du bundle', () => {
  const app = { id: 'annotation', dir: 'Annotation_App', indexed: true }
  const suite = { id: 'suite', dir: '.', docs_path: 'docs', indexed: true }
  assert.equal(sourceDocsPath(app), path.join('Annotation_App', 'docs'))
  assert.equal(sourceDocsPath(suite), 'docs')
  assert.equal(sourceBundleDir(app), 'Annotation_App')
  assert.equal(sourceBundleDir(suite), 'suite')
})
