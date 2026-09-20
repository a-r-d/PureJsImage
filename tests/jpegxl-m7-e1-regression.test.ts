import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import largeContextFixture from './fixtures/jpegxl/m7-effort1-context-map/manifest.json' with {
  type: 'json',
}

const baselines = {
  'groups-256': {
    bytes: 152571,
    source: '9a5587ff9fcf18a923625115a4433af4e0037c58f3cac1e0e3595f57345d6ed4',
    decoded: 'a2b922f7d5a880f478e54a4dc5092c18c5032c0f68b4ed16496c8513e34b4f88',
  },
  'groups-257': {
    bytes: 152587,
    source: '44f5e6b0612ee8cb1561cf1e06eba6fff62a2ecc912977e196efd78b2d6d340c',
    decoded: '52ff87399968bac6a3dd28d3eed5950b0ba2476e73115326e32c2548c134c347',
  },

  varied: {
    bytes: 189405,
    source: '5c5432eefb7924f0a3c7f15493d7032c387b7766a19888bba32211cd34be8d80',
    decoded: 'e138a4d13040a4bec2d102e8609a3edcb18e318ebb76fde2260b96675b2de875',
  },
  'dc-only': {
    bytes: 8793,
    source: 'e9378c272914d5428d4804ee129efb44d741d1b136a118bc6abfbe479c3610ab',
    decoded: 'd529611bc68ddc3bf380cc8fba7ae7698d3daaa1596a4276f3c1f804ba0ac96e',
  },
  flat: {
    bytes: 1736,
    source: 'bde576005cc970dc89faeb687d1dc23f79aac5b26a34e538f2cf87186049ed03',
    decoded: 'bde576005cc970dc89faeb687d1dc23f79aac5b26a34e538f2cf87186049ed03',
  },
}
describe('JPEG XL effort-1 entropy selection', () => {
  it('decodes a real 192-group effort-1 stream with 285120 entropy contexts', async () => {
    const bytes = await readFile('tests/fixtures/jpegxl/m7-effort1-context-map/image.jxl')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(largeContextFixture.encodedSha256)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
    if (!decoder) throw new Error('Decoder')
    let nextSample = 0,
      nextRow = 0,
      maximum = 0
    for await (const block of decoder.decode()) {
      try {
        if (block.format !== 'rgb8') throw new Error('Expected RGB8 output')
        expect([block.x, block.y, block.width]).toEqual([0, nextRow, largeContextFixture.width])
        while (nextSample < largeContextFixture.samples.length) {
          const sample = largeContextFixture.samples[nextSample]
          if (!sample) throw new Error('Missing native sample')
          const y = Math.floor(sample.pixel / largeContextFixture.width)
          if (y >= block.y + block.height) break
          const x = sample.pixel % largeContextFixture.width
          for (let channel = 0; channel < 3; channel++)
            maximum = Math.max(
              maximum,
              Math.abs(
                (block.data[(y - block.y) * block.stride + x * 3 + channel] ?? -1000) -
                  (sample.rgb[channel] ?? 1000),
              ),
            )
          nextSample++
        }
        nextRow += block.height
      } finally {
        block.release?.()
      }
    }
    expect(nextRow).toBe(largeContextFixture.height)
    expect(nextSample).toBe(largeContextFixture.samples.length)
    expect(maximum).toBeLessThanOrEqual(largeContextFixture.maximumDifference)
  }, 30_000)

  for (const kind of ['varied', 'dc-only', 'flat', 'groups-256', 'groups-257'] as const) {
    it(`preserves decoded pixels and the byte-size ceiling for ${kind}`, async () => {
      const grouped = kind === 'groups-256' || kind === 'groups-257'
      const width = grouped ? (kind === 'groups-256' ? 65536 : 65537) : 513,
        height = grouped ? 9 : 257
      const pixels = new Uint8Array(width * height * 3)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (let c = 0; c < 3; c++)
            pixels[(y * width + x) * 3 + c] = grouped
              ? c === 0
                ? x & 255
                : c === 1
                  ? (x >>> 8) & 255
                  : ((x * 13 + y * 29) >>> 3) & 255
              : kind === 'flat'
                ? 128
                : kind === 'dc-only'
                  ? ((x >> 3) * 17 + (y >> 3) * 11 + c * 53) & 255
                  : (x * 17 + y * 11 + c * 53 + ((x * y) >> 4)) & 255
      const sink = new Uint8ArraySink()
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width,
        height,
        pixelFormat: 'rgb8',
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: 'none',
          provenance: 'assumed-default',
          renderingIntent: 'relative',
        },
        options: { mode: 'lossy', distance: 1, effort: 1, maxWorkingBytes: 16 * 1024 * 1024 },
      })
      if (!encoder) throw new Error('Encoder')
      await encoder.write({
        x: 0,
        y: 0,
        width,
        height,
        stride: width * 3,
        format: 'rgb8',
        data: pixels,
      })
      await encoder.finish()
      const bytes = sink.toUint8Array()
      expect(bytes.length).toBeLessThanOrEqual(baselines[kind].bytes)
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Decoder')
      const decoded = new Uint8Array(pixels.length)
      for await (const block of decoder.decode()) {
        if (block.format !== 'rgb8') throw new Error('Format')
        for (let y = 0; y < block.height; y++)
          decoded.set(
            block.data.subarray(y * block.stride, y * block.stride + block.width * 3),
            ((block.y + y) * width + block.x) * 3,
          )
        block.release?.()
      }
      expect(createHash('sha256').update(pixels).digest('hex')).toBe(baselines[kind].source)
      expect(createHash('sha256').update(decoded).digest('hex')).toBe(baselines[kind].decoded)
    }, 30000)
  }
})
