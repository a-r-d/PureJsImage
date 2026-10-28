import { expect, it } from 'vitest'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import {
  encodedSectionCosts,
  inspectEntropyModel,
  readDistanceMap,
  windowContrast,
} from '../benchmark/jpegxl/lossy-lab/local-rate-audit.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'

it('reads bottom-up metric maps and validates their extent', () => {
  const header = new TextEncoder().encode('Pf\n1 2\n-1.0\n'),
    bytes = new Uint8Array(header.length + 8)
  bytes.set(header)
  const data = new DataView(bytes.buffer, header.length)
  data.setFloat32(0, 3, true)
  data.setFloat32(4, 1, true)
  expect([...readDistanceMap(bytes).values]).toEqual([1, 3])
  expect(() => readDistanceMap(bytes.subarray(0, bytes.length - 1))).toThrow('extent')
  data.setFloat32(0, NaN, true)
  expect(() => readDistanceMap(bytes)).toThrow('distance')
})
it('accounts for a real multi-group stream and exposes unpadded color bits', async () => {
  const width = 257,
    height = 17
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / width) * 11) % 256,
  )
  const encoded = await encodeTransplant(
    pixels,
    width,
    height,
    2,
    libjxlPortOverrides('standalone-forward-all', 2, width, height),
  )
  const costs = await encodedSectionCosts(encoded.bytes)
  expect(costs.overhead + costs.sections.reduce((sum, s) => sum + s.bytes, 0)).toBe(
    encoded.bytes.length,
  )
  expect(costs.sections.filter((s) => s.kind === 'ac')).toHaveLength(2)
  expect(encoded.colorBits).toBeGreaterThan(0)
  expect(Number.isInteger(encoded.colorBits)).toBe(true)
  expect(encoded.colorBits).toBeLessThan(encoded.bytes.length * 8)
  const entropy = await inspectEntropyModel(encoded.bytes)
  expect(entropy.hfBits).toBeGreaterThan(0)
  expect(entropy.passes[0]?.histograms).toBeGreaterThan(0)
}, 30_000)
it('separates a constant bias from lost local contrast', () => {
  const source = Float64Array.of(1, 3, 1, 3),
    shifted = Float64Array.of(2, 4, 2, 4),
    flat = Float64Array.of(2, 2, 2, 2)
  const box = { x: 0, y: 0, width: 2, height: 2 }
  expect(windowContrast(source, shifted, 2, 2, box).contrastGain).toBe(1)
  expect(windowContrast(source, shifted, 2, 2, box).gradientError).toBe(0)
  expect(windowContrast(source, flat, 2, 2, box).contrastGain).toBe(0)
  expect(windowContrast(source, flat, 2, 2, box).gradientError).toBe(8)
  expect(() => windowContrast(source, flat, 2, 2, { ...box, x: 1 })).toThrow('window')
})
