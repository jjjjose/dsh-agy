import { describe, expect, it, vi } from 'vitest'
import { createProvider } from '@earendil-works/pi-ai'
import { parseAvailableModels, withLegacyAliases } from '../src/models.ts'
import { createAntiGravityApi } from '../src/api.ts'

vi.mock('@deepseek-ai/dsh-llm-pi-ai', () => ({
  PiAiAdapter: class {
    constructor(private readonly options: { profiles: () => ReadonlyMap<string, { piProvider: { getModels(): Array<{ id: string; name: string; input: string[] }> } }> }) {}
    async listModels(provider: string) {
      return this.options.profiles().get(provider)!.piProvider.getModels().map((model) => ({ provider, id: model.id, name: model.name, inputModalities: model.input }))
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
