import { throwIfAborted } from '../abort.ts'
import { avifCodec } from '../codecs/avif.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { Uint8ArraySink } from '../sink.ts'
import type { GainMapRational } from './model.ts'
import type { GainMapRaster8, GainMapTransformedRasters } from './transform.ts'

export interface GainMapAvifEncodeOptions {
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
}

const bytes32 = (value: number): Uint8Array => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw limitExceeded('Gain-map AVIF value exceeds 32 bits')
  }
  return Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value)
}

const signed32 = (value: number): Uint8Array => {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw invalidInput('Gain-map AVIF signed rational is outside 32 bits')
  }
  return bytes32(value >>> 0)
}

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  if (!Number.isSafeInteger(length)) throw limitExceeded('Gain-map AVIF size overflow')
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const box = (type: string, ...payloads: readonly Uint8Array[]): Uint8Array => {
  const payload = concatenate(payloads)
  return concatenate([bytes32(payload.byteLength + 8), ascii(type), payload])
}

const fullBox = (type: string, payload: Uint8Array, version = 0, flags = 0): Uint8Array =>
  box(type, Uint8Array.of(version, flags >>> 16, flags >>> 8, flags), payload)

const fileType = box(
  'ftyp',
  ascii('avif'),
  bytes32(0),
  ascii('avif'),
  ascii('mif1'),
  ascii('miaf'),
  ascii('MA1B'),
  ascii('tmap'),
)

const standaloneAv1 = async (
  raster: GainMapRaster8,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> => {
  if (!avifCodec.createEncoder) throw unsupportedOperation('AVIF encoding is unavailable')
  const sink = new Uint8ArraySink()
  const encoder = await avifCodec.createEncoder(sink, {
    width: raster.width,
    height: raster.height,
    pixelFormat: raster.channels === 1 ? 'gray8' : 'rgb8',
    options: {},
    ...(signal === undefined ? {} : { signal }),
  })
  const block: PixelBlock = {
    x: 0,
    y: 0,
    width: raster.width,
    height: raster.height,
    stride: raster.width * raster.channels,
    format: raster.channels === 1 ? 'gray8' : 'rgb8',
    data: raster.data,
  }
  try {
    await encoder.write(block)
    await encoder.finish()
  } catch (error) {
    await encoder.abort?.(error)
    throw error
  }
  const avif = sink.toUint8Array()
  let offset = 0
  while (offset + 8 <= avif.byteLength) {
    const size = new DataView(avif.buffer, avif.byteOffset + offset, 4).getUint32(0, false)
    const type = String.fromCharCode(...avif.subarray(offset + 4, offset + 8))
    if (size < 8 || offset + size > avif.byteLength) {
      throw invalidInput('Standalone AVIF encoder produced an invalid box')
    }
    if (type === 'mdat') return Uint8Array.from(avif.subarray(offset + 8, offset + size))
    offset += size
  }
  throw invalidInput('Standalone AVIF encoder produced no media data')
}

const rational = (value: number): GainMapRational => {
  if (!Number.isFinite(value)) throw invalidInput('Gain-map AVIF metadata must be finite')
  const denominator = 1_000_000
  const numerator = Math.round(value * denominator)
  let a = Math.abs(numerator)
  let b = denominator
  while (b !== 0) {
    const next = a % b
    a = b
    b = next
  }
  const divisor = a || 1
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

const encodedRational = (value: GainMapRational, signed: boolean): Uint8Array =>
  concatenate([
    signed ? signed32(value.numerator) : bytes32(value.numerator),
    bytes32(value.denominator),
  ])

const toneMapPayload = (rasters: GainMapTransformedRasters): Uint8Array => {
  const metadata = rasters.metadata
  if (metadata.orientation !== 1) {
    throw unsupportedOperation(
      'Gain-map AVIF output requires autoOrient() when source orientation is pending',
    )
  }
  if (metadata.baseRendition !== 'sdr') {
    throw unsupportedOperation('Constrained gain-map AVIF output requires an SDR base rendition')
  }
  if (rasters.base.channels !== 3 || metadata.baseColor.alpha !== 'none') {
    throw unsupportedOperation('Constrained gain-map AVIF output does not support base alpha')
  }
  if (metadata.channelCount !== 1 || rasters.gainMap.channels !== 1) {
    throw unsupportedOperation('Constrained gain-map AVIF output requires a one-channel gain map')
  }
  if (metadata.baseColor.primaries !== 'srgb' || metadata.alternateColor.primaries !== 'srgb') {
    throw unsupportedOperation('Constrained gain-map AVIF output currently requires sRGB primaries')
  }
  const exact = metadata.exactIso
  const at = (
    field: 'minimum' | 'maximum' | 'gamma' | 'offsetSdr' | 'offsetHdr',
  ): GainMapRational => exact?.[field][0] ?? rational(metadata[field][0])
  const capacityMinimum = exact?.capacityMinimum ?? rational(metadata.capacityMinimum)
  const capacityMaximum = exact?.capacityMaximum ?? rational(metadata.capacityMaximum)
  return concatenate([
    Uint8Array.of(0),
    Uint8Array.of(0, 0),
    Uint8Array.of(0, 0),
    Uint8Array.of(metadata.useBaseColorSpace ? 0x40 : 0),
    encodedRational(capacityMinimum, false),
    encodedRational(capacityMaximum, false),
    encodedRational(at('minimum'), true),
    encodedRational(at('maximum'), true),
    encodedRational(at('gamma'), false),
    encodedRational(at('offsetSdr'), true),
    encodedRational(at('offsetHdr'), true),
  ])
}

const itemInfo = (id: number, type: string, name: string): Uint8Array =>
  fullBox(
    'infe',
    concatenate([Uint8Array.of(id >>> 8, id, 0, 0), ascii(type), ascii(name), Uint8Array.of(0)]),
    2,
  )

const itemLocation = (id: number, offset: number, length: number): Uint8Array =>
  concatenate([Uint8Array.of(id >>> 8, id, 0, 0, 0, 1), bytes32(offset), bytes32(length)])

const ispe = (width: number, height: number): Uint8Array =>
  fullBox('ispe', concatenate([bytes32(width), bytes32(height)]))

const pixi = (channels: number): Uint8Array =>
  fullBox('pixi', Uint8Array.of(channels, ...Array.from({ length: channels }, () => 8)))

const av1c = box('av1C', Uint8Array.of(0x81, 0, 0x0c, 0))
const srgbNclx = box('colr', concatenate([ascii('nclx'), Uint8Array.of(0, 1, 0, 13, 0, 1, 0x80)]))

const association = (itemId: number, properties: readonly number[]): Uint8Array =>
  Uint8Array.of(itemId >>> 8, itemId, properties.length, ...properties)

const metadataBox = (
  rasters: GainMapTransformedRasters,
  offsets: Readonly<{ base: number; gainMap: number; toneMap: number }>,
  lengths: Readonly<{ base: number; gainMap: number; toneMap: number }>,
): Uint8Array => {
  const handler = fullBox(
    'hdlr',
    concatenate([
      bytes32(0),
      ascii('pict'),
      new Uint8Array(12),
      ascii('PureJsImage'),
      Uint8Array.of(0),
    ]),
  )
  const primary = fullBox('pitm', Uint8Array.of(0, 1))
  const info = fullBox(
    'iinf',
    concatenate([
      Uint8Array.of(0, 3),
      itemInfo(1, 'av01', 'Base'),
      itemInfo(2, 'av01', 'GainMap'),
      itemInfo(3, 'tmap', 'ToneMap'),
    ]),
  )
  const locations = fullBox(
    'iloc',
    concatenate([
      Uint8Array.of(0x44, 0, 0, 3),
      itemLocation(1, offsets.base, lengths.base),
      itemLocation(2, offsets.gainMap, lengths.gainMap),
      itemLocation(3, offsets.toneMap, lengths.toneMap),
    ]),
  )
  const properties = box(
    'iprp',
    box(
      'ipco',
      ispe(rasters.base.width, rasters.base.height),
      pixi(3),
      av1c,
      srgbNclx,
      ispe(rasters.gainMap.width, rasters.gainMap.height),
      pixi(3),
      av1c,
      srgbNclx,
      ispe(rasters.base.width, rasters.base.height),
      srgbNclx,
    ),
    fullBox(
      'ipma',
      concatenate([
        bytes32(3),
        association(1, [1, 2, 3, 4]),
        association(2, [5, 6, 7, 8]),
        association(3, [9, 10]),
      ]),
    ),
  )
  const references = fullBox('iref', box('dimg', Uint8Array.of(0, 3, 0, 2, 0, 1, 0, 2)))
  const groups = box(
    'grpl',
    fullBox('altr', concatenate([bytes32(1), bytes32(2), bytes32(3), bytes32(1)])),
  )
  return fullBox(
    'meta',
    concatenate([handler, primary, locations, info, properties, references, groups]),
  )
}

const prepare = async (
  rasters: GainMapTransformedRasters,
  options: Readonly<GainMapAvifEncodeOptions>,
): Promise<readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array]> => {
  const toneMap = toneMapPayload(rasters)
  const [base, gainMap] = await Promise.all([
    standaloneAv1(rasters.base, options.signal),
    standaloneAv1(rasters.gainMap, options.signal),
  ])
  const provisional = metadataBox(
    rasters,
    { base: 0, gainMap: 0, toneMap: 0 },
    { base: base.byteLength, gainMap: gainMap.byteLength, toneMap: toneMap.byteLength },
  )
  const mediaStart = fileType.byteLength + provisional.byteLength + 8
  const metadata = metadataBox(
    rasters,
    {
      base: mediaStart,
      gainMap: mediaStart + base.byteLength,
      toneMap: mediaStart + base.byteLength + gainMap.byteLength,
    },
    { base: base.byteLength, gainMap: gainMap.byteLength, toneMap: toneMap.byteLength },
  )
  const outputBytes =
    fileType.byteLength +
    metadata.byteLength +
    8 +
    base.byteLength +
    gainMap.byteLength +
    toneMap.byteLength
  const maximum = options.maxOutputBytes ?? 256 * 1024 * 1024
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw invalidInput('Gain-map AVIF maxOutputBytes must be a positive safe integer')
  }
  if (outputBytes > maximum) throw limitExceeded('Gain-map AVIF output exceeds maxOutputBytes')
  return [metadata, base, gainMap, toneMap]
}

export const writeGainMapAvif = async (
  sink: ImageSink,
  rasters: GainMapTransformedRasters,
  options: Readonly<GainMapAvifEncodeOptions> = {},
): Promise<void> => {
  try {
    const [metadata, base, gainMap, toneMap] = await prepare(rasters, options)
    const chunks = [
      fileType,
      metadata,
      bytes32(8 + base.byteLength + gainMap.byteLength + toneMap.byteLength),
      ascii('mdat'),
      base,
      gainMap,
      toneMap,
    ]
    for (const chunk of chunks) {
      throwIfAborted(options.signal)
      await sink.write(chunk)
    }
    await sink.close()
  } catch (error) {
    await sink.abort(error)
    throw error
  }
}

export const assembleGainMapAvif = async (
  rasters: GainMapTransformedRasters,
  options: Readonly<GainMapAvifEncodeOptions> = {},
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  await writeGainMapAvif(sink, rasters, options)
  return sink.toUint8Array()
}
