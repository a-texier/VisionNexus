// ============================================================
// components/docs/markdown.ts
// Rendu markdown -> HTML des pages de docs/ et liens vers la page d'aide.
//
// Ancres : chaque titre recoit l'id h-<n>, n comptant tous les titres ATX
// dans l'ordre (regle de tools/docs/DOC_STYLE.md, partagee avec le viewer
// desktop et le Docs Assistant). Le lexer de marked ignore deja les blocs
// de code, donc compter dans le renderer suffit.
// ============================================================

import { Marked, type Tokens } from 'marked'
import { docsAPI } from '../../api/client'

/** URL de la page d'aide sur une page de doc, et optionnellement un titre. */
export function docLink(name: string, headingIdx?: number): string {
  const hash = headingIdx === undefined ? '' : `#h-${headingIdx}`
  return `/help?doc=${encodeURIComponent(name)}${hash}`
}

// `workflows.md`, `./workflows.fr.md#h-3` : lien vers une autre page du jeu.
const DOC_HREF = /^(?:\.\/)?([A-Za-z0-9_-]+?)(?:\.fr)?\.md(#[\w-]*)?$/
const ASSET_HREF = /^(?:\.\/)?assets\/(.+)$/
const EXTERNAL_HREF = /^(?:https?:|mailto:)/i

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function resolveAsset(href: string): string {
  const match = ASSET_HREF.exec(href)
  return match ? docsAPI.getAssetUrl(match[1]) : href
}

export function renderMarkdown(body: string): string {
  let headingIdx = 0
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const id = `h-${headingIdx++}`
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`
      },
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens)
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
        if (EXTERNAL_HREF.test(href)) {
          return `<a href="${escapeAttr(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
        }
        if (href.startsWith('#')) {
          return `<a href="${escapeAttr(href)}" data-anchor="${escapeAttr(href.slice(1))}"${titleAttr}>${text}</a>`
        }
        const doc = DOC_HREF.exec(href)
        if (doc) {
          const anchor = doc[2] ? doc[2].slice(1) : ''
          const url = `${docLink(doc[1])}${doc[2] ?? ''}`
          return `<a href="${escapeAttr(url)}" data-doc="${escapeAttr(doc[1])}" data-anchor="${escapeAttr(anchor)}"${titleAttr}>${text}</a>`
        }
        if (ASSET_HREF.test(href)) {
          return `<a href="${escapeAttr(resolveAsset(href))}" target="_blank" rel="noopener noreferrer">${text}</a>`
        }
        // Chemins de code source (code-map) : rien a ouvrir dans l'app.
        return `<span class="md-path" title="${escapeAttr(href)}">${text}</span>`
      },
      image({ href, title, text }: Tokens.Image) {
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
        return `<img src="${escapeAttr(resolveAsset(href))}" alt="${escapeAttr(text)}"${titleAttr} loading="lazy">`
      },
    },
  })
  return marked.parse(body, { async: false })
}
