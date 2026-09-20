import { describe, expect, it } from 'vitest'
import type { JpegXlEntropyCode } from '../src/codecs/jpegxl-bitstream.ts'
import {
  JpegXlBitReader,
  JpegXlEntropySymbolReader,
  JpegXlHuffmanCode,
  jpegXlMaxHfEntropyContexts,
  readJpegXlEntropyCode,
} from '../src/codecs/jpegxl-bitstream.ts'
import {
  hybridTokenForEncoding,
  JpegXlBitWriter,
  writeAnsCode,
  writeAnsValues,
  writeHybridUint,
  writePrefixCode,
} from '../src/codecs/jpegxl-modular-encode.ts'

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
  it('preserves every bit alignment for 0-32-bit fields and full unsigned values', () => {
    for (let offset = 0; offset < 8; offset++) {
      for (let count = 0; count <= 32; count++) {
        const maximum = 2 ** count - 1
        for (const value of [0, maximum, Math.floor(maximum / 3)]) {
          const writer = new JpegXlBitWriter()
          writer.writeBits(2 ** offset - 1, offset)
          writer.writeBits(value, count)
          writer.writeBits(173, 8)
          const reader = new JpegXlBitReader(writer.finish())
          expect(reader.readBits(offset)).toBe(2 ** offset - 1)
          expect(reader.readBits(count)).toBe(value)
          expect(reader.readBits(8)).toBe(173)
        }
      }
    }
  })
  it('keeps skewed prefix models bounded without making frequent symbols nine bits', () => {
    const frequencies = new Uint32Array(32)
    for (let symbol = 0; symbol < frequencies.length; symbol++)
      frequencies[symbol] = 2 ** (31 - symbol)
    const original = frequencies.slice()
    const writer = new JpegXlBitWriter()
    const encoding = writePrefixCode(writer, 1, frequencies)
    expect(encoding.lengths[0]).toBeLessThanOrEqual(2)
    expect(Math.max(...encoding.lengths)).toBeLessThanOrEqual(15)
    for (let symbol = 0; symbol < frequencies.length; symbol++)
      writeHybridUint(writer, symbol, encoding)
    const reader = new JpegXlBitReader(writer.finish())
    const symbols = new JpegXlEntropySymbolReader(readJpegXlEntropyCode(reader, 1))
    for (let symbol = 0; symbol < frequencies.length; symbol++)
      expect(symbols.readHybridUint(0, reader)).toBe(symbol)
    expect(frequencies).toEqual(original)
  })
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

  it('round-trips a broad ANS histogram through serialized frequencies and alias entries', () => {
    const config = Object.freeze({ splitExponent: 4, msbInToken: 2, lsbInToken: 0 })
    const values = Uint32Array.from({ length: 1_000 }, (_, index) => (index * 17) % 511)
    const contexts = new Uint16Array(values.length)
    const frequencies = [new Uint32Array(256)]
    for (const value of values) {
      const token = hybridTokenForEncoding(value, config)
      frequencies[0]?.set([1 + (frequencies[0]?.[token] ?? 0)], token)
    }
    const writer = new JpegXlBitWriter()
    const encoding = writeAnsCode(writer, Uint8Array.of(0), frequencies, config)
    writeAnsValues(writer, values, contexts, values.length, encoding)

    const reader = new JpegXlBitReader(writer.finish())
    const symbols = new JpegXlEntropySymbolReader(readJpegXlEntropyCode(reader, 1), values.length)
    expect(Array.from(values, () => symbols.readHybridUint(0, reader))).toEqual(Array.from(values))
    expect(symbols.hasValidFinalState()).toBe(true)
  })

  it('omits hybrid fields when the ANS split exponent equals the alphabet size', () => {
    const config = Object.freeze({ splitExponent: 8, msbInToken: 0, lsbInToken: 0 })
    const values = Uint32Array.from({ length: 257 }, (_, index) => index & 255)
    const contexts = new Uint16Array(values.length)
    const frequencies = [new Uint32Array(256)]
    for (const value of values) {
      frequencies[0]?.set([1 + (frequencies[0]?.[value] ?? 0)], value)
    }
    const writer = new JpegXlBitWriter()
    const encoding = writeAnsCode(writer, Uint8Array.of(0), frequencies, config)
    writeAnsValues(writer, values, contexts, values.length, encoding)

    const reader = new JpegXlBitReader(writer.finish())
    const symbols = new JpegXlEntropySymbolReader(readJpegXlEntropyCode(reader, 1), values.length)
    expect(Array.from(values, () => symbols.readHybridUint(0, reader))).toEqual(Array.from(values))
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

  it('admits bounded large HF maps only with an explicit context allowance', () => {
    const writer = new JpegXlBitWriter()
    writePrefixCode(writer, jpegXlMaxHfEntropyContexts, Uint32Array.of(1))
    const bytes = writer.finish()
    expect(() => readJpegXlEntropyCode(new JpegXlBitReader(bytes), 65_537)).toThrow(
      'entropy context count',
    )
    const code = readJpegXlEntropyCode(
      new JpegXlBitReader(bytes),
      jpegXlMaxHfEntropyContexts,
      0,
      jpegXlMaxHfEntropyContexts,
    )
    expect(code.contextMap).toHaveLength(jpegXlMaxHfEntropyContexts)
    expect(code.contextMap[0]).toBe(0)
    expect(code.contextMap[jpegXlMaxHfEntropyContexts - 1]).toBe(0)
    for (const [contexts, limit] of [
      [jpegXlMaxHfEntropyContexts + 1, jpegXlMaxHfEntropyContexts],
      [1, jpegXlMaxHfEntropyContexts + 1],
    ]) {
      const reader = new JpegXlBitReader(bytes)
      expect(() => readJpegXlEntropyCode(reader, contexts ?? 0, 0, limit)).toThrow(
        'entropy context count',
      )
      expect(reader.bitPosition).toBe(0)
    }
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
