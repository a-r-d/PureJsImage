import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { DecoderOptions, ImageCodec } from '../src/codec.ts'
import { structuredIccColor } from '../src/codecs/icc.ts'
import { jpegCodec } from '../src/codecs/jpeg.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { netpbmCodec } from '../src/codecs/netpbm.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { webpCodec } from '../src/codecs/webp.ts'
import type { PixelColorSemantics } from '../src/color.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { exifOrientation } from '../src/metadata.ts'
import type { JpegXlEncodeOptions } from '../src/pipeline.ts'
import { type PixelFormat, pixelStorage } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import {
  jpegWithExifOrientation,
  jpegWithIcc,
  pngWithChunk,
  pngWithIcc,
  smoothPfm,
  smoothPng,
  untaggedPng,
  verifyJpegXlInputColor,
} from './helpers/jpegxl-untagged-input.ts'
import {
  adobeRgbProfile,
  displayP3RgbProfile,
  graySampledProfile,
  proPhotoRgbProfile,
  rgbLegacyLutProfile,
  rgbLutOnlyProfile,
} from './icc-fixtures.ts'
import { Image } from './image-library.ts'

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

interface DecodedImage {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly pixels: Uint8Array
  readonly colorSemantics: PixelColorSemantics | undefined
}

const decode = async (
  codec: ImageCodec,
  bytes: Uint8Array,
  options: DecoderOptions = {},
): Promise<DecodedImage> => {
  const decoder = await codec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, options)
  if (!decoder) throw new Error(`Missing ${codec.format} decoder`)
  // Blocks are full-width row bands; a decoder may hand out a taller buffer than the band.
  const parts: Uint8Array[] = []
  for await (const block of decoder.decode()) {
    try {
      const storage = pixelStorage(block.format)
      const rowBytes = block.width * storage.channels * storage.bytesPerSample
      for (let row = 0; row < block.height; row++)
        parts.push(block.data.slice(row * block.stride, row * block.stride + rowBytes))
    } finally {
      block.release?.()
    }
  }
  return {
    width: decoder.width,
    height: decoder.height,
    pixelFormat: decoder.pixelFormat,
    pixels: concat(parts),
    colorSemantics: decoder.colorSemantics,
  }
}

// The Node library returns a Buffer; compare plain bytes.
const encodeJpegXl = async (input: Uint8Array, options: JpegXlEncodeOptions): Promise<Uint8Array> =>
  Uint8Array.from(await (await Image.open(input)).jpegxl(options).toUint8Array())

/** Encode decoded samples with an explicit sRGB request, as a caller with tagged pixels would. */
const encodeExplicitSrgb = async (
  image: DecodedImage,
  options: JpegXlEncodeOptions,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: image.width,
    height: image.height,
    pixelFormat: image.pixelFormat,
    options,
    colorSemantics: {
      family: image.pixelFormat.startsWith('gray') ? 'gray' : 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: image.pixelFormat.startsWith('rgba') ? 'straight' : 'none',
      provenance: 'container-signaled',
    },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
    stride: image.pixels.byteLength / image.height,
    format: image.pixelFormat,
    data: image.pixels,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

it('encodes untagged PNG samples as sRGB', async () => {
  for (const [colorType, bitDepth] of [
    [0, 8],
    [2, 8],
    [6, 8],
    [2, 16],
  ] as const) {
    const untagged = untaggedPng(colorType, bitDepth, 24, 16)
    const source = await decode(pngCodec, untagged)
    const encoded = await encodeJpegXl(untagged, { effort: 3 })
    expect(encoded).toEqual(await encodeExplicitSrgb(source, { effort: 3 }))
    const decoded = await decode(jpegxlCodec, encoded)
    expect(decoded.colorSemantics?.transfer.kind).toBe('srgb')
    if (colorType !== 0) expect(decoded.colorSemantics?.primaries).toBe('srgb')
    expect(decoded.pixels).toEqual(source.pixels)
  }
})

it('encodes JPEG and WebP input as sRGB, including the effort-7 photo policy', async () => {
  const png = untaggedPng(2, 8, 64, 48)
  const jpeg = await (await Image.open(png)).jpeg({ quality: 90 }).toUint8Array()
  const jpegPixels = await decode(jpegCodec, jpeg)
  const requests: readonly JpegXlEncodeOptions[] = [
    { effort: 3 },
    { mode: 'lossy', effort: 7, distance: 1 },
  ]
  for (const options of requests) {
    expect(await encodeJpegXl(jpeg, options)).toEqual(await encodeExplicitSrgb(jpegPixels, options))
  }

  const webp = await (await Image.open(png)).webp({ lossless: true }).toUint8Array()
  const encoded = await encodeJpegXl(webp, { effort: 3 })
  expect((await decode(jpegxlCodec, encoded)).pixels).toEqual(
    (await decode(webpCodec, webp)).pixels,
  )
})

it('keeps a JPEG or PNG ICC profile in lossless JPEG XL with keepIcc()', async () => {
  const profile = displayP3RgbProfile()
  const png = untaggedPng(2, 8, 32, 24)
  const jpeg = await (await Image.open(png)).jpeg({ quality: 90 }).toUint8Array()
  for (const [codec, input] of [
    [jpegCodec, jpegWithIcc(jpeg, profile)],
    [pngCodec, pngWithIcc(png, profile)],
  ] as const) {
    const encoded = Uint8Array.from(
      await (await Image.open(input)).keepIcc().jpegxl({ effort: 3 }).toUint8Array(),
    )
    // The unconverted samples and the exact profile survive.
    expect((await decode(jpegxlCodec, encoded, { colorOutput: 'preserve' })).pixels).toEqual(
      (await decode(codec, input, { preserveIcc: true })).pixels,
    )
    const kept = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(encoded),
      defaultImageLimits,
      {
        exif: false,
        icc: true,
      },
    )
    expect(kept?.icc).toEqual(profile)
    // Both decoders convert the profile to the same sRGB samples.
    expect((await decode(jpegxlCodec, encoded)).pixels).toEqual((await decode(codec, input)).pixels)
  }
})

it('keeps a sampled GRAY profile on a grayscale JPEG in lossless keepIcc() output', async () => {
  const profile = graySampledProfile()
  expect(structuredIccColor(profile)).toBeUndefined()
  const gray = await (await Image.open(untaggedPng(0, 8, 32, 24)))
    .jpeg({ quality: 90 })
    .toUint8Array()
  const input = jpegWithIcc(gray, profile)
  const encoded = Uint8Array.from(
    await (await Image.open(input)).keepIcc().jpegxl({ effort: 3 }).toUint8Array(),
  )
  // The JPEG decoder emits equal RGB channels; the JPEG XL file stores them once as gray.
  const kept = await decode(jpegxlCodec, encoded, { colorOutput: 'preserve' })
  const source = await decode(jpegCodec, input, { preserveIcc: true })
  expect(kept.pixelFormat).toBe('gray8')
  expect(kept.pixels).toEqual(source.pixels.filter((_, index) => index % 3 === 0))
  const metadata = await jpegxlCodec.preservedMetadata?.(
    new MemorySource(encoded),
    defaultImageLimits,
    { exif: false, icc: true },
  )
  expect(metadata?.icc).toEqual(profile)
  // Lossy output cannot embed the profile, and it has no structured equal.
  await expect(
    (await Image.open(input)).keepIcc().jpegxl({ mode: 'lossy' }).toUint8Array(),
  ).rejects.toMatchObject({
    code: 'UNSUPPORTED_OPERATION',
    message: expect.stringContaining('lossless'),
  })
})

it('rejects a GRAY profile on RGB samples whose channels differ', async () => {
  const profile = graySampledProfile()
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: 2,
    height: 1,
    pixelFormat: 'rgb8',
    limits: defaultImageLimits,
    options: { effort: 3 },
    metadata: { icc: profile },
    colorSemantics: {
      family: 'gray',
      primaries: 'srgb',
      transfer: { kind: 'source-profile' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'icc',
      renderingIntent: 'relative',
      icc: { relevance: 'emitted-pixels' },
    },
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  await expect(
    encoder.write({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      stride: 6,
      format: 'rgb8',
      data: Uint8Array.of(10, 10, 10, 20, 21, 20),
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await encoder.abort?.(new Error('test cleanup'))
})

it('writes the equal structured color for lossy keepIcc() output', async () => {
  const jpeg = await (await Image.open(smoothPng(64, 48))).jpeg({ quality: 95 }).toUint8Array()
  for (const [profile, colorSpace] of [
    [displayP3RgbProfile(), 'display-p3-srgb'],
    [adobeRgbProfile(), expect.stringMatching(/^unspecified-gamma-2\.199/)],
  ] as const) {
    const input = jpegWithIcc(jpeg, profile)
    const encoded = Uint8Array.from(
      await (await Image.open(input))
        .keepIcc()
        .jpegxl({ mode: 'lossy', effort: 7, distance: 1 })
        .toUint8Array(),
    )
    expect(await (await Image.open(encoded)).metadata()).toMatchObject({
      colorSpace,
      lossless: false,
    })
    // Rendered to sRGB, the file matches the source's own profile conversion within lossy error.
    const source = (await decode(jpegCodec, input)).pixels
    const rendered = (await decode(jpegxlCodec, encoded, { colorOutput: 'srgb' })).pixels
    let error = 0
    for (let index = 0; index < source.length; index++)
      error += Math.abs((source[index] ?? 0) - (rendered[index] ?? 0))
    expect(error / source.length).toBeLessThan(1.5)
  }
  // A LUT profile has no structured equal, and lossy output cannot embed it.
  await expect(
    (await Image.open(jpegWithIcc(jpeg, rgbLegacyLutProfile(2))))
      .keepIcc()
      .jpegxl({ mode: 'lossy', effort: 7, distance: 1 })
      .toUint8Array(),
  ).rejects.toMatchObject({
    code: 'UNSUPPORTED_OPERATION',
    message: expect.stringContaining('lossless'),
  })
})

it('keeps a ProPhoto RGB profile only in lossless keepIcc() output', async () => {
  // ProPhoto's green primary lies outside the spectral locus, so no structured color equals it.
  const profile = proPhotoRgbProfile()
  expect(structuredIccColor(profile)).toBeUndefined()
  const jpeg = await (await Image.open(smoothPng(32, 24))).jpeg({ quality: 95 }).toUint8Array()
  const input = jpegWithIcc(jpeg, profile)
  await expect(
    (await Image.open(input))
      .keepIcc()
      .jpegxl({ mode: 'lossy', effort: 7, distance: 1 })
      .toUint8Array(),
  ).rejects.toMatchObject({
    code: 'UNSUPPORTED_OPERATION',
    message: expect.stringContaining('lossless'),
  })
  // Without keepIcc() the decoder converts to sRGB, and lossy output works.
  await expect(
    (await Image.open(input)).jpegxl({ mode: 'lossy', effort: 7, distance: 1 }).toUint8Array(),
  ).resolves.toBeInstanceOf(Uint8Array)
  const encoded = Uint8Array.from(
    await (await Image.open(input)).keepIcc().jpegxl({ effort: 3 }).toUint8Array(),
  )
  const kept = await jpegxlCodec.preservedMetadata?.(
    new MemorySource(encoded),
    defaultImageLimits,
    {
      exif: false,
      icc: true,
    },
  )
  expect(kept?.icc).toEqual(profile)
})

it('keeps the exact profile in lossless keepIcc() output under a small working limit', async () => {
  const profile = displayP3RgbProfile()
  const jpeg = await (await Image.open(smoothPng(96, 64))).jpeg({ quality: 95 }).toUint8Array()
  const input = jpegWithIcc(jpeg, profile)
  // The bounded Modular encoder writes the profile, so a tight limit, like a large camera photo
  // under the default limit, still keeps the exact bytes.
  const encoded = Uint8Array.from(
    await (await Image.open(input, { limits: { maxDecodedBytes: 512 * 1024 } }))
      .keepIcc()
      .jpegxl({ effort: 3 })
      .toUint8Array(),
  )
  const kept = await jpegxlCodec.preservedMetadata?.(
    new MemorySource(encoded),
    defaultImageLimits,
    {
      exif: false,
      icc: true,
    },
  )
  expect(kept?.icc).toEqual(profile)
  expect((await decode(jpegxlCodec, encoded, { colorOutput: 'preserve' })).pixels).toEqual(
    (await decode(jpegCodec, input, { preserveIcc: true })).pixels,
  )
})

/** Appends an incompressible private tag so the profile's compressed stream passes 4 MiB. */
const withLargePrivateTag = (profile: Uint8Array, size: number): Uint8Array => {
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
  const count = view.getUint32(128)
  const tableEnd = 132 + count * 12
  const tagOffset = profile.byteLength + 12
  const output = new Uint8Array(tagOffset + size)
  const out = new DataView(output.buffer)
  output.set(profile.subarray(0, tableEnd))
  output.set(profile.subarray(tableEnd), tableEnd + 12)
  out.setUint32(0, output.byteLength)
  out.setUint32(128, count + 1)
  for (let tag = 0; tag < count; tag++)
    out.setUint32(132 + tag * 12 + 4, view.getUint32(132 + tag * 12 + 4) + 12)
  output.set(new TextEncoder().encode('zzzz'), tableEnd)
  out.setUint32(tableEnd + 4, tagOffset)
  out.setUint32(tableEnd + 8, size)
  let state = 1
  for (let index = tagOffset; index < output.length; index++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    output[index] = state >>> 24
  }
  return output
}

const createKeptProfileEncoder = (profile: Uint8Array, sink: Uint8ArraySink) =>
  jpegxlCodec.createEncoder?.(sink, {
    width: 2,
    height: 1,
    pixelFormat: 'rgb8',
    limits: defaultImageLimits,
    options: { effort: 3 },
    metadata: { icc: profile },
    colorSemantics: {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'source-profile' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'icc',
      renderingIntent: 'relative',
      icc: { relevance: 'emitted-pixels' },
    },
  })

it('writes the equal structured color when a kept profile stream passes the ICC limit', async () => {
  const profile = withLargePrivateTag(displayP3RgbProfile(), 4_718_592)
  const sink = new Uint8ArraySink()
  const encoder = await createKeptProfileEncoder(profile, sink)
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  const samples = Uint8Array.of(10, 120, 240, 200, 90, 30)
  await encoder.write({ x: 0, y: 0, width: 2, height: 1, stride: 6, format: 'rgb8', data: samples })
  await encoder.finish()
  const encoded = sink.toUint8Array()
  const kept = await jpegxlCodec.preservedMetadata?.(
    new MemorySource(encoded),
    defaultImageLimits,
    { exif: false, icc: true },
  )
  expect(kept?.icc).toBeUndefined()
  const decoded = await decode(jpegxlCodec, encoded, { colorOutput: 'preserve' })
  expect(decoded.colorSemantics?.primaries).toBe('display-p3')
  expect(decoded.pixels).toEqual(samples)
})

it('rejects an oversized profile stream without a structured equal before any rows', async () => {
  const profile = withLargePrivateTag(rgbLutOnlyProfile(), 4_718_592)
  expect(structuredIccColor(profile)).toBeUndefined()
  await expect(createKeptProfileEncoder(profile, new Uint8ArraySink())).rejects.toMatchObject({
    code: 'LIMIT_EXCEEDED',
    message: expect.stringContaining('maxIccCompressedBytes'),
  })
})

it('compresses lossless keepIcc() samples as well as the same untagged samples', async () => {
  const profile = displayP3RgbProfile()
  const jpeg = await (await Image.open(smoothPng(96, 64))).jpeg({ quality: 95 }).toUint8Array()
  const input = jpegWithIcc(jpeg, profile)
  const samples = await decode(jpegCodec, input, { preserveIcc: true })
  const differences: number[] = []
  for (const effort of [3, 7] as const) {
    const kept = Uint8Array.from(
      await (await Image.open(input)).keepIcc().jpegxl({ effort }).toUint8Array(),
    )
    const untagged = await encodeExplicitSrgb(samples, { effort })
    // Only the image header differs: the ICC stream replaces the sRGB color fields. The untagged
    // header fits in its first 64 bytes, and every later byte matches.
    differences.push(kept.byteLength - untagged.byteLength)
    expect(kept.subarray(kept.byteLength - untagged.byteLength + 64)).toEqual(untagged.subarray(64))
  }
  expect(differences[0]).toBe(differences[1])
  expect(differences[0]).toBeGreaterThan(0)
  expect(differences[0]).toBeLessThan(profile.byteLength)
})

it('keeps a gray profile on a grayscale JPEG with keepIcc()', async () => {
  const profile = new Uint8Array(
    await readFile(new URL('./fixtures/jpegxl/m8-native/gray.icc', import.meta.url)),
  )
  const jpeg = await (await Image.open(untaggedPng(0, 8, 32, 24)))
    .jpeg({ quality: 95 })
    .toUint8Array()
  const input = jpegWithIcc(jpeg, profile)
  // Ordinary decoding converts the gray curve to sRGB; preserved decoding keeps the samples.
  const structured = structuredIccColor(profile)
  if (structured?.transfer.kind !== 'gamma')
    throw new Error('Expected a gamma gray fixture profile')
  const { exponent } = structured.transfer
  const preserved = (await decode(jpegCodec, input, { preserveIcc: true })).pixels
  const converted = (await decode(jpegCodec, input)).pixels
  for (let index = 0; index < 30; index += 3) {
    const linear = ((preserved[index] ?? 0) / 255) ** exponent
    const expected =
      255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055)
    expect(Math.abs((converted[index] ?? 0) - expected)).toBeLessThanOrEqual(1)
  }
  for (const options of [{ effort: 3 }, { mode: 'lossy', effort: 7, distance: 1 }] as const) {
    const encoded = Uint8Array.from(
      await (await Image.open(input)).keepIcc().jpegxl(options).toUint8Array(),
    )
    // Rendered to sRGB, the file matches the source's own profile conversion.
    const source = (await decode(jpegCodec, input)).pixels
    const rendered = (await decode(jpegxlCodec, encoded, { colorOutput: 'srgb' })).pixels
    let error = 0
    for (let index = 0; index < source.length; index++)
      error += Math.abs((source[index] ?? 0) - (rendered[index] ?? 0))
    expect(error / source.length).toBeLessThan(options.effort === 3 ? 0.6 : 3)
  }
})

it('does not treat a profile that differs near black as a standard curve', () => {
  expect(structuredIccColor(displayP3RgbProfile())).toMatchObject({ primaries: 'display-p3' })
  const profile = displayP3RgbProfile()
  // The fixture's shared sampled curve starts after the header, a six-entry tag table and three
  // XYZ tags; zeroing entries 1 through 6 crushes the darkest codes to black.
  const curve = 128 + 4 + 6 * 12 + 3 * 20 + 12
  profile.fill(0, curve, curve + 14)
  expect(structuredIccColor(profile)).toBeUndefined()
})

it('keeps a signaled PNG gamma on 16-bit samples without primaries', async () => {
  const input = pngWithChunk(untaggedPng(2, 16, 24, 16), 'gAMA', Uint8Array.of(0, 0, 0xb1, 0x8f))
  const encoded = await encodeJpegXl(input, { effort: 3 })
  expect(await (await Image.open(encoded)).metadata()).toMatchObject({
    colorSpace: expect.stringMatching(/^srgb-gamma-2\.1999/),
  })
  expect((await decode(jpegxlCodec, encoded, { colorOutput: 'preserve' })).pixels).toEqual(
    (await decode(pngCodec, input)).pixels,
  )
})

it('labels untagged float32 samples as linear sRGB and keeps them exactly', async () => {
  const input = smoothPfm(16, 12)
  const encoded = await encodeJpegXl(input, { effort: 3 })
  const decoded = await decode(jpegxlCodec, encoded, { colorOutput: 'preserve' })
  expect(decoded.colorSemantics).toMatchObject({ primaries: 'srgb', transfer: { kind: 'linear' } })
  expect(decoded.pixels).toEqual((await decode(netpbmCodec, input)).pixels)
})

it('moves a kept Exif orientation into the JPEG XL header', async () => {
  const jpeg = await (await Image.open(untaggedPng(2, 8, 32, 24)))
    .jpeg({ quality: 90 })
    .toUint8Array()
  const input = jpegWithExifOrientation(jpeg, 6)
  for (const options of [{ effort: 3 }, { mode: 'lossy', effort: 7, distance: 1 }] as const) {
    const encoded = Uint8Array.from(
      await (await Image.open(input)).keepExif().jpegxl(options).toUint8Array(),
    )
    expect(await (await Image.open(encoded)).metadata()).toMatchObject({
      width: 32,
      height: 24,
      orientation: 6,
    })
    const kept = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(encoded),
      defaultImageLimits,
      {
        exif: true,
        icc: false,
      },
    )
    expect(kept?.exif && exifOrientation(kept.exif)).toBe(1)
  }
  // An explicit orientation option still has to agree with the kept Exif value.
  await expect(
    (await Image.open(input)).keepExif().jpegxl({ effort: 3, orientation: 1 }).toUint8Array(),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
})

it('keeps untagged 32-bit integer samples on their explicit color check', async () => {
  await expect(
    jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
      width: 1,
      height: 1,
      options: {},
      pixelFormat: 'rgb32',
    }),
  ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
})

it('gives the same JPEG XL bytes through the portable library', async () => {
  const results = await verifyJpegXlInputColor()
  expect(results.map((result) => result.id)).toEqual([
    'png-gray8',
    'png-rgb8',
    'png-rgba8',
    'png-rgb16',
    'png-rgb16-gama',
    'png-rgb16-p3-icc',
    'png-cicp-unspecified',
    'jpeg-lossless',
    'jpeg-lossy-e7',
    'png-p3-keep-icc',
    'jpeg-p3-keep-icc',
    'jpeg-p3-keep-icc-lossy',
    'jpeg-adobe-rgb-keep-icc-lossy',
    'jpeg-orientation-6-keep-exif',
    'pfm-float32',
  ])
  const lossless = await encodeJpegXl(untaggedPng(2, 8, 24, 16), { effort: 3 })
  expect(results[1]).toMatchObject({ bytes: lossless.byteLength })
})
