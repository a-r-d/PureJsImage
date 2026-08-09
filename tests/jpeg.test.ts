import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { applyRgbIcc, parseRgbIccTransform } from '../src/codecs/icc.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { ImageError } from '../src/index.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { createResizeTransform } from '../src/resize.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import { channelSwappingRgbProfile, rgbLutOnlyProfile } from './icc-fixtures.ts'
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

interface JpegStructure {
  readonly componentCount: number
  readonly restartInterval: number
  readonly restartMarkers: readonly number[]
  readonly restartMarkerOffsets: readonly number[]
}

interface JpegScanDescription {
  readonly components: number
  readonly spectralStart: number
  readonly spectralEnd: number
  readonly successiveHigh: number
  readonly successiveLow: number
  readonly restartMarkers: readonly number[]
}

interface ProgressiveJpegStructure {
  readonly frameMarker: number
  readonly componentCount: number
  readonly huffmanTableMarkers: number
  readonly restartInterval: number
  readonly scans: readonly JpegScanDescription[]
}

const progressiveJpegStructure = (input: Uint8Array): ProgressiveJpegStructure => {
  let offset = 2
  let frameMarker = 0
  let componentCount = 0
  let huffmanTableMarkers = 0
  let restartInterval = 0
  const scans: JpegScanDescription[] = []
  while (offset + 1 < input.byteLength) {
    if (input[offset] !== 0xff) throw new Error('JPEG marker prefix is missing')
    while (input[offset] === 0xff) offset += 1
    const marker = input[offset] ?? 0
    offset += 1
    if (marker === 0xd9) break
    const length = ((input[offset] ?? 0) << 8) | (input[offset + 1] ?? 0)
    if (length < 2 || offset + length > input.byteLength) {
      throw new Error('JPEG marker length is invalid')
    }
    if (marker === 0xc0 || marker === 0xc2) {
      frameMarker = marker
      componentCount = input[offset + 7] ?? 0
    }
    if (marker === 0xdd) {
      restartInterval = ((input[offset + 2] ?? 0) << 8) | (input[offset + 3] ?? 0)
    }
    if (marker === 0xc4) huffmanTableMarkers += 1
    if (marker !== 0xda) {
      offset += length
      continue
    }

    const components = input[offset + 2] ?? 0
    const spectralOffset = offset + 3 + components * 2
    const successive = input[spectralOffset + 2] ?? 0
    offset += length
    const restartMarkers: number[] = []
    while (offset + 1 < input.byteLength) {
      if (input[offset] !== 0xff) {
        offset += 1
        continue
      }
      const markerOffset = offset
      while (input[offset] === 0xff) offset += 1
      const entropyMarker = input[offset] ?? 0
      if (entropyMarker === 0) {
        offset += 1
        continue
      }
      if (entropyMarker >= 0xd0 && entropyMarker <= 0xd7) {
        restartMarkers.push(entropyMarker)
        offset += 1
        continue
      }
      offset = markerOffset
      break
    }
    scans.push({
      components,
      spectralStart: input[spectralOffset] ?? 0,
      spectralEnd: input[spectralOffset + 1] ?? 0,
      successiveHigh: successive >>> 4,
      successiveLow: successive & 15,
      restartMarkers,
    })
  }
  return { frameMarker, componentCount, huffmanTableMarkers, restartInterval, scans }
}

const jpegStructure = (input: Uint8Array): JpegStructure => {
  let offset = 2
  let componentCount = 0
  let restartInterval = 0
  while (offset + 4 <= input.byteLength) {
    while (input[offset] === 0xff) offset += 1
    const marker = input[offset]
    offset += 1
    if (marker === 0xd9) break
    const length = ((input[offset] ?? 0) << 8) | (input[offset + 1] ?? 0)
    if (length < 2) throw new Error('JPEG marker length is invalid')
    if (marker === 0xc0) componentCount = input[offset + 7] ?? 0
    if (marker === 0xdd)
      restartInterval = ((input[offset + 2] ?? 0) << 8) | (input[offset + 3] ?? 0)
    if (marker === 0xda) {
      offset += length
      break
    }
    offset += length
  }
  const restartMarkers: number[] = []
  const restartMarkerOffsets: number[] = []
  while (offset + 1 < input.byteLength) {
    if (input[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = input[offset + 1] ?? 0
    offset += 2
    if (marker === 0) continue
    if (marker >= 0xd0 && marker <= 0xd7) {
      restartMarkers.push(marker)
      restartMarkerOffsets.push(offset - 2)
    } else if (marker === 0xd9) break
  }
  return { componentCount, restartInterval, restartMarkers, restartMarkerOffsets }
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

const jpegMarkerOffset = (input: Uint8Array, marker: number): number => {
  for (let offset = 2; offset + 1 < input.byteLength; offset += 1) {
    if (input[offset] === 0xff && input[offset + 1] === marker) return offset
  }
  throw new Error(`Generated JPEG did not contain marker 0x${marker.toString(16)}`)
}

const insertJpegBytes = (input: Uint8Array, offset: number, inserted: Uint8Array): Uint8Array => {
  const output = new Uint8Array(input.byteLength + inserted.byteLength)
  output.set(input.subarray(0, offset))
  output.set(inserted, offset)
  output.set(input.subarray(offset), offset + inserted.byteLength)
  return output
}

const jpegApplicationSegment = (marker: 0xe1 | 0xe2, payload: Uint8Array): Uint8Array => {
  const length = payload.byteLength + 2
  const segment = new Uint8Array(payload.byteLength + 4)
  segment.set([0xff, marker, length >>> 8, length & 0xff])
  segment.set(payload, 4)
  return segment
}

const ultraHdrXmpSegment = (): Uint8Array => {
  const header = 'http://ns.adobe.com/xap/1.0/\0'
  const xml =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"/></rdf:RDF></x:xmpmeta>'
  return jpegApplicationSegment(0xe1, new TextEncoder().encode(header + xml))
}

const mpfSegment = (
  primaryBytes: number,
  secondaryBytes: number,
  secondaryOffset: number,
): Uint8Array => {
  const payload = new Uint8Array(86)
  const view = new DataView(payload.buffer)
  writeSignature(payload, 0, 'MPF\0')
  writeSignature(payload, 4, 'MM')
  view.setUint16(6, 42, false)
  view.setUint32(8, 8, false)
  view.setUint16(12, 3, false)
  let entry = 14
  view.setUint16(entry, 0xb000, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 4, false)
  writeSignature(payload, entry + 8, '0100')
  entry += 12
  view.setUint16(entry, 0xb001, false)
  view.setUint16(entry + 2, 4, false)
  view.setUint32(entry + 4, 1, false)
  view.setUint32(entry + 8, 2, false)
  entry += 12
  view.setUint16(entry, 0xb002, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 32, false)
  view.setUint32(entry + 8, 50, false)
  view.setUint32(50, 0, false)
  view.setUint32(54, 0x2003_0000, false)
  view.setUint32(58, primaryBytes, false)
  view.setUint32(62, 0, false)
  view.setUint32(70, 0, false)
  view.setUint32(74, secondaryBytes, false)
  view.setUint32(78, secondaryOffset, false)
  return jpegApplicationSegment(0xe2, payload)
}

const ultraHdrJpeg = (primary: Uint8Array, gainMap: Uint8Array): Uint8Array => {
  const xmp = ultraHdrXmpSegment()
  const provisionalMpf = mpfSegment(0, gainMap.byteLength, 0)
  const primaryBytes = primary.byteLength + xmp.byteLength + provisionalMpf.byteLength
  const tiffOffset = 2 + xmp.byteLength + 8
  const mpf = mpfSegment(primaryBytes, gainMap.byteLength, primaryBytes - tiffOffset)
  const output = new Uint8Array(primaryBytes + gainMap.byteLength)
  output.set(primary.subarray(0, 2))
  output.set(xmp, 2)
  output.set(mpf, 2 + xmp.byteLength)
  output.set(primary.subarray(2), 2 + xmp.byteLength + mpf.byteLength)
  output.set(gainMap, primaryBytes)
  return output
}

const expectCorruptJpegRejection = async (input: Uint8Array): Promise<void> => {
  try {
    await (await Image.open(input)).png().toBuffer()
    throw new Error('Corrupt JPEG unexpectedly decoded')
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ImageError)
    if (error instanceof ImageError) {
      expect(['INVALID_INPUT', 'TRUNCATED_INPUT']).toContain(error.code)
    }
  }
}

const collectRgb = async (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const output = new Uint8Array(width * height * 3)
  for await (const block of blocks) {
    expect(block.format).toBe('rgb8')
    for (let y = 0; y < block.height; y += 1) {
      const source = y * block.stride
      const target = ((block.y + y) * width + block.x) * 3
      output.set(block.data.subarray(source, source + block.width * 3), target)
    }
    block.release?.()
  }
  return output
}

const decodeRgb = async (
  input: Uint8Array,
  scaleDenominator: 1 | 2 | 4 | 8,
): Promise<{ readonly width: number; readonly height: number; readonly data: Uint8Array }> => {
  const decoder = await jpegCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  const width = Math.ceil(decoder.width / scaleDenominator)
  const height = Math.ceil(decoder.height / scaleDenominator)
  const data = await collectRgb(decoder.decode({ width, height, scaleDenominator }), width, height)
  return { width, height, data }
}

const fullResolutionResize = async (
  input: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> => {
  const decoder = await jpegCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG decoder is unavailable')
  const resize = createResizeTransform(decoder.width, decoder.height, decoder.pixelFormat, {
    width,
    height,
    fit: 'fill',
  })
  return collectRgb(resize.apply(decoder.decode()), width, height)
}

const meanAbsoluteError = (first: Uint8Array, second: Uint8Array): number => {
  expect(first.byteLength).toBe(second.byteLength)
  let error = 0
  for (let index = 0; index < first.byteLength; index += 1) {
    error += Math.abs((first[index] ?? 0) - (second[index] ?? 0))
  }
  return error / first.byteLength
}

const scaledBaselineCases = ([2, 4, 8] as const).flatMap((scaleDenominator) =>
  Object.entries(baselineJpegFixtures).map(([name, base64]) => ({
    name,
    base64,
    scaleDenominator,
  })),
)

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
  it.each(scaledBaselineCases)(
    'decodes baseline $name with a native 1/$scaleDenominator IDCT',
    async ({ base64, scaleDenominator }) => {
      const input = Buffer.from(base64, 'base64')
      const scaled = await decodeRgb(input, scaleDenominator)
      const reference = await fullResolutionResize(input, scaled.width, scaled.height)
      expect(meanAbsoluteError(scaled.data, reference)).toBeLessThan(64)
    },
  )

  it.each([2, 4, 8] as const)(
    'decodes progressive JPEG coefficients with a native 1/%i IDCT',
    async (scaleDenominator) => {
      const scaled = await decodeRgb(progressiveJpeg, scaleDenominator)
      const reference = await fullResolutionResize(progressiveJpeg, scaled.width, scaled.height)
      expect(meanAbsoluteError(scaled.data, reference)).toBeLessThan(24)
    },
  )

  it('retains decoder blocks unless their typed storage is explicitly released', async () => {
    const input = encodedJpeg(32, 32, (x, y) => [x * 7, y * 5, (x + y) * 3, 255])
    const retainedDecoder = await jpegCodec.createDecoder?.(
      new MemorySource(input),
      defaultImageLimits,
    )
    if (!retainedDecoder) throw new Error('JPEG decoder is unavailable')
    const retainedBlocks: PixelBlock[] = []
    let firstSnapshot: Uint8Array | undefined
    for await (const block of retainedDecoder.decode()) {
      retainedBlocks.push(block)
      firstSnapshot ??= Uint8Array.from(block.data)
    }
    expect(retainedBlocks.length).toBeGreaterThan(1)
    expect(retainedBlocks[0]?.data).toEqual(firstSnapshot)
    expect(new Set(retainedBlocks.map((block) => block.data.buffer)).size).toBe(
      retainedBlocks.length,
    )

    const recyclingDecoder = await jpegCodec.createDecoder?.(
      new MemorySource(input),
      defaultImageLimits,
    )
    if (!recyclingDecoder) throw new Error('JPEG decoder is unavailable')
    const buffers: ArrayBufferLike[] = []
    for await (const block of recyclingDecoder.decode()) {
      buffers.push(block.data.buffer)
      expect(block.release).toBeTypeOf('function')
      block.release?.()
    }
    expect(buffers).toHaveLength(retainedBlocks.length)
    expect(new Set(buffers).size).toBe(1)
  })

  it.each(Object.entries(baselineJpegFixtures))(
    'decodes baseline %s input consistently with the development oracle',
    async (name, base64) => {
      const input = Buffer.from(base64, 'base64')
      const reference =
        name === 'cmyk' || name === 'ycck'
          ? jpeg.decode(input, {
              useTArray: true,
              formatAsRGBA: false,
              tolerantDecoding: false,
            })
          : await sharp(input)
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true })
              .then(({ data, info }) => ({ data, width: info.width, height: info.height }))
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

  it('applies RGB v4 mAB A2B0 LUT profiles to sRGB output', async () => {
    const input = Buffer.from(baselineJpegFixtures['4:4:4'], 'base64')
    const [reference, profiled] = await Promise.all([
      (await Image.open(input)).png().toBuffer(),
      (await Image.open(withIccProfile(input, rgbLutOnlyProfile()))).png().toBuffer(),
    ])
    const referencePixels = PNG.sync.read(reference)
    const profiledPixels = PNG.sync.read(profiled)

    expect(profiledPixels.width).toBe(referencePixels.width)
    expect(profiledPixels.height).toBe(referencePixels.height)
    expect(meanAbsoluteError(profiledPixels.data, referencePixels.data)).toBeLessThan(1)
    const offsetPixels = ([0, 1, 2] as const).map((axis) => {
      const offsets: [number, number, number] = [0, 0, 0]
      offsets[axis] = 0.01
      const pixel = Uint8Array.of(0, 0, 0)
      applyRgbIcc(pixel, parseRgbIccTransform(rgbLutOnlyProfile(offsets)))
      return Array.from(pixel)
    })
    expect(offsetPixels).toEqual([
      [71, 0, 5],
      [0, 55, 0],
      [0, 2, 47],
    ])
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
    const reference = await sharp(progressiveJpeg)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => ({ data, width: info.width, height: info.height }))
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

  it.each(['420', '422', '444'] as const)(
    'encodes refinement-based progressive JPEG with %s sampling',
    async (chromaSubsampling) => {
      const image = new PNG({ width: 37, height: 23 })
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const offset = (y * image.width + x) * 4
          image.data.set(
            [(x * 29 + y * 3) & 255, (x * 7 + y * 31) & 255, (x * 17 + y * 13) & 255, 255],
            offset,
          )
        }
      }
      const opened = await Image.open(PNG.sync.write(image))
      const baseline = await opened.jpeg({ quality: 91, chromaSubsampling }).toBuffer()
      const progressive = await opened
        .jpeg({ quality: 91, chromaSubsampling, progressive: true })
        .toBuffer()
      const structure = progressiveJpegStructure(progressive)
      const baselinePixels = await sharp(baseline).removeAlpha().raw().toBuffer()
      const independentPixels = await sharp(progressive).removeAlpha().raw().toBuffer()
      const nativePixels = PNG.sync.read(await (await Image.open(progressive)).png().toBuffer())

      expect(structure.frameMarker).toBe(0xc2)
      expect(structure.componentCount).toBe(3)
      expect(structure.huffmanTableMarkers).toBe(5)
      expect(
        structure.scans.map(
          ({ components, spectralStart, spectralEnd, successiveHigh, successiveLow }) => ({
            components,
            spectralStart,
            spectralEnd,
            successiveHigh,
            successiveLow,
          }),
        ),
      ).toEqual([
        { components: 3, spectralStart: 0, spectralEnd: 0, successiveHigh: 0, successiveLow: 1 },
        { components: 3, spectralStart: 0, spectralEnd: 0, successiveHigh: 1, successiveLow: 0 },
        { components: 1, spectralStart: 1, spectralEnd: 63, successiveHigh: 0, successiveLow: 1 },
        { components: 1, spectralStart: 1, spectralEnd: 63, successiveHigh: 0, successiveLow: 0 },
        { components: 1, spectralStart: 1, spectralEnd: 63, successiveHigh: 0, successiveLow: 0 },
        { components: 1, spectralStart: 1, spectralEnd: 63, successiveHigh: 1, successiveLow: 0 },
      ])
      expect(independentPixels).toEqual(baselinePixels)
      for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
          expect(
            Math.abs(
              (nativePixels.data[pixel * 4 + channel] ?? 0) -
                (independentPixels[pixel * 3 + channel] ?? 0),
            ),
          ).toBeLessThanOrEqual(3)
        }
      }
    },
  )

  it('makes representative progressive output smaller with scan-specific Huffman tables', async () => {
    const image = new PNG({ width: 512, height: 384 })
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4
        const texture = Math.round(18 * Math.sin(x / 13) + 12 * Math.cos(y / 9))
        image.data.set(
          [
            Math.max(0, Math.min(255, 35 + x / 3 + texture)),
            Math.max(0, Math.min(255, 25 + y / 2 + texture)),
            Math.max(0, Math.min(255, 45 + (x + y) / 5 - texture)),
            255,
          ],
          offset,
        )
      }
    }
    const opened = await Image.open(PNG.sync.write(image))
    const baseline = await opened.jpeg({ quality: 85 }).toBuffer()
    const progressive = await opened.jpeg({ quality: 85, progressive: true }).toBuffer()
    const structure = progressiveJpegStructure(progressive)

    expect(structure.huffmanTableMarkers).toBe(5)
    expect(progressive.byteLength).toBeLessThan(baseline.byteLength)
    await expect(sharp(progressive).removeAlpha().raw().toBuffer()).resolves.toEqual(
      await sharp(baseline).removeAlpha().raw().toBuffer(),
    )
  })

  it('encodes gray8 input as a native one-component JPEG', async () => {
    const image = new PNG({ width: 17, height: 9 })
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const value = x * 11 + y * 5
        image.data.set([value, value, value, 255], (y * image.width + x) * 4)
      }
    }
    const input = PNG.sync.write(image, { colorType: 0 })
    const opened = await Image.open(input)
    const output = await opened.jpeg({ quality: 95 }).toBuffer()
    const progressive = await opened.jpeg({ quality: 95, progressive: true }).toBuffer()
    const structure = jpegStructure(output)
    const progressiveStructure = progressiveJpegStructure(progressive)
    const decoded = jpeg.decode(output, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
    })
    const libjpeg = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })

    expect(structure.componentCount).toBe(1)
    expect(progressiveStructure.frameMarker).toBe(0xc2)
    expect(progressiveStructure.componentCount).toBe(1)
    expect(progressiveStructure.huffmanTableMarkers).toBe(3)
    expect(progressiveStructure.scans).toHaveLength(4)
    await expect(sharp(progressive).removeAlpha().raw().toBuffer()).resolves.toEqual(
      await sharp(output).removeAlpha().raw().toBuffer(),
    )
    expect(output.byteLength).toBeLessThan(
      (await (await Image.open(PNG.sync.write(image))).jpeg({ quality: 95 }).toBuffer()).byteLength,
    )
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 17, height: 9 })
    expect({ width: libjpeg.info.width, height: libjpeg.info.height }).toEqual({
      width: 17,
      height: 9,
    })
    for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += 1) {
      const expected = image.data[pixel * 4] ?? 0
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs((decoded.data[pixel * 3 + channel] ?? 0) - expected)).toBeLessThanOrEqual(8)
        expect(Math.abs((libjpeg.data[pixel * 3 + channel] ?? 0) - expected)).toBeLessThanOrEqual(8)
      }
    }
  })

  it('writes ordered restart markers and resets predictors at the requested interval', async () => {
    const image = new PNG({ width: 35, height: 19 })
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data.set([x * 7, y * 11, (x + y) * 4, 255], offset)
      }
    }
    const input = PNG.sync.write(image)
    const output = await (await Image.open(input))
      .encode('jpeg', { quality: 92, chromaSubsampling: '444', restartInterval: 3 })
      .toBuffer()
    const progressiveBaseline = await (await Image.open(input))
      .encode('jpeg', { quality: 92, chromaSubsampling: '420', restartInterval: 3 })
      .toBuffer()
    const progressive = await (await Image.open(input))
      .encode('jpeg', {
        quality: 92,
        chromaSubsampling: '420',
        restartInterval: 3,
        progressive: true,
      })
      .toBuffer()
    const structure = jpegStructure(output)
    const progressiveStructure = progressiveJpegStructure(progressive)
    const decoded = jpeg.decode(output, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: false,
    })
    const libjpeg = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })

    expect(structure.restartInterval).toBe(3)
    expect(structure.restartMarkers).toEqual([0xd0, 0xd1, 0xd2, 0xd3])
    expect(progressiveStructure.restartInterval).toBe(3)
    expect(progressiveStructure.scans).toHaveLength(6)
    expect(progressiveStructure.scans.map(({ restartMarkers }) => restartMarkers)).toEqual([
      [0xd0],
      [0xd0],
      [0xd0, 0xd1, 0xd2, 0xd3],
      [0xd0],
      [0xd0],
      [0xd0, 0xd1, 0xd2, 0xd3],
    ])
    await expect(sharp(progressive).removeAlpha().raw().toBuffer()).resolves.toEqual(
      await sharp(progressiveBaseline).removeAlpha().raw().toBuffer(),
    )
    expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 35, height: 19 })
    expect({ width: libjpeg.info.width, height: libjpeg.info.height }).toEqual({
      width: 35,
      height: 19,
    })
  })

  it('recovers malformed restart streams by default and keeps strict decoding explicit', async () => {
    const image = new PNG({ width: 35, height: 19 })
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4
        image.data.set([x * 7, y * 11, (x + y) * 4, 255], offset)
      }
    }
    const encoded = await (await Image.open(PNG.sync.write(image)))
      .encode('jpeg', { quality: 92, chromaSubsampling: '444', restartInterval: 3 })
      .toBuffer()
    const markerOffsets = jpegStructure(encoded).restartMarkerOffsets
    const secondMarkerOffset = markerOffsets[1]
    if (secondMarkerOffset === undefined) throw new Error('JPEG restart fixture is incomplete')

    const wrongSequence = Uint8Array.from(encoded)
    wrongSequence[secondMarkerOffset + 1] = 0xd7
    const extraBytes = Buffer.concat([
      encoded.subarray(0, secondMarkerOffset),
      Uint8Array.of(0x12, 0x34, 0x56),
      encoded.subarray(secondMarkerOffset),
    ])
    const prematureEnd = encoded.slice()
    prematureEnd[secondMarkerOffset + 1] = 0xd9

    await expect(
      (await Image.open(wrongSequence, { tolerantDecoding: false })).png().toBuffer(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Expected JPEG restart marker 1',
    })
    await expect(
      (await Image.open(extraBytes, { tolerantDecoding: false })).png().toBuffer(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Expected JPEG restart marker 1',
    })

    const recovered = await Promise.all(
      [wrongSequence, extraBytes, prematureEnd].map(async (input) =>
        PNG.sync.read(await (await Image.open(input)).png().toBuffer()),
      ),
    )
    expect(recovered.map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 35, height: 19 },
      { width: 35, height: 19 },
      { width: 35, height: 19 },
    ])
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
    const opened = await Image.open(input)
    const encoded = await opened.jpeg({ quality: 100, background: '#ffffff' }).toBuffer()
    const progressive = await opened
      .jpeg({ quality: 100, background: '#ffffff', progressive: true })
      .toBuffer()
    const output = jpeg.decode(encoded, { useTArray: true, formatAsRGBA: false })
    await expect(sharp(progressive).removeAlpha().raw().toBuffer()).resolves.toEqual(
      await sharp(encoded).removeAlpha().raw().toBuffer(),
    )

    expect(output.data[0]).toBeGreaterThan(245)
    expect(output.data[1]).toBeGreaterThan(245)
    expect(output.data[2]).toBeGreaterThan(245)
    const blue = (16 * output.width + 56) * 3
    expect(output.data[blue]).toBeLessThan(15)
    expect(output.data[blue + 1]).toBeLessThan(15)
    expect(output.data[blue + 2]).toBeGreaterThan(240)
  })

  it('accepts marker fill bytes and ignores trailing bytes after the end marker', async () => {
    const input = encodedJpeg(17, 13, (x, y) => [x * 11, y * 17, (x + y) * 7, 255])
    const reference = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    const applicationMarker = jpegMarkerOffset(input, 0xe0)
    const withFillBytes = insertJpegBytes(input, applicationMarker + 1, Uint8Array.of(0xff, 0xff))
    const withTrailingBytes = insertJpegBytes(
      input,
      input.byteLength,
      Uint8Array.of(0xde, 0xad, 0xbe, 0xef),
    )

    for (const compatible of [withFillBytes, withTrailingBytes]) {
      const output = PNG.sync.read(await (await Image.open(compatible)).png().toBuffer())
      expect({ width: output.width, height: output.height }).toEqual({ width: 17, height: 13 })
      expect(output.data).toEqual(reference.data)
    }
  })

  it('decodes the SDR primary from an Ultra HDR-shaped MPF JPEG', async () => {
    const primary = encodedJpeg(17, 13, (x, y) => [x * 11, y * 17, (x + y) * 7, 255])
    const gainMap = encodedJpeg(5, 3, (x, y) => {
      const gain = 32 + x * 40 + y * 12
      return [gain, gain, gain, 255]
    })
    const input = ultraHdrJpeg(primary, gainMap)
    const secondaryOffset = input.byteLength - gainMap.byteLength

    expect(input.subarray(secondaryOffset, secondaryOffset + 2)).toEqual(Uint8Array.of(0xff, 0xd8))
    await expect((await Image.open(input)).metadata()).resolves.toMatchObject({
      format: 'jpeg',
      width: 17,
      height: 13,
      frames: 2,
    })

    const reference = PNG.sync.read(await (await Image.open(primary)).png().toBuffer())
    const output = PNG.sync.read(await (await Image.open(input)).png().toBuffer())
    expect({ width: output.width, height: output.height }).toEqual({ width: 17, height: 13 })
    expect(output.data).toEqual(reference.data)
  })

  it('applies image limits to hostile JPEG dimensions before pixel decoding', async () => {
    const input = encodedJpeg(8, 8, () => [20, 40, 60, 255])
    const oversized = Uint8Array.from(input)
    const frame = jpegMarkerOffset(oversized, 0xc0)
    oversized.set([0xff, 0xff, 0xff, 0xff], frame + 5)

    await expect(
      (await Image.open(oversized, { limits: { maxWidth: 1_024, maxHeight: 1_024 } }))
        .png()
        .toBuffer(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('limits progressive coefficient storage without restricting baseline streaming encode', async () => {
    const limits = { ...defaultImageLimits, maxDecodedBytes: 20_000 }
    await expect(
      jpegCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 64,
        height: 64,
        pixelFormat: 'rgb8',
        options: { chromaSubsampling: '444', progressive: true },
        limits,
      }),
    ).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
      message: expect.stringContaining('coefficient storage'),
    })

    const baseline = await jpegCodec.createEncoder?.(new Uint8ArraySink(), {
      width: 64,
      height: 64,
      pixelFormat: 'rgb8',
      options: { chromaSubsampling: '444' },
      limits,
    })
    expect(baseline).toBeDefined()
    await baseline?.abort?.(new Error('test complete'))
  })

  it.each([
    {
      name: 'a marker length below two bytes',
      mutate: (data: Uint8Array): void => {
        const marker = jpegMarkerOffset(data, 0xe0)
        data.set([0, 1], marker + 2)
      },
    },
    {
      name: 'an invalid quantization-table precision',
      mutate: (data: Uint8Array): void => {
        const marker = jpegMarkerOffset(data, 0xdb)
        data[marker + 4] = ((data[marker + 4] ?? 0) & 0x0f) | 0x20
      },
    },
    {
      name: 'an oversubscribed Huffman table',
      mutate: (data: Uint8Array): void => {
        const marker = jpegMarkerOffset(data, 0xc4)
        data[marker + 5] = 3
      },
    },
    {
      name: 'a zero component sampling factor',
      mutate: (data: Uint8Array): void => {
        const marker = jpegMarkerOffset(data, 0xc0)
        data[marker + 11] = 0x01
      },
    },
    {
      name: 'sampling factors above ten blocks per MCU',
      mutate: (data: Uint8Array): void => {
        const marker = jpegMarkerOffset(data, 0xc0)
        data[marker + 11] = 0x44
      },
    },
    {
      name: 'a scan selector for an unknown component',
      mutate: (data: Uint8Array): void => {
        const marker = jpegMarkerOffset(data, 0xda)
        data[marker + 5] = 0x7f
      },
    },
  ])('rejects $name with a typed input error', async ({ mutate }) => {
    const malformed = Uint8Array.from(encodedJpeg(8, 8, () => [20, 40, 60, 255]))
    mutate(malformed)

    await expect((await Image.open(malformed)).png().toBuffer()).rejects.toMatchObject({
      name: 'ImageError',
      code: 'INVALID_INPUT',
    })
  })

  it('rejects JPEG truncation at marker, segment, frame, scan, entropy, and EOI boundaries', async () => {
    const input = encodedJpeg(16, 16, (x, y) => [x * 13, y * 7, (x + y) * 5, 255])
    const applicationMarker = jpegMarkerOffset(input, 0xe0)
    const frameMarker = jpegMarkerOffset(input, 0xc0)
    const scanMarker = jpegMarkerOffset(input, 0xda)
    const endMarker = jpegMarkerOffset(input, 0xd9)
    const cutOffsets = [
      3,
      applicationMarker + 3,
      frameMarker + 8,
      scanMarker + 6,
      Math.min(scanMarker + 16, endMarker - 1),
      endMarker,
    ]

    for (const offset of cutOffsets) {
      await expectCorruptJpegRejection(input.subarray(0, offset))
    }
  })

  it('rejects invalid output options and malformed input cleanly', async () => {
    const input = encodedJpeg(8, 8, () => [20, 40, 60, 255])
    const opened = await Image.open(input)
    const incompleteIcc = withIccProfile(input, channelSwappingRgbProfile())
    incompleteIcc[18] = 2
    incompleteIcc[19] = 2

    expect(() => opened.jpeg({ restartInterval: -1 })).toThrow(
      'JPEG restartInterval must be an integer from 0 to 65535',
    )
    await expect(
      jpegCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 8,
        height: 8,
        pixelFormat: 'rgb8',
        options: { progressive: 'yes' },
      }),
    ).rejects.toThrow('JPEG progressive must be a boolean')
    expect(() => opened.jpeg({ restartInterval: 65_536 })).toThrow(
      'JPEG restartInterval must be an integer from 0 to 65535',
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
