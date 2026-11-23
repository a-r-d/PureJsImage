import { describe, expect, it } from 'vitest'
import { isDedicatedWorkerMessage } from '../docs-astro/src/scripts/worker-message.ts'

describe('docs worker message guard', () => {
  it('accepts only browser-delivered dedicated-worker events', () => {
    const event = { isTrusted: true, origin: '', source: null }
    expect(isDedicatedWorkerMessage(event)).toBe(true)
    expect(isDedicatedWorkerMessage({ ...event, isTrusted: false })).toBe(false)
    expect(isDedicatedWorkerMessage({ ...event, origin: 'https://example.com' })).toBe(false)
    const channel = new MessageChannel()
    try {
      expect(isDedicatedWorkerMessage({ ...event, source: channel.port1 })).toBe(false)
    } finally {
      channel.port1.close()
      channel.port2.close()
    }
  })
})
