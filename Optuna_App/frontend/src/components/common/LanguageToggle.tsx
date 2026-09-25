import React from 'react'
import { useLang } from '../../i18n/useLang'
import { setLangAndMaybePersist } from '../../i18n/translate'
import { settingsAPI } from '../../api/client'

/**
 * Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
 * lancement (?lang=), mais reste modifiable ici independamment quand l'app
 * tourne seule -- le changement est local a cette app, pas remonte au launcher.
 */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [lang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() => setLangAndMaybePersist(next, (lang) => {
        void settingsAPI.update({ ui_language: lang } as any).catch(() => {})
      })}
      title={lang === 'en' ? 'Passer en francais' : 'Switch to English'}
      className={
        'flex items-center justify-center p-1 rounded hover:bg-gray-700 transition-colors ' +
        'flex-shrink-0 text-gray-500 hover:text-white text-[10px] font-bold leading-none w-[21px] h-[21px] ' +
        (className ?? '')
      }
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
