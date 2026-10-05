import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import { encodeJpegXlFamilyContextFixture } from './helpers/jpegxl-family-contexts.ts'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const colorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'straight',
  provenance: 'container-signaled',
  renderingIntent: 'relative',
} as const

const encode = async (
  pixels: Uint8Array,
  width: number,
  height: number,
  distance: number,
  maxWorkingBytes = 268435456,
) => {
  const original = pixels.slice(),
    sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    limits: defaultImageLimits,
    colorSemantics,
    options: { mode: 'lossy', effort: 7, distance, maxWorkingBytes },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  try {
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 4,
      format: 'rgba8',
      data: pixels,
    })
    await encoder.finish()
  } finally {
    expect(pixels).toEqual(original)
    expect('managedLiveBytes' in encoder && encoder.managedLiveBytes).toBe(0)
    expect('managedLiveAllocations' in encoder && encoder.managedLiveAllocations).toBe(0)
  }
  if (!('managedPeakBytes' in encoder) || typeof encoder.managedPeakBytes !== 'number')
    throw new Error('Missing managed memory observation')
  expect(encoder.managedPeakBytes).toBeLessThanOrEqual(maxWorkingBytes)
  return sink.toUint8Array()
}

const decode = async (encoded: Uint8Array, width: number, height: number) => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!decoder || decoder.pixelFormat !== 'rgba8') throw new Error('Missing RGBA decoder')
  expect(decoder.width).toBe(width)
  expect(decoder.height).toBe(height)
  const pixels = new Uint8Array(width * height * 4),
    visited = new Uint8Array(width * height)
  for await (const block of decoder.decode()) {
    try {
      expect(block.format).toBe('rgba8')
      for (let y = 0; y < block.height; y++) {
        const start = (block.y + y) * width + block.x
        for (let x = 0; x < block.width; x++) {
          expect(visited[start + x]).toBe(0)
          visited[start + x] = 1
        }
        pixels.set(
          block.data.subarray(y * block.stride, y * block.stride + block.width * 4),
          start * 4,
        )
      }
    } finally {
      block.release?.()
    }
  }
  expect(visited.every((value) => value === 1)).toBe(true)
  return pixels
}

const graphic = () => {
  const pixels = new Uint8Array(128 * 128 * 4)
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const at = (y * 128 + x) * 4,
        shade = x < 4 && y < 4 ? 61 : 8 + ((x * 17 + y * 29) % 224)
      pixels[at] = shade
      pixels[at + 1] = shade + 3
      pixels[at + 2] = shade + 7
      pixels[at + 3] = 255
    }
  return pixels
}

describe('JPEG XL opaque palette compression', () => {
  it('retains the smaller exact Modular winner before comparing quantized edge colors', async () => {
    const fixture = await encodeJpegXlFamilyContextFixture(8, false, true, 16777216)
    // The old complete public file and every original sample pass native and Rust decoders.
    expect(fixture.encoded.length).toBe(2262)
    expect(sha256(fixture.encoded)).toBe(
      'd0bddbfbf37975f0101a448b76a5ff28ea7c06818b7369bf8fb28b212391754f',
    )
    const decoded = await decode(fixture.encoded, fixture.width, fixture.height)
    expect(decoded).toEqual(fixture.pixels)
  }, 30_000)

  it('preserves flat-region colors throughout the image while reducing edge detail', async () => {
    const pixels = graphic(),
      encoded = await encode(pixels, 128, 128, 2)
    // These complete file and pixel fingerprints were independently checked in native and Rust decoders.
    expect(encoded.length).toBe(771)
    expect(sha256(encoded)).toBe('b4625ce925f63aa18b79bae729d25051f767b0dd46fe9d61dab794566fcf8005')
    const decoded = await decode(encoded, 128, 128)
    let checksum = 2166136261,
      maximumError = 0,
      preservedColors = 0
    for (let at = 0; at < pixels.length; at += 4) {
      if (pixels[at] === 61) {
        expect(decoded.subarray(at, at + 4)).toEqual(pixels.subarray(at, at + 4))
        preservedColors++
      }
      expect(decoded[at + 3]).toBe(255)
      for (let channel = 0; channel < 4; channel++) {
        const value = decoded[at + channel] ?? 0
        checksum = Math.imul(checksum ^ value, 16777619) >>> 0
        maximumError = Math.max(maximumError, Math.abs(value - (pixels[at + channel] ?? 0)))
      }
    }
    expect(preservedColors).toBeGreaterThan(16)
    expect(checksum).toBe(2495421557)
    expect(maximumError).toBe(8)
  })

  it('recovers the original primary stream when optional palette storage cannot fit', async () => {
    const pixels = graphic(),
      encoded = await encode(pixels, 128, 128, 2, 1500000)
    expect(encoded.length).toBe(10986)
    expect(sha256(encoded)).toBe('53cdc06172bf2fd1f2801c075eab0dd6811cce244ab7e8619227ba0c9bc7cd8a')
    const decoded = await decode(encoded, 128, 128)
    let maximumError = 0
    for (let at = 0; at < pixels.length; at++) {
      maximumError = Math.max(maximumError, Math.abs((decoded[at] ?? 0) - (pixels[at] ?? 0)))
      if ((at & 3) === 3) expect(decoded[at]).toBe(255)
    }
    // Independent original-color error is ten; shared reconstruction may differ by one level.
    expect(maximumError).toBeLessThanOrEqual(11)
  })

  const cases = [
    {
      name: 'low distance',
      width: 16,
      height: 16,
      distance: 1,
      bytes: 123,
      hash: 'fd06559b7ec9e400b8010090a9284b682b65a8295fbdb11960dc395daa69097e',
    },
    {
      name: 'uniform color',
      width: 16,
      height: 16,
      distance: 8,
      bytes: 85,
      hash: '58a482fd39b92f9470793840257b6ecd7acab6d1d6dab3a067c46c010651cab1',
    },
    {
      name: 'nonopaque colors',
      width: 16,
      height: 16,
      distance: 8,
      bytes: 115,
      hash: '06a7a55e15719dfd2723ab6a60e9806de6d39e409c362ae9e5f5d26665276914',
    },
    {
      name: 'one column',
      width: 1,
      height: 16,
      distance: 8,
      bytes: 101,
      hash: 'ec6251cf3b67db62c6d2962045f4afb525448f0e86bc328dae818834d8734fdf',
    },
  ] as const
  for (const fixture of cases)
    it(`keeps the qualified stream and original alpha for ${fixture.name}`, async () => {
      const pixels = new Uint8Array(fixture.width * fixture.height * 4)
      for (let pixel = 0; pixel < pixels.length / 4; pixel++) {
        const shade = (pixel % 16) * 16,
          at = pixel * 4
        pixels[at] =
          fixture.name === 'uniform color' ? 53 : fixture.name === 'nonopaque colors' ? 23 : shade
        pixels[at + 1] =
          fixture.name === 'uniform color'
            ? 57
            : fixture.name === 'nonopaque colors'
              ? 61
              : Math.min(255, shade + 3)
        pixels[at + 2] =
          fixture.name === 'uniform color'
            ? 61
            : fixture.name === 'nonopaque colors'
              ? 103
              : Math.min(255, shade + 7)
        pixels[at + 3] =
          fixture.name === 'nonopaque colors'
            ? pixel % 3 === 0
              ? 0
              : pixel % 3 === 1
                ? 128
                : 255
            : 255
      }
      const encoded = await encode(pixels, fixture.width, fixture.height, fixture.distance)
      expect(encoded.length).toBe(fixture.bytes)
      expect(sha256(encoded)).toBe(fixture.hash)
      const decoded = await decode(encoded, fixture.width, fixture.height)
      for (let at = 3; at < pixels.length; at += 4) expect(decoded[at]).toBe(pixels[at])
    })
})
