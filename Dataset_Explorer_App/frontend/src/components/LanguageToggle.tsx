import React from 'react'
import { useLang } from '../i18n/useLang'
import { setLangAndMaybePersist } from '../i18n/translate'
import { settingsAPI } from '../api/client'

/**
 * Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
 * lancement (?lang=), mais reste modifiable ici independamment quand l'app
 * tourne seule -- le changement est local a cette app, pas remonte au launcher.
 * Hors pilotage desktop, le choix est aussi persiste dans les settings du
 * workspace (repli pour retrouver la langue au prochain lancement standalone).
 */
export const LanguageToggle: React.FC<{ className?: string }> = ({ className }) => {
  const [lang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() =>
        setLangAndMaybePersist(next, (lang) => {
          // PUT /api/settings exige l'objet complet : on relit les reglages puis on change la langue.
          void settingsAPI
            .get()
            .then((current) => settingsAPI.update({ ...current, ui_language: lang }))
            .catch(() => {})
        })
      }
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
