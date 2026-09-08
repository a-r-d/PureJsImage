import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { throwIfAborted } from '../src/abort.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { type ImageSource, MemorySource } from '../src/source.ts'

const fixture = (id: string): Uint8Array =>
  new Uint8Array(readFileSync(`benchmark/fixtures/jpegxl/generated-vardct-v0.12.0/${id}.jxl`))

describe('JPEG XL internal-frame header ranges', () => {
  it('applies the header budget to headers rather than preceding compressed frame payloads', async () => {
    const bytes = fixture('rgb8-distance1-multi-group-progressive')
    const reads: { offset: number; length: number }[] = []
    const source: ImageSource = {
      size: bytes.length,
      async read(offset, length) {
        reads.push({ offset, length })
        return bytes.slice(offset, offset + length)
      },
    }
    const frames = await readJpegXlSourceFrameStructures(source, defaultImageLimits, {}, 83)
    expect(frames.map((frame) => frame.frameType)).toEqual(['dc', 'regular'])
    expect(frames.map((frame) => frame.codestreamEndOffset)).toEqual([10_829, 148_917])
    expect(frames.map((frame) => frame.sections.length)).toEqual([6, 21])
    expect(frames.map((frame) => frame.progressiveResolutions)).toEqual([
      [
        { downsampling: 4, lastPass: 0 },
        { downsampling: 2, lastPass: 1 },
      ],
      [
        { downsampling: 4, lastPass: 0 },
        { downsampling: 2, lastPass: 1 },
      ],
    ])
    expect(frames.map((frame) => Math.min(...frame.sections.map(({ offset }) => offset)))).toEqual([
      25, 10_887,
    ])
    expect(reads).toEqual([
      { offset: 0, length: 83 },
      { offset: 10_829, length: 58 },
    ])
    await expect(
      readJpegXlSourceFrameStructures(new MemorySource(bytes), defaultImageLimits, {}, 82),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  for (const [id, secondHeader, headerBytes] of [
    ['rgb8-distance2-progressive', 131, 41],
    ['gray8-distance1-patches', 2172, 43],
  ] as const) {
    it(`preserves the complete ${id} frame description with a small aggregate header budget`, async () => {
      const bytes = fixture(id)
      const expected = await readJpegXlSourceFrameStructures(
        new MemorySource(bytes),
        defaultImageLimits,
      )
      const offsets: number[] = []
      const source: ImageSource = {
        size: bytes.length,
        async read(offset, length) {
          offsets.push(offset)
          return bytes.slice(offset, offset + length)
        },
      }
      expect(
        await readJpegXlSourceFrameStructures(source, defaultImageLimits, {}, headerBytes),
      ).toEqual(expected)
      expect(offsets).toEqual([0, secondHeader])
    })
  }

  it('does not turn a truncated later header into a successful complete frame index', async () => {
    const bytes = fixture('rgb8-distance1-multi-group-progressive').slice(0, 10_830)
    await expect(
      readJpegXlSourceFrameStructures(new MemorySource(bytes), defaultImageLimits),
    ).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
  })

  it('checks cancellation before reading the next frame header', async () => {
    const bytes = fixture('rgb8-distance1-multi-group-progressive')
    const controller = new AbortController()
    let reads = 0
    const source: ImageSource = {
      size: bytes.length,
      async read(offset, length, options) {
        throwIfAborted(options?.signal)
        reads += 1
        const result = bytes.slice(offset, offset + length)
        controller.abort()
        return result
      },
    }
    await expect(
      readJpegXlSourceFrameStructures(source, defaultImageLimits, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(reads).toBe(1)
  })
})
