import React from 'react'
import { useLang } from '../../i18n/useLang'
import { setLangAndMaybePersist } from '../../i18n/translate'
import { settingsAPI } from '../../services/api'

/**
 * Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
 * lancement (?lang=), mais reste modifiable ici independamment quand l'app
 * tourne seule. Hors mode pilote par VisionNexus, le choix est aussi
 * persiste dans les settings du workspace (repli pour le prochain lancement
 * standalone) -- cf. i18n/translate.ts.
 */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [lang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() => setLangAndMaybePersist(next, (l) => {
        void settingsAPI.update({ ui_language: l } as any).catch(() => {})
      })}
      title={lang === 'en' ? 'Passer en francais' : 'Switch to English'}
      className={
        'p-1 rounded hover:bg-gray-700 transition-colors flex-shrink-0 ' +
        'text-[10px] font-semibold leading-none text-gray-500 hover:text-white ' +
        (className ?? '')
      }
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
