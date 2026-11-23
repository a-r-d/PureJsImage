import { createImageLibrary } from '../../src/browser.ts'
import { allCodecs } from '../../src/codec-entries/all.ts'
import { crc32 } from '../../src/codecs/crc32.ts'
import type { JpegXlEncodeOptions } from '../../src/pipeline.ts'
import { adobeRgbProfile, displayP3RgbProfile } from '../icc-fixtures.ts'

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const name = new TextEncoder().encode(type)
  const output = new Uint8Array(12 + data.byteLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, data.byteLength)
  output.set(name, 4)
  output.set(data, 8)
  view.setUint32(8 + data.byteLength, crc32(name, data))
  return output
}

const adler32 = (data: Uint8Array): number => {
  let low = 1
  let high = 0
  for (const value of data) {
    low = (low + value) % 65521
    high = (high + low) % 65521
  }
  return ((high << 16) | low) >>> 0
}

/** A zlib stream of stored blocks, so the fixture needs no compressor in Node or the browser. */
const storedZlib = (data: Uint8Array): Uint8Array => {
  const blocks = Math.max(1, Math.ceil(data.byteLength / 65535))
  const output = new Uint8Array(2 + blocks * 5 + data.byteLength + 4)
  output[0] = 0x78
  output[1] = 0x01
  let offset = 2
  for (let block = 0; block < blocks; block++) {
    const start = block * 65535
    const length = Math.min(65535, data.byteLength - start)
    output[offset] = block === blocks - 1 ? 1 : 0
    output[offset + 1] = length & 255
    output[offset + 2] = length >>> 8
    output[offset + 3] = ~length & 255
    output[offset + 4] = (~length >>> 8) & 255
    output.set(data.subarray(start, start + length), offset + 5)
    offset += 5 + length
  }
  new DataView(output.buffer).setUint32(offset, adler32(data))
  return output
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

/** A PNG without gAMA, cHRM, sRGB, cICP or iCCP chunks from a sample generator. */
const generatedPng = (
  colorType: 0 | 2 | 6,
  bitDepth: 8 | 16,
  width: number,
  height: number,
  sample: (x: number, y: number, channel: number) => number,
): Uint8Array => {
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : 4
  const sampleBytes = bitDepth / 8
  const rowBytes = 1 + width * channels * sampleBytes
  const scanlines = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < channels; channel++) {
        const offset = y * rowBytes + 1 + (x * channels + channel) * sampleBytes
        scanlines[offset] = sample(x, y, channel)
        if (sampleBytes === 2) scanlines[offset + 1] = (x * 13 + channel * 7 + y) & 255
      }
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = bitDepth
  header[9] = colorType
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', header),
    pngChunk('IDAT', storedZlib(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ])
}

/** A deterministic, detailed untagged PNG. */
export const untaggedPng = (
  colorType: 0 | 2 | 6,
  bitDepth: 8 | 16,
  width: number,
  height: number,
): Uint8Array =>
  generatedPng(colorType, bitDepth, width, height, (x, y, channel) =>
    channel === 3
      ? 255 - ((x + y) % 4) * 60
      : (x * 37 + y * 11 + channel * 53 + ((x * y) % 7) * 9) & 255,
  )

/** A smooth untagged RGB8 gradient, where lossy coding error stays small. */
export const smoothPng = (width: number, height: number): Uint8Array =>
  generatedPng(2, 8, width, height, (x, y, channel) =>
    Math.round(
      channel === 0
        ? (x * 255) / width
        : channel === 1
          ? (y * 255) / height
          : 128 + 64 * Math.sin(x / 9),
    ),
  )

/** Insert a chunk directly after IHDR. */
export const pngWithChunk = (png: Uint8Array, type: string, data: Uint8Array): Uint8Array =>
  concat([png.subarray(0, 33), pngChunk(type, data), png.subarray(33)])

/** Insert an iCCP chunk directly after IHDR. */
export const pngWithIcc = (png: Uint8Array, profile: Uint8Array): Uint8Array =>
  pngWithChunk(
    png,
    'iCCP',
    concat([new TextEncoder().encode('P3'), Uint8Array.of(0, 0), storedZlib(profile)]),
  )

/** Insert a single APP2 ICC_PROFILE segment directly after SOI. */
export const jpegWithIcc = (jpeg: Uint8Array, profile: Uint8Array): Uint8Array => {
  const segment = new Uint8Array(18 + profile.byteLength)
  segment[0] = 0xff
  segment[1] = 0xe2
  new DataView(segment.buffer).setUint16(2, 16 + profile.byteLength)
  segment.set(new TextEncoder().encode('ICC_PROFILE\0'), 4)
  segment[16] = 1
  segment[17] = 1
  segment.set(profile, 18)
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
}

/** Insert an APP1 Exif segment whose only IFD entry is an orientation, directly after SOI. */
export const jpegWithExifOrientation = (jpeg: Uint8Array, orientation: number): Uint8Array => {
  const tiff = Uint8Array.of(
    ...[0x4d, 0x4d, 0, 42, 0, 0, 0, 8],
    ...[0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0],
    ...[0, 0, 0, 0],
  )
  const segment = concat([
    Uint8Array.of(0xff, 0xe1, 0, 0),
    new TextEncoder().encode('Exif\0\0'),
    tiff,
  ])
  new DataView(segment.buffer).setUint16(2, segment.byteLength - 2)
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
}

/** A little-endian RGB PFM of smooth float32 samples, stored bottom row first. */
export const smoothPfm = (width: number, height: number): Uint8Array => {
  const samples = new Float32Array(width * height * 3)
  for (let row = 0; row < height; row++)
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++)
        samples[(row * width + x) * 3 + channel] = (x + 1) / width + channel * 0.25 + row / height
  return concat([
    new TextEncoder().encode(`PF\n${width} ${height}\n-1.0\n`),
    new Uint8Array(samples.buffer),
  ])
}

export interface JpegXlInputColorResult {
  readonly id: string
  readonly bytes: number
  readonly checksum: number
}

/** Encode untagged, ICC-tagged, oriented and float input through the portable public pipeline. */
export const verifyJpegXlInputColor = async (): Promise<readonly JpegXlInputColorResult[]> => {
  const Image = createImageLibrary(allCodecs)
  const lossless: JpegXlEncodeOptions = { effort: 3 }
  const lossy: JpegXlEncodeOptions = { mode: 'lossy', effort: 7, distance: 1 }
  const png = untaggedPng(2, 8, 64, 48)
  const jpeg = await (await Image.open(png)).jpeg({ quality: 90 }).toUint8Array()
  const smoothJpeg = await (await Image.open(smoothPng(64, 48)))
    .jpeg({ quality: 95 })
    .toUint8Array()
  const profile = displayP3RgbProfile()
  const gamma = Uint8Array.of(0, 0, 0xb1, 0x8f)
  const cases: readonly (readonly [
    string,
    Uint8Array,
    JpegXlEncodeOptions,
    'keepIcc' | 'keepExif' | 'none',
  ])[] = [
    ['png-gray8', untaggedPng(0, 8, 24, 16), lossless, 'none'],
    ['png-rgb8', untaggedPng(2, 8, 24, 16), lossless, 'none'],
    ['png-rgba8', untaggedPng(6, 8, 24, 16), lossless, 'none'],
    ['png-rgb16', untaggedPng(2, 16, 24, 16), lossless, 'none'],
    ['png-rgb16-gama', pngWithChunk(untaggedPng(2, 16, 24, 16), 'gAMA', gamma), lossless, 'none'],
    ['png-rgb16-p3-icc', pngWithIcc(untaggedPng(2, 16, 24, 16), profile), lossless, 'none'],
    [
      'png-cicp-unspecified',
      pngWithChunk(untaggedPng(2, 8, 24, 16), 'cICP', Uint8Array.of(2, 2, 0, 1)),
      lossless,
      'none',
    ],
    ['jpeg-lossless', jpeg, lossless, 'none'],
    ['jpeg-lossy-e7', jpeg, lossy, 'none'],
    ['png-p3-keep-icc', pngWithIcc(png, profile), lossless, 'keepIcc'],
    ['jpeg-p3-keep-icc', jpegWithIcc(jpeg, profile), lossless, 'keepIcc'],
    ['jpeg-p3-keep-icc-lossy', jpegWithIcc(smoothJpeg, profile), lossy, 'keepIcc'],
    ['jpeg-adobe-rgb-keep-icc-lossy', jpegWithIcc(smoothJpeg, adobeRgbProfile()), lossy, 'keepIcc'],
    ['jpeg-orientation-6-keep-exif', jpegWithExifOrientation(jpeg, 6), lossless, 'keepExif'],
    ['pfm-float32', smoothPfm(16, 12), lossless, 'none'],
  ]
  const results: JpegXlInputColorResult[] = []
  for (const [id, input, options, keep] of cases) {
    const image = await Image.open(input)
    const kept =
      keep === 'keepIcc' ? image.keepIcc() : keep === 'keepExif' ? image.keepExif() : image
    const encoded = await kept.jpegxl(options).toUint8Array()
    results.push({ id, bytes: encoded.byteLength, checksum: crc32(encoded) })
  }
  return results
}
