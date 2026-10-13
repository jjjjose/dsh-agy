import { describe, expect, it } from 'vitest'
import { inferenceScope, scopedStream } from '../src/inference-scope.ts'

describe('lazy call correlation', () => {
  it('isolates interleaved prepared streams and closes them in the same scope', async () => {
    const closed: string[] = []
    async function* source() {
      try {
        await Promise.resolve()
        yield inferenceScope.getStore()
        await Promise.resolve()
        yield inferenceScope.getStore()
      } finally { closed.push(inferenceScope.getStore()!) }
    }
    const first = scopedStream('agent-a', source())
    const second = scopedStream('agent-b', source())
    const initial = await Promise.all([first.next(), second.next()])
    expect(initial.map((next) => next.value)).toEqual(['agent-a', 'agent-b'])
    expect((await first.next()).value).toBe('agent-a')
    await second.return(undefined)
    await first.return(undefined)
    expect(closed).toEqual(['agent-b', 'agent-a'])
    expect(inferenceScope.getStore()).toBeUndefined()
  })
})
