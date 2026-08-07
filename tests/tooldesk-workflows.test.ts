import { GifWriter } from 'omggif'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { gifCodec } from '../src/codec-entries/gif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { createImageLibrary } from '../src/index.ts'
import { pngFixture } from './fixtures.ts'

type Rgba = readonly [number, number, number, number]

const images = createImageLibrary([jpegCodec, pngCodec, gifCodec])

const rgbaPixels = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): Uint8Array => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4)
  }
  return data
}

const jpegImage = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): Uint8Array => jpeg.encode({ width, height, data: rgbaPixels(width, height, pixel) }, 100).data

const pngImage = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
): Uint8Array => {
  const image = new PNG({ width, height })
  image.data.set(rgbaPixels(width, height, pixel))
  return PNG.sync.write(image)
}

const animatedGif = (width: number, height: number): Uint8Array => {
  const output = new Uint8Array(4096)
  const writer = new GifWriter(output, width, height, { loop: 0 })
  const firstFrame = new Array<number>(width * height).fill(1)
  const secondFrame = new Array<number>(width * height).fill(2)
  const palette = [0x000000, 0x14dc3c, 0xdc1414, 0x1414dc]
  writer.addFrame(0, 0, width, height, firstFrame, { palette })
  writer.addFrame(0, 0, width, height, secondFrame, { palette })
  return output.slice(0, writer.end())
}

const withOrientation = (input: Uint8Array, orientation: 6): Uint8Array => {
  const payload = Uint8Array.of(
    0x45,
    0x78,
    0x69,
    0x66,
    0,
    0,
    0x49,
    0x49,
    0x2a,
    0,
    8,
    0,
    0,
    0,
    1,
    0,
    0x12,
    0x01,
    3,
    0,
    1,
    0,
    0,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  )
  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, 0xe1, 0, payload.byteLength + 2], 0)
  segment.set(payload, 4)
  const output = new Uint8Array(input.byteLength + segment.byteLength)
  output.set(input.subarray(0, 2), 0)
  output.set(segment, 2)
  output.set(input.subarray(2), 2 + segment.byteLength)
  return output
}

const channel = (data: Uint8Array, offset: number): number => data[offset] ?? 0

const alphaBounds = (
  data: Uint8Array,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } => {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) throw new Error('Expected non-transparent logo content')
  return { left, top, right, bottom }
}

const solidGreen: Rgba = [20, 220, 60, 255]
const logoInputs = [
  { name: 'JPEG', input: jpegImage(60, 20, () => solidGreen) },
  { name: 'PNG', input: pngImage(60, 20, () => solidGreen) },
  { name: 'animated GIF first frame', input: animatedGif(60, 20) },
] as const

describe('Tooldesk image workflows', () => {
  it('registers only the three codecs used by the backend', () => {
    expect(images.formats()).toEqual(['jpeg', 'png', 'gif'])
  })

  it('orients before applying the upload width limit', async () => {
    const source = jpegImage(80, 120, (_x, y) => (y < 60 ? [240, 20, 20, 255] : [20, 20, 240, 255]))
    const output = jpeg.decode(
      await (await images.open(withOrientation(source, 6)))
        .autoOrient()
        .resize({ width: 100, withoutEnlargement: true })
        .jpeg({ quality: 80, background: '#ffffff' })
        .toBuffer(),
      { useTArray: true, formatAsRGBA: true, tolerantDecoding: false },
    )

    expect({ width: output.width, height: output.height }).toEqual({ width: 100, height: 67 })
    const left = (33 * output.width + 10) * 4
    const right = (33 * output.width + 90) * 4
    expect(channel(output.data, left + 2) - channel(output.data, left)).toBeGreaterThan(150)
    expect(channel(output.data, right) - channel(output.data, right + 2)).toBeGreaterThan(150)
  })

  it('does not enlarge a small upload and flattens transparency onto white', async () => {
    const source = pngImage(48, 24, (x) => (x < 24 ? [255, 0, 0, 0] : [0, 0, 255, 255]))
    const output = jpeg.decode(
      await (await images.open(source))
        .autoOrient()
        .resize({ width: 1024, withoutEnlargement: true })
        .jpeg({ quality: 100, background: '#ffffff' })
        .toBuffer(),
      { useTArray: true, formatAsRGBA: true, tolerantDecoding: false },
    )

    expect({ width: output.width, height: output.height }).toEqual({ width: 48, height: 24 })
    expect(channel(output.data, 0)).toBeGreaterThan(245)
    expect(channel(output.data, 1)).toBeGreaterThan(245)
    expect(channel(output.data, 2)).toBeGreaterThan(245)
    const blue = (12 * output.width + 40) * 4
    expect(channel(output.data, blue + 2) - channel(output.data, blue)).toBeGreaterThan(200)
  })

  it.each(logoInputs)(
    'normalizes $name onto a centered transparent logo canvas',
    async ({ input }) => {
      const output = PNG.sync.read(
        await (await images.open(input))
          .autoOrient()
          .resize({
            width: 256,
            height: 256,
            fit: 'contain',
            position: 'center',
            background: 'transparent',
          })
          .png({ compressionLevel: 6 })
          .toBuffer(),
      )

      expect({ width: output.width, height: output.height }).toEqual({ width: 256, height: 256 })
      expect(output.data[3]).toBe(0)
      const bounds = alphaBounds(output.data, output.width, output.height)
      expect({ left: bounds.left, right: bounds.right }).toEqual({ left: 0, right: 255 })
      expect(bounds.bottom - bounds.top + 1).toBe(85)
      expect(Math.abs(bounds.top - (output.height - 1 - bounds.bottom))).toBeLessThanOrEqual(1)
      const center = (128 * output.width + 128) * 4
      expect(channel(output.data, center + 1)).toBeGreaterThan(180)
      expect(channel(output.data, center)).toBeLessThan(80)
      expect(channel(output.data, center + 2)).toBeLessThan(80)
    },
  )

  it('enforces the backend byte and pixel limits before processing', async () => {
    const limits = {
      maxInputBytes: 4_000_000,
      maxWidth: 8_192,
      maxHeight: 8_192,
      maxPixels: 16_000_000,
      maxFrames: 1_000,
      maxDecodedBytes: 64_000_000,
    }

    await expect(images.open(new Uint8Array(4_000_001), { limits })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
    await expect(
      (await images.open(pngFixture(4_001, 4_000), { limits })).metadata(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
