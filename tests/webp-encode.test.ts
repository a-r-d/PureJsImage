import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { Image } from './image-library.ts'

const tundra = 'benchmark/corpus/files/tundra-4000x3000.jpg'

const writeRgbaPng = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const [red, green, blue, alpha] = pixel(x, y)
      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = alpha
    }
  }
  return PNG.sync.write(image)
}

const oddRgba = (): Uint8Array =>
  writeRgbaPng(257, 193, (x, y) => [x & 255, y & 255, (x * 17 + y * 31) & 255, (x + y) & 255])

const logoRgba = (): Uint8Array =>
  writeRgbaPng(240, 96, (x, y) => {
    const dx = x - 120
    const dy = y - 48
    const inside = (dx * dx) / (240 * 240 * 0.2) + (dy * dy) / (96 * 96 * 0.12) < 1
    return inside ? [20, 110 + ((x >>> 3) & 63), 210, 220] : [0, 0, 0, 0]
  })

const photoRgb = (): Uint8Array => {
  const width = 160
  const height = 120
  const output = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3
      const texture = ((x * 29 + y * 17 + ((x * y) % 97)) & 31) - 16
      output[offset] = Math.max(0, Math.min(255, 40 + (x * 140) / width + texture))
      output[offset + 1] = Math.max(0, Math.min(255, 70 + (y * 110) / height - texture / 2))
      output[offset + 2] = Math.max(0, Math.min(255, 160 - (y * 80) / height + texture / 3))
    }
  }
  return output
}

const photoPng = (): Uint8Array => {
  const width = 160
  const height = 120
  const rgb = photoRgb()
  const image = new PNG({ width, height })
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    image.data[pixel * 4] = rgb[pixel * 3] ?? 0
    image.data[pixel * 4 + 1] = rgb[pixel * 3 + 1] ?? 0
    image.data[pixel * 4 + 2] = rgb[pixel * 3 + 2] ?? 0
    image.data[pixel * 4 + 3] = 255
  }
  return PNG.sync.write(image)
}

const psnr = (expected: Uint8Array, actual: Uint8Array): number => {
  expect(actual.byteLength).toBe(expected.byteLength)
  let squaredError = 0
  for (let index = 0; index < expected.byteLength; index += 1) {
    const difference = (actual[index] ?? 0) - (expected[index] ?? 0)
    squaredError += difference * difference
  }
  if (squaredError === 0) return Number.POSITIVE_INFINITY
  return 10 * Math.log10((255 * 255 * expected.byteLength) / squaredError)
}

const sharpRgba = async (input: Uint8Array): Promise<Uint8Array> => {
  const { data } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data
}

const sample = (
  pixels: Uint8Array,
  width: number,
  x: number,
  y: number,
): readonly [number, number, number, number] => {
  const offset = (y * width + x) * 4
  return [
    pixels[offset] ?? 0,
    pixels[offset + 1] ?? 0,
    pixels[offset + 2] ?? 0,
    pixels[offset + 3] ?? 0,
  ]
}

describe('WebP encode baselines', { timeout: 30_000 }, () => {
  it('encodes deterministic lossy and lossless bitstreams for the same pixels', async () => {
    const source = oddRgba()
    const image = await Image.open(source)
    const lossyFirst = await image.webp({ quality: 80 }).toBuffer()
    const lossySecond = await image.webp({ quality: 80 }).toBuffer()
    const losslessFirst = await image.webp({ lossless: true }).toBuffer()
    const losslessSecond = await image.webp({ lossless: true }).toBuffer()
    expect(lossyFirst).toEqual(lossySecond)
    expect(losslessFirst).toEqual(losslessSecond)
  })

  it('keeps lossy quality monotonic in size and reconstruction', async () => {
    const image = await Image.open(photoPng())
    const low = await image.webp({ quality: 30 }).toBuffer()
    const mid = await image.webp({ quality: 60 }).toBuffer()
    const high = await image.webp({ quality: 90 }).toBuffer()
    expect(low.byteLength).toBeLessThan(mid.byteLength)
    expect(mid.byteLength).toBeLessThan(high.byteLength)
    const source = photoRgb()
    const lowPsnr = psnr(source, await sharp(low).removeAlpha().raw().toBuffer())
    const highPsnr = psnr(source, await sharp(high).removeAlpha().raw().toBuffer())
    expect(highPsnr).toBeGreaterThan(lowPsnr)
    expect(highPsnr).toBeGreaterThan(28)
  })

  it('round-trips lossless RGBA, including odd dimensions and transparent corners', async () => {
    const source = oddRgba()
    const encoded = await (await Image.open(source)).webp({ lossless: true }).toBuffer()
    const ours = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
    const oracle = await sharpRgba(encoded)
    expect(ours.data).toEqual(PNG.sync.read(Buffer.from(source)).data)
    expect(oracle).toEqual(ours.data)
    expect(sample(ours.data, 257, 0, 0)).toEqual([0, 0, 0, 0])
    expect(sample(ours.data, 257, 64, 48)).toEqual([64, 48, 16, 112])
    expect(sample(ours.data, 257, 128, 96)).toEqual([128, 96, 32, 224])
    expect(sample(ours.data, 257, 256, 192)).toEqual([0, 192, 64, 192])
  })

  it('round-trips the production-style logo through lossless WebP exactly', async () => {
    const source = logoRgba()
    const encoded = await (await Image.open(source)).webp({ lossless: true }).toBuffer()
    const decoded = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
    expect(decoded.data).toEqual(PNG.sync.read(Buffer.from(source)).data)
    expect(await sharpRgba(encoded)).toEqual(decoded.data)
    expect(sample(decoded.data, 240, 0, 0)).toEqual([0, 0, 0, 0])
    expect(sample(decoded.data, 240, 120, 48)).toEqual([20, 125, 210, 220])
    expect(sample(decoded.data, 240, 100, 40)).toEqual([20, 122, 210, 220])
  })

  it('preserves lossy alpha and stays near the source RGB', async () => {
    const source = logoRgba()
    const encoded = await (await Image.open(source)).webp({ quality: 80 }).toBuffer()
    const decoded = await sharpRgba(encoded)
    const corner = sample(decoded, 240, 0, 0)
    expect(corner[3]).toBe(0)
    expect(corner[0]).toBeLessThanOrEqual(8)
    expect(corner[1]).toBeLessThanOrEqual(8)
    expect(corner[2]).toBeLessThanOrEqual(8)
    const center = sample(decoded, 240, 120, 48)
    expect(Math.abs(center[0] - 20)).toBeLessThanOrEqual(18)
    expect(Math.abs(center[1] - 125)).toBeLessThanOrEqual(18)
    expect(Math.abs(center[2] - 210)).toBeLessThanOrEqual(18)
    expect(center[3]).toBe(220)
  })

  it('encodes the tundra resize with stable photograph samples', async () => {
    const image = await Image.open(await readFile(tundra))
    const encoded = await image.resize({ width: 1200 }).webp({ quality: 80 }).toBuffer()
    const decoded = await sharpRgba(encoded)
    const points = [
      { x: 0, y: 0, rgb: [165, 216, 255] },
      { x: 300, y: 225, rgb: [95, 107, 81] },
      { x: 600, y: 450, rgb: [157, 168, 92] },
      { x: 900, y: 675, rgb: [93, 138, 62] },
      { x: 1199, y: 899, rgb: [194, 204, 181] },
    ]
    for (const point of points) {
      const actual = sample(decoded, 1200, point.x, point.y)
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs((actual[channel] ?? 0) - (point.rgb[channel] ?? 0))).toBeLessThanOrEqual(20)
      }
      expect(actual[3]).toBe(255)
    }
    const ours = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
    expect(psnr(decoded, ours.data)).toBeGreaterThan(35)
  })
})
