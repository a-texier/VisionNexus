import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/

// Ports injectés par launcher.py via les variables d'environnement.
// Fallback : valeurs par défaut pour un lancement manuel.
// IMPORTANT : 127.0.0.1 et PAS localhost — sur Windows, Node résout d'abord
// localhost en IPv6 (::1) alors qu'uvicorn n'écoute qu'en IPv4 : chaque
// requête proxifiée payait ~200 ms de tentative IPv6 avant le repli IPv4.
const backendPort   = process.env.VITE_BACKEND_PORT  ?? '8000'
const frontendPort  = parseInt(process.env.VITE_FRONTEND_PORT ?? '5173', 10)
const backendHttp   = `http://127.0.0.1:${backendPort}`
const backendWs     = `ws://127.0.0.1:${backendPort}`

// Cache de pre-bundling des deps (node_modules/.vite par defaut). Deux serveurs
// Vite lances sur CE MEME dossier frontend (un par VisionNexus, un par
// Orchestrator pendant un run) partageaient ce cache : le second regenere le
// browserHash des deps, et les pages deja ouvertes par le premier recoivent
// alors des 504 "Outdated Optimize Dep" -- l'overlay d'erreur Vite (fond noir,
// texte brut) remplace l'app. Un cacheDir par instance supprime la collision.
const cacheDir = process.env.VITE_CACHE_DIR || undefined

export default defineConfig({
  cacheDir,
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: frontendPort,
    // Loopback par defaut : sur la VM, 0.0.0.0 exposait l'app a tout le LAN.
    // Les onglets VisionNexus passent par un tunnel ssh vers 127.0.0.1.
    // CV_BIND_HOST=0.0.0.0 pour exposer volontairement.
    host: process.env.CV_BIND_HOST || '127.0.0.1',
    allowedHosts: true,
    // Proxy pour éviter les problèmes CORS en développement
    proxy: {
      '/api': {
        target: backendHttp,
        changeOrigin: true,
        proxyTimeout: 180000,  // 3 min — pour les appels longue durée (guided tracking, SAM3)
        timeout: 180000,
      },
      '/media': {
        target: backendHttp,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWs,
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
