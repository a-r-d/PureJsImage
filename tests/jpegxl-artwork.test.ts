import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { jpegXlArtworkPixels, verifyJpegXlArtwork } from './helpers/jpegxl-artwork.ts'

describe('JPEG XL exact artwork candidate', () => {
  it('preserves every sample above the former quarter-megapixel extent limit', async () => {
    const result = await verifyJpegXlArtwork({ maxWorkingBytes: 16_777_216 })
    expect(result.bytes).toBeLessThan(1_000)
    expect(result.visibleError).toBe(0)
    expect(result.alphaError).toBe(0)
    expect(result.decodedChecksum).toBe(2531185567)
    expect(result.ownedPeak).toBeLessThanOrEqual(16_777_216)
    expect(result.ownedLive).toBe(0)
    expect(result.ownedAllocations).toBe(0)
  }, 30_000)

  it('keeps the complete prior stream when optional exact search exceeds working storage', async () => {
    const result = await verifyJpegXlArtwork({ maxWorkingBytes: 8_388_608 })
    expect(result.bytes).toBe(3159)
    expect(result.encodedChecksum).toBe(2065653775)
    expect(result.decodedChecksum).toBe(2319986359)
    expect(result.alphaError).toBe(0)
    expect(result.ownedPeak).toBeLessThanOrEqual(8_388_608)
    expect(result.ownedLive).toBe(0)
    expect(result.ownedAllocations).toBe(0)
  }, 30_000)

  for (const alpha of ['varying', 'hidden'] as const)
    it(`retains exact visible color and alpha after alpha-search changes for ${alpha}-alpha artwork`, async () => {
      const result = await verifyJpegXlArtwork({ alpha })
      // A smaller lossy alpha stream must preserve the established exact-color selection.
      expect(result.bytes).toBe(13807)
      expect(result.encodedChecksum).toBe(1526632822)
      expect(result.decodedChecksum).toBe(2516035649)
      expect(result.visibleError).toBe(0)
      expect(result.alphaError).toBe(0)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    }, 60_000)

  for (const [options, encodedChecksum, decodedChecksum] of [
    [{ progressive: true }, 913551628, 2319986359],
    [{ depth: 16 }, 904015805, 1237593230],
    [{ width: 1025, height: 1025 }, 4009859427, 2374356855],
    [{ width: 512, height: 512 }, 2502169417, 3681525189],
  ] as const)
    it(`preserves the existing protected path for ${JSON.stringify(options)}`, async () => {
      const result = await verifyJpegXlArtwork(options)
      expect(result.encodedChecksum).toBe(encodedChecksum)
      if ('width' in options && options.width === 1025) expect(result.bytes).toBe(3589)
      expect(result.decodedChecksum).toBe(decodedChecksum)
      expect(result.alphaError).toBe(0)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    }, 30_000)

  it('releases candidate storage when aborted after the exact search starts', async () => {
    const fixture = jpegXlArtworkPixels()
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: fixture.width,
      height: fixture.height,
      pixelFormat: fixture.format,
      limits: defaultImageLimits,
      options: { mode: 'lossy', effort: 7, distance: 3, maxWorkingBytes: 16_777_216 },
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'straight',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      },
    })
    if (!encoder) throw new Error('Missing artwork encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: fixture.width,
      height: fixture.height,
      stride: fixture.width * 4,
      format: fixture.format,
      data: fixture.pixels,
    })
    let settled = false,
      failure: unknown
    const finish = encoder.finish().then(
      () => {
        settled = true
      },
      (error: unknown) => {
        settled = true
        failure = error
      },
    )
    const peak = () => {
      if (!('managedPeakBytes' in encoder) || typeof encoder.managedPeakBytes !== 'number')
        throw new Error('Missing artwork storage accounting')
      return encoder.managedPeakBytes
    }
    // The independently frozen native path peaks below this; exact planes exceed it.
    while (!settled && peak() <= 9_500_000)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    expect(peak()).toBeGreaterThan(9_500_000)
    const reason = new Error('abort optional artwork search')
    await encoder.abort?.(reason)
    await finish
    expect(failure).toBe(reason)
    expect(sink.toUint8Array().length).toBe(0)
    expect('managedLiveBytes' in encoder ? encoder.managedLiveBytes : undefined).toBe(0)
    expect('managedLiveAllocations' in encoder ? encoder.managedLiveAllocations : undefined).toBe(0)
  }, 30_000)

  it('releases a winning exact candidate when the output sink fails', async () => {
    const fixture = jpegXlArtworkPixels()
    const reason = new Error('artwork output failure')
    let aborted: unknown,
      attempted = 0
    const encoder = await jpegxlCodec.createEncoder?.(
      {
        async write(chunk) {
          attempted += chunk.byteLength
          throw reason
        },
        async close() {},
        async abort(error) {
          aborted = error
        },
      },
      {
        width: fixture.width,
        height: fixture.height,
        pixelFormat: fixture.format,
        limits: defaultImageLimits,
        options: { mode: 'lossy', effort: 7, distance: 3, maxWorkingBytes: 16_777_216 },
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: 'straight',
          provenance: 'container-signaled',
          renderingIntent: 'relative',
        },
      },
    )
    if (!encoder) throw new Error('Missing artwork encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: fixture.width,
      height: fixture.height,
      stride: fixture.width * 4,
      format: fixture.format,
      data: fixture.pixels,
    })
    await expect(encoder.finish()).rejects.toBe(reason)
    expect(attempted).toBeGreaterThan(0)
    expect(aborted).toBe(reason)
    expect('managedPeakBytes' in encoder ? encoder.managedPeakBytes : 0).toBeGreaterThan(9_500_000)
    expect('managedLiveBytes' in encoder ? encoder.managedLiveBytes : undefined).toBe(0)
    expect('managedLiveAllocations' in encoder ? encoder.managedLiveAllocations : undefined).toBe(0)
  }, 30_000)
})
