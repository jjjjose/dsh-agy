import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEnvelope, streamAntiGravity } from './api.ts'
import { parseAvailableModels, withLegacyAliases } from './models.ts'
import { cleanContents, cleanSchema, readSse, responseFailure } from './transport-transform.ts'

afterEach(() => vi.unstubAllGlobals())
const maintainedModels = withLegacyAliases(parseAvailableModels({ models: {
  'gemini-3.1-pro-high': {}, 'claude-opus-4-6-thinking': { maxOutputTokens: 64000 },
} }))
const model = maintainedModels.find((item) => item.id === 'gemini-3.1-pro-high')!
const context = { messages: [{ role: 'user' as const, content: 'hello', timestamp: 0 }] }
const event = JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } })

describe('Antigravity transport', () => {
  it('strips Claude thinking before conversion, including foreign-model reasoning', () => {
    const claude = maintainedModels.find((item) => item.id.startsWith('claude-'))!
    const envelope = buildEnvelope(claude, { messages: [{ role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: [{ type: 'thinking', thinking: 'private', thinkingSignature: 'abcd' }, { type: 'text', text: 'visible' }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 0,
    }] }, {}, 'p')
    expect(JSON.stringify(envelope)).not.toContain('private')
    expect(JSON.stringify(envelope)).toContain('visible')
  })

  it('pairs repeated tool names and drops orphan responses', () => {
    const result = cleanContents([
      { role: 'model', parts: [{ functionCall: { name: 'read' } }, { functionCall: { name: 'read' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read' } }, { functionResponse: { name: 'read' } }, { functionResponse: { name: 'orphan' } }] },
    ], true) as Array<{ parts: unknown[] }>
    expect(result[1]!.parts).toHaveLength(2)
  })
  it('closes interrupted tool turns with synthetic results', () => {
    const result = cleanContents([{ role: 'model', parts: [{ functionCall: { id: 'call', name: 'read', args: {} } }] }], false)
    expect(result).toMatchObject([
      { role: 'model' },
      { role: 'user', parts: [{ functionResponse: { id: 'call', name: 'read', response: { error: expect.any(String) } } }] },
    ])
  })
  it('does not relabel a result with an unknown ID onto another call', () => {
    const result = cleanContents([
      { role: 'model', parts: [{ functionCall: { id: 'original', name: 'read' } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'compacted', name: 'read', response: {} } }] },
    ], true)
    expect(result).toMatchObject([{ role: 'model' }, { parts: [{ functionResponse: { id: 'original', name: 'read', response: { error: expect.any(String) } } }] }])
  })
  it('preserves MAX_TOKENS when a response also includes a tool call', async () => {
    const frame = { response: { candidates: [{ content: { parts: [{ functionCall: { name: 'subagent', args: { prompt: 'work' } } }] }, finishReason: 'MAX_TOKENS' }] } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(frame)}\n\n`)))
    const provider = { reportRateLimit: vi.fn(), reportSuccess: vi.fn(), afterRateLimit: vi.fn() }
    const result = await streamAntiGravity(model, context, { apiKey: JSON.stringify({ token: 'a', projectId: 'p', accountId: 'a' }) }, provider).result()
    expect(result.stopReason).toBe('length')
  })
  it('returns quota failure to DSH without a hidden second inference attempt', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"retryDelay":"3s"}]}}', { status: 429 }))
      .mockResolvedValueOnce(new Response(`data: ${event}\r\n\r\ndata: [DONE]\r\n\r\n`))
    vi.stubGlobal('fetch', fetcher)
    const provider = { reportRateLimit: vi.fn(), reportSuccess: vi.fn(), reportLog: vi.fn(), afterRateLimit: vi.fn().mockResolvedValue({ token: 'b', projectId: 'second', accountId: 'b' }) }
    const onPayload = vi.fn()
    const stream = streamAntiGravity(model, context, { apiKey: JSON.stringify({ token: 'a', projectId: 'first', accountId: 'a' }), onPayload }, provider)
    const result = await stream.result()
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('HTTP 429')
    expect(provider.reportRateLimit).toHaveBeenCalledWith('a', 3000)
    expect(onPayload).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(provider.afterRateLimit).not.toHaveBeenCalled()
    expect(provider.reportLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'http-response', status: 429, attempt: 1 }))
  })

  it('does not rotate permission-denied accounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 })))
    const provider = { reportRateLimit: vi.fn(), reportSuccess: vi.fn(), afterRateLimit: vi.fn() }
    const result = await streamAntiGravity(model, context, { apiKey: JSON.stringify({ token: 'a', projectId: 'p', accountId: 'a' }) }, provider).result()
    expect(result.stopReason).toBe('error')
    expect(provider.reportRateLimit).not.toHaveBeenCalled()
  })

  it('uses wire ids for discovery and generation reasoning', () => {
    const envelope = buildEnvelope(model, context, {}, 'p')
    expect(envelope.model).toBe('gemini-3.1-pro-high')
    expect(envelope.request).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } })
    expect(parseAvailableModels({ models: { 'gemini-3.1-pro-high': {}, 'gemini-3.1-pro-low': {} } }).map((item) => item.id)).toEqual(['gemini-3.1-pro'])
    expect(() => parseAvailableModels({ models: null })).toThrow()
  })

  it('sanitizes nested schemas without removing properties named const', () => {
    expect(cleanSchema({ type: 'object', $defs: {}, properties: { const: { const: 'x', additionalProperties: false } } })).toEqual({ type: 'object', properties: { const: { enum: ['x'] } } })
  })

  it('reads split CRLF, multiline events and final unterminated events', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const text of ['data: {\r', '\ndata: "a":1}\r\n\r', '\ndata: final']) controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    } })
    const events: string[] = []
    for await (const text of readSse(body)) events.push(text)
    expect(events).toEqual(['{\n"a":1}', 'final'])
    expect(body.locked).toBe(false)
  })

  it('cancels pending SSE reads when aborted', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const controller = new AbortController()
    const iterator = readSse(body, controller.signal)
    const pending = iterator.next()
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(cancel).toHaveBeenCalled()
    expect(body.locked).toBe(false)
  })

  it('consumes failure bodies and honors retry-after over body delay', async () => {
    const response = new Response('{"retryDelay":"9s"}', { status: 429, headers: { 'retry-after': '2' } })
    expect(await responseFailure(response)).toMatchObject({ rateLimited: true, delay: 2000 })
    expect(response.bodyUsed).toBe(true)
  })
})
