import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports injectés par launcher.py via les variables d'environnement.
// Fallback : valeurs par défaut pour un lancement manuel.
const backendPort  = process.env.VITE_BACKEND_PORT  ?? '8062'
const frontendPort = parseInt(process.env.VITE_FRONTEND_PORT ?? '3001', 10)
const backendTarget = `http://localhost:${backendPort}`
const orchestratorTarget = `http://127.0.0.1:${process.env.VITE_ORCHESTRATOR_BACKEND_PORT ?? '8060'}`

// Cache de pre-bundling des deps (node_modules/.vite par defaut). Deux serveurs
// Vite lances sur CE MEME dossier frontend (un par VisionNexus, un par
// Orchestrator pendant un run) partageaient ce cache : le second regenere le
// browserHash des deps, et les pages deja ouvertes par le premier recoivent
// alors des 504 "Outdated Optimize Dep" -- l'overlay d'erreur Vite (fond noir,
// texte brut) remplace l'app. Un cacheDir par instance supprime la collision.
const cacheDir = process.env.VITE_CACHE_DIR || undefined

export default defineConfig({
  cacheDir,
  plugins: [react()],
  server: {
    port: frontendPort,
    // Loopback par defaut : sur la VM, 0.0.0.0 exposait l'app a tout le LAN.
    // Les onglets VisionNexus passent par un tunnel ssh vers 127.0.0.1.
    // CV_BIND_HOST=0.0.0.0 pour exposer volontairement.
    host: process.env.CV_BIND_HOST || '127.0.0.1',
    allowedHosts: true,
    proxy: {
      '/orchestrator-api': {
        target: orchestratorTarget,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/orchestrator-api/, '/api'),
        timeout: 300000,
      },
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        timeout: 300000,
      },
    },
  },
})
