import { describe, expect, it } from 'vitest'
import { PROVIDER, maintainedModels, parseAvailableModels } from '../src/models.ts'

describe('maintainedModels', () => {
  it('exposes the stable provider id', () => {
    expect(PROVIDER).toBe('google-antigravity')
  })

  it('uses Cloud Code Assist request ids with the antigravity api', () => {
    for (const model of maintainedModels) {
      expect(model.api).toBe('google-antigravity')
      expect(model.provider).toBe(PROVIDER)
      expect(model.id.length).toBeGreaterThan(0)
    }
  })

  it('has no duplicate ids', () => {
    const ids = maintainedModels.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes a representative across families', () => {
    const ids = maintainedModels.map((m) => m.id)
    expect(ids).toContain('gemini-3.8-flash-high')
    expect(ids).toContain('claude-sonnet-4-6')
    expect(ids).toContain('gpt-oss-120b-medium')
  })
})

describe('parseAvailableModels', () => {
  it('keeps only models present in the live payload', () => {
    const live = {
      models: {
        'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash' },
        'gpt-oss-120b-medium': {},
      },
    }
    const models = parseAvailableModels(live)
    expect(models.map((m) => m.id)).toEqual(['gemini-3.8-flash-high', 'gpt-oss-120b-medium'])
    expect(models[0]?.name).toBe('Gemini 3.8 Flash')
  })

  it('throws when the payload has no models object', () => {
    expect(() => parseAvailableModels({})).toThrow(/models object/)
    expect(() => parseAvailableModels(null)).toThrow(/models object/)
  })
})
