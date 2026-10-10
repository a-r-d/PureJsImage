import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../../src/color.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

const width = 64,
  height = 48
const semantics: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
}

function unchanged(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.length !== expected.length) throw new Error(`${label}: extent changed`)
  for (let i = 0; i < actual.length; i++)
    if (actual[i] !== expected[i]) throw new Error(`${label}: sample ${i} changed`)
}

async function roundtrip(
  input: Uint8Array,
  format: 'rgb8' | 'rgba8',
  distance: number,
  effort: 1 | 3 | 5 | 7,
  progressive: boolean,
): Promise<Uint8Array> {
  const before = input.slice()
  const channels = format === 'rgb8' ? 3 : 4
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    colorSemantics: { ...semantics, alpha: format === 'rgb8' ? 'none' : 'straight' },
    options: { mode: 'lossy', effort, distance, progressive },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('JPEG XL encoder missing')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * channels,
    format,
    data: input,
  })
  unchanged(input, before, `${format} caller after write`)
  await encoder.finish()
  unchanged(input, before, `${format} caller after finish`)
  const encoded = sink.toUint8Array()
  const encodedBefore = encoded.slice()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder || decoder.width !== width || decoder.height !== height)
    throw new Error('JPEG XL decoded dimensions differ')
  const pixels = new Uint8Array(width * height * 4)
  const visited = new Uint8Array(width * height)
  let covered = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.format !== 'rgb8' && block.format !== 'rgba8')
        throw new Error('Unexpected JPEG XL output format')
      const outputChannels = block.format === 'rgb8' ? 3 : 4
      if (
        !Number.isInteger(block.x) ||
        !Number.isInteger(block.y) ||
        !Number.isInteger(block.width) ||
        !Number.isInteger(block.height) ||
        !Number.isInteger(block.stride) ||
        block.x < 0 ||
        block.y < 0 ||
        block.width <= 0 ||
        block.height <= 0 ||
        block.x + block.width > width ||
        block.y + block.height > height ||
        block.stride < block.width * outputChannels ||
        block.data.length < (block.height - 1) * block.stride + block.width * outputChannels
      )
        throw new Error('Invalid JPEG XL output block extent')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x
          if (visited[pixel] !== 0) throw new Error('Duplicate JPEG XL output pixel')
          visited[pixel] = 1
          covered++
          const source = y * block.stride + x * outputChannels
          const destination = pixel * 4
          pixels[destination] = block.data[source] ?? 0
          pixels[destination + 1] = block.data[source + 1] ?? 0
          pixels[destination + 2] = block.data[source + 2] ?? 0
          // RGB output has implicit opaque alpha; explicit alpha must also remain opaque.
          const alpha = outputChannels === 4 ? block.data[source + 3] : 255
          if (alpha !== 255) throw new Error('Opaque JPEG XL alpha changed')
          pixels[destination + 3] = alpha
        }
    } finally {
      block.release?.()
    }
  }
  if (covered !== width * height || visited.some((value) => value !== 1))
    throw new Error('Incomplete JPEG XL output coverage')
  unchanged(encoded, encodedBefore, 'Decoder caller')
  unchanged(input, before, `${format} caller after decode`)
  return pixels
}

export interface JpegXlRgbRgbaEquivalenceResult {
  readonly width: number
  readonly height: number
  readonly uniqueColors: number
  readonly rows: readonly {
    readonly effort: 1 | 3 | 5 | 7
    readonly distance: number
    readonly comparedColorSamples: number
    readonly opaquePixels: number
    readonly checksum: number
  }[]
}

export async function verifyJpegXlRgbRgbaEquivalence(
  progressive = false,
): Promise<JpegXlRgbRgbaEquivalenceResult> {
  const rgb = new Uint8Array(width * height * 3)
  const rgba = new Uint8Array(width * height * 4)
  const colors = new Set<number>()
  // Smooth illumination with deterministic fine texture, using distinct R/G pairs.
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x
      const r = 20 + x * 3,
        g = 24 + y * 4,
        b = 42 + ((x * 7 + y * 11) % 29) + Math.floor((x + y) * 0.8)
      rgb[pixel * 3] = rgba[pixel * 4] = r
      rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1] = g
      rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2] = b
      rgba[pixel * 4 + 3] = 255
      colors.add((r << 16) | (g << 8) | b)
    }
  if (colors.size !== width * height || colors.size <= 2048)
    throw new Error('Fixture must exceed the small palette population')
  const rows: JpegXlRgbRgbaEquivalenceResult['rows'][number][] = []
  for (const { effort, distance } of [
    { effort: 7, distance: 1.5 },
    { effort: 7, distance: 3 },
    { effort: 7, distance: 7 },
    { effort: 1, distance: 3 },
    { effort: 3, distance: 3 },
    { effort: 5, distance: 3 },
  ] as const) {
    const rgbPixels = await roundtrip(rgb, 'rgb8', distance, effort, progressive)
    const rgbaPixels = await roundtrip(rgba, 'rgba8', distance, effort, progressive)
    unchanged(rgbPixels, rgbaPixels, `RGB/RGBA effort ${effort}, distance ${distance}`)
    let checksum = 0
    for (const value of rgbPixels) checksum = (Math.imul(checksum, 31) + value) >>> 0
    rows.push({
      effort,
      distance,
      comparedColorSamples: width * height * 3,
      opaquePixels: width * height,
      checksum,
    })
  }
  return { width, height, uniqueColors: colors.size, rows }
}
