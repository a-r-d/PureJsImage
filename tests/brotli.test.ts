import { brotliDecompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  decodeBrotli,
  decodeUncompressedBrotli,
  encodeBrotli,
  encodeUncompressedBrotli,
} from '../src/codecs/brotli.ts'

const pattern = (bytes: number): Uint8Array =>
  Uint8Array.from({ length: bytes }, (_, index) => (index * 37 + Math.floor(index / 251)) & 255)

describe('bounded first-party Brotli subset', () => {
  it.each([1, 17, 65_535, 65_536, 65_537, 131_089])(
    'round trips %i compressed bytes and agrees with the Node oracle',
    (bytes) => {
      const input = pattern(bytes)
      const encoded = encodeBrotli(input)
      expect(new Uint8Array(brotliDecompressSync(encoded))).toEqual(input)
      expect(decodeBrotli(encoded, { maxOutputBytes: bytes })).toEqual(input)
    },
  )

  it('uses a backward copy to actually compress repeated metadata', () => {
    const input = Uint8Array.from({ length: 4096 }, (_, index) => index & 3)
    const encoded = encodeBrotli(input)

    expect(encoded.byteLength).toBeLessThan(input.byteLength)
    expect(new Uint8Array(brotliDecompressSync(encoded))).toEqual(input)
    expect(decodeBrotli(encoded, { maxOutputBytes: input.byteLength })).toEqual(input)
  })

  it('bounds compressed output before decoding literals', () => {
    const encoded = encodeBrotli(pattern(17))
    expect(() => decodeBrotli(encoded, { maxOutputBytes: 16 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })

  it.each([0, 1, 17, 65_535, 65_536, 65_537, 131_089])(
    'round trips %i uncompressed bytes and agrees with the Node oracle',
    (bytes) => {
      const input = pattern(bytes)
      const encoded = encodeUncompressedBrotli(input)
      expect(new Uint8Array(brotliDecompressSync(encoded))).toEqual(input)
      expect(decodeUncompressedBrotli(encoded, { maxOutputBytes: bytes })).toEqual(input)
    },
  )

  it('fails before declared output exceeds its budget', () => {
    const encoded = encodeUncompressedBrotli(pattern(17))
    expect(() => decodeUncompressedBrotli(encoded, { maxOutputBytes: 16 })).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })

  it('rejects nonzero alignment and terminal padding', () => {
    const alignment = encodeUncompressedBrotli(pattern(17))
    alignment[3] = (alignment[3] ?? 0) | 0x80
    expect(() => decodeUncompressedBrotli(alignment, { maxOutputBytes: 17 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )

    const terminal = encodeUncompressedBrotli(pattern(17))
    terminal[terminal.length - 1] = 0x07
    expect(() => decodeUncompressedBrotli(terminal, { maxOutputBytes: 17 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })

  it('rejects compressed meta-blocks without a platform fallback', () => {
    const compressed = Uint8Array.of(
      0x1b,
      0x10,
      0x00,
      0x00,
      0x24,
      0xc4,
      0xc6,
      0xda,
      0x20,
      0x14,
      0x8b,
      0x02,
      0x80,
      0xbb,
      0x65,
      0x59,
      0x90,
      0x44,
      0x02,
      0x98,
      0x23,
    )
    expect(() => decodeUncompressedBrotli(compressed, { maxOutputBytes: 17 })).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_OPERATION' }),
    )
  })
})
