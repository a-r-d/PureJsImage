import { describe, expect, it } from 'vitest'

import { decodeLz4Block } from '../src/compression/lz4/block.ts'
import { ImageError } from '../src/errors.ts'

const literals = (data: Uint8Array): Uint8Array => {
  if (data.byteLength < 15) return Uint8Array.of(data.byteLength << 4, ...data)
  return Uint8Array.of(0xf0, data.byteLength - 15, ...data)
}

describe('LZ4 block decoder', () => {
  it('decodes literal-only and overlapping match blocks', () => {
    expect(decodeLz4Block(literals(Uint8Array.of(1, 2, 3, 4)), { maxOutputBytes: 16 })).toEqual(
      Uint8Array.of(1, 2, 3, 4),
    )
    // token: 1 literal, match length 4. Offset 1 repeats the last literal.
    const repeated = Uint8Array.of(0x10, 0xaa, 1, 0)
    expect(decodeLz4Block(repeated, { maxOutputBytes: 16 })).toEqual(
      Uint8Array.of(0xaa, 0xaa, 0xaa, 0xaa, 0xaa),
    )
  })

  it('rejects truncated input and bounded overflow', () => {
    expect(() => decodeLz4Block(Uint8Array.of(0x10), { maxOutputBytes: 8 })).toThrow(ImageError)
    expect(() => decodeLz4Block(literals(Uint8Array.of(1, 2, 3)), { maxOutputBytes: 2 })).toThrow(
      ImageError,
    )
    try {
      decodeLz4Block(literals(Uint8Array.of(1, 2, 3, 4)), {
        maxOutputBytes: 2,
        expectedOutputBytes: 8,
      })
      throw new Error('Expected LIMIT_EXCEEDED')
    } catch (error) {
      expect(error).toBeInstanceOf(ImageError)
      expect((error as ImageError).code).toBe('LIMIT_EXCEEDED')
    }
  })
})
