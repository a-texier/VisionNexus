import { useCallback, useSyncExternalStore } from 'react'
import { getLang, setLang, subscribeLang, t, type Lang } from './translate'

/** Langue courante + setter, reactif aux changements (bouton, autre onglet). */
export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang)
  const change = useCallback((next: Lang) => setLang(next), [])
  return [lang, change]
}

/** t() lie au re-render : le composant se met a jour quand la langue change. */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLang, getLang, getLang)
  return t
}
