import { expect, it } from 'vitest'
import {
  decodeDisplayStages,
  traceCorrection,
  tracePlanes,
  traceSquaredError,
} from '../benchmark/jpegxl/lossy-lab/display-error-trace.ts'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

it('separates correction energy from cancellation and rejects mismatched extents', () => {
  const source = tracePlanes(2),
    before = tracePlanes(2),
    after = tracePlanes(2)
  before[1].set([2, 2])
  after[1].set([1, 3])
  const result = traceCorrection(before, after, source)
  expect(result.before[1]).toBe(8)
  expect(result.after[1]).toBe(10)
  expect(result.correction[1]).toBe(2)
  expect(result.cross[1]).toBe(0)
  after[1].set([1, 1])
  const cancelling = traceCorrection(before, after, source)
  expect(cancelling.after[1]).toBe(2)
  expect(cancelling.correction[1]).toBe(2)
  expect(cancelling.cross[1]).toBe(-4)
  expect(() => traceSquaredError(source, tracePlanes(3))).toThrow('extents')
})

it.each([0.45, 2, 7.5])(
  'final display trace matches public decoded pixels at %s',
  async (distance) => {
    const width = 37,
      height = 25
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 7 + Math.floor(i / width) * 11) % 256,
    )
    const encoded = await encodeTransplant(
      pixels,
      width,
      height,
      distance,
      libjxlPortOverrides('standalone-forward-all', distance, width, height),
    )
    const stages = await decodeDisplayStages(encoded.bytes)
    if (distance === 2)
      await expect(decodeDisplayStages(encoded.bytes, tracePlanes(1))).rejects.toThrow('extents')
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded.bytes),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing decoder')
    let count = 0,
      maximum = 0
    for await (const block of decoder.decode()) {
      try {
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++)
            for (let c = 0; c < 3; c++) {
              maximum = Math.max(
                maximum,
                Math.abs(
                  Math.round(
                    (stages.rounded[c]?.[(block.y + y) * width + block.x + x] ?? 0) * 255,
                  ) - (block.data[y * block.stride + x * 4 + c] ?? 0),
                ),
              )
              count++
            }
      } finally {
        block.release?.()
      }
    }
    expect(count).toBe(width * height * 3)
    expect(maximum).toBeLessThanOrEqual(1)
  },
  30_000,
)
