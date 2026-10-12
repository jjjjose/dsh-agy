import { formatDiagnosticReport } from '../diagnostics-format.ts'
import type { DiagnosticSnapshot } from '../diagnostics-format.ts'

/** Non-overlapping polling, cancelled on unmount or configuration changes. */
export function pollDiagnosticLogs(
  load: (signal: AbortSignal) => Promise<DiagnosticSnapshot>,
  onState: (state: DiagnosticSnapshot) => void,
  onError: () => void,
  initialEnabled = false,
): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let enabled = initialEnabled
  const tick = async () => {
    try {
      const state = await load(controller.signal)
      if (controller.signal.aborted) return
      enabled = state.enabled
      onState(state)
    } catch {
      if (controller.signal.aborted) return
      onError()
    }
    if (enabled && !controller.signal.aborted) timer = setTimeout(() => { void tick() }, 3000)
  }
  void tick()
  return () => { controller.abort(); clearTimeout(timer) }
}

export async function copyDiagnosticLogs(snapshot: DiagnosticSnapshot, clipboard?: Pick<Clipboard, 'writeText'>): Promise<void> {
  if (!clipboard) throw new Error('El portapapeles no está disponible. Selecciona el informe y cópialo manualmente.')
  try { await clipboard.writeText(formatDiagnosticReport(snapshot)) }
  catch { throw new Error('No se pudo copiar. Selecciona el informe y cópialo manualmente.') }
}
