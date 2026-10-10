import { describe, expect, it } from 'vitest'
import {
  effortFixtures,
  encodeEffortFixture,
  verifyEffortFixture,
} from './helpers/jpegxl-effort9.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8Async } from '../src/codecs/jpegxl-vardct-encode.ts'
import { createJpegXlEncodeOperation } from '../src/pipeline.ts'

describe('slow JPEG XL effort 9', () => {
  for (const fixture of effortFixtures)
    it(`preserves layout, input and exact alpha for ${fixture.name}`, async () => {
      const result = await verifyEffortFixture(fixture)
      expect(result.rows).toBe(fixture.height)
      expect(result.alphaError).toBe(0)
      expect(result.bytes).toBeGreaterThan(0)
    }, 120_000)
  it('runs additional searches on a small RGB image and retains the smaller complete stream', async () => {
    const fixture = effortFixtures[0]
    if (!fixture) throw new Error('RGB effort fixture missing')
    const fast = await encodeEffortFixture(fixture, 7)
    const slow = await encodeEffortFixture(fixture, 9)
    expect(slow.bytes).not.toEqual(fast.bytes)
    expect(slow.bytes.length).toBeLessThanOrEqual(fast.bytes.length)
  }, 120_000)
  it('retains the exact effort-7 lossless policy', async () => {
    const fixture = effortFixtures[0]
    if (!fixture) throw new Error('RGB effort fixture missing')
    const fast = await encodeEffortFixture(fixture, 7, 3, 'lossless')
    const slow = await encodeEffortFixture(fixture, 9, 3, 'lossless')
    expect(slow.bytes).toEqual(fast.bytes)
  }, 120_000)
  it('unwinds cancellation during the final complete alternatives', async () => {
    const fixture = effortFixtures[0]
    if (!fixture) throw new Error('RGB effort fixture missing')
    const { pixels } = await encodeEffortFixture(fixture, 7)
    const completed = new JpegXlEncoderMemory(32_000_000)
    let checkpoints = 0
    const parts = await encodeJpegXlVarDct8Async(
      pixels,
      fixture.width,
      fixture.height,
      3,
      completed,
      async () => {
        checkpoints++
      },
      3,
      9,
    )
    expect(completed.liveBytes).toBe(parts.reduce((sum, part) => sum + part.byteLength, 0))
    completed.close()
    const cancelled = new JpegXlEncoderMemory(32_000_000)
    let steps = 0
    const reason = new Error('cancel late effort-9 alternative')
    await expect(
      encodeJpegXlVarDct8Async(
        pixels,
        fixture.width,
        fixture.height,
        3,
        cancelled,
        async () => {
          if (++steps === checkpoints - 2) throw reason
        },
        3,
        9,
      ),
    ).rejects.toBe(reason)
    expect(cancelled.liveBytes).toBe(0)
    expect(cancelled.liveAllocations).toBe(0)
    cancelled.close()
  }, 120_000)
  it('rejects unapproved effort 8 at the public runtime boundary', () => {
    const options: unknown = { mode: 'lossy', effort: 8 }
    // The operations API also validates callers arriving from JavaScript.
    expect(() => Reflect.apply(createJpegXlEncodeOperation, undefined, [options])).toThrow('effort')
  })
})
