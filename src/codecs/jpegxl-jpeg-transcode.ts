import { ImageError, invalidInput, unsupportedOperation } from '../errors.ts'
import type { EvidenceContext, EvidenceManagedLease } from '../evidence.ts'
import type { ImageLimitOptions } from '../limits.ts'
import { resolveLimits } from '../limits.ts'
import type { ImageSink } from '../sink.ts'
import { Uint8ArraySink } from '../sink.ts'
import { createImageSource, type ImageInput, MemorySource, readExactly } from '../source.ts'
import { jpegCodec } from './jpeg.ts'
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
}

export interface JpegTranscodeMetadataSummary {
  readonly appMarkers: number
  readonly comments: number
  readonly opaqueBytes: number
  readonly tailBytes: number
}

export interface JpegTranscodeResult {
  readonly data: Uint8Array
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

export interface JpegReconstructionEligibility {
  readonly eligible: boolean
  readonly reasons: readonly string[]
  readonly sourceProfile?: JpegTranscodeSourceProfile
}

const sourceProfile = (image: JpegCoefficientImage): JpegTranscodeSourceProfile =>
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
  })

const exactBytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((value, index) => right[index] === value)

const readInput = async (
  input: ImageInput,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
): Promise<Uint8Array> => {
  const source = await createImageSource(input, resolveLimits(options.limits), options)
  return (await readExactly(source, 0, source.size, options)).slice()
}

const parseCoefficients = async (
  input: Uint8Array,
  options: Readonly<TranscodeJpegToJpegXlOptions>,
): Promise<JpegCoefficientImage> => {
  const limits = resolveLimits(options.limits)
  const image = await parseJpegCoefficientImage(
    new MemorySource(input),
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
): Promise<Readonly<{ data: Uint8Array; metadata: JpegTranscodeMetadataSummary }>> => {
  const limits = resolveJpegXlLimits(options.limits)
  const reconstruction = parseJpegReconstructionData(input, image, limits)
  const canonical = reconstructJpegFromCoefficientImage(
    reconstruction.header,
    reconstruction.blobs,
    image,
    {},
    limits.maxReconstructedJpegBytes,
  )
  if (!exactBytesEqual(canonical, input)) {
    throw unsupportedOperation('JPEG entropy stream requires unsupported exactness metadata')
  }
  const payload = encodeJpegXlJpegReconstruction(
    reconstruction.header,
    reconstruction.blobs,
    limits,
  )
  const data = encodeJpegCoefficientImageAsJpegXl(image, payload, limits)
  const reconstructed = await reconstructJpegFromJpegXl(data, {
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!exactBytesEqual(reconstructed, input)) {
    throw invalidInput('JPEG XL exact reconstruction verification failed')
  }
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
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width: decoder.width,
    height: decoder.height,
    pixelFormat: decoder.pixelFormat,
    ...(decoder.colorSemantics ? { colorSemantics: decoder.colorSemantics } : {}),
    options: Object.freeze({ mode: 'lossless', effort: 1, container: true }),
    ...(options.signal ? { signal: options.signal } : {}),
    limits,
  })
  if (!encoder) throw unsupportedOperation('JPEG XL pixel encoder is unavailable')
  try {
    for await (const block of decoder.decode({
      ...(options.signal ? { signal: options.signal } : {}),
    })) {
      await encoder.write(block)
    }
    await encoder.finish()
  } catch (error) {
    await encoder.abort?.(error)
    throw error
  }
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
    }),
  })
}

const evidenceFailureCode = (error: unknown): string =>
  error instanceof ImageError ? error.code : 'UNKNOWN'

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
    const image = await parseCoefficients(bytes, options)
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
        reasons: Object.freeze(['JPEG entropy stream requires unsupported exactness metadata']),
        sourceProfile: sourceProfile(image),
      })
    }
    return Object.freeze({
      eligible: true,
      reasons: Object.freeze([]),
      sourceProfile: sourceProfile(image),
    })
  } catch (error) {
    if (!(error instanceof ImageError)) throw error
    return Object.freeze({ eligible: false, reasons: Object.freeze([error.message]) })
  }
}

export const transcodeJpegToJpegXl = async (
  input: ImageInput,
  options: Readonly<TranscodeJpegToJpegXlOptions> = {},
): Promise<JpegTranscodeResult> => {
  const start = performance.now()
  const policy = validateOptions(options)
  const evidence = options.evidence?.child('jpegxl-jpeg-transcode')
  const leases: EvidenceManagedLease[] = []
  const retain = (lease: EvidenceManagedLease | undefined): void => {
    if (lease) leases.push(lease)
  }
  evidence?.operation({ operationId: 'jpeg-to-jxl', phase: 'start' })
  try {
    const bytes = await readInput(input, options)
    retain(evidence?.allocate('jpeg-transcode-input', bytes.byteLength))
    let exactReconstruction = false
    let mode: JpegTranscodeResult['mode'] = 'exact-jpeg'
    let data: Uint8Array
    let profile: JpegTranscodeSourceProfile
    let coefficientBytes = 0
    let metadata: JpegTranscodeMetadataSummary
    const warnings: string[] = []

    if (policy.reconstruction === 'disabled') {
      const fallbackEvidence = evidence?.child('pixel-lossless-fallback')
      fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'start' })
      const fallback = await encodePixelLossless(bytes, options)
      fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'complete' })
      data = fallback.data
      profile = fallback.profile
      mode = 'pixel-lossless'
      metadata = Object.freeze({ appMarkers: 0, comments: 0, opaqueBytes: 0, tailBytes: 0 })
      warnings.push('Exact JPEG reconstruction was disabled; output preserves decoded pixels only.')
    } else {
      try {
        const exactEvidence = evidence?.child('exact-coefficient-transcode')
        exactEvidence?.operation({ operationId: 'exact-coefficient-transcode', phase: 'start' })
        const image = await parseCoefficients(bytes, options)
        coefficientBytes = image.coefficientBytes
        retain(evidence?.allocate('jpeg-transcode-coefficients', coefficientBytes))
        profile = sourceProfile(image)
        const exact = await encodeExact(bytes, image, options)
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
        const fallback = await encodePixelLossless(bytes, options)
        fallbackEvidence?.operation({ operationId: 'pixel-lossless-fallback', phase: 'complete' })
        data = fallback.data
        profile = fallback.profile
        mode = 'pixel-lossless'
        metadata = Object.freeze({ appMarkers: 0, comments: 0, opaqueBytes: 0, tailBytes: 0 })
        warnings.push(`Exact JPEG reconstruction was unavailable: ${error.message}`)
      }
    }

    retain(evidence?.allocate('jpeg-transcode-output', data.byteLength))
    if (policy.onlyIfSmaller && data.byteLength >= bytes.byteLength) {
      throw unsupportedOperation(
        `JPEG XL output has ${data.byteLength} bytes and is not smaller than the ${bytes.byteLength}-byte JPEG`,
      )
    }
    if (options.sink) {
      await options.sink.write(data)
      await options.sink.close()
    }
    const savingsBytes = bytes.byteLength - data.byteLength
    evidence?.operation({
      operationId: 'jpeg-to-jxl',
      phase: 'complete',
      detail: `${mode} ${bytes.byteLength}->${data.byteLength} bytes`,
    })
    return Object.freeze({
      data,
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
      managedPeakBytes: coefficientBytes + bytes.byteLength + data.byteLength,
    })
  } catch (error) {
    evidence?.operation({
      operationId: 'jpeg-to-jxl',
      phase: 'failed',
      failureCode: evidenceFailureCode(error),
    })
    throw error
  } finally {
    for (let index = leases.length - 1; index >= 0; index -= 1) leases[index]?.release()
  }
}
