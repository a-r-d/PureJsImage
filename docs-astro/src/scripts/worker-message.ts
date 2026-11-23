// Dedicated-worker messages use an empty origin and a null source. Window-origin
// checks do not apply to this private channel; reject synthetic events as well.
export const isDedicatedWorkerMessage = (
  event: Pick<MessageEvent<unknown>, 'isTrusted' | 'origin' | 'source'>,
): boolean => event.isTrusted && event.origin === '' && event.source === null
