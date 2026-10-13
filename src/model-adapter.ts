import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { DiagnosticRecord } from './diagnostics-format.ts'
import { scopedStream } from './inference-scope.ts'

/** Keep legacy IDs resolvable internally, but never list them in the picker. */
export class AntigravityAdapter extends PiAiAdapter {
  constructor(options: ConstructorParameters<typeof PiAiAdapter>[0], private readonly visibleIds: () => ReadonlySet<string>, private readonly reportLog?: (entry: DiagnosticRecord) => void) { super(options) }

  override streamWithSnapshot(...args: Parameters<PiAiAdapter['streamWithSnapshot']>) {
    const [options, snapshot] = args
    const requestId = `agent-${crypto.randomUUID()}`
    const tools = options.tools
    const deferredToolCount = tools?.filter((tool) => tool.deferLoading === true).length ?? 0
    try {
      this.reportLog?.({ requestId, model: options.model,
        event: 'adapter-tools', toolCount: tools?.length ?? 0, deferredToolCount })
    } catch { /* Diagnostics must never affect generation. */ }
    // Tool admission belongs to DSH. pi-ai 1.x carries the admitted declarations
    // in transcript system messages; don't change deferred-tool permissions.
    return scopedStream(requestId, super.streamWithSnapshot(options, snapshot))
  }

  override async listModels(provider: string) {
    const models = await super.listModels(provider)
    const ids = this.visibleIds()
    return models.filter((model) => ids.has(model.id))
  }
}
