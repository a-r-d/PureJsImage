import { createImageLibrary } from '../../src/browser.ts'
import type { DecodeRequest, ImageDecoder } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'

export interface JpegXlProfileFixture {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly format: string
  readonly depth: number
  readonly alphaDepth: number
  readonly associated: boolean
  readonly colorTolerance: number
}

export const collectJpegXlProfileRows = async (
  decoder: ImageDecoder,
  request: DecodeRequest = {},
): Promise<Uint8Array> => {
  const width = request.width ?? decoder.width
  const height = request.height ?? decoder.height
  const channels = decoder.pixelFormat.startsWith('gray')
    ? 1
    : decoder.pixelFormat.startsWith('rgba')
      ? 4
      : 3
  const stride = width * channels * (decoder.pixelFormat.endsWith('16') ? 2 : 1)
  const output = new Uint8Array(height * stride)
  let rows = 0
  for await (const block of decoder.decode(request)) {
    try {
      if (
        block.x !== 0 ||
        block.y !== rows ||
        block.width !== width ||
        block.format !== decoder.pixelFormat
      )
        throw new Error('Profile output geometry differs')
      for (let y = 0; y < block.height; y++)
        output.set(
          block.data.subarray(y * block.stride, y * block.stride + stride),
          (rows + y) * stride,
        )
      rows += block.height
    } finally {
      block.release?.()
    }
  }
  if (rows !== height) throw new Error('Profile output has missing rows')
  return output
}

const equal = (actual: Uint8Array, expected: Uint8Array): void => {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
    throw new Error('Profile output bytes differ')
}

export const verifyJpegXlProfilePipeline = async (
  bytes: Uint8Array,
  reference: Uint8Array,
  fixture: JpegXlProfileFixture,
): Promise<{ maximumColor: number; maximumAlpha: number }> => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
    colorOutput: 'srgb',
  })
  if (!decoder || decoder.pixelFormat !== fixture.format)
    throw new Error('Profile output format differs')
  const depth = fixture.format.endsWith('16') ? 16 : 8
  const channels = fixture.format.startsWith('gray') ? 1 : fixture.format.startsWith('rgba') ? 4 : 3
  if (
    decoder.execution?.sampleBitDepths.some((bits) => bits !== depth) ||
    !decoder.execution?.precisionLoss
  )
    throw new Error('Profile output precision differs')
  if (
    decoder.colorSemantics?.primaries !== 'srgb' ||
    decoder.colorSemantics.transfer.kind !== 'srgb' ||
    decoder.colorSemantics.icc !== undefined
  )
    throw new Error('Source ICC describes converted samples')
  const actual = await collectJpegXlProfileRows(decoder)
  if (actual.length !== reference.length) throw new Error('Profile reference size differs')
  const a = new DataView(actual.buffer, actual.byteOffset, actual.byteLength)
  const b = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
  let maximumColor = 0,
    maximumAlpha = 0
  for (let sample = 0; sample < actual.length / (depth / 8); sample++) {
    const offset = sample * (depth / 8)
    const error = Math.abs(
      depth === 16
        ? a.getUint16(offset, false) - b.getUint16(offset, false)
        : a.getUint8(offset) - b.getUint8(offset),
    )
    if (channels === 4 && sample % 4 === 3) maximumAlpha = Math.max(maximumAlpha, error)
    else maximumColor = Math.max(maximumColor, error)
  }
  if (maximumColor > fixture.colorTolerance || maximumAlpha !== 0)
    throw new Error(
      `${fixture.id}: independent profile conversion differs: color ${maximumColor}, alpha ${maximumAlpha}`,
    )
  equal(await collectJpegXlProfileRows(decoder), actual)
  const implicit = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (!implicit) throw new Error('Implicit profile decoder missing')
  equal(await collectJpegXlProfileRows(implicit), actual)
  if (fixture.width > 1024) {
    const x = 1018,
      width = 7
    const crop = await collectJpegXlProfileRows(decoder, { x, y: 0, width, height: fixture.height })
    for (let y = 0; y < fixture.height; y++) {
      const stride = width * channels * (depth / 8)
      const start = (y * fixture.width + x) * channels * (depth / 8)
      equal(crop.subarray(y * stride, (y + 1) * stride), actual.subarray(start, start + stride))
    }
  }
  const Image = createImageLibrary({ codecs: [jpegxlCodec, pngCodec] })
  const image = await Image.open(bytes, { colorOutput: 'srgb' })
  const png = await image.png().toUint8Array()
  const pngDecoder = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
  if (!pngDecoder || pngDecoder.pixelFormat !== fixture.format)
    throw new Error('PNG output format differs')
  equal(await collectJpegXlProfileRows(pngDecoder), actual)
  const encoded = await image.jpegxl().toUint8Array()
  const metadata = await jpegxlCodec.metadata(new MemorySource(encoded), defaultImageLimits)
  if (metadata.bitDepth !== depth || metadata.colorProfile !== undefined)
    throw new Error('Re-encode retained source profile or sample depth')
  const reopened = await jpegxlCodec.createDecoder?.(
    new MemorySource(encoded),
    defaultImageLimits,
    { colorOutput: 'preserve' },
  )
  if (!reopened) throw new Error('Re-encoded profile output missing')
  equal(await collectJpegXlProfileRows(reopened), actual)
  return { maximumColor, maximumAlpha }
}

export const verifyJpegXlProfilePreservation = async (input: Uint8Array): Promise<boolean> => {
  const source = new MemorySource(input)
  const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits, {
    colorOutput: 'preserve',
  })
  if (decoder?.colorSemantics?.icc?.relevance !== 'emitted-pixels')
    throw new Error('Profile preservation decoder missing')
  const original = await collectJpegXlProfileRows(decoder)
  const Image = createImageLibrary({ codecs: [jpegxlCodec, pngCodec] })
  const output = await (await Image.open(input, { colorOutput: 'preserve' }))
    .keepIcc()
    .png()
    .toUint8Array()
  const png = new MemorySource(output)
  const reopened = await pngCodec.createDecoder?.(png, defaultImageLimits, { preserveIcc: true })
  if (!reopened) throw new Error('Preserved PNG decoder missing')
  equal(await collectJpegXlProfileRows(reopened), original)
  const sourceProfile = await jpegxlCodec.preservedMetadata?.(source, defaultImageLimits, {
    exif: false,
    icc: true,
  })
  const targetProfile = await pngCodec.preservedMetadata?.(png, defaultImageLimits, {
    exif: false,
    icc: true,
  })
  if (!sourceProfile?.icc || !targetProfile?.icc) throw new Error('Preserved profile missing')
  equal(targetProfile.icc, sourceProfile.icc)
  return true
}
