// ============================================================
// utils/nativeImage.ts
// Chemin natif (coquille Electron, desktop/src/imageProtocol.ts) pour les
// deux endpoints d'images vraiment coûteux (thumb à la demande, full-res) --
// PAS pour thumbnail_url (déjà un fichier statique pré-généré, servi tel
// quel, aucun gain à passer par ce protocole).
//
// window.__CV_NATIVE_MOUNT__ n'existe QUE dans la coquille Electron (exposé
// par preloadApp.ts, contextBridge) -- absent en page web classique ou dans
// l'ancien VisionNexus : dans ce cas httpPath est renvoyé tel quel, zéro
// différence de comportement.
// ============================================================

declare global {
  interface Window {
    __CV_NATIVE_MOUNT__?: { supported: boolean }
  }
}

const isNativeShell = typeof window !== 'undefined' && !!window.__CV_NATIVE_MOUNT__?.supported

function backendBase(): string {
  return `http://127.0.0.1:${import.meta.env.VITE_BACKEND_PORT ?? 8001}`
}

/**
 * `httpPath` : endpoint HTTP classique déjà utilisé aujourd'hui (repli
 * garanti). `nativePathEndpoint` : endpoint jumeau `.../xxx-path` qui
 * renvoie `{ native_path }`. En dehors de la coquille Electron, retourne
 * `httpPath` tel quel.
 */
export function nativeImageUrl(httpPath: string, nativePathEndpoint: string): string {
  if (!isNativeShell) return httpPath
  const imagePath = `${backendBase()}${nativePathEndpoint}`
  const fallback = `${backendBase()}${httpPath}`
  return `app-image://native/?imagePath=${encodeURIComponent(imagePath)}&fallback=${encodeURIComponent(fallback)}`
}
