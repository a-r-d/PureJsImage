import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { decodeZstd } from '../src/compression/zstd/index.ts'
import { ImageError } from '../src/errors.ts'

const magic = [0x28, 0xb5, 0x2f, 0xfd] as const

const block = (
  type: 0 | 1 | 2,
  last: boolean,
  size: number,
  payload: readonly number[],
): number[] => {
  const header = size * 8 + type * 2 + (last ? 1 : 0)
  return [header & 255, (header >>> 8) & 255, (header >>> 16) & 255, ...payload]
}

const singleSegmentFrame = (contentSize: number, blocks: readonly number[]): Uint8Array => {
  if (contentSize < 0 || contentSize > 255) throw new Error('Test frame size is out of range')
  return Uint8Array.of(...magic, 0x20, contentSize, ...blocks)
}

const rawFrame = (data: readonly number[]): Uint8Array =>
  singleSegmentFrame(data.length, block(0, true, data.length, data))

const entropyFixture = new Uint8Array(
  readFileSync(new URL('./fixtures/zstd-entropy-multiblock.zst', import.meta.url)),
)

const entropyFixtureOutput = (): Uint8Array => {
  const words = [
    'image',
    'decoder',
    'pixel',
    'window',
    'literal',
    'sequence',
    'offset',
    'bounded',
    'browser',
    'typescript',
  ]
  const paragraphs: string[] = []
  let state = 0x6d2b79f5
  for (let index = 0; index < 30_000; index += 1) {
    state = Math.imul(state ^ (state >>> 15), 1 | state)
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state)
    const selected = words[((state ^ (state >>> 14)) >>> 0) % words.length]
    paragraphs.push(`${selected ?? 'image'}:${index % 997} `)
  }
  return new TextEncoder().encode(paragraphs.join(''))
}

const expectImageError = (action: () => unknown, code?: ImageError['code']): void => {
  try {
    action()
    throw new Error('Expected an ImageError')
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ImageError)
    if (code !== undefined) expect((error as ImageError).code).toBe(code)
  }
}

describe('standalone Zstandard decoder', () => {
  it('decodes empty, raw, RLE, and omitted-content-size frames', () => {
    expect(decodeZstd(rawFrame([]))).toEqual(new Uint8Array())
    expect(decodeZstd(rawFrame([1, 2, 3, 4]))).toEqual(Uint8Array.of(1, 2, 3, 4))

    const rle = singleSegmentFrame(7, block(1, true, 7, [0xa5]))
    expect(decodeZstd(rle)).toEqual(Uint8Array.of(0xa5, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5, 0xa5))

    const unknownSize = Uint8Array.of(...magic, 0, 0, ...block(0, true, 3, [9, 8, 7]))
    expect(decodeZstd(unknownSize, { maxOutputBytes: 3 })).toEqual(Uint8Array.of(9, 8, 7))
  })

  it('decodes compressed Huffman literals, FSE sequences, repeated tables, and multiple blocks', () => {
    const expected = entropyFixtureOutput()
    const decoded = decodeZstd(entropyFixture, {
      expectedOutputBytes: expected.byteLength,
      maxOutputBytes: expected.byteLength,
    })
    expect(Buffer.compare(decoded, expected)).toBe(0)
  })

  it('reuses repeated FSE tables and offset history across compressed blocks', () => {
    const firstPayload = [8, 65, 1, 0x54, 1, 0, 0, 1]
    const secondPayload = [8, 66, 1, 0xfc, 1]
    const frame = singleSegmentFrame(8, [
      ...block(2, false, firstPayload.length, firstPayload),
      ...block(2, true, secondPayload.length, secondPayload),
    ])
    expect(decodeZstd(frame)).toEqual(new TextEncoder().encode('AAAABBBB'))
  })

  it('decodes concatenated frames around bounded skippable metadata', () => {
    const first = rawFrame([1, 2])
    const second = singleSegmentFrame(3, block(1, true, 3, [9]))
    const skippable = Uint8Array.of(0x50, 0x2a, 0x4d, 0x18, 2, 0, 0, 0, 0xaa, 0xbb)
    const joined = new Uint8Array(first.byteLength + skippable.byteLength + second.byteLength)
    joined.set(first)
    joined.set(skippable, first.byteLength)
    joined.set(second, first.byteLength + skippable.byteLength)
    expect(decodeZstd(joined, { expectedOutputBytes: 5 })).toEqual(Uint8Array.of(1, 2, 9, 9, 9))
  })

  it('verifies checksums and exact output bounds', () => {
    const expected = entropyFixtureOutput()
    expect(
      decodeZstd(entropyFixture, {
        expectedOutputBytes: expected.byteLength,
        maxOutputBytes: expected.byteLength,
      }).byteLength,
    ).toBe(expected.byteLength)

    const corruptChecksum = Uint8Array.from(entropyFixture)
    const checksumByte = corruptChecksum.at(-1)
    if (checksumByte === undefined) throw new Error('Fixture checksum is missing')
    corruptChecksum[corruptChecksum.byteLength - 1] = checksumByte ^ 1
    expectImageError(() => decodeZstd(corruptChecksum), 'INVALID_INPUT')
    expectImageError(() => decodeZstd(rawFrame([1, 2, 3]), { maxOutputBytes: 2 }), 'LIMIT_EXCEEDED')
    expectImageError(
      () => decodeZstd(rawFrame([1, 2, 3]), { expectedOutputBytes: 4 }),
      'INVALID_INPUT',
    )
  })

  it('rejects dictionary frames, oversized windows, invalid entropy, and impossible offsets', () => {
    const dictionaryFrame = Uint8Array.of(...magic, 0x21, 1, 0, ...block(0, true, 0, []))
    expectImageError(() => decodeZstd(dictionaryFrame), 'UNSUPPORTED_OPERATION')

    const oversizedWindow = Uint8Array.of(...magic, 0, 0xf8, ...block(0, true, 0, []))
    expectImageError(
      () => decodeZstd(oversizedWindow, { maxWindowBytes: 8 * 1024 * 1024 }),
      'LIMIT_EXCEEDED',
    )

    const invalidEntropyPayload = [0x12, 0x40, 0, 0]
    const invalidEntropy = singleSegmentFrame(
      1,
      block(2, true, invalidEntropyPayload.length, invalidEntropyPayload),
    )
    expectImageError(() => decodeZstd(invalidEntropy), 'INVALID_INPUT')

    const impossibleOffsetPayload = [0, 1, 0x54, 0, 0, 0, 1]
    const impossibleOffset = singleSegmentFrame(
      3,
      block(2, true, impossibleOffsetPayload.length, impossibleOffsetPayload),
    )
    expectImageError(() => decodeZstd(impossibleOffset), 'INVALID_INPUT')
  })

  it('fails deterministic truncations without leaking raw exceptions', () => {
    for (let length = 0; length < entropyFixture.byteLength; length += 2048) {
      expectImageError(() => decodeZstd(entropyFixture.subarray(0, length)))
    }
    expectImageError(() => decodeZstd(entropyFixture.subarray(0, -1)))
  })
})
