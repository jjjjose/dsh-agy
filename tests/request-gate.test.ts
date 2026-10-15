import { describe, expect, it } from 'vitest'
import { RequestGate, waitForRequest } from '../src/request-gate.ts'

describe('request admission', () => {
  it('times out queue admission without leaking a slot', async () => {
    const gate = new RequestGate(1)
    const release = await gate.acquire(new AbortController().signal)
    await expect(gate.acquire(AbortSignal.timeout(10))).rejects.toThrow()
    release()
    const next = await gate.acquire(new AbortController().signal)
    next()
  })
  it('bounds eight streams, admits in FIFO order and releases exactly once', async () => {
    const gate = new RequestGate(2)
    const signal = new AbortController().signal
    const first = await gate.acquire(signal)
    const second = await gate.acquire(signal)
    const order: number[] = []
    const waiting = Array.from({ length: 6 }, (_, index) => gate.acquire(signal).then((release) => { order.push(index); return release }))
    await Promise.resolve()
    expect(order).toEqual([])
    first(); first()
    const third = await waiting[0]!
    expect(order).toEqual([0])
    second(); third()
    for (const pending of waiting.slice(1)) (await pending)()
    expect(order).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('removes a cancelled waiter without blocking its sibling', async () => {
    const gate = new RequestGate(1)
    const controller = new AbortController()
    const release = await gate.acquire(new AbortController().signal)
    const cancelled = expect(gate.acquire(controller.signal)).rejects.toThrow('cancelled')
    const sibling = gate.acquire(new AbortController().signal)
    controller.abort(new Error('cancelled'))
    await cancelled
    release()
    ;(await sibling)()
  })

  it('cancels one refresh waiter while the other still receives the token', async () => {
    let complete!: (token: string) => void
    const refresh = new Promise<string>((resolve) => { complete = resolve })
    const controller = new AbortController()
    const cancelled = expect(waitForRequest(refresh, controller.signal)).rejects.toThrow('cancelled')
    const sibling = waitForRequest(refresh, new AbortController().signal)
    controller.abort(new Error('cancelled'))
    await cancelled
    complete('token')
    expect(await sibling).toBe('token')
  })
})
