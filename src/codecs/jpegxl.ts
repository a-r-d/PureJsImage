import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import type { ImageLimitOptions, ImageLimits } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import { createImageSource, readExactly, type ImageInput, type ImageSource } from '../source.ts'
import { ascii, uint32BigEndian } from './helpers.ts'
import { createIsobmffReader, type IsobmffBox } from './isobmff.ts'
import { decodeJpegXlCodestream, readJpegXlCodestreamMetadata } from './jpegxl-decode.ts'

const rawSignature = Uint8Array.of(0xff, 0x0a)
const containerSignature = Uint8Array.of(
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
}

export interface JpegXlStructure {
  readonly kind: 'raw-codestream' | 'container'
  readonly codestreamBytes: number
  readonly codestreamSegments: readonly JpegXlCodestreamSegment[]
  readonly boxes: readonly JpegXlBoxSummary[]
  readonly metadataBoxes: readonly JpegXlBoxSummary[]
}

const startsWith = (data: Uint8Array, signature: Uint8Array): boolean =>
  data.byteLength >= signature.byteLength &&
  signature.every((value, index) => data[index] === value)

const summary = (box: IsobmffBox): JpegXlBoxSummary =>
  Object.freeze({ type: box.type, offset: box.start, length: box.end - box.start })

const validateFileType = async (
  reader: ReturnType<typeof createIsobmffReader>,
  box: IsobmffBox,
): Promise<void> => {
  const payload = await reader.payload(box, 4_096)
  if (payload.byteLength < 8 || payload.byteLength % 4 !== 0) {
    throw invalidInput('JPEG XL ftyp box is malformed')
  }
  const majorBrand = ascii(payload, 0, 4)
  const compatible: string[] = []
  for (let offset = 8; offset < payload.byteLength; offset += 4) {
    compatible.push(ascii(payload, offset, 4))
  }
  if (majorBrand !== 'jxl ' && !compatible.includes('jxl ')) {
    throw invalidInput('JPEG XL ftyp box does not declare the jxl brand')
  }
}

const validateCodestreamStart = async (
  source: ImageSource,
  segment: JpegXlCodestreamSegment,
): Promise<void> => {
  if (segment.length < rawSignature.byteLength) {
    throw invalidInput('JPEG XL codestream segment is truncated')
  }
  if (
    !startsWith(await readExactly(source, segment.offset, rawSignature.byteLength), rawSignature)
  ) {
    throw invalidInput('JPEG XL codestream signature is missing')
  }
}

const inspectContainer = async (source: ImageSource): Promise<JpegXlStructure> => {
  const reader = createIsobmffReader(source, 'JPEG XL')
  const boxes = await reader.boxes(0, source.size)
  const signature = boxes[0]
  const fileType = boxes[1]
  if (
    signature?.type !== 'JXL ' ||
    signature.start !== 0 ||
    signature.end !== containerSignature.byteLength
  ) {
    throw invalidInput('JPEG XL container signature box is malformed')
  }
  const signaturePayload = await reader.payload(signature, 4)
  if (!startsWith(signaturePayload, containerSignature.subarray(8))) {
    throw invalidInput('JPEG XL container signature payload is invalid')
  }
  if (fileType?.type !== 'ftyp') throw invalidInput('JPEG XL container requires ftyp after JXL')
  if (
    boxes.filter(({ type }) => type === 'JXL ').length !== 1 ||
    boxes.filter(({ type }) => type === 'ftyp').length !== 1
  ) {
    throw invalidInput('JPEG XL container repeats a required signature or ftyp box')
  }
  await validateFileType(reader, fileType)

  const complete = boxes.filter(({ type }) => type === 'jxlc')
  const partial = boxes.filter(({ type }) => type === 'jxlp')
  if (complete.length > 0 && partial.length > 0) {
    throw invalidInput('JPEG XL container mixes jxlc and jxlp codestream representations')
  }
  if (complete.length > 1) throw invalidInput('JPEG XL container repeats the jxlc box')
  const segments: JpegXlCodestreamSegment[] = []
  if (complete.length === 1) {
    const box = complete[0]
    if (!box) throw invalidInput('JPEG XL jxlc box is missing')
    segments.push(
      Object.freeze({ offset: box.contentStart, length: box.end - box.contentStart, index: 0 }),
    )
  } else if (partial.length > 0) {
    let finalSeen = false
    for (let expectedIndex = 0; expectedIndex < partial.length; expectedIndex += 1) {
      const box = partial[expectedIndex]
      if (!box || box.end - box.contentStart < 4) {
        throw invalidInput('JPEG XL jxlp box is truncated')
      }
      const header = await readExactly(source, box.contentStart, 4)
      const indexAndFinal = uint32BigEndian(header, 0)
      const index = indexAndFinal & 0x7fff_ffff
      const final = (indexAndFinal & 0x8000_0000) !== 0
      if (index !== expectedIndex) {
        throw invalidInput('JPEG XL jxlp indexes must be unique and in ascending order')
      }
      if (finalSeen || (final && expectedIndex !== partial.length - 1)) {
        throw invalidInput('JPEG XL jxlp final-fragment signaling is invalid')
      }
      finalSeen ||= final
      segments.push(
        Object.freeze({
          offset: box.contentStart + 4,
          length: box.end - box.contentStart - 4,
          index,
        }),
      )
    }
    if (!finalSeen) throw invalidInput('JPEG XL jxlp sequence has no final fragment')
  } else {
    throw invalidInput('JPEG XL container contains no jxlc or jxlp codestream')
  }
  const firstSegment = segments[0]
  if (!firstSegment) throw invalidInput('JPEG XL container codestream is empty')
  await validateCodestreamStart(source, firstSegment)
  const metadataTypes = new Set(['Exif', 'xml ', 'jumb', 'jbrd', 'brob'])
  const metadataBoxes = boxes.filter(({ type }) => metadataTypes.has(type)).map(summary)
  return Object.freeze({
    kind: 'container',
    codestreamBytes: segments.reduce((sum, segment) => sum + segment.length, 0),
    codestreamSegments: Object.freeze(segments),
    boxes: Object.freeze(boxes.map(summary)),
    metadataBoxes: Object.freeze(metadataBoxes),
  })
}

/**
 * Validates JPEG XL raw-codestream or container structure without decoding
 * image metadata or pixels. Container inspection validates box extents, the
 * signature and ftyp boxes, and one jxlc or ordered jxlp representation. It
 * returns source ranges and does not concatenate codestream fragments.
 *
 * This is the structure-inspection foundation used by the registered JPEG XL
 * codec entry. Pixel metadata and decoding remain unsupported.
 */
const inspectJpegXlSource = async (source: ImageSource): Promise<JpegXlStructure> => {
  if (source.size < rawSignature.byteLength) {
    throw invalidInput('JPEG XL signature is truncated')
  }
  const header = await readExactly(source, 0, Math.min(containerSignature.byteLength, source.size))
  if (startsWith(header, rawSignature)) {
    return Object.freeze({
      kind: 'raw-codestream',
      codestreamBytes: source.size,
      codestreamSegments: Object.freeze([
        Object.freeze({ offset: 0, length: source.size, index: 0 }),
      ]),
      boxes: Object.freeze([]),
      metadataBoxes: Object.freeze([]),
    })
  }
  if (startsWith(header, containerSignature)) return inspectContainer(source)
  if (header.byteLength >= 8 && ascii(header, 4, 4) === 'JXL ') {
    throw invalidInput('JPEG XL container signature is malformed')
  }
  throw unsupportedOperation('Input is not a JPEG XL codestream or container')
}

export const inspectJpegXlStructure = async (
  input: ImageInput,
  options: Readonly<ImageLimitOptions> = {},
): Promise<JpegXlStructure> =>
  inspectJpegXlSource(await createImageSource(input, resolveLimits(options)))

const readCodestream = async (source: ImageSource): Promise<Uint8Array> => {
  const structure = await inspectJpegXlSource(source)
  const segment = structure.codestreamSegments[0]
  if (!segment || structure.codestreamSegments.length !== 1) {
    throw unsupportedOperation('JPEG XL fragmented jxlp codestream decoding is not implemented')
  }
  return readExactly(source, segment.offset, segment.length)
}

/** Registered first-party JPEG XL codec with a bounded lossless Modular subset. */
export const jpegxlCodec: ImageCodec = Object.freeze({
  format: 'jpegxl',
  mimeTypes: ['image/jxl'],
  minimumBytes: rawSignature.byteLength,
  detect(header: Uint8Array): boolean {
    return startsWith(header, rawSignature) || startsWith(header, containerSignature)
  },
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    return readJpegXlCodestreamMetadata(await readCodestream(source), limits)
  },
  async createDecoder(source: ImageSource, limits: ImageLimits): Promise<ImageDecoder> {
    return decodeJpegXlCodestream(await readCodestream(source), limits).decoder
  },
})
