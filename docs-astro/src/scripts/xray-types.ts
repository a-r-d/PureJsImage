import type {
  EvidenceEvent,
  ExecutionEvidenceReport,
  ImageExecutionPlanDescription,
} from '../../../src/evidence.ts'

export type XrayRequest =
  | { readonly type: 'open-local'; readonly file: File }
  | { readonly type: 'open-remote'; readonly url: string }
  | { readonly type: 'open-ome-zarr'; readonly url: string }
  | { readonly type: 'cancel' }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value)
  return keys.length === expected.length && expected.every((key) => keys.includes(key))
}

export const isXrayRequest = (value: unknown): value is XrayRequest => {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'cancel') return hasExactKeys(value, ['type'])
  if (value.type === 'open-local') {
    return (
      hasExactKeys(value, ['type', 'file']) &&
      typeof File !== 'undefined' &&
      value.file instanceof File
    )
  }
  if (value.type === 'open-remote' || value.type === 'open-ome-zarr') {
    return (
      hasExactKeys(value, ['type', 'url']) &&
      typeof value.url === 'string' &&
      value.url.trim().length > 0
    )
  }
  return false
}

export interface XrayScientificPlan {
  readonly kind: 'scientific-tile'
  readonly reader: string
  readonly datasetId: string
  readonly displayAxes: readonly [string, string]
  readonly fixedIndices: readonly { readonly axisId: string; readonly index: number }[]
  readonly resolutionLevel: number
  readonly requestedRegion: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly precision: 'native'
  readonly workingMemory: 'bounded-blocks-and-chunks'
}

export type XrayResponse =
  | { readonly type: 'event'; readonly event: EvidenceEvent }
  | {
      readonly type: 'report'
      readonly source: { readonly kind: 'local' | 'remote'; readonly size: number }
      readonly metadata: {
        readonly format: string
        readonly width: number
        readonly height: number
        readonly bitDepth?: number
      }
      readonly plan: ImageExecutionPlanDescription | XrayScientificPlan
      readonly decodedPreviewTile: boolean
      readonly report: ExecutionEvidenceReport
    }
  | { readonly type: 'error'; readonly message: string }
