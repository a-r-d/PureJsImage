import { expect, it } from 'vitest'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'

it.each([
  'standalone-forward-small',
  'standalone-forward-paired',
  'standalone-forward-all',
] as const)('preserves encoded bytes using %s writer transforms', async (mode) => {
  const width = 129,
    height = 89
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3
      ? 255
      : Math.round(
          80 +
            (i % 4) * 30 +
            25 * Math.sin(Math.floor(i / 4) / 12) +
            10 * Math.cos(Math.floor(i / 4 / width) / 9),
        ),
  )
  const baseline = await encodeTransplant(
    pixels,
    width,
    height,
    2,
    libjxlPortOverrides('standalone-guard-coarse', 2, width, height),
  )
  const candidate = await encodeTransplant(
    pixels,
    width,
    height,
    2,
    libjxlPortOverrides(mode, 2, width, height),
  )
  expect(candidate.bytes).toEqual(baseline.bytes)
})
