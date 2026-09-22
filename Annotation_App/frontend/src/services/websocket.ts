// ============================================================
// services/websocket.ts
// Client WebSocket typé avec reconnexion automatique.
// Utilisé pour le streaming SAM2 et la propagation vidéo.
// ============================================================

import type { TaskWSMessage, WSSAMImageMessage, WSSAMVideoMessage } from '../types/api'

type MessageHandler<T> = (message: T) => void

/**
 * Client WebSocket générique avec reconnexion automatique.
 * Supporte l'abonnement à des types de messages spécifiques.
 */
export class AnnotationWebSocket<TMessage> {
  private ws: WebSocket | null = null
  private url: string = ''
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000  // ms, doublé à chaque échec
  private handlers: Map<string, MessageHandler<TMessage>[]> = new Map()
  private isIntentionalClose = false
  private connectResolve: (() => void) | null = null
  private connectReject: ((reason: string) => void) | null = null

  /** Connecte au WebSocket et attend que la connexion soit établie. */
  connect(url: string): Promise<void> {
    this.url = url
    this.isIntentionalClose = false
    this.reconnectAttempts = 0

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
      this._createConnection()
    })
  }

  /** Ferme la connexion proprement. */
  disconnect(): void {
    this.isIntentionalClose = true
    this.ws?.close()
    this.ws = null
  }

  /** Envoie un message JSON au serveur. */
  send(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.warn("[WebSocket] Tentative d'envoi sur une connexion fermée")
    }
  }

  /** Abonne un handler à un type de message. Retourne la fonction de désabonnement. */
  on<K extends TMessage extends { type: string } ? TMessage['type'] : never>(
    type: K,
    handler: MessageHandler<Extract<TMessage, { type: K }>>
  ): () => void {
    const key = type as string
    if (!this.handlers.has(key)) {
      this.handlers.set(key, [])
    }
    this.handlers.get(key)!.push(handler as MessageHandler<TMessage>)

    // Retourne la fonction de désabonnement
    return () => {
      const list = this.handlers.get(key)
      if (list) {
        const idx = list.indexOf(handler as MessageHandler<TMessage>)
        if (idx !== -1) list.splice(idx, 1)
      }
    }
  }

  /** Retourne true si la connexion est active. */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private _createConnection(): void {
    // URL WebSocket :
    //   - Si l'URL est déjà absolue (commence par ws:// ou wss://) → on la garde.
    //   - Sinon, on construit une URL relative à l'hôte courant.
    //     En dev : Vite proxie /ws → backend (port injecté par VITE_BACKEND_PORT dans vite.config.ts).
    //     En prod : même hôte/port que le frontend, reverse-proxy gère /ws.
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = this.url.startsWith('ws')
      ? this.url
      : `${protocol}://${window.location.host}${this.url}`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      console.log(`[WebSocket] Connecté : ${wsUrl}`)
      this.reconnectAttempts = 0
      this.reconnectDelay = 1000
      this.connectResolve?.()
      this.connectResolve = null
      this.connectReject = null
    }

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string) as TMessage & { type: string }
        const msgType = message.type

        // Appel des handlers abonnés à ce type de message
        const typeHandlers = this.handlers.get(msgType) ?? []
        typeHandlers.forEach((h) => h(message))

        // Handler générique '*' pour tous les messages
        const allHandlers = this.handlers.get('*') ?? []
        allHandlers.forEach((h) => h(message))
      } catch (e) {
        console.error('[WebSocket] Erreur de parsing JSON :', e)
      }
    }

    this.ws.onerror = (event) => {
      console.error('[WebSocket] Erreur :', event)
    }

    this.ws.onclose = (event) => {
      console.log(`[WebSocket] Connexion fermée (code: ${event.code})`)

      if (!this.isIntentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
        // Reconnexion automatique avec délai exponentiel
        this.reconnectAttempts++
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
        console.log(`[WebSocket] Reconnexion dans ${delay}ms (tentative ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
        setTimeout(() => this._createConnection(), delay)
      } else if (this.connectReject) {
        this.connectReject('Connexion WebSocket échouée')
        this.connectReject = null
      }
    }
  }
}

// ---- Instances nommées pour les deux canaux SAM2 ----

/** WebSocket pour la segmentation automatique d'images (streaming masques). */
export const samImageWS = new AnnotationWebSocket<WSSAMImageMessage>()

/** WebSocket pour les sessions de propagation vidéo SAM2. */
export const samVideoWS = new AnnotationWebSocket<WSSAMVideoMessage>()

// Une tache de propagation ne doit ouvrir qu'une connexion physique. Plusieurs
// composants peuvent vouloir son statut (panneau de tracking, barre du haut),
// mais le backend vide la file `live_frames` a chaque envoi : deux sockets se
// voleraient donc les apercus et leurs `native_path`. Ce petit broker diffuse
// le meme message a tous les abonnes locaux sans trafic reseau supplementaire.
type TaskSocketHandlers = {
  update?: (message: Extract<TaskWSMessage, { type: 'update' }>) => void
  notFound?: () => void
}

type SharedTaskSocket = {
  socket: AnnotationWebSocket<TaskWSMessage>
  connected: Promise<void>
  subscribers: Set<TaskSocketHandlers>
}

const sharedTaskSockets = new Map<string, SharedTaskSocket>()

export function subscribeTaskProgress(taskId: string, handlers: TaskSocketHandlers): {
  connected: Promise<void>
  disconnect: () => void
} {
  let shared = sharedTaskSockets.get(taskId)
  if (!shared) {
    const socket = new AnnotationWebSocket<TaskWSMessage>()
    shared = {
      socket,
      subscribers: new Set<TaskSocketHandlers>(),
      connected: Promise.resolve(),
    }
    const entry = shared
    socket.on('update', (message) => {
      for (const subscriber of [...entry.subscribers]) subscriber.update?.(message)
      if (message.status === 'completed' || message.status === 'error') {
        // Le serveur ferme aussi le canal apres cet etat. Fermer explicitement
        // empeche le client generique de tenter une reconnexion inutile.
        entry.socket.disconnect()
      }
    })
    socket.on('not_found', () => {
      for (const subscriber of [...entry.subscribers]) subscriber.notFound?.()
      entry.socket.disconnect()
    })
    sharedTaskSockets.set(taskId, entry)
    entry.connected = socket.connect(`/ws/tasks/${taskId}`)
  }

  shared.subscribers.add(handlers)
  let disconnected = false
  return {
    connected: shared.connected,
    disconnect: () => {
      if (disconnected) return
      disconnected = true
      shared!.subscribers.delete(handlers)
      if (shared!.subscribers.size === 0) {
        shared!.socket.disconnect()
        if (sharedTaskSockets.get(taskId) === shared) sharedTaskSockets.delete(taskId)
      }
    },
  }
}

/** URL des WebSockets */
export const WS_URLS = {
  SAM_IMAGE: '/ws/sam/image',
  SAM_VIDEO: '/ws/sam/video',
}
