import { describe, expect, it } from 'vitest'
import { extractDecisions } from '../benchmark/jpegxl/lossy-lab/decisions.ts'
import {
  encodeTransplant,
  parseTransplantComponent,
  transplantOverrides,
} from '../benchmark/jpegxl/lossy-lab/transplant.ts'
import { encodeJpegXlVarDct8Async } from '../src/codecs/jpegxl-vardct-encode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'

const width = 32,
  height = 32
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
  i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / 128) * 37) % 256,
)

describe('development decision transplant', () => {
  it('keeps the development forcing option out of the public codec', async () => {
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width,
        height,
        pixelFormat: 'rgba8',
        limits: defaultImageLimits,
        options: { mode: 'lossy', developmentDecisions: {} },
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: 'straight',
          provenance: 'container-signaled',
          renderingIntent: 'relative',
        },
      }),
    ).rejects.toThrow('developmentDecisions')
  })
  it('preserves the ordinary forward encoder in the control', async () => {
    const memory = new JpegXlEncoderMemory(268_435_456)
    try {
      const parts = await encodeJpegXlVarDct8Async(
        pixels,
        width,
        height,
        2,
        memory,
        async () => {},
        4,
        7,
      )
      const encoded = await encodeTransplant(pixels, width, height, 2, {})
      const codestream = Uint8Array.from(parts.flatMap((p) => Array.from(p)))
      expect(encoded.bytes.length).toBe(codestream.length + 40)
      expect(new DataView(encoded.bytes.buffer).getUint32(32)).toBe(codestream.length + 8)
      expect(encoded.bytes.slice(40)).toEqual(codestream)
    } finally {
      memory.close()
    }
  })
  it('signals the forced raw quant field, correlation and filter values', async () => {
    const own = await encodeTransplant(pixels, width, height, 2, {})
    const decisions = await extractDecisions(own.bytes)
    const rawQuantization = Array.from({ length: 16 }, (_, i) => 4 + (i % 3))
    const parameters = {
      colorFactor: 84,
      baseCorrelationX: 0,
      baseCorrelationB: 1,
      yToXDc: 3,
      yToBDc: -4,
    }
    const quant = await encodeTransplant(
      pixels,
      width,
      height,
      2,
      transplantOverrides('quant', { ...decisions, globalScale: 4000, rawQuantization }),
    )
    const q = await extractDecisions(quant.bytes)
    expect(q.globalScale).toBe(4000)
    expect(q.rawQuantization).toEqual(rawQuantization)
    const cfl = await encodeTransplant(
      pixels,
      width,
      height,
      2,
      transplantOverrides('cfl', {
        ...decisions,
        colorCorrelation: parameters,
        correlationX: [7],
        correlationB: [-8],
      }),
    )
    const c = await extractDecisions(cfl.bytes)
    expect(c.colorCorrelation).toEqual(parameters)
    expect(c.correlationX).toEqual([7])
    expect(c.correlationB).toEqual([-8])
    const sharpness = Array.from({ length: 16 }, (_, i) => i % 8)
    const filtered = await encodeTransplant(
      pixels,
      width,
      height,
      2,
      transplantOverrides('filters', { ...decisions, gaborish: true, epfIterations: 3, sharpness }),
    )
    const f = await extractDecisions(filtered.bytes)
    expect(f.gaborish).toBe(true)
    expect(f.epfIterations).toBe(3)
    expect(f.sharpness).toEqual(sharpness)
  })
  it('forces DC physical precision without changing the AC global scale', async () => {
    const own = await encodeTransplant(pixels, width, height, 2, {})
    const decisions = await extractDecisions(own.bytes)
    const d = {
      ...decisions,
      globalScale: 4096,
      quantDc: 8,
      dcQuantization: [1 / 1024, 1 / 512, 1 / 256] as const,
    }
    const encoded = await encodeTransplant(pixels, width, height, 2, transplantOverrides('dc', d))
    const actual = await extractDecisions(encoded.bytes)
    expect(actual.globalScale).toBe(decisions.globalScale)
    for (let c = 0; c < 3; c++)
      expect((actual.dcQuantization[c] ?? 0) / actual.globalScale / actual.quantDc).toBeCloseTo(
        (d.dcQuantization[c] ?? 0) / d.globalScale / d.quantDc,
        10,
      )
  })
  it('keeps varying quantizers exact across an otherwise mergeable footprint', async () => {
    const photo = new Uint8Array(64 * 64 * 4)
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const at = (y * 64 + x) * 4
        photo[at] = Math.round(100 + 20 * Math.sin(x / 14) + 5 * Math.sin(y / 9))
        photo[at + 1] = Math.round(130 + 20 * Math.cos(x / 13) + 10 * Math.sin(y / 15))
        photo[at + 2] = Math.round(160 + 10 * Math.sin(x / 11) + 15 * Math.cos(y / 7))
        photo[at + 3] = 255
      }
    const q = Int32Array.from({ length: 64 }, (_, i) => 4 + (i % 3))
    const encoded = await encodeTransplant(photo, 64, 64, 3, {
      globalScale: 5461,
      quantizationMap: q,
    })
    const actual = await extractDecisions(encoded.bytes)
    expect(actual.rawQuantization).toEqual(Array.from(q))
    expect(actual.strategies).not.toContain(4)
  })
  it('rejects missing writer support instead of reporting a partial transplant', async () => {
    const own = await encodeTransplant(pixels, width, height, 2, {})
    const decisions = await extractDecisions(own.bytes)
    expect(() => transplantOverrides('all', { ...decisions, strategies: [21] })).toThrow('64x64')
    expect(() => transplantOverrides('features', { ...decisions, noise: [1] })).toThrow()
    expect(() => parseTransplantComponent('unknown')).toThrow()
    await expect(
      encodeTransplant(pixels, width, height, 2, { quantizationMap: new Int32Array(1) }),
    ).rejects.toThrow('extent')
  })
})
