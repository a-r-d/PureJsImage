import type { AbortOptions } from '../abort.ts'
import { throwIfAborted } from '../abort.ts'
import type { MetadataPreservationOptions, PreservedMetadata } from '../codec.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import { normalizeExifOrientation } from '../metadata.ts'
import type { ImageSource, ImageSourceReadOptions } from '../source.ts'
import { readExactly } from '../source.ts'
import { decodeBrotli } from './brotli.ts'
import { ascii, uint32BigEndian } from './helpers.ts'
import { createIsobmffReader, type IsobmffBox } from './isobmff.ts'
import type { JpegXlLimits } from './jpegxl-limits.ts'

export const jpegXlRawSignature = Uint8Array.of(0xff, 0x0a)
export const jpegXlContainerSignature = Uint8Array.of(
  0x00,
  0x00,
  0x00,
  0x0c,
  0x4a,
  0x58,
  0x4c,
  0x20,
  0x0d,
  0x0a,
  0x87,
  0x0a,
)

export interface JpegXlCodestreamSegment {
  readonly offset: number
  readonly length: number
  readonly index: number
}

export interface JpegXlBoxSummary {
  readonly type: string
  readonly offset: number
  readonly length: number
  readonly payloadBytes: number
}

export interface JpegXlStructure {
  readonly kind: 'raw-codestream' | 'container'
  readonly organization: 'raw' | 'jxlc' | 'jxlp'
  readonly containerVersion: 0 | 1 | undefined
  readonly level: 5 | 10 | undefined
  readonly codestreamBytes: number
  readonly codestreamSegments: readonly JpegXlCodestreamSegment[]
  readonly boxes: readonly JpegXlBoxSummary[]
  readonly metadataBoxes: readonly JpegXlBoxSummary[]
}

const startsWith = (data: Uint8Array, signature: Uint8Array): boolean =>
  data.byteLength >= signature.byteLength &&
  signature.every((value, index) => data[index] === value)

const summary = (box: IsobmffBox): JpegXlBoxSummary =>
  Object.freeze({
    type: box.type,
    offset: box.start,
    length: box.end - box.start,
    payloadBytes: box.end - box.contentStart,
  })

const validateFileType = async (
  reader: ReturnType<typeof createIsobmffReader>,
  box: IsobmffBox,
  options: Readonly<AbortOptions>,
): Promise<0 | 1> => {
  const payload = await reader.payload(box, 4_096)
  throwIfAborted(options.signal)
  if (payload.byteLength < 8 || payload.byteLength % 4 !== 0) {
    throw invalidInput('JPEG XL ftyp box is malformed')
  }
  const majorBrand = ascii(payload, 0, 4)
  let declaresJpegXl = majorBrand === 'jxl '
  for (let offset = 8; offset < payload.byteLength; offset += 4) {
    declaresJpegXl ||= ascii(payload, offset, 4) === 'jxl '
  }
  if (!declaresJpegXl) throw invalidInput('JPEG XL ftyp box does not declare the jxl brand')
  const version = uint32BigEndian(payload, 4)
  if (version !== 0 && version !== 1) {
    throw unsupportedOperation(`JPEG XL container version ${version} is not supported`)
  }
  return version
}

const validateCodestreamStart = async (
  source: ImageSource,
  segment: JpegXlCodestreamSegment,
  options: Readonly<AbortOptions>,
): Promise<void> => {
  if (segment.length < jpegXlRawSignature.byteLength) {
    throw invalidInput('JPEG XL codestream segment is truncated')
  }
  const signature = await readExactly(
    source,
    segment.offset,
    jpegXlRawSignature.byteLength,
    options,
  )
  if (!startsWith(signature, jpegXlRawSignature)) {
    throw invalidInput('JPEG XL codestream signature is missing')
  }
}

const checkedCodestreamBytes = (
  segments: readonly JpegXlCodestreamSegment[],
  limits: JpegXlLimits,
): number => {
  let bytes = 0
  for (const segment of segments) {
    bytes += segment.length
    if (!Number.isSafeInteger(bytes)) throw invalidInput('JPEG XL codestream size overflows')
  }
  if (bytes > limits.maxCodestreamBytes) {
    throw limitExceeded(
      `JPEG XL codestream has ${bytes} bytes; maxCodestreamBytes is ${limits.maxCodestreamBytes}`,
    )
  }
  return bytes
}

const inspectContainer = async (
  source: ImageSource,
  limits: JpegXlLimits,
  options: Readonly<AbortOptions>,
): Promise<JpegXlStructure> => {
  const reader = createIsobmffReader(source, 'JPEG XL')
  const boxes = await reader.boxes(0, source.size)
  throwIfAborted(options.signal)
  if (boxes.length > limits.maxBoxes) {
    throw limitExceeded(`JPEG XL has ${boxes.length} boxes; maxBoxes is ${limits.maxBoxes}`)
  }
  const signature = boxes[0]
  const fileType = boxes[1]
  if (
    signature?.type !== 'JXL ' ||
    signature.start !== 0 ||
    signature.end !== jpegXlContainerSignature.byteLength
  ) {
    throw invalidInput('JPEG XL container signature box is malformed')
  }
  const signaturePayload = await reader.payload(signature, 4)
  if (!startsWith(signaturePayload, jpegXlContainerSignature.subarray(8))) {
    throw invalidInput('JPEG XL container signature payload is invalid')
  }
  if (fileType?.type !== 'ftyp') throw invalidInput('JPEG XL container requires ftyp after JXL')
  if (
    boxes.filter(({ type }) => type === 'JXL ').length !== 1 ||
    boxes.filter(({ type }) => type === 'ftyp').length !== 1
  ) {
    throw invalidInput('JPEG XL container repeats a required signature or ftyp box')
  }
  const containerVersion = await validateFileType(reader, fileType, options)

  const levelBoxes = boxes.filter(({ type }) => type === 'jxll')
  if (levelBoxes.length > 1) throw invalidInput('JPEG XL container repeats the jxll box')
  let level: 5 | 10 | undefined
  const levelBox = levelBoxes[0]
  if (levelBox) {
    const payload = await reader.payload(levelBox, 1)
    const value = payload[0]
    if (payload.byteLength !== 1 || (value !== 5 && value !== 10)) {
      throw invalidInput('JPEG XL jxll level is invalid')
    }
    level = value
  }

  const frameIndexes = boxes.filter(({ type }) => type === 'jxli')
  if (frameIndexes.length > 1) throw invalidInput('JPEG XL container repeats the jxli box')
  const frameIndex = frameIndexes[0]
  if (frameIndex && frameIndex.end - frameIndex.contentStart > limits.maxMetadataBytes) {
    throw limitExceeded('JPEG XL jxli box exceeds maxMetadataBytes')
  }

  const complete = boxes.filter(({ type }) => type === 'jxlc')
  const partial = boxes.filter(({ type }) => type === 'jxlp')
  if (complete.length > 0 && partial.length > 0) {
    throw invalidInput('JPEG XL container mixes jxlc and jxlp codestream representations')
  }
  if (complete.length > 1) throw invalidInput('JPEG XL container repeats the jxlc box')
  if (partial.length > limits.maxSegments) {
    throw limitExceeded(
      `JPEG XL has ${partial.length} jxlp segments; maxSegments is ${limits.maxSegments}`,
    )
  }

  const segments: JpegXlCodestreamSegment[] = []
  let organization: JpegXlStructure['organization']
  if (complete.length === 1) {
    organization = 'jxlc'
    const box = complete[0]
    if (!box) throw invalidInput('JPEG XL jxlc box is missing')
    segments.push(
      Object.freeze({ offset: box.contentStart, length: box.end - box.contentStart, index: 0 }),
    )
  } else if (partial.length > 0) {
    organization = 'jxlp'
    let finalIndex: number | undefined
    const indexes = new Set<number>()
    for (let physicalIndex = 0; physicalIndex < partial.length; physicalIndex += 1) {
      throwIfAborted(options.signal)
      const box = partial[physicalIndex]
      if (!box || box.end - box.contentStart < 4) {
        throw invalidInput('JPEG XL jxlp box is truncated')
      }
      const header = await readExactly(source, box.contentStart, 4, options)
      const indexAndFinal = uint32BigEndian(header, 0)
      const index = indexAndFinal & 0x7fff_ffff
      const final = (indexAndFinal & 0x8000_0000) !== 0
      if (indexes.has(index)) throw invalidInput('JPEG XL jxlp indexes must be unique')
      indexes.add(index)
      if (containerVersion === 0 && index !== physicalIndex) {
        throw invalidInput('JPEG XL version 0 jxlp indexes must be in ascending order')
      }
      if (final) {
        if (finalIndex !== undefined) {
          throw invalidInput('JPEG XL jxlp final-fragment signaling is invalid')
        }
        finalIndex = index
      }
      segments.push(
        Object.freeze({
          offset: box.contentStart + 4,
          length: box.end - box.contentStart - 4,
          index,
        }),
      )
    }
    if (finalIndex === undefined) throw invalidInput('JPEG XL jxlp sequence has no final fragment')
    if (finalIndex !== partial.length - 1 || indexes.size !== partial.length) {
      throw invalidInput('JPEG XL jxlp indexes are not a contiguous sequence')
    }
    segments.sort((left, right) => left.index - right.index)
  } else {
    throw invalidInput('JPEG XL container contains no jxlc or jxlp codestream')
  }

  const firstSegment = segments[0]
  if (!firstSegment) throw invalidInput('JPEG XL container codestream is empty')
  await validateCodestreamStart(source, firstSegment, options)

  const metadataTypes = new Set(['Exif', 'xml ', 'jumb', 'jbrd', 'brob'])
  const metadataBoxes = boxes.filter(({ type }) => metadataTypes.has(type)).map(summary)
  if (metadataBoxes.filter(({ type }) => type === 'jbrd').length > 1) {
    throw invalidInput('JPEG XL container repeats the jbrd box')
  }
  const metadataBytes = metadataBoxes.reduce((sum, box) => sum + box.payloadBytes, 0)
  if (!Number.isSafeInteger(metadataBytes)) throw invalidInput('JPEG XL metadata size overflows')
  if (metadataBytes > limits.maxMetadataBytes) {
    throw limitExceeded(
      `JPEG XL metadata has ${metadataBytes} bytes; maxMetadataBytes is ${limits.maxMetadataBytes}`,
    )
  }

  return Object.freeze({
    kind: 'container',
    organization,
    containerVersion,
    level,
    codestreamBytes: checkedCodestreamBytes(segments, limits),
    codestreamSegments: Object.freeze(segments),
    boxes: Object.freeze(boxes.map(summary)),
    metadataBoxes: Object.freeze(metadataBoxes),
  })
}

export const inspectJpegXlSource = async (
  source: ImageSource,
  limits: JpegXlLimits,
  options: Readonly<AbortOptions> = {},
): Promise<JpegXlStructure> => {
  throwIfAborted(options.signal)
  if (source.size < jpegXlRawSignature.byteLength) {
    throw invalidInput('JPEG XL signature is truncated')
  }
  const header = await readExactly(
    source,
    0,
    Math.min(jpegXlContainerSignature.byteLength, source.size),
    options,
  )
  if (startsWith(header, jpegXlRawSignature)) {
    if (source.size > limits.maxCodestreamBytes) {
      throw limitExceeded(
        `JPEG XL codestream has ${source.size} bytes; maxCodestreamBytes is ${limits.maxCodestreamBytes}`,
      )
    }
    return Object.freeze({
      kind: 'raw-codestream',
      organization: 'raw',
      containerVersion: undefined,
      level: undefined,
      codestreamBytes: source.size,
      codestreamSegments: Object.freeze([
        Object.freeze({ offset: 0, length: source.size, index: 0 }),
      ]),
      boxes: Object.freeze([]),
      metadataBoxes: Object.freeze([]),
    })
  }
  if (startsWith(header, jpegXlContainerSignature)) return inspectContainer(source, limits, options)
  if (header.byteLength >= 8 && ascii(header, 4, 4) === 'JXL ') {
    throw invalidInput('JPEG XL container signature is malformed')
  }
  throw unsupportedOperation('Input is not a JPEG XL codestream or container')
}

const boxContentStart = (box: JpegXlBoxSummary): number =>
  box.offset + box.length - box.payloadBytes

const decodedMetadataBoxes = async (
  source: ImageSource,
  structure: JpegXlStructure,
  limits: JpegXlLimits,
  options: Readonly<MetadataPreservationOptions>,
): Promise<ReadonlyMap<string, Uint8Array>> => {
  const decoded = new Map<string, Uint8Array>()
  const requested = (type: string): boolean =>
    (type === 'Exif' && options.exif) ||
    (type === 'xml ' && options.xmp === true) ||
    (type === 'jumb' && options.jumbf === true)
  let decodedBytes = 0
  for (const box of structure.metadataBoxes) {
    throwIfAborted(options.signal)
    let type = box.type
    if (type === 'brob') {
      if (box.payloadBytes < 5) throw invalidInput('JPEG XL brob metadata is truncated')
      type = ascii(await readExactly(source, boxContentStart(box), 4, options), 0, 4)
      if (type.startsWith('jxl') || type === 'brob' || type === 'jbrd') {
        throw invalidInput(`JPEG XL brob cannot contain ${type}`)
      }
    }
    if (!requested(type)) continue
    if (decoded.has(type)) throw invalidInput(`JPEG XL repeats the ${type} metadata payload`)
    const payload = await readExactly(source, boxContentStart(box), box.payloadBytes, options)
    let contents = payload
    if (box.type === 'brob') {
      contents = decodeBrotli(payload.subarray(4), {
        maxOutputBytes: limits.maxMetadataBytes - decodedBytes,
        maxMetadataBytes: limits.maxMetadataBytes,
      })
    }
    decodedBytes += contents.byteLength
    if (decodedBytes > limits.maxMetadataBytes) {
      throw limitExceeded(`JPEG XL ${type} metadata exceeds maxMetadataBytes`)
    }
    decoded.set(type, contents)
  }
  return decoded
}

export const readJpegXlPreservedMetadata = async (
  source: ImageSource,
  structure: JpegXlStructure,
  limits: JpegXlLimits,
  options: Readonly<MetadataPreservationOptions>,
): Promise<Readonly<PreservedMetadata>> => {
  if (structure.kind === 'raw-codestream') return Object.freeze({})
  const decoded = await decodedMetadataBoxes(source, structure, limits, options)
  const exifBox = options.exif ? decoded.get('Exif') : undefined
  let exif: Uint8Array | undefined
  if (exifBox) {
    if (exifBox.byteLength < 12) throw invalidInput('JPEG XL Exif metadata is truncated')
    const tiffOffset = uint32BigEndian(exifBox, 0)
    const start = 4 + tiffOffset
    if (start + 8 > exifBox.byteLength) throw invalidInput('JPEG XL Exif TIFF offset is invalid')
    exif = Uint8Array.from(exifBox.subarray(start))
    // Validate the TIFF header and first IFD without altering the preserved payload.
    normalizeExifOrientation(exif)
  }
  const xmp = options.xmp ? decoded.get('xml ') : undefined
  const jumbf = options.jumbf ? decoded.get('jumb') : undefined
  return Object.freeze({
    ...(exif === undefined ? {} : { exif }),
    ...(xmp === undefined ? {} : { xmp: Uint8Array.from(xmp) }),
    ...(jumbf === undefined ? {} : { jumbf: Uint8Array.from(jumbf) }),
  })
}

interface LogicalSegment extends JpegXlCodestreamSegment {
  readonly logicalStart: number
}

export class JpegXlCodestreamSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #segments: readonly LogicalSegment[]

  constructor(source: ImageSource, structure: JpegXlStructure) {
    this.#source = source
    this.size = structure.codestreamBytes
    let logicalStart = 0
    this.#segments = Object.freeze(
      structure.codestreamSegments.map((segment) => {
        const logical = Object.freeze({ ...segment, logicalStart })
        logicalStart += segment.length
        if (!Number.isSafeInteger(logicalStart)) {
          throw invalidInput('JPEG XL logical codestream size overflows')
        }
        return logical
      }),
    )
    if (logicalStart !== this.size) throw invalidInput('JPEG XL logical codestream size is invalid')
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    throwIfAborted(options.signal)
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw invalidInput('JPEG XL logical read offset is invalid')
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('JPEG XL logical read length is invalid')
    }
    const available = offset >= this.size ? 0 : Math.min(length, this.size - offset)
    if (available === 0) return new Uint8Array()

    const end = offset + available
    const overlapping = this.#segments.filter(
      (segment) => segment.logicalStart < end && segment.logicalStart + segment.length > offset,
    )
    const only = overlapping[0]
    if (overlapping.length === 1 && only) {
      const within = offset - only.logicalStart
      return this.#source.read(only.offset + within, available, options)
    }

    const output = new Uint8Array(available)
    let written = 0
    for (const segment of overlapping) {
      throwIfAborted(options.signal)
      const logicalOffset = Math.max(offset, segment.logicalStart)
      const logicalEnd = Math.min(end, segment.logicalStart + segment.length)
      const amount = logicalEnd - logicalOffset
      const physicalOffset = segment.offset + logicalOffset - segment.logicalStart
      output.set(await readExactly(this.#source, physicalOffset, amount, options), written)
      written += amount
    }
    if (written !== available) throw invalidInput('JPEG XL logical codestream has a gap')
    return output
  }
}
