import React from 'react'
import { useLang } from '../../i18n/useLang'
import { setLangAndMaybePersist } from '../../i18n/translate'
import { settingsAPI } from '../../api/client'

/**
 * Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
 * lancement (?lang=), mais reste modifiable ici independamment quand l'app
 * tourne seule -- le changement est local a cette app, pas remonte au launcher.
 * Hors pilotage desktop, le choix est aussi persiste dans les settings du
 * workspace (repli, VisionNexus reste la source de verite quand present).
 */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [lang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() =>
        setLangAndMaybePersist(next, l => {
          void settingsAPI.update({ ui_language: l }).catch(() => {})
        })
      }
      title={lang === 'en' ? 'Passer en francais' : 'Switch to English'}
      className={
        'p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0 ' +
        'text-[10px] font-bold leading-none text-gray-500 hover:text-white ' +
        (className ?? '')
      }
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
