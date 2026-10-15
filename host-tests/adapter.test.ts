import { afterEach, expect, it, vi } from 'vitest'
import { createProvider, defaultProviderAuthContext, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { AntigravityAdapter } from '../src/model-adapter.ts'
import { createAntiGravityApi } from '../src/api.ts'
import { parseAvailableModels, PROVIDER } from '../src/models.ts'

afterEach(() => vi.unstubAllGlobals())

it.each(['direct', 'prepared'])('streams eight isolated calls through the real DSH adapter (%s)', async (mode) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })))
  const models = parseAvailableModels({ models: { 'gemini-4-argon': {} } })
  const release = vi.fn()
  const provider = createProvider({ id: PROVIDER, models,
    auth: { apiKey: { name: 'test', resolve: async () => ({ auth: { apiKey: 'managed' }, source: 'test' }) } },
    api: createAntiGravityApi({
      acquireRequest: async (_model, options) => ({ auth: { token: 'test', projectId: 'test', accountId: 'test' }, release, signal: options.signal! }),
      afterRateLimit: async () => undefined, reportRateLimit() {}, reportSuccess() {},
    }),
  })
  const profile = { provider: PROVIDER, displayName: PROVIDER, piProvider: provider, streamIdleTimeoutMs: 5000,
    maxRequestImageBytes: 1000, requestImagePixelBudget: 1000, requestImageMaxBytes: 1000,
    retryPolicy: resolveRetryPolicy(undefined, 'host-test'), configuredMaxTokens: new Map(), modelErrors: new Map() }
  const adapter = new AntigravityAdapter({ profiles: () => new Map([[PROVIDER, profile]]), resolveApiKey: async () => 'managed',
    auth: { credentials: new InMemoryCredentialStore(), authContext: defaultProviderAuthContext() },
  }, () => new Set(models.map((model) => model.id)))
  expect((await adapter.listModels(PROVIDER)).map((model) => model.id)).toEqual(['gemini-4-argon'])
  const outputs = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const chunks = []
    const request = { provider: PROVIDER, model: 'gemini-4-argon', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: `child-${index}` }] }] }
    const stream = mode === 'direct' ? adapter.stream(request) : (await adapter.prepareCall(PROVIDER, 'gemini-4-argon')).stream(request)
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }))
  for (const chunks of outputs) {
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.findIndex((chunk) => chunk.type === 'usage')).toBeLessThan(chunks.length - 1)
  }
  expect(release).toHaveBeenCalledTimes(8)
  const requests = vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(options!.body as string))
  expect(new Set(requests.map((request) => request.requestId)).size).toBe(8)
  expect(requests.map((request) => request.request.contents[0].parts[0].text).sort()).toEqual(Array.from({ length: 8 }, (_, index) => `child-${index}`))
})
