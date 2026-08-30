import { describe, expect, it } from 'vitest'

import { isOmeZarrWorkerRequest } from '../docs-astro/src/scripts/ome-zarr-types.ts'

describe('OME-Zarr worker request validation', () => {
  it('accepts versioned closed control messages', () => {
    expect(isOmeZarrWorkerRequest({ type: 'reset', epoch: 2 })).toBe(true)
    expect(isOmeZarrWorkerRequest({ type: 'stats', epoch: 1 })).toBe(true)
    expect(isOmeZarrWorkerRequest({ type: 'cancel', epoch: 1, requestId: 7 })).toBe(true)
    expect(
      isOmeZarrWorkerRequest({
        type: 'tile',
        epoch: 3,
        requestId: 1,
        generation: 2,
        level: 0,
        column: 4,
        row: 5,
      }),
    ).toBe(true)
  })

  it('rejects unversioned, open, and malformed messages', () => {
    expect(isOmeZarrWorkerRequest({ type: 'reset' })).toBe(false)
    expect(isOmeZarrWorkerRequest({ type: 'reset', epoch: 0 })).toBe(false)
    expect(isOmeZarrWorkerRequest({ type: 'stats', epoch: 1, extra: true })).toBe(false)
    expect(
      isOmeZarrWorkerRequest({
        type: 'tile',
        epoch: 1,
        requestId: 1,
        generation: 1,
        level: -1,
        column: 0,
        row: 0,
      }),
    ).toBe(false)
    expect(isOmeZarrWorkerRequest({ type: 'other', epoch: 1 })).toBe(false)
  })
})
