import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'

import type { ResizeOptions } from '../src/index.ts'
import { Image } from './image-library.ts'

type Pixel = readonly [red: number, green: number, blue: number, alpha: number]

const png = (width: number, height: number, pixel: (x: number, y: number) => Pixel): Buffer => {
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
  return PNG.sync.write(image, { colorType: 6, inputColorType: 6, bitDepth: 8 })
}

const pixelAt = (image: PNG, x: number, y: number): Pixel => {
  const offset = (y * image.width + x) * 4
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
    image.data[offset + 3] ?? -1,
  ]
}

const execute = async (input: Uint8Array, options: ResizeOptions): Promise<PNG> =>
  PNG.sync.read(await (await Image.open(input)).resize(options).png().toBuffer())

describe('streaming resize', () => {
  it('resizes with nearest-neighbor sampling', async () => {
    const colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ] as const
    const output = await execute(
      png(2, 2, (x, y) => colors[y * 2 + x] ?? colors[0]),
      {
        width: 4,
        height: 4,
        fit: 'fill',
        kernel: 'nearest',
      },
    )

    expect(pixelAt(output, 0, 0)).toEqual(colors[0])
    expect(pixelAt(output, 3, 0)).toEqual(colors[1])
    expect(pixelAt(output, 0, 3)).toEqual(colors[2])
    expect(pixelAt(output, 3, 3)).toEqual(colors[3])
  })

  it('uses bilinear sampling by default', async () => {
    const output = await execute(
      png(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255])),
      { width: 3, height: 1, fit: 'fill' },
    )

    expect(pixelAt(output, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(output, 1, 0)).toEqual([128, 0, 128, 255])
    expect(pixelAt(output, 2, 0)).toEqual([0, 0, 255, 255])
  })

  it('interpolates alpha in premultiplied color space', async () => {
    const output = await execute(
      png(2, 1, (x) => (x === 0 ? [255, 0, 0, 0] : [0, 0, 255, 255])),
      { width: 1, height: 1, fit: 'fill' },
    )

    expect(pixelAt(output, 0, 0)).toEqual([0, 0, 255, 128])
  })

  it('keeps constant colors stable with Lanczos3 downsampling', async () => {
    const output = await execute(
      png(9, 7, () => [37, 91, 203, 170]),
      {
        width: 4,
        height: 3,
        fit: 'fill',
        kernel: 'lanczos3',
      },
    )

    expect({ width: output.width, height: output.height }).toEqual({ width: 4, height: 3 })
    for (let y = 0; y < output.height; y += 1) {
      for (let x = 0; x < output.width; x += 1) {
        expect(pixelAt(output, x, y)).toEqual([37, 91, 203, 170])
      }
    }
  })

  it('centers contain output on a transparent canvas', async () => {
    const image = await Image.open(png(4, 2, () => [20, 180, 70, 255]))
    const pipeline = image.resize({
      width: 6,
      height: 6,
      fit: 'contain',
      position: 'center',
      background: 'transparent',
    })
    const output = PNG.sync.read(await pipeline.png().toBuffer())

    await expect(pipeline.metadata()).resolves.toMatchObject({ width: 6, height: 6 })
    expect(pixelAt(output, 0, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(output, 3, 2)).toEqual([20, 180, 70, 255])
    expect(pixelAt(output, 5, 5)).toEqual([0, 0, 0, 0])
  })

  it('uses centered cover geometry when both dimensions are provided', async () => {
    const colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ] as const
    const output = await execute(
      png(4, 2, (x) => colors[x] ?? colors[0]),
      {
        width: 2,
        height: 2,
        kernel: 'nearest',
      },
    )

    expect(pixelAt(output, 0, 0)).toEqual(colors[1])
    expect(pixelAt(output, 1, 1)).toEqual(colors[2])
  })

  it('combines source crop and resize without retaining the cropped bitmap', async () => {
    const input = png(8, 6, (x, y) => [x * 20, y * 30, x + y, 255])
    const output = PNG.sync.read(
      await (await Image.open(input))
        .crop({ x: 2, y: 1, width: 4, height: 4 })
        .resize({ width: 2, height: 2, fit: 'fill', kernel: 'nearest' })
        .png()
        .toBuffer(),
    )

    expect({ width: output.width, height: output.height }).toEqual({ width: 2, height: 2 })
    expect(pixelAt(output, 0, 0)).toEqual([60, 60, 5, 255])
    expect(pixelAt(output, 1, 1)).toEqual([100, 120, 9, 255])
  })

  it('honors withoutEnlargement for executable width-only resize', async () => {
    const output = await execute(
      png(4, 2, () => [1, 2, 3, 255]),
      {
        width: 10,
        withoutEnlargement: true,
      },
    )

    expect({ width: output.width, height: output.height }).toEqual({ width: 4, height: 2 })
  })
})
