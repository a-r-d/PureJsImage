import { describe, expect, it } from 'vitest'
import type { ImageEncoder } from '../src/codec.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { createJpegXlModularEncoder, JpegXlBitWriter } from '../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { JpegXlEncodeOptions } from '../src/pipeline.ts'
import type { ImageSink } from '../src/sink.ts'

const counters = (encoder: ImageEncoder) => {
  if (
    !('managedPeakBytes' in encoder) ||
    typeof encoder.managedPeakBytes !== 'number' ||
    !('managedLiveBytes' in encoder) ||
    typeof encoder.managedLiveBytes !== 'number' ||
    !('managedLiveAllocations' in encoder) ||
    typeof encoder.managedLiveAllocations !== 'number'
  )
    throw new Error('Missing encoder allocation counters')
  return {
    peak: encoder.managedPeakBytes,
    live: encoder.managedLiveBytes,
    allocations: encoder.managedLiveAllocations,
  }
}
const prepare = async (
  options: JpegXlEncodeOptions = {},
  config: {
    width?: number
    height?: number
    maxDecodedBytes?: number
    metadata?: boolean
    failAt?: number
    failAbort?: boolean
    signal?: AbortSignal
    onWrite?: (index: number) => Promise<void>
  } = {},
) => {
  const width = config.width ?? 48,
    height = config.height ?? 32
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 17 + Math.floor(i / width) * 23) & 255
  let writes = 0,
    bytes = 0,
    aborts = 0
  const failure = new Error('deliberate sink failure')
  const sink: ImageSink = {
    async write(data) {
      writes += 1
      if (writes === config.failAt) throw failure
      await config.onWrite?.(writes)
      bytes += data.byteLength
    },
    async close() {},
    async abort() {
      aborts += 1
      if (config.failAbort) throw new Error('secondary abort error')
    },
  }
  const encoder = await createJpegXlModularEncoder(sink, {
    width,
    height,
    pixelFormat: 'rgb8',
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
    options,
    limits: {
      ...defaultImageLimits,
      maxDecodedBytes: config.maxDecodedBytes ?? defaultImageLimits.maxDecodedBytes,
    },
    ...(config.metadata ? { metadata: { xmp: Uint8Array.of(60, 120, 47, 62) } } : {}),
    ...(config.signal ? { signal: config.signal } : {}),
  })
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 3,
    format: 'rgb8',
    data: pixels,
  })
  return { encoder, failure, result: () => ({ writes, bytes, aborts }) }
}
const expectClosed = (encoder: ImageEncoder) =>
  expect(counters(encoder)).toMatchObject({ live: 0, allocations: 0 })

describe('JPEG XL actual encoder allocations', () => {
  it('checks capacity before the allocating constructor runs', () => {
    let allocations = 0
    class CountedBytes extends Uint8Array {
      constructor(length: number) {
        super(length)
        allocations += 1
      }
    }
    const memory = new JpegXlEncoderMemory(16)
    memory.allocate(CountedBytes, 16)
    expect(() => memory.allocate(CountedBytes, 1)).toThrow(/maxWorkingBytes/)
    expect(allocations).toBe(1)
    expect(memory.peakBytes).toBe(16)
    memory.close()
    expect(memory.liveBytes).toBe(0)
  })
  it('counts aliases once and unwinds nested scopes on exceptions', () => {
    const memory = new JpegXlEncoderMemory(1024)
    const escaped = memory.run(() => {
      const buffer = memory.allocate(Uint8Array, 100)
      memory.run(() => memory.allocate(Uint16Array, 50))
      return { first: buffer.subarray(0, 10), second: buffer.subarray(10) }
    })
    expect(memory.liveBytes).toBe(100)
    expect(memory.peakBytes).toBe(200)
    expect(() =>
      memory.run(() => {
        memory.allocate(Uint8Array, 50)
        throw new Error('failed')
      }),
    ).toThrow('failed')
    expect(memory.liveBytes).toBe(100)
    memory.release(escaped.first)
    expect(() => memory.release(escaped.second)).toThrow(/released twice/)
    memory.close()
  })
  it('accounts for the old and new writer capacities while growing', () => {
    const memory = new JpegXlEncoderMemory(767)
    const writer = new JpegXlBitWriter(memory)
    for (let i = 0; i < 256; i += 1) writer.writeBits(0, 8)
    expect(() => writer.writeBits(0, 8)).toThrow(/maxWorkingBytes/)
    expect(memory.liveBytes).toBe(256)
    memory.close()
  })
  it.each([1, 3, 5, 7] as const)(
    'effort %i succeeds at its measured budget and fails one byte below it',
    async (effort) => {
      const baseline = await prepare({ effort })
      await baseline.encoder.finish()
      const { peak } = counters(baseline.encoder)
      expectClosed(baseline.encoder)
      const at = await prepare({ effort, maxWorkingBytes: peak })
      await at.encoder.finish()
      expect(counters(at.encoder).peak).toBe(peak)
      expect(at.result().bytes).toBe(baseline.result().bytes)
      expectClosed(at.encoder)
      const below = await prepare({ effort, maxWorkingBytes: peak - 1 })
      await expect(below.encoder.finish()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
      expect(below.result()).toMatchObject({ writes: 0, aborts: 1 })
      expect(counters(below.encoder).peak).toBeLessThan(peak)
      expectClosed(below.encoder)
    },
  )
  it('rejects the reviewed 512x512 effort-7 reproduction before workspace allocation', async () => {
    const run = await prepare(
      { effort: 7 },
      { width: 512, height: 512, maxDecodedBytes: 1_048_577 },
    )
    await expect(run.encoder.finish()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(counters(run.encoder).peak).toBe(786432)
    expect(run.result()).toMatchObject({ writes: 0, aborts: 1 })
    expectClosed(run.encoder)
  })
  it.each([1, 3, 5, 7] as const)(
    'bounds native 24 MP effort %i owned storage',
    async (effort) => {
      const run = await prepare(
        { effort, maxWorkingBytes: 256 * 1024 * 1024 },
        { width: 6000, height: 4000 },
      )
      await run.encoder.finish()
      expect(counters(run.encoder).peak).toBeGreaterThan(72_000_000)
      expect(counters(run.encoder).peak).toBeLessThanOrEqual(256 * 1024 * 1024)
      expectClosed(run.encoder)
    },
    60_000,
  )
  it.each([1, 2, 3, 4])(
    'cleans up sink failure at output stage %i, including failed abort',
    async (failAt) => {
      const run = await prepare({ effort: 7 }, { metadata: true, failAt, failAbort: true })
      await expect(run.encoder.finish()).rejects.toBe(run.failure)
      expect(run.result().aborts).toBe(1)
      expectClosed(run.encoder)
    },
  )
  it('retains in-flight write ownership until explicit abort settles the encoder', async () => {
    let entered: () => void = () => {},
      resume: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const pending = new Promise<void>((resolve) => {
      resume = resolve
    })
    const run = await prepare(
      { effort: 7 },
      {
        onWrite: async (index) => {
          if (index === 1) {
            entered()
            await pending
          }
        },
      },
    )
    const finishing = run.encoder.finish()
    const reason = new Error('cancel pending output')
    const rejection = expect(finishing).rejects.toBe(reason)
    await started
    await run.encoder.abort?.(reason)
    expect(counters(run.encoder).live).toBeGreaterThan(0)
    resume()
    await rejection
    expectClosed(run.encoder)
    expect(run.result().aborts).toBe(1)
  })
  it('cancels after the last metadata write without reporting success', async () => {
    const controller = new AbortController()
    const run = await prepare(
      {},
      {
        metadata: true,
        signal: controller.signal,
        onWrite: async (index) => {
          if (index === 4) controller.abort()
        },
      },
    )
    await expect(run.encoder.finish()).rejects.toMatchObject({ name: 'AbortError' })
    expectClosed(run.encoder)
  })
  it('bounds encoded output before writing any bytes, including metadata', async () => {
    const run = await prepare({ maxOutputBytes: 64 }, { metadata: true })
    await expect(run.encoder.finish()).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    expect(run.result().writes).toBe(0)
    expectClosed(run.encoder)
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid working limit %s',
    async (maxWorkingBytes) => {
      await expect(prepare({ maxWorkingBytes })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    },
  )
})
