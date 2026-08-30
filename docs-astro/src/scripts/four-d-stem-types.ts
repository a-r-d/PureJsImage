export const fourDStemWorkerProtocolVersion = 1

export type FourDStemWorkerRoi =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'rectangle'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  | {
      readonly kind: 'circle'
      readonly x: number
      readonly y: number
      readonly radius: number
    }
  | {
      readonly kind: 'annulus'
      readonly x: number
      readonly y: number
      readonly innerRadius: number
      readonly outerRadius: number
    }

export type FourDStemWorkerRequest =
  | { readonly version: 1; readonly type: 'open-fixture'; readonly sequence: number }
  | {
      readonly version: 1
      readonly type: 'open-mib'
      readonly sequence: number
      readonly mib: File
      readonly hdr?: File
    }
  | {
      readonly version: 1
      readonly type: 'cursor'
      readonly sequence: number
      readonly scanX: number
      readonly scanY: number
    }
  | {
      readonly version: 1
      readonly type: 'detector-roi'
      readonly sequence: number
      readonly roi: FourDStemWorkerRoi
      readonly reduction: 'sum' | 'mean'
    }
  | {
      readonly version: 1
      readonly type: 'scan-roi'
      readonly sequence: number
      readonly roi: Exclude<FourDStemWorkerRoi, { readonly kind: 'annulus' }>
      readonly reduction: 'sum' | 'mean'
    }
  | { readonly version: 1; readonly type: 'cancel'; readonly sequence: number }
  | { readonly version: 1; readonly type: 'close'; readonly sequence: number }

export interface FourDStemEvidenceSnapshot {
  readonly sourceBytes: number
  readonly logicalReads: number
  readonly logicalBytes: number
  readonly uniquePrimarySourceBytes: number
  readonly logicalRanges: readonly { readonly start: number; readonly end: number }[]
  readonly abortedReads: number
  readonly physicalTransfers: number
  readonly transferredBytes: number
  readonly coalescedConsumers: number
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly cacheEvictions: number
  readonly retainedCacheBytes: number
  readonly decodedBlocks: number
  readonly cacheAdmissions: number
  readonly sourceRetainedBytes: number
  readonly derivedRetainedBytes: number
  readonly cancellations: number
  readonly liveManagedBytes: number
  readonly peakManagedBytes: number
  readonly firstTileMilliseconds: number | null
  readonly activeOperation: string
  readonly provider: string
  readonly timeline: readonly {
    readonly timeMicroseconds: number
    readonly type: string
    readonly label: string
  }[]
}

export interface FourDStemRenderedView {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8ClampedArray<ArrayBuffer>
  readonly range: readonly [minimum: number, maximum: number]
}

export type FourDStemWorkerResponse =
  | {
      readonly version: 1
      readonly type: 'opened'
      readonly sequence: number
      readonly name: string
      readonly reader: string
      readonly sampleType: string
      readonly scanShape: readonly [number, number]
      readonly detectorShape: readonly [number, number]
      readonly roles: {
        readonly navigationX: string
        readonly navigationY: string
        readonly detectorX: string
        readonly detectorY: string
      }
      readonly cursor: readonly [number, number]
      readonly navigation: FourDStemRenderedView
      readonly diffraction: FourDStemRenderedView
      readonly evidence: FourDStemEvidenceSnapshot
    }
  | {
      readonly version: 1
      readonly type: 'rendered'
      readonly sequence: number
      readonly target: 'navigation' | 'diffraction'
      readonly view: FourDStemRenderedView
      readonly cursor?: readonly [number, number]
      readonly evidence: FourDStemEvidenceSnapshot
    }
  | {
      readonly version: 1
      readonly type: 'evidence'
      readonly sequence: number
      readonly evidence: FourDStemEvidenceSnapshot
    }
  | {
      readonly version: 1
      readonly type: 'error'
      readonly sequence: number
      readonly message: string
      readonly recoverable: boolean
    }
  | { readonly version: 1; readonly type: 'closed'; readonly sequence: number }
