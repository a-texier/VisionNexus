// ============================================================
// desktop/ui/ask-render.js
// Fonctions pures de l'onglet "Demander a la doc" (docs.html), partagees avec
// src/askRender.test.ts (require). Aucun acces au DOM ici : le surlignage rend
// des segments {text, mark}, et c'est le code appelant qui les insere avec
// textContent -- jamais de HTML construit a partir d'un extrait du service.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.cvAskRender = factory()
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const COMBINING = /[\u0300-\u036f]/

  // Texte sans accents ni majuscules, avec pour chaque caractere obtenu l'index
  // du caractere d'origine : les positions trouvees dans la version pliee se
  // reportent ainsi sur le texte affiche.
  function fold(text) {
    let norm = ''
    const map = []
    for (let i = 0; i < text.length; i++) {
      const out = text[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      for (let j = 0; j < out.length; j++) {
        norm += out[j]
        map.push(i)
      }
    }
    return { norm, map }
  }

  // Decoupe `text` en segments consecutifs {text, mark} ; mark = true sur les
  // occurrences des `terms`, sans tenir compte des accents ni de la casse.
  function highlightSegments(text, terms) {
    const source = String(text)
    const { norm, map } = fold(source)
    const ranges = []
    for (const term of terms || []) {
      const needle = fold(String(term)).norm.trim()
      if (needle.length < 2) continue
      for (let from = 0, at; (at = norm.indexOf(needle, from)) !== -1; from = at + needle.length) {
        ranges.push([map[at], map[at + needle.length - 1] + 1])
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const merged = []
    for (const [start, end] of ranges) {
      const last = merged[merged.length - 1]
      if (last && start <= last[1]) last[1] = Math.max(last[1], end)
      else merged.push([start, end])
    }
    const segments = []
    let cursor = 0
    for (const range of merged) {
      let end = range[1]
      // Un accent decompose (e + U+0301) fait partie du mot surligne.
      while (end < source.length && COMBINING.test(source[end])) end++
      if (range[0] > cursor) segments.push({ text: source.slice(cursor, range[0]), mark: false })
      segments.push({ text: source.slice(range[0], end), mark: true })
      cursor = end
    }
    if (cursor < source.length) segments.push({ text: source.slice(cursor), mark: false })
    return segments
  }

  return { highlightSegments }
}))
