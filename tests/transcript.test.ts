import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModels, createProvider, normalizeContext } from '@earendil-works/pi-ai'
import type { Context, Tool } from '@earendil-works/pi-ai'
import { buildEnvelope, createAntiGravityApi } from '../src/api.ts'
import { parseAvailableModels } from '../src/models.ts'
import { inferenceScope } from '../src/inference-scope.ts'

const model = parseAvailableModels({ models: { 'gemini-3.8-flash-high': { maxTokens: 1048576, maxOutputTokens: 65536 } } })[0]!
const bash: Tool = { name: 'bash', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }
afterEach(() => vi.unstubAllGlobals())

describe('pi-ai 1.x transcript integration', () => {
  it('recovers tools and the system prompt after the real Models normalizer', async () => {
    const reportLog = vi.fn()
    const api = createAntiGravityApi({ afterRateLimit: async () => undefined, reportRateLimit() {}, reportSuccess() {}, reportLog })
    const provider = createProvider({ id: model.provider, models: [model], api,
      auth: { apiKey: { name: 'Test override', resolve: async ({ credential }) => credential ? { auth: { apiKey: credential.key }, source: 'test' } : undefined } } })
    const models = createModels()
    models.setProvider(provider)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ functionCall: { name: 'bash', args: { command: 'pwd' } } }] }, finishReason: 'STOP' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })))
    const context: Context = { systemPrompt: 'You are a test assistant.', tools: [bash], messages: [{ role: 'user', content: 'Show the directory', timestamp: 0 }] }
    expect(normalizeContext(context)).not.toHaveProperty('tools') // Regression: the old code read this field.
    const result = await inferenceScope.run('agent-integration', () => models.streamSimple(model, context, { apiKey: JSON.stringify({ token: 'private-token', projectId: 'p', accountId: 'a' }), reasoning: 'high' }).result())
    expect(result.errorMessage).toBeUndefined()
    expect(result.content[0]).toMatchObject({ type: 'toolCall', name: 'bash', arguments: { command: 'pwd' } })
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body.request.systemInstruction.parts[0].text).toBe(context.systemPrompt)
    expect(body.request.tools[0].functionDeclarations[0].name).toBe('bash')
    expect(body.request.generationConfig.maxOutputTokens).toBe(65536)
    expect(body.request.toolConfig).toBeUndefined()
    expect(reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'request-start', requestId: 'agent-integration', toolCount: 1 }))
    expect(reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'request-built', requestId: 'agent-integration', toolCount: 1 }))
    expect(JSON.stringify(reportLog.mock.calls)).not.toContain('private-token')
  })

  it('folds additions, removals, replacements and system sections without mutation', () => {
    const replacement = { ...bash, description: 'Updated declaration' }
    const context: Context = { messages: [
      { role: 'system', content: 'Initial prompt', toolsAdded: [bash, { ...bash, name: 'removed' }], sections: { policy: 'old policy', obsolete: 'remove this' }, timestamp: 0 },
      { role: 'user', content: 'Hello', timestamp: 1 },
      { role: 'system', content: 'Later instructions', toolsRemoved: [{ name: 'removed' }], toolsAdded: [replacement], sections: { policy: 'current policy', obsolete: null }, timestamp: 2 },
    ] }
    const before = JSON.stringify(context)
    const envelope = buildEnvelope(model, normalizeContext(context), {}, 'p')
    const request = envelope.request as any
    expect(request.tools[0].functionDeclarations).toHaveLength(1)
    expect(request.tools[0].functionDeclarations[0].description).toBe('Updated declaration')
    const prompt = request.systemInstruction.parts[0].text
    expect(prompt).toContain('Initial prompt')
    expect(prompt).toContain('Later instructions')
    expect(prompt).toContain('current policy')
    expect(prompt).not.toContain('old policy')
    expect(prompt).not.toContain('remove this')
    expect(request.contents).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }])
    expect(JSON.stringify(context)).toBe(before)
  })

  it('uses NONE only after resolving tool removals, and validates route output limits', () => {
    const transcript = normalizeContext({ tools: [bash], messages: [{ role: 'system', content: '', toolsRemoved: [{ name: 'bash' }], timestamp: 0 }] })
    expect(buildEnvelope(model, transcript, {}, 'p').request).toMatchObject({ toolConfig: { functionCallingConfig: { mode: 'NONE' } } })
    expect(() => buildEnvelope(model, transcript, { maxTokens: 65537 }, 'p')).toThrow('between 1 and 65536')
    expect(() => buildEnvelope(model, transcript, { maxTokens: 0 }, 'p')).toThrow()
  })
})
