// ============================================================
// components/tour/domUtils.ts
// Outils DOM pour ecrire des etapes qui pilotent reellement l'UI
// (ouvrir une modal, remplir un champ, cliquer un bouton) sans avoir
// a refactorer les composants cibles pour exposer leur etat au tour.
// Generique et portable : aucune connaissance de l'app hote.
// ============================================================

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Attend qu'un predicat devienne vrai. Renvoie False si le delai expire. */
export const waitFor = (
  predicate: () => boolean,
  timeoutMs = 5000,
  intervalMs = 80,
): Promise<boolean> =>
  new Promise((resolve) => {
    if (predicate()) { resolve(true); return }
    const started = Date.now()
    const timer = setInterval(() => {
      let ok = false
      try { ok = predicate() } catch { ok = false }
      if (ok) { clearInterval(timer); resolve(true) }
      else if (Date.now() - started >= timeoutMs) { clearInterval(timer); resolve(false) }
    }, intervalMs)
  })

/** Attend l'apparition d'un element. Renvoie null si le delai expire. */
export const waitForElement = async <T extends HTMLElement = HTMLElement>(
  selector: string,
  timeoutMs = 5000,
): Promise<T | null> => {
  await waitFor(() => document.querySelector(selector) !== null, timeoutMs)
  return document.querySelector<T>(selector)
}

/** Clique un element des son apparition. Renvoie False si le delai expire. */
export const clickWhenReady = async (selector: string, timeoutMs = 5000): Promise<boolean> => {
  const el = await waitForElement(selector, timeoutMs)
  if (!el) return false
  el.click()
  return true
}

/**
 * Ecrit dans un input/textarea CONTROLE par React.
 * Affecter `el.value` ne suffit pas : React memorise la derniere valeur sur le
 * noeud et ignorerait l'evenement. On passe donc par le setter natif du
 * prototype avant de dispatcher un event input qui remonte au onChange React.
 */
export const setReactInputValue = (
  el: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
): boolean => {
  if (!el) return false
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

/** Ecrit dans un input controle des son apparition. */
export const typeWhenReady = async (
  selector: string,
  value: string,
  timeoutMs = 5000,
): Promise<boolean> => {
  const el = await waitForElement<HTMLInputElement>(selector, timeoutMs)
  if (!el) return false
  el.focus()
  return setReactInputValue(el, value)
}

/** True si l'element est desactive (attribut disabled ou aria-disabled). */
export const isDisabled = (el: Element | null): boolean => {
  if (!el) return true
  if ((el as HTMLButtonElement).disabled) return true
  return el.getAttribute('aria-disabled') === 'true'
}

/**
 * Clique un element SEULEMENT s'il est actif. Cliquer un bouton desactive ne
 * declenche rien : le tour avancait alors sur une action qui n'avait pas eu
 * lieu (propagation jamais lancee). Renvoie False si l'element manque ou
 * reste desactive jusqu'au delai.
 */
export const clickEnabledWhenReady = async (
  selector: string,
  timeoutMs = 5000,
): Promise<boolean> => {
  const ok = await waitFor(() => {
    const el = document.querySelector(selector)
    return el !== null && !isDisabled(el)
  }, timeoutMs)
  if (!ok) return false
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return false
  el.click()
  return true
}
