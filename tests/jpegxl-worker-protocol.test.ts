import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  isJpegXlWorkbenchRequest,
  isJpegXlWorkbenchResponse,
  jpegXlWorkbenchMaximumInputBytes,
  planJpegXlWorkbenchNativeMemory,
  planJpegXlWorkbenchPreview,
} from '../docs-astro/src/scripts/jpegxl-workbench-types.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'

describe('JPEG XL workbench worker protocol', () => {
  it('caps a 12 MP preview without changing logical dimensions', () => {
    expect(planJpegXlWorkbenchPreview(4000, 3000)).toEqual({
      logicalWidth: 4000,
      logicalHeight: 3000,
      width: 2364,
      height: 1773,
      scaled: true,
    })
    expect(planJpegXlWorkbenchPreview(320, 180)).toEqual({
      logicalWidth: 320,
      logicalHeight: 180,
      width: 320,
      height: 180,
      scaled: false,
    })
  })

  it('rejects oversized native materialization before allocating a full raster', () => {
    expect(planJpegXlWorkbenchNativeMemory(4_000, 3_000, 'rgb8')).toMatchObject({
      nativePixelBytes: 36_000_000,
      encoderRetainedBytes: 36_000_000,
      previewBytes: 16_765_488,
      estimatedSimultaneousBytes: expect.any(Number),
    })
    expect(() => planJpegXlWorkbenchNativeMemory(20_000, 20_000, 'rgba16')).toThrow(
      'before pixel allocation',
    )
  })

  it('accepts closed requests and rejects malformed identities, extra keys, and oversized input', () => {
    expect(
      isJpegXlWorkbenchRequest({
        type: 'open',
        requestId: 1,
        generation: 2,
        name: 'sample.jpg',
        bytes: new ArrayBuffer(8),
      }),
    ).toBe(true)
    expect(
      isJpegXlWorkbenchRequest({
        type: 'cancel',
        requestId: 2,
        generation: 2,
      }),
    ).toBe(true)
    expect(
      isJpegXlWorkbenchRequest({
        type: 'cancel',
        requestId: -1,
        generation: 2,
      }),
    ).toBe(false)
    expect(
      isJpegXlWorkbenchRequest({
        type: 'encode',
        requestId: 3,
        generation: 2,
      }),
    ).toBe(true)
    expect(
      isJpegXlWorkbenchRequest({
        type: 'transcode',
        requestId: 4,
        generation: 2,
        onlyIfSmaller: false,
      }),
    ).toBe(true)
    expect(
      isJpegXlWorkbenchRequest({
        type: 'transcode',
        requestId: 4,
        generation: 2,
      }),
    ).toBe(false)
    expect(
      isJpegXlWorkbenchRequest({
        type: 'open',
        requestId: 5,
        generation: 2,
        name: 'too-large.jxl',
        bytes: new ArrayBuffer(jpegXlWorkbenchMaximumInputBytes + 1),
      }),
    ).toBe(false)
  })

  it('accepts current inspection fields and rejects hostile ICC or HDR fields', async () => {
    const input = new Uint8Array(readFileSync('tests/fixtures/jpegxl/m4-color/pq-10.jxl'))
    const inspection = await inspectJpegXl(input)
    const response = {
      type: 'opened',
      requestId: 6,
      generation: 2,
      name: 'sample.jxl',
      sourceKind: 'jpegxl',
      inputBytes: input.length,
      inspection,
      preview: {
        logicalWidth: 7,
        logicalHeight: 5,
        width: 7,
        height: 5,
        scaled: false,
        rgba: new ArrayBuffer(140),
      },
    }
    expect(isJpegXlWorkbenchResponse(response)).toBe(true)
    for (const changed of [
      { ...inspection, toneMapping: { ...inspection.toneMapping, intensityTarget: Number.NaN } },
      { ...inspection, icc: { present: true, decodedBytes: 16_777_217 } },
      { ...inspection, icc: { present: true, decodedBytes: 1024, payload: new ArrayBuffer(1024) } },
      { ...inspection, orientation: 9 },
      { ...inspection, alphaChannels: -1 },
    ])
      expect(isJpegXlWorkbenchResponse({ ...response, inspection: changed })).toBe(false)
  })

  it('validates worker responses before UI code reads them', () => {
    expect(
      isJpegXlWorkbenchResponse({
        type: 'opened',
        requestId: 6,
        generation: 2,
        name: 'sample.png',
        sourceKind: 'png',
        inputBytes: 100,
        pixelSource: {
          container: 'PNG',
          pixelFormat: 'rgba8',
          color: 'rgb; srgb; srgb; full range',
          alpha: 'straight',
        },
        preview: {
          logicalWidth: 1,
          logicalHeight: 1,
          width: 1,
          height: 1,
          scaled: false,
          rgba: new ArrayBuffer(4),
        },
      }),
    ).toBe(true)
    expect(
      isJpegXlWorkbenchResponse({
        type: 'error',
        requestId: 4,
        generation: 2,
        message: 'Operation cancelled.',
        cancelled: true,
      }),
    ).toBe(true)
    expect(
      isJpegXlWorkbenchResponse({
        type: 'error',
        requestId: 4,
        generation: 2,
        message: 'bad input',
        cancelled: false,
        stack: 'private',
      }),
    ).toBe(false)
    expect(
      isJpegXlWorkbenchResponse({
        type: 'opened',
        requestId: 5,
        generation: 2,
        name: 'sample.jxl',
        sourceKind: 'jpegxl',
        inputBytes: 10,
        inspection: {},
        preview: {
          logicalWidth: 1,
          logicalHeight: 1,
          width: 1,
          height: 1,
          scaled: false,
          rgba: new ArrayBuffer(4),
        },
      }),
    ).toBe(false)
  })
})
