import { describe, expect, it } from 'vitest'
import {
  isHdrSurgeryRequest,
  isHdrSurgeryResponse,
  planHdrSurgeryPreview,
} from '../docs-astro/src/scripts/hdr-surgery-types.ts'

describe('HDR Surgery worker protocol', () => {
  it('fits a 12 MP logical image into the preview ceiling deterministically', () => {
    expect(planHdrSurgeryPreview({ width: 4000, height: 3000 })).toEqual({
      logicalDimensions: { width: 4000, height: 3000 },
      previewDimensions: { width: 2364, height: 1773 },
      scaled: true,
    })
    expect(planHdrSurgeryPreview({ width: 320, height: 180 })).toEqual({
      logicalDimensions: { width: 320, height: 180 },
      previewDimensions: { width: 320, height: 180 },
      scaled: false,
    })
  })

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
    expect(
      isHdrSurgeryResponse({
        type: 'rendered',
        requestId: 5,
        generation: 2,
        linearRgb: new ArrayBuffer(12),
        previewRgba: new ArrayBuffer(16),
        falseColorRgba: new ArrayBuffer(16),
        report: {},
        inspection: {},
        basePreviewRgba: new ArrayBuffer(16),
        gainPreviewRgba: new ArrayBuffer(4),
        logicalDimensions: { width: 4000, height: 3000 },
        previewDimensions: { width: 2364, height: 1773 },
        previewGainMapDimensions: { width: 591, height: 443 },
        previewScaled: true,
      }),
    ).toBe(true)
  })
})
