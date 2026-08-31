import type { ExecutionEvidenceReport } from '../../../src/evidence.ts'
import type {
  GainMapImageInspection,
  GainMapJpegMetadataMode,
  GainMapTransformOperation,
} from '../../../src/hdr/index.ts'

export interface HdrSurgeryDimensions {
  readonly width: number
  readonly height: number
}

export interface HdrSurgeryPreviewPlan {
  readonly logicalDimensions: HdrSurgeryDimensions
  readonly previewDimensions: HdrSurgeryDimensions
  readonly scaled: boolean
}

export const planHdrSurgeryPreview = (
  logicalDimensions: Readonly<HdrSurgeryDimensions>,
  maximumPixels = 4_194_304,
): HdrSurgeryPreviewPlan => {
  if (
    !Number.isSafeInteger(logicalDimensions.width) ||
    !Number.isSafeInteger(logicalDimensions.height) ||
    logicalDimensions.width < 1 ||
    logicalDimensions.height < 1 ||
    !Number.isSafeInteger(maximumPixels) ||
    maximumPixels < 1
  ) {
    throw new Error('HDR Surgery preview dimensions are invalid')
  }
  const logical = Object.freeze({
    width: logicalDimensions.width,
    height: logicalDimensions.height,
  })
  if (logical.width * logical.height <= maximumPixels) {
    return Object.freeze({ logicalDimensions: logical, previewDimensions: logical, scaled: false })
  }
  const scale = Math.sqrt(maximumPixels / (logical.width * logical.height))
  const preview = Object.freeze({
    width: Math.max(1, Math.floor(logical.width * scale)),
    height: Math.max(1, Math.floor(logical.height * scale)),
  })
  return Object.freeze({ logicalDimensions: logical, previewDimensions: preview, scaled: true })
}

interface HdrSurgeryPreviewGeometry {
  readonly logicalDimensions: HdrSurgeryDimensions
  readonly previewDimensions: HdrSurgeryDimensions
  readonly previewGainMapDimensions: HdrSurgeryDimensions
  readonly previewScaled: boolean
}

export type HdrSurgeryRequest =
  | {
      readonly type: 'open'
      readonly requestId: number
      readonly generation: number
      readonly name: string
      readonly bytes: ArrayBuffer
      readonly displayBoost: number
      readonly operations: readonly GainMapTransformOperation[]
    }
  | {
      readonly type: 'render'
      readonly requestId: number
      readonly generation: number
      readonly displayBoost: number
      readonly operations: readonly GainMapTransformOperation[]
    }
  | {
      readonly type: 'repack'
      readonly requestId: number
      readonly generation: number
      readonly metadataMode: GainMapJpegMetadataMode
      readonly operations: readonly GainMapTransformOperation[]
      readonly baseQuality: number
      readonly gainMapQuality: number
    }
  | {
      readonly type: 'avif'
      readonly requestId: number
      readonly generation: number
      readonly operations: readonly GainMapTransformOperation[]
    }
  | {
      readonly type: 'cancel'
      readonly requestId: number
      readonly generation: number
    }

export type HdrSurgeryResponse =
  | ({
      readonly type: 'result'
      readonly requestId: number
      readonly generation: number
      readonly name: string
      readonly inspection: GainMapImageInspection
      readonly basePreviewRgba: ArrayBuffer
      readonly gainPreviewRgba: ArrayBuffer
      readonly linearRgb: ArrayBuffer
      readonly previewRgba: ArrayBuffer
      readonly falseColorRgba: ArrayBuffer
      readonly report: ExecutionEvidenceReport
    } & HdrSurgeryPreviewGeometry)
  | ({
      readonly type: 'rendered'
      readonly requestId: number
      readonly generation: number
      readonly linearRgb: ArrayBuffer
      readonly previewRgba: ArrayBuffer
      readonly falseColorRgba: ArrayBuffer
      readonly report: ExecutionEvidenceReport
      readonly inspection: GainMapImageInspection
      readonly basePreviewRgba: ArrayBuffer
      readonly gainPreviewRgba: ArrayBuffer
    } & HdrSurgeryPreviewGeometry)
  | {
      readonly type: 'repacked'
      readonly requestId: number
      readonly generation: number
      readonly bytes: ArrayBuffer
      readonly metadataMode: GainMapJpegMetadataMode
    }
  | {
      readonly type: 'avif'
      readonly requestId: number
      readonly generation: number
      readonly bytes: ArrayBuffer
    }
  | {
      readonly type: 'error'
      readonly requestId: number
      readonly generation: number
      readonly message: string
      readonly cancelled: boolean
    }

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

const dimensions = (value: unknown): value is HdrSurgeryDimensions =>
  record(value) &&
  exactKeys(value, ['width', 'height']) &&
  Number.isSafeInteger(value.width) &&
  Number(value.width) > 0 &&
  Number.isSafeInteger(value.height) &&
  Number(value.height) > 0

const transformOperations = (value: unknown): value is readonly GainMapTransformOperation[] => {
  if (!Array.isArray(value) || value.length > 32) return false
  return value.every((candidate) => {
    if (!record(candidate) || typeof candidate.type !== 'string') return false
    if (
      candidate.type === 'auto-orient' ||
      candidate.type === 'flip-horizontal' ||
      candidate.type === 'flip-vertical'
    ) {
      return exactKeys(candidate, ['type'])
    }
    if (candidate.type === 'rotate') {
      return (
        exactKeys(candidate, ['type', 'degrees']) &&
        (candidate.degrees === 90 || candidate.degrees === 180 || candidate.degrees === 270)
      )
    }
    if (candidate.type === 'crop') {
      return (
        exactKeys(candidate, ['type', 'x', 'y', 'width', 'height']) &&
        ['x', 'y', 'width', 'height'].every((key) => Number.isSafeInteger(candidate[key])) &&
        Number(candidate.x) >= 0 &&
        Number(candidate.y) >= 0 &&
        Number(candidate.width) > 0 &&
        Number(candidate.height) > 0
      )
    }
    if (candidate.type === 'resize') {
      return (
        exactKeys(candidate, ['type', 'width', 'height', 'kernel']) &&
        Number.isSafeInteger(candidate.width) &&
        Number(candidate.width) > 0 &&
        Number.isSafeInteger(candidate.height) &&
        Number(candidate.height) > 0 &&
        (candidate.kernel === 'nearest' ||
          candidate.kernel === 'bilinear' ||
          candidate.kernel === 'lanczos3')
      )
    }
    return false
  })
}

export const isHdrSurgeryRequest = (value: unknown): value is HdrSurgeryRequest => {
  if (!record(value) || typeof value.type !== 'string' || !identity(value)) return false
  if (value.type === 'cancel') {
    return exactKeys(value, ['type', 'requestId', 'generation'])
  }
  if (value.type === 'render') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'displayBoost', 'operations']) &&
      typeof value.displayBoost === 'number' &&
      Number.isFinite(value.displayBoost) &&
      value.displayBoost >= 1 &&
      value.displayBoost <= 64 &&
      transformOperations(value.operations)
    )
  }
  if (value.type === 'repack') {
    return (
      exactKeys(value, [
        'type',
        'requestId',
        'generation',
        'metadataMode',
        'operations',
        'baseQuality',
        'gainMapQuality',
      ]) &&
      (value.metadataMode === 'dual' ||
        value.metadataMode === 'iso' ||
        value.metadataMode === 'ultra-hdr') &&
      transformOperations(value.operations) &&
      Number.isInteger(value.baseQuality) &&
      Number(value.baseQuality) >= 1 &&
      Number(value.baseQuality) <= 100 &&
      Number.isInteger(value.gainMapQuality) &&
      Number(value.gainMapQuality) >= 1 &&
      Number(value.gainMapQuality) <= 100
    )
  }
  if (value.type === 'avif') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'operations']) &&
      transformOperations(value.operations)
    )
  }
  if (value.type === 'open') {
    return (
      exactKeys(value, [
        'type',
        'requestId',
        'generation',
        'name',
        'bytes',
        'displayBoost',
        'operations',
      ]) &&
      typeof value.name === 'string' &&
      value.name.length > 0 &&
      value.name.length <= 512 &&
      value.bytes instanceof ArrayBuffer &&
      value.bytes.byteLength > 0 &&
      value.bytes.byteLength <= 64 * 1024 * 1024 &&
      typeof value.displayBoost === 'number' &&
      Number.isFinite(value.displayBoost) &&
      value.displayBoost >= 1 &&
      value.displayBoost <= 64 &&
      transformOperations(value.operations)
    )
  }
  return false
}

export const isHdrSurgeryResponse = (value: unknown): value is HdrSurgeryResponse => {
  if (!record(value) || typeof value.type !== 'string' || !identity(value)) return false
  if (value.type === 'error') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'message', 'cancelled']) &&
      typeof value.message === 'string' &&
      typeof value.cancelled === 'boolean'
    )
  }
  if (value.type === 'repacked') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'bytes', 'metadataMode']) &&
      value.bytes instanceof ArrayBuffer &&
      (value.metadataMode === 'dual' ||
        value.metadataMode === 'iso' ||
        value.metadataMode === 'ultra-hdr')
    )
  }
  if (value.type === 'avif') {
    return (
      exactKeys(value, ['type', 'requestId', 'generation', 'bytes']) &&
      value.bytes instanceof ArrayBuffer
    )
  }
  const renderedKeys = [
    'type',
    'requestId',
    'generation',
    'linearRgb',
    'previewRgba',
    'falseColorRgba',
    'report',
    'inspection',
    'basePreviewRgba',
    'gainPreviewRgba',
    'logicalDimensions',
    'previewDimensions',
    'previewGainMapDimensions',
    'previewScaled',
  ]
  if (value.type === 'rendered') {
    return (
      exactKeys(value, renderedKeys) &&
      value.linearRgb instanceof ArrayBuffer &&
      value.previewRgba instanceof ArrayBuffer &&
      value.falseColorRgba instanceof ArrayBuffer &&
      value.basePreviewRgba instanceof ArrayBuffer &&
      value.gainPreviewRgba instanceof ArrayBuffer &&
      dimensions(value.logicalDimensions) &&
      dimensions(value.previewDimensions) &&
      dimensions(value.previewGainMapDimensions) &&
      typeof value.previewScaled === 'boolean' &&
      record(value.report) &&
      record(value.inspection)
    )
  }
  if (value.type === 'result') {
    return (
      exactKeys(value, [
        ...renderedKeys.filter((key) => key !== 'type' && key !== 'inspection'),
        'type',
        'name',
        'inspection',
      ]) &&
      typeof value.name === 'string' &&
      record(value.inspection) &&
      value.basePreviewRgba instanceof ArrayBuffer &&
      value.gainPreviewRgba instanceof ArrayBuffer &&
      value.linearRgb instanceof ArrayBuffer &&
      value.previewRgba instanceof ArrayBuffer &&
      value.falseColorRgba instanceof ArrayBuffer &&
      dimensions(value.logicalDimensions) &&
      dimensions(value.previewDimensions) &&
      dimensions(value.previewGainMapDimensions) &&
      typeof value.previewScaled === 'boolean' &&
      record(value.report)
    )
  }
  return false
}
