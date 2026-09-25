// ============================================================
// desktop/ui/doc-render.js
// Rendu markdown -> HTML de la doc par app, partage entre docs.html (script
// classique, global cvDocRender) et scripts/check-heading-ids.js (require).
//
// Ancres : chaque titre recoit id="h-<n>", n comptant tous les titres du
// fichier a partir de 0 (regle de tools/docs/DOC_STYLE.md, partagee avec
// tools/docs/docs_lib.py et le chunker du Docs Assistant). Le lexer de marked
// ignore deja les blocs de code, comme la regle.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.cvDocRender = factory()
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function headingId(n) {
    return 'h-' + n
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  // Lien vers une autre page de la meme app ("user-guide.md#h-3",
  // "./concepts.fr.md", "#h-2") : { file, anchor }, file vide = page courante.
  // Le suffixe .fr est ignore, la fenetre affiche la langue choisie.
  // Lien vers une autre app ("../Orchestrator_App/docs/code-map.md#h-4") : `dir`
  // est le dossier de l'app, que le viewer resout en id d'app.
  function parseDocLink(href) {
    const cross = /^(?:\.\.\/)+([\w.-]+)\/docs\/([\w.-]+?)(?:\.fr)?\.md(?:#(.*))?$/i.exec(href)
    if (cross) return { dir: cross[1], file: cross[2], anchor: cross[3] || '' }
    const m = /^(?:\.\/)?([\w.-]+?)(?:\.fr)?\.md(?:#(.*))?$/i.exec(href) || /^()#(.+)$/.exec(href)
    return m ? { dir: '', file: m[1], anchor: m[2] || '' } : null
  }

  // `marked` : le module (require) ou le global du build UMD. `baseUrl` :
  // dossier du fichier (file://...), pour les images relatives a docs/.
  function renderDoc(marked, md, baseUrl) {
    let headingCount = 0
    const instance = new marked.Marked({ gfm: true })
    instance.use({
      renderer: {
        heading({ tokens, depth }) {
          const id = headingId(headingCount++)
          return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`
        },
        link({ href, title, tokens }) {
          const text = this.parser.parseInline(tokens)
          const t = title ? ` title="${escapeAttr(title)}"` : ''
          if (/^(https?:|mailto:)/i.test(href)) {
            // target=_blank : le setWindowOpenHandler de main.ts l'ouvre dans
            // le navigateur au lieu de naviguer dans cette fenetre.
            return `<a href="${escapeAttr(href)}"${t} target="_blank" rel="noopener">${text}</a>`
          }
          const doc = parseDocLink(href)
          if (doc) {
            const dirAttr = doc.dir ? ` data-doc-dir="${escapeAttr(doc.dir)}"` : ''
            return `<a href="#"${dirAttr} data-doc-file="${escapeAttr(doc.file)}" data-doc-anchor="${escapeAttr(doc.anchor)}"${t}>${text}</a>`
          }
          // Autre lien relatif : ne pointe vers rien depuis desktop/ui/ (ouvrait
          // une fenetre blanche), on garde le texte seul.
          return text
        },
        image({ href, title, text }) {
          let src = null
          if (/^(https?:|data:)/i.test(href)) src = href
          else if (baseUrl) {
            try {
              src = new URL(href, baseUrl).href
            } catch {
              src = null
            }
          }
          // Sans dossier de base connu, le texte alternatif plutot qu'une image cassee.
          if (!src) return `<em class="imgAlt">[${escapeAttr(text)}]</em>`
          const t = title ? ` title="${escapeAttr(title)}"` : ''
          return `<img src="${escapeAttr(src)}" alt="${escapeAttr(text)}"${t}>`
        },
      },
    })
    return instance.parse(md)
  }

  return { headingId, parseDocLink, renderDoc }
}))
