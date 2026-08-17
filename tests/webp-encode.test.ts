import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { Image } from './image-library.ts'

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

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

const logoRgba = (width = 240, height = 96): Uint8Array =>
  writeRgbaPng(width, height, (x, y) => {
    const dx = x - width / 2
    const dy = y - height / 2
    const inside = (dx * dx) / (width * width * 0.2) + (dy * dy) / (height * height * 0.12) < 1
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

  it('keeps pinned lossless bitstreams for the official logo and odd RGBA fixtures', async () => {
    const logo = await (await Image.open(logoRgba(1200, 480))).webp({ lossless: true }).toBuffer()
    expect(logo.byteLength).toBe(2188)
    expect(sha256(logo)).toBe('44a5f0e6925af63fa0305ea86b57544b9288d855c66507a5e853637ea00d0a1f')
    const logoPixels = await sharpRgba(logo)
    const logoDecoded = PNG.sync.read(await (await Image.open(logo)).png().toBuffer())
    expect(logoDecoded.data).toEqual(logoPixels)
    expect(sample(logoDecoded.data, 1200, 0, 0)).toEqual([0, 0, 0, 0])

    const odd = await (await Image.open(oddRgba())).webp({ lossless: true }).toBuffer()
    expect(odd.byteLength).toBe(1846)
    expect(sha256(odd)).toBe('8e6cb43e37b3f2b0c1213dea59d2e85b0c09bfa1b20b7c84e18a7896a68ce3ee')
    const oddDecoded = PNG.sync.read(await (await Image.open(odd)).png().toBuffer())
    expect(await sharpRgba(odd)).toEqual(oddDecoded.data)
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

  it('encodes a resized photograph with stable samples', async () => {
    const photograph = writeRgbaPng(640, 480, (x, y) => {
      const texture = ((x * 29 + y * 17 + ((x * y) % 97)) & 31) - 16
      return [
        Math.max(0, Math.min(255, Math.round(40 + (x * 140) / 640 + texture))),
        Math.max(0, Math.min(255, Math.round(70 + (y * 110) / 480 - texture / 2))),
        Math.max(0, Math.min(255, Math.round(160 - (y * 80) / 480 + texture / 3))),
        255,
      ]
    })
    const jpeg = await (await Image.open(photograph)).jpeg({ quality: 90 }).toBuffer()
    const encoded = await (await Image.open(jpeg))
      .resize({ width: 320 })
      .webp({ quality: 80 })
      .toBuffer()
    const decoded = await sharpRgba(encoded)
    const points = [
      { x: 0, y: 0, rgb: [42, 69, 156] },
      { x: 80, y: 60, rgb: [76, 97, 140] },
      { x: 160, y: 120, rgb: [110, 125, 120] },
      { x: 240, y: 180, rgb: [144, 153, 102] },
      { x: 319, y: 239, rgb: [178, 178, 78] },
    ]
    for (const point of points) {
      const actual = sample(decoded, 320, point.x, point.y)
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs((actual[channel] ?? 0) - (point.rgb[channel] ?? 0))).toBeLessThanOrEqual(20)
      }
      expect(actual[3]).toBe(255)
    }
    const ours = PNG.sync.read(await (await Image.open(encoded)).png().toBuffer())
    expect(psnr(decoded, ours.data)).toBeGreaterThan(35)
  })
})
