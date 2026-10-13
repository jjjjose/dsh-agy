import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEnvelope, createAntiGravityApi, parseRequestAuth, streamAntiGravity } from '../src/api.ts'
import { parseAvailableModels, selectModelRoute } from '../src/models.ts'
import { transportModels as maintainedModels } from './fixtures/models.ts'
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
  it('preserves a large MCP-like catalog including unions and local references for both model families', () => {
    const catalog: Tool[] = [...tools,
      { name: 'schedule_create', description: 'Schedule', parameters: { type: 'object', properties: { at: { oneOf: [{ type: 'string' }, { type: 'object', properties: { date: { type: 'string' } }, required: ['date'] }] } } } },
      { name: 'mcp__playwright__browser_emulate_media', description: 'Media', parameters: { type: 'object', properties: { colorScheme: { anyOf: [{ type: 'string', enum: ['light', 'dark'] }, { type: 'null' }] } } } },
      { name: 'referenced', description: 'References', parameters: { $defs: { input: { type: 'string' } }, type: 'object', properties: { query: { $ref: '#/$defs/input' } } } },
      ...Array.from({ length: 130 }, (_, index) => ({ ...tools[1]!, name: `mcp__catalog__tool_${index}` })),
    ]
    const before = JSON.stringify(catalog)
    for (const selected of [model, maintainedModels.find((entry) => entry.id.startsWith('claude-')) as Model<AntiGravityApi>]) {
      const request = buildEnvelope(selected, { messages: [], tools: catalog }, {}, 'p').request as { tools: Array<{ functionDeclarations: Array<{ name: string; parameters: { properties: Record<string, unknown> } }> }> }
      const declarations = request.tools[0]!.functionDeclarations
      expect(declarations.map((entry) => entry.name)).toEqual(catalog.map((entry) => entry.name))
      expect(declarations[2]!.parameters.properties.at).toHaveProperty('anyOf')
      expect(declarations[3]!.parameters.properties.colorScheme).toHaveProperty('nullable', true)
      expect(declarations[4]!.parameters.properties.query).toHaveProperty('type', selected === model ? 'STRING' : 'string')
    }
    expect(JSON.stringify(catalog)).toBe(before)
  })

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
  const provider = () => ({ afterRateLimit: vi.fn(), reportRateLimit: vi.fn(), reportSuccess: vi.fn(), reportError: vi.fn(), reportDiagnostic: vi.fn(), reportLog: vi.fn() })
  const mockResponse = (frames: unknown[]): void => {
    const encoded = new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify({ response: frame })}\n\n`).join('') + 'data: [DONE]\n\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded); controller.close() } }), { status: 200 })))
  }

  it('forwards effort through both stream entry points and logs the resolved wire route', async () => {
    const selected = parseAvailableModels({ models: { 'gemini-9.2-flash-low': {}, 'gemini-9.2-flash-high': {} } })[0]!
    const auth = provider()
    const resolveModel = vi.fn(async (_model, options, credential) => {
      expect(credential.accountId).toBe('a')
      selectModelRoute(selected, options.reasoning)
      return selected
    })
    const api = createAntiGravityApi({ ...auth, resolveModel })
    for (const [entry, effort] of [['stream', 'low'], ['streamSimple', 'high']] as const) {
      mockResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }])
      await api[entry](selected, { messages: [] }, { apiKey: JSON.stringify({ token: 'private-token', accountId: 'a', projectId: 'p' }), reasoning: effort }).result()
      const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
      expect(body.model).toBe(`gemini-9.2-flash-${effort}`)
      expect(body.request.generationConfig.thinkingConfig.thinkingLevel).toBe(effort)
      expect(auth.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'model-resolved', model: 'gemini-9.2-flash', effort, wireModel: body.model }))
    }
    expect(resolveModel).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(auth.reportLog.mock.calls)).not.toContain('private-token')
  })

  it('checks the rotated account before sending inference and never downgrades effort', async () => {
    const selected = parseAvailableModels({ models: { 'gemini-9.2-flash-high': {} } })[0]!
    const incompatible = parseAvailableModels({ models: { 'gemini-9.2-flash-low': {} } })[0]!
    const fetcher = vi.fn().mockResolvedValue(new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }))
    vi.stubGlobal('fetch', fetcher)
    const auth = provider()
    auth.afterRateLimit.mockResolvedValue({ token: 'second', accountId: 'b', projectId: 'b' })
    const resolveModel = vi.fn(async (_model, options, credential) => {
      const current = credential.accountId === 'a' ? selected : incompatible
      selectModelRoute(current, options.reasoning)
      return current
    })
    const message = await streamAntiGravity(selected, { messages: [] }, { apiKey: JSON.stringify({ token: 'first', accountId: 'a', projectId: 'a' }), reasoning: 'high' }, { ...auth, resolveModel }).result()
    expect(message.errorMessage).toContain('does not offer effort high')
    expect(resolveModel).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('switches an incompatible initially selected account without marking it rate-limited', async () => {
    const selected = parseAvailableModels({ models: { 'gemini-9.2-flash-high': {} } })[0]!
    const incompatible = parseAvailableModels({ models: { 'gemini-9.2-flash-low': {} } })[0]!
    mockResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }])
    const auth = provider()
    const afterModelUnavailable = vi.fn(async () => ({ token: 'good', accountId: 'a', projectId: 'a' }))
    const resolveModel = vi.fn(async (_model, options, credential) => {
      const current = credential.accountId === 'a' ? selected : incompatible
      selectModelRoute(current, options.reasoning)
      return current
    })
    const message = await streamAntiGravity(selected, { messages: [] }, { apiKey: JSON.stringify({ token: 'bad', accountId: 'b', projectId: 'b' }), reasoning: 'high' }, { ...auth, resolveModel, afterModelUnavailable }).result()
    expect(message.stopReason).toBe('stop')
    expect(afterModelUnavailable).toHaveBeenCalledOnce()
    expect(auth.reportRateLimit).not.toHaveBeenCalled()
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).model).toBe('gemini-9.2-flash-high')
    expect(auth.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'model-unavailable' }))
  })

  it('reports incompatible schemas before sending a request without storing schema contents', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const auth = provider()
    const message = await streamAntiGravity(model, { messages: [], tools: [{ name: 'bad_tool', description: 'Bad', parameters: { type: 'object', properties: { input: { allOf: [{ type: 'string' }] } } } }] }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p' }) }, auth).result()
    expect(message.errorMessage).toContain('Tool bad_tool: Unsupported tool schema at #/properties/input')
    expect(fetcher).not.toHaveBeenCalled()
    expect(auth.reportDiagnostic).toHaveBeenCalledWith({ model: model.id, kind: 'request-conversion-error', toolCount: 1 })
    expect(auth.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'schema-error', tool: 'bad_tool', schemaPath: '#/properties/input' }))
  })

  it('does not interrupt generation when the logging callback fails', async () => {
    mockResponse([{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }])
    const auth = provider()
    auth.reportLog.mockImplementation(() => { throw new Error('logging unavailable') })
    const message = await streamAntiGravity(model, { messages: [] }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p' }) }, auth).result()
    expect(message.stopReason).toBe('stop')
  })

  it('logs aborts without reporting raw exceptions', async () => {
    const controller = new AbortController()
    controller.abort(new Error('private cancellation text'))
    const auth = provider()
    const message = await streamAntiGravity(model, { messages: [] }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p' }), signal: controller.signal }, auth).result()
    expect(message.stopReason).toBe('aborted')
    expect(auth.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'request-aborted', durationMs: expect.any(Number) }))
    expect(JSON.stringify(auth.reportLog.mock.calls)).not.toContain('private cancellation text')
  })

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
    expect(auth.reportLog.mock.calls.map(([entry]) => entry.event)).toEqual(['request-start', 'model-resolved', 'request-built', 'http-response', 'generation-finish', 'request-complete'])
    const requestId = auth.reportLog.mock.calls[0]![0].requestId
    expect(auth.reportLog.mock.calls.every(([entry]) => entry.requestId === requestId)).toBe(true)
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).requestId).toBe(requestId)
    const calls = message.content.filter((block) => block.type === 'toolCall')
    expect(calls[0]!.thoughtSignature).toBe('c2ln')
    const context: Context = { tools, messages: [message, ...calls.map((call) => ({ role: 'toolResult' as const, toolCallId: call.id, toolName: call.name, content: [{ type: 'text' as const, text: call.name === 'glob' ? 'src/api.ts' : '/repo' }], isError: false, timestamp: 0 }))] }
    const request = buildEnvelope(model, context, {}, 'p').request as { contents: unknown[] }
    expect(request.contents).toEqual([
      { role: 'model', parts: [{ functionCall: { id: calls[0]!.id, name: 'working_directory', args: {} }, thoughtSignature: 'c2ln' }, { functionCall: { id: calls[1]!.id, name: 'glob', args: { pattern: '**/*.ts' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: calls[0]!.id, name: 'working_directory', response: { output: '/repo' } } }, { functionResponse: { id: calls[1]!.id, name: 'glob', response: { output: 'src/api.ts' } } }] },
    ])
  })

  it('keeps usage and diagnostic finishReason on generation errors', async () => {
    mockResponse([{ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'MALFORMED_FUNCTION_CALL', finishMessage: 'Invalid call\nCheck arguments' }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2, thoughtsTokenCount: 3, totalTokenCount: 25 } }])
    const auth = provider()
    const message = await streamAntiGravity(model, { messages: [], tools }, { apiKey: JSON.stringify({ token: 'fake', projectId: 'p', accountId: 'a' }) }, auth).result()
    expect(message.stopReason).toBe('error')
    expect(message.errorMessage).toContain('MALFORMED_FUNCTION_CALL')
    expect(message.errorMessage).toContain('Invalid call Check arguments')
    expect(message.usage).toMatchObject({ input: 20, output: 5, totalTokens: 25 })
    expect(auth.reportDiagnostic).toHaveBeenCalledWith({ model: model.id, finishReason: 'MALFORMED_FUNCTION_CALL', kind: 'generation-finish-error', toolCount: 2 })
    expect(auth.reportSuccess).not.toHaveBeenCalled()
    expect(auth.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'generation-finish', finishReason: 'MALFORMED_FUNCTION_CALL' }))
    expect(auth.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'request-error', durationMs: expect.any(Number) }))
    expect(JSON.stringify(auth.reportLog.mock.calls)).not.toContain('Invalid call')
  })
})
