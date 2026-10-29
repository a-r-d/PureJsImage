import { expect, it } from 'vitest'
import { perceptualBlur } from '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-local-port.ts'

/** Scalar definition for verifying traversal changes, including normalized borders. */
function referenceBlur(
  input: Float32Array | Float64Array,
  width: number,
  height: number,
  sigma: number,
) {
  const radius = Math.max(1, Math.floor(2.25 * sigma)),
    kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, i) =>
      Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)),
    )
  let source: Float32Array | Float64Array = input
  for (const horizontal of [true, false]) {
    const output = new Float64Array(width * height),
      extent = horizontal ? width : height
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0,
          weight = 0
        for (let offset = -radius; offset <= radius; offset++) {
          let p = (horizontal ? x : y) + offset
          if (radius === 2) {
            p = ((p % (2 * extent)) + 2 * extent) % (2 * extent)
            if (p >= extent) p = 2 * extent - 1 - p
          } else if (p < 0 || p >= extent) continue
          const coefficient = kernel[offset + radius] ?? 0,
            index = horizontal ? y * width + p : p * width + x
          sum += coefficient * (source[index] ?? 0)
          weight += coefficient
        }
        output[y * width + x] = sum / weight
      }
    source = output
  }
  return source
}

it('keeps each Gaussian sum exact across grouped pixels, scalar tails and tiny borders', () => {
  for (const [width, height] of [
    [1, 1],
    [2, 17],
    [3, 1],
    [4, 5],
    [5, 4],
    [19, 17],
    [67, 53],
  ]) {
    if (!width || !height) throw new Error('Missing dimensions')
    for (const type of ['float32', 'float64']) {
      const input =
        type === 'float32' ? new Float32Array(width * height) : new Float64Array(width * height)
      for (let p = 0; p < input.length; p++) input[p] = ((p % 17) - 8) * 0.135 + Math.sin(p * 0.27)
      for (const sigma of [0.4, 1.2, 1.56416327805, 2.7, 3.22489901262, 7.15593339443])
        expect(perceptualBlur(input, width, height, sigma)).toEqual(
          referenceBlur(input, width, height, sigma),
        )
    }
  }
})

it('can reuse a destination or its input without changing sums or separate source storage', () => {
  for (const [width, height] of [
    [1, 1],
    [2, 17],
    [19, 17],
  ]) {
    if (!width || !height) throw new Error('Missing dimensions')
    const source = Float64Array.from(
        { length: width * height },
        (_, p) => (((p * 17) % 97) - 48) / 32,
      ),
      original = source.slice()
    for (const sigma of [1.2, 1.56416327805, 2.7, 3.22489901262, 7.15593339443]) {
      const expected = referenceBlur(source, width, height, sigma),
        destination = new Float64Array(source.length).fill(Number.NaN),
        aliased = source.slice()
      expect(perceptualBlur(source, width, height, sigma, destination)).toBe(destination)
      expect(destination).toEqual(expected)
      expect(source).toEqual(original)
      expect(perceptualBlur(aliased, width, height, sigma, aliased)).toBe(aliased)
      expect(aliased).toEqual(expected)
    }
    expect(() =>
      perceptualBlur(source, width, height, 1.2, new Float64Array(source.length + 1)),
    ).toThrow('blur')
  }
})

it('preserves unread source rows when destination views overlap with a different layout', () => {
  const width = 19,
    height = 71,
    length = width * height
  for (const float32 of [false, true]) {
    const storage = new ArrayBuffer((length + 2) * 8),
      source = float32
        ? new Float32Array(storage, 0, length)
        : new Float64Array(storage, 0, length),
      destination = new Float64Array(storage, 16, length)
    for (let p = 0; p < source.length; p++) source[p] = (((p * 17) % 97) - 48) / 32
    const expected = referenceBlur(source.slice(), width, height, 7.15593339443)
    expect(perceptualBlur(source, width, height, 7.15593339443, destination)).toBe(destination)
    expect(destination).toEqual(expected)
  }
})
