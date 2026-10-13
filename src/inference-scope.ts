/** Correlate a frozen Harness call with its lazy pi-ai stream, without headers. */
import { AsyncLocalStorage } from 'node:async_hooks'

export const inferenceScope = new AsyncLocalStorage<string>()

export async function* scopedStream<T>(requestId: string, source: AsyncGenerator<T>): AsyncGenerator<T> {
  try {
    while (true) {
      const next = await inferenceScope.run(requestId, () => source.next())
      if (next.done) return next.value
      yield next.value
    }
  } finally {
    await inferenceScope.run(requestId, () => source.return(undefined as never))
  }
}
