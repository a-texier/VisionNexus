import React from 'react'
import { useLang } from '../../i18n/useLang'
import { setLangAndMaybePersist } from '../../i18n/translate'
import { settingsAPI } from '../../api/client'

/**
 * Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
 * lancement (?lang=), mais reste modifiable ici independamment quand l'app
 * tourne seule -- le changement est local a cette app, pas remonte au launcher.
 * Hors pilotage desktop, le choix est aussi persiste dans le workspace
 * (repli, voir backend/api/settings.py::ui_language).
 */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [lang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() =>
        setLangAndMaybePersist(next, (lang) => {
          void settingsAPI.update({ ui_language: lang } as any).catch(() => {})
        })
      }
      title={lang === 'en' ? 'Passer en francais' : 'Switch to English'}
      className={
        'flex items-center justify-center text-gray-500 hover:text-white text-[10px] font-bold leading-none ' +
        'p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0 ' +
        (className ?? '')
      }
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
