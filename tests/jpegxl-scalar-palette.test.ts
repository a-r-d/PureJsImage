import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ImageEncoder } from '../src/codec.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { createJpegXlModularEncoder } from '../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

interface SearchCandidate {
  readonly tool: string
  readonly bytes: number
}
interface SearchGroup {
  readonly palette: string
  readonly selectedBytes: number
  readonly candidates: readonly SearchCandidate[]
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const isCandidate = (value: unknown): value is SearchCandidate =>
  isRecord(value) && typeof value.tool === 'string' && typeof value.bytes === 'number'
const isGroup = (value: unknown): value is SearchGroup =>
  isRecord(value) &&
  typeof value.palette === 'string' &&
  typeof value.selectedBytes === 'number' &&
  Array.isArray(value.candidates) &&
  value.candidates.every(isCandidate)
function requireDiagnostics(encoder: ImageEncoder): asserts encoder is ImageEncoder & {
  readonly groupSearchEvidence: readonly SearchGroup[]
  readonly managedPeakBytes: number
  readonly managedLiveBytes: number
  readonly managedLiveAllocations: number
} {
  if (
    !('groupSearchEvidence' in encoder) ||
    !Array.isArray(encoder.groupSearchEvidence) ||
    !encoder.groupSearchEvidence.every(isGroup) ||
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    typeof encoder.managedLiveBytes !== 'number' ||
    !('managedLiveAllocations' in encoder) ||
    typeof encoder.managedLiveAllocations !== 'number'
  )
    throw new Error('Missing encoder diagnostics')
}

const samples = (width: number, height: number, dense = false): Uint8Array => {
  const pixels = new Uint8Array(width * height * 6)
  for (let position = 0; position < width * height; position++) {
    for (let channel = 0; channel < 3; channel++) {
      const index = (position * (channel * 4 + 3) + (position >>> 6) * (channel * 7 + 1)) % 251
      const value = dense ? (position * 17 + channel * 12345) & 65535 : index * index + channel * 53
      pixels[position * 6 + channel * 2] = value >>> 8
      pixels[position * 6 + channel * 2 + 1] = value
    }
  }
  return pixels
}
const prepare = async (width: number, height: number, dense = false, maxWorkingBytes?: number) => {
  const pixels = samples(width, height, dense)
  const sink = new Uint8ArraySink()
  const encoder = await createJpegXlModularEncoder(sink, {
    width,
    height,
    pixelFormat: 'rgb16',
    limits: defaultImageLimits,
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
    options: { effort: 7, ...(maxWorkingBytes === undefined ? {} : { maxWorkingBytes }) },
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 6,
    format: 'rgb16',
    data: pixels,
  })
  requireDiagnostics(encoder)
  return { encoder, sink, pixels }
}
const exact = async (encoded: Uint8Array, pixels: Uint8Array, width: number, height: number) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits, {
    colorOutput: 'preserve',
  })
  if (!decoder) throw new Error('Missing decoder')
  expect(decoder.pixelFormat).toBe('rgb16')
  let rows = 0
  for await (const block of decoder.decode()) {
    for (let y = 0; y < block.height; y++) {
      expect(block.data.subarray(y * block.stride, y * block.stride + width * 6)).toEqual(
        pixels.subarray((block.y + y) * width * 6, (block.y + y + 1) * width * 6),
      )
      rows++
    }
    block.release?.()
  }
  expect(rows).toBe(height)
}

describe('JPEG XL bounded scalar palettes', () => {
  it.each([
    [1025, 17],
    [1, 1031],
  ])('matches independently decoded grouped fixture %ix%i', async (width, height) => {
    const fixture = new Uint8Array(
      await readFile(
        new URL(`./fixtures/jpegxl/m7-scalar-palettes/${width}x${height}.jxl`, import.meta.url),
      ),
    )
    const run = await prepare(width, height)
    await run.encoder.finish()
    expect(run.sink.toUint8Array()).toEqual(fixture)
    await exact(fixture, run.pixels, width, height)
  })

  it.each([1023, 1024, 1025, 2051])(
    'preserves sparse RGB16 values and partial groups at width %i',
    async (width) => {
      const run = await prepare(width, 17)
      await run.encoder.finish()
      await exact(run.sink.toUint8Array(), run.pixels, width, 17)
      if (width > 1024) {
        expect(run.encoder.groupSearchEvidence.some((group) => group.palette === 'scalar')).toBe(
          true,
        )
        for (const group of run.encoder.groupSearchEvidence)
          expect(group.selectedBytes).toBe(
            Math.min(...group.candidates.map((candidate) => candidate.bytes)),
          )
      }
      expect(run.encoder.managedLiveBytes).toBe(0)
      expect(run.encoder.managedLiveAllocations).toBe(0)
    },
    15_000,
  )
  it('retains the existing search for dense high-depth values', async () => {
    const run = await prepare(1025, 17, true)
    await run.encoder.finish()
    expect(
      run.encoder.groupSearchEvidence.every((group) =>
        group.candidates.every((candidate) => candidate.tool !== 'scalar-palette'),
      ),
    ).toBe(true)
    await exact(run.sink.toUint8Array(), run.pixels, 1025, 17)
  })
  it('admits actual palette scratch and unwinds an allocation rejected at the peak', async () => {
    const baseline = await prepare(1025, 17)
    await baseline.encoder.finish()
    const peak = baseline.encoder.managedPeakBytes
    const at = await prepare(1025, 17, false, peak)
    await at.encoder.finish()
    expect(at.sink.toUint8Array()).toEqual(baseline.sink.toUint8Array())
    expect(at.encoder.managedPeakBytes).toBe(peak)
    const below = await prepare(1025, 17, false, peak - 1)
    await expect(below.encoder.finish()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(below.encoder.managedLiveBytes).toBe(0)
    expect(below.encoder.managedLiveAllocations).toBe(0)
  }, 15_000)
  it('rejects scalar reconstruction exceeding the caller decoded-byte budget', async () => {
    const run = await prepare(1025, 17)
    await run.encoder.finish()
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(run.sink.toUint8Array()),
      {
        ...defaultImageLimits,
        maxDecodedBytes: 1024 * 17 * 3 * 4,
      },
      { colorOutput: 'preserve' },
    )
    if (!decoder) throw new Error('Missing decoder')
    await expect(
      (async () => {
        for await (const block of decoder.decode()) block.release?.()
      })(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
