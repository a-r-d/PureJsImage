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
