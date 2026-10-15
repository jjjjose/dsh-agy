import { describe, expect, it } from 'vitest'
import { cleanContents, cleanSchema } from '../src/transport-transform.ts'

describe('transport schema normalization', () => {
  it('preserves schedule_create oneOf alternatives as anyOf', () => {
    expect(cleanSchema({ oneOf: [{ type: 'string' }, { type: 'object', properties: { date: { type: 'string' }, time: { type: 'string' }, time_zone: { type: 'string' } }, required: ['date', 'time', 'time_zone'] }] }, true)).toEqual({
      anyOf: [{ type: 'STRING' }, { type: 'OBJECT', properties: { date: { type: 'STRING' }, time: { type: 'STRING' }, time_zone: { type: 'STRING' } }, required: ['date', 'time', 'time_zone'] }],
    })
  })
  it('normalizes nullable types and nullable union branches', () => {
    expect(cleanSchema({ type: ['string', 'null'] }, true)).toEqual({ type: 'STRING', nullable: true })
    expect(cleanSchema({ anyOf: [{ type: 'integer' }, { type: 'null' }] })).toEqual({ type: 'integer', nullable: true })
  })
  it('resolves nested local references before stripping definitions', () => {
    const schema = { $defs: { 'a/b': { type: 'object', properties: { value: { type: 'string' } } } }, type: 'object', properties: { item: { $ref: '#/$defs/a~1b', description: 'An item' } } }
    const before = JSON.stringify(schema)
    expect(cleanSchema(schema, true)).toEqual({ type: 'OBJECT', properties: { item: { type: 'OBJECT', properties: { value: { type: 'STRING' } }, description: 'An item' } } })
    expect(JSON.stringify(schema)).toBe(before)
  })
  it('rejects unsupported and recursive schemas with their location', () => {
    expect(() => cleanSchema({ properties: { item: { allOf: [{ type: 'string' }] } } })).toThrow('#/properties/item')
    expect(() => cleanSchema({ $defs: { node: { $ref: '#/$defs/node' } }, $ref: '#/$defs/node' })).toThrow('recursive')
    expect(() => cleanSchema({ $ref: '#/$defs/missing' })).toThrow('unresolved')
    expect(() => cleanSchema({ $ref: 'https://example.com/schema' })).toThrow('only local')
    expect(() => cleanSchema({ type: 'null' })).toThrow('null-only')
    expect(() => cleanSchema({ type: ['string'], anyOf: [{ type: 'integer' }] })).toThrow('combined type unions')
  })
  it('adds missing array items and filters invalid required properties recursively', () => {
    expect(cleanSchema({ type: 'object', properties: { paths: { type: 'array' } }, required: ['paths', 'missing'] }, true)).toEqual({
      type: 'OBJECT', properties: { paths: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['paths'],
    })
  })
})

describe('transport history recovery', () => {
  it.each([false, true])('preserves split out-of-order subagent results (Claude=%s)', (claude) => {
    const calls = { role: 'model', parts: ['a', 'b'].map((id) => ({ functionCall: { id, name: 'subagent', args: { prompt: id } } })) }
    const results = ['b', 'a'].map((id) => ({ functionResponse: { id, name: 'subagent', response: { output: id } } }))
    const input = [calls, ...results.map((part) => ({ role: 'user', parts: [part] }))]
    expect(cleanContents(input, claude)).toEqual([calls, { role: 'user', parts: results }])
    expect(input).toHaveLength(3)
  })

  it('preserves successful and error results without inventing Gemini IDs', () => {
    const contents = [
      { role: 'model', parts: [{ functionCall: { name: 'glob', args: {} }, thoughtSignature: 'c2ln' }, { functionCall: { name: 'read', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'glob', response: { output: 'a.ts' } } }, { functionResponse: { name: 'read', response: { error: 'not found' } } }] },
    ]
    expect(cleanContents(contents, false)).toEqual(contents)
  })

  it('recovers missing results before the next user turn', () => {
    expect(cleanContents([
      { role: 'model', parts: [{ functionCall: { name: 'glob', args: {} } }] },
      { role: 'user', parts: [{ text: 'continue' }] },
    ], false)).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'glob', args: {} } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'glob', response: { error: 'Tool execution was interrupted before a result was recorded.' } } }, { text: 'continue' }] },
    ])
  })

  it('matches out-of-order Claude results by ID and removes thinking signatures', () => {
    expect(cleanContents([
      { role: 'model', parts: [{ thought: true, text: 'private', thoughtSignature: 'c2ln' }, { functionCall: { id: 'a', name: 'read', args: { path: 'a' } }, thoughtSignature: 'c2ln' }, { functionCall: { id: 'b', name: 'read', args: { path: 'b' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'b', name: 'read', response: { output: 'b' } } }, { functionResponse: { id: 'a', name: 'read', response: { output: 'a' } } }] },
    ], true)).toEqual([
      { role: 'model', parts: [{ functionCall: { id: 'a', name: 'read', args: { path: 'a' } } }, { functionCall: { id: 'b', name: 'read', args: { path: 'b' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'b', name: 'read', response: { output: 'b' } } }, { functionResponse: { id: 'a', name: 'read', response: { output: 'a' } } }] },
    ])
  })
})
