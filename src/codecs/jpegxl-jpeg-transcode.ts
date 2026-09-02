import { ImageError, invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageDecoder, ImageEncoder } from '../codec.ts'
import type { EvidenceContext } from '../evidence.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import type { ImageSink } from '../sink.ts'
import { Uint8ArraySink } from '../sink.ts'
import {
  bindImageSourceSignal,
  createImageSource,
  type ImageInput,
  MemorySource,
  readExactly,
} from '../source.ts'
import { jpegCodec } from './jpeg.ts'
import {
  inspectJpegExactTranscodeDisplaySemantics,
  type JpegExactTranscodeDisplaySemantics,
} from './jpeg-display-semantics.ts'
import { type JpegCoefficientImage, parseJpegCoefficientImage } from './jpeg-coefficients.ts'
import { jpegxlCodec } from './jpegxl.ts'
import { parseJpegReconstructionData } from './jpegxl-jpeg-data.ts'
import { encodeJpegCoefficientImageAsJpegXl } from './jpegxl-jpeg-encode.ts'
import { reconstructJpegFromCoefficientImage } from './jpegxl-jpeg-reconstruct.ts'
import { reconstructJpegFromJpegXl } from './jpegxl-jpeg-reconstruct-source.ts'
import { encodeJpegXlJpegReconstruction } from './jpegxl-jpeg-reconstruction.ts'
import type { JpegXlLimitOptions } from './jpegxl-limits.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'

export type JpegReconstructionPolicy = 'required' | 'prefer' | 'disabled'
export type JpegTranscodeFallback = 'reject' | 'pixel-lossless'

export interface TranscodeJpegToJpegXlOptions {
  readonly reconstruction?: JpegReconstructionPolicy
  readonly fallback?: JpegTranscodeFallback
  readonly effort?: 1
  readonly onlyIfSmaller?: boolean
  readonly signal?: AbortSignal
  readonly limits?: Readonly<ImageLimitOptions & JpegXlLimitOptions>
  readonly sink?: ImageSink
  readonly evidence?: EvidenceContext
}

export interface JpegTranscodeSourceProfile {
  readonly width: number
  readonly height: number
  readonly progressive: boolean
  readonly colorTransform: JpegCoefficientImage['colorTransform']
  readonly components: number
  readonly sampling: readonly string[]
  readonly scans: number
  readonly orientation: 1
  readonly colorProfile: 'none' | 'srgb'
}

export interface JpegTranscodeMetadataSummary {
  readonly appMarkers: number
  readonly comments: number
  readonly opaqueBytes: number
  readonly tailBytes: number
}

interface JpegTranscodeResultFields {
  readonly mode: 'exact-jpeg' | 'pixel-lossless'
  readonly exactReconstruction: boolean
  readonly inputBytes: number
  readonly outputBytes: number
  readonly savingsBytes: number
  readonly savingsPercentage: number
  readonly sourceProfile: JpegTranscodeSourceProfile
  readonly preservedMetadata: JpegTranscodeMetadataSummary
  readonly warnings: readonly string[]
  readonly outputStructure: Readonly<{
    readonly kind: 'container'
    readonly organization: 'jxlc'
    readonly reconstruction: 'available' | 'unavailable'
  }>
  readonly elapsedMilliseconds: number
  readonly managedPeakBytes: number
}

export interface JpegTranscodeMemoryResult extends JpegTranscodeResultFields {
  readonly data: Uint8Array
}

export interface JpegTranscodeSinkResult extends JpegTranscodeResultFields {
  readonly data: undefined
}

export type JpegTranscodeResult = JpegTranscodeMemoryResult | JpegTranscodeSinkResult

export interface JpegReconstructionEligibility {
  readonly eligible: boolean
  readonly reasonCodes: readonly JpegReconstructionIneligibilityCode[]
  readonly reasons: readonly string[]
  readonly sourceProfile?: JpegTranscodeSourceProfile
}

export type JpegReconstructionIneligibilityCode =
  | 'grayscale'
  | 'cmyk-or-ycck'
  | '12-bit'
  | 'lossless-process'
  | 'arithmetic-coding'
  | 'hierarchical-or-differential'
  | 'unsupported-sampling'
  | 'coefficient-range'
  | 'unsupported-marker-or-tail-layout'
  | 'unsupported-display-orientation'
  | 'unsupported-color-profile'
  | 'malformed-color-profile'
  | 'metadata-limit'
  | 'reconstruction-mismatch'
  | 'output-not-smaller'
  | 'unsupported-jpeg-process'
  | 'invalid-input'
  | 'resource-limit'

interface ManagedMemoryLease {
  release(): void
}

class ManagedMemoryLedger {
  #liveBytes = 0
  #peakBytes = 0

  get peakBytes(): number {
    return this.#peakBytes
  }

  allocate(bytes: number): ManagedMemoryLease {
    this.#liveBytes += bytes
    this.#peakBytes = Math.max(this.#peakBytes, this.#liveBytes)
    let released = false
    return Object.freeze({
      release: (): void => {
        if (released) return
        released = true
        this.#liveBytes -= bytes
      },
    })
  }
}

const sourceProfile = (
  image: JpegCoefficientImage,
  display: JpegExactTranscodeDisplaySemantics,
): JpegTranscodeSourceProfile =>
  Object.freeze({
    width: image.width,
    height: image.height,
    progressive: image.progressive,
    colorTransform: image.colorTransform,
    components: image.components.length,
    sampling: Object.freeze(
      image.components.map(
        ({ horizontalSampling, verticalSampling }) => `${horizontalSampling}x${verticalSampling}`,
      ),
    ),
    scans: image.scans.length,
    orientation: display.orientation,
    colorProfile: display.colorProfile,
  })

const exactBytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)

const readInput = async (
  input: ImageInput,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
): Promise<Uint8Array> => {
  throwIfAborted(options.signal)
  const source = await createImageSource(input, resolveLimits(options.limits), options)
  const bytes = await readExactly(source, 0, source.size, options)
  throwIfAborted(options.signal)
  return bytes
}

const retainedCoefficientBytes = (image: JpegCoefficientImage): number => {
  const buffers = new Set<ArrayBufferLike>()
  let bytes = 0
  for (const component of image.components) {
    for (const values of [component.coefficients, component.quantization]) {
      if (buffers.has(values.buffer)) continue
      buffers.add(values.buffer)
      bytes += values.byteLength
    }
  }
  return bytes
}

const parseCoefficients = async (
  input: Uint8Array,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
): Promise<JpegCoefficientImage> => {
  const limits = resolveLimits(options.limits)
  const image = await parseJpegCoefficientImage(
    bindImageSourceSignal(new MemorySource(input), options.signal),
    limits,
    limits.maxDecodedBytes,
  )
  if (!image) throw unsupportedOperation('JPEG process is not eligible for coefficient transcode')
  return image
}

const encodeExact = async (
  input: Uint8Array,
  image: JpegCoefficientImage,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
  retain: (category: string, bytes: number) => ManagedMemoryLease,
): Promise<
  Readonly<{
    data: Uint8Array
    metadata: JpegTranscodeMetadataSummary
  }>
> => {
  const limits = resolveJpegXlLimits(options.limits)
  throwIfAborted(options.signal)
  const reconstruction = parseJpegReconstructionData(input, image, limits)
  const metadataLease = retain(
    'jpeg-transcode-metadata-and-tail',
    reconstruction.blobs.decodedBytes,
  )
  throwIfAborted(options.signal)
  const canonical = reconstructJpegFromCoefficientImage(
    reconstruction.header,
    reconstruction.blobs,
    image,
    {},
    limits.maxReconstructedJpegBytes,
  )
  const canonicalLease = retain('jpeg-transcode-canonical-jpeg', canonical.byteLength)
  if (!exactBytesEqual(canonical, input)) {
    canonicalLease.release()
    throw unsupportedOperation('JPEG entropy stream requires unsupported exactness metadata')
  }
  canonicalLease.release()
  throwIfAborted(options.signal)
  const payload = encodeJpegXlJpegReconstruction(
    reconstruction.header,
    reconstruction.blobs,
    limits,
  )
  const payloadLease = retain('jpeg-transcode-reconstruction-payload', payload.byteLength)
  metadataLease.release()
  throwIfAborted(options.signal)
  const data = encodeJpegCoefficientImageAsJpegXl(image, payload, limits, {
    allocate: retain,
  })
  payloadLease.release()
  throwIfAborted(options.signal)
  const reconstructed = await reconstructJpegFromJpegXl(data, {
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const verificationLease = retain('jpeg-transcode-verification-jpeg', reconstructed.byteLength)
  if (!exactBytesEqual(reconstructed, input)) {
    verificationLease.release()
    throw invalidInput('JPEG XL exact reconstruction verification failed')
  }
  verificationLease.release()
  throwIfAborted(options.signal)
  return Object.freeze({
    data,
    metadata: Object.freeze({
      appMarkers: reconstruction.header.appMarkers.length,
      comments: reconstruction.header.commentByteLengths.length,
      opaqueBytes: reconstruction.blobs.decodedBytes,
      tailBytes: reconstruction.header.tailByteLength,
    }),
  })
}

const encodePixelLossless = async (
  input: Uint8Array,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
  display: JpegExactTranscodeDisplaySemantics,
): Promise<Readonly<{ data: Uint8Array; profile: JpegTranscodeSourceProfile }>> => {
  const limits = resolveLimits(options.limits)
  const source = new MemorySource(input)
  const decoder = await jpegCodec.createDecoder?.(source, limits, {
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!decoder) throw unsupportedOperation('JPEG pixel decoder is unavailable')
  if (
    decoder.pixelFormat !== 'gray8' &&
    decoder.pixelFormat !== 'rgb8' &&
    decoder.pixelFormat !== 'rgba8'
  ) {
    throw unsupportedOperation(`JPEG pixel fallback format ${decoder.pixelFormat} is unsupported`)
  }
  const sink = new Uint8ArraySink()
  const colorSemantics = Object.freeze({
    family: decoder.pixelFormat === 'gray8' ? ('gray' as const) : ('rgb' as const),
    primaries: 'srgb' as const,
    transfer: Object.freeze({ kind: 'srgb' as const }),
    matrix: 'identity' as const,
    range: 'full' as const,
    alpha: decoder.pixelFormat === 'rgba8' ? ('straight' as const) : ('none' as const),
    provenance:
      display.colorProfile === 'srgb'
        ? ('decoder-converted' as const)
        : ('assumed-default' as const),
  })
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: decoder.width,
    height: decoder.height,
    pixelFormat: decoder.pixelFormat,
    colorSemantics,
    options: Object.freeze({ mode: 'lossless', effort: 1, container: true }),
    ...(options.signal ? { signal: options.signal } : {}),
    limits,
  })
  if (!encoder) throw unsupportedOperation('JPEG XL pixel encoder is unavailable')
  await pipeDecoderToJpegXlEncoder(decoder, encoder, options.signal)
  const components = decoder.pixelFormat === 'gray8' ? 1 : decoder.pixelFormat === 'rgb8' ? 3 : 4
  return Object.freeze({
    data: sink.toUint8Array(),
    profile: Object.freeze({
      width: decoder.width,
      height: decoder.height,
      progressive: decoder.capabilities.progressive,
      colorTransform: components === 1 ? 'gray' : 'components',
      components,
      sampling: Object.freeze(Array.from({ length: components }, () => 'decoded-pixels')),
      scans: 0,
      orientation: display.orientation,
      colorProfile: display.colorProfile,
    }),
  })
}

export const pipeDecoderToJpegXlEncoder = async (
  decoder: ImageDecoder,
  encoder: ImageEncoder,
  signal?: AbortSignal,
): Promise<void> => {
  const iterator = decoder.decode(signal ? { signal } : {})[Symbol.asyncIterator]()
  let complete = false
  try {
    while (true) {
      const result = await iterator.next()
      if (result.done) {
        complete = true
        break
      }
      const block = result.value
      try {
        await encoder.write(block)
      } finally {
        block.release?.()
      }
    }
    await encoder.finish()
  } catch (error) {
    await encoder.abort?.(error)
    throw error
  } finally {
    if (!complete) await iterator.return?.()
  }
}

const evidenceFailureCode = (error: unknown): string =>
  error instanceof ImageError ? error.code : 'UNKNOWN'

const eligibilityReasonCode = (error: ImageError): JpegReconstructionIneligibilityCode => {
  const message = error.message.toLowerCase()
  if (message.includes('orientation')) return 'unsupported-display-orientation'
  if (message.includes('icc color profile is malformed')) return 'malformed-color-profile'
  if (message.includes('color profile')) return 'unsupported-color-profile'
  if (message.includes('8-bit jpeg')) return '12-bit'
  if (message.includes('arithmetic')) return 'arithmetic-coding'
  if (message.includes('lossless jpeg') || message.includes('lossless process')) {
    return 'lossless-process'
  }
  if (message.includes('hierarchical') || message.includes('differential')) {
    return 'hierarchical-or-differential'
  }
  if (message.includes('sampling')) return 'unsupported-sampling'
  if (message.includes('coefficient exceeds')) return 'coefficient-range'
  if (message.includes('metadata') && error.code === 'LIMIT_EXCEEDED') return 'metadata-limit'
  if (message.includes('marker') || message.includes('tail') || message.includes('fill bytes')) {
    return 'unsupported-marker-or-tail-layout'
  }
  if (message.includes('not smaller')) return 'output-not-smaller'
  if (message.includes('exactness') || message.includes('reconstruction')) {
    return 'reconstruction-mismatch'
  }
  if (error.code === 'LIMIT_EXCEEDED') return 'resource-limit'
  if (error.code === 'INVALID_INPUT' || error.code === 'TRUNCATED_INPUT') return 'invalid-input'
  return 'unsupported-jpeg-process'
}

const validateOptions = (
  options: Readonly<TranscodeJpegToJpegXlOptions>,
): Readonly<
  Required<
    Pick<TranscodeJpegToJpegXlOptions, 'reconstruction' | 'fallback' | 'effort' | 'onlyIfSmaller'>
  >
> => {
  const reconstruction = options.reconstruction ?? 'required'
  const fallback = options.fallback ?? 'reject'
  const effort = options.effort ?? 1
  const onlyIfSmaller = options.onlyIfSmaller ?? false
  if (!['required', 'prefer', 'disabled'].includes(reconstruction)) {
    throw invalidInput('JPEG transcode reconstruction policy is invalid')
  }
  if (fallback !== 'reject' && fallback !== 'pixel-lossless') {
    throw invalidInput('JPEG transcode fallback policy is invalid')
  }
  if (effort !== 1) throw invalidInput('JPEG transcode effort must be 1')
  if (typeof onlyIfSmaller !== 'boolean') throw invalidInput('onlyIfSmaller must be a boolean')
  if (reconstruction === 'disabled' && fallback === 'reject') {
    throw invalidInput('Disabled reconstruction requires fallback: pixel-lossless')
  }
  return Object.freeze({ reconstruction, fallback, effort, onlyIfSmaller })
}

export const inspectJpegReconstructionEligibility = async (
  input: ImageInput,
  options: Readonly<TranscodeJpegToJpegXlOptions> = {},
): Promise<JpegReconstructionEligibility> => {
  try {
    const bytes = await readInput(input, options)
    const display = inspectJpegExactTranscodeDisplaySemantics(
      bytes,
      resolveJpegXlLimits(options.limits).maxMetadataBytes,
    )
    const image = await parseCoefficients(bytes, options)
    if (image.components.length === 1) {
      return Object.freeze({
        eligible: false,
        reasonCodes: Object.freeze(['grayscale'] as const),
        reasons: Object.freeze(['Grayscale exact JPEG transcode is not implemented']),
        sourceProfile: sourceProfile(image, display),
      })
    }
    if (image.components.length !== 3) {
      return Object.freeze({
        eligible: false,
        reasonCodes: Object.freeze(['cmyk-or-ycck'] as const),
        reasons: Object.freeze(['CMYK and YCCK exact JPEG transcode are not implemented']),
        sourceProfile: sourceProfile(image, display),
      })
    }
    const limits = resolveJpegXlLimits(options.limits)
    const reconstruction = parseJpegReconstructionData(bytes, image, limits)
    const rebuilt = reconstructJpegFromCoefficientImage(
      reconstruction.header,
      reconstruction.blobs,
      image,
      {},
      limits.maxReconstructedJpegBytes,
    )
    if (!exactBytesEqual(rebuilt, bytes)) {
      return Object.freeze({
        eligible: false,
        reasonCodes: Object.freeze(['reconstruction-mismatch'] as const),
        reasons: Object.freeze(['JPEG entropy stream requires unsupported exactness metadata']),
        sourceProfile: sourceProfile(image, display),
      })
    }
    return Object.freeze({
      eligible: true,
      reasonCodes: Object.freeze([]),
      reasons: Object.freeze([]),
      sourceProfile: sourceProfile(image, display),
    })
  } catch (error) {
    if (!(error instanceof ImageError)) throw error
    return Object.freeze({
      eligible: false,
      reasonCodes: Object.freeze([eligibilityReasonCode(error)]),
      reasons: Object.freeze([error.message]),
    })
  }
}

export function transcodeJpegToJpegXl(
  input: ImageInput,
  options?: Readonly<Omit<TranscodeJpegToJpegXlOptions, 'sink'> & { readonly sink?: never }>,
): Promise<JpegTranscodeMemoryResult>
export function transcodeJpegToJpegXl(
  input: ImageInput,
  options: Readonly<TranscodeJpegToJpegXlOptions & { readonly sink: ImageSink }>,
): Promise<JpegTranscodeSinkResult>
export function transcodeJpegToJpegXl(
  input: ImageInput,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
): Promise<JpegTranscodeResult>
export async function transcodeJpegToJpegXl(
  input: ImageInput,
  options?: Readonly<TranscodeJpegToJpegXlOptions>,
): Promise<unknown> {
  options ??= {}
  const start = performance.now()
  const policy = validateOptions(options)
  const evidence = options.evidence?.child('jpegxl-jpeg-transcode')
  const memory = new ManagedMemoryLedger()
  const leases: ManagedMemoryLease[] = []
  const retain = (category: string, bytes: number): ManagedMemoryLease => {
    const memoryLease = memory.allocate(bytes)
    const evidenceLease = evidence?.allocate(category, bytes)
    let released = false
    const lease = Object.freeze({
      release: (): void => {
        if (released) return
        released = true
        evidenceLease?.release()
        memoryLease.release()
      },
    })
    leases.push(lease)
    return lease
  }
  evidence?.operation({ operationId: 'jpeg-to-jxl', phase: 'start' })
  try {
    const bytes = await readInput(input, options)
    const display = inspectJpegExactTranscodeDisplaySemantics(
      bytes,
      resolveJpegXlLimits(options.limits).maxMetadataBytes,
    )
    retain('jpeg-transcode-input', bytes.byteLength)
    let exactReconstruction = false
    let mode: JpegTranscodeResult['mode'] = 'exact-jpeg'
    let data: Uint8Array
    let profile: JpegTranscodeSourceProfile
    let metadata: JpegTranscodeMetadataSummary
    const warnings: string[] = []

    if (policy.reconstruction === 'disabled') {
      const fallbackEvidence = evidence?.child('pixel-lossless-fallback')
      fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'start' })
      const fallback = await encodePixelLossless(bytes, options, display)
      fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'complete' })
      data = fallback.data
      retain('jpeg-transcode-output', data.byteLength)
      profile = fallback.profile
      mode = 'pixel-lossless'
      metadata = Object.freeze({ appMarkers: 0, comments: 0, opaqueBytes: 0, tailBytes: 0 })
      warnings.push('Exact JPEG reconstruction was disabled; output preserves decoded pixels only.')
    } else {
      try {
        const exactEvidence = evidence?.child('exact-coefficient-transcode')
        exactEvidence?.operation({ operationId: 'exact-coefficient-transcode', phase: 'start' })
        throwIfAborted(options.signal)
        const image = await parseCoefficients(bytes, options)
        const coefficientLease = retain(
          'jpeg-transcode-coefficients-and-tables',
          retainedCoefficientBytes(image),
        )
        let exact: Awaited<ReturnType<typeof encodeExact>>
        try {
          throwIfAborted(options.signal)
          profile = sourceProfile(image, display)
          exact = await encodeExact(bytes, image, options, retain)
        } finally {
          coefficientLease.release()
        }
        exactEvidence?.operation({ operationId: 'exact-coefficient-transcode', phase: 'complete' })
        data = exact.data
        metadata = exact.metadata
        exactReconstruction = true
      } catch (error) {
        evidence?.operation({
          operationId: 'exact-coefficient-transcode',
          phase: 'failed',
          failureCode: evidenceFailureCode(error),
        })
        if (
          policy.reconstruction === 'required' ||
          policy.fallback !== 'pixel-lossless' ||
          !(error instanceof ImageError) ||
          error.code !== 'UNSUPPORTED_OPERATION'
        ) {
          throw error
        }
        evidence?.operation({
          operationId: 'exact-coefficient-transcode',
          phase: 'fallback',
          failureCode: error.code,
        })
        const fallbackEvidence = evidence?.child('pixel-lossless-fallback')
        fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'start' })
        const fallback = await encodePixelLossless(bytes, options, display)
        fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'complete' })
        data = fallback.data
        retain('jpeg-transcode-output', data.byteLength)
        profile = fallback.profile
        mode = 'pixel-lossless'
        metadata = Object.freeze({ appMarkers: 0, comments: 0, opaqueBytes: 0, tailBytes: 0 })
        warnings.push(`Exact JPEG reconstruction was unavailable: ${error.message}`)
      }
    }

    if (policy.onlyIfSmaller && data.byteLength >= bytes.byteLength) {
      throw unsupportedOperation(
        `JPEG XL output has ${data.byteLength} bytes and is not smaller than the ${bytes.byteLength}-byte JPEG`,
      )
    }
    if (options.sink) {
      throwIfAborted(options.signal)
      await options.sink.write(data)
      throwIfAborted(options.signal)
      await options.sink.close()
      throwIfAborted(options.signal)
    }
    const savingsBytes = bytes.byteLength - data.byteLength
    evidence?.operation({
      operationId: 'jpeg-to-jxl',
      phase: 'complete',
      detail: `${mode} ${bytes.byteLength}->${data.byteLength} bytes`,
    })
    return Object.freeze({
      data: options.sink ? undefined : data,
      mode,
      exactReconstruction,
      inputBytes: bytes.byteLength,
      outputBytes: data.byteLength,
      savingsBytes,
      savingsPercentage: bytes.byteLength === 0 ? 0 : (savingsBytes / bytes.byteLength) * 100,
      sourceProfile: profile,
      preservedMetadata: metadata,
      warnings: Object.freeze(warnings),
      outputStructure: Object.freeze({
        kind: 'container',
        organization: 'jxlc',
        reconstruction: exactReconstruction ? 'available' : 'unavailable',
      }),
      elapsedMilliseconds: performance.now() - start,
      managedPeakBytes: memory.peakBytes,
    })
  } catch (error) {
    const cancelled = options.signal?.aborted === true
    evidence?.operation({
      operationId: 'jpeg-to-jxl',
      phase: cancelled ? 'cancelled' : 'failed',
      ...(cancelled ? {} : { failureCode: evidenceFailureCode(error) }),
    })
    if (cancelled) evidence?.cancellation('jpeg-to-jxl')
    if (options.sink) {
      try {
        await options.sink.abort(error)
      } catch {
        // Preserve the operation or sink failure that triggered the abort.
      }
    }
    throw error
  } finally {
    for (let index = leases.length - 1; index >= 0; index -= 1) leases[index]?.release()
  }
}
import { throwIfAborted } from '../abort.ts'
