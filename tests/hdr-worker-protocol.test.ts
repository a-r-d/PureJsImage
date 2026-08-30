import { describe, expect, it } from 'vitest'
import {
  isHdrSurgeryRequest,
  isHdrSurgeryResponse,
} from '../docs-astro/src/scripts/hdr-surgery-types.ts'

describe('HDR Surgery worker protocol', () => {
  it('accepts the closed request schema and rejects extra or malformed fields', () => {
    expect(
      isHdrSurgeryRequest({
        type: 'open',
        requestId: 1,
        generation: 2,
        name: 'sample.jpg',
        bytes: new ArrayBuffer(8),
        displayBoost: 4,
        operations: [],
      }),
    ).toBe(true)
    expect(
      isHdrSurgeryRequest({
        type: 'render',
        requestId: 2,
        generation: 2,
        displayBoost: Number.NaN,
        operations: [],
      }),
    ).toBe(false)
    expect(
      isHdrSurgeryRequest({
        type: 'render',
        requestId: 3,
        generation: 2,
        displayBoost: 2,
        operations: [
          { type: 'crop', x: 1, y: 2, width: 30, height: 20 },
          { type: 'rotate', degrees: 90 },
          { type: 'resize', width: 20, height: 30, kernel: 'lanczos3' },
        ],
      }),
    ).toBe(true)
    expect(
      isHdrSurgeryRequest({
        type: 'cancel',
        requestId: 3,
        generation: 2,
        trusted: true,
      }),
    ).toBe(false)
  })

  it('rejects stale-shape responses before UI code reads them', () => {
    expect(
      isHdrSurgeryResponse({
        type: 'repacked',
        requestId: 4,
        generation: 2,
        bytes: new ArrayBuffer(4),
        metadataMode: 'dual',
      }),
    ).toBe(true)
    expect(
      isHdrSurgeryResponse({
        type: 'error',
        requestId: 4,
        generation: 2,
        message: 'bad input',
        cancelled: false,
        stack: 'private',
      }),
    ).toBe(false)
  })
})
