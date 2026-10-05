import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { hasFlatScreenshotBackground } from '../src/codecs/jpegxl-flat-patches.ts'
import { encodeJpegXlDocumentPatchCandidate } from '../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import {
  encodeLosslessPatchFixture,
  losslessPatchFixture,
  verifyLosslessPatchFixture,
} from './helpers/jpegxl-lossless-patches.ts'
import { verifySmallGroupPatch } from './helpers/jpegxl-small-groups.ts'

const colorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
} as const
const options = {
  mode: 'lossy',
  effort: 7,
  distance: 3,
  progressive: false,
  container: false,
  codestreamLevel: 5,
  sampleBitDepth: 8,
  orientation: 1,
  colorSemantics,
  toneMapping: {
    intensityTarget: 255,
    minNits: 0,
    relativeToMaxDisplay: false,
    linearBelow: 0,
  },
} as const

const patternedPage = (): Uint8Array => {
  const width = 256,
    height = 256,
    pixels = new Uint8Array(width * height * 3)
  pixels.fill(255)
  for (let cellY = 0; cellY < 25; cellY++) {
    for (let cellX = 0; cellX < 25; cellX++) {
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          const offset = ((cellY * 10 + y) * width + cellX * 10 + x) * 3
          pixels[offset] = 18
          pixels[offset + 1] = 24
          pixels[offset + 2] = 30
        }
      }
    }
  }
  return pixels
}

const encodeCandidate = async (pixels: Uint8Array) => {
  const memory = new JpegXlEncoderMemory(268_435_456)
  try {
    return await encodeJpegXlDocumentPatchCandidate(
      pixels,
      256,
      256,
      options,
      memory,
      async () => {},
    )
  } finally {
    memory.close()
  }
}

describe('JPEG XL document reference patches', () => {
  it.each(['rgb8', 'rgba8'] as const)(
    'preserves every %s sample across partial patch groups and a second DC group',
    async (format) => {
      const result = await verifySmallGroupPatch(format)
      expect(result).toMatchObject({
        format,
        bytes: format === 'rgb8' ? 3659 : 4236,
        checksum: format === 'rgb8' ? 3485435651 : 907579079,
        samples: 2049 * 129 * (format === 'rgb8' ? 3 : 4),
        groups: 9,
        dcGroups: 2,
        ownedLive: 0,
        ownedAllocations: 0,
      })
    },
    60_000,
  )

  it.each(['rgb8', 'rgba8'] as const)(
    'keeps the original size for a cheap multi-group %s patch image',
    async (format) => {
      const tile = losslessPatchFixture(format, 'flat')
      const width = format === 'rgb8' ? 2050 : 1025
      const height = 257
      const pixels = new Uint8Array(width * height * tile.channels)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const source = ((y % tile.height) * tile.width + (x % tile.width)) * tile.channels
          const target = (y * width + x) * tile.channels
          for (let channel = 0; channel < tile.channels; channel++)
            pixels[target + channel] = tile.pixels[source + channel] ?? 0
        }
      }
      const original = Uint8Array.from(pixels)
      const result = await encodeLosslessPatchFixture({ ...tile, width, height, pixels })
      // The independently exact baseline has a 40-byte container prefix.
      expect(result.encoded.length).toBe(format === 'rgb8' ? 5255 : 3980)
      let checksum = 0x811c9dc5
      for (const byte of result.encoded) checksum = Math.imul(checksum ^ byte, 0x01000193) >>> 0
      expect(checksum).toBe(format === 'rgb8' ? 501593494 : 2157783432)
      expect(result.ownedLive).toBe(0)
      expect(pixels).toEqual(original)
      const frames = await readJpegXlSourceFrameStructures(
        new MemorySource(result.encoded),
        defaultImageLimits,
      )
      expect(frames.at(-1)?.groupDimension).toBe(1024)
    },
    60_000,
  )

  it.each(['rgb8', 'rgba8'] as const)(
    'selects exact patches on a colored flat background through the public %s encoder',
    async (format) => {
      const result = await verifyLosslessPatchFixture(format, 'flat')
      expect(result.samples).toBe(512 * 512 * (format === 'rgba8' ? 4 : 3))
      expect(result.ownedLive).toBe(0)
    },
    60_000,
  )

  it('reports a structured working-storage limit without modifying caller samples', async () => {
    const fixture = losslessPatchFixture()
    const original = Uint8Array.from(fixture.pixels)
    await expect(encodeLosslessPatchFixture(fixture, 8 * 1024 * 1024)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    expect(fixture.pixels).toEqual(original)
  })

  it.each(['document', 'flat'] as const)(
    'releases component scratch when the bounded %s search stops early',
    async (finder) => {
      const width = 512,
        pixels = new Uint8Array(width * width * 3)
      pixels.fill(255)
      for (let y = 0; y < width; y += 3)
        for (let x = 0; x < width; x += 3) pixels[(y * width + x) * 3] = 0
      const memory = new JpegXlEncoderMemory(8 * 1024 * 1024)
      try {
        expect(
          await encodeJpegXlDocumentPatchCandidate(
            pixels,
            width,
            width,
            options,
            memory,
            async () => {},
            'rgb8',
            finder,
          ),
        ).toBeUndefined()
        expect(memory.liveBytes).toBe(0)
      } finally {
        memory.close()
      }
    },
  )

  it.each(['rgb8', 'rgba8'] as const)(
    'selects exact repeated patches through the public %s encoder',
    async (format) => {
      const result = await verifyLosslessPatchFixture(format)
      expect(result.ownedLive).toBe(0)
      expect(result.samples).toBe(512 * 512 * (format === 'rgba8' ? 4 : 3))
    },
    // This reference search runs beside other large codec cases in the full suite.
    60_000,
  )
  it('preserves exact lossless alpha, invisible RGB and nonpatched samples', async () => {
    const rgb = patternedPage()
    const pixels = new Uint8Array(256 * 256 * 4)
    for (let position = 0; position < 256 * 256; position++) {
      const x = position % 256,
        y = (position / 256) | 0,
        foreground = rgb[position * 3] === 18
      for (let channel = 0; channel < 3; channel++)
        pixels[position * 4 + channel] = foreground
          ? (rgb[position * 3 + channel] ?? 0)
          : 248 + ((x + y + channel) % 8)
      pixels[position * 4 + 3] = foreground
        ? ((x % 10) + (y % 10)) % 3 === 0
          ? 0
          : ((x % 10) + (y % 10)) % 3 === 1
            ? 128
            : 255
        : 255
    }
    const original = Uint8Array.from(pixels)
    const memory = new JpegXlEncoderMemory(268_435_456)
    let candidate: Awaited<ReturnType<typeof encodeJpegXlDocumentPatchCandidate>>
    try {
      candidate = await encodeJpegXlDocumentPatchCandidate(
        pixels,
        256,
        256,
        {
          ...options,
          mode: 'lossless',
          distance: 0,
          alphaBitDepth: 8,
          colorSemantics: { ...colorSemantics, alpha: 'straight' },
        },
        memory,
        async () => {},
        'rgba8',
      )
    } finally {
      memory.close()
    }
    expect(memory.liveBytes).toBe(0)
    expect(pixels).toEqual(original)
    if (!candidate) throw new Error('Missing lossless patch candidate')
    const encoded = new Uint8Array(candidate.byteLength)
    encoded.set(candidate.header)
    let offset = candidate.header.length
    for (const section of candidate.sections) {
      encoded.set(section, offset)
      offset += section.length
    }
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('Missing lossless patch decoder')
    let rows = 0
    for await (const block of decoder.decode()) {
      expect(block.format).toBe('rgba8')
      for (let y = 0; y < block.height; y++) {
        expect(block.data.subarray(y * block.stride, y * block.stride + 256 * 4)).toEqual(
          pixels.subarray((block.y + y) * 256 * 4, (block.y + y + 1) * 256 * 4),
        )
        rows++
      }
      block.release?.()
    }
    expect(rows).toBe(256)
  }, 30_000)

  it('encodes repeated components as a reference frame and restores RGB pixels', async () => {
    const pixels = patternedPage()
    const candidate = await encodeCandidate(pixels)
    expect(candidate).toBeDefined()
    if (!candidate) return
    const encoded = new Uint8Array(candidate.byteLength)
    encoded.set(candidate.header)
    let offset = candidate.header.length
    for (const section of candidate.sections) {
      encoded.set(section, offset)
      offset += section.length
    }
    const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(encoded),
      defaultImageLimits,
    )
    expect(frames.map((frame) => [frame.frameType, frame.encoding, frame.frameFlags])).toEqual([
      ['reference', 'modular', 0],
      ['regular', 'modular', 2],
    ])
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    expect(decoder).toBeDefined()
    if (!decoder) return
    let row = 0
    for await (const block of decoder.decode()) {
      expect(block.format).toBe('rgb8')
      for (let y = 0; y < block.height; y++) {
        const actual = block.data.subarray(y * block.stride, y * block.stride + 256 * 3)
        const expected = pixels.subarray((row + y) * 256 * 3, (row + y + 1) * 256 * 3)
        expect(actual).toEqual(expected)
      }
      row += block.height
      block.release?.()
    }
    expect(row).toBe(256)
  })

  it('does not build a reference frame without repeated foreground', async () => {
    const pixels = new Uint8Array(256 * 256 * 3)
    pixels.fill(255)
    expect(await encodeCandidate(pixels)).toBeUndefined()
  })
})

const repeatedScreenshot = (): Uint8Array => {
  const width = 512
  const pixels = new Uint8Array(width * width * 3)
  pixels.fill(240)
  for (let cellY = 2; cellY < 30; cellY++) {
    for (let cellX = 2; cellX < 30; cellX++) {
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x !== 2 && x !== 5 && y !== 2 && y !== 5) continue
          const at = ((cellY * 16 + y) * width + cellX * 16 + x) * 3
          pixels[at] = 20
          pixels[at + 1] = 30
          pixels[at + 2] = 40
        }
      }
    }
  }
  return pixels
}

describe('JPEG XL lossy screenshot patches', () => {
  it('selects a VarDCT reference and restores repeated glyphs through the public encoder', async () => {
    const pixels = repeatedScreenshot()
    const original = Uint8Array.from(pixels)
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 512,
      height: 512,
      pixelFormat: 'rgb8',
      colorSemantics,
      options: { mode: 'lossy', effort: 7, distance: 3, container: false },
      limits: defaultImageLimits,
    })
    expect(encoder).toBeDefined()
    if (!encoder) return
    await encoder.write({
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      stride: 512 * 3,
      format: 'rgb8',
      data: pixels,
    })
    await encoder.finish()
    expect(pixels).toEqual(original)
    const encoded = sink.toUint8Array()
    const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(encoded),
      defaultImageLimits,
    )
    expect(frames.map((frame) => [frame.frameType, frame.encoding, frame.frameFlags])).toEqual([
      ['reference', 'vardct', 128],
      ['regular', 'vardct', 130],
    ])
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    expect(decoder).toBeDefined()
    if (!decoder) return
    let sumSquared = 0,
      samples = 0
    for await (const block of decoder.decode()) {
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < block.width * 3; x++) {
          const expected = pixels[(block.y + y) * 512 * 3 + x] ?? 0
          const actual = block.data[y * block.stride + x] ?? 0
          sumSquared += (actual - expected) ** 2
          samples++
        }
      }
      block.release?.()
    }
    expect(samples).toBe(pixels.length)
    expect(Math.sqrt(sumSquared / samples)).toBeLessThan(3)
  }, 15_000)

  it('does not classify a nonflat gradient as a screenshot', () => {
    const width = 512,
      pixels = new Uint8Array(width * width * 3)
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 3
        pixels[at] = x & 255
        pixels[at + 1] = y & 255
        pixels[at + 2] = (x + y) & 255
      }
    }
    expect(hasFlatScreenshotBackground(pixels, width, width)).toBe(false)
  })
})
