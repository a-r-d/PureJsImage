import { PNG } from 'pngjs'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { crc32 } from '../src/codecs/crc32.ts'
import { Image } from './image-library.ts'

type Rgba = readonly [number, number, number, number]

const png = (width: number, height: number, pixel: (x: number, y: number) => Rgba): Buffer => {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      image.data.set(pixel(x, y), (y * width + x) * 4)
    }
  }
  return PNG.sync.write(image)
}

const pixel = (image: PNG, x: number, y: number): Rgba => {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 0,
  ]
}

const colors = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 0, 255],
] as const

const rawPng = (
  width: number,
  height: number,
  colorType: 0 | 2 | 6,
  pixel: readonly number[],
): Buffer => {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4
  const rows = Buffer.alloc((width * channels + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1)
    for (let x = 0; x < width; x += 1) {
      rows.set(pixel, row + 1 + x * channels)
    }
  }
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const name = Buffer.from(type, 'ascii')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.byteLength)
    const checksum = Buffer.alloc(4)
    checksum.writeUInt32BE(crc32(name, data))
    return Buffer.concat([length, name, data, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = colorType
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ])
}

describe('explicit geometric transforms', () => {
  it('flips vertically and flops horizontally', async () => {
    const input = png(2, 2, (x, y) => colors[y * 2 + x] ?? colors[0])
    const flipped = PNG.sync.read(await (await Image.open(input)).flip().png().toBuffer())
    const flopped = PNG.sync.read(await (await Image.open(input)).flop().png().toBuffer())

    expect(pixel(flipped, 0, 0)).toEqual(colors[2])
    expect(pixel(flipped, 1, 1)).toEqual(colors[1])
    expect(pixel(flopped, 0, 0)).toEqual(colors[1])
    expect(pixel(flopped, 1, 1)).toEqual(colors[2])
  })

  it('rotates clockwise in quarter turns and composes later stages', async () => {
    const input = png(2, 3, (x, y) => [x * 100, y * 70, x + y, 255])
    const pipeline = (await Image.open(input))
      .rotate(90)
      .crop({ x: 1, y: 0, width: 2, height: 2 })
      .resize({ width: 1, height: 1, fit: 'fill', kernel: 'nearest' })
    const output = PNG.sync.read(await pipeline.png().toBuffer())

    await expect(pipeline.metadata()).resolves.toMatchObject({ width: 1, height: 1 })
    expect(pixel(output, 0, 0)).toEqual([100, 0, 1, 255])
  })

  it('uses bilinear sampling and a transparent expanded canvas for arbitrary angles', async () => {
    const input = png(3, 3, (x, y) => (x === 1 && y === 1 ? colors[0] : [0, 0, 0, 255]))
    const pipeline = (await Image.open(input)).rotate(45)
    const output = PNG.sync.read(await pipeline.png().toBuffer())

    await expect(pipeline.metadata()).resolves.toMatchObject({
      width: 5,
      height: 5,
      hasAlpha: true,
    })
    expect(pixel(output, 2, 2)).toEqual(colors[0])
    expect(pixel(output, 0, 0)[3]).toBe(0)
  })

  it('rotates across source and destination tile boundaries', async () => {
    const input = png(65, 47, (x, y) => [x * 3, y * 5, (x + y) * 2, 255])
    const pipeline = (await Image.open(input)).rotate(33)
    const output = PNG.sync.read(await pipeline.png().toBuffer())
    const metadata = await pipeline.metadata()

    expect(output.width).toBe(metadata.width)
    expect(output.height).toBe(metadata.height)
    expect(pixel(output, Math.floor(output.width / 2), Math.floor(output.height / 2))[3]).toBe(255)
    expect(pixel(output, 0, 0)[3]).toBe(0)
  })

  it.each([
    { label: 'gray8', input: rawPng(7, 5, 0, [80]), expected: [80, 80, 80, 255] },
    { label: 'rgb8', input: rawPng(7, 5, 2, [10, 90, 200]), expected: [10, 90, 200, 255] },
    { label: 'rgba8', input: rawPng(7, 5, 6, [10, 90, 200, 128]), expected: [10, 90, 200, 128] },
  ])(
    'rotates $label source pixels through the specialized sampler',
    async ({ input, expected }) => {
      const output = PNG.sync.read(await (await Image.open(input)).rotate(23).png().toBuffer())
      expect(pixel(output, Math.floor(output.width / 2), Math.floor(output.height / 2))).toEqual(
        expected,
      )
    },
  )

  it('accepts negative angles and validates rotate options eagerly', async () => {
    const image = await Image.open(png(2, 3, () => colors[0]))
    await expect(image.rotate(-90).metadata()).resolves.toMatchObject({ width: 3, height: 2 })
    expect(() => image.rotate(Number.NaN)).toThrow('finite number')
    expect(() => image.rotate(10, { background: '#nope' })).toThrow('Background')
  })
})
