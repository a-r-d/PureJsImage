import { expect, it } from 'vitest'
import {
  perceptualBlur,
  perceptualQuadraticMaps,
  poolPerceptualMap,
  preparePerceptualImage,
} from '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-local-port.ts'

it('preserves constants across mirrored and truncated Gaussian borders', () => {
  for (const [width, height] of [
    [1, 1],
    [1, 17],
    [17, 1],
    [19, 17],
  ]) {
    if (!width || !height) throw new Error('Missing dimensions')
    const input = new Float64Array(width * height).fill(3.5)
    for (const sigma of [1.2, 1.56416327805, 2.7, 7.15593339443]) {
      const output = perceptualBlur(input, width, height, sigma)
      expect(output.every((v) => Math.abs(v - 3.5) < 1e-12)).toBe(true)
    }
  }
  expect(() => perceptualBlur(new Float64Array(4), 2, 3, 1.2)).toThrow('blur')
})
it('gives zero identity cost and finite costs for lost structure and brightness changes', () => {
  const width = 19,
    height = 17,
    pixels = new Uint8Array(width * height * 4),
    flat = pixels.slice(),
    shifted = pixels.slice()
  for (let p = 0; p < width * height; p++)
    for (let c = 0; c < 4; c++) {
      const value = p % width < 9 ? 64 : 128
      pixels[p * 4 + c] = c === 3 ? 255 : value
      flat[p * 4 + c] = c === 3 ? 255 : 96
      shifted[p * 4 + c] = c === 3 ? 255 : value + 5
    }
  const source = preparePerceptualImage(pixels, width, height),
    identity = perceptualQuadraticMaps(source, source)
  for (const map of Object.values(identity))
    expect(poolPerceptualMap(map)).toEqual({ maximum: 0, norm3: 0 })
  for (const image of [flat, shifted]) {
    const maps = perceptualQuadraticMaps(source, preparePerceptualImage(image, width, height))
    for (const map of Object.values(maps)) {
      expect(map.every(Number.isFinite)).toBe(true)
      expect(poolPerceptualMap(map).maximum).toBeGreaterThan(0)
    }
    expect(maps.asymmetric.every((v, p) => v >= (maps.masked[p] ?? 0))).toBe(true)
  }
})

it('keeps directional identity zero and preserves sign reversal and border locality', async () => {
  const { maltaDirectionalCost, mixPerceptualScales } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-malta-port.ts'
  )
  const width = 19,
    height = 17,
    source = new Float64Array(width * height),
    changed = source.slice()
  changed[8 * width + 9] = 1
  for (const band of ['low', 'high'] as const) {
    expect(
      maltaDirectionalCost(source, source, width, height, 1, 5, band).every((v) => v === 0),
    ).toBe(true)
    const cost = maltaDirectionalCost(source, changed, width, height, 1, 5, band),
      reversed = maltaDirectionalCost(
        source,
        changed.map((v) => -v),
        width,
        height,
        1,
        5,
        band,
      )
    expect(cost).toEqual(reversed)
    expect(cost[8 * width + 9]).toBeGreaterThan(0)
    expect(cost[0]).toBe(0)
    expect(cost.every((v) => Number.isFinite(v) && v >= 0)).toBe(true)
  }
  expect(
    mixPerceptualScales(new Float64Array(15).fill(2), new Float64Array(6).fill(4), 5, 3),
  ).toEqual(new Float64Array(15).fill(3.7))
})

it('matches the documented native mixed norm and rejects invalid distances', async () => {
  const { poolNativePerceptual } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-pool-port.ts'
  )
  const result = poolNativePerceptual(new Float64Array([0, 2]))
  expect(result.maximum).toBe(2)
  expect(result.norm3).toBeCloseTo((4 ** (1 / 3) + 32 ** (1 / 6) + 2048 ** (1 / 12)) / 3, 14)
  expect(poolNativePerceptual(new Float32Array(17).fill(3))).toEqual({ maximum: 3, norm3: 3 })
  expect(poolNativePerceptual(new Float32Array())).toEqual({ maximum: 0, norm3: 0 })
  expect(() => poolNativePerceptual(new Float64Array([Number.NaN]))).toThrow('Invalid')
})

it('matches pinned native scores on an odd-sized brightness and structure fixture', async () => {
  const { displayLinearPlanes, downsampleDisplay } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-display-loss.ts'
  )
  const { preparePerceptualLinear } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-local-port.ts'
  )
  const { perceptualDirectionalMap, mixPerceptualScales } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-malta-port.ts'
  )
  const { poolNativePerceptual } = await import(
    '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-pool-port.ts'
  )
  const width = 19,
    height = 17
  const prepare = (mode: 'source' | 'flat' | 'shifted') => {
    const pixels = new Uint8Array(width * height * 4)
    for (let p = 0; p < width * height; p++)
      for (let c = 0; c < 4; c++) {
        const v = p % width < 9 ? 64 : 128
        pixels[p * 4 + c] = c === 3 ? 255 : mode === 'flat' ? 96 : mode === 'shifted' ? v + 5 : v
      }
    const rgb = displayLinearPlanes(pixels, width, height)
    return {
      fine: preparePerceptualLinear(rgb, width, height),
      half: preparePerceptualLinear(downsampleDisplay(rgb, width, height), 10, 9),
    }
  }
  const source = prepare('source')
  // v0.12.0 butteraugli_main, SDR 80, --rawdistmap; PFM values pooled in Float64.
  // Float64/Math.log differs slightly from native float and FastLog2f.
  for (const [mode, maximum, norm3] of [
    ['flat', 21.437389373779297, 18.247492373285507],
    ['shifted', 3.688140869140625, 3.413823739203926],
  ] as const) {
    const decoded = prepare(mode),
      fine = perceptualDirectionalMap(
        source.fine,
        decoded.fine,
        perceptualQuadraticMaps(source.fine, decoded.fine).asymmetric,
      ),
      half = perceptualDirectionalMap(
        source.half,
        decoded.half,
        perceptualQuadraticMaps(source.half, decoded.half).asymmetric,
      ),
      score = poolNativePerceptual(mixPerceptualScales(fine, half, width, height))
    expect(Math.abs(score.maximum - maximum)).toBeLessThan(0.0002)
    expect(Math.abs(score.norm3 - norm3)).toBeLessThan(0.0002)
  }
})
