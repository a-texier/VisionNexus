// ============================================================
// components/tour/useTourTarget.ts
// Resout un selecteur CSS en element DOM et suit sa position/taille.
// L'element peut ne pas encore exister (modal pas encore ouverte,
// page pas encore montee) : on observe le DOM jusqu'a son apparition,
// borne par waitTimeoutMs.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { computeSpotlightRect, type Rect } from './positioning'

interface UseTourTargetResult {
  rect: Rect | null
  found: boolean
  timedOut: boolean
}

const EMPTY: UseTourTargetResult = { rect: null, found: false, timedOut: false }

/**
 * True si l'element est entierement visible : dans la fenetre ET dans le cadre
 * de chacun de ses ancetres qui rognent.
 *
 * Ne tester que la fenetre ne suffit pas : un bouton sorti du cadre d'un panneau
 * scrollable garde un rectangle parfaitement plausible a l'ecran, alors qu'il est
 * invisible -- le spotlight se posait alors sur ce qui occupe vraiment cette
 * place (la zone de logs, la timeline...) au lieu de faire defiler le panneau.
 */
const isFullyVisible = (el: Element): boolean => {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return false
  const vw = window.innerWidth || document.documentElement.clientWidth
  const vh = window.innerHeight || document.documentElement.clientHeight
  if (r.top < 0 || r.left < 0 || r.bottom > vh || r.right > vw) return false
  let parent = el.parentElement
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const pr = parent.getBoundingClientRect()
      if (r.top < pr.top || r.bottom > pr.bottom || r.left < pr.left || r.right > pr.right) {
        return false
      }
    }
    parent = parent.parentElement
  }
  return true
}

export const useTourTarget = (
  selector: string | null,
  active: boolean,
  padding: number,
  waitTimeoutMs: number,
): UseTourTargetResult => {
  // Un seul etat : toutes les transitions passent par un callback (rAF,
  // observer, timer), jamais par le corps de l'effet.
  const [result, setResult] = useState<UseTourTargetResult>(EMPTY)
  const elRef = useRef<Element | null>(null)

  useEffect(() => {
    elRef.current = null
    if (!active || !selector) {
      // Purge differee : pas de setState synchrone dans le corps de l'effet.
      const clear = requestAnimationFrame(() => setResult(EMPTY))
      return () => cancelAnimationFrame(clear)
    }

    let cancelled = false
    let raf = 0

    const scheduleRecompute = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (cancelled) return
        // Noeud remplace par un re-rendu de l'app (meme selecteur, autre
        // element) : un noeud detache rend un rectangle 0x0, donc un spotlight
        // qui saute dans le coin haut-gauche. On re-resout le selecteur.
        if (elRef.current && !elRef.current.isConnected) {
          elRef.current = null
          tryResolve()
        }
        if (elRef.current) {
          const rect = computeSpotlightRect(elRef.current, padding)
          // Ne re-rend que si le rectangle a reellement bouge (la sonde tourne
          // en continu, l'immense majorite des passages ne change rien).
          setResult((prev) => (
            prev.found && prev.rect
            && prev.rect.top === rect.top && prev.rect.left === rect.left
            && prev.rect.width === rect.width && prev.rect.height === rect.height
              ? prev
              : { rect, found: true, timedOut: false }
          ))
        } else {
          setResult((prev) => (prev === EMPTY ? prev : EMPTY))
        }
      })
    }

    let resizeObserver: ResizeObserver | null = null
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let trackTimer: ReturnType<typeof setInterval> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined

    const mutationObserver = new MutationObserver(() => { tryResolve() })

    function tryResolve(): boolean {
      if (cancelled || elRef.current) return true
      const el = document.querySelector(selector as string)
      if (!el) return false
      elRef.current = el
      // La cible peut etre hors ecran (panneau scrollable, toolbar large) :
      // sans ca le spotlight pointerait un rectangle invisible. Mais on ne
      // defile QUE si elle depasse vraiment : scrollIntoView deplace tous les
      // ancetres scrollables, y compris ceux en overflow:hidden (scrollables par
      // script), ce qui faisait glisser la mise en page d'un cran -- la
      // surbrillance partait sur le cote puis revenait.
      if (!isFullyVisible(el)) {
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* jsdom */ }
      }
      resizeObserver?.disconnect()
      resizeObserver = new ResizeObserver(scheduleRecompute)
      resizeObserver.observe(el)
      // ResizeObserver ne voit QUE les changements de taille de l'element
      // observe. Or une cible se DEPLACE sans changer de taille des qu'un
      // bloc apparait au-dessus d'elle (un champ qui surgit dans une modale,
      // un bandeau, un panneau qui s'ouvre) : le spotlight restait alors a
      // cote. On resonde donc la position en continu -- un
      // getBoundingClientRect sur un seul element est negligeable.
      trackTimer = setInterval(scheduleRecompute, 120)
      scheduleRecompute()
      mutationObserver.disconnect()
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      return true
    }

    // Premiere tentative differee d'une frame : la purge de l'etat precedent
    // et la resolution de la nouvelle cible partagent le meme rendu.
    scheduleRecompute()
    if (!tryResolve()) {
      mutationObserver.observe(document.body, { childList: true, subtree: true })
      pollTimer = setInterval(tryResolve, 150)
      timeoutTimer = setTimeout(() => {
        if (!elRef.current && !cancelled) setResult({ rect: null, found: false, timedOut: true })
      }, waitTimeoutMs)
    }

    window.addEventListener('resize', scheduleRecompute)
    window.addEventListener('scroll', scheduleRecompute, true)

    return () => {
      cancelled = true
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      if (pollTimer) clearInterval(pollTimer)
      if (trackTimer) clearInterval(trackTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      window.removeEventListener('resize', scheduleRecompute)
      window.removeEventListener('scroll', scheduleRecompute, true)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [selector, active, padding, waitTimeoutMs])

  return result
}
