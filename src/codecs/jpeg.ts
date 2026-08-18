import type {
  ChromaSubsampling,
  DecoderOptions,
  DecodeRequest,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
  PreservedMetadata,
} from '../codec.ts'
import { invalidInput, truncatedInput } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import { type PixelBlock, resumePixelBlocks } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { readExactly, SourceReader } from '../source.ts'
import { uint16BigEndian } from './helpers.ts'
import {
  type BaselineJpeg,
  decodeBaselineJpeg,
  decodeProgressiveJpeg,
  type JpegRegion,
  type ProgressiveJpeg,
  parseBaselineJpegSource,
  parseCoefficientJpegSource,
} from './jpeg-baseline.ts'
import { createBaselineJpegEncoder } from './jpeg-encode.ts'

const startOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])
const standaloneMarkers = new Set([
  0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
])

const isJpeg = (header: Uint8Array): boolean =>
  header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff

const exifOrientation = (segment: Uint8Array): number | undefined => {
  if (
    segment.byteLength < 14 ||
    segment[0] !== 0x45 ||
    segment[1] !== 0x78 ||
    segment[2] !== 0x69 ||
    segment[3] !== 0x66 ||
    segment[4] !== 0 ||
    segment[5] !== 0
  ) {
    return undefined
  }

  const tiff = 6
  const littleEndian = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49
  const bigEndian = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d
  if (!littleEndian && !bigEndian) return undefined

  const read16 = (offset: number): number | undefined => {
    const first = segment[offset]
    const second = segment[offset + 1]
    if (first === undefined || second === undefined) return undefined
    return littleEndian ? first + second * 256 : first * 256 + second
  }
  const read32 = (offset: number): number | undefined => {
    const first = read16(offset)
    const second = read16(offset + 2)
    if (first === undefined || second === undefined) return undefined
    return littleEndian ? first + second * 65_536 : first * 65_536 + second
  }

  if (read16(tiff + 2) !== 42) return undefined
  const relativeIfd = read32(tiff + 4)
  if (relativeIfd === undefined) return undefined
  const ifd = tiff + relativeIfd
  const entries = read16(ifd)
  if (entries === undefined || entries > 4_096) return undefined

  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > segment.byteLength) return undefined
    if (read16(entry) !== 0x0112 || read16(entry + 2) !== 3 || read32(entry + 4) !== 1) continue
    const orientation = read16(entry + 8)
    return orientation !== undefined && orientation >= 1 && orientation <= 8
      ? orientation
      : undefined
  }
  return undefined
}

interface JpegFrameMetadata {
  readonly components: number
  readonly componentIds: Uint8Array
  readonly horizontalSampling: Uint8Array
  readonly verticalSampling: Uint8Array
}

const adobeTransform = (segment: Uint8Array): number | undefined => {
  if (
    segment.byteLength < 12 ||
    segment[0] !== 0x41 ||
    segment[1] !== 0x64 ||
    segment[2] !== 0x6f ||
    segment[3] !== 0x62 ||
    segment[4] !== 0x65 ||
    segment[5] !== 0
  ) {
    return undefined
  }
  return segment[11]
}

const jpegColorSpace = (frame: JpegFrameMetadata, transform: number | undefined): string => {
  const { components, componentIds } = frame
  if (components === 1) return 'gray'
  if (components === 4) return transform === 2 ? 'ycck' : 'cmyk'
  if (
    transform === 0 ||
    (componentIds[0] === 0x52 && componentIds[1] === 0x47 && componentIds[2] === 0x42)
  ) {
    return 'rgb'
  }
  return 'ycbcr'
}

const jpegChromaSubsampling = (frame: JpegFrameMetadata): ChromaSubsampling | undefined => {
  if (frame.components === 1) return '400'
  if (frame.components !== 3) return undefined
  const yH = frame.horizontalSampling[0]
  const yV = frame.verticalSampling[0]
  const cbH = frame.horizontalSampling[1]
  const cbV = frame.verticalSampling[1]
  const crH = frame.horizontalSampling[2]
  const crV = frame.verticalSampling[2]
  if (
    yH === undefined ||
    yV === undefined ||
    cbH === undefined ||
    cbV === undefined ||
    cbH !== crH ||
    cbV !== crV
  ) {
    return undefined
  }
  if (yH === cbH && yV === cbV) return '444'
  if (yH === cbH && yV === cbV * 2) return '440'
  if (yH === cbH * 2 && yV === cbV) return '422'
  if (yH === cbH * 2 && yV === cbV * 2) return '420'
  if (yH === cbH * 4 && yV === cbV) return '411'
  return undefined
}

const mpfImageCount = (segment: Uint8Array): number | undefined => {
  if (
    segment.byteLength < 18 ||
    segment[0] !== 0x4d ||
    segment[1] !== 0x50 ||
    segment[2] !== 0x46 ||
    segment[3] !== 0
  ) {
    return undefined
  }
  const tiff = 4
  const littleEndian = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49
  const bigEndian = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d
  if (!littleEndian && !bigEndian) return undefined
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength)
  const read16 = (offset: number): number | undefined =>
    offset >= 0 && offset + 2 <= segment.byteLength
      ? view.getUint16(offset, littleEndian)
      : undefined
  const read32 = (offset: number): number | undefined =>
    offset >= 0 && offset + 4 <= segment.byteLength
      ? view.getUint32(offset, littleEndian)
      : undefined
  if (read16(tiff + 2) !== 42) return undefined
  const relativeIfd = read32(tiff + 4)
  if (relativeIfd === undefined) return undefined
  const ifd = tiff + relativeIfd
  const entries = read16(ifd)
  if (entries === undefined || entries > 4_096 || ifd + 2 + entries * 12 > segment.byteLength) {
    return undefined
  }
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (read16(entry) !== 0xb001 || read16(entry + 2) !== 4 || read32(entry + 4) !== 1) {
      continue
    }
    const count = read32(entry + 8)
    return count !== undefined && count >= 1 && count <= 1_000 ? count : undefined
  }
  return undefined
}

const region = (width: number, height: number, request: DecodeRequest = {}): JpegRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1
  ) {
    throw invalidInput('JPEG decode region is invalid')
  }
  if (x + outputWidth > width || y + outputHeight > height) {
    throw invalidInput(
      `Decode region ${x},${y} ${outputWidth}x${outputHeight} exceeds ${width}x${height}`,
    )
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

const scaleDenominator = (request: DecodeRequest): 1 | 2 | 4 | 8 => {
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
    throw invalidInput('JPEG decode scale denominator must be 1, 2, 4, or 8')
  }
  return scale
}

class JpegDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #jpeg: BaselineJpeg
  readonly #accelerations: readonly JpegAcceleration[]
  readonly #tolerantDecoding: boolean

  constructor(
    jpeg: BaselineJpeg,
    accelerations: readonly JpegAcceleration[],
    tolerantDecoding: boolean,
  ) {
    this.width = jpeg.width
    this.height = jpeg.height
    this.#jpeg = jpeg
    this.#accelerations = accelerations
    this.#tolerantDecoding = tolerantDecoding
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const output = region(Math.ceil(this.width / scale), Math.ceil(this.height / scale), request)
    for (const acceleration of this.#accelerations) {
      if (!acceleration.decode) continue
      let accelerated: AsyncIterable<PixelBlock> | undefined
      try {
        accelerated = await acceleration.decode({
          jpeg: this.#jpeg,
          region: output,
          scaleDenominator: scale,
          tolerantDecoding: this.#tolerantDecoding,
        })
      } catch {
        continue
      }
      if (!accelerated) continue

      const iterator = accelerated[Symbol.asyncIterator]()
      let firstOutputRow = 0
      while (true) {
        let result: IteratorResult<PixelBlock>
        try {
          result = await iterator.next()
        } catch {
          try {
            await iterator.return?.()
          } catch {}
          yield* resumePixelBlocks(
            decodeBaselineJpeg(this.#jpeg, output, scale, undefined, this.#tolerantDecoding),
            firstOutputRow,
          )
          return
        }
        if (result.done) return
        const block = result.value
        firstOutputRow = Math.max(firstOutputRow, block.y + block.height)
        yield block
      }
    }
    yield* decodeBaselineJpeg(this.#jpeg, output, scale, undefined, this.#tolerantDecoding)
  }
}

class ProgressiveJpegDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities: ImageDecoder['capabilities']
  readonly #jpeg: ProgressiveJpeg

  constructor(jpeg: ProgressiveJpeg) {
    this.width = jpeg.width
    this.height = jpeg.height
    this.#jpeg = jpeg
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: false,
      scaledDecode: true,
      progressive: jpeg.progressive,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const output = region(Math.ceil(this.width / scale), Math.ceil(this.height / scale), request)
    yield* decodeProgressiveJpeg(this.#jpeg, output, scale)
  }
}

export interface JpegAccelerationRequest {
  readonly jpeg: BaselineJpeg
  readonly region: JpegRegion
  readonly scaleDenominator: 1 | 2 | 4 | 8
  readonly tolerantDecoding: boolean
}

export interface JpegAcceleration {
  decode?(request: JpegAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined>
  encode?(sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder | undefined>
}

export interface JpegDecodeAcceleration extends JpegAcceleration {
  decode(request: JpegAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined>
}

export interface JpegEncodeAcceleration extends JpegAcceleration {
  encode(sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder | undefined>
}

const acceleratedJpegCodecs = new WeakMap<ImageCodec, readonly JpegAcceleration[]>()

const registeredJpegAccelerations = (
  codec: ImageCodec,
): readonly JpegAcceleration[] | undefined => {
  if (codec === jpegCodec) return []
  return acceleratedJpegCodecs.get(codec)
}

const decodeJpeg = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
  accelerations: readonly JpegAcceleration[] = [],
): Promise<ImageDecoder> => {
  const applyIcc = options.preserveIcc !== true
  const baseline = await parseBaselineJpegSource(source, applyIcc)
  if (baseline) {
    validateImageDimensions(baseline.width, baseline.height, 1, limits)
    return new JpegDecoder(baseline, accelerations, options.tolerantDecoding === true)
  }
  const progressive = await parseCoefficientJpegSource(
    source,
    (width, height) => {
      validateImageDimensions(width, height, 1, limits)
    },
    applyIcc,
    limits.maxDecodedBytes,
    options.tolerantDecoding === true,
  )
  if (!progressive) throw invalidInput('JPEG coding process is unsupported')
  return new ProgressiveJpegDecoder(progressive)
}
const encodeJpeg = async (
  sink: ImageSink,
  request: EncodeRequest,
  accelerations: readonly JpegAcceleration[],
): Promise<ImageEncoder> => {
  for (const acceleration of accelerations) {
    if (!acceleration.encode) continue
    const encoder = await acceleration.encode(sink, request)
    if (encoder) return encoder
  }
  return createBaselineJpegEncoder(sink, request)
}

interface JpegIccChunk {
  readonly sequence: number
  readonly count: number
  readonly data: Uint8Array
}

const jpegPreservedMetadata = async (source: ImageSource): Promise<PreservedMetadata> => {
  const data = await readExactly(source, 0, source.size)
  let exif: Uint8Array | undefined
  const iccChunks: JpegIccChunk[] = []
  let offset = 2
  while (offset < data.byteLength) {
    while (data[offset] === 0xff) offset += 1
    const marker = data[offset]
    if (marker === undefined) throw truncatedInput('JPEG marker is truncated')
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00 || standaloneMarkers.has(marker)) continue
    if (offset + 2 > data.byteLength) throw truncatedInput('JPEG segment length is truncated')
    const length = uint16BigEndian(data, offset)
    if (length < 2) throw invalidInput('JPEG segment length is invalid')
    const start = offset + 2
    const end = offset + length
    if (end > data.byteLength) throw truncatedInput('JPEG segment is truncated')
    if (
      marker === 0xe1 &&
      exif === undefined &&
      end - start >= 6 &&
      data[start] === 0x45 &&
      data[start + 1] === 0x78 &&
      data[start + 2] === 0x69 &&
      data[start + 3] === 0x66 &&
      data[start + 4] === 0 &&
      data[start + 5] === 0
    ) {
      exif = Uint8Array.from(data.subarray(start + 6, end))
    } else if (
      marker === 0xe2 &&
      end - start >= 14 &&
      data[start] === 0x49 &&
      data[start + 1] === 0x43 &&
      data[start + 2] === 0x43 &&
      data[start + 3] === 0x5f &&
      data[start + 4] === 0x50 &&
      data[start + 5] === 0x52 &&
      data[start + 6] === 0x4f &&
      data[start + 7] === 0x46 &&
      data[start + 8] === 0x49 &&
      data[start + 9] === 0x4c &&
      data[start + 10] === 0x45 &&
      data[start + 11] === 0
    ) {
      const sequence = data[start + 12] ?? 0
      const count = data[start + 13] ?? 0
      if (sequence < 1 || count < 1 || sequence > count)
        throw invalidInput('JPEG ICC chunk numbering is invalid')
      iccChunks.push({ sequence, count, data: Uint8Array.from(data.subarray(start + 14, end)) })
    }
    offset = end
  }
  let icc: Uint8Array | undefined
  if (iccChunks.length > 0) {
    const count = iccChunks[0]?.count ?? 0
    if (count !== iccChunks.length || iccChunks.some((chunk) => chunk.count !== count))
      throw invalidInput('JPEG ICC profile chunks are incomplete')
    const ordered = new Array<Uint8Array | undefined>(count)
    let size = 0
    for (const chunk of iccChunks) {
      if (ordered[chunk.sequence - 1]) throw invalidInput('JPEG ICC profile repeats a chunk')
      ordered[chunk.sequence - 1] = chunk.data
      size += chunk.data.byteLength
      if (size > 16 * 1024 * 1024) throw invalidInput('JPEG ICC profile exceeds 16 MiB')
    }
    icc = new Uint8Array(size)
    let position = 0
    for (const chunk of ordered) {
      if (!chunk) throw invalidInput('JPEG ICC profile chunks are incomplete')
      icc.set(chunk, position)
      position += chunk.byteLength
    }
  }
  return {
    ...(exif ? { exif } : {}),
    ...(icc ? { icc } : {}),
  }
}

export const jpegCodec: ImageCodec = {
  format: 'jpeg',
  mimeTypes: ['image/jpeg'],
  minimumBytes: 3,
  detect: isJpeg,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const reader = new SourceReader(source, 2)
    let width: number | undefined
    let height: number | undefined
    let bitDepth: number | undefined
    let frameMetadata: JpegFrameMetadata | undefined
    let orientation: number | undefined
    let transform: number | undefined
    let frames: number | undefined

    for (let segments = 0; reader.position < source.size && segments < 10_000; segments += 1) {
      let prefix = await reader.readByte()
      while (prefix !== 0xff && reader.position < source.size) prefix = await reader.readByte()
      if (prefix !== 0xff) break

      let marker = await reader.readByte()
      while (marker === 0xff) marker = await reader.readByte()
      if (marker === 0x00 || standaloneMarkers.has(marker)) continue

      const length = uint16BigEndian(await reader.read(2), 0)
      if (length < 2)
        throw invalidInput(`JPEG marker 0x${marker.toString(16)} has an invalid length`)
      const payloadLength = length - 2

      if (marker === 0xda) {
        reader.skip(payloadLength)
        break
      }
      if (marker === 0xe1 && orientation === undefined) {
        orientation = exifOrientation(await reader.read(payloadLength))
        continue
      }
      if (marker === 0xe2 && frames === undefined) {
        frames = mpfImageCount(await reader.read(payloadLength))
        continue
      }
      if (marker === 0xee && transform === undefined) {
        transform = adobeTransform(await reader.read(payloadLength))
        continue
      }
      if (startOfFrameMarkers.has(marker)) {
        const frame = await reader.read(payloadLength)
        if (frame.byteLength < 6) throw invalidInput('JPEG start-of-frame marker is truncated')
        bitDepth = frame[0]
        height = uint16BigEndian(frame, 1)
        width = uint16BigEndian(frame, 3)
        const components = frame[5] ?? 0
        if (components < 1 || frame.byteLength < 6 + components * 3) {
          throw invalidInput('JPEG start-of-frame components are truncated')
        }
        const componentIds = new Uint8Array(components)
        const horizontalSampling = new Uint8Array(components)
        const verticalSampling = new Uint8Array(components)
        for (let index = 0; index < components; index += 1) {
          const offset = 6 + index * 3
          componentIds[index] = frame[offset] ?? 0
          const sampling = frame[offset + 1] ?? 0
          horizontalSampling[index] = sampling >>> 4
          verticalSampling[index] = sampling & 15
        }
        frameMetadata = {
          components,
          componentIds,
          horizontalSampling,
          verticalSampling,
        }
        continue
      }
      reader.skip(payloadLength)
    }

    if (
      width === undefined ||
      height === undefined ||
      bitDepth === undefined ||
      frameMetadata === undefined
    ) {
      throw invalidInput('JPEG dimensions were not found before image data')
    }
    validateImageDimensions(width, height, 1, limits)
    const chromaSubsampling = jpegChromaSubsampling(frameMetadata)
    return {
      width,
      height,
      format: 'jpeg',
      mimeType: 'image/jpeg',
      hasAlpha: false,
      ...(orientation ? { orientation } : {}),
      colorSpace: jpegColorSpace(frameMetadata, transform),
      bitDepth,
      ...(chromaSubsampling ? { chromaSubsampling } : {}),
      frames: frames ?? 1,
    }
  },
  preservedMetadata: jpegPreservedMetadata,
  createDecoder: decodeJpeg,
  createEncoder: createBaselineJpegEncoder,
}

export { inspectJpegCodestream, type JpegCodestreamInspection } from './jpeg-baseline.ts'

export const accelerateJpegCodec = (
  reference: ImageCodec,
  acceleration: JpegAcceleration,
): ImageCodec => {
  const registered = registeredJpegAccelerations(reference)
  if (!registered) {
    throw new Error('JPEG acceleration requires the PureJsImage reference JPEG codec')
  }
  const accelerations = Object.freeze([...registered, acceleration])
  const accelerated: ImageCodec = Object.freeze({
    ...reference,
    createDecoder: (
      source: ImageSource,
      limits: ImageLimits,
      options?: Readonly<DecoderOptions>,
    ): Promise<ImageDecoder> => decodeJpeg(source, limits, options, accelerations),
    createEncoder: (sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder> =>
      encodeJpeg(sink, request, accelerations),
  })
  acceleratedJpegCodecs.set(accelerated, accelerations)
  return accelerated
}
