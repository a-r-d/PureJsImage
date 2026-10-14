import { expect, it } from 'vitest'
import {
  libjxlInitialGlobalScale,
  libjxlInitialQuantField,
} from '../benchmark/jpegxl/lossy-lab/libjxl-initial-quant-port.ts'
import { libjxlTransformQuantization } from '../benchmark/jpegxl/lossy-lab/libjxl-quantization-port.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import { extractDecisions } from '../benchmark/jpegxl/lossy-lab/decisions.ts'

async function fieldFor(width: number, height: number, textured: boolean) {
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : textured ? 100 + ((Math.floor(i / 4) * 73) % 100) : 128,
  )
  let field = new Float32Array(0)
  await encodeTransplant(pixels, width, height, 1, {
    rewriteGeometry: (base, context) => {
      const result = libjxlInitialQuantField(base, context, 1)
      field = result.slice()
      base.memory?.release(result)
      return base
    },
  })
  return field
}

it('keeps flat padded borders uniform and masks textured blocks', async () => {
  const flat = await fieldFor(73, 29, false)
  expect(flat.length).toBe(40)
  expect(Math.max(...flat) - Math.min(...flat)).toBeLessThan(1e-5)
  const textured = await fieldFor(73, 29, true)
  expect([...textured].every((q) => Number.isFinite(q) && q > 0)).toBe(true)
  expect(textured.reduce((sum, q) => sum + q, 0)).toBeLessThan(flat.reduce((sum, q) => sum + q, 0))
  expect((await fieldFor(1, 1, false))[0]).toBeCloseTo(flat[0] ?? 0, 5)
})

it('retains fractional precision until the final footprint is chosen', () => {
  const field = Float32Array.of(1.25, 1.25, 1.25, 2.25)
  expect(libjxlTransformQuantization(field, 2, 0, 0, 2, 2, 4, false, false)).toBe(1.5)
  expect(libjxlTransformQuantization(field, 2, 0, 0, 2, 2, 4, false)).toBe(2)
})

it('uses bounded global scales and rejects invalid distance', () => {
  expect(libjxlInitialGlobalScale(1, 1)).toBe(5111)
  expect(libjxlInitialGlobalScale(1, 0.1)).toBe(655)
  expect(() => libjxlInitialGlobalScale(NaN, 1)).toThrow('Invalid')
})

it.each([
  [0.25, false, 0],
  [0.5, false, 0],
  [0.7, true, 1],
  [1.5, true, 2],
  [4, true, 3],
] as const)(
  'signals independent filter defaults at distance %s',
  async (distance, gaborish, epfIterations) => {
    const width = 31,
      height = 17
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : 100 + (i % 31),
    )
    const encoded = await encodeTransplant(
      pixels,
      width,
      height,
      distance,
      libjxlPortOverrides('standalone-direct', distance, width, height),
    )
    const decisions = await extractDecisions(encoded.bytes)
    expect(decisions.gaborish).toBe(gaborish)
    expect(decisions.epfIterations).toBe(epfIterations)
    if (epfIterations > 0) expect(decisions.sharpness.every((value) => value === 4)).toBe(true)
  },
)

it('requires a replacement geometry before bypassing the own search', async () => {
  const pixels = Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : i % 256))
  const own = await encodeTransplant(pixels, 32, 32, 2, {})
  const incomplete = await encodeTransplant(pixels, 32, 32, 2, { skipStrategySearch: true })
  expect(incomplete.bytes).toEqual(own.bytes)
})
