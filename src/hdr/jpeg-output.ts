import { throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { EvidenceContext } from '../evidence.ts'
import type { ImageSink } from '../sink.ts'
import { MemorySource, type ImageSource, type ImageSourceReadOptions } from '../source.ts'
import { encodeIsoGainMapMetadata } from './iso.ts'
import { findJpegEnd, inspectHdrJpeg, inspectHdrJpegHeader } from './jpeg.ts'
import {
  hdrMaterializationBudget,
  hdrMaterializationMaximum,
  type InternalMaterializationOptions,
  type MaterializationReservation,
} from './materialization.ts'
import type {
  GainMapExactIsoMetadata,
  GainMapMetadata,
  GainMapRational,
  GainMapTriplet,
} from './model.ts'

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0'
const EXTENDED_XMP_HEADER = 'http://ns.adobe.com/xmp/extension/\0'
const ISO_HEADER = 'urn:iso:std:iso:ts:21496:-1\0'

export type GainMapJpegMetadataMode = 'dual' | 'iso' | 'ultra-hdr'

export interface AssembleGainMapJpegOptions {
  readonly metadataMode?: GainMapJpegMetadataMode
  readonly maxOutputBytes?: number
  readonly signal?: AbortSignal
  readonly evidence?: EvidenceContext
}

export interface GainMapJpegArtifacts {
  readonly baseJpeg: Uint8Array
  readonly gainMapJpeg: Uint8Array
  readonly metadata: GainMapMetadata
}

const asciiPrefix = (data: Uint8Array, value: string): boolean => {
  if (data.byteLength < value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[index] !== value.charCodeAt(index)) return false
  }
  return true
}

const jpegSegment = (marker: 0xe1 | 0xe2, payload: Uint8Array): Uint8Array => {
  if (payload.byteLength > 65_533) throw limitExceeded('JPEG metadata exceeds one APP segment')
  const output = new Uint8Array(payload.byteLength + 4)
  output[0] = 0xff
  output[1] = marker
  const length = payload.byteLength + 2
  output[2] = length >>> 8
  output[3] = length & 0xff
  output.set(payload, 4)
  return output
}

const appPayload = (header: string, body: string | Uint8Array): Uint8Array => {
  const prefix = new TextEncoder().encode(header)
  const suffix = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const output = new Uint8Array(prefix.byteLength + suffix.byteLength)
  output.set(prefix)
  output.set(suffix, prefix.byteLength)
  return output
}

const stripHdrMetadata = (jpeg: Uint8Array): Uint8Array => {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw invalidInput('JPEG SOI marker is missing')
  const pieces: Uint8Array[] = [jpeg.subarray(0, 2)]
  let position = 2
  let keptStart = 2
  let removed = false
  while (position < jpeg.byteLength) {
    const markerStart = position
    if (jpeg[position++] !== 0xff) throw invalidInput('JPEG marker prefix is missing before SOS')
    while (jpeg[position] === 0xff) position += 1
    const marker = jpeg[position++]
    if (marker === undefined || marker === 0x00) throw invalidInput('JPEG marker is invalid')
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
    if (position + 2 > jpeg.byteLength) throw invalidInput('JPEG marker length is truncated')
    const length = (jpeg[position] ?? 0) * 256 + (jpeg[position + 1] ?? 0)
    if (length < 2 || position + length > jpeg.byteLength) {
      throw invalidInput('JPEG marker payload is truncated')
    }
    const end = position + length
    const payload = jpeg.subarray(position + 2, end)
    const isHdrXmp =
      marker === 0xe1 &&
      (asciiPrefix(payload, EXTENDED_XMP_HEADER) ||
        (asciiPrefix(payload, XMP_HEADER) &&
          (new TextDecoder().decode(payload).includes('http://ns.adobe.com/hdr-gain-map/1.0/') ||
            new TextDecoder()
              .decode(payload)
              .includes('http://ns.google.com/photos/1.0/container/'))))
    const isHdrApp2 =
      marker === 0xe2 && (asciiPrefix(payload, 'MPF\0') || asciiPrefix(payload, ISO_HEADER))
    if (isHdrXmp || isHdrApp2) {
      removed = true
      if (keptStart < markerStart) pieces.push(jpeg.subarray(keptStart, markerStart))
      keptStart = end
    }
    position = end
  }
  if (!removed) return jpeg
  pieces.push(jpeg.subarray(keptStart))
  const length = pieces.reduce((total, piece) => total + piece.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const piece of pieces) {
    output.set(piece, offset)
    offset += piece.byteLength
  }
  return output
}

const metadataPreambleEnd = (jpeg: Uint8Array): number => {
  let position = 2
  while (position + 4 <= jpeg.byteLength && jpeg[position] === 0xff) {
    const marker = jpeg[position + 1]
    if (marker !== 0xe0 && marker !== 0xe1 && marker !== 0xe2) break
    const length = (jpeg[position + 2] ?? 0) * 256 + (jpeg[position + 3] ?? 0)
    if (length < 2 || position + length + 2 > jpeg.byteLength) {
      throw invalidInput('JPEG metadata preamble is truncated')
    }
    const payload = jpeg.subarray(position + 4, position + length + 2)
    const keepBeforeHdr =
      (marker === 0xe0 && (asciiPrefix(payload, 'JFIF\0') || asciiPrefix(payload, 'JFXX\0'))) ||
      (marker === 0xe1 && asciiPrefix(payload, 'Exif\0\0')) ||
      (marker === 0xe2 && asciiPrefix(payload, 'ICC_PROFILE\0'))
    if (!keepBeforeHdr) break
    position += length + 2
  }
  return position
}

const injectAfterMetadataPreamble = (
  jpeg: Uint8Array,
  segments: readonly Uint8Array[],
): Uint8Array => {
  const extra = segments.reduce((total, segment) => total + segment.byteLength, 0)
  const output = new Uint8Array(jpeg.byteLength + extra)
  const insertion = metadataPreambleEnd(jpeg)
  output.set(jpeg.subarray(0, insertion))
  let offset = insertion
  for (const segment of segments) {
    output.set(segment, offset)
    offset += segment.byteLength
  }
  output.set(jpeg.subarray(insertion), offset)
  return output
}

const xml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')

const numberText = (value: number): string => (Object.is(value, -0) ? '0' : value.toString())

const fieldValues = (
  values: GainMapTriplet,
  lexical: readonly string[] | undefined,
  cardinality: 'scalar' | 'rgb',
): readonly string[] => {
  if (lexical && (lexical.length === 1 || lexical.length === 3)) return lexical
  return cardinality === 'scalar'
    ? Object.freeze([numberText(values[0])])
    : Object.freeze(values.map(numberText))
}

const xmpField = (name: string, values: readonly string[]): string => {
  if (values.length === 1) return ` h:${name}="${xml(values[0] ?? '')}"`
  return `<h:${name}><rdf:Seq>${values.map((value) => `<rdf:li>${xml(value)}</rdf:li>`).join('')}</rdf:Seq></h:${name}>`
}

const gainMapXmp = (metadata: GainMapMetadata): string => {
  const lexical = metadata.ultraHdrLexical
  const fields = [
    ['GainMapMin', fieldValues(metadata.minimum, lexical?.minimum, metadata.sourceCardinality)],
    ['GainMapMax', fieldValues(metadata.maximum, lexical?.maximum, metadata.sourceCardinality)],
    ['Gamma', fieldValues(metadata.gamma, lexical?.gamma, metadata.sourceCardinality)],
    ['OffsetSDR', fieldValues(metadata.offsetSdr, lexical?.offsetSdr, metadata.sourceCardinality)],
    ['OffsetHDR', fieldValues(metadata.offsetHdr, lexical?.offsetHdr, metadata.sourceCardinality)],
  ] as const
  let attributes = ''
  let children = ''
  for (const [name, values] of fields) {
    const encoded = xmpField(name, values)
    if (values.length === 1) attributes += encoded
    else children += encoded
  }
  const capacityMinimum = lexical?.capacityMinimum ?? numberText(metadata.capacityMinimum)
  const capacityMaximum = lexical?.capacityMaximum ?? numberText(metadata.capacityMaximum)
  return (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description xmlns:h="http://ns.adobe.com/hdr-gain-map/1.0/"' +
    ' h:Version="1.0"' +
    attributes +
    ` h:HDRCapacityMin="${xml(capacityMinimum)}"` +
    ` h:HDRCapacityMax="${xml(capacityMaximum)}"` +
    ` h:BaseRenditionIsHDR="${metadata.baseRendition === 'hdr' ? 'True' : 'False'}">` +
    children +
    '</rdf:Description></rdf:RDF></x:xmpmeta>'
  )
}

const primaryXmp = (gainMapLength: number): string =>
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description xmlns:c="http://ns.google.com/photos/1.0/container/" ' +
  'xmlns:i="http://ns.google.com/photos/1.0/container/item/" ' +
  'xmlns:h="http://ns.adobe.com/hdr-gain-map/1.0/" h:Version="1.0">' +
  '<c:Directory><rdf:Seq>' +
  '<rdf:li rdf:parseType="Resource"><c:Item i:Semantic="Primary" i:Mime="image/jpeg"/></rdf:li>' +
  '<rdf:li rdf:parseType="Resource"><c:Item i:Semantic="GainMap" i:Mime="image/jpeg" ' +
  `i:Length="${gainMapLength}"/></rdf:li>` +
  '</rdf:Seq></c:Directory></rdf:Description></rdf:RDF></x:xmpmeta>'

const gcd = (left: number, right: number): number => {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const next = a % b
    a = b
    b = next
  }
  return a || 1
}

const rational = (value: number): GainMapRational => {
  if (!Number.isFinite(value)) throw invalidInput('Gain-map metadata must be finite')
  const denominator = 1_000_000
  const numerator = Math.round(value * denominator)
  const divisor = gcd(numerator, denominator)
  return Object.freeze({ numerator: numerator / divisor, denominator: denominator / divisor })
}

const rationals = (
  values: GainMapTriplet,
): readonly [GainMapRational, GainMapRational, GainMapRational] =>
  Object.freeze([rational(values[0]), rational(values[1]), rational(values[2])])

const exactIso = (metadata: GainMapMetadata): GainMapExactIsoMetadata =>
  metadata.exactIso ??
  Object.freeze({
    minimum: rationals(metadata.minimum),
    maximum: rationals(metadata.maximum),
    gamma: rationals(metadata.gamma),
    offsetSdr: rationals(metadata.offsetSdr),
    offsetHdr: rationals(metadata.offsetHdr),
    capacityMinimum: rational(metadata.capacityMinimum),
    capacityMaximum: rational(metadata.capacityMaximum),
  })

const mpfSegment = (
  primaryLength: number,
  gainMapLength: number,
  gainMapOffset: number,
): Uint8Array => {
  const payload = new Uint8Array(86)
  const view = new DataView(payload.buffer)
  payload.set(new TextEncoder().encode('MPF\0MM'), 0)
  view.setUint16(6, 42, false)
  view.setUint32(8, 8, false)
  view.setUint16(12, 3, false)
  let entry = 14
  view.setUint16(entry, 0xb000, false)
  view.setUint16(entry + 2, 7, false)
  view.setUint32(entry + 4, 4, false)
  payload.set(new TextEncoder().encode('0100'), entry + 8)
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
  view.setUint32(54, 0x2003_0000, false)
  view.setUint32(58, primaryLength, false)
  view.setUint32(62, 0, false)
  view.setUint32(70, 0, false)
  view.setUint32(74, gainMapLength, false)
  view.setUint32(78, gainMapOffset, false)
  return jpegSegment(0xe2, payload)
}

const checkedOutputLimit = (value: number | undefined): number => {
  const resolved = value ?? 256 * 1024 * 1024
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput('HDR JPEG maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

class JpegArtifactSource implements ImageSource {
  readonly size: number
  readonly #primary: Uint8Array
  readonly #gainMap: Uint8Array

  constructor(primary: Uint8Array, gainMap: Uint8Array) {
    this.#primary = primary
    this.#gainMap = gainMap
    this.size = primary.byteLength + gainMap.byteLength
  }

  async read(
    offset: number,
    length: number,
    _options?: Readonly<ImageSourceReadOptions>,
  ): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.size
    ) {
      throw invalidInput('HDR JPEG artifact read is outside the output')
    }
    const end = Math.min(this.size, offset + length)
    if (end <= this.#primary.byteLength) return this.#primary.subarray(offset, end)
    if (offset >= this.#primary.byteLength) {
      return this.#gainMap.subarray(
        offset - this.#primary.byteLength,
        end - this.#primary.byteLength,
      )
    }
    const output = new Uint8Array(end - offset)
    const primaryBytes = this.#primary.byteLength - offset
    output.set(this.#primary.subarray(offset), 0)
    output.set(this.#gainMap.subarray(0, output.byteLength - primaryBytes), primaryBytes)
    return output
  }
}

interface PreparedGainMapJpeg {
  readonly primary: Uint8Array
  readonly gainMap: Uint8Array
  readonly outputBytes: number
  release(): void
}

const prepareGainMapJpeg = async (
  artifacts: Readonly<GainMapJpegArtifacts>,
  options: Readonly<AssembleGainMapJpegOptions> = {},
): Promise<PreparedGainMapJpeg> => {
  if (artifacts.metadata.baseRendition !== 'sdr') {
    throw unsupportedOperation('Gain-map JPEG output requires an SDR base rendition')
  }
  const budget = (options as Readonly<AssembleGainMapJpegOptions & InternalMaterializationOptions>)[
    hdrMaterializationBudget
  ]
  const maximum =
    (options as Readonly<AssembleGainMapJpegOptions & InternalMaterializationOptions>)[
      hdrMaterializationMaximum
    ] ?? budget?.maximum
  const reservations: MaterializationReservation[] = []
  const reserve = (bytes: number): void => {
    if (budget && maximum !== undefined) {
      reservations.push(budget.reserve(bytes, maximum, 'assembly-staging'))
    }
  }
  const release = (): void => {
    for (const reservation of reservations) reservation.release()
    reservations.length = 0
  }
  const assemblyEvidence = options.evidence?.child('JPEG metadata and MPF assembly')
  assemblyEvidence?.operation({ operationId: 'hdr-jpeg-metadata-assembly', phase: 'start' })
  try {
    throwIfAborted(options.signal)
    const mode = options.metadataMode ?? 'dual'
    if (mode !== 'dual' && mode !== 'iso' && mode !== 'ultra-hdr') {
      throw invalidInput('HDR JPEG metadataMode is invalid')
    }
    const base = stripHdrMetadata(artifacts.baseJpeg)
    const gain = stripHdrMetadata(artifacts.gainMapJpeg)
    const signalOptions = options.signal === undefined ? {} : { signal: options.signal }
    const [baseHeader, gainHeader, baseEnd, gainEnd] = await Promise.all([
      inspectHdrJpegHeader(new MemorySource(base), 0, signalOptions),
      inspectHdrJpegHeader(new MemorySource(gain), 0, signalOptions),
      findJpegEnd(new MemorySource(base), 0, signalOptions),
      findJpegEnd(new MemorySource(gain), 0, signalOptions),
    ])
    if (baseEnd !== base.byteLength || gainEnd !== gain.byteLength) {
      throw invalidInput('HDR JPEG child inputs must contain exactly one JPEG')
    }
    if (
      baseHeader.dimensions.width !== artifacts.metadata.baseDimensions.width ||
      baseHeader.dimensions.height !== artifacts.metadata.baseDimensions.height ||
      gainHeader.dimensions.width !== artifacts.metadata.gainMapDimensions.width ||
      gainHeader.dimensions.height !== artifacts.metadata.gainMapDimensions.height
    ) {
      throw invalidInput('HDR JPEG child dimensions conflict with gain-map metadata')
    }
    const expectedChannels = gainHeader.dimensions.components === 1 ? 1 : 3
    if (gainHeader.dimensions.components !== 1 && gainHeader.dimensions.components !== 3) {
      throw invalidInput('HDR JPEG gain map must contain one or three components')
    }
    if (artifacts.metadata.channelCount !== expectedChannels) {
      throw invalidInput('HDR JPEG gain-map component count conflicts with metadata')
    }
    const isoData =
      mode === 'ultra-hdr'
        ? undefined
        : encodeIsoGainMapMetadata({
            channelCount: artifacts.metadata.channelCount,
            baseRendition: artifacts.metadata.baseRendition,
            useBaseColorSpace: artifacts.metadata.useBaseColorSpace,
            exact: exactIso(artifacts.metadata),
          })
    const gainSegments: Uint8Array[] = []
    if (mode !== 'iso') {
      gainSegments.push(jpegSegment(0xe1, appPayload(XMP_HEADER, gainMapXmp(artifacts.metadata))))
    }
    if (isoData) gainSegments.push(jpegSegment(0xe2, appPayload(ISO_HEADER, isoData)))
    reserve(
      gain.byteLength + gainSegments.reduce((total, segment) => total + segment.byteLength, 0),
    )
    let gainOutput: Uint8Array
    try {
      gainOutput = injectAfterMetadataPreamble(gain, gainSegments)
    } catch (error) {
      release()
      throw error
    }
    const primaryXmpSegment = jpegSegment(
      0xe1,
      appPayload(XMP_HEADER, primaryXmp(gainOutput.length)),
    )
    const primaryIsoSegment = isoData
      ? jpegSegment(0xe2, appPayload(ISO_HEADER, new Uint8Array(4)))
      : undefined
    const fixedBeforeMpf =
      metadataPreambleEnd(base) + primaryXmpSegment.length + (primaryIsoSegment?.length ?? 0)
    const provisionalMpf = mpfSegment(0, gainOutput.length, 0)
    const primaryLength =
      base.length +
      primaryXmpSegment.length +
      (primaryIsoSegment?.length ?? 0) +
      provisionalMpf.length
    const tiffOffset = fixedBeforeMpf + 8
    const mpf = mpfSegment(primaryLength, gainOutput.length, primaryLength - tiffOffset)
    const primarySegments = primaryIsoSegment
      ? [primaryXmpSegment, primaryIsoSegment, mpf]
      : [primaryXmpSegment, mpf]
    reserve(
      base.byteLength + primarySegments.reduce((total, segment) => total + segment.byteLength, 0),
    )
    let primaryOutput: Uint8Array
    try {
      primaryOutput = injectAfterMetadataPreamble(base, primarySegments)
    } catch (error) {
      release()
      throw error
    }
    const outputBytes = primaryOutput.length + gainOutput.length
    if (
      !Number.isSafeInteger(outputBytes) ||
      outputBytes > checkedOutputLimit(options.maxOutputBytes)
    ) {
      throw limitExceeded('HDR JPEG output exceeds maxOutputBytes')
    }
    const inspection = await inspectHdrJpeg(
      new JpegArtifactSource(primaryOutput, gainOutput),
      signalOptions,
    )
    if (
      inspection.primary.end !== primaryOutput.length ||
      inspection.gainMap?.start !== primaryOutput.length ||
      inspection.gainMap.end !== outputBytes
    ) {
      throw invalidInput('Generated HDR JPEG ranges did not validate')
    }
    assemblyEvidence?.operation({ operationId: 'hdr-jpeg-metadata-assembly', phase: 'complete' })
    return Object.freeze({ primary: primaryOutput, gainMap: gainOutput, outputBytes, release })
  } catch (error) {
    release()
    throw error
  }
}

export const assembleGainMapJpeg = async (
  artifacts: Readonly<GainMapJpegArtifacts>,
  options: Readonly<AssembleGainMapJpegOptions> = {},
): Promise<Uint8Array> => {
  const repackEvidence = options.evidence?.child('bit-preserving repack')
  repackEvidence?.operation({ operationId: 'hdr-bit-preserving-repack', phase: 'start' })
  const prepared = await prepareGainMapJpeg(artifacts, options)
  const budget = (options as Readonly<AssembleGainMapJpegOptions & InternalMaterializationOptions>)[
    hdrMaterializationBudget
  ]
  const maximum =
    (options as Readonly<AssembleGainMapJpegOptions & InternalMaterializationOptions>)[
      hdrMaterializationMaximum
    ] ?? budget?.maximum
  const outputReservation =
    budget && maximum !== undefined
      ? budget.reserve(prepared.outputBytes, maximum, 'final-output')
      : undefined
  try {
    const output = new Uint8Array(prepared.outputBytes)
    output.set(prepared.primary)
    output.set(prepared.gainMap, prepared.primary.byteLength)
    repackEvidence?.operation({ operationId: 'hdr-bit-preserving-repack', phase: 'complete' })
    return output
  } finally {
    prepared.release()
    outputReservation?.release()
  }
}

export const writeGainMapJpeg = async (
  artifacts: Readonly<GainMapJpegArtifacts>,
  sink: ImageSink,
  options: Readonly<AssembleGainMapJpegOptions> = {},
): Promise<void> => {
  try {
    const prepared = await prepareGainMapJpeg(artifacts, options)
    try {
      throwIfAborted(options.signal)
      await sink.write(prepared.primary)
      throwIfAborted(options.signal)
      await sink.write(prepared.gainMap)
      await sink.close()
    } finally {
      prepared.release()
    }
  } catch (error) {
    await sink.abort(error)
    throw error
  }
}
