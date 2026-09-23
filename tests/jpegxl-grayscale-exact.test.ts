import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { verifyJpegReconstructionFromJpegXl } from '../src/codecs/jpegxl-jpeg-reconstruct-source.ts'
import { defaultImageLimits } from '../src/limits.ts'
import {
  inspectJpegReconstructionEligibility,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from '../src/jpegxl.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const root = new URL('./fixtures/jpegxl/gray-exact/', import.meta.url)
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const fixture = (name: string, suffix: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`${name}${suffix}`, root)))

const cases = [
  {
    name: 'gray-baseline',
    width: 17,
    height: 9,
    progressive: false,
    restart: false,
    sourceHash: '77d7ef0a225fdeefd227bb237a3dc1ffd70f73c1010f8d983c0b1cbbd46527e3',
    jxlHash: 'a379d8d78fa6db322a6433f73f82f4e7f8941596c29d8bccffca9c0f60cb1ab2',
    oracleHash: '3b181fc9b0a8f08b630b28a073873241bd70db68bda877f16819b97fbc03e9b2',
  },
  {
    name: 'gray-progressive',
    width: 37,
    height: 29,
    progressive: true,
    restart: false,
    sourceHash: 'd45a1acbf6268c9a2f78d980561f10902252a6e140fedbcac2a6f186d2dc9b4f',
    jxlHash: 'c68807d2c4678f39bc05790d83d9b432596429ba0773f2f6f18366a9aa1eea84',
    oracleHash: '40f79be910c0e733d4c39507ca392f3b6081b61eea47d09b93ed1f943f26df52',
  },
  {
    name: 'gray-restart',
    width: 513,
    height: 267,
    progressive: false,
    restart: true,
    sourceHash: '40c08dab1d22426862fab962e2d28f051104e01778333fe334f606cd8d559c79',
    jxlHash: '3b333bcc250118689cbe215124f1874fe3edcf6e64ebc1d2248611846a4f2b39',
    oracleHash: '3b0c7cc46d069ebe6f4c83575035972672c4f3e25be10a1ee04e883d6201c4b3',
  },
  {
    name: 'gray-large',
    width: 1025,
    height: 517,
    progressive: true,
    restart: true,
    sourceHash: '65b1eafd524485f6333bbab9ba07c937f79026dfd0807acc7bc2e1566cf2231d',
    jxlHash: '06087c6778463698a8d4d296427ba7d1c384aba42f7ac97246cc6be924093a61',
    oracleHash: '3306301e196f0f5868b66870320c87892925739cfa1c92e37c348dcfec600f38',
  },
] as const

const pgmPixels = (data: Uint8Array, width: number, height: number): Uint8Array => {
  const header = new TextDecoder().decode(data.subarray(0, 48)).match(/^P5\n(\d+) (\d+)\n255\n/)
  if (!header || Number(header[1]) !== width || Number(header[2]) !== height)
    throw new Error('Pinned libjxl grayscale PGM header is invalid')
  const samples = data.subarray(header[0].length)
  if (samples.length !== width * height)
    throw new Error('Pinned libjxl grayscale PGM samples are incomplete')
  return samples
}

const decodedGray = async (
  input: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG XL decoder is unavailable')
  expect(decoder.colorSemantics?.family).toBe('gray')
  const pixels = new Uint8Array(width * height)
  for await (const block of decoder.decode()) {
    expect(block.format).toBe('gray8')
    for (let row = 0; row < block.height; row += 1)
      pixels.set(
        block.data.subarray(row * block.stride, row * block.stride + block.width),
        (block.y + row) * width + block.x,
      )
    block.release?.()
  }
  return pixels
}

describe('JPEG XL exact grayscale JPEG reconstruction', () => {
  it.each(cases)(
    'accepts $name and reconstructs original scan and marker bytes',
    async (entry) => {
      const source = fixture(entry.name, '.jpg')
      const independent = fixture(entry.name, '-libjxl.jxl')
      expect(sha256(source)).toBe(entry.sourceHash)
      expect(sha256(independent)).toBe(entry.jxlHash)
      const eligibility = await inspectJpegReconstructionEligibility(source)
      expect(eligibility).toMatchObject({
        eligible: true,
        sourceProfile: {
          width: entry.width,
          height: entry.height,
          progressive: entry.progressive,
          colorTransform: 'gray',
          components: 1,
        },
      })
      const result = await transcodeJpegToJpegXl(source, { reconstruction: 'required' })
      expect(result.mode).toBe('exact-jpeg')
      expect(result.exactReconstruction).toBe(true)
      expect(await reconstructJpegFromJpegXl(result.data)).toEqual(source)
      expect(await reconstructJpegFromJpegXl(independent)).toEqual(source)
      expect(await decodedGray(result.data, entry.width, entry.height)).toEqual(
        await decodedGray(independent, entry.width, entry.height),
      )
      await expect(verifyJpegReconstructionFromJpegXl(independent, source)).resolves.toBeUndefined()
      expect(source.some((value, index) => value === 0xff && source[index + 1] === 0xdd)).toBe(
        entry.restart,
      )
    },
    15_000,
  )

  it.each(cases)('decodes $name grayscale pixels against pinned libjxl output', async (entry) => {
    const independent = fixture(entry.name, '-libjxl.jxl')
    const compressed = fixture(entry.name, '-libjxl.pgm.gz')
    expect(sha256(compressed)).toBe(entry.oracleHash)
    const oracle = pgmPixels(new Uint8Array(gunzipSync(compressed)), entry.width, entry.height)
    const actual = await decodedGray(independent, entry.width, entry.height)
    let maximum = 0
    let squared = 0
    for (let index = 0; index < oracle.length; index += 1) {
      const difference = Math.abs((actual[index] ?? 0) - (oracle[index] ?? 0))
      maximum = Math.max(maximum, difference)
      squared += difference * difference
    }
    expect(maximum).toBeLessThanOrEqual(1)
    expect(Math.sqrt(squared / oracle.length)).toBeLessThanOrEqual(0.51)
  })

  it('preserves a COM marker and rejects a nonidentity Exif orientation', async () => {
    const source = fixture('gray-baseline', '.jpg')
    const comment = Uint8Array.of(0xff, 0xfe, 0, 7, 104, 101, 108, 108, 111)
    const withComment = new Uint8Array(source.length + comment.length)
    withComment.set(source.subarray(0, 2))
    withComment.set(comment, 2)
    withComment.set(source.subarray(2), comment.length + 2)
    const exact = await transcodeJpegToJpegXl(withComment, { reconstruction: 'required' })
    expect(await reconstructJpegFromJpegXl(exact.data)).toEqual(withComment)

    const exif = new Uint8Array(36)
    exif.set(Uint8Array.of(0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66), 0)
    exif[10] = 0x49
    exif[11] = 0x49
    const view = new DataView(exif.buffer)
    view.setUint16(12, 42, true)
    view.setUint32(14, 8, true)
    view.setUint16(18, 1, true)
    view.setUint16(20, 0x0112, true)
    view.setUint16(22, 3, true)
    view.setUint32(24, 1, true)
    view.setUint16(28, 6, true)
    const oriented = new Uint8Array(source.length + exif.length)
    oriented.set(source.subarray(0, 2))
    oriented.set(exif, 2)
    oriented.set(source.subarray(2), exif.length + 2)
    expect((await inspectJpegReconstructionEligibility(oriented)).eligible).toBe(false)
  })

  it('honors onlyIfSmaller and sink cancellation', async () => {
    const small = fixture('gray-baseline', '.jpg')
    const large = fixture('gray-large', '.jpg')
    await expect(
      transcodeJpegToJpegXl(small, { reconstruction: 'required', onlyIfSmaller: true }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    const smaller = await transcodeJpegToJpegXl(large, {
      reconstruction: 'required',
      onlyIfSmaller: true,
    })
    expect(smaller.data.byteLength).toBeLessThan(large.byteLength)
    await expect(
      transcodeJpegToJpegXl(small, {
        reconstruction: 'required',
        limits: { maxDecodedBytes: 1_000 },
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const sink = new Uint8ArraySink()
    const result = await transcodeJpegToJpegXl(small, { sink, reconstruction: 'required' })
    expect(result.data).toBeUndefined()
    expect(await reconstructJpegFromJpegXl(sink.toUint8Array())).toEqual(small)

    const failure = new Error('cancel grayscale sink')
    const aborted: unknown[] = []
    const cancelingSink = {
      async write(): Promise<void> {
        throw failure
      },
      async close(): Promise<void> {
        throw new Error('closed after cancellation')
      },
      async abort(reason: unknown): Promise<void> {
        aborted.push(reason)
      },
    }
    await expect(transcodeJpegToJpegXl(small, { sink: cancelingSink })).rejects.toBe(failure)
    expect(aborted).toEqual([failure])
  })

  it('rejects malformed grayscale JPEG and damaged exact reconstruction data', async () => {
    const source = fixture('gray-baseline', '.jpg')
    await expect(
      inspectJpegReconstructionEligibility(source.subarray(0, source.length - 8)),
    ).resolves.toMatchObject({ eligible: false })
    const damaged = fixture('gray-baseline', '-libjxl.jxl').slice()
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 0x80
    await expect(reconstructJpegFromJpegXl(damaged)).rejects.toThrow()
  })
})
