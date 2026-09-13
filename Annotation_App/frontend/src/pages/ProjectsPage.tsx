// ============================================================
// pages/ProjectsPage.tsx
// Page d'accueil : liste des projets, création, suppression.
// ============================================================

import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Folder, Film, Image, Trash2, BarChart2, BookOpen, Settings, FolderOpen, Copy, ExternalLink, Wand2, Activity } from 'lucide-react'
import { useProjectStore } from '../stores/projectStore'
import { projectsAPI, settingsAPI } from '../services/api'
import { readTutorialState, writeTutorialState, type TutorialState } from '../utils/tutorialState'
import axios from 'axios'
import { CreateProjectModal } from '../components/modals/CreateProjectModal'
import { SettingsModal } from '../components/modals/SettingsModal'
import { ConfirmDialog } from '../components/common/ConfirmDialog'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { UserBadge } from '../components/UserBadge'
import { TourLaunchButton, useTour } from '../components/tour'
import {
  buildAnnotationTourSteps, TUTORIAL_KEY, type AnnotationTourContext,
} from '../components/help/annotationTourSteps'
import type { Project } from '../types/api'

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate()
  const { projects, fetchProjects, deleteProject, isLoading } = useProjectStore()
  const { start: startTour } = useTour()
  // Halo orange tant que le tutoriel n'a jamais ete lance par cet utilisateur.
  // L'etat vient des reglages de VisionNexus (profil Windows), avec repli sur
  // les reglages du workspace hors lanceur -- cf. utils/tutorialState.ts.
  const [tourState, setTourState] = useState<TutorialState | null>(null)
  useEffect(() => { void readTutorialState(TUTORIAL_KEY).then(setTourState) }, [])
  const tourNeverLaunched = tourState ? !tourState.launchedOnce : false
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  // Projets dont le détail des séquences est déplié
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set())

  const toggleExpanded = (projectId: number) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const seqIcon = (t: string) => (t === 'video' ? '🎬' : t === 'images' ? '🖼' : '📦')

  useEffect(() => {
    void axios.get<{ path: string }>('/api/workspace/info').then((r) => setWorkspacePath(r.data.path))
  }, [])

  // ---- Menu Workspace ----
  // En SSH, "révéler" ouvre l'explorateur SUR LA VM (inutile côté Windows).
  // Le menu propose donc aussi de copier le chemin, avec traduction optionnelle
  // vers le montage réseau Windows (ex : /home/user/wk -> \\<share-host>\user\wk).
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const workspaceMenuRef = useRef<HTMLDivElement>(null)
  // Source unique du montage réseau : l'hôte est stocké dans les paramètres
  // (paths.native_share_host) — le MÊME que le backend utilise pour « Ouvrir sur le
  // serveur ». Plus de réglage séparé côté Settings. Seul l'hôte est configurable :
  // /home/X/... devient \\{hôte}\X\... (1er segment retiré, / → \).
  const [nativeShareHost, setNativeShareHost] = useState('')
  useEffect(() => {
    void settingsAPI.get()
      .then((s) => setNativeShareHost(s.paths?.native_share_host || ''))
      .catch(() => { /* Le transport HTTP reste disponible. */ })
  }, [])

  useEffect(() => {
    if (!showWorkspaceMenu) return
    const close = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setShowWorkspaceMenu(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [showWorkspaceMenu])

  const handleRevealWorkspace = () => {
    void axios.post('/api/workspace/reveal')
    setShowWorkspaceMenu(false)
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copié : ${text}`)
    } catch {
      // Fallback : clipboard indisponible (contexte non sécurisé http)
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      toast.success(`${label} copié : ${text}`)
    }
    setShowWorkspaceMenu(false)
  }

  // Traduit le chemin serveur POSIX en montage Windows, EXACTEMENT comme le backend
  // (_map_path_for_os) : 1er segment (home/mnt/…) retiré, 2e = nom de partage,
  // reste inchange, / -> \. Ex : /home/explorer_vm/wk -> \\<share-host>\explorer_vm\wk.
  const mappedWindowsPath = (() => {
    if (!workspacePath || !workspacePath.startsWith('/') || !nativeShareHost.trim()) return null
    const parts = workspacePath.split('/').filter(Boolean)
    if (parts.length < 2) return null
    const [, share, ...rest] = parts
    return `\\\\${nativeShareHost.trim()}\\${share}${rest.length ? '\\' + rest.join('\\') : ''}`
  })()

  const saveNativeShareHost = async () => {
    const host = nativeShareHost.trim()
    setNativeShareHost(host)
    try {
      const cur = await settingsAPI.get()
      await settingsAPI.update({ paths: { ...(cur.paths ?? {}), native_share_host: host } })
      toast.success(host ? `Hôte du partage enregistré : ${host}` : 'Lecture réseau native désactivée')
    } catch {
      toast.error('Échec de l\'enregistrement de l\'hôte du partage')
    }
  }

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  const handleStartTour = () => {
    setTourState((prev) => ({ completed: prev?.completed ?? false, launchedOnce: true }))
    void writeTutorialState(TUTORIAL_KEY, { launchedOnce: true })
    const ctx: AnnotationTourContext = {
      navigate, projectId: null, project2Id: null, samplePath: null,
    }
    startTour(buildAnnotationTourSteps(), ctx, {
      onFinish: () => { void writeTutorialState(TUTORIAL_KEY, { completed: true }) },
      // Le tour cree/modifie des projets : la liste peut etre en retard.
      onExit: () => { void fetchProjects() },
    })
  }

  const handleCreate = async (name: string, type: 'image' | 'video') => {
    await projectsAPI.create({ name, project_type: type })
    await fetchProjects()
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteProject(deleteTarget.id)
    setDeleteTarget(null)
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* En-tête sticky : reste visible quand on scrolle une longue liste de projets */}
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
              <rect width="32" height="32" rx="7" fill="#0f172a"/>
              <rect x="4" y="5" width="24" height="18" rx="2" fill="#1e293b"/>
              <path d="M4 18 L9 13 L13.5 16 L19 10 L28 18 Z" fill="#334155" opacity="0.6"/>
              <rect x="8" y="8" width="16" height="12" rx="1.5" fill="none" stroke="#38bdf8" strokeWidth="2"/>
              <rect x="6" y="6" width="4" height="4" rx="1" fill="#38bdf8"/>
              <rect x="22" y="6" width="4" height="4" rx="1" fill="#38bdf8"/>
              <rect x="6" y="18" width="4" height="4" rx="1" fill="#38bdf8"/>
              <rect x="22" y="18" width="4" height="4" rx="1" fill="#38bdf8"/>
              <rect x="8" y="25.5" width="13" height="4.5" rx="2.25" fill="#6366f1"/>
              <rect x="10" y="27.2" width="9" height="1" rx="0.5" fill="rgba(255,255,255,0.75)"/>
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-slate-100">AnnotationApp</h1>
          <TourLaunchButton onClick={handleStartTour} glow={tourNeverLaunched} />
        </div>

        <div className="flex items-center gap-2" data-tour="home-tools">
          <button
            onClick={() => navigate('/presentation')}
            data-tour="presentation-btn"
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <BookOpen size={15} />
            Présentation
          </button>
          <button
            onClick={() => navigate('/convert')}
            title="Convertir les formats d'annotations (.ver ↔ YOLO)"
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Wand2 size={15} />
            Convert
          </button>
          <button
            onClick={() => setShowSettings(true)}
            title="Paramètres"
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Settings size={15} />
            Paramètres
          </button>
          <button
            onClick={() => navigate('/monitoring')}
            data-tour="monitoring-btn"
            title="Usage : automatique vs manuel, reprise humaine"
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Activity size={15} />
            Monitoring
          </button>
          <button
            onClick={() => setShowCreate(true)}
            data-tour="new-project-btn"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            Nouveau projet
          </button>
        </div>
      </header>

      {/* Contenu — la page scrolle naturellement quel que soit le nombre de projets */}
      <main className="px-6 py-8 max-w-6xl mx-auto pb-24">
        <div className="flex items-baseline gap-3 mb-6">
          <h2 className="text-xl font-semibold text-slate-100">Projets</h2>
          {projects.length > 0 && (
            <span className="text-xs text-slate-500">{projects.length} projet{projects.length > 1 ? 's' : ''}</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" label="Chargement des projets..." />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-slate-700 rounded-xl">
            <Folder size={40} className="mx-auto text-slate-600 mb-3" />
            <p className="text-slate-400 text-sm">Aucun projet.</p>
            <p className="text-slate-600 text-xs mt-1">
              Créez votre premier projet d'annotation.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-2 mx-auto bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={14} />
              Créer un projet
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
            {projects.map((project) => {
              const annotationRate =
                project.frame_count > 0
                  ? Math.round((project.annotated_count / project.frame_count) * 100)
                  : 0

              const sequences = project.sequences ?? []
              const isExpanded = expandedProjects.has(project.id)
              const visibleSequences = isExpanded ? sequences : sequences.slice(0, 3)
              const isVideo = project.project_type === 'video'
              // Projet demo cree par le tutoriel : identite orange, comme son bouton.
              const isTemplate = Boolean(project.is_template)
              const progressColor = annotationRate >= 80
                ? 'bg-emerald-500'
                : annotationRate >= 40
                ? 'bg-amber-500'
                : isVideo ? 'bg-purple-500' : 'bg-blue-500'

              return (
                <div
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}/annotate`)}
                  data-tour={isTemplate ? 'project-card-template' : undefined}
                  className={`group relative bg-slate-800 border rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-xl hover:shadow-black/30 hover:-translate-y-0.5 ${
                    isTemplate
                      ? 'border-orange-500/60 hover:border-orange-400 shadow-lg shadow-orange-900/20'
                      : 'border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {/* Accent coloré à gauche : orange pour le projet du tutoriel, sinon selon le type */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                    isTemplate ? 'bg-orange-500' : isVideo ? 'bg-purple-500' : 'bg-blue-500'
                  }`} />

                  <div className="p-4 pl-5">
                    {/* Icône + nom */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            isTemplate
                              ? 'bg-orange-600/20 text-orange-400'
                              : isVideo
                              ? 'bg-purple-600/20 text-purple-400'
                              : 'bg-blue-600/20 text-blue-400'
                          }`}
                        >
                          {isVideo ? <Film size={18} /> : <Image size={18} />}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-slate-100 truncate">
                            {project.name}
                          </h3>
                          <span className={`text-xs font-medium ${
                            isTemplate ? 'text-orange-400/80' : isVideo ? 'text-purple-400/70' : 'text-blue-400/70'
                          }`}>
                            {isVideo ? 'Séquence Image' : 'Image Random'}
                            {isTemplate && (
                              <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-orange-500/20 text-orange-300 border border-orange-500/40 rounded px-1 py-px">
                                Démo tutoriel
                              </span>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Supprimer */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget(project)
                        }}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:text-red-400 text-slate-500 transition-all rounded"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Description (si présente) */}
                    {project.description && (
                      <p className="text-xs text-slate-500 mb-3 truncate">{project.description}</p>
                    )}

                    {/* Stats */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="flex items-center gap-1 text-slate-400">
                          <BarChart2 size={11} />
                          {project.annotated_count} / {project.frame_count} frames annotées
                        </span>
                        <span className={`font-semibold ${
                          annotationRate >= 80 ? 'text-emerald-400' :
                          annotationRate >= 40 ? 'text-amber-400' :
                          'text-slate-300'
                        }`}>{annotationRate}%</span>
                      </div>

                      {/* Barre de progression dynamique */}
                      <div className="h-1.5 bg-slate-700/80 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                          style={{ width: `${annotationRate}%` }}
                        />
                      </div>
                    </div>

                    {/* Détail par séquence (multi-séquence) */}
                    {sequences.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-slate-700/60 space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">
                          {sequences.length} séquence{sequences.length > 1 ? 's' : ''}
                        </p>
                        {visibleSequences.map((seq) => {
                          const seqRate = seq.frame_count > 0
                            ? Math.round((seq.annotated_frames / seq.frame_count) * 100)
                            : 0
                          return (
                            <div key={seq.id} className="text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-300 truncate min-w-0" title={seq.name}>
                                  {seqIcon(seq.source_type)} {seq.name}
                                </span>
                                <span className="text-slate-500 flex-shrink-0 tabular-nums">
                                  {seq.annotated_frames}/{seq.frame_count}
                                  {seq.annotation_count > 0 && (
                                    <span className="text-slate-600"> · {seq.annotation_count} annot.</span>
                                  )}
                                </span>
                              </div>
                              <div className="h-1 mt-0.5 bg-slate-700/60 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${
                                    seqRate >= 80 ? 'bg-emerald-500' : seqRate >= 40 ? 'bg-amber-500' : 'bg-sky-600'
                                  }`}
                                  style={{ width: `${seqRate}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                        {sequences.length > 3 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleExpanded(project.id)
                            }}
                            className="text-[11px] text-blue-400/80 hover:text-blue-300 transition-colors"
                          >
                            {isExpanded
                              ? 'Réduire'
                              : `+ ${sequences.length - 3} autre${sequences.length - 3 > 1 ? 's' : ''} séquence${sequences.length - 3 > 1 ? 's' : ''}`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Date */}
                    <p className="text-xs text-slate-600 mt-3">{formatDate(project.updated_at)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Modals */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <CreateProjectModal
        isOpen={showCreate}
        onCreate={handleCreate}
        onClose={() => setShowCreate(false)}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Supprimer le projet"
        message={`Supprimer "${deleteTarget?.name}" et toutes ses annotations ?`}
        confirmLabel="Supprimer"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Badge utilisateur + menu Workspace — ancre en bas a gauche de la page
          d'accueil. Le menu vivait dans l'en-tete : doublon avec ce badge, qui
          porte deja l'ouverture du dossier. */}
      <div ref={workspaceMenuRef} data-tour="workspace-badge"
           className="fixed bottom-3 left-3 z-30 bg-slate-800/90 backdrop-blur-sm border border-slate-700 rounded-xl px-2.5 py-1.5 shadow-lg">
        <div className="flex items-center gap-1.5">
          <UserBadge />
          <button
            onClick={() => setShowWorkspaceMenu((v) => !v)}
            title={workspacePath ? `Workspace : ${workspacePath}` : 'Workspace'}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-1.5 py-1 rounded hover:bg-slate-700 transition-colors flex-shrink-0"
          >
            <FolderOpen size={13} />
            Workspace
          </button>
        </div>
        {showWorkspaceMenu && (
          <div className="absolute left-0 bottom-full mb-1 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-40 p-2 space-y-1">
            <p className="text-[11px] text-slate-500 px-2 pt-1 break-all">{workspacePath ?? 'Chemin inconnu'}</p>
            <button
              onClick={handleRevealWorkspace}
              className="w-full flex items-center gap-2 text-left text-xs text-slate-300 hover:bg-slate-700 px-2 py-1.5 rounded-lg transition-colors"
            >
              <ExternalLink size={12} /> Ouvrir sur le serveur (app locale uniquement)
            </button>
            {workspacePath && (
              <button
                onClick={() => void copyToClipboard(workspacePath, 'Chemin serveur')}
                className="w-full flex items-center gap-2 text-left text-xs text-slate-300 hover:bg-slate-700 px-2 py-1.5 rounded-lg transition-colors"
              >
                <Copy size={12} /> Copier le chemin serveur
              </button>
            )}
            {mappedWindowsPath && (
              <button
                onClick={() => void copyToClipboard(mappedWindowsPath, 'Chemin Windows')}
                className="w-full flex items-center gap-2 text-left text-xs text-emerald-300 hover:bg-slate-700 px-2 py-1.5 rounded-lg transition-colors"
              >
                <Copy size={12} /> Copier le chemin Windows (montage)
              </button>
            )}
            {/* Montage Windows (usage SSH) : seul l'hôte du partage est requis.
                /home/… → \\{hôte}\\… (1er segment retiré, / → \\). */}
            <div className="border-t border-slate-700 mt-1 pt-2 px-2 pb-1 space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Montage Windows - hôte du partage</p>
              <p className="text-[10px] text-slate-500 leading-snug">
                Exemple : <code className="text-slate-300">/srv/datasets/...</code> devient <code className="text-emerald-300">{`\\\\${nativeShareHost.trim() || '<share-host>'}\\datasets\\...`}</code>.
              </p>
              <input
                type="text"
                value={nativeShareHost}
                onChange={(e) => setNativeShareHost(e.target.value)}
                placeholder="share-host.example.net"
                className="w-full bg-slate-900/60 border border-slate-600 focus:border-blue-500 text-slate-200 text-[11px] px-2 py-1 rounded outline-none placeholder:text-slate-600"
              />
              {mappedWindowsPath && (
                <p className="text-[10px] text-emerald-400/80 break-all font-mono">→ {mappedWindowsPath}</p>
              )}
              <button
                onClick={() => void saveNativeShareHost()}
                className="w-full text-[11px] text-blue-300 hover:text-blue-200 bg-blue-900/30 hover:bg-blue-900/50 rounded py-1 transition-colors"
              >
                Enregistrer l'hôte du partage
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
