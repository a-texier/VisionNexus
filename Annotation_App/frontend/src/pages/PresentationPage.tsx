// ============================================================
// pages/PresentationPage.tsx
// Aide integree : rend les pages markdown de Annotation_App/docs/ servies
// par /api/docs. Le contenu n'existe qu'a un seul endroit (les .md) ;
// cette page ne fait que naviguer et afficher.
//
// Etat dans l'URL pour les liens profonds : /presentation?doc=workflows#h-4
// (voir docLink() dans components/docs/markdown.ts).
// ============================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react'
import { docsAPI, type DocPage, type DocPageInfo } from '../services/api'
import { MarkdownDoc, type DocHeading } from '../components/docs/MarkdownDoc'
import { useLang, useT } from '../i18n/useLang'

const DEFAULT_DOC = 'README'

type GroupId = 'user' | 'setup' | 'dev'

const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'user', label: 'Utilisateur' },
  { id: 'setup', label: 'Installation et reglages' },
  { id: 'dev', label: 'Developpeur' },
]

const GROUP_BY_NAME: Record<string, GroupId> = {
  README: 'user',
  'user-guide': 'user',
  workflows: 'user',
  concepts: 'user',
  configuration: 'setup',
  troubleshooting: 'setup',
  architecture: 'dev',
  'api-reference': 'dev',
  'code-map': 'dev',
}

// Pages ajoutees plus tard au manifeste : rangees selon leur audience.
function groupOf(page: DocPageInfo): GroupId {
  return GROUP_BY_NAME[page.name] ?? (page.audience === 'user' ? 'user' : page.audience === 'dev' ? 'dev' : 'setup')
}

// body est en overflow:hidden (index.css, requis par le canvas d'annotation) :
// la fenetre ne defile jamais, c'est la racine de la page qui defile.
const SCROLL_ROOT_ID = 'presentation-scroll-root'

function scrollToAnchor(anchor: string) {
  if (!anchor) {
    document.getElementById(SCROLL_ROOT_ID)?.scrollTo({ top: 0 })
    return
  }
  document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
}

type DocState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; page: DocPage }

export const PresentationPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const t = useT()
  const [lang] = useLang()

  const docName = searchParams.get('doc') || DEFAULT_DOC
  const anchor = location.hash.replace(/^#/, '')

  // Chaque resultat garde la cle qui l'a produit : une cle differente de
  // la cle courante signifie "en cours de chargement" (changement de page
  // ou de langue) sans remise a zero synchrone dans l'effet.
  const docKey = `${docName}|${lang}`
  const [pagesResult, setPagesResult] = useState<{ lang: string; pages: DocPageInfo[] | null }>()
  const [docResult, setDocResult] = useState<{ key: string; state: DocState }>()
  const [headingsResult, setHeadingsResult] = useState<{ key: string; headings: DocHeading[] }>()

  const pagesFailed = pagesResult?.lang === lang && pagesResult.pages === null
  const pages = pagesResult?.lang === lang ? pagesResult.pages : null
  const doc: DocState = docResult?.key === docKey ? docResult.state : { status: 'loading' }
  const headings = headingsResult?.key === docKey ? headingsResult.headings : []

  useEffect(() => {
    let cancelled = false
    docsAPI.list(lang)
      .then((list) => { if (!cancelled) setPagesResult({ lang, pages: list }) })
      .catch(() => { if (!cancelled) setPagesResult({ lang, pages: null }) })
    return () => { cancelled = true }
  }, [lang])

  useEffect(() => {
    let cancelled = false
    docsAPI.get(docName, lang)
      .then((page) => { if (!cancelled) setDocResult({ key: docKey, state: { status: 'ready', page } }) })
      .catch((err: unknown) => {
        if (cancelled) return
        const notFound = axios.isAxiosError(err) && err.response?.status === 404
        setDocResult({ key: docKey, state: { status: notFound ? 'missing' : 'error' } })
      })
    return () => { cancelled = true }
  }, [docKey, docName, lang])

  const handleHeadings = useCallback(
    (list: DocHeading[]) => setHeadingsResult({ key: docKey, headings: list }),
    [docKey],
  )

  // Apres rendu du markdown (le DOM enfant est deja en place ici).
  const docReady = doc.status === 'ready' ? doc.page : null
  useEffect(() => {
    if (docReady) scrollToAnchor(anchor)
  }, [docReady, anchor])

  const goTo = useCallback((target: { name?: string; anchor: string }) => {
    const name = target.name ?? docName
    if (name === docName && target.anchor === anchor) {
      scrollToAnchor(anchor)
      return
    }
    const params = new URLSearchParams(searchParams)
    params.set('doc', name)
    navigate({ search: `?${params.toString()}`, hash: target.anchor ? `#${target.anchor}` : '' })
  }, [anchor, docName, navigate, searchParams])

  const grouped = useMemo(() => GROUPS.map((group) => ({
    ...group,
    pages: (pages ?? []).filter((page) => groupOf(page) === group.id),
  })).filter((group) => group.pages.length > 0), [pages])

  return (
    <div id={SCROLL_ROOT_ID} className="h-screen overflow-y-auto bg-slate-950 text-slate-100">
      <nav className="sticky top-0 z-50 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          data-tour="presentation-back"
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm flex-shrink-0"
        >
          <ArrowLeft size={16} />
          {t('Retour aux projets')}
        </button>
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <BookOpen size={16} className="text-blue-400" />
          {t('Documentation intégrée')}
        </div>
      </nav>

      <div className="flex gap-8 px-6 py-6 max-w-7xl mx-auto">
        <aside
          data-tour="presentation-tabs"
          className="w-64 flex-shrink-0 self-start sticky top-[68px] max-h-[calc(100vh-84px)] overflow-y-auto pr-2 text-sm"
        >
          {pagesFailed && (
            <p className="text-xs text-red-400">{t('Liste des pages indisponible')}</p>
          )}
          {!pagesFailed && pages === null && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin" /> {t('Chargement...')}
            </p>
          )}
          {pages !== null && pages.length === 0 && (
            <p className="text-xs text-slate-500">{t('Aucune page de documentation.')}</p>
          )}
          {grouped.map((group) => (
            <div key={group.id} className="mb-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                {t(group.label)}
              </div>
              {group.pages.map((page) => {
                const active = page.name === docName
                return (
                  <div key={page.name}>
                    <button
                      onClick={() => goTo({ name: page.name, anchor: '' })}
                      className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors ${
                        active
                          ? 'bg-blue-500/15 text-blue-300 font-semibold'
                          : page.langs.length === 0
                            ? 'text-slate-600 hover:text-slate-400'
                            : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                      }`}
                    >
                      {page.title}
                    </button>
                    {active && headings.length > 0 && (
                      <ul className="mt-1 mb-2 ml-2.5 border-l border-slate-800">
                        {headings.map((heading) => (
                          <li key={heading.id}>
                            <button
                              onClick={() => goTo({ anchor: heading.id })}
                              className={`w-full text-left py-0.5 pr-1 text-xs leading-snug transition-colors ${
                                heading.depth === 3 ? 'pl-6' : 'pl-3'
                              } ${heading.id === anchor ? 'text-blue-300' : 'text-slate-400 hover:text-slate-200'}`}
                            >
                              {heading.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </aside>

        <main className="flex-1 min-w-0 max-w-4xl">
          {doc.status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-12">
              <Loader2 size={16} className="animate-spin" /> {t('Chargement de la documentation...')}
            </div>
          )}
          {(doc.status === 'missing' || doc.status === 'error') && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 my-6">
              <h2 className="text-lg font-semibold text-white mb-2">{t('Documentation non disponible')}</h2>
              <p className="text-sm text-slate-400">
                {doc.status === 'missing'
                  ? t("Cette page n'est pas encore ecrite dans le dossier docs/ de l'application.")
                  : t('Le backend ne repond pas. Verifiez qu\'il est demarre puis rechargez la page.')}
              </p>
            </div>
          )}
          {doc.status === 'ready' && (
            <>
              {doc.page.lang !== lang && (
                <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {t("Cette page n'est pas encore traduite : version dans l'autre langue.")}
                </p>
              )}
              <MarkdownDoc body={doc.page.body} onNavigate={goTo} onHeadings={handleHeadings} />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
