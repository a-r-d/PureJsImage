import { expect, it } from 'vitest'
import { renderSelectedGeometry } from '../benchmark/jpegxl/lossy-lab/geometry-display.ts'
import { decodeDisplayStages } from '../benchmark/jpegxl/lossy-lab/display-error-trace.ts'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import { libjxlDitheredRgba } from '../benchmark/jpegxl/lossy-lab/libjxl-output-dither-port.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { estimateJpegXlDevelopmentRate } from '../src/codecs/jpegxl-vardct-encode.ts'

it.each([
  [37, 25, 0.45, 0],
  [37, 25, 2, 1],
  [37, 25, 7.5, 1],
  [263, 33, 2, 1],
  [37, 25, 2, 2],
  [37, 25, 2, 3],
])(
  'reconstructs selected geometry before entropy coding (%s x %s, distance %s)',
  async (width, height, distance, epfIterations) => {
    if (
      width === undefined ||
      height === undefined ||
      distance === undefined ||
      epfIterations === undefined
    )
      throw new Error('Missing case')
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 7 + Math.floor(i / width) * 11) % 256,
    )
    const options = libjxlPortOverrides('standalone-forward-all', distance, width, height),
      rewrite = options.rewriteGeometry
    if (!rewrite) throw new Error('Missing standalone selector')
    const captures: ReturnType<typeof renderSelectedGeometry>[] = []
    const encoded = await encodeTransplant(pixels, width, height, distance, {
      ...options,
      rewriteGeometry(base, context) {
        const original = rewrite(base, context)
        if (!original.developmentFilters) throw new Error('Missing filters')
        const selected = {
          ...original,
          developmentFilters: { ...original.developmentFilters, epfIterations },
        }
        expect(() =>
          renderSelectedGeometry({ ...selected, smoothDc: true }, width, height),
        ).toThrow('retained standalone')
        expect(() =>
          renderSelectedGeometry({ ...selected, opaqueColorCost: false }, width, height),
        ).toThrow('retained standalone')
        expect(() =>
          renderSelectedGeometry({ ...selected, globalScale: Infinity }, width, height),
        ).toThrow('development filter extent')
        expect(() => estimateJpegXlDevelopmentRate(selected)).toThrow('forward order search')
        captures.push(renderSelectedGeometry(selected, width, height))
        return selected
      },
    })
    expect(captures.length).toBe(1)
    const direct = captures[0]
    if (!direct) throw new Error('Missing direct reconstruction')
    const decoded = await decodeDisplayStages(encoded.bytes)
    for (const [actual, expected] of [
      [direct.raw, decoded.raw],
      [direct.filtered, decoded.epf],
      [direct.srgb, decoded.srgb],
    ] as const) {
      let maximumError = 0
      for (let c = 0; c < 3; c++)
        for (let p = 0; p < width * height; p++)
          maximumError = Math.max(
            maximumError,
            Math.abs((actual[c]?.[p] ?? 0) - (expected[c]?.[p] ?? 0)),
          )
      expect(maximumError).toBe(0)
    }
    expect(direct.rgba).toEqual(libjxlDitheredRgba(decoded.srgb, width, height))
  },
  30000,
)

it('estimates the final grouped entropy model without changing the stream', async () => {
  const width = 263,
    height = 257,
    distance = 2,
    pixels = Uint8Array.from({ length: width * height * 4 }, (_, p) =>
      p % 4 === 3 ? 255 : (p * 7 + Math.floor(p / width) * 11) % 256,
    )
  const options = libjxlPortOverrides('standalone-forward-all', distance, width, height),
    rewrite = options.rewriteGeometry
  if (!rewrite) throw new Error('Missing standalone selector')
  let estimate = 0
  const measured = await encodeTransplant(pixels, width, height, distance, {
    ...options,
    rewriteGeometry(base, context) {
      const selected = rewrite(base, context)
      estimate = estimateJpegXlDevelopmentRate(selected)
      return selected
    },
  })
  const control = await encodeTransplant(
    pixels,
    width,
    height,
    distance,
    libjxlPortOverrides('standalone-forward-all', distance, width, height),
  )
  expect(Math.abs(estimate - measured.colorBits)).toBeLessThan(256)
  expect(measured.bytes).toEqual(control.bytes)
}, 30000)
