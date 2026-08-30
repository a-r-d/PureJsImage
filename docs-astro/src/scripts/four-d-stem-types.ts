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

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

const pair = (
  value: unknown,
  item: (entry: unknown) => boolean,
): value is readonly [unknown, unknown] =>
  Array.isArray(value) && value.length === 2 && value.every(item)

const roi = (value: unknown, allowAnnulus: boolean): value is FourDStemWorkerRoi => {
  if (!record(value) || !finite(value.x) || !finite(value.y)) return false
  if (value.kind === 'point') return true
  if (value.kind === 'rectangle') {
    return finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0
  }
  if (value.kind === 'circle') return finite(value.radius) && value.radius > 0
  return (
    allowAnnulus &&
    value.kind === 'annulus' &&
    finite(value.innerRadius) &&
    value.innerRadius >= 0 &&
    finite(value.outerRadius) &&
    value.outerRadius > value.innerRadius
  )
}

const requestBase = (
  value: unknown,
): value is Readonly<Record<string, unknown>> & {
  readonly version: 1
  readonly sequence: number
} => record(value) && value.version === 1 && nonNegativeInteger(value.sequence)

export const isFourDStemWorkerRequest = (value: unknown): value is FourDStemWorkerRequest => {
  if (!requestBase(value)) return false
  if (value.type === 'open-fixture' || value.type === 'cancel' || value.type === 'close')
    return true
  if (value.type === 'open-mib') {
    return (
      typeof File !== 'undefined' &&
      value.mib instanceof File &&
      (value.hdr === undefined || value.hdr instanceof File)
    )
  }
  if (value.type === 'cursor') {
    return nonNegativeInteger(value.scanX) && nonNegativeInteger(value.scanY)
  }
  if (value.type !== 'detector-roi' && value.type !== 'scan-roi') return false
  return (
    (value.reduction === 'sum' || value.reduction === 'mean') &&
    roi(value.roi, value.type === 'detector-roi')
  )
}

const evidenceRange = (value: unknown): boolean =>
  record(value) &&
  nonNegativeInteger(value.start) &&
  nonNegativeInteger(value.end) &&
  value.end >= value.start

const evidenceTimelineEntry = (value: unknown): boolean =>
  record(value) &&
  nonNegativeInteger(value.timeMicroseconds) &&
  nonEmptyString(value.type) &&
  nonEmptyString(value.label)

const evidenceSnapshot = (value: unknown): value is FourDStemEvidenceSnapshot => {
  if (!record(value)) return false
  for (const key of [
    'sourceBytes',
    'logicalReads',
    'logicalBytes',
    'uniquePrimarySourceBytes',
    'abortedReads',
    'physicalTransfers',
    'transferredBytes',
    'coalescedConsumers',
    'cacheHits',
    'cacheMisses',
    'cacheEvictions',
    'retainedCacheBytes',
    'decodedBlocks',
    'cacheAdmissions',
    'sourceRetainedBytes',
    'derivedRetainedBytes',
    'cancellations',
    'liveManagedBytes',
    'peakManagedBytes',
  ] as const) {
    if (!nonNegativeInteger(value[key])) return false
  }
  return (
    Array.isArray(value.logicalRanges) &&
    value.logicalRanges.every(evidenceRange) &&
    (value.firstTileMilliseconds === null ||
      (finite(value.firstTileMilliseconds) && value.firstTileMilliseconds >= 0)) &&
    nonEmptyString(value.activeOperation) &&
    nonEmptyString(value.provider) &&
    Array.isArray(value.timeline) &&
    value.timeline.every(evidenceTimelineEntry)
  )
}

const renderedView = (value: unknown): value is FourDStemRenderedView => {
  if (
    !record(value) ||
    !nonNegativeInteger(value.width) ||
    value.width === 0 ||
    !nonNegativeInteger(value.height) ||
    value.height === 0 ||
    !(value.pixels instanceof Uint8ClampedArray) ||
    !pair(value.range, finite)
  ) {
    return false
  }
  const pixels = value.width * value.height * 4
  return Number.isSafeInteger(pixels) && value.pixels.byteLength === pixels
}

const responseBase = (
  value: unknown,
): value is Readonly<Record<string, unknown>> & {
  readonly version: 1
  readonly sequence: number
} => record(value) && value.version === 1 && nonNegativeInteger(value.sequence)

export const isFourDStemWorkerResponse = (value: unknown): value is FourDStemWorkerResponse => {
  if (!responseBase(value)) return false
  if (value.type === 'closed') return true
  if (value.type === 'error') {
    return nonEmptyString(value.message) && typeof value.recoverable === 'boolean'
  }
  if (value.type === 'evidence') return evidenceSnapshot(value.evidence)
  if (value.type === 'rendered') {
    return (
      (value.target === 'navigation' || value.target === 'diffraction') &&
      renderedView(value.view) &&
      evidenceSnapshot(value.evidence) &&
      (value.cursor === undefined || pair(value.cursor, nonNegativeInteger))
    )
  }
  if (value.type !== 'opened' || !record(value.roles)) return false
  return (
    nonEmptyString(value.name) &&
    nonEmptyString(value.reader) &&
    nonEmptyString(value.sampleType) &&
    pair(value.scanShape, (entry) => nonNegativeInteger(entry) && entry > 0) &&
    pair(value.detectorShape, (entry) => nonNegativeInteger(entry) && entry > 0) &&
    nonEmptyString(value.roles.navigationX) &&
    nonEmptyString(value.roles.navigationY) &&
    nonEmptyString(value.roles.detectorX) &&
    nonEmptyString(value.roles.detectorY) &&
    pair(value.cursor, nonNegativeInteger) &&
    renderedView(value.navigation) &&
    renderedView(value.diffraction) &&
    evidenceSnapshot(value.evidence)
  )
}

export const isCurrentFourDStemWorkerResponseSequence = (
  responseSequence: number,
  latestRequestSequence: number,
): boolean => responseSequence === latestRequestSequence
