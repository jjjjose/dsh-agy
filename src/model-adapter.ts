import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { DiagnosticRecord } from './diagnostics-format.ts'

/** Keep legacy IDs resolvable internally, but never list them in the picker. */
export class AntigravityAdapter extends PiAiAdapter {
  constructor(options: ConstructorParameters<typeof PiAiAdapter>[0], private readonly visibleIds: () => ReadonlySet<string>, private readonly reportLog?: (entry: DiagnosticRecord) => void) { super(options) }

  override streamWithSnapshot(...args: Parameters<PiAiAdapter['streamWithSnapshot']>) {
    const [options, snapshot] = args
    const tools = options.tools
    const deferredToolCount = tools?.filter((tool) => tool.deferLoading === true).length ?? 0
    try {
      this.reportLog?.({ requestId: `adapter-${crypto.randomUUID()}`, model: options.model,
        event: 'adapter-tools', toolCount: tools?.length ?? 0, deferredToolCount })
    } catch { /* Diagnostics must never affect generation. */ }
    // This custom protocol offers no incremental tool-loading capability. Send
    // the supplied request's declarations eagerly, as DSH's no-toolUpdate
    // projection does. Never fetch extra tools or mutate the frozen request.
    return super.streamWithSnapshot(deferredToolCount === 0 ? options : {
      ...options,
      tools: tools!.map(({ deferLoading: _deferred, ...tool }) => tool),
    }, snapshot)
  }

  override async listModels(provider: string) {
    const models = await super.listModels(provider)
    const ids = this.visibleIds()
    return models.filter((model) => ids.has(model.id))
  }
}
