import { describe, expect, it } from 'vitest'

import { identifyClassicTiff } from '../benchmark/lib/tiff.ts'

const tiffDimensionsFixture = (
  width: number,
  height: number,
  littleEndian: boolean,
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(38)
  const view = new DataView(bytes.buffer)
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])
  view.setUint16(2, 42, littleEndian)
  view.setUint32(4, 8, littleEndian)
  view.setUint16(8, 2, littleEndian)

  view.setUint16(10, 256, littleEndian)
  view.setUint16(12, 4, littleEndian)
  view.setUint32(14, 1, littleEndian)
  view.setUint32(18, width, littleEndian)

  view.setUint16(22, 257, littleEndian)
  view.setUint16(24, 4, littleEndian)
  view.setUint32(26, 1, littleEndian)
  view.setUint32(30, height, littleEndian)
  return bytes
}

describe('TIFF benchmark inspection', () => {
  it('reads classic TIFF dimensions in both byte orders', () => {
    expect(identifyClassicTiff(tiffDimensionsFixture(4000, 3000, true))).toEqual({
      type: 'tiff',
      width: 4000,
      height: 3000,
    })
    expect(identifyClassicTiff(tiffDimensionsFixture(157, 151, false))).toEqual({
      type: 'tiff',
      width: 157,
      height: 151,
    })
  })

  it('rejects truncated and invalid TIFF headers', () => {
    expect(identifyClassicTiff(Uint8Array.of(0x49, 0x49, 0x2a, 0))).toBeUndefined()
    expect(identifyClassicTiff(new Uint8Array(38))).toBeUndefined()

    const invalidOffset = tiffDimensionsFixture(10, 10, true)
    new DataView(invalidOffset.buffer).setUint32(4, 0xfffffff0, true)
    expect(identifyClassicTiff(invalidOffset)).toBeUndefined()
  })
})
