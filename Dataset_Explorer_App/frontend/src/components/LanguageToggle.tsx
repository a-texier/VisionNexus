import React from 'react'
import { useLang } from '../i18n/useLang'

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
        'p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0 ' +
        'text-[10px] font-bold text-gray-500 hover:text-white ' +
        (className ?? '')
      }
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
