// ============================================================
// components/docs/MarkdownDoc.tsx
// Affiche un corps markdown de docs/ (sans frontmatter) avec les ancres
// h-<n>. Les liens entre pages et vers des ancres sont interceptes pour
// rester dans la page Guide (onNavigate) au lieu de recharger l'app.
// ============================================================

import React, { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from './markdown'
import './markdownDoc.css'

export interface DocHeading {
  id: string
  depth: number
  text: string
}

interface MarkdownDocProps {
  body: string
  /** name absent : ancre dans la page courante. anchor vide : haut de page. */
  onNavigate: (target: { name?: string; anchor: string }) => void
  /** Titres H2/H3 rendus, pour une table des matieres. */
  onHeadings?: (headings: DocHeading[]) => void
  className?: string
}

export const MarkdownDoc: React.FC<MarkdownDocProps> = ({ body, onNavigate, onHeadings, className }) => {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(body), [body])

  // Lu dans le DOM : le texte affiche, entites et markup inline deja resolus.
  useEffect(() => {
    if (!onHeadings || !ref.current) return
    const nodes = ref.current.querySelectorAll<HTMLElement>('h2[id^="h-"], h3[id^="h-"]')
    onHeadings(Array.from(nodes, (node) => ({
      id: node.id,
      depth: node.tagName === 'H2' ? 2 : 3,
      text: node.textContent ?? '',
    })))
  }, [html, onHeadings])

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest('a')
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey) return
    const { doc, anchor } = link.dataset
    if (doc === undefined && anchor === undefined) return
    event.preventDefault()
    onNavigate({ name: doc, anchor: anchor ?? '' })
  }

  return (
    <div
      ref={ref}
      className={`markdown-doc ${className ?? ''}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
