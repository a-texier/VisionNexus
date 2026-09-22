import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports injectés par launcher.py via les variables d'environnement.
// Fallback : valeurs par défaut pour un lancement manuel.
const runtimeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string> } }).process?.env ?? {}
const backendPort  = runtimeEnv.VITE_BACKEND_PORT  ?? '8064'
const frontendPort = parseInt(runtimeEnv.VITE_FRONTEND_PORT ?? '5176', 10)
const backendTarget = `http://localhost:${backendPort}`

// Cache de pre-bundling des deps (node_modules/.vite par defaut). Deux serveurs
// Vite lances sur CE MEME dossier frontend (un par VisionNexus, un par
// Orchestrator pendant un run) partageaient ce cache : le second regenere le
// browserHash des deps, et les pages deja ouvertes par le premier recoivent
// alors des 504 "Outdated Optimize Dep" -- l'overlay d'erreur Vite (fond noir,
// texte brut) remplace l'app. Un cacheDir par instance supprime la collision.
const cacheDir = runtimeEnv.VITE_CACHE_DIR || undefined

export default defineConfig({
  cacheDir,
  plugins: [react()],
  server: {
    port: frontendPort,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': { target: backendTarget, changeOrigin: true, timeout: 600000 },
    },
  },
})
