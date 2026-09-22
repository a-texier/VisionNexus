import React from 'react'
import { useLang } from '../../i18n/useLang'

/**
 * Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
 * lancement (?lang=), mais reste modifiable ici independamment quand l'app
 * tourne seule -- le changement est local a cette app, pas remonte au launcher.
 */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [lang, setLang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={lang === 'en' ? 'Passer en francais' : 'Switch to English'}
      className={
        'flex items-center justify-center gap-1 p-2 rounded border border-gray-700 ' +
        'text-xs font-semibold text-gray-400 hover:text-white transition-colors ' +
        (className ?? '')
      }
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
