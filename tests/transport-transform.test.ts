import { describe, expect, it } from 'vitest'
import { cleanContents, cleanSchema } from '../src/transport-transform.ts'

describe('transport schema normalization', () => {
  it('adds missing array items and filters invalid required properties recursively', () => {
    expect(cleanSchema({ type: 'object', properties: { paths: { type: 'array' } }, required: ['paths', 'missing'] }, true)).toEqual({
      type: 'OBJECT', properties: { paths: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['paths'],
    })
  })
})

describe('transport history recovery', () => {
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
