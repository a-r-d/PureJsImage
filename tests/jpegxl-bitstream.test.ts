import { describe, expect, it } from 'vitest'

import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  JpegXlHuffmanCode,
} from '../src/codecs/jpegxl-bitstream.ts'
import type { JpegXlEntropyCode } from '../src/codecs/jpegxl-bitstream.ts'

const literalThenRunCode = (): JpegXlEntropyCode => ({
  contextMap: [0, 1],
  uintConfigs: [
    { splitExponent: 8, splitToken: 256, msbInToken: 0, lsbInToken: 0 },
    { splitExponent: 0, splitToken: 1, msbInToken: 0, lsbInToken: 0 },
  ],
  huffmanCodes: [
    new JpegXlHuffmanCode([
      { bits: 1, key: 0, symbol: 1 },
      { bits: 1, key: 1, symbol: 224 },
    ]),
    new JpegXlHuffmanCode([{ bits: 0, key: 0, symbol: 0 }]),
  ],
  aliasTables: undefined,
  lz77: {
    enabled: true,
    minimumSymbol: 224,
    minimumLength: 3,
    lengthConfig: { splitExponent: 0, splitToken: 1, msbInToken: 0, lsbInToken: 0 },
    distanceContext: 1,
  },
})

describe('JPEG XL entropy decoding', () => {
  it('decodes overlapping LZ77 copies in a bounded ring', () => {
    const symbols = new JpegXlEntropySymbolReader(literalThenRunCode(), 4)
    const reader = new JpegXlBitReader(Uint8Array.of(0b0000_0010))

    expect(Array.from({ length: 4 }, () => symbols.readHybridUint(0, reader))).toEqual([1, 1, 1, 1])
    expect(() => symbols.readHybridUint(0, reader)).toThrowError(
      'JPEG XL entropy stream exceeds its symbol limit',
    )
  })

  it('rejects an LZ77 distance before any literal is available', () => {
    const symbols = new JpegXlEntropySymbolReader(literalThenRunCode(), 4)
    const reader = new JpegXlBitReader(Uint8Array.of(0b0000_0001))

    expect(() => symbols.readHybridUint(0, reader)).toThrowError('JPEG XL LZ77 distance is invalid')
  })
})
