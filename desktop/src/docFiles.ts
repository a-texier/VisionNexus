// ============================================================
// desktop/src/docFiles.ts
// Lecture de la doc par app : manifest (docs/docs_manifest.json, source
// unique de la liste des apps documentees, partage avec copy-docs.js et
// tools/docs/), frontmatter des pages, choix FR/EN et tri des onglets.
// Aucune dependance a Electron : testable sous node:test.
// ============================================================

import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

import type { AppDocFile } from './preloadDocs'

export interface DocSource {
  id: string
  dir: string
  /** Dossier des pages relatif a la racine du depot ; defaut <dir>/docs. */
  docs_path?: string
  indexed: boolean
}

export interface DocManifest {
  version: number
  doc_set: { name: string; doc_type: string; audience: string; order: number }[]
  sources: DocSource[]
}

export type FrontmatterValue = string | string[]

/** Dossier des pages d'une source, relatif a la racine du depot. */
export function sourceDocsPath(source: DocSource): string {
  return source.docs_path || path.join(source.dir, 'docs')
}

/**
 * Nom du dossier d'une source dans docs-bundle/ : sa `dir`, sauf `.` (la suite,
 * dont les pages sont dans docs/ a la racine) qui prendrait la racine du bundle.
 */
export function sourceBundleDir(source: DocSource): string {
  return source.dir === '.' ? source.id : source.dir
}

export function loadManifest(file: string): DocManifest | null {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as DocManifest
    return Array.isArray(data.sources) ? data : null
  } catch {
    return null
  }
}

function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1)
  return t
}

// Sous-ensemble YAML de DOC_STYLE.md : une cle par ligne, valeur scalaire ou
// liste en ligne [a, b]. Sans bloc ferme par '---', le fichier est pris tel
// quel (pas de frontmatter) plutot que d'avaler tout le contenu.
export function parseFrontmatter(text: string): { meta: Record<string, FrontmatterValue>; body: string } {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = src.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { meta: {}, body: src }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return { meta: {}, body: src }
  const meta: Record<string, FrontmatterValue> = {}
  for (const line of lines.slice(1, end)) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const raw = m[2].trim()
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1).trim()
      meta[m[1]] = inner ? inner.split(',').map(unquote).filter((v) => v !== '') : []
    } else {
      meta[m[1]] = unquote(raw)
    }
  }
  return { meta, body: lines.slice(end + 1).join('\n') }
}

// Chaque doc existe en 2 fichiers (base .md = EN, base.fr.md = FR -- meme
// convention que le reste du depot). Un listage brut du dossier montrait les
// deux comme des onglets separes, sans lien avec le FR/EN choisi dans cette
// fenetre : on regroupe par nom de base et on ne garde que le fichier de la
// langue demandee (repli sur l'autre langue si l'une des deux manque).
export function selectDocsForLang(mdFiles: string[], lang: 'fr' | 'en'): string[] {
  const bases = new Map<string, { fr?: string; en?: string }>()
  for (const f of mdFiles) {
    const isFr = /\.fr\.md$/i.test(f)
    const base = isFr ? f.replace(/\.fr\.md$/i, '') : f.replace(/\.md$/i, '')
    const entry = bases.get(base) || {}
    if (isFr) entry.fr = f; else entry.en = f
    bases.set(base, entry)
  }
  const out: string[] = []
  for (const [, entry] of bases) {
    const picked = lang === 'fr' ? (entry.fr ?? entry.en) : (entry.en ?? entry.fr)
    if (picked) out.push(picked)
  }
  return out
}

function metaString(meta: Record<string, FrontmatterValue>, key: string): string | undefined {
  const v = meta[key]
  return typeof v === 'string' && v !== '' ? v : undefined
}

export function readDocFile(fullPath: string): AppDocFile | null {
  let text: string
  try {
    text = fs.readFileSync(fullPath, 'utf-8')
  } catch {
    return null
  }
  const name = path.basename(fullPath)
  const file = name.replace(/(\.fr)?\.md$/i, '')
  const { meta, body } = parseFrontmatter(text)
  const orderRaw = metaString(meta, 'order')
  const order = orderRaw === undefined ? NaN : Number(orderRaw)
  return {
    file,
    lang: /\.fr\.md$/i.test(name) ? 'fr' : 'en',
    title: metaString(meta, 'title') ?? file,
    content: body,
    baseUrl: pathToFileURL(path.dirname(fullPath) + path.sep).href,
    order: Number.isFinite(order) ? order : undefined,
    docType: metaString(meta, 'doc_type'),
    audience: metaString(meta, 'audience'),
  }
}

// Pages d'un dossier dans la langue demandee, non triees (l'appelant trie
// apres avoir ajoute les pages des plugins).
export function readDocDir(dir: string, lang: 'fr' | 'en'): AppDocFile[] {
  if (!fs.existsSync(dir)) return []
  let names: string[]
  try {
    names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'))
  } catch {
    return []
  }
  const out: AppDocFile[] = []
  for (const f of selectDocsForLang(names, lang).sort()) {
    const doc = readDocFile(path.join(dir, f))
    if (doc) out.push(doc)
  }
  return out
}

// Tri par `order` du frontmatter ; une page sans `order` passe apres, sauf le
// README (point d'entree naturel de chaque app, comme avant le frontmatter).
// Array.sort est stable : l'ordre d'arrivee departage le reste.
export function sortDocFiles(files: AppDocFile[]): AppDocFile[] {
  const key = (f: AppDocFile): number =>
    f.order ?? (f.file.toLowerCase() === 'readme' ? -1 : Number.POSITIVE_INFINITY)
  return files.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return ka === kb ? 0 : ka < kb ? -1 : 1
  })
}
