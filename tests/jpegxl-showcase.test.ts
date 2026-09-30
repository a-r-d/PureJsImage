import { describe, expect, it } from 'vitest'
import {
  isJxlToolRequest,
  isJxlToolResponse,
  option,
} from '../docs-astro/src/scripts/jpegxl-tool-types.ts'

describe('JPEG XL showcase messages', () => {
  it('rejects malformed files, oversized frame lists and nonfinite controls', () => {
    const request = {
      type: 'tool',
      tool: 'animation',
      action: 'encode',
      requestId: 1,
      generation: 1,
      options: {},
      files: [new File(['test'], 'test.jxl')],
    }
    expect(isJxlToolRequest(request)).toBe(true)
    expect(
      isJxlToolRequest({ ...request, files: Array.from({ length: 17 }, () => request.files[0]) }),
    ).toBe(false)
    expect(isJxlToolRequest({ ...request, file: { name: 'fake' } })).toBe(false)
    expect(() => option({ distance: NaN }, 'distance', 1, 0.25, 25)).toThrow()
    expect(() => option({ distance: 26 }, 'distance', 1, 0.25, 25)).toThrow()
  })
  it('validates preview geometry against transferred pixels', () => {
    const response = {
      type: 'tool-event',
      requestId: 1,
      generation: 1,
      state: 'stage',
      message: 'dc',
      info: {},
      image: { width: 2, height: 2, rgba: new ArrayBuffer(16) },
    }
    expect(isJxlToolResponse(response)).toBe(true)
    expect(
      isJxlToolResponse({ ...response, image: { ...response.image, rgba: new ArrayBuffer(15) } }),
    ).toBe(false)
    expect(
      isJxlToolResponse({
        ...response,
        image: { width: 9000, height: 9000, rgba: new ArrayBuffer(16) },
      }),
    ).toBe(false)
    expect(
      isJxlToolResponse({
        ...response,
        image: { width: 0.5, height: 8, rgba: new ArrayBuffer(16) },
      }),
    ).toBe(false)
    expect(isJxlToolResponse({ ...response, state: ['stage'] })).toBe(false)
  })
})
