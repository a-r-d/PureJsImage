import { createImageLibrary } from '../../src/browser.ts'
import { jpegxlCodec } from '../../src/codecs/jpegxl.ts'
import { pngCodec } from '../../src/codecs/png.ts'
import { defaultImageLimits } from '../../src/limits.ts'
import { MemorySource } from '../../src/source.ts'
import { collectJpegXlProfileRows } from './jpegxl-profile-pipeline.ts'

export interface JpegXlFloatFixture {
  readonly name: string
  readonly color: readonly number[]
  readonly alpha: readonly number[]
  readonly rgba16: readonly number[]
}

/** Pinned libjxl native PFM samples and independently range-mapped integer output. */
export const verifyJpegXlFloatPipeline = async (
  bytes: Uint8Array,
  fixture: JpegXlFloatFixture,
): Promise<number> => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
  if (decoder?.pixelFormat !== 'rgbaf32') throw new Error('Float decoder missing')
  const associated = fixture.name.endsWith('associated')
  if (
    decoder.colorSemantics?.alpha !== (associated ? 'premultiplied' : 'straight') ||
    decoder.execution?.sampleBitDepths.some((depth) => depth !== 32)
  )
    throw new Error('Float output semantics differ')
  const actual = await collectJpegXlProfileRows(decoder)
  const view = new DataView(actual.buffer)
  const gray = fixture.name.startsWith('gray')
  for (let pixel = 0; pixel < 4; pixel++) {
    for (let channel = 0; channel < 3; channel++)
      if (
        view.getFloat32((pixel * 4 + channel) * 4, false) !==
        fixture.color[pixel * (gray ? 1 : 3) + (gray ? 0 : channel)]
      )
        throw new Error('Native float color differs from libjxl')
    if (Math.abs(view.getFloat32((pixel * 4 + 3) * 4, false) - (fixture.alpha[pixel] ?? 0)) > 2e-7)
      throw new Error('Native float alpha differs from libjxl')
  }
  const replay = await collectJpegXlProfileRows(decoder)
  if (replay.some((value, index) => value !== actual[index]))
    throw new Error('Float replay differs')
  const cropped = await collectJpegXlProfileRows(decoder, { x: 1, y: 0, width: 2, height: 1 })
  if (cropped.some((value, index) => value !== actual[index + 16]))
    throw new Error('Float crop differs')
  const Image = createImageLibrary({ codecs: [jpegxlCodec, pngCodec] })
  const preservedEncoding = await (await Image.open(bytes)).jpegxl().toUint8Array()
  const preservedDecoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(preservedEncoding),
    defaultImageLimits,
  )
  if (preservedDecoder?.pixelFormat !== decoder.pixelFormat)
    throw new Error('Float-preserving encoding changed pixel format')
  const preservedRows = await collectJpegXlProfileRows(preservedDecoder)
  if (
    preservedRows.length !== actual.length ||
    preservedRows.some((value, index) => value !== actual[index])
  )
    throw new Error('Float-preserving encoding changed samples')
  const image = await Image.open(bytes, { alphaOutput: 'straight' })
  const mapped = image.convertPixelFormat({
    format: 'rgba16',
    range: { minimum: 0.25, maximum: 1.25 },
  })
  const png = await mapped.png().toUint8Array()
  const reopened = await pngCodec.createDecoder?.(new MemorySource(png), defaultImageLimits)
  if (reopened?.pixelFormat !== 'rgba16') throw new Error('Float PNG format differs')
  const displayed = await collectJpegXlProfileRows(reopened)
  const displayView = new DataView(displayed.buffer)
  let maximum = 0
  for (let index = 0; index < fixture.rgba16.length; index++)
    maximum = Math.max(
      maximum,
      Math.abs(displayView.getUint16(index * 2, false) - (fixture.rgba16[index] ?? 0)),
    )
  if (maximum > 1) throw new Error(`Float range mapping differs by ${maximum}`)
  const jxl = await mapped.jpegxl().toUint8Array()
  const encodedDecoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(jxl),
    defaultImageLimits,
  )
  if (!encodedDecoder) throw new Error('Float mapped JPEG XL decoder missing')
  const encodedRows = await collectJpegXlProfileRows(encodedDecoder)
  if (encodedRows.some((value, index) => value !== displayed[index]))
    throw new Error('Float mapped JPEG XL output differs')
  const resized = await image
    .crop({ x: 1, y: 0, width: 1, height: 1 })
    .resize({ width: 2, height: 2, fit: 'fill' })
    .convertPixelFormat({ format: 'rgba16', range: { minimum: 0.25, maximum: 1.25 } })
    .png()
    .toUint8Array()
  const resizedDecoder = await pngCodec.createDecoder?.(
    new MemorySource(resized),
    defaultImageLimits,
  )
  if (resizedDecoder?.width !== 2 || resizedDecoder.height !== 2)
    throw new Error('Float resized geometry differs')
  const resizedRows = await collectJpegXlProfileRows(resizedDecoder)
  for (let pixel = 0; pixel < 4; pixel++)
    for (let byte = 0; byte < 8; byte++)
      if (resizedRows[pixel * 8 + byte] !== displayed[8 + byte])
        throw new Error('Float resize samples differ')
  return maximum
}
