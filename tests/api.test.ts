import { describe, expect, it } from 'vitest'
import { buildEnvelope, parseRequestAuth } from '../src/api.ts'
import { maintainedModels } from '../src/models.ts'
import type { Model } from '@earendil-works/pi-ai'
import type { AntiGravityApi } from '../src/models.ts'

const model = maintainedModels.find((m) => m.id === 'gemini-3.8-flash-high') as Model<AntiGravityApi>

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
    expect(request.generationConfig).toEqual({ temperature: 0.4, maxOutputTokens: 128 })
  })
})
