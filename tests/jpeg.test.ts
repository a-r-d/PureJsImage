import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

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

const jpegLuminanceSampling = (input: Uint8Array): number => {
  let offset = 2
  while (offset + 4 <= input.byteLength) {
    while (input[offset] === 0xff) offset += 1
    const marker = input[offset]
    offset += 1
    if (marker === 0xc0) {
      const sampling = input[offset + 9]
      if (sampling === undefined) throw new Error('JPEG frame is truncated')
      return sampling
    }
    const length = ((input[offset] ?? 0) << 8) | (input[offset + 1] ?? 0)
    if (length < 2) throw new Error('JPEG marker length is invalid')
    offset += length
  }
  throw new Error('JPEG baseline frame was not found')
}

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

const writeSignature = (data: Uint8Array, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    data[offset + index] = value.charCodeAt(index)
  }
}

const writeUint16 = (view: DataView, offset: number, value: number): void => {
  view.setUint16(offset, value, false)
}

const writeUint32 = (view: DataView, offset: number, value: number): void => {
  view.setUint32(offset, value, false)
}

const writeFixed = (view: DataView, offset: number, value: number): void => {
  view.setInt32(offset, Math.round(value * 65_536), false)
}

const withIccProfile = (input: Uint8Array, profile: Uint8Array): Uint8Array => {
  const name = Uint8Array.from('ICC_PROFILE\0', (character) => character.charCodeAt(0))
  const payload = new Uint8Array(name.byteLength + 2 + profile.byteLength)
  payload.set(name)
  payload.set([1, 1], name.byteLength)
  payload.set(profile, name.byteLength + 2)
  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, 0xe2, (payload.byteLength + 2) >>> 8, (payload.byteLength + 2) & 0xff])
  segment.set(payload, 4)
  const output = new Uint8Array(input.byteLength + segment.byteLength)
  output.set(input.subarray(0, 2))
  output.set(segment, 2)
  output.set(input.subarray(2), 2 + segment.byteLength)
  return output
}

const withAdobeTransform = (input: Uint8Array, transform: 0 | 1 | 2): Uint8Array => {
  const payload = Uint8Array.of(0x41, 0x64, 0x6f, 0x62, 0x65, 0, 0, 100, 0, 0, 0, transform)
  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, 0xee, 0, payload.byteLength + 2])
  segment.set(payload, 4)
  const output = new Uint8Array(input.byteLength + segment.byteLength)
  output.set(input.subarray(0, 2))
  output.set(segment, 2)
  output.set(input.subarray(2), 2 + segment.byteLength)
  return output
}

const constantGrayCmykProfile = (): Uint8Array => {
  const tagOffset = 144
  const tagBytes = 176
  const profile = new Uint8Array(tagOffset + tagBytes)
  const view = new DataView(profile.buffer)
  writeUint32(view, 0, profile.byteLength)
  writeSignature(profile, 12, 'mntr')
  writeSignature(profile, 16, 'CMYK')
  writeSignature(profile, 20, 'XYZ ')
  writeSignature(profile, 36, 'acsp')
  writeUint32(view, 128, 1)
  writeSignature(profile, 132, 'A2B0')
  writeUint32(view, 136, tagOffset)
  writeUint32(view, 140, tagBytes)

  writeSignature(profile, tagOffset, 'mft2')
  profile[tagOffset + 8] = 4
  profile[tagOffset + 9] = 3
  profile[tagOffset + 10] = 2
  writeFixed(view, tagOffset + 12, 1)
  writeFixed(view, tagOffset + 28, 1)
  writeFixed(view, tagOffset + 44, 1)
  writeUint16(view, tagOffset + 48, 2)
  writeUint16(view, tagOffset + 50, 2)
  let offset = tagOffset + 52
  for (let channel = 0; channel < 4; channel += 1) {
    writeUint16(view, offset, 0)
    writeUint16(view, offset + 2, 65_535)
    offset += 4
  }
  for (let corner = 0; corner < 16; corner += 1) {
    writeUint16(view, offset, 15_797)
    writeUint16(view, offset + 2, 16_384)
    writeUint16(view, offset + 4, 13_515)
    offset += 6
  }
  for (let channel = 0; channel < 3; channel += 1) {
    writeUint16(view, offset, 0)
    writeUint16(view, offset + 2, 65_535)
    offset += 4
  }
  return profile
}

const channelSwappingRgbProfile = (): Uint8Array => {
  const tagTableBytes = 4 + 6 * 12
  const redOffset = 128 + tagTableBytes
  const greenOffset = redOffset + 20
  const blueOffset = greenOffset + 20
  const curveOffset = blueOffset + 20
  const curveBytes = 12 + 256 * 2
  const profile = new Uint8Array(curveOffset + curveBytes)
  const view = new DataView(profile.buffer)
  writeUint32(view, 0, profile.byteLength)
  writeSignature(profile, 12, 'mntr')
  writeSignature(profile, 16, 'RGB ')
  writeSignature(profile, 20, 'XYZ ')
  writeSignature(profile, 36, 'acsp')
  writeUint32(view, 128, 6)
  const tag = (index: number, name: string, offset: number, size: number): void => {
    const entry = 132 + index * 12
    writeSignature(profile, entry, name)
    writeUint32(view, entry + 4, offset)
    writeUint32(view, entry + 8, size)
  }
  tag(0, 'rXYZ', redOffset, 20)
  tag(1, 'gXYZ', greenOffset, 20)
  tag(2, 'bXYZ', blueOffset, 20)
  tag(3, 'rTRC', curveOffset, curveBytes)
  tag(4, 'gTRC', curveOffset, curveBytes)
  tag(5, 'bTRC', curveOffset, curveBytes)
  const xyz = (offset: number, x: number, y: number, z: number): void => {
    writeSignature(profile, offset, 'XYZ ')
    writeFixed(view, offset + 8, x)
    writeFixed(view, offset + 12, y)
    writeFixed(view, offset + 16, z)
  }
  xyz(redOffset, 0.1430804, 0.0606169, 0.7141733)
  xyz(greenOffset, 0.3850649, 0.7168786, 0.0971045)
  xyz(blueOffset, 0.4360747, 0.2225045, 0.0139322)
  writeSignature(profile, curveOffset, 'curv')
  writeUint32(view, curveOffset + 8, 256)
  for (let value = 0; value < 256; value += 1) {
    const encoded = value / 255
    const linear = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
    writeUint16(view, curveOffset + 12 + value * 2, Math.round(linear * 65_535))
  }
  return profile
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

  it('applies embedded RGB matrix/TRC and CMYK LUT profiles to sRGB output', async () => {
    const rgbInput = Buffer.from(baselineJpegFixtures['4:4:4'], 'base64')
    const rgbReference = PNG.sync.read(await (await Image.open(rgbInput)).png().toBuffer())
    const swapped = PNG.sync.read(
      await (await Image.open(withIccProfile(rgbInput, channelSwappingRgbProfile())))
        .png()
        .toBuffer(),
    )
    for (let pixel = 0; pixel < swapped.width * swapped.height; pixel += 1) {
      const offset = pixel * 4
      expect(
        Math.abs((swapped.data[offset] ?? 0) - (rgbReference.data[offset + 2] ?? 0)),
      ).toBeLessThanOrEqual(4)
      expect(
        Math.abs((swapped.data[offset + 1] ?? 0) - (rgbReference.data[offset + 1] ?? 0)),
      ).toBeLessThanOrEqual(4)
      expect(
        Math.abs((swapped.data[offset + 2] ?? 0) - (rgbReference.data[offset] ?? 0)),
      ).toBeLessThanOrEqual(4)
    }

    const cmykInput = Buffer.from(baselineJpegFixtures.cmyk, 'base64')
    const cmyk = PNG.sync.read(
      await (await Image.open(withIccProfile(cmykInput, constantGrayCmykProfile())))
        .png()
        .toBuffer(),
    )
    for (let pixel = 0; pixel < cmyk.width * cmyk.height; pixel += 1) {
      const offset = pixel * 4
      for (let channel = 0; channel < 3; channel += 1) {
        expect(cmyk.data[offset + channel]).toBeGreaterThanOrEqual(187)
        expect(cmyk.data[offset + channel]).toBeLessThanOrEqual(189)
      }
    }
  })

  it('honors an explicit Adobe RGB component transform', async () => {
    const input = withAdobeTransform(Buffer.from(baselineJpegFixtures['4:4:4'], 'base64'), 0)
    const reference = jpeg.decode(input, {
      useTArray: true,
      formatAsRGBA: false,
      colorTransform: false,
      tolerantDecoding: false,
    })
    const image = await Image.open(input)
    await expect(image.metadata()).resolves.toMatchObject({
      colorSpace: 'rgb',
      chromaSubsampling: '444',
    })
    const output = PNG.sync.read(await image.png().toBuffer())
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

  it('encodes configurable chroma subsampling with a 4:2:0 default', async () => {
    const image = new PNG({ width: 35, height: 19 })
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data.set([x * 7, y * 11, (x + y) * 4, 255], offset)
      }
    }
    const input = PNG.sync.write(image)
    const opened = await Image.open(input)
    const defaultOutput = await opened.jpeg({ quality: 90 }).toBuffer()
    const output420 = await opened.jpeg({ quality: 90, chromaSubsampling: '420' }).toBuffer()
    const output422 = await opened.jpeg({ quality: 90, chromaSubsampling: '422' }).toBuffer()
    const output444 = await opened.jpeg({ quality: 90, chromaSubsampling: '444' }).toBuffer()
    const generic444 = await opened
      .encode('jpeg', { quality: 90, chromaSubsampling: '444' })
      .toBuffer()

    expect(defaultOutput).toEqual(output420)
    expect(jpegLuminanceSampling(output420)).toBe(0x22)
    expect(jpegLuminanceSampling(output422)).toBe(0x21)
    expect(jpegLuminanceSampling(output444)).toBe(0x11)
    expect(generic444).toEqual(output444)
    expect(output420.byteLength).toBeLessThan(output444.byteLength)

    for (const output of [output420, output422, output444]) {
      const decoded = jpeg.decode(output, {
        useTArray: true,
        formatAsRGBA: false,
        tolerantDecoding: false,
      })
      expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 35, height: 19 })
      for (const [x, y] of [
        [4, 4],
        [16, 8],
        [30, 15],
      ] as const) {
        const decodedOffset = (y * decoded.width + x) * 3
        const sourceOffset = (y * image.width + x) * 4
        for (let channel = 0; channel < 3; channel += 1) {
          expect(
            Math.abs(
              (decoded.data[decodedOffset + channel] ?? 0) -
                (image.data[sourceOffset + channel] ?? 0),
            ),
          ).toBeLessThanOrEqual(35)
        }
      }
    }
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
    const incompleteIcc = withIccProfile(input, channelSwappingRgbProfile())
    incompleteIcc[18] = 2
    incompleteIcc[19] = 2

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
    await expect((await Image.open(incompleteIcc)).png().toBuffer()).rejects.toThrow(
      'ICC profile chunks are incomplete',
    )
  })
})
