import type { ExecutionEvidenceReport } from '../../../src/evidence.ts'
import type {
  JpegReconstructionEligibility,
  JpegTranscodeResult,
  JpegXlInspection,
} from '../../../src/jpegxl.ts'

export const jpegXlWorkbenchMaximumInputBytes = 64 * 1024 * 1024
export const jpegXlWorkbenchMaximumOutputBytes = 128 * 1024 * 1024
export const jpegXlWorkbenchMaximumPreviewPixels = 4_194_304
export const jpegXlWorkbenchMaximumNameLength = 512
export const jpegXlWorkbenchMaximumNativePixelBytes = 96 * 1024 * 1024
export const jpegXlWorkbenchMaximumSimultaneousBytes = 192 * 1024 * 1024

export type JpegXlWorkbenchNativePixelFormat =
  | 'gray8'
  | 'gray16'
  | 'rgb8'
  | 'rgb16'
  | 'rgba8'
  | 'rgba16'

export interface JpegXlWorkbenchNativeMemoryPlan {
  readonly nativePixelBytes: number
  readonly previewBytes: number
  readonly encoderRetainedBytes: number
  readonly estimatedOutputBytes: number
  readonly estimatedSimultaneousBytes: number
}

export interface JpegXlWorkbenchPreviewPlan {
  readonly logicalWidth: number
  readonly logicalHeight: number
  readonly width: number
  readonly height: number
  readonly scaled: boolean
}

export const planJpegXlWorkbenchPreview = (
  logicalWidth: number,
  logicalHeight: number,
  maximumPixels = jpegXlWorkbenchMaximumPreviewPixels,
): JpegXlWorkbenchPreviewPlan => {
  if (
    !Number.isSafeInteger(logicalWidth) ||
    !Number.isSafeInteger(logicalHeight) ||
    logicalWidth < 1 ||
    logicalHeight < 1 ||
    !Number.isSafeInteger(maximumPixels) ||
    maximumPixels < 1
  ) {
    throw new Error('JPEG XL workbench preview dimensions are invalid')
  }
  if (logicalWidth * logicalHeight <= maximumPixels) {
    return Object.freeze({
      logicalWidth,
      logicalHeight,
      width: logicalWidth,
      height: logicalHeight,
      scaled: false,
    })
  }
  const scale = Math.sqrt(maximumPixels / (logicalWidth * logicalHeight))
  return Object.freeze({
    logicalWidth,
    logicalHeight,
    width: Math.max(1, Math.floor(logicalWidth * scale)),
    height: Math.max(1, Math.floor(logicalHeight * scale)),
    scaled: true,
  })
}

export const planJpegXlWorkbenchNativeMemory = (
  width: number,
  height: number,
  format: JpegXlWorkbenchNativePixelFormat,
): JpegXlWorkbenchNativeMemoryPlan => {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error('JPEG XL workbench native dimensions are invalid')
  }
  const channels = format.startsWith('gray') ? 1n : format.startsWith('rgba') ? 4n : 3n
  const sampleBytes = format.endsWith('16') ? 2n : 1n
  const nativePixelBytes = BigInt(width) * BigInt(height) * channels * sampleBytes
  const preview = planJpegXlWorkbenchPreview(width, height)
  const previewBytes = BigInt(preview.width) * BigInt(preview.height) * 4n
  const estimatedOutputBytes = nativePixelBytes + nativePixelBytes / 2n + BigInt(1024 * 1024)
  const boundedOutputBytes =
    estimatedOutputBytes > BigInt(jpegXlWorkbenchMaximumOutputBytes)
      ? BigInt(jpegXlWorkbenchMaximumOutputBytes)
      : estimatedOutputBytes
  const estimatedSimultaneousBytes = nativePixelBytes * 2n + previewBytes + boundedOutputBytes
  if (
    nativePixelBytes > BigInt(jpegXlWorkbenchMaximumNativePixelBytes) ||
    estimatedSimultaneousBytes > BigInt(jpegXlWorkbenchMaximumSimultaneousBytes)
  ) {
    throw new Error(
      `Image exceeds the JPEG XL workbench memory limit before pixel allocation (${nativePixelBytes} native bytes; ${estimatedSimultaneousBytes} estimated simultaneous bytes)`,
    )
  }
  return Object.freeze({
    nativePixelBytes: Number(nativePixelBytes),
    previewBytes: Number(previewBytes),
    encoderRetainedBytes: Number(nativePixelBytes),
    estimatedOutputBytes: Number(boundedOutputBytes),
    estimatedSimultaneousBytes: Number(estimatedSimultaneousBytes),
  })
}

interface JpegXlWorkbenchIdentity {
  readonly requestId: number
  readonly generation: number
}

export type JpegXlWorkbenchRequest =
  | (JpegXlWorkbenchIdentity & {
      readonly type: 'open'
      readonly name: string
      readonly bytes: ArrayBuffer
    })
  | (JpegXlWorkbenchIdentity & { readonly type: 'transcode'; readonly onlyIfSmaller: boolean })
  | (JpegXlWorkbenchIdentity & {
      readonly type: 'transform'
      readonly width: number
      readonly height: number
      readonly fit: 'contain' | 'cover' | 'fill'
      readonly format: 'png' | 'jpeg'
    })
  | (JpegXlWorkbenchIdentity & { readonly type: 'encode' })
  | (JpegXlWorkbenchIdentity & { readonly type: 'reconstruct' })
  | (JpegXlWorkbenchIdentity & { readonly type: 'cancel' })

export interface JpegXlWorkbenchPreview extends JpegXlWorkbenchPreviewPlan {
  readonly rgba: ArrayBuffer
}

export interface JpegXlWorkbenchPixelSource {
  readonly container: 'PNG' | 'TIFF'
  readonly pixelFormat: JpegXlWorkbenchNativePixelFormat
  readonly color: string
  readonly alpha: 'none' | 'straight'
}

export interface JpegXlWorkbenchEncodeSummary {
  readonly status: 'Experimental'
  readonly sourcePixelFormat: JpegXlWorkbenchPixelSource['pixelFormat']
  readonly decodedPixelFormat: JpegXlWorkbenchPixelSource['pixelFormat']
  readonly exactDecodedSamples: true
  readonly inputBytes: number
  readonly outputBytes: number
  readonly sizeDifferenceBytes: number
  readonly outputToInputRatio: number
}

export type JpegXlWorkbenchTranscodeSummary = Pick<
  JpegTranscodeResult,
  | 'mode'
  | 'exactReconstruction'
  | 'inputBytes'
  | 'outputBytes'
  | 'savingsBytes'
  | 'savingsPercentage'
  | 'sourceProfile'
  | 'preservedMetadata'
  | 'warnings'
  | 'outputStructure'
  | 'managedPeakBytes'
  | 'elapsedMilliseconds'
> & {
  readonly libjxlReferenceBytes: number | null
}

export type JpegXlWorkbenchResponse =
  | (JpegXlWorkbenchIdentity & {
      readonly type: 'opened'
      readonly name: string
      readonly sourceKind: 'jpeg' | 'jpegxl' | 'png' | 'tiff'
      readonly inputBytes: number
      readonly inspection?: JpegXlInspection
      readonly eligibility?: JpegReconstructionEligibility
      readonly pixelSource?: JpegXlWorkbenchPixelSource
      readonly preview: JpegXlWorkbenchPreview
    })
  | (JpegXlWorkbenchIdentity & {
      readonly type: 'output'
      readonly action: 'transcode' | 'encode' | 'reconstruct' | 'transform'
      readonly name: string
      readonly bytes: ArrayBuffer
      readonly preview: JpegXlWorkbenchPreview
      readonly inspection?: JpegXlInspection
      readonly transcode?: JpegXlWorkbenchTranscodeSummary
      readonly encode?: JpegXlWorkbenchEncodeSummary
      readonly evidence?: ExecutionEvidenceReport
    })
  | (JpegXlWorkbenchIdentity & {
      readonly type: 'error'
      readonly message: string
      readonly cancelled: boolean
    })

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

const identity = (value: Readonly<Record<string, unknown>>): boolean =>
  Number.isSafeInteger(value.requestId) &&
  Number.isSafeInteger(value.generation) &&
  Number(value.requestId) >= 0 &&
  Number(value.generation) >= 0

const positiveInteger = (value: unknown): boolean =>
  Number.isSafeInteger(value) && Number(value) > 0
const nonnegativeInteger = (value: unknown): boolean =>
  Number.isSafeInteger(value) && Number(value) >= 0

const validName = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= jpegXlWorkbenchMaximumNameLength

const preview = (value: unknown): value is JpegXlWorkbenchPreview => {
  if (
    !record(value) ||
    !exactKeys(value, ['logicalWidth', 'logicalHeight', 'width', 'height', 'scaled', 'rgba']) ||
    !positiveInteger(value.logicalWidth) ||
    !positiveInteger(value.logicalHeight) ||
    !positiveInteger(value.width) ||
    !positiveInteger(value.height) ||
    typeof value.scaled !== 'boolean' ||
    !(value.rgba instanceof ArrayBuffer)
  ) {
    return false
  }
  const pixels = Number(value.width) * Number(value.height)
  return (
    pixels <= jpegXlWorkbenchMaximumPreviewPixels &&
    value.rgba.byteLength === pixels * 4 &&
    Number(value.width) <= Number(value.logicalWidth) &&
    Number(value.height) <= Number(value.logicalHeight) &&
    value.scaled ===
      (Number(value.width) !== Number(value.logicalWidth) ||
        Number(value.height) !== Number(value.logicalHeight))
  )
}

const stringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= 256 && value.every((entry) => typeof entry === 'string')

const boxSummary = (value: unknown): boolean =>
  record(value) &&
  exactKeys(value, ['type', 'offset', 'length', 'payloadBytes']) &&
  typeof value.type === 'string' &&
  value.type.length === 4 &&
  nonnegativeInteger(value.offset) &&
  nonnegativeInteger(value.length) &&
  nonnegativeInteger(value.payloadBytes)

const segment = (value: unknown): boolean =>
  record(value) &&
  exactKeys(value, ['offset', 'length', 'index']) &&
  nonnegativeInteger(value.offset) &&
  positiveInteger(value.length) &&
  nonnegativeInteger(value.index)

const inspection = (value: unknown): value is JpegXlInspection => {
  if (
    !record(value) ||
    !exactKeys(value, [
      'kind',
      'organization',
      'containerVersion',
      'codestreamBytes',
      'codestreamSegments',
      'boxes',
      'metadataBoxes',
      'width',
      'height',
      'displayWidth',
      'displayHeight',
      'orientation',
      'bitDepth',
      'exponentBits',
      'colorChannels',
      'extraChannels',
      'alpha',
      'alphaChannels',
      'toneMapping',
      'intrinsicWidth',
      'intrinsicHeight',
      'encodedColor',
      'renderingIntent',
      'icc',
      'encoding',
      'imageKind',
      'preview',
      'frameCount',
      'level',
      'progressivePasses',
      'jpegReconstruction',
      'exactReconstructionEligibility',
      'expectedPixelFormat',
      'resourceEstimates',
      'unsupportedFeatures',
    ]) ||
    !positiveInteger(value.width) ||
    !positiveInteger(value.height) ||
    !positiveInteger(value.displayWidth) ||
    !positiveInteger(value.displayHeight) ||
    !nonnegativeInteger(value.codestreamBytes) ||
    !Array.isArray(value.codestreamSegments) ||
    !value.codestreamSegments.every(segment) ||
    !Array.isArray(value.boxes) ||
    !value.boxes.every(boxSummary) ||
    !Array.isArray(value.metadataBoxes) ||
    !value.metadataBoxes.every(boxSummary) ||
    !stringArray(value.unsupportedFeatures)
  ) {
    return false
  }
  return (
    (value.kind === 'raw-codestream' || value.kind === 'container') &&
    (value.organization === 'raw' ||
      value.organization === 'jxlc' ||
      value.organization === 'jxlp') &&
    (value.containerVersion === undefined ||
      value.containerVersion === 0 ||
      value.containerVersion === 1) &&
    (value.encoding === 'modular' || value.encoding === 'vardct') &&
    (value.expectedPixelFormat === undefined ||
      value.expectedPixelFormat === 'gray8' ||
      value.expectedPixelFormat === 'gray16' ||
      value.expectedPixelFormat === 'rgb8' ||
      value.expectedPixelFormat === 'rgb16' ||
      value.expectedPixelFormat === 'rgba8' ||
      value.expectedPixelFormat === 'rgba16' ||
      value.expectedPixelFormat === 'rgbf32' ||
      value.expectedPixelFormat === 'rgbaf32') &&
    (value.alpha === 'none' || value.alpha === 'straight' || value.alpha === 'premultiplied') &&
    nonnegativeInteger(value.alphaChannels) &&
    Number(value.alphaChannels) <= 16 &&
    positiveInteger(value.orientation) &&
    Number(value.orientation) <= 8 &&
    nonnegativeInteger(value.exponentBits) &&
    Number(value.exponentBits) <= 8 &&
    (value.intrinsicWidth === undefined || positiveInteger(value.intrinsicWidth)) &&
    (value.intrinsicHeight === undefined || positiveInteger(value.intrinsicHeight)) &&
    record(value.toneMapping) &&
    exactKeys(value.toneMapping, [
      'intensityTarget',
      'minNits',
      'relativeToMaxDisplay',
      'linearBelow',
    ]) &&
    typeof value.toneMapping.intensityTarget === 'number' &&
    Number.isFinite(value.toneMapping.intensityTarget) &&
    value.toneMapping.intensityTarget > 0 &&
    typeof value.toneMapping.minNits === 'number' &&
    Number.isFinite(value.toneMapping.minNits) &&
    value.toneMapping.minNits >= 0 &&
    value.toneMapping.minNits <= value.toneMapping.intensityTarget &&
    typeof value.toneMapping.relativeToMaxDisplay === 'boolean' &&
    typeof value.toneMapping.linearBelow === 'number' &&
    Number.isFinite(value.toneMapping.linearBelow) &&
    value.toneMapping.linearBelow >= 0 &&
    (!value.toneMapping.relativeToMaxDisplay || value.toneMapping.linearBelow <= 1) &&
    typeof value.encodedColor === 'string' &&
    (value.renderingIntent === 'perceptual' ||
      value.renderingIntent === 'relative' ||
      value.renderingIntent === 'saturation' ||
      value.renderingIntent === 'absolute') &&
    record(value.icc) &&
    exactKeys(value.icc, ['present', 'decodedBytes']) &&
    typeof value.icc.present === 'boolean' &&
    (value.icc.decodedBytes === undefined ||
      (positiveInteger(value.icc.decodedBytes) && Number(value.icc.decodedBytes) <= 16_777_216)) &&
    record(value.resourceEstimates) &&
    exactKeys(value.resourceEstimates, ['codestreamBytes', 'metadataBytes', 'nativeSampleBytes']) &&
    nonnegativeInteger(value.resourceEstimates.codestreamBytes) &&
    nonnegativeInteger(value.resourceEstimates.metadataBytes) &&
    nonnegativeInteger(value.resourceEstimates.nativeSampleBytes)
  )
}

const sourceProfile = (value: unknown): boolean =>
  record(value) &&
  exactKeys(value, [
    'width',
    'height',
    'progressive',
    'colorTransform',
    'components',
    'sampling',
    'scans',
    'orientation',
    'colorProfile',
  ]) &&
  positiveInteger(value.width) &&
  positiveInteger(value.height) &&
  typeof value.progressive === 'boolean' &&
  typeof value.colorTransform === 'string' &&
  positiveInteger(value.components) &&
  Array.isArray(value.sampling) &&
  value.sampling.every((entry) => typeof entry === 'string') &&
  nonnegativeInteger(value.scans) &&
  value.orientation === 1 &&
  (value.colorProfile === 'none' || value.colorProfile === 'srgb')

const eligibility = (value: unknown): value is JpegReconstructionEligibility => {
  if (!record(value)) return false
  const keys =
    value.sourceProfile === undefined
      ? ['eligible', 'reasonCodes', 'reasons']
      : ['eligible', 'reasonCodes', 'reasons', 'sourceProfile']
  return (
    exactKeys(value, keys) &&
    typeof value.eligible === 'boolean' &&
    stringArray(value.reasonCodes) &&
    stringArray(value.reasons) &&
    (value.sourceProfile === undefined || sourceProfile(value.sourceProfile))
  )
}

const transcode = (value: unknown): boolean =>
  record(value) &&
  exactKeys(value, [
    'mode',
    'exactReconstruction',
    'inputBytes',
    'outputBytes',
    'savingsBytes',
    'savingsPercentage',
    'sourceProfile',
    'preservedMetadata',
    'warnings',
    'outputStructure',
    'managedPeakBytes',
    'elapsedMilliseconds',
    'libjxlReferenceBytes',
  ]) &&
  (value.mode === 'exact-jpeg' || value.mode === 'pixel-lossless') &&
  typeof value.exactReconstruction === 'boolean' &&
  nonnegativeInteger(value.inputBytes) &&
  nonnegativeInteger(value.outputBytes) &&
  Number.isFinite(value.savingsBytes) &&
  Number.isFinite(value.savingsPercentage) &&
  sourceProfile(value.sourceProfile) &&
  record(value.preservedMetadata) &&
  exactKeys(value.preservedMetadata, ['appMarkers', 'comments', 'opaqueBytes', 'tailBytes']) &&
  Object.values(value.preservedMetadata).every(nonnegativeInteger) &&
  stringArray(value.warnings) &&
  record(value.outputStructure) &&
  exactKeys(value.outputStructure, ['kind', 'organization', 'reconstruction']) &&
  value.outputStructure.kind === 'container' &&
  value.outputStructure.organization === 'jxlc' &&
  (value.outputStructure.reconstruction === 'available' ||
    value.outputStructure.reconstruction === 'unavailable') &&
  nonnegativeInteger(value.managedPeakBytes) &&
  Number.isFinite(value.elapsedMilliseconds) &&
  Number(value.elapsedMilliseconds) >= 0 &&
  (value.libjxlReferenceBytes === null || nonnegativeInteger(value.libjxlReferenceBytes))

const encoderPixelFormat = (value: unknown): value is JpegXlWorkbenchPixelSource['pixelFormat'] =>
  value === 'gray8' ||
  value === 'gray16' ||
  value === 'rgb8' ||
  value === 'rgb16' ||
  value === 'rgba8' ||
  value === 'rgba16'

const pixelSource = (value: unknown): value is JpegXlWorkbenchPixelSource =>
  record(value) &&
  exactKeys(value, ['container', 'pixelFormat', 'color', 'alpha']) &&
  (value.container === 'PNG' || value.container === 'TIFF') &&
  encoderPixelFormat(value.pixelFormat) &&
  typeof value.color === 'string' &&
  value.color.length <= 256 &&
  (value.alpha === 'none' || value.alpha === 'straight')

const encode = (value: unknown): value is JpegXlWorkbenchEncodeSummary =>
  record(value) &&
  exactKeys(value, [
    'status',
    'sourcePixelFormat',
    'decodedPixelFormat',
    'exactDecodedSamples',
    'inputBytes',
    'outputBytes',
    'sizeDifferenceBytes',
    'outputToInputRatio',
  ]) &&
  value.status === 'Experimental' &&
  encoderPixelFormat(value.sourcePixelFormat) &&
  value.decodedPixelFormat === value.sourcePixelFormat &&
  value.exactDecodedSamples === true &&
  positiveInteger(value.inputBytes) &&
  positiveInteger(value.outputBytes) &&
  Number.isSafeInteger(value.sizeDifferenceBytes) &&
  Number.isFinite(value.outputToInputRatio) &&
  Number(value.outputToInputRatio) > 0

// Dedicated-worker messages use an empty origin and a null source. Window-origin
// checks do not apply to this private channel; reject synthetic events as well.
export const isJpegXlWorkbenchWorkerEvent = (
  event: Pick<MessageEvent<unknown>, 'isTrusted' | 'origin' | 'source'>,
): boolean => event.isTrusted && event.origin === '' && event.source === null

export const isJpegXlWorkbenchRequest = (value: unknown): value is JpegXlWorkbenchRequest => {
  if (!record(value) || typeof value.type !== 'string' || !identity(value)) return false
  if (value.type === 'transform')
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'width', 'height', 'fit', 'format']) &&
      positiveInteger(value.width) &&
      positiveInteger(value.height) &&
      Number(value.width) <= 4096 &&
      Number(value.height) <= 4096 &&
      (value.fit === 'contain' || value.fit === 'cover' || value.fit === 'fill') &&
      (value.format === 'png' || value.format === 'jpeg')
    )
  if (value.type === 'transcode') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'onlyIfSmaller']) &&
      typeof value.onlyIfSmaller === 'boolean'
    )
  }
  if (value.type === 'encode' || value.type === 'reconstruct' || value.type === 'cancel') {
    return exactKeys(value, ['type', 'requestId', 'generation'])
  }
  return (
    value.type === 'open' &&
    exactKeys(value, ['type', 'requestId', 'generation', 'name', 'bytes']) &&
    validName(value.name) &&
    value.bytes instanceof ArrayBuffer &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= jpegXlWorkbenchMaximumInputBytes
  )
}

export const isJpegXlWorkbenchResponse = (value: unknown): value is JpegXlWorkbenchResponse => {
  if (!record(value) || typeof value.type !== 'string' || !identity(value)) return false
  if (value.type === 'error') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'message', 'cancelled']) &&
      typeof value.message === 'string' &&
      value.message.length <= 4096 &&
      typeof value.cancelled === 'boolean'
    )
  }
  if (value.type === 'opened') {
    const commonKeys = ['type', 'requestId', 'generation', 'name', 'sourceKind', 'inputBytes']
    const keys =
      value.sourceKind === 'jpeg'
        ? [...commonKeys, 'eligibility', 'preview']
        : value.sourceKind === 'jpegxl'
          ? [...commonKeys, 'inspection', 'preview']
          : [...commonKeys, 'pixelSource', 'preview']
    return (
      exactKeys(value, keys) &&
      validName(value.name) &&
      (value.sourceKind === 'jpeg' ||
        value.sourceKind === 'jpegxl' ||
        value.sourceKind === 'png' ||
        value.sourceKind === 'tiff') &&
      positiveInteger(value.inputBytes) &&
      Number(value.inputBytes) <= jpegXlWorkbenchMaximumInputBytes &&
      preview(value.preview) &&
      (value.sourceKind === 'jpeg'
        ? eligibility(value.eligibility)
        : value.sourceKind === 'jpegxl'
          ? inspection(value.inspection)
          : pixelSource(value.pixelSource))
    )
  }
  if (value.type !== 'output') return false
  const common =
    validName(value.name) &&
    value.bytes instanceof ArrayBuffer &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= jpegXlWorkbenchMaximumOutputBytes &&
    preview(value.preview)
  if (value.action === 'reconstruct' || value.action === 'transform') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'action', 'name', 'bytes', 'preview']) &&
      common
    )
  }
  if (value.action === 'encode') {
    return (
      exactKeys(value, [
        'type',
        'requestId',
        'generation',
        'action',
        'name',
        'bytes',
        'preview',
        'inspection',
        'encode',
      ]) &&
      common &&
      inspection(value.inspection) &&
      encode(value.encode)
    )
  }
  return (
    value.action === 'transcode' &&
    exactKeys(value, [
      'type',
      'requestId',
      'generation',
      'action',
      'name',
      'bytes',
      'preview',
      'inspection',
      'transcode',
      'evidence',
    ]) &&
    common &&
    inspection(value.inspection) &&
    transcode(value.transcode) &&
    record(value.evidence)
  )
}
