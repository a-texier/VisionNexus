import { useCallback, useSyncExternalStore } from 'react'
import { getLang, setLang, subscribeLang, t, type Lang } from './translate'

export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang)
  const change = useCallback((next: Lang) => setLang(next), [])
  return [lang, change]
}

export function useT(): typeof t {
  useSyncExternalStore(subscribeLang, getLang, getLang)
  return t
}
