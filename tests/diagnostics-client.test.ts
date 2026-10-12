import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyDiagnosticLogs, pollDiagnosticLogs } from '../src/client/diagnostics.ts'
import type { DiagnosticSnapshot } from '../src/diagnostics-format.ts'

const state: DiagnosticSnapshot = { enabled: true, version: '0.1.1', limit: 200, entries: [] }
afterEach(() => vi.useRealTimers())
describe('diagnostic panel polling and clipboard', () => {
  it('polls while enabled, stops on disable and cancels on cleanup', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockResolvedValueOnce(state).mockResolvedValue({ ...state, enabled: false })
    const onState = vi.fn(), onError = vi.fn()
    const stop = pollDiagnosticLogs(load, onState, onError)
    await vi.advanceTimersByTimeAsync(0)
    expect(onState).toHaveBeenCalledWith(state)
    await vi.advanceTimersByTimeAsync(3000)
    expect(load).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(9000)
    expect(load).toHaveBeenCalledTimes(2)
    stop()
    expect((load.mock.calls[0]![0] as AbortSignal).aborted).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })
  it('does not overlap requests or update after unmount', async () => {
    vi.useFakeTimers()
    let resolve!: (value: DiagnosticSnapshot) => void
    const load = vi.fn(() => new Promise<DiagnosticSnapshot>((done) => { resolve = done }))
    const onState = vi.fn(), onError = vi.fn()
    const stop = pollDiagnosticLogs(load, onState, onError, true)
    await vi.advanceTimersByTimeAsync(9000)
    expect(load).toHaveBeenCalledOnce()
    stop()
    resolve(state)
    await vi.advanceTimersByTimeAsync(9000)
    expect(onState).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledOnce()
  })
  it('shows query failures and continues only if previously enabled', async () => {
    vi.useFakeTimers()
    const load = vi.fn().mockRejectedValue(new Error('offline'))
    const onError = vi.fn()
    const stop = pollDiagnosticLogs(load, vi.fn(), onError, true)
    await vi.advanceTimersByTimeAsync(3000)
    expect(onError).toHaveBeenCalledTimes(2)
    stop()
    await vi.advanceTimersByTimeAsync(9000)
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('copies the report and provides a manual-copy error when unavailable or denied', async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    await copyDiagnosticLogs(state, clipboard)
    expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('dsh-agy 0.1.1'))
    await expect(copyDiagnosticLogs(state)).rejects.toThrow('manualmente')
    clipboard.writeText.mockRejectedValueOnce(new Error('denied'))
    await expect(copyDiagnosticLogs(state, clipboard)).rejects.toThrow('manualmente')
  })
})
