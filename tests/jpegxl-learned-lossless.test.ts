import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { limitExceeded } from '../src/errors.ts'
import { verifyDenseLosslessTraining } from './helpers/jpegxl-dense-training.ts'
import {
  encodeLearnedLosslessFixture,
  learnedLosslessFixture,
  paletteLosslessFixture,
  reversibleColorFixture,
  verifyLearnedLosslessFixture,
  verifyLearnedLosslessSamples,
  verifyReversibleLosslessColor,
} from './helpers/jpegxl-learned-lossless.ts'
import { verifySampledZeroLearning } from './helpers/jpegxl-learner-shortcuts.ts'

type Owned = ReturnType<JpegXlEncoderMemory['allocate']>

describe('JPEG XL learned lossless prediction', () => {
  it.each([undefined, 15_989_965])(
    'preserves smooth gradients and the exact stream at limit %s',
    async (maxWorkingBytes) => {
      const result = await verifyDenseLosslessTraining(maxWorkingBytes)
      expect(result).toMatchObject({
        // Releasing losing contexts admits the same best model at the unchanged budget.
        bytes: 17_033,
        encodedChecksum: 1_356_082_369,
        samples: 513 * 257 * 3,
        ownedLive: 0,
        ownedAllocations: 0,
      })
      if (maxWorkingBytes !== undefined)
        expect(result.ownedPeak).toBeLessThanOrEqual(maxWorkingBytes)
    },
    30_000,
  )

  it.each([8192, 16384] as const)(
    'preserves unsampled residuals and mixed constant channels with %i training samples',
    (maxSamples) => {
      expect(verifySampledZeroLearning(maxSamples)).toEqual({
        maxSamples,
        preservedResiduals: 65536,
        firstResidual: 510,
      })
    },
  )

  it('retains an exact stream when optional color search exceeds the working limit', async () => {
    const fixture = reversibleColorFixture(8, 1)
    const limit = 14_000_000
    const original = JpegXlEncoderMemory.prototype.allocate
    let refused = 0
    let bounded: Awaited<ReturnType<typeof encodeLearnedLosslessFixture>>
    try {
      JpegXlEncoderMemory.prototype.allocate = function <T extends Owned>(
        this: JpegXlEncoderMemory,
        type: { new (length: number): T; readonly BYTES_PER_ELEMENT: number },
        length: number,
        scope = this.currentScope,
      ): T {
        // Palette preparation uses this length too. Refuse only the optional
        // RCT sampling allocation, which now fits the unchanged budget naturally.
        if (
          Object.is(type, Int32Array) &&
          length === 4096 &&
          new Error().stack?.includes('chooseJpegXlModularRct')
        ) {
          refused++
          throw limitExceeded('Refused optional color-search samples')
        }
        return (original<T>).call(this, type, length, scope)
      }
      bounded = await encodeLearnedLosslessFixture(fixture, 7, limit)
    } finally {
      JpegXlEncoderMemory.prototype.allocate = original
    }
    expect(refused).toBeGreaterThan(0)
    const unrestricted = await encodeLearnedLosslessFixture(fixture)
    expect(bounded.encoded.length).toBeGreaterThan(unrestricted.encoded.length)
    expect(bounded.ownedPeak).toBeLessThanOrEqual(limit)
    expect(bounded.ownedLive).toBe(0)
    await verifyLearnedLosslessSamples(fixture, bounded.encoded)
  }, 30_000)

  it('admits the unrestricted color winner within the existing working budget', async () => {
    const fixture = reversibleColorFixture(8, 1),
      before = fixture.pixels.slice(),
      limit = 14_000_000
    const bounded = await encodeLearnedLosslessFixture(fixture, 7, limit)
    const unrestricted = await encodeLearnedLosslessFixture(fixture)
    expect(bounded.encoded).toEqual(unrestricted.encoded)
    expect(bounded.ownedPeak).toBeLessThanOrEqual(limit)
    expect(bounded.ownedLive).toBe(0)
    expect(fixture.pixels).toEqual(before)
    await verifyLearnedLosslessSamples(fixture, bounded.encoded)
  }, 30_000)

  it.each([8, 16].flatMap((depth) => [0, 1, 2].map((primary) => ({ depth, primary }))))(
    'compresses correlated $depth-bit color with primary channel $primary and preserves hidden RGB',
    async ({ depth, primary }) => {
      if ((depth !== 8 && depth !== 16) || (primary !== 0 && primary !== 1 && primary !== 2))
        throw new Error('Invalid reversible color fixture')
      const result = await verifyReversibleLosslessColor(depth, primary)
      expect(result.samples).toBe(1024 * 65 * 4 * (depth / 8))
      expect(result.ownedLive).toBe(0)
    },
    30_000,
  )

  // This check includes both effort-7 and effort-5 complete searches.
  it('compresses a large ordered palette while preserving invisible color and alpha', async () => {
    const fixture = paletteLosslessFixture()
    const result = await encodeLearnedLosslessFixture(fixture)
    const reference = await encodeLearnedLosslessFixture(fixture, 5)
    expect(result.encoded.length).toBeLessThan(reference.encoded.length)
    expect(result.ownedLive).toBe(0)
    await verifyLearnedLosslessSamples(fixture, result.encoded)
  }, 120_000)

  it('retains compact repeating palettes and invisible color across groups', async () => {
    const fixture = learnedLosslessFixture(8, 1025)
    for (let position = 0; position < fixture.width * fixture.height; position++) {
      const value = (position * 17 + Math.floor(position / fixture.width) * 23) & 255
      for (let channel = 0; channel < 4; channel++)
        fixture.pixels[position * 4 + channel] = (value + channel * 51) & 255
    }
    const result = await encodeLearnedLosslessFixture(fixture)
    const reference = await encodeLearnedLosslessFixture(fixture, 5)
    expect(result.encoded.length).toBeLessThanOrEqual(reference.encoded.length)
    expect(result.encoded.length).toBeLessThan(fixture.pixels.length / 64)
    expect(result.ownedLive).toBe(0)
    await verifyLearnedLosslessSamples(fixture, result.encoded)
  }, 30_000)

  it.each([8, 16].flatMap((depth) => [1024, 1025].map((width) => ({ depth, width }))))(
    'preserves all $depth-bit samples, including invisible RGB, at width $width',
    async ({ depth, width }) => {
      if ((depth !== 8 && depth !== 16) || (width !== 1024 && width !== 1025))
        throw new Error('Invalid learned fixture dimensions')
      const result = await verifyLearnedLosslessFixture(depth, width)
      // The qualified color checkpoint used an unscaled sampled branch penalty.
      if (depth === 8 && width === 1024) expect(result.bytes).toBeLessThan(435_390)
      expect(result.samples).toBe(width * 257 * 4 * (depth / 8))
      expect(result.ownedLive).toBe(0)
    },
    60_000,
  )
})
