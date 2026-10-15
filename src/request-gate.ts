/** FIFO admission with independent cancellation and bounded queue time. */
export class RequestGate {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('maxConcurrentRequests must be a positive integer')
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = this.waiters.indexOf(admit)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(signal.reason)
      }
      const admit = () => {
        signal.removeEventListener('abort', abort)
        this.active++
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active--
          this.waiters.shift()?.()
        })
      }
      if (this.active < this.limit) admit()
      else {
        this.waiters.push(admit)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }
}

/** Stop waiting without cancelling a refresh shared by other callers. */
export function waitForRequest<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}
