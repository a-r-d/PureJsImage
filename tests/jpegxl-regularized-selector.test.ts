import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import { selectorRegularizedDetailLoss } from '../benchmark/jpegxl/lossy-lab/libjxl-selector-detail-loss.ts'

// Frozen before the exact kernel changes. Cover thin images, clamped borders,
// odd extents and tile boundaries across fine, medium and coarse distances.
it.each([
  {
    width: 1,
    height: 17,
    distance: 0.65,
    hash: '98e791150d2cd10b52987703b44dff83af772621de960550e5e46d50f3f39987',
    managedPeakBytes: 1138757,
  },
  {
    width: 1,
    height: 17,
    distance: 2,
    hash: 'c1308a81aa694523966c619ecb9bbfc086eae426a7978a85d759299ce074b528',
    managedPeakBytes: 1138757,
  },
  {
    width: 1,
    height: 17,
    distance: 7,
    hash: 'dba737c51506016bafc758466a3742746eedbc1566379154c36dbf009a32e9eb',
    managedPeakBytes: 1138757,
  },
  {
    width: 17,
    height: 1,
    distance: 0.65,
    hash: '9dd324cd10c73f38fbcd1c2226f6c9e0ac18d1d99302f9c4c97dd2e81ac2674f',
    managedPeakBytes: 1138757,
  },
  {
    width: 17,
    height: 1,
    distance: 2,
    hash: '1165c3da1d04631b330b8d4b7e6051a74ac409a13f6a2d3476df418fbf0f55c5',
    managedPeakBytes: 1138757,
  },
  {
    width: 17,
    height: 1,
    distance: 7,
    hash: 'c3c9b490e83cc4c4cd1283719e3db92f1c2e875d75a9cdfe90db4857b01023bc',
    managedPeakBytes: 1138757,
  },
  {
    width: 17,
    height: 19,
    distance: 0.65,
    hash: 'f99d3528d5c396bbb61f662f0c0d3266b4e2b62ce0295e40ef0467d5f973ea2e',
    managedPeakBytes: 1140167,
  },
  {
    width: 17,
    height: 19,
    distance: 2,
    hash: 'f822db9a0ba82865e9eb9ef1fcdd6bff5962b04250d91c1129eecd761f50b0a8',
    managedPeakBytes: 1140167,
  },
  {
    width: 17,
    height: 19,
    distance: 7,
    hash: '35414b596d83c54d46285db28ccf2ffc1a00d0d2e7c45a8c5bead73fd0207689',
    managedPeakBytes: 1140167,
  },
  {
    width: 65,
    height: 73,
    distance: 0.65,
    hash: '8da156fcf5bc49e82a3425ed9518415a8be628057cffcbfc66aac7f49a830a63',
    managedPeakBytes: 1167099,
  },
  {
    width: 65,
    height: 73,
    distance: 2,
    hash: 'f30eb3180d6eeaa656a0da74513e9472f037bebf382a96b88427537f2583924e',
    managedPeakBytes: 1167096,
  },
  {
    width: 65,
    height: 73,
    distance: 7,
    hash: '91e6c2ab785ac75d9c92a54ba705d34119bef143cfa3c7835343f75a97da27d3',
    managedPeakBytes: 1167063,
  },
])(
  'preserves regularized output at $width x $height / $distance',
  async ({ width, height, distance, hash, managedPeakBytes }) => {
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / width) * 37) % 256,
    )
    const before = pixels.slice()
    const result = await encodeTransplant(
      pixels,
      width,
      height,
      distance,
      libjxlPortOverrides('standalone-regularized-half', distance, width, height),
    )
    expect(pixels).toEqual(before)
    expect(createHash('sha256').update(result.bytes).digest('hex')).toBe(hash)
    expect(result.managedPeakBytes).toBeLessThanOrEqual(managedPeakBytes)
  },
)

it('excludes constant offsets and stabilizes flat local detail', () => {
  const source = new Float32Array(64).fill(0.5),
    residual = new Float32Array(64).fill(0.125)
  expect(selectorRegularizedDetailLoss(source, residual, 8, 8, 1)).toBe(0)
  source.forEach((_, i) => {
    source[i] = i % 2 ? 1 : -1
    residual[i] = (i % 2 ? 1 : -1) * 0.5
  })
  expect(selectorRegularizedDetailLoss(source, residual, 8, 8, 1)).toBeCloseTo(
    16 / (64 + 16 + 64 * 0.0009),
    14,
  )
  const smaller = Float32Array.from(residual, (value) => value / 2)
  expect(selectorRegularizedDetailLoss(source, smaller, 8, 8, 2)).toBe(
    selectorRegularizedDetailLoss(source, residual, 8, 8, 1),
  )
})
