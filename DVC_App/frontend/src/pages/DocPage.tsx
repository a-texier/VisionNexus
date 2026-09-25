// ============================================================
// pages/DocPage.tsx
// Page Doc : rend les pages markdown de DVC_App/docs/ servies
// par /api/docs. Le contenu n'existe qu'a un seul endroit (les .md) ;
// cette page ne fait que naviguer et afficher.
//
// Etat dans l'URL pour les liens profonds : /doc?doc=workflows#h-4
// (voir docLink() dans components/docs/markdown.ts).
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { BookOpen, Loader2 } from 'lucide-react'
import { docsAPI, type DocPage, type DocPageInfo } from '../api/client'
import { MarkdownDoc, type DocHeading } from '../components/docs/MarkdownDoc'
import { useLang, useT } from '../i18n/useLang'

const DEFAULT_DOC = 'README'

type GroupId = 'user' | 'setup' | 'dev'

const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'user', label: 'Utilisateur' },
  { id: 'setup', label: 'Installation et réglages' },
  { id: 'dev', label: 'Développeur' },
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

type DocState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; page: DocPage }

export default function DocPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const t = useT()
  const [lang] = useLang()
  // La page defile dans le <main> de App, pas dans la fenetre.
  const topRef = useRef<HTMLDivElement>(null)

  const docName = searchParams.get('doc') || DEFAULT_DOC
  const anchor = location.hash.replace(/^#/, '')

  // Chaque resultat garde la cle qui l'a produit : une cle differente de la
  // cle courante signifie "en cours de chargement" sans remise a zero
  // synchrone dans l'effet.
  const docKey = `${docName}|${lang}`
  const [pagesResult, setPagesResult] = useState<{ lang: string; pages: DocPageInfo[] | null }>()
  const [docResult, setDocResult] = useState<{ key: string; state: DocState }>()
  const [headingsResult, setHeadingsResult] = useState<{ key: string; headings: DocHeading[] }>()

  const pagesFailed = pagesResult?.lang === lang && pagesResult.pages === null
  const pages = pagesResult?.lang === lang ? pagesResult.pages : null
  const doc: DocState = docResult?.key === docKey ? docResult.state : { status: 'loading' }
  const headings = headingsResult?.key === docKey ? headingsResult.headings : []

  const scrollToAnchor = useCallback((target: string) => {
    const el = target ? document.getElementById(target) : topRef.current
    el?.scrollIntoView({ block: 'start' })
  }, [])

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
  }, [docReady, anchor, scrollToAnchor])

  const goTo = useCallback((target: { name?: string; anchor: string }) => {
    const name = target.name ?? docName
    if (name === docName && target.anchor === anchor) {
      scrollToAnchor(anchor)
      return
    }
    const params = new URLSearchParams(searchParams)
    params.set('doc', name)
    navigate({ search: `?${params.toString()}`, hash: target.anchor ? `#${target.anchor}` : '' })
  }, [anchor, docName, navigate, scrollToAnchor, searchParams])

  const grouped = useMemo(() => GROUPS.map((group) => ({
    ...group,
    pages: (pages ?? []).filter((page) => groupOf(page) === group.id),
  })).filter((group) => group.pages.length > 0), [pages])

  return (
    <div ref={topRef} className="p-6">
      <div className="flex items-center gap-2 mb-5 text-white">
        <BookOpen size={20} className="text-indigo-400" />
        <h1 className="text-xl font-semibold">{t('Documentation')}</h1>
      </div>

      <div className="flex gap-8 max-w-7xl">
        <aside className="w-60 flex-shrink-0 self-start sticky top-0 max-h-[calc(100vh-48px)] overflow-y-auto pr-2 text-sm">
          {pagesFailed && <p className="text-xs text-red-400">{t('Liste des pages indisponible')}</p>}
          {!pagesFailed && pages === null && (
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 size={12} className="animate-spin" /> {t('Chargement…')}
            </p>
          )}
          {pages !== null && pages.length === 0 && (
            <p className="text-xs text-gray-500">{t('Aucune page de documentation.')}</p>
          )}
          {grouped.map((group) => (
            <div key={group.id} className="mb-5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">
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
                          ? 'bg-indigo-500/15 text-indigo-300 font-semibold'
                          : page.langs.length === 0
                            ? 'text-gray-600 hover:text-gray-400'
                            : 'text-gray-300 hover:bg-gray-800/60 hover:text-white'
                      }`}
                    >
                      {page.title}
                    </button>
                    {active && headings.length > 0 && (
                      <ul className="mt-1 mb-2 ml-2.5 border-l border-gray-800">
                        {headings.map((heading) => (
                          <li key={heading.id}>
                            <button
                              onClick={() => goTo({ anchor: heading.id })}
                              className={`w-full text-left py-0.5 pr-1 text-xs leading-snug transition-colors ${
                                heading.depth === 3 ? 'pl-6' : 'pl-3'
                              } ${heading.id === anchor ? 'text-indigo-300' : 'text-gray-400 hover:text-gray-200'}`}
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
            <div className="flex items-center gap-2 text-sm text-gray-400 py-12">
              <Loader2 size={16} className="animate-spin" /> {t('Chargement de la documentation…')}
            </div>
          )}
          {(doc.status === 'missing' || doc.status === 'error') && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 my-6">
              <h2 className="text-lg font-semibold text-white mb-2">{t('Documentation non disponible')}</h2>
              <p className="text-sm text-gray-400">
                {doc.status === 'missing'
                  ? t("Cette page n'est pas encore écrite dans le dossier docs/ de l'application.")
                  : t("Le backend ne répond pas. Vérifiez qu'il est démarré puis rechargez la page.")}
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
