import { GifWriter } from 'omggif'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { gifCodec } from '../src/codec-entries/gif.ts'
import { jpegCodec } from '../src/codec-entries/jpeg.ts'
import { pngCodec } from '../src/codec-entries/png.ts'
import { crc32 } from '../src/codecs/crc32.ts'
import type { ImageSource } from '../src/index.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { pngFixture } from './fixtures.ts'

type Rgba = readonly [number, number, number, number]

const images = createNodeImageLibrary([jpegCodec, pngCodec, gifCodec])

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

const splitPngImageData = (input: Uint8Array, maximumChunkBytes: number): Uint8Array => {
  const chunks: Uint8Array[] = [input.subarray(0, 8)]
  let offset = 8
  while (offset < input.byteLength) {
    const length = new DataView(input.buffer, input.byteOffset + offset, 4).getUint32(0)
    const type = input.subarray(offset + 4, offset + 8)
    const data = input.subarray(offset + 8, offset + 8 + length)
    if (type[0] === 0x49 && type[1] === 0x44 && type[2] === 0x41 && type[3] === 0x54) {
      for (let dataOffset = 0; dataOffset < data.byteLength; dataOffset += maximumChunkBytes) {
        const part = data.subarray(
          dataOffset,
          Math.min(data.byteLength, dataOffset + maximumChunkBytes),
        )
        const chunk = new Uint8Array(part.byteLength + 12)
        const view = new DataView(chunk.buffer)
        view.setUint32(0, part.byteLength)
        chunk.set(type, 4)
        chunk.set(part, 8)
        view.setUint32(8 + part.byteLength, crc32(type, part))
        chunks.push(chunk)
      }
    } else {
      chunks.push(input.subarray(offset, offset + length + 12))
    }
    offset += length + 12
  }
  return Buffer.concat(chunks)
}

class CountingBlob extends Blob {
  slicedBytes = 0
  slices = 0

  override slice(start = 0, end = this.size, contentType?: string): Blob {
    this.slicedBytes += Math.max(0, end - start)
    this.slices += 1
    return super.slice(start, end, contentType)
  }
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

  it('coalesces fragmented PNG reads for custom and Blob inputs', async () => {
    let state = 0x91e1_0da5
    const input = splitPngImageData(
      pngImage(440, 440, () => {
        state = (Math.imul(state ^ (state >>> 15), 2_246_822_519) + 3_266_489_917) >>> 0
        return [state & 0xff, (state >>> 8) & 0xff, (state >>> 16) & 0xff, 255]
      }),
      3_072,
    )
    let backingBytes = 0
    let backingReads = 0
    const source: ImageSource = {
      size: input.byteLength,
      async read(offset, length) {
        backingBytes += length
        backingReads += 1
        return input.subarray(offset, offset + length)
      },
    }
    const blob = new CountingBlob([Uint8Array.from(input)])

    const customOutput = await (await images.open(source))
      .resize({ width: 160 })
      .jpeg({ quality: 80 })
      .toBuffer()
    const blobOutput = await (await images.open(blob))
      .resize({ width: 160 })
      .jpeg({ quality: 80 })
      .toBuffer()

    expect(input.byteLength).toBeGreaterThan(640_000)
    expect(backingReads).toBeLessThanOrEqual(3)
    expect(backingBytes).toBe(input.byteLength)
    expect(blob.slices).toBeLessThanOrEqual(3)
    expect(blob.slicedBytes).toBe(input.byteLength)
    expect(blobOutput).toEqual(customOutput)
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
