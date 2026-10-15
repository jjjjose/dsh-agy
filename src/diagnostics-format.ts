/** Shared, browser-safe diagnostic types and report formatting. No payloads. */
export type DiagnosticEvent = 'request-admitted' | 'request-built' | 'adapter-tools' | 'request-start' | 'http-response' | 'network-error' | 'endpoint-retry' | 'account-rotation' | 'schema-error' | 'generation-finish' | 'request-complete' | 'request-error' | 'request-aborted' | 'model-resolved' | 'model-unavailable' | 'catalog-refresh' | 'catalog-updated' | 'catalog-error' | 'catalog-cache' | 'catalog-cache-write-error'
export interface DiagnosticRecord {
  requestId: string
  model: string
  event: DiagnosticEvent
  toolCount?: number
  deferredToolCount?: number
  contextWindow?: number
  maxOutputTokens?: number
  contextSource?: 'google' | 'cache' | 'fallback'
  outputSource?: 'google' | 'cache' | 'fallback'
  durationMs?: number
  status?: number
  attempt?: number
  modelCount?: number
  wireModel?: string
  effort?: string
  finishReason?: string
  tool?: string
  schemaPath?: string
  stage?: 'authentication' | 'request' | 'stream' | 'generation' | 'empty-response'
}
export interface DiagnosticEntry extends DiagnosticRecord { time: number }
export interface DiagnosticSnapshot {
  enabled: boolean
  version: string
  limit: number
  entries: DiagnosticEntry[]
}

export function formatDiagnosticReport(snapshot: DiagnosticSnapshot): string {
  const lines = snapshot.entries.map((entry) => {
    const details = Object.entries(entry).filter(([key]) => !['time', 'event'].includes(key))
      .map(([key, value]) => `${key}=${value}`).join(' · ')
    return `${new Date(entry.time).toISOString()} · ${entry.event} · ${details}`
  })
  return [`dsh-agy ${snapshot.version} — diagnóstico seguro`,
    `Registro: ${snapshot.enabled ? 'activado' : 'desactivado'} · ${snapshot.entries.length}/${snapshot.limit} entradas`,
    'Sin credenciales, prompts, argumentos, respuestas ni finishMessage. Historial en memoria.',
    ...lines.length ? lines : ['Sin entradas. Activa el registro y reproduce el problema.'],
  ].join('\n')
}
