export type NodeExecStatus = 'idle' | 'running' | 'waiting' | 'done' | 'warning' | 'failed'

export const STATUS_DOT: Record<NodeExecStatus, string> = {
  idle:    'bg-gray-600',
  running: 'bg-blue-500 animate-pulse',
  waiting: 'bg-orange-500 animate-pulse',
  done:    'bg-green-500',
  warning: 'bg-amber-400',
  failed:  'bg-red-500',
}

export const STATUS_RING: Record<NodeExecStatus, string> = {
  idle:    'ring-gray-700',
  running: 'ring-blue-500',
  waiting: 'ring-orange-500',
  done:    'ring-green-600',
  warning: 'ring-amber-500',
  failed:  'ring-red-600',
}
