import { describe, expect, it } from 'vitest'

import {
  hybridTokenForEncoding,
  JpegXlBitWriter,
  writeAnsCode,
  writeAnsValues,
} from '../src/codecs/jpegxl-modular-encode.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  JpegXlHuffmanCode,
  readJpegXlEntropyCode,
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
  it('round-trips clustered ANS symbols and renormalization words', () => {
    const config = Object.freeze({ splitExponent: 4, msbInToken: 2, lsbInToken: 0 })
    const values = Uint32Array.from([0, 3, 0, 2, 9, 0, 0, 1, 12, 0])
    const contexts = Uint16Array.from(values, (_, index) => index & 1)
    const frequencies = [new Uint32Array(512), new Uint32Array(512)]
    values.forEach((value, index) => {
      const counts = frequencies[index & 1]
      if (!counts) throw new Error('ANS test histogram is missing')
      const token = hybridTokenForEncoding(value, config)
      counts[token] = (counts[token] ?? 0) + 1
    })
    const writer = new JpegXlBitWriter()
    const encoding = writeAnsCode(writer, Uint8Array.from([0, 1]), frequencies, config)
    writeAnsValues(writer, values, contexts, values.length, encoding)

    const reader = new JpegXlBitReader(writer.finish())
    const symbols = new JpegXlEntropySymbolReader(readJpegXlEntropyCode(reader, 2))
    expect(
      Array.from(values, (_, index) => symbols.readHybridUint(contexts[index] ?? 0, reader)),
    ).toEqual(Array.from(values))
    expect(symbols.hasValidFinalState()).toBe(true)
  })

  it('round-trips an ANS code with a compressed context map', () => {
    const config = Object.freeze({ splitExponent: 4, msbInToken: 2, lsbInToken: 0 })
    const values = Uint32Array.from({ length: 32 }, (_, index) => index & 15)
    const contexts = Uint16Array.from(values, (_, index) => index & 15)
    const frequencies = Array.from({ length: 16 }, (_, histogram) => {
      const counts = new Uint32Array(512)
      counts[hybridTokenForEncoding(histogram, config)] = 2
      return counts
    })
    const writer = new JpegXlBitWriter()
    const encoding = writeAnsCode(
      writer,
      Uint8Array.from({ length: 16 }, (_, index) => index),
      frequencies,
      config,
    )
    writeAnsValues(writer, values, contexts, values.length, encoding)

    const reader = new JpegXlBitReader(writer.finish())
    const symbols = new JpegXlEntropySymbolReader(readJpegXlEntropyCode(reader, 16))
    expect(
      Array.from(values, (_, index) => symbols.readHybridUint(contexts[index] ?? 0, reader)),
    ).toEqual(Array.from(values))
    expect(symbols.hasValidFinalState()).toBe(true)
  })

  it('reads little-endian bit fields across byte boundaries', () => {
    const reader = new JpegXlBitReader(Uint8Array.of(0b1010_1100, 0b0110_0011, 0xff, 0x80, 0x7f))

    expect(reader.readBits(3)).toBe(4)
    expect(reader.readBits(10)).toBe(117)
    expect(reader.readBits(19)).toBe(264_187)
    expect(reader.readBits(8)).toBe(127)
    expect(reader.remainingBits).toBe(0)
  })

  it('uses both the short and long Huffman lookup paths', () => {
    const code = new JpegXlHuffmanCode([
      { bits: 1, key: 0, symbol: 7 },
      { bits: 11, key: 1, symbol: 19 },
    ])

    expect(code.readSymbol(new JpegXlBitReader(Uint8Array.of(0)))).toBe(7)
    expect(code.readSymbol(new JpegXlBitReader(Uint8Array.of(0b0000_0001, 0b0000_0000)))).toBe(19)
  })

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
