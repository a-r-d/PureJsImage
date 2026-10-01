import { createImageLibrary } from '../../src/browser.ts'
import type { DecoderOptions } from '../../src/codec.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { collectJpegXlProfileRows } from './jpegxl-profile-pipeline.ts'

export interface JpegXlCompletionFixture {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly format: string
  readonly category: string
  readonly frame?: number
  readonly animation?: boolean
  readonly colorTolerance: number
  readonly linearTolerance?: number
}
const Image = createImageLibrary({ codecs: [jpegxlCodec, pngCodec] })
const equal = (actual: Uint8Array, expected: Uint8Array): void => {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index]))
    throw new Error('JPEG XL completion output bytes differ')
}
export const compareJpegXlCompletionSamples = (
  actual: Uint8Array,
  reference: Uint8Array,
  format: string,
): { maximumColor: number; maximumAlpha: number } => {
  if (actual.length !== reference.length)
    throw new Error(
      `JPEG XL completion reference size differs: ${actual.length} / ${reference.length}`,
    )
  const floating = format.endsWith('f32'),
    bytes = floating ? 4 : format.endsWith('16') ? 2 : 1
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const a = new DataView(actual.buffer, actual.byteOffset, actual.byteLength),
    b = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
  let maximumColor = 0,
    maximumAlpha = 0
  for (let sample = 0; sample < actual.length / bytes; sample++) {
    const offset = sample * bytes
    const left = floating
      ? a.getFloat32(offset, false)
      : bytes === 2
        ? a.getUint16(offset, false)
        : a.getUint8(offset)
    const right = floating
      ? b.getFloat32(offset, false)
      : bytes === 2
        ? b.getUint16(offset, false)
        : b.getUint8(offset)
    if (!Number.isFinite(left) || !Number.isFinite(right))
      throw new Error('Nonfinite completion samples')
    const error = Math.abs(left - right)
    if (channels === 4 && sample % 4 === 3) maximumAlpha = Math.max(maximumAlpha, error)
    else maximumColor = Math.max(maximumColor, error)
  }
  return { maximumColor, maximumAlpha }
}

/** The same public workflows run under Node and each real browser engine. */
export const verifyJpegXlFloatCompletion = async (
  bytes: Uint8Array,
  reference: Uint8Array,
  fixture: JpegXlCompletionFixture,
  linearReference?: Uint8Array,
): Promise<{ maximumColor: number; maximumAlpha: number; maximumLinear: number }> => {
  const options: DecoderOptions = {
    ...(fixture.animation ? { frame: fixture.frame ?? 0 } : {}),
    ...(fixture.category === 'icc' ? { colorOutput: 'srgb' } : {}),
    ...(fixture.category === 'hdr' ? { hdrOutput: 'tone-map-srgb' } : {}),
  }
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(bytes),
    defaultImageLimits,
    options,
  )
  if (!decoder || decoder.pixelFormat !== fixture.format)
    throw new Error(`${fixture.id}: completion format differs: ${decoder?.pixelFormat}`)
  const actual = await collectJpegXlProfileRows(decoder)
  const result = compareJpegXlCompletionSamples(actual, reference, fixture.format)
  const alphaTolerance = fixture.format.endsWith('f32')
    ? 0.000002
    : fixture.category === 'cmyk'
      ? 1
      : 0
  if (result.maximumColor > fixture.colorTolerance || result.maximumAlpha > alphaTolerance)
    throw new Error(
      `${fixture.id}: completion oracle differs: color ${result.maximumColor}, alpha ${result.maximumAlpha}`,
    )
  equal(await collectJpegXlProfileRows(decoder), actual)
  const channels = fixture.format.startsWith('gray') ? 1 : fixture.format.startsWith('rgba') ? 4 : 3
  const sampleBytes = fixture.format.endsWith('f32') ? 4 : fixture.format.endsWith('16') ? 2 : 1
  const x = fixture.width > 1024 ? 1018 : 1
  const crop = await collectJpegXlProfileRows(decoder, { x, y: 0, width: 1, height: 1 })
  equal(crop, actual.subarray(x * channels * sampleBytes, (x + 1) * channels * sampleBytes))
  const image = await Image.open(bytes, options)
  const encoded = await image.jpegxl().toUint8Array()
  const reopened = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (!reopened || reopened.pixelFormat !== fixture.format)
    throw new Error('Completion re-encoding loses storage precision')
  equal(await collectJpegXlProfileRows(reopened), actual)
  if (fixture.category === 'icc') {
    const preserved = await Image.open(bytes, { ...options, colorOutput: 'preserve' })
    const roundtrip = await preserved.keepIcc().jpegxl().toUint8Array()
    const before = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
      ...options,
      colorOutput: 'preserve',
    })
    const after = await jpegxlCodec.createDecoder?.(
      new MemorySource(roundtrip),
      defaultImageLimits,
      { colorOutput: 'preserve' },
    )
    if (!before || !after || after.colorSemantics?.icc?.relevance !== 'emitted-pixels')
      throw new Error('Float ICC preservation lost its source profile')
    const sourceMetadata = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(bytes),
      defaultImageLimits,
      { icc: true, exif: false },
    )
    const outputMetadata = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(roundtrip),
      defaultImageLimits,
      { icc: true, exif: false },
    )
    if (!sourceMetadata?.icc || !outputMetadata?.icc) throw new Error('Missing preserved ICC bytes')
    equal(outputMetadata.icc, sourceMetadata.icc)
    equal(await collectJpegXlProfileRows(before), await collectJpegXlProfileRows(after))
  }
  let maximumLinear = 0
  if (linearReference) {
    const linear = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
      ...options,
      hdrOutput: 'linear-float',
    })
    if (linear?.colorSemantics?.transfer.kind !== 'linear' || !linear.pixelFormat.endsWith('f32'))
      throw new Error('HDR linear output semantics differ')
    const samples = await collectJpegXlProfileRows(linear),
      result = compareJpegXlCompletionSamples(samples, linearReference, linear.pixelFormat)
    maximumLinear = result.maximumColor
    if (maximumLinear > (fixture.linearTolerance ?? 0.0003) || result.maximumAlpha > 0.000001)
      throw new Error(
        `${fixture.id}: linear HDR oracle differs: color ${maximumLinear}, alpha ${result.maximumAlpha}`,
      )
    const encoded = await (await Image.open(bytes, { ...options, hdrOutput: 'linear-float' }))
      .jpegxl()
      .toUint8Array()
    const decoded = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoded) throw new Error('Missing linear HDR encoded decoder')
    equal(await collectJpegXlProfileRows(decoded), samples)
  }
  return { ...result, maximumLinear }
}
