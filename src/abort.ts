export interface AbortOptions {
  readonly signal?: AbortSignal
}

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  signal?.throwIfAborted()
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
