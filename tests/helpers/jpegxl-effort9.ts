import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { createJpegXlEncodeOperation } from '../../src/pipeline.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import type { PixelFormat } from '../../src/pixel.ts'
import { Uint8ArraySink } from '../../src/sink.ts'
import { MemorySource } from '../../src/source.ts'

export interface EffortFixture {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly channels: 1 | 3 | 4
  readonly depth: 8 | 16
  readonly progressive?: boolean
  readonly opaque?: boolean
}
export const effortFixtures: readonly EffortFixture[] = [
  { name: 'rgb', width: 129, height: 65, channels: 3, depth: 8 },
  { name: 'rgba-opaque', width: 129, height: 65, channels: 4, depth: 8, opaque: true },
  { name: 'rgba-alpha', width: 129, height: 65, channels: 4, depth: 8 },
  { name: 'gray', width: 33, height: 25, channels: 1, depth: 8 },
  { name: 'gray16', width: 33, height: 25, channels: 1, depth: 16 },
  { name: 'rgb16', width: 33, height: 25, channels: 3, depth: 16 },
  { name: 'rgba16', width: 33, height: 25, channels: 4, depth: 16 },
  { name: 'progressive', width: 129, height: 65, channels: 4, depth: 8, progressive: true },
  { name: 'thin', width: 513, height: 1, channels: 3, depth: 8 },
  { name: 'multi-group', width: 257, height: 33, channels: 3, depth: 8 },
  {
    name: 'progressive-multi-group',
    width: 513,
    height: 129,
    channels: 4,
    depth: 8,
    progressive: true,
  },
]
export async function encodeEffortFixture(
  fixture: EffortFixture,
  effort: 7 | 9,
  distance = 3,
  mode: 'lossy' | 'lossless' = 'lossy',
) {
  const { width, height, channels, depth } = fixture
  const format: PixelFormat =
    channels === 1
      ? depth === 8
        ? 'gray8'
        : 'gray16'
      : channels === 3
        ? depth === 8
          ? 'rgb8'
          : 'rgb16'
        : depth === 8
          ? 'rgba8'
          : 'rgba16'
  const pixels = new Uint8Array(width * height * channels * (depth / 8))
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < channels; channel++) {
        const value =
          channel === 3
            ? fixture.opaque
              ? 255
              : (x * 17 + y * 11) & 255
            : Math.round(
                120 +
                  50 * Math.sin((x + channel * 5) / 13) +
                  40 * Math.cos((y + channel * 3) / 9) +
                  ((x * 3 + y * 7 + channel * 13) % 23),
              )
        const offset = ((y * width + x) * channels + channel) * (depth / 8)
        pixels[offset] = value
        if (depth === 16) pixels[offset + 1] = value
      }
  const before = pixels.slice()
  // This exercises the typed pipeline validator as well as the codec entry point.
  const options =
    mode === 'lossy'
      ? { mode, effort, distance, progressive: fixture.progressive ?? false }
      : { mode, effort }
  createJpegXlEncodeOperation(options)
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    limits: defaultImageLimits,
    options: { ...options, sampleBitDepth: depth, maxWorkingBytes: 32_000_000 },
    colorSemantics: {
      family: channels === 1 ? 'gray' : 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: channels === 4 ? 'straight' : 'none',
      provenance: 'assumed-default',
      renderingIntent: 'relative',
    },
  })
  if (!encoder) throw new Error('Effort fixture encoder missing')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * channels * (depth / 8),
    format,
    data: pixels,
  })
  await encoder.finish()
  if (
    !('managedLiveBytes' in encoder) ||
    encoder.managedLiveBytes !== 0 ||
    !('managedLiveAllocations' in encoder) ||
    encoder.managedLiveAllocations !== 0
  )
    throw new Error('Effort fixture retained scratch')
  for (let i = 0; i < pixels.length; i++)
    if (pixels[i] !== before[i]) throw new Error('Effort fixture changed input')
  return { bytes: sink.toUint8Array(), pixels, format, fixture }
}
export async function verifyEffortFixture(fixture: EffortFixture) {
  const encoded = await encodeEffortFixture(fixture, 9)
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(encoded.bytes),
    defaultImageLimits,
  )
  if (
    !decoder ||
    decoder.width !== fixture.width ||
    decoder.height !== fixture.height ||
    decoder.pixelFormat !== encoded.format
  )
    throw new Error('Effort fixture changed layout')
  let rows = 0,
    checksum = 0,
    alphaError = 0
  for await (const block of decoder.decode()) {
    try {
      if (block.y !== rows || block.x !== 0 || block.width !== fixture.width)
        throw new Error('Effort fixture row coverage changed')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < fixture.width; x++)
          for (let channel = 0; channel < fixture.channels; channel++) {
            const at = y * block.stride + (x * fixture.channels + channel) * (fixture.depth / 8)
            const value =
              fixture.depth === 8
                ? (block.data[at] ?? 0)
                : ((block.data[at] ?? 0) << 8) | (block.data[at + 1] ?? 0)
            checksum = (Math.imul(checksum, 31) + value) >>> 0
            if (channel === 3) {
              const source =
                ((block.y + y) * fixture.width + x) * fixture.channels * (fixture.depth / 8) +
                channel * (fixture.depth / 8)
              const original =
                fixture.depth === 8
                  ? (encoded.pixels[source] ?? 0)
                  : ((encoded.pixels[source] ?? 0) << 8) | (encoded.pixels[source + 1] ?? 0)
              alphaError = Math.max(alphaError, Math.abs(value - original))
            }
          }
      rows += block.height
    } finally {
      block.release?.()
    }
  }
  if (rows !== fixture.height || alphaError !== 0)
    throw new Error('Effort fixture coverage or exact alpha changed')
  return { name: fixture.name, bytes: encoded.bytes.length, checksum, alphaError, rows }
}
export async function verifyEffort9Browser() {
  const results = []
  for (const name of ['rgba-alpha', 'gray16', 'progressive', 'progressive-multi-group', 'thin']) {
    const fixture = effortFixtures.find((row) => row.name === name)
    if (!fixture) throw new Error('Missing effort fixture')
    results.push(await verifyEffortFixture(fixture))
  }
  return results
}
