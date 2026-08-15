export interface AbortOptions {
  readonly signal?: AbortSignal
}

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted()
}

/** Wait for shared work without allowing one caller's cancellation to cancel that work. */
export const waitForPromise = <T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> => {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', aborted)
    const aborted = (): void => {
      cleanup()
      reject(signal.reason)
    }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export function combineAbortSignals(
  first: AbortSignal,
  second: AbortSignal | undefined,
): AbortSignal
export function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined
export function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (first === undefined) return second
  if (second === undefined || first === second) return first
  return AbortSignal.any([first, second])
}
