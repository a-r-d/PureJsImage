import { describe, expect, it } from 'vitest'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'

import { Image } from './image-library.ts'
import { baselineJpegFixtures } from './jpeg-compatibility-fixtures.ts'

type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

const progressiveJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQECQQJBAAD/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wgARCAAYACADASIAAhEBAxEB/8QAGgABAAMAAwAAAAAAAAAAAAAAAAECBQQGB//EABYBAQEBAAAAAAAAAAAAAAAAAAABAv/aAAwDAQACEAMQAAAB8pJIaWandaGFOGL/AP/EABwQAAICAgMAAAAAAAAAAAAAAAAEAQIFEhQVIP/aAAgBAQABBQL01VPQ4adjrk5JxSpfFUg//8QAFBEBAAAAAAAAAAAAAAAAAAAAIP/aAAgBAwEBPwEf/8QAFhEAAwAAAAAAAAAAAAAAAAAAABAR/9oACAECAQE/AXT/xAAhEAABAwIHAQAAAAAAAAAAAAABAAIDIoEEEBIgM0JDkf/aAAgBAQAGPwLcw4Z82rsJBlx/CvQXVMsipmN2r//EACIQAAEBBgcAAAAAAAAAAAAAAAEAEBEgIXHhMUFRYYGRwf/aAAgBAQABPyGIEiZE7DmAEyiqPVpKdqKwJ4KMSW15f//aAAwDAQACAAMAAAAQ4/fC/8QAFxEBAQEBAAAAAAAAAAAAAAAAAQAREP/aAAgBAwEBPxCHTYef/8QAFhEBAQEAAAAAAAAAAAAAAAAAAQAR/9oACAECAQE/EJMctYV//8QAIBABAAIBAwUBAAAAAAAAAAAAAREhADFhsRAgQVGhwf/aAAgBAQABPxDtIkmY2xG2UIxRCV1mr8X0TmPcpcuMT3uReVlas0HjgxkIHp/T8Z//2Q==',
  'base64',
)

const rgbaImage = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array => {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.set(pixel(x, y), (y * width + x) * 4)
    }
  }
  return data
}

const encodedJpeg = (
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number],
  quality = 100,
): Uint8Array => jpeg.encode({ width, height, data: rgbaImage(width, height, pixel) }, quality).data

const withOrientation = (input: Uint8Array, orientation: Orientation): Uint8Array => {
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

const withProgressiveFrameMarker = (input: Uint8Array): Uint8Array => {
  const output = Uint8Array.from(input)
  for (let offset = 0; offset + 1 < output.byteLength; offset += 1) {
    if (output[offset] === 0xff && output[offset + 1] === 0xc0) {
      output[offset + 1] = 0xc2
      return output
    }
  }
  throw new Error('Generated JPEG did not contain a baseline frame marker')
}

const sourceCoordinate = (
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: Orientation,
): readonly [number, number] => {
  if (orientation === 2) return [width - 1 - x, y]
  if (orientation === 3) return [width - 1 - x, height - 1 - y]
  if (orientation === 4) return [x, height - 1 - y]
  if (orientation === 5) return [y, x]
  if (orientation === 6) return [y, height - 1 - x]
  if (orientation === 7) return [width - 1 - y, height - 1 - x]
  if (orientation === 8) return [width - 1 - y, x]
  return [x, y]
}

describe('JPEG pixel pipeline', () => {
  it.each(Object.entries(baselineJpegFixtures))(
    'decodes baseline %s input consistently with the development oracle',
    async (_name, base64) => {
      const input = Buffer.from(base64, 'base64')
      const reference = jpeg.decode(input, {
        useTArray: true,
        formatAsRGBA: false,
        tolerantDecoding: false,
      })
      const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())

      expect({ width: output.width, height: output.height }).toEqual({
        width: reference.width,
        height: reference.height,
      })
      for (let pixel = 0; pixel < output.width * output.height; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          expect(
            Math.abs(
              (output.data[pixel * 4 + channel] ?? 0) - (reference.data[pixel * 3 + channel] ?? 0),
            ),
          ).toBeLessThanOrEqual(3)
        }
      }
    },
  )

  it('decodes a multi-scan progressive JPEG consistently with the development oracle', async () => {
    const reference = jpeg.decode(progressiveJpeg, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
    })
    const output = PNG.sync.read(await (await Image.open(progressiveJpeg)).png().toBuffer())

    expect({ width: output.width, height: output.height }).toEqual({ width: 32, height: 24 })
    for (let pixel = 0; pixel < output.width * output.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        expect(
          Math.abs(
            (output.data[pixel * 4 + channel] ?? 0) - (reference.data[pixel * 3 + channel] ?? 0),
          ),
        ).toBeLessThanOrEqual(3)
      }
    }
  })

  it('executes all EXIF orientation values before encoding', async () => {
    const width = 16
    const height = 8
    const input = encodedJpeg(width, height, (x, y) => [x * 13, y * 29, x * 7 + y * 11, 255])
    const reference = jpeg.decode(input, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
    })

    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const output = PNG.sync.read(
        await (await Image.open(withOrientation(input, orientation))).autoOrient().png().toBuffer(),
      )
      const outputWidth = orientation >= 5 ? height : width
      const outputHeight = orientation >= 5 ? width : height
      expect({ width: output.width, height: output.height }).toEqual({
        width: outputWidth,
        height: outputHeight,
      })
      for (let y = 0; y < outputHeight; y += 1) {
        for (let x = 0; x < outputWidth; x += 1) {
          const [sourceX, sourceY] = sourceCoordinate(x, y, width, height, orientation)
          const source = (sourceY * width + sourceX) * 3
          const target = (y * outputWidth + x) * 4
          for (let channel = 0; channel < 3; channel += 1) {
            expect(
              Math.abs(
                (output.data[target + channel] ?? 0) - (reference.data[source + channel] ?? 0),
              ),
            ).toBeLessThanOrEqual(3)
          }
          expect(output.data[target + 3]).toBe(255)
        }
      }
    }
  })

  it('crops, resizes, and encodes JPEG with quality control', async () => {
    const input = encodedJpeg(64, 48, (x, y) => [x * 4, y * 5, (x + y) * 2, 255])
    const image = (await Image.open(input))
      .crop({ x: 8, y: 4, width: 48, height: 40 })
      .resize({ width: 24 })

    const low = await image.jpeg({ quality: 20 }).toBuffer()
    const high = await image.jpeg({ quality: 95 }).toBuffer()
    const decoded = jpeg.decode(high, { useTArray: true, formatAsRGBA: false })

    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 24, height: 20 })
    expect(low.byteLength).toBeLessThan(high.byteLength)
  })

  it('flattens transparent PNG input onto the requested JPEG background', async () => {
    const image = new PNG({ width: 64, height: 32 })
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data.set(x < 32 ? [255, 0, 0, 0] : [0, 0, 255, 255], offset)
      }
    }
    const input = PNG.sync.write(image)
    const output = jpeg.decode(
      await (await Image.open(input)).jpeg({ quality: 100, background: '#ffffff' }).toBuffer(),
      { useTArray: true, formatAsRGBA: false },
    )

    expect(output.data[0]).toBeGreaterThan(245)
    expect(output.data[1]).toBeGreaterThan(245)
    expect(output.data[2]).toBeGreaterThan(245)
    const blue = (16 * output.width + 56) * 3
    expect(output.data[blue]).toBeLessThan(15)
    expect(output.data[blue + 1]).toBeLessThan(15)
    expect(output.data[blue + 2]).toBeGreaterThan(240)
  })

  it('rejects unsupported progressive output and malformed input cleanly', async () => {
    const input = encodedJpeg(8, 8, () => [20, 40, 60, 255])

    await expect((await Image.open(input)).jpeg({ progressive: true }).toBuffer()).rejects.toThrow(
      'Progressive JPEG encoding',
    )
    await expect(
      (await Image.open(withProgressiveFrameMarker(input))).png().toBuffer(),
    ).rejects.toThrow('Progressive JPEG DC scan')
    await expect(
      (await Image.open(input.subarray(0, input.byteLength - 20))).toBuffer(),
    ).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
    })
  })
})
