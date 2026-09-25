// ============================================================
// App.tsx
// Entrée principale de l'application React.
// Définit les routes avec React Router v6.
// ============================================================

import React, { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { ProjectsPage } from './pages/ProjectsPage'
import { AnnotationPage } from './pages/AnnotationPage'
import { PresentationPage } from './pages/PresentationPage'
import { ConvertPage } from './pages/ConvertPage'
import { MonitoringPage } from './pages/MonitoringPage'
import { useSettingsStore } from './stores/settingsStore'
import { TourProvider, TourOverlay } from './components/tour'
import { settingsAPI } from './services/api'
import { initWorkspaceLanguage } from './i18n/translate'
import type { Lang } from './i18n/translate'

const App: React.FC = () => {
  const fetchSettings = useSettingsStore((s) => s.fetch)
  useEffect(() => { void fetchSettings() }, [fetchSettings])
  // Repli langue workspace : ne s'applique que si VisionNexus n'a pas deja
  // impose la langue via ?lang= (cf. i18n/translate.ts).
  useEffect(() => {
    void initWorkspaceLanguage(() => settingsAPI.get().then((s) => (s as unknown as { ui_language?: Lang }).ui_language))
  }, [])
  return (
  <BrowserRouter>
    <TourProvider>
    {/* Notifications toast globales */}
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#1e293b',
          color: '#e2e8f0',
          border: '1px solid #334155',
          fontSize: '13px',
        },
        success: { iconTheme: { primary: '#22c55e', secondary: '#1e293b' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#1e293b' } },
      }}
    />

    <Routes>
      {/* Page d'accueil : liste des projets */}
      <Route path="/" element={<ProjectsPage />} />

      {/* Page d'annotation d'un projet */}
      <Route path="/projects/:projectId/annotate" element={<AnnotationPage />} />

      {/* Page de présentation */}
      <Route path="/presentation" element={<PresentationPage />} />

      {/* Page utilitaire Convert (S10) */}
      <Route path="/convert" element={<ConvertPage />} />

      {/* Monitoring d'usage : auto vs manuel, reprise humaine */}
      <Route path="/monitoring" element={<MonitoringPage />} />

      {/* Redirection par défaut */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>

    {/* Tour guide interactif -- monte hors des routes pour survivre a la navigation */}
    <TourOverlay />
    </TourProvider>
  </BrowserRouter>
  )
}

export default App
