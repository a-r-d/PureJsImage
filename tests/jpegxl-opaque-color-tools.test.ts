import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { findFlatScreenshotPatches } from '../src/codecs/jpegxl-flat-patches.ts'
import {
  encodeJpegXlDocumentPatchCandidate,
  estimateJpegXlModularColorBits,
  hasOpaque8BitAlpha,
  hasSmallVisiblePalette,
  resolveJpegXlEncodeOptions,
  isLargeDocumentModularCandidate,
} from '../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const photo = (width: number, height: number) => {
  const rgb = new Uint8Array(width * height * 3)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const grain = (Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801)) >>> 0
      rgb[p * 3] = rgba[p * 4] = (x + (grain >>> 24)) & 255
      rgb[p * 3 + 1] = rgba[p * 4 + 1] = (y + (grain >>> 16)) & 255
      rgb[p * 3 + 2] = rgba[p * 4 + 2] = (x + y + (grain >>> 8)) & 255
      rgba[p * 4 + 3] = 255
    }
  return { rgb, rgba }
}

const encodeDecode = async (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'rgb8' | 'rgba8',
  distance: number,
  effort: 1 | 3 | 5 | 7 = 7,
) => {
  const before = pixels.slice(),
    channels = format === 'rgb8' ? 3 : 4
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    limits: defaultImageLimits,
    colorSemantics: semantics(format),
    options: { mode: 'lossy', effort, distance, container: false },
  })
  if (!encoder) throw new Error('Missing encoder')
  await encoder.write({ x: 0, y: 0, width, height, stride: width * channels, format, data: pixels })
  await encoder.finish()
  for (let i = 0; i < pixels.length; i++)
    if (pixels[i] !== before[i]) throw new Error(`Input changed at ${i}`)
  const bytes = sink.toUint8Array()
  return { ...(await decodeColor(bytes, width, height, format)), bytes }
}

const decodeColor = async (
  bytes: Uint8Array,
  width: number,
  height: number,
  format: 'rgb8' | 'rgba8',
) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!decoder || (decoder.pixelFormat !== 'rgb8' && decoder.pixelFormat !== 'rgba8'))
    throw new Error('Missing 8-bit color decoder')
  const decodedChannels = decoder.pixelFormat === 'rgba8' ? 4 : 3
  if (format === 'rgba8' && decodedChannels !== 4) throw new Error('Alpha plane was omitted')
  const color = new Uint8Array(width * height * 3),
    alpha = new Uint8Array(width * height)
  const visited = new Uint8Array(width * height)
  let count = 0
  for await (const block of decoder.decode()) {
    try {
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const p = (block.y + y) * width + block.x + x,
            at = y * block.stride + x * decodedChannels
          if (p < 0 || p >= visited.length || visited[p])
            throw new Error('Invalid decoder coverage')
          visited[p] = 1
          count++
          color[p * 3] = block.data[at] ?? 0
          color[p * 3 + 1] = block.data[at + 1] ?? 0
          color[p * 3 + 2] = block.data[at + 2] ?? 0
          alpha[p] = decodedChannels === 4 ? (block.data[at + 3] ?? 0) : 255
        }
    } finally {
      block.release?.()
    }
  }
  expect(count).toBe(width * height)
  return { color, alpha }
}

const expectSameColor = (a: Uint8Array, b: Uint8Array) => {
  expect(a.length).toBe(b.length)
  let different = 0,
    maximum = 0
  for (let i = 0; i < a.length; i++) {
    const gap = Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    if (gap !== 0) different++
    maximum = Math.max(maximum, gap)
  }
  expect({ different, maximum }).toEqual({ different: 0, maximum: 0 })
}

describe('Opaque JPEG XL color tools', () => {
  it('counts the same visible palette with RGB and opaque RGBA strides', () => {
    const { rgb, rgba } = photo(64, 48)
    expect(hasSmallVisiblePalette(rgb, undefined, 3)).toBe(false)
    expect(hasSmallVisiblePalette(rgba, undefined, 4)).toBe(false)
    expect(hasSmallVisiblePalette(Uint8Array.of(10, 20, 30, 10, 20, 30), undefined, 3)).toBe(true)
    expect(hasSmallVisiblePalette(Uint8Array.of(10, 20, 30, 255, 10, 20, 30, 255))).toBe(true)
    expect(hasOpaque8BitAlpha(rgba)).toBe(true)
    rgba[3] = 254
    expect(hasOpaque8BitAlpha(rgba)).toBe(false)
  })

  for (const distance of [1.5, 3, 7])
    it(`uses identical public color samples at distance ${distance}`, async () => {
      const width = 64,
        height = 48,
        { rgb, rgba } = photo(width, height)
      const a = await encodeDecode(rgb, width, height, 'rgb8', distance)
      const b = await encodeDecode(rgba, width, height, 'rgba8', distance)
      expectSameColor(a.color, b.color)
      for (const value of b.alpha) expect(value).toBe(255)
    }, 60_000)

  for (const distance of [3, 7])
    it(`uses the same large-transform source weights on a 512-square photo at distance ${distance}`, async () => {
      const width = 512,
        height = 512,
        { rgb, rgba } = photo(width, height)
      const a = await encodeDecode(rgb, width, height, 'rgb8', distance)
      const b = await encodeDecode(rgba, width, height, 'rgba8', distance)
      expectSameColor(a.color, b.color)
      let alphaError = 0
      for (const value of b.alpha) alphaError = Math.max(alphaError, Math.abs(value - 255))
      expect(alphaError).toBe(0)
    }, 60_000)

  it('does not replace a textured grayscale photo merely because it has a small palette', async () => {
    const width = 128,
      height = 128,
      rgb = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const grain = (Math.imul(x + 1, 1597334677) ^ Math.imul(y + 1, 3812015801)) >>> 28
        const value = (x + y + grain) & 255
        rgb.fill(value, (y * width + x) * 3, (y * width + x) * 3 + 3)
      }
    const pair = opaquePair(rgb)
    expect(hasSmallVisiblePalette(pair.rgb, undefined, 3)).toBe(true)
    const a = await encodeDecode(pair.rgb, width, height, 'rgb8', 4)
    const b = await encodeDecode(pair.rgba, width, height, 'rgba8', 4)
    expectSameColor(a.color, b.color)
    expect(b.alpha.every((value) => value === 255)).toBe(true)
    const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(b.bytes),
      defaultImageLimits,
    )
    expect(frames[0]?.encoding).toBe('vardct')
  }, 60_000)

  it('uses bounded color estimates independent of opaque alpha and releases scratch', () => {
    const pair = photo(64, 48),
      memory = new JpegXlEncoderMemory(100_000)
    try {
      const rgb = estimateJpegXlModularColorBits(pair.rgb, 64, 3, memory)
      const rgba = estimateJpegXlModularColorBits(pair.rgba, 64, 4, memory)
      expect(rgb).toBe(rgba)
      expect(Number.isFinite(rgb)).toBe(true)
      expect(rgb).toBeGreaterThan(0)
      expect(memory.liveBytes).toBe(0)
      expect(() => estimateJpegXlModularColorBits(new Uint8Array(0), 64, 3, memory)).toThrow()
      expect(() => estimateJpegXlModularColorBits(pair.rgb, 65, 3, memory)).toThrow()
    } finally {
      memory.close()
    }
    expect(memory.liveBytes).toBe(0)
  })

  it('preserves true alpha when the opaque color admission does not apply', async () => {
    const width = 64,
      height = 48,
      { rgba } = photo(width, height)
    rgba[3] = 0
    rgba[67] = 37
    expect(hasOpaque8BitAlpha(rgba)).toBe(false)
    const decoded = await encodeDecode(rgba, width, height, 'rgba8', 3)
    let maximum = 0
    for (let p = 0; p < decoded.alpha.length; p++)
      maximum = Math.max(maximum, Math.abs((decoded.alpha[p] ?? 0) - (rgba[p * 4 + 3] ?? 0)))
    expect(maximum).toBe(0)
  }, 60_000)
})

const opaquePair = (rgb: Uint8Array) => {
  const rgba = new Uint8Array((rgb.length / 3) * 4)
  for (let p = 0; p < rgb.length / 3; p++) {
    rgba[p * 4] = rgb[p * 3] ?? 0
    rgba[p * 4 + 1] = rgb[p * 3 + 1] ?? 0
    rgba[p * 4 + 2] = rgb[p * 3 + 2] ?? 0
    rgba[p * 4 + 3] = 255
  }
  return { rgb, rgba }
}
const page = (width: number, height: number, spacing = 10) => {
  const rgb = new Uint8Array(width * height * 3)
  rgb.fill(255)
  for (let gy = 0; gy < Math.floor(height / spacing); gy++)
    for (let gx = 0; gx < Math.floor(width / spacing); gx++)
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 6; x++) {
          const at = ((gy * spacing + y) * width + gx * spacing + x) * 3
          rgb[at] = 18
          rgb[at + 1] = 24
          rgb[at + 2] = 30
        }
  return opaquePair(rgb)
}
const semantics = (format: 'rgb8' | 'rgba8') =>
  ({
    family: 'rgb',
    primaries: 'srgb',
    transfer: { kind: 'srgb' },
    matrix: 'identity',
    range: 'full',
    alpha: format === 'rgba8' ? 'straight' : 'none',
    provenance: 'assumed-default',
    renderingIntent: 'relative',
  }) as const

describe('Opaque JPEG XL public replacement tools', () => {
  it('uses the same quantized artwork colors below the 2048-color limit', async () => {
    const width = 128,
      height = 64,
      rgb = new Uint8Array(width * height * 3)
    for (let p = 0; p < width * height; p++) {
      const value = p % 1024
      rgb[p * 3] = value & 255
      rgb[p * 3 + 1] = (value >>> 2) & 255
      rgb[p * 3 + 2] = (value >>> 4) & 255
    }
    const pair = opaquePair(rgb)
    expect(hasSmallVisiblePalette(pair.rgb, undefined, 3)).toBe(true)
    expect(hasSmallVisiblePalette(pair.rgba, undefined, 4)).toBe(true)
    const a = await encodeDecode(pair.rgb, width, height, 'rgb8', 3)
    const b = await encodeDecode(pair.rgba, width, height, 'rgba8', 3)
    expectSameColor(a.color, b.color)
    expect(b.alpha.every((value) => value === 255)).toBe(true)
  }, 60_000)

  it('keeps thin colored edges equal without a palette admission', async () => {
    const width = 129,
      height = 65,
      pair = photo(width, height)
    for (let y = 0; y < height; y++) {
      const p = y * width + 63
      pair.rgb[p * 3] = pair.rgba[p * 4] = 255
      pair.rgb[p * 3 + 1] = pair.rgba[p * 4 + 1] = 0
      pair.rgb[p * 3 + 2] = pair.rgba[p * 4 + 2] = 200
    }
    expect(hasSmallVisiblePalette(pair.rgb, undefined, 3)).toBe(false)
    const a = await encodeDecode(pair.rgb, width, height, 'rgb8', 3)
    const b = await encodeDecode(pair.rgba, width, height, 'rgba8', 3)
    expectSameColor(a.color, b.color)
    expect(b.alpha.every((value) => value === 255)).toBe(true)
  }, 60_000)

  it('retains opaque alpha in the shared public screenshot reference/display path', async () => {
    const width = 512,
      height = 512,
      pair = page(width, height, 16)
    const memory = new JpegXlEncoderMemory(32_000_000)
    try {
      const rgbGroups = findFlatScreenshotPatches(pair.rgb, width, height, memory, 3, false)
      const rgbaGroups = findFlatScreenshotPatches(pair.rgba, width, height, memory, 4, false)
      expect(rgbaGroups).toEqual(rgbGroups)
    } finally {
      memory.close()
    }
    expect(memory.liveBytes).toBe(0)
    const a = await encodeDecode(pair.rgb, width, height, 'rgb8', 3)
    const b = await encodeDecode(pair.rgba, width, height, 'rgba8', 3)
    expect(
      (await readJpegXlSourceFrameStructures(new MemorySource(a.bytes), defaultImageLimits)).length,
    ).toBe(2)
    expect(
      (await readJpegXlSourceFrameStructures(new MemorySource(b.bytes), defaultImageLimits)).length,
    ).toBe(2)
    expectSameColor(a.color, b.color)
    expect(b.alpha.every((value) => value === 255)).toBe(true)
  }, 60_000)

  it('admits the same large white document and rejects true alpha', () => {
    const width = 2800,
      height = 3000
    const rgb = new Uint8Array(width * height * 3),
      rgba = new Uint8Array(width * height * 4)
    rgb.fill(255)
    rgba.fill(255)
    const options = {
      effort: 7,
      distance: 3,
      progressive: false,
      sampleBitDepth: 8,
      colorSemantics: semantics('rgb8'),
    } as const
    expect(isLargeDocumentModularCandidate(rgb, width, height, 'rgb8', options)).toBe(true)
    expect(
      isLargeDocumentModularCandidate(rgba, width, height, 'rgba8', {
        ...options,
        colorSemantics: semantics('rgba8'),
      }),
    ).toBe(true)
    rgba[3] = 254
    expect(
      isLargeDocumentModularCandidate(rgba, width, height, 'rgba8', {
        ...options,
        colorSemantics: semantics('rgba8'),
      }),
    ).toBe(false)
  })

  it('keeps document atlas/display color and alpha identical through the shared representation', async () => {
    const width = 256,
      height = 256,
      pair = page(width, height)
    const outputs: Uint8Array[] = []
    for (const format of ['rgb8', 'rgba8'] as const) {
      const pixels = format === 'rgb8' ? pair.rgb : pair.rgba
      const memory = new JpegXlEncoderMemory(64_000_000)
      try {
        const options = resolveJpegXlEncodeOptions(
          { mode: 'lossy', effort: 7, distance: 3, container: false },
          format,
          semantics(format),
          width,
          height,
        )
        const candidate = await encodeJpegXlDocumentPatchCandidate(
          pixels,
          width,
          height,
          options,
          memory,
          async () => {},
          format,
          'document',
          false,
          0,
          true,
        )
        if (!candidate) throw new Error('Document fixture must qualify')
        const sink = new Uint8ArraySink()
        await sink.write(candidate.header)
        for (const section of candidate.sections) await sink.write(section)
        outputs.push(sink.toUint8Array())
      } finally {
        memory.close()
      }
      expect(memory.liveBytes).toBe(0)
    }
    const rgbBytes = outputs[0],
      rgbaBytes = outputs[1]
    if (!rgbBytes || !rgbaBytes) throw new Error('Missing outputs')
    const a = await decodeColor(rgbBytes, width, height, 'rgb8')
    const b = await decodeColor(rgbaBytes, width, height, 'rgba8')
    expectSameColor(a.color, b.color)
    expect(b.alpha.every((value) => value === 255)).toBe(true)
  }, 60_000)
})

describe('Opaque JPEG XL lower-effort color equivalence', () => {
  for (const effort of [3, 5] as const)
    for (const [width, height] of [
      [64, 48],
      [129, 65],
    ])
      it(`keeps RGB/RGBA color at effort ${effort}, ${width}x${height}`, async () => {
        if (width === undefined || height === undefined) throw new Error('Fixture size missing')
        const pair = photo(width, height)
        expect(hasSmallVisiblePalette(pair.rgb, undefined, 3)).toBe(false)
        const a = await encodeDecode(pair.rgb, width, height, 'rgb8', 3, effort)
        const b = await encodeDecode(pair.rgba, width, height, 'rgba8', 3, effort)
        expectSameColor(a.color, b.color)
        expect(b.alpha.every((value) => value === 255)).toBe(true)
        const rgbFrames = await readJpegXlSourceFrameStructures(
          new MemorySource(a.bytes),
          defaultImageLimits,
        )
        const rgbaFrames = await readJpegXlSourceFrameStructures(
          new MemorySource(b.bytes),
          defaultImageLimits,
        )
        expect(rgbaFrames.map((frame) => frame.epfIterations)).toEqual(
          rgbFrames.map((frame) => frame.epfIterations),
        )
      }, 60_000)
})

// Held separately: the 264x16 case crosses two groups and exercises RGB deferred DC.
describe('Opaque JPEG XL effort-one color arithmetic', () => {
  for (const [width, height] of [
    [64, 48],
    [264, 16],
    [129, 65],
  ])
    it(`keeps RGB/RGBA color at effort 1, ${width}x${height}`, async () => {
      if (width === undefined || height === undefined) throw new Error('Fixture size missing')
      const pair = photo(width, height)
      expect(hasSmallVisiblePalette(pair.rgb, undefined, 3)).toBe(false)
      const a = await encodeDecode(pair.rgb, width, height, 'rgb8', 3, 1)
      const b = await encodeDecode(pair.rgba, width, height, 'rgba8', 3, 1)
      expectSameColor(a.color, b.color)
      expect(b.alpha.every((value) => value === 255)).toBe(true)
    }, 60_000)
})
