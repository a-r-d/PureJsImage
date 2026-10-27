import { expect, it } from 'vitest'
import {
  displayAuditTransforms,
  transformSquareRgba,
} from '../benchmark/jpegxl/lossy-lab/display-audit-transform.ts'
import {
  displayLinearPlanes,
  displayXyb,
  downsampleDisplay,
  displayLossPyramid,
  type DisplayPlanes,
} from '../benchmark/jpegxl/lossy-lab/libjxl-display-loss.ts'
function image(width: number, height: number): Uint8Array {
  return Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (Math.floor(i / 4) * 17 + (i % 4) * 41) % 256,
  )
}
it('uses exact displayed bytes and leaves input untouched', () => {
  const bytes = Uint8Array.of(0, 255, 128, 255),
    before = bytes.slice(),
    p = displayLinearPlanes(bytes, 1, 1)
  expect(p[0][0]).toBe(0)
  expect(p[1][0]).toBe(1)
  expect(p[2][0]).toBeCloseTo(0.2158605, 6)
  expect(bytes).toEqual(before)
  expect(() => displayLinearPlanes(Uint8Array.of(0, 0, 0, 0), 1, 1)).toThrow('opaque')
  expect(() => displayLinearPlanes(bytes, 2, 1)).toThrow('extent')
})
it('replicates odd edges when downsampling linear RGB', () => {
  const p = Float32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8),
    before = p.slice()
  const out = downsampleDisplay([p, p, p], 3, 3)
  expect(Array.from(out[0])).toEqual([2, 3.5, 6.5, 8])
  expect(p).toEqual(before)
})
it('RGB and XYB scale construction differ on mixed color detail', () => {
  const p = displayLinearPlanes(image(16, 16), 16, 16)
  const a = displayXyb(downsampleDisplay(p, 16, 16)),
    b = downsampleDisplay(displayXyb(p), 16, 16)
  expect(Math.max(...a[1].map((v, i) => Math.abs(v - (b[1][i] ?? 0))))).toBeGreaterThan(0.01)
})
it.each(['rgb', 'xyb'] as const)(
  'preserves identity and detects distortion with %s pooling',
  (pooling) => {
    const p = displayLinearPlanes(image(32, 32), 32, 32)
    const black: DisplayPlanes = [
      new Float32Array(1024),
      new Float32Array(1024),
      new Float32Array(1024),
    ]
    const identity = displayLossPyramid(p, p, 32, 32, pooling)
    expect(identity).toHaveLength(3)
    expect(Math.max(...identity.map(Math.abs))).toBeLessThan(1e-8)
    expect(
      displayLossPyramid(p, black, 32, 32, pooling).reduce((a, b) => a + b, 0),
    ).toBeGreaterThan(0.1)
    expect(() => displayLossPyramid(p, black, 16, 16, pooling)).toThrow('extent')
  },
)

it.each([
  { radius: 5, border: 'clamp' },
  { radius: 3, border: 'zero' },
  { radius: 5, border: 'zero' },
  { radius: 5, border: 'zero', float32: true },
  { radius: 4, border: 'zero', float32: true },
  { radius: 4, border: 'zero', moment64: true },
] as const)('preserves identity with explicit blur settings %j', (options) => {
  const p = displayLinearPlanes(image(17, 19), 17, 19)
  const before = p.map((plane) => plane.slice())
  const loss = displayLossPyramid(p, p, 17, 19, 'rgb', 6, options)
  expect(loss.every(Number.isFinite)).toBe(true)
  expect(Math.max(...loss.map(Math.abs))).toBeLessThan(1e-8)
  expect(p).toEqual(before)
})

it('normalizes the source cosine blur and preserves its symmetric impulse response', async () => {
  const { ssimCosineKernel } = await import('../benchmark/jpegxl/lossy-lab/libjxl-ssim-blur.ts')
  const kernel = ssimCosineKernel()
  expect(kernel.length).toBe(9)
  expect(kernel.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
  expect(Math.min(...kernel)).toBeGreaterThan(0)
  for (let i = 0; i < 9; i++) expect(kernel[i]).toBe(kernel[8 - i])
})

it.each(displayAuditTransforms)('permutes pixels exactly and inverts %s', (kind) => {
  const pixels = image(3, 3),
    before = pixels.slice()
  const output = transformSquareRgba(pixels, 3, kind)
  expect(transformSquareRgba(output, 3, kind)).toEqual(pixels)
  expect(pixels).toEqual(before)
  expect(output).not.toBe(pixels)
  const expected = {
    identity: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    flipX: [2, 1, 0, 5, 4, 3, 8, 7, 6],
    flipY: [6, 7, 8, 3, 4, 5, 0, 1, 2],
    rotate180: [8, 7, 6, 5, 4, 3, 2, 1, 0],
    transpose: [0, 3, 6, 1, 4, 7, 2, 5, 8],
  }[kind]
  for (let i = 0; i < 9; i++) {
    const from = expected[i] ?? -1
    expect(output.slice(i * 4, i * 4 + 4)).toEqual(pixels.slice(from * 4, from * 4 + 4))
  }
  expect(() => transformSquareRgba(pixels, 4, kind)).toThrow('extent')
})

it('keeps the double-moment diagnostic nearly invariant under image reflections', () => {
  const a = image(32, 32),
    b = a.slice()
  for (let i = 0; i < b.length; i += 4) b[i] = Math.floor((b[i] ?? 0) / 8) * 8
  const losses = displayAuditTransforms.map((kind) =>
    displayLossPyramid(
      displayLinearPlanes(transformSquareRgba(a, 32, kind), 32, 32),
      displayLinearPlanes(transformSquareRgba(b, 32, kind), 32, 32),
      32,
      32,
      'rgb',
      6,
      { radius: 4, border: 'zero', moment64: true },
    ).reduce((sum, value) => sum + value, 0),
  )
  expect(Math.max(...losses) - Math.min(...losses)).toBeLessThan(1e-5)
})
