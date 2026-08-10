import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ImageSource } from '../src/index.ts'
import { sourceSessionEnd, sourceSessionStart } from '../src/source.ts'
import { Image } from './image-library.ts'
import { baselineJpegFixtures } from './jpeg-compatibility-fixtures.ts'

const fixture = async (name: string): Promise<Uint8Array> =>
  readFile(join('benchmark', 'corpus', 'files', 'jpeg-reference', name))

const markerOffsets = (input: Uint8Array, marker: number): readonly number[] => {
  const offsets: number[] = []
  for (let offset = 0; offset + 1 < input.byteLength; offset += 1) {
    if (input[offset] === 0xff && input[offset + 1] === marker) offsets.push(offset)
  }
  return offsets
}

const expectTypedFailure = async (input: Uint8Array): Promise<void> => {
  await expect(
    (await Image.open(input, { tolerantDecoding: false })).png().toBuffer(),
  ).rejects.toMatchObject({
    name: 'ImageError',
  })
}

class TrackingSource implements ImageSource {
  readonly size: number
  readonly #input: Uint8Array
  maximumRead = 0
  starts = 0
  ends = 0

  constructor(input: Uint8Array) {
    this.#input = input
    this.size = input.byteLength
  }

  [sourceSessionStart](): void {
    this.starts += 1
  }

  async [sourceSessionEnd](): Promise<void> {
    this.ends += 1
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    this.maximumRead = Math.max(this.maximumRead, length)
    return this.#input.subarray(offset, Math.min(this.size, offset + length))
  }
}

const withLargeApplicationSegments = (input: Uint8Array, count: number): Uint8Array => {
  const segment = new Uint8Array(65_537)
  segment.set([0xff, 0xef, 0xff, 0xff])
  segment.fill(0x5a, 4)
  const output = new Uint8Array(input.byteLength + segment.byteLength * count)
  output.set(input.subarray(0, 2))
  let offset = 2
  for (let index = 0; index < count; index += 1) {
    output.set(segment, offset)
    offset += segment.byteLength
  }
  output.set(input.subarray(2), offset)
  return output
}

describe('JPEG hostile-input contract', () => {
  it('rejects invalid restart ordering and marker-like entropy in strict mode', async () => {
    const restart = Uint8Array.from(Buffer.from(baselineJpegFixtures.restart, 'base64'))
    const restartMarker = markerOffsets(restart, 0xd0)[0]
    if (restartMarker === undefined) throw new Error('Restart fixture is missing RST0')
    restart[restartMarker + 1] = 0xd7
    await expectTypedFailure(restart)

    const stuffed = Uint8Array.from(await fixture('generated-sof1-8bit.jpg'))
    const scan = markerOffsets(stuffed, 0xda)[0]
    if (scan === undefined) throw new Error('SOF1 fixture is missing SOS')
    const scanLength = ((stuffed[scan + 2] ?? 0) << 8) | (stuffed[scan + 3] ?? 0)
    let stuffing = scan + 2 + scanLength
    while (
      stuffing + 1 < stuffed.byteLength &&
      !(stuffed[stuffing] === 0xff && stuffed[stuffing + 1] === 0)
    ) {
      stuffing += 1
    }
    if (stuffing + 1 >= stuffed.byteLength) throw new Error('SOF1 fixture has no stuffed entropy')
    stuffed[stuffing + 1] = 0xe0
    await expectTypedFailure(stuffed)
  })

  it('rejects repeated sequential components and invalid progressive refinement order', async () => {
    const sequential = Uint8Array.from(await fixture('generated-sequential-multiscan.jpg'))
    const sequentialScans = markerOffsets(sequential, 0xda)
    const secondScan = sequentialScans[1]
    if (secondScan === undefined) throw new Error('Sequential fixture is missing its second scan')
    sequential[secondScan + 5] = 1
    await expectTypedFailure(sequential)

    const progressive = Uint8Array.from(await fixture('generated-progressive.jpg'))
    const progressiveScans = markerOffsets(progressive, 0xda)
    const refinement = progressiveScans[1]
    if (refinement === undefined) throw new Error('Progressive fixture is missing its refinement')
    const selectors = progressive[refinement + 4] ?? 0
    progressive[refinement + 7 + selectors * 2] = 0xf0
    await expectTypedFailure(progressive)

    const replacedTable = Uint8Array.from(await fixture('generated-sof1-8bit.jpg'))
    const quantizationTable = markerOffsets(replacedTable, 0xdb)[0]
    if (quantizationTable === undefined) throw new Error('SOF1 fixture is missing DQT')
    replacedTable[quantizationTable + 4] = 0x0f
    await expectTypedFailure(replacedTable)
  })

  it('returns structured errors for recognized unsupported JPEG coding boundaries', async () => {
    const baseline = Uint8Array.from(Buffer.from(baselineJpegFixtures['4:4:4'], 'base64'))
    const frame = markerOffsets(baseline, 0xc0)[0]
    if (frame === undefined) throw new Error('Baseline fixture is missing SOF0')

    const arithmetic = Uint8Array.from(baseline)
    arithmetic[frame + 1] = 0xc9

    const twelveBit = Uint8Array.from(baseline)
    twelveBit[frame + 4] = 12

    for (const [input, message] of [
      [arithmetic, 'Arithmetic-coded JPEG images are unsupported'],
      [twelveBit, '12-bit JPEG samples are unsupported'],
    ] as const) {
      await expect((await Image.open(input)).png().toBuffer()).rejects.toMatchObject({
        name: 'ImageError',
        code: 'UNSUPPORTED_OPERATION',
        message,
      })
    }
  })
  it('decodes AVI1/MJPEG frames that omit standard Huffman tables', async () => {
    const source = Uint8Array.from(Buffer.from(baselineJpegFixtures['4:4:4'], 'base64'))
    const encoded = await (await Image.open(source)).jpeg({ quality: 80 }).toBuffer()
    const reference = await (await Image.open(encoded)).png().toBuffer()
    let withoutHuffman = Uint8Array.from(encoded)
    const huffmanSegments = markerOffsets(withoutHuffman, 0xc4)
    for (let index = huffmanSegments.length - 1; index >= 0; index -= 1) {
      const offset = huffmanSegments[index]
      if (offset === undefined) continue
      const length = ((withoutHuffman[offset + 2] ?? 0) << 8) | (withoutHuffman[offset + 3] ?? 0)
      const end = offset + 2 + length
      const next = new Uint8Array(withoutHuffman.byteLength - (end - offset))
      next.set(withoutHuffman.subarray(0, offset))
      next.set(withoutHuffman.subarray(end), offset)
      withoutHuffman = next
    }

    await expect((await Image.open(withoutHuffman)).png().toBuffer()).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'JPEG scan references a missing Huffman table',
    })

    const motionJpeg = Uint8Array.from(withoutHuffman)
    const application = markerOffsets(motionJpeg, 0xe0)[0]
    if (application === undefined) throw new Error('Encoded fixture is missing APP0')
    motionJpeg.set([0x41, 0x56, 0x49, 0x31], application + 4)
    await expect((await Image.open(motionJpeg)).png().toBuffer()).resolves.toEqual(reference)

    const nonstandard = Uint8Array.from(motionJpeg)
    const scan = markerOffsets(nonstandard, 0xda)[0]
    if (scan === undefined) throw new Error('Encoded fixture is missing SOS')
    nonstandard[scan + 6] = 0x22
    await expect((await Image.open(nonstandard)).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: 'AVI1/MJPEG frames that omit nonstandard Huffman tables are unsupported',
    })
  })

  it('treats sampling factors as one for a non-interleaved grayscale scan', async () => {
    const referenceInput = Uint8Array.from(Buffer.from(baselineJpegFixtures.grayscale, 'base64'))
    const frame = markerOffsets(referenceInput, 0xc0)[0]
    if (frame === undefined) throw new Error('Grayscale fixture is missing SOF0')
    const sampledInput = Uint8Array.from(referenceInput)
    sampledInput[frame + 11] = 0x22

    const reference = await (await Image.open(referenceInput)).png().toBuffer()
    const sampled = await (await Image.open(sampledInput)).png().toBuffer()
    expect(sampled).toEqual(reference)
  })

  it('recovers a partial progressive AC scan at an inter-scan DHT boundary', async () => {
    const input = await fixture('generated-progressive.jpg')
    const acScan = markerOffsets(input, 0xda)[2]
    if (acScan === undefined) throw new Error('Progressive fixture is missing its AC scan')
    const scanLength = ((input[acScan + 2] ?? 0) << 8) | (input[acScan + 3] ?? 0)
    const entropyStart = acScan + 2 + scanLength
    const nextHuffmanTable = markerOffsets(input, 0xc4).find((offset) => offset > entropyStart)
    if (nextHuffmanTable === undefined) {
      throw new Error('Progressive fixture is missing its inter-scan DHT')
    }
    const huffmanLength =
      ((input[nextHuffmanTable + 2] ?? 0) << 8) | (input[nextHuffmanTable + 3] ?? 0)
    const huffmanEnd = nextHuffmanTable + 2 + huffmanLength
    const truncatedAt = entropyStart + Math.floor((nextHuffmanTable - entropyStart) / 2)
    const partial = new Uint8Array(truncatedAt + huffmanEnd - nextHuffmanTable + 2)
    partial.set(input.subarray(0, truncatedAt))
    partial.set(input.subarray(nextHuffmanTable, huffmanEnd), truncatedAt)
    partial.set([0xff, 0xd9], partial.byteLength - 2)
    const iccSegment = new Uint8Array(18)
    iccSegment.set([0xff, 0xe2, 0x00, 0x10])
    iccSegment.set(Buffer.from('ICC_PROFILE\0', 'ascii'), 4)
    iccSegment.set([1, 1], 16)
    const recoveredInput = new Uint8Array(partial.byteLength + iccSegment.byteLength)
    recoveredInput.set(partial.subarray(0, 2))
    recoveredInput.set(iccSegment, 2)
    recoveredInput.set(partial.subarray(2), 2 + iccSegment.byteLength)

    const output = await (await Image.open(recoveredInput)).png().toBuffer()
    await expect((await Image.open(output)).metadata()).resolves.toMatchObject({
      format: 'png',
      width: 37,
      height: 23,
    })
    await expect(
      (await Image.open(recoveredInput, { tolerantDecoding: false })).png().toBuffer(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Unexpected JPEG marker ffc4',
    })
  })

  it('applies a separate retained-coefficient limit before progressive allocation', async () => {
    const input = await fixture('generated-progressive.jpg')
    await expect(
      (await Image.open(input, { limits: { maxDecodedBytes: 4_096 } })).png().toBuffer(),
    ).rejects.toMatchObject({
      name: 'ImageError',
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('coefficient storage'),
    })
  })

  it('keeps source reads bounded and closes source sessions after a late entropy failure', async () => {
    const input = withLargeApplicationSegments(await fixture('generated-yuv411.jpg'), 20)
    const end = markerOffsets(input, 0xd9).at(-1)
    if (end === undefined) throw new Error('JPEG fixture is missing EOI')
    const malformed = input.subarray(0, end)
    const source = new TrackingSource(malformed)

    await expect(
      (await Image.open(source, { limits: { maxInputBytes: 2_000_000 } })).png().toBuffer(),
    ).rejects.toMatchObject({ name: 'ImageError', code: 'TRUNCATED_INPUT' })
    expect(source.maximumRead).toBeLessThanOrEqual(262_144)
    expect(source.maximumRead).toBeLessThan(source.size / 5)
    expect(source.starts).toBeGreaterThan(0)
    expect(source.ends).toBe(source.starts)
  })
})
