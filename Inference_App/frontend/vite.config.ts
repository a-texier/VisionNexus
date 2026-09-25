import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const runtimeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string> } }).process?.env ?? {}
const backendPort = runtimeEnv.VITE_BACKEND_PORT ?? '8065'
const frontendPort = Number(runtimeEnv.VITE_FRONTEND_PORT ?? '5177')

export default defineConfig({
  cacheDir: runtimeEnv.VITE_CACHE_DIR || undefined,
  plugins: [react()],
  server: {
    // Loopback par defaut : sur la VM, 0.0.0.0 exposait l'app a tout le LAN.
    // Les onglets VisionNexus passent par un tunnel ssh vers 127.0.0.1.
    // CV_BIND_HOST=0.0.0.0 pour exposer volontairement.
    host: process.env.CV_BIND_HOST || '127.0.0.1',
    port: frontendPort,
    allowedHosts: true,
    proxy: { '/api': { target: `http://localhost:${backendPort}`, changeOrigin: true, timeout: 3_600_000 } },
  },
})
