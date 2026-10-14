import { expect, it } from 'vitest'
import {
  strategyPortOverrides,
  parseStrategyPort,
} from '../benchmark/jpegxl/lossy-lab/libjxl-strategy-port.ts'
import { libjxlPortOverrides } from '../benchmark/jpegxl/lossy-lab/libjxl-ports.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { extractDecisions } from '../benchmark/jpegxl/lossy-lab/decisions.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { MemorySource } from '../src/source.ts'
import { defaultImageLimits } from '../src/limits.ts'

it.each([
  'tiny',
  'spatial',
  'spatial-masked',
  'spatial-guarded',
  'spatial-actual',
  'spatial-actual-guarded',
  'own-rewrite',
  'own-roundtrip',
  'gaborish',
  'gaborish-strategy',
  'dc',
  'dc-smooth',
  'standalone',
  'standalone-fast',
  'standalone-compact',
  'standalone-direct',
  'standalone-sharp5',
  'standalone-sharp6',
  'standalone-epf1',
  'standalone-hfhalf',
  'standalone-symmetric',
  'standalone-bounded',
  'standalone-inverse',
  'standalone-refined',
  'standalone-refined-dcfine',
  'standalone-refined-nosmooth',
  'standalone-refined-round',
  'standalone-refined-dcfine-hfhalf',
  'standalone-refined-dcquarter',
  'standalone-refined-dark-hf',
  'standalone-refined-chroma75',
  'standalone-refined-chroma100',
  'standalone-sharp2',
  'standalone-epf0',
  'standalone-16',
] as const)(
  'encodes a thin odd-sized photo using %s decisions without peer maps',
  async (mode) => {
    const width = 73,
      height = 29
    const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3
        ? 255
        : Math.round(
            80 +
              (i % 4) * 30 +
              15 * Math.sin((Math.floor(i / 4) % width) / 9) +
              10 * Math.cos(Math.floor(i / 4 / width) / 7),
          ),
    )
    const before = pixels.slice()
    const encoded = await encodeTransplant(
      pixels,
      width,
      height,
      2,
      libjxlPortOverrides(mode, 2, width, height),
    )
    expect(pixels).toEqual(before)
    const decisions = await extractDecisions(encoded.bytes)
    expect(decisions.blocksWide).toBe(Math.ceil(width / 8))
    expect(decisions.blocksHigh).toBe(Math.ceil(height / 8))
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded.bytes),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Decoder missing')
    let error = 0,
      samples = 0
    for await (const block of decoder.decode()) {
      try {
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < block.width; x++)
            for (let c = 0; c < 4; c++) {
              const actual = block.data[y * block.stride + x * 4 + c] ?? 0
              if (c === 3) expect(actual).toBe(255)
              else {
                error += Math.abs(
                  actual - (pixels[((block.y + y) * width + block.x + x) * 4 + c] ?? 0),
                )
                samples++
              }
            }
      } finally {
        block.release?.()
      }
    }
    expect(samples).toBe(width * height * 3)
    expect(error / samples).toBeLessThan(5)
  },
  30_000,
)

it('rejects invalid strategy-port modes and distance', () => {
  expect(() => parseStrategyPort('unknown')).toThrow('Unknown strategy port')
  expect(() => strategyPortOverrides(NaN, 'tiny')).toThrow('Invalid strategy-port distance')
})

it('preserves standalone bytes when bounded tile caching crosses tile and image edges', async () => {
  const width = 137,
    height = 75
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / width) * 31) % 256,
  )
  const cached = await encodeTransplant(
    pixels,
    width,
    height,
    2,
    libjxlPortOverrides('standalone', 2, width, height),
  )
  const reference = await encodeTransplant(
    pixels,
    width,
    height,
    2,
    libjxlPortOverrides('standalone-reference', 2, width, height),
  )
  expect(cached.bytes).toEqual(reference.bytes)
})
