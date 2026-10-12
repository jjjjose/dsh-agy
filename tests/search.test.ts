import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeSearch } from '../src/search.ts'

afterEach(() => vi.unstubAllGlobals())

describe('independent grounding search', () => {
  it('uses the configured thinking flag and formats sources', async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body))
      expect(payload.project).toBe('project')
      expect(payload.request.generationConfig.thinkingConfig.thinkingBudget).toBe(0)
      expect(payload.request.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }])
      return Response.json({ response: { candidates: [{ content: { parts: [{ text: 'Answer' }] }, groundingMetadata: { groundingChunks: [{ web: { title: 'Source', uri: 'https://example.com' } }] } }] } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const report = await executeSearch({ query: 'question', urls: ['https://example.com'], thinking: false }, 'token', 'project')
    expect(report).toContain('Answer')
    expect(report).toContain('[Source](https://example.com)')
  })
  it('does not retry a cancelled request on another endpoint', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)
    const fetchMock = vi.fn(async () => { throw reason })
    vi.stubGlobal('fetch', fetchMock)
    await expect(executeSearch({ query: 'question' }, 'token', 'project', controller.signal)).rejects.toThrow('cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
