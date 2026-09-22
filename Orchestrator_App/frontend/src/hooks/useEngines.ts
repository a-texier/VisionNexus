import { useQuery } from '@tanstack/react-query'
import { enginesAPI } from '../api/client'
import type { EngineCatalog, EngineInfo, EnginesResponse } from '../types/api'

export interface Engines {
  // Moteurs utilisables (catalogue lu), dans l'ordre renvoye par Training_App.
  usable: EngineInfo[]
  // Moteurs listes mais indisponibles (bibliotheque absente...), avec la raison.
  unavailable: EngineInfo[]
  defaultEngine: string
  catalogOf: (engine: unknown) => EngineCatalog | undefined
  labelOf: (engine: unknown) => string
  // Nom normalise : valeur du noeud, sinon moteur par defaut.
  resolve: (engine: unknown) => string
}

export function useEngines(): Engines {
  const { data } = useQuery<EnginesResponse>({
    queryKey: ['engines'],
    queryFn: enginesAPI.list,
    staleTime: 60_000,
  })
  const all = data?.engines ?? []
  const usable = all.filter(e => e.available && e.catalog)
  const defaultEngine = data?.default ?? usable[0]?.name ?? ''
  const resolve = (engine: unknown) => (typeof engine === 'string' && engine) ? engine : defaultEngine
  const find = (engine: unknown) => all.find(e => e.name === resolve(engine))
  return {
    usable,
    unavailable: all.filter(e => !e.available),
    defaultEngine,
    catalogOf: engine => find(engine)?.catalog,
    labelOf: engine => find(engine)?.label ?? resolve(engine),
    resolve,
  }
}

// Libelle court d'une taille ("yolox-s" -> "s" si le moteur declare ce prefixe).
export function shortSize(catalog: EngineCatalog | undefined, size: string): string {
  const prefix = catalog?.size_prefix ?? ''
  return prefix && size.startsWith(prefix) ? size.slice(prefix.length) : size
}
