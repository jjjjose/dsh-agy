import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEnvelope, parseRequestAuth, streamAntiGravity } from '../src/api.ts'
import { maintainedModels } from '../src/models.ts'
import type { Context, Model, Tool } from '@earendil-works/pi-ai'
import type { AntiGravityApi } from '../src/models.ts'

const model = maintainedModels.find((m) => m.id === 'gemini-3.8-flash-high') as Model<AntiGravityApi>
const tools: Tool[] = [
  { name: 'working_directory', description: 'Get current working directory', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'glob', description: 'Find paths', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'integer', minimum: 1 } }, required: ['pattern'], additionalProperties: false } },
]
afterEach(() => vi.unstubAllGlobals())

describe('parseRequestAuth', () => {
  it('parses a complete request credential', () => {
    const auth = parseRequestAuth(JSON.stringify({ token: 't', projectId: 'p', accountId: 'a' }))
    expect(auth).toEqual({ token: 't', projectId: 'p', accountId: 'a' })
  })

  it('defaults a missing accountId to empty string', () => {
    const auth = parseRequestAuth(JSON.stringify({ token: 't', projectId: 'p' }))
    expect(auth.accountId).toBe('')
  })

  it('throws when the credential is missing', () => {
    expect(() => parseRequestAuth(undefined)).toThrow(/requires OAuth/)
  })

  it('throws on malformed JSON', () => {
    expect(() => parseRequestAuth('{oops')).toThrow(/invalid/)
  })

  it('throws when projectId is absent', () => {
    expect(() => parseRequestAuth(JSON.stringify({ token: 't' }))).toThrow(/incomplete/)
  })
})

describe('buildEnvelope', () => {
  it('uses protobuf parameters for Gemini tools, including no-argument tools', () => {
    const before = JSON.stringify(tools)
    const request = buildEnvelope(model, { messages: [], tools }, {}, 'p').request as Record<string, unknown>
    expect(request.tools).toEqual([{ functionDeclarations: [
      { name: 'working_directory', description: 'Get current working directory', parameters: { type: 'OBJECT', properties: {} } },
      { name: 'glob', description: 'Find paths', parameters: { type: 'OBJECT', properties: { pattern: { type: 'STRING' }, path: { type: 'STRING' }, limit: { type: 'INTEGER', minimum: 1 } }, required: ['pattern'] } },
    ] }])
    expect(JSON.stringify(request.tools)).not.toContain('parametersJsonSchema')
    expect(JSON.stringify(tools)).toBe(before)
  })

  it('cleans nested schemas without stripping property names or valid constraints', () => {
    const nested: Tool = { name: 'nested', description: 'Nested input', parameters: {
      type: 'object', properties: {
        items: { type: 'array', items: { type: 'object', properties: { const: { type: 'string', const: 'fixed' }, description: { type: 'string' } }, required: ['const', 'missing'], additionalProperties: false } },
        options: { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'integer' }] },
      }, required: ['items'], $schema: 'https://json-schema.org/draft/2020-12/schema',
    } }
    const request = buildEnvelope(model, { messages: [], tools: [nested] }, {}, 'p').request as { tools: Array<{ functionDeclarations: Array<{ parameters: unknown }> }> }
    expect(request.tools[0]!.functionDeclarations[0]!.parameters).toEqual({
      type: 'OBJECT', properties: {
        items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { const: { type: 'STRING', enum: ['fixed'] }, description: { type: 'STRING' } }, required: ['const'] } },
        options: { anyOf: [{ type: 'STRING', enum: ['a', 'b'] }, { type: 'INTEGER' }] },
      }, required: ['items'],
    })
  })

  it('supplies Claude with a nonempty no-argument object schema', () => {
    const claude = maintainedModels.find((entry) => entry.id.startsWith('claude-')) as Model<AntiGravityApi>
    const request = buildEnvelope(claude, { messages: [], tools }, {}, 'p').request as { tools: Array<{ functionDeclarations: Array<{ parameters: unknown }> }> }
    expect(request.tools[0]!.functionDeclarations[0]!.parameters).toEqual({ type: 'object', properties: { _placeholder: { type: 'boolean', description: 'Placeholder. Always pass true.' } }, required: ['_placeholder'] })
  })

  it('normalizes an entirely empty tool schema and omits absent tools', () => {
    const request = buildEnvelope(model, { messages: [], tools: [{ name: 'working_directory', description: 'Directory', parameters: {} }] }, {}, 'p').request as Record<string, unknown>
    expect(request.tools).toEqual([{ functionDeclarations: [{ name: 'working_directory', description: 'Directory', parameters: { type: 'OBJECT', properties: {} } }] }])
    expect((buildEnvelope(model, { messages: [], tools: [] }, {}, 'p').request as Record<string, unknown>).tools).toBeUndefined()
  })

  it('builds the Cloud Code Assist envelope', () => {
    const context = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }] }
    const envelope = buildEnvelope(model, context, {}, 'proj-123')
    expect(envelope.project).toBe('proj-123')
    expect(envelope.model).toBe('gemini-3.8-flash-high')
    expect(envelope.requestType).toBe('agent')
    expect(envelope.userAgent).toBe('antigravity')
    expect(String(envelope.requestId)).toMatch(/^agent-/)
    const request = envelope.request as Record<string, unknown>
    expect(Array.isArray(request.contents)).toBe(true)
  })

  it('injects a system instruction when provided', () => {
    const context = { systemPrompt: 'be terse', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }] }
    const envelope = buildEnvelope(model, context, {}, 'p')
    const request = envelope.request as Record<string, unknown>
    expect(request.systemInstruction).toBeDefined()
  })

  it('carries temperature and maxTokens into generationConfig', () => {
    const context = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }] }
    const envelope = buildEnvelope(model, context, { temperature: 0.4, maxTokens: 128 }, 'p')
    const request = envelope.request as Record<string, unknown>
    expect(request.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 128, thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } })
  })
})

describe('tool transport', () => {
  const provider = () => ({ afterRateLimit: vi.fn(), reportRateLimit: vi.fn(), reportSuccess: vi.fn(), reportError: vi.fn(), reportDiagnostic: vi.fn() })
  const mockResponse = (frames: unknown[]): void => {
    const encoded = new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify({ response: frame })}\n\n`).join('') + 'data: [DONE]\n\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded); controller.close() } }), { status: 200 })))
  }

  it('retains text signatures supplied in a later SSE frame for Gemini history', async () => {
    mockResponse([
      { candidates: [{ content: { parts: [{ text: 'answer' }] } }] },
      { candidates: [{ content: { parts: [{ thoughtSignature: 'c2ln' }] }, finishReason: 'STOP' }] },
    ])
    const message = await streamAntiGravity(model, { messages: [] }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p' }) }, provider()).result()
    expect(message.content).toEqual([{ type: 'text', text: 'answer', textSignature: 'c2ln' }])
    expect((buildEnvelope(model, { messages: [message] }, {}, 'p').request as Record<string, unknown>).contents).toEqual([{ role: 'model', parts: [{ text: 'answer', thoughtSignature: 'c2ln' }] }])
  })

  it('streams parallel calls and replays their signed results in one Gemini user turn', async () => {
    mockResponse([
      { candidates: [{ content: { parts: [{ functionCall: { name: 'working_directory', args: {} }, thoughtSignature: 'c2ln' }, { functionCall: { name: 'glob', args: { pattern: '**/*.ts' } } }] } }] },
      { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 } },
    ])
    const auth = provider()
    const stream = streamAntiGravity(model, { messages: [{ role: 'user', content: 'Inspect the repo', timestamp: 0 }], tools }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p', accountId: 'a' }) }, auth)
    const events: string[] = []
    for await (const event of stream) events.push(event.type)
    const message = await stream.result()
    expect(message.stopReason).toBe('toolUse')
    expect(events.filter((type) => type === 'toolcall_end')).toHaveLength(2)
    expect(message.usage.totalTokens).toBe(30)
    expect(auth.reportSuccess).toHaveBeenCalledWith('a')
    const calls = message.content.filter((block) => block.type === 'toolCall')
    expect(calls[0]!.thoughtSignature).toBe('c2ln')
    const context: Context = { tools, messages: [message, ...calls.map((call) => ({ role: 'toolResult' as const, toolCallId: call.id, toolName: call.name, content: [{ type: 'text' as const, text: call.name === 'glob' ? 'src/api.ts' : '/repo' }], isError: false, timestamp: 0 }))] }
    const request = buildEnvelope(model, context, {}, 'p').request as { contents: unknown[] }
    expect(request.contents).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'working_directory', args: {} }, thoughtSignature: 'c2ln' }, { functionCall: { name: 'glob', args: { pattern: '**/*.ts' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'working_directory', response: { output: '/repo' } } }, { functionResponse: { name: 'glob', response: { output: 'src/api.ts' } } }] },
    ])
  })

  it('keeps usage and diagnostic finishReason on generation errors', async () => {
    mockResponse([{ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'MALFORMED_FUNCTION_CALL' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2, thoughtsTokenCount: 3, totalTokenCount: 25 } }])
    const auth = provider()
    const message = await streamAntiGravity(model, { messages: [], tools }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p', accountId: 'a' }) }, auth).result()
    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toContain('MALFORMED_FUNCTION_CALL')
    expect(message.usage).toMatchObject({ input: 20, output: 5, totalTokens: 25 })
    expect(auth.reportDiagnostic).toHaveBeenCalledWith({ model: model.id, finishReason: 'MALFORMED_FUNCTION_CALL', kind: 'generation-finish-error' })
    expect(auth.reportSuccess).not.toHaveBeenCalled()
  })
})
