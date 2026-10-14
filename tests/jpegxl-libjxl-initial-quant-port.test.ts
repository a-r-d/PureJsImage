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
      const bounded = libjxlInitialQuantField(base, context, 1, 1, true)
      expect(bounded).toEqual(result)
      base.memory?.release(bounded)
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
  await fieldFor(137, 75, true)
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

it('changes DC precision without replacing the coherent AC decisions', async () => {
  const width = 31,
    height = 17
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : 100 + (i % 31),
  )
  const decisions = []
  for (const mode of ['standalone-refined', 'standalone-refined-dcfine'] as const) {
    const encoded = await encodeTransplant(
      pixels,
      width,
      height,
      2,
      libjxlPortOverrides(mode, 2, width, height),
    )
    decisions.push(await extractDecisions(encoded.bytes))
  }
  const [original, finer] = decisions
  if (!original || !finer) throw new Error('Missing DC comparison')
  expect(finer.globalScale).toBe(original.globalScale)
  expect(finer.rawQuantization).toEqual(original.rawQuantization)
  expect(finer.strategies).toEqual(original.strategies)
  expect(finer.epfIterations).toBe(original.epfIterations)
  for (let c = 0; c < 3; c++) {
    const before = (original.dcQuantization[c] ?? 0) / original.quantDc
    const after = (finer.dcQuantization[c] ?? 0) / finer.quantDc
    expect(after / before).toBeCloseTo(0.5, 6)
  }
})

it('keeps the dark-grain blend between the original and half-strength HF fields', async () => {
  const width = 64,
    height = 64
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) => {
    const pixel = Math.floor(i / 4),
      x = pixel % width
    return i % 4 === 3 ? 255 : (x < 32 ? 20 : 170) + ((pixel * 73) % 80)
  })
  await encodeTransplant(pixels, width, height, 2, {
    rewriteGeometry: (base, context) => {
      const original = libjxlInitialQuantField(base, context, 2)
      const half = libjxlInitialQuantField(base, context, 2, 0.5)
      const blend = libjxlInitialQuantField(base, context, 2, 1, true, true)
      for (let i = 0; i < blend.length; i++) {
        expect(blend[i]).toBeGreaterThanOrEqual(original[i] ?? 0)
        expect(blend[i]).toBeLessThanOrEqual(half[i] ?? 0)
      }
      expect(blend.some((q, i) => q < (half[i] ?? 0))).toBe(true)
      expect(blend.some((q, i) => q === half[i])).toBe(true)
      for (const buffer of [original, half, blend]) base.memory?.release(buffer)
      return base
    },
  })
})
