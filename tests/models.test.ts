import { describe, expect, it } from 'vitest'
import { PROVIDER, parseAvailableModels, parseModelCatalog, selectModelRoute, withLegacyAliases } from '../src/models.ts'
import { buildEnvelope } from '../src/api.ts'

describe('dynamic model grouping and effort routing', () => {
  it('discovers new versions with one entry per model, not per variant', () => {
    const payload = { models: {
      'gemini-9.2-flash-low': { displayName: 'Gemini 9.2 Flash (Low)' },
      'gemini-9.2-flash-medium': { displayName: 'Gemini 9.2 Flash (Medium)' },
      'gemini-9.2-flash-high': { displayName: 'Gemini 9.2 Flash (High)' },
      'gemini-9.1-pro-high': {}, 'gemini-9.1-pro-low': {},
      'claude-sonnet-7-2': {}, 'claude-sonnet-7-2-thinking': { maxOutputTokens: 64000 },
      'gpt-oss-240b-medium': {},
    } }
    const before = JSON.stringify(payload)
    const models = parseAvailableModels(payload)
    expect(models).toHaveLength(4)
    expect(models.find((model) => model.id === 'gpt-oss-240b')?.name).toBe('GPT-OSS 240B')
    const flash = models.find((model) => model.id === 'gemini-9.2-flash')!
    expect(flash.name).toBe('Gemini 9.2 Flash')
    expect(flash.provider).toBe(PROVIDER)
    expect(flash.thinkingLevelMap).toEqual({ off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null })
    expect(selectModelRoute(flash, 'low')).toEqual({ id: 'gemini-9.2-flash-low', thinking: { includeThoughts: true, thinkingLevel: 'low' } })
    expect(selectModelRoute(flash).id).toBe('gemini-9.2-flash-medium')
    const pro = models.find((model) => model.id === 'gemini-9.1-pro')!
    expect(pro.thinkingLevelMap?.medium).toBeNull()
    expect(() => selectModelRoute(pro, 'medium')).toThrow('does not offer effort')
    expect(JSON.stringify(payload)).toBe(before)
  })

  it('does not merge different identities merely because names match', () => {
    const models = parseAvailableModels({ models: { 'gemini-4.1-flash-high': { displayName: 'Same' }, 'gemini-4.2-flash-high': { displayName: 'Same' } } })
    expect(models).toHaveLength(2)
    expect(new Set(models.map((model) => model.name)).size).toBe(2)
    expect(models.map((model) => model.name)).toEqual(['Gemini 4.2 Flash', 'Gemini 4.1 Flash'])
  })

  it('groups the reviewed shared Flash route without visual duplicates', () => {
    const models = parseAvailableModels({ models: { 'gemini-3-flash-agent': { displayName: 'Gemini 3.5 Flash (High)' }, 'gemini-3.5-flash-low': {} } })
    expect(models).toHaveLength(1)
    expect(models[0]!.name).toBe('Gemini 3.5 Flash')
    expect(selectModelRoute(models[0]!, 'medium')).toEqual({ id: 'gemini-3-flash-agent', thinking: { includeThoughts: true, thinkingLevel: 'medium' } })
    expect(selectModelRoute(models[0]!, 'high').id).toBe('gemini-3-flash-agent')
    expect(selectModelRoute(models[0]!, 'low').id).toBe('gemini-3.5-flash-low')
  })

  it('uses metadata limits/modalities conservatively across variants', () => {
    const models = parseAvailableModels({ models: {
      'gemini-5.1-flash-low': { contextWindow: 1000000, maxOutputTokens: 64000, supportsImages: true },
      'gemini-5.1-flash-high': { contextWindow: 500000, maxOutputTokens: 32000, supportsImages: false },
    } })
    expect(models[0]).toMatchObject({ contextWindow: 500000, maxTokens: 32000, input: ['text'] })
    const bare = parseAvailableModels({ models: { 'gemini-5.2-flash': { supportsThinking: true } } })[0]!
    expect(bare.reasoning).toBe(false) // A boolean is not an advertised effort list.
    expect(selectModelRoute(bare).id).toBe(bare.id)
    expect(() => selectModelRoute(bare, 'high')).toThrow()
  })

  it('keeps legacy aliases for resolution with their original effort default', () => {
    const visible = parseAvailableModels({ models: { 'gemini-4.1-flash-low': {}, 'gemini-4.1-flash-high': {} } })
    const all = withLegacyAliases(visible)
    expect(visible.map((model) => model.id)).toEqual(['gemini-4.1-flash'])
    expect(all).toHaveLength(3)
    const low = all.find((model) => model.id === 'gemini-4.1-flash-low')!
    expect(selectModelRoute(low).id).toBe('gemini-4.1-flash-low')
    expect(low.thinkingLevelMap?.high).toBeNull()
  })

  it('changes the actual Gemini payload when effort changes', () => {
    const model = parseAvailableModels({ models: { 'gemini-4.1-flash-low': {}, 'gemini-4.1-flash-high': {} } })[0]!
    const low = buildEnvelope(model, { messages: [] }, { reasoning: 'low' }, 'p')
    const high = buildEnvelope(model, { messages: [] }, { reasoning: 'high' }, 'p')
    expect(low.model).toBe('gemini-4.1-flash-low')
    expect(high.model).toBe('gemini-4.1-flash-high')
    expect(high.request).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: 'high' } } })
  })

  it.each([undefined, []])('disables undeclared function calls when tools are absent (%s)', (tools) => {
    const model = parseAvailableModels({ models: { 'gemini-9.2-flash-high': {} } })[0]!
    const envelope = buildEnvelope(model, { systemPrompt: 'Use bash if needed.', messages: [], tools }, {}, 'p')
    expect(envelope.request).toMatchObject({ toolConfig: { functionCallingConfig: { mode: 'NONE' } } })
    expect((envelope.request as any).tools).toBeUndefined()
  })

  it('routes Claude thinking via budgets and off via the plain route', () => {
    const model = parseAvailableModels({ models: { 'claude-sonnet-5-1-thinking': { maxOutputTokens: 64000 }, 'claude-sonnet-5-1': { maxOutputTokens: 64000 } } })[0]!
    expect(model.name).toBe('Claude Sonnet 5.1')
    expect(selectModelRoute(model, 'off')).toEqual({ id: 'claude-sonnet-5-1' })
    expect(selectModelRoute(model)).toEqual({ id: 'claude-sonnet-5-1' }) // DSH omits reasoning for Off.
    const high = buildEnvelope(model, { messages: [] }, { reasoning: 'high' }, 'p')
    expect(high.model).toBe('claude-sonnet-5-1-thinking')
    expect(high.request).toMatchObject({ generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 32768 } } })
    expect(buildEnvelope(model, { messages: [] }, { reasoning: 'high', maxTokens: 1024 }, 'p').request).toMatchObject({ generationConfig: { thinkingConfig: { thinkingBudget: 1023 } } })
  })

  it('ignores unsupported families and validates the catalog shape', () => {
    const parsed = parseModelCatalog({ models: { unknown: {}, 'gemini-5-image': {}, 'gemini-5-flash-high': {}, 'gemini-5-pro-low': null } })
    expect(parsed.models).toHaveLength(1)
    expect(parsed.ignoredCount).toBe(3)
    expect(parseAvailableModels({ models: {} })).toEqual([])
    for (const invalid of [{}, null, { models: [] }]) expect(() => parseAvailableModels(invalid)).toThrow('models object')
  })
})
