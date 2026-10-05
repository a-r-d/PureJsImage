import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { learnedPalettePixels, verifyLearnedPalette } from './helpers/jpegxl-learned-palette.ts'

describe('JPEG XL bounded learned palette prediction', () => {
  for (const depth of [8, 16] as const)
    for (const channels of [3, 4] as const)
      it(`preserves every ${depth}-bit sample in a ${channels}-channel palette, including hidden RGB`, async () => {
        const result = await verifyLearnedPalette({ depth, channels })
        expect(result.decodedChecksum).toBe(result.inputChecksum)
        expect(result.samples).toBe(191 * 109 * channels)
        expect(result.ownedLive).toBe(0)
        expect(result.ownedAllocations).toBe(0)
        if (depth === 8 && channels === 3) expect(result.bytes).toBeLessThan(11_437)
        if (depth === 8 && channels === 4) expect(result.bytes).toBeLessThanOrEqual(9_530)
      }, 15_000)

  for (const channels of [3, 4] as const)
    it(`retains the complete prior stream at the original ${channels}-channel working limit`, async () => {
      const maxWorkingBytes = channels === 3 ? 1_883_954 : 2_088_939
      const result = await verifyLearnedPalette({ channels, maxWorkingBytes })
      expect(result.bytes).toBe(channels === 3 ? 11_437 : 9_530)
      expect(result.encodedChecksum).toBe(channels === 3 ? 2_040_922_184 : 2_108_768_002)
      expect(result.ownedPeak).toBeLessThanOrEqual(maxWorkingBytes)
      expect(result.decodedChecksum).toBe(result.inputChecksum)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    }, 15_000)

  for (const depth of [8, 16] as const)
    it(`retains exact ${depth}-bit palettes across the group boundary`, async () => {
      const result = await verifyLearnedPalette({ depth, channels: 4, width: 1025 })
      expect(result.decodedChecksum).toBe(result.inputChecksum)
      expect(result.samples).toBe(1025 * 109 * 4)
      expect(result.ownedLive).toBe(0)
      expect(result.ownedAllocations).toBe(0)
    }, 30_000)

  it('leaves lower-effort palette output unchanged', async () => {
    const result = await verifyLearnedPalette({ effort: 5 })
    expect(result.bytes).toBe(11_611)
    expect(result.decodedChecksum).toBe(result.inputChecksum)
    expect(result.ownedLive).toBe(0)
  }, 15_000)

  it('propagates cancellation and releases staged palette storage without sink output', async () => {
    const fixture = learnedPalettePixels()
    const sink = new Uint8ArraySink(),
      controller = new AbortController()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: fixture.width,
      height: fixture.height,
      pixelFormat: fixture.format,
      limits: defaultImageLimits,
      signal: controller.signal,
      options: { mode: 'lossless', effort: 7 },
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      },
    })
    if (!encoder) throw new Error('Missing palette encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: fixture.width,
      height: fixture.height,
      stride: fixture.width * 3,
      format: fixture.format,
      data: fixture.pixels,
    })
    const reason = new Error('Stop palette encoding')
    controller.abort(reason)
    await expect(encoder.finish()).rejects.toBe(reason)
    expect(sink.toUint8Array()).toHaveLength(0)
    expect(encoder).toMatchObject({ managedLiveBytes: 0, managedLiveAllocations: 0 })
  })
})
