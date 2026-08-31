import type { ExecutionEvidenceReport } from '../../../src/evidence.ts'
import type {
  JpegReconstructionEligibility,
  JpegTranscodeResult,
  JpegXlInspection,
} from '../../../src/jpegxl.ts'

export type JpegXlWorkbenchRequest =
  | {
      readonly type: 'open'
      readonly requestId: number
      readonly name: string
      readonly bytes: ArrayBuffer
    }
  | { readonly type: 'transcode'; readonly requestId: number }
  | { readonly type: 'reconstruct'; readonly requestId: number }

export interface JpegXlWorkbenchPreview {
  readonly width: number
  readonly height: number
  readonly rgba: ArrayBuffer
}

export type JpegXlWorkbenchResponse =
  | {
      readonly type: 'opened'
      readonly requestId: number
      readonly name: string
      readonly sourceKind: 'jpeg' | 'jpegxl'
      readonly inputBytes: number
      readonly inspection?: JpegXlInspection
      readonly eligibility?: JpegReconstructionEligibility
      readonly preview: JpegXlWorkbenchPreview
    }
  | {
      readonly type: 'output'
      readonly requestId: number
      readonly action: 'transcode' | 'reconstruct'
      readonly name: string
      readonly bytes: ArrayBuffer
      readonly preview: JpegXlWorkbenchPreview
      readonly inspection?: JpegXlInspection
      readonly transcode?: Pick<
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
      >
      readonly evidence?: ExecutionEvidenceReport
    }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string }

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isJpegXlWorkbenchRequest = (value: unknown): value is JpegXlWorkbenchRequest => {
  if (!record(value) || !Number.isSafeInteger(value.requestId)) return false
  if (value.type === 'transcode' || value.type === 'reconstruct') {
    return Object.keys(value).length === 2
  }
  return (
    value.type === 'open' &&
    Object.keys(value).length === 4 &&
    typeof value.name === 'string' &&
    value.bytes instanceof ArrayBuffer
  )
}
