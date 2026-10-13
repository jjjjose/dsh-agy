import { describe, expect, it, vi } from 'vitest'
import { createProvider, normalizeContext } from '@earendil-works/pi-ai'
import { parseAvailableModels, withLegacyAliases } from '../src/models.ts'
import { buildEnvelope, createAntiGravityApi } from '../src/api.ts'

const dispatch = vi.hoisted(() => ({ received: vi.fn() }))

vi.mock('@deepseek-ai/dsh-llm-pi-ai', () => ({
  PiAiAdapter: class {
    constructor(private readonly options: { profiles: () => ReadonlyMap<string, { piProvider: { getModels(): Array<{ id: string; name: string; input: string[] }> } }> }) {}
    async listModels(provider: string) {
      return this.options.profiles().get(provider)!.piProvider.getModels().map((model) => ({ provider, id: model.id, name: model.name, inputModalities: model.input }))
    }
    // Mirror the installed host: both entry points dispatch through the same
    // method, and piContext drops declarations still marked deferLoading.
    stream(options: unknown) { return this.streamWithSnapshot(options, this.options.profiles()) }
    async prepareCall() {
      const snapshot = this.options.profiles()
      return { stream: (options: unknown) => this.streamWithSnapshot(options, snapshot) }
    }
    async *streamWithSnapshot(options: any, snapshot: any) {
      dispatch.received(options, snapshot)
      const model = snapshot.get(options.provider).piProvider.getModels().find((model: any) => model.id === options.model)
      yield buildEnvelope(model, normalizeContext({ messages: [], tools: options.tools?.filter((tool: any) => !tool.deferLoading) }), {}, 'test-project')
    }
  },
}))
import { AntigravityAdapter } from '../src/model-adapter.ts'

describe('picker alias filtering', () => {
  it('hides legacy variants while keeping their descriptors in the provider', async () => {
    const models = parseAvailableModels({ models: { 'gemini-9.2-pro-low': {}, 'gemini-9.2-pro-high': {} } })
    const provider = createProvider({ id: 'google-antigravity', models: withLegacyAliases(models), api: createAntiGravityApi({ afterRateLimit: async () => undefined, reportRateLimit() {}, reportSuccess() {} }) })
    const profile = { provider: provider.id, displayName: provider.id, streamIdleTimeoutMs: 300000, maxRequestImageBytes: 100, requestImagePixelBudget: 100, requestImageMaxBytes: 100, retryPolicy: {}, configuredMaxTokens: new Map<string, number>(), modelErrors: new Map<string, string>(), piProvider: provider }
    const adapter = new AntigravityAdapter({ profiles: () => new Map([[provider.id, profile]]), resolveApiKey: async () => 'unused', auth: { credentials: {}, authContext: {} } }, () => new Set(models.map((model) => model.id)))
    expect((await adapter.listModels(provider.id)).map((model) => model.id)).toEqual(['gemini-9.2-pro'])
    expect(provider.getModels().some((model) => model.id === 'gemini-9.2-pro-high')).toBe(true)
  })
})

function toolAdapter(log = vi.fn()) {
  const models = parseAvailableModels({ models: { 'gemini-9.2-pro-high': {} } })
  const provider = createProvider({ id: 'google-antigravity', models, api: createAntiGravityApi({ afterRateLimit: async () => undefined, reportRateLimit() {}, reportSuccess() {} }) })
  const profile = { provider: provider.id, piProvider: provider }
  const profiles = new Map([[provider.id, profile]])
  const adapter = new AntigravityAdapter({ profiles: () => profiles } as any, () => new Set(models.map((model) => model.id)), log)
  return { adapter, profiles, log }
}

describe('Antigravity tool admission', () => {
  it.each(['direct', 'prepared'])('keeps admitted tools in the normalized wire envelope (%s)', async (entry) => {
    const { adapter, profiles, log } = toolAdapter()
    const parameters = Object.freeze({ type: 'object', properties: { command: { type: 'string' } }, required: ['command'] })
    const tool = Object.freeze({ name: 'bash', description: 'Run a command', parameters })
    const options = Object.freeze({ provider: 'google-antigravity', model: 'gemini-9.2-pro', tools: Object.freeze([tool]) })
    const host = adapter as any
    const stream = entry === 'direct' ? host.stream(options) : (await host.prepareCall()).stream(options)
    const result = await stream.next()
    expect(result.value.request.tools[0].functionDeclarations).toEqual([
      { name: 'bash', description: 'Run a command', parameters: { type: 'OBJECT', properties: { command: { type: 'STRING' } }, required: ['command'] } },
    ])
    expect(result.value.request.toolConfig).toBeUndefined()
    expect(dispatch.received.mock.lastCall?.[1]).toBe(profiles)
    expect(dispatch.received.mock.lastCall?.[0].tools[0].parameters).toBe(parameters)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'adapter-tools', toolCount: 1, deferredToolCount: 0 }))
  })

  it('does not invent tools or change requests without deferred declarations', async () => {
    const { adapter, profiles, log } = toolAdapter()
    const options = Object.freeze({ provider: 'google-antigravity', model: 'gemini-9.2-pro', tools: [] })
    const stream = adapter.streamWithSnapshot(options, profiles)
    const result = await stream.next()
    expect(result.value.request.tools).toBeUndefined()
    expect(result.value.request.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } })
    expect(dispatch.received.mock.lastCall?.[0]).toBe(options)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ toolCount: 0, deferredToolCount: 0 }))
  })

  it('does not let failed instrumentation interfere with dispatch', async () => {
    const { adapter, profiles } = toolAdapter(() => { throw new Error('diagnostic failure') })
    await expect(adapter.streamWithSnapshot({ provider: 'google-antigravity', model: 'gemini-9.2-pro' }, profiles).next()).resolves.toMatchObject({ done: false })
  })
  it('leaves deferred-tool admission to DSH instead of enabling additional tools', async () => {
    const { adapter, profiles } = toolAdapter()
    const tool = Object.freeze({ name: 'bash', description: '', parameters: {}, deferLoading: true })
    const options = Object.freeze({ provider: 'google-antigravity', model: 'gemini-9.2-pro', tools: [tool] })
    const result = await adapter.streamWithSnapshot(options, profiles).next()
    expect(result.value.request.tools).toBeUndefined()
    expect(dispatch.received.mock.lastCall?.[0]).toBe(options)
    expect(tool.deferLoading).toBe(true)
  })
})
