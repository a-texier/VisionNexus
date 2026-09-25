import React from 'react'
import { useLang } from '../i18n/useLang'
import { setLangAndMaybePersist } from '../i18n/translate'
import { api } from '../App'

// Bascule FR/EN locale a l'app. Suit la langue imposee par VisionNexus au
// lancement (?lang=), mais reste modifiable ici independamment quand l'app
// tourne seule -- le changement est local a cette app, pas remonte au launcher.
// Hors pilotage desktop, le choix est aussi persiste dans les settings du
// workspace (repli pour retrouver la langue au prochain lancement standalone).
export const LanguageToggle: React.FC = () => {
  const [lang] = useLang()
  const next = lang === 'en' ? 'fr' : 'en'
  return (
    <button
      type="button"
      onClick={() =>
        setLangAndMaybePersist(next, (lang) => {
          void api('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ui_language: lang }),
          }).catch(() => {})
        })
      }
      title={lang === 'en' ? 'Passer en francais' : 'Switch to English'}
      className="secondary langToggle"
    >
      {lang === 'en' ? 'EN' : 'FR'}
    </button>
  )
}
