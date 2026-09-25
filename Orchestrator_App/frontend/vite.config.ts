import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports injectés par launcher.py via les variables d'environnement.
// Fallback : valeurs par défaut pour un lancement manuel.
const backendPort  = process.env.VITE_BACKEND_PORT  ?? '8060'
const frontendPort = parseInt(process.env.VITE_FRONTEND_PORT ?? '3000', 10)
const backendTarget = `http://localhost:${backendPort}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    // Loopback par defaut : sur la VM, 0.0.0.0 exposait l'app a tout le LAN.
    // Les onglets VisionNexus passent par un tunnel ssh vers 127.0.0.1.
    // CV_BIND_HOST=0.0.0.0 pour exposer volontairement.
    host: process.env.CV_BIND_HOST || '127.0.0.1',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        timeout: 300000,
      },
    },
  },
})
