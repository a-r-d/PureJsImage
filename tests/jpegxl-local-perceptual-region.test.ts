import { expect, it } from 'vitest'
import {
  displayLinearPlanes,
  downsampleDisplay,
} from '../benchmark/jpegxl/lossy-lab/libjxl-display-loss.ts'
import {
  perceptualQuadraticMaps,
  preparePerceptualLinear,
} from '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-local-port.ts'
import {
  mixPerceptualScales,
  perceptualDirectionalMap,
} from '../benchmark/jpegxl/lossy-lab/libjxl-perceptual-malta-port.ts'
import {
  localPerceptualMap,
  prepareLocalPerceptualReference,
} from '../benchmark/jpegxl/lossy-lab/local-perceptual-region.ts'

it('matches a full-image map at odd interior coordinates and both image edges', () => {
  const width = 385,
    height = 321,
    source = new Uint8Array(width * height * 4),
    decoded = source.slice()
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        const value = 30 + ((x * 3 + y * 7 + c * 19 + ((x * y) % 31)) % 180),
          p = (y * width + x) * 4 + c
        source[p] = c === 3 ? 255 : value
        decoded[p] = c === 3 ? 255 : value + ((x + y) % 7) - 3
      }
  const prepare = (rgba: Uint8Array) => {
    const rgb = displayLinearPlanes(rgba, width, height)
    return {
      fine: preparePerceptualLinear(rgb, width, height),
      half: preparePerceptualLinear(
        downsampleDisplay(rgb, width, height),
        Math.ceil(width / 2),
        Math.ceil(height / 2),
      ),
    }
  }
  const a = prepare(source),
    b = prepare(decoded),
    fine = perceptualDirectionalMap(
      a.fine,
      b.fine,
      perceptualQuadraticMaps(a.fine, b.fine).asymmetric,
    ),
    half = perceptualDirectionalMap(
      a.half,
      b.half,
      perceptualQuadraticMaps(a.half, b.half).asymmetric,
    ),
    full = mixPerceptualScales(fine, half, width, height)
  for (const box of [
    { x: 173, y: 157, width: 9, height: 7 },
    { x: 0, y: 0, width: 9, height: 7 },
    { x: 376, y: 314, width: 9, height: 7 },
  ]) {
    const reference = prepareLocalPerceptualReference(source, width, height, box),
      local = localPerceptualMap(reference, decoded)
    expect(reference.crop.width * reference.crop.height).toBeLessThan(width * height)
    for (let y = 0; y < box.height; y++)
      for (let x = 0; x < box.width; x++)
        expect(
          Math.abs((local[y * box.width + x] ?? 0) - (full[(y + box.y) * width + x + box.x] ?? 0)),
        ).toBeLessThan(1e-10)
  }
  expect(() =>
    prepareLocalPerceptualReference(source, width, height, { x: 0, y: 0, width: 257, height: 2 }),
  ).toThrow('window')
})
