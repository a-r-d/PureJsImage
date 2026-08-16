import type { RasterSampleType } from '../../src/raster.ts'

export const scientificReaderBenchmarkSchemaVersion = 1 as const

export type ScientificBenchmarkProfile = 'smoke' | 'baseline' | 'range' | 'scaling' | 'full'
export type ScientificOperationKind =
  | 'selected'
  | 'metadata-only'
  | 'first-block'
  | 'full-plane'
  | 'random-regions'
  | 'warm-repeated-selections'
export type ScientificBenchmarkStatus = 'supported' | 'unsupported' | 'invalid-output' | 'error'
export type ScientificMeasurementClass = 'representative' | 'correctness-only'

export interface NumericSummary {
  readonly median: number
  readonly p95: number
  readonly minimum: number
  readonly maximum: number
}

export interface TimingSummary {
  readonly processStartupMilliseconds: NumericSummary | null
  readonly moduleImportMilliseconds: NumericSummary | null
  readonly registryConstructionMilliseconds: NumericSummary | null
  readonly detectionMilliseconds: NumericSummary | null
  readonly documentOpenMilliseconds: NumericSummary | null
  readonly datasetEnumerationMilliseconds: NumericSummary | null
  readonly datasetOpenMilliseconds: NumericSummary | null
  readonly timeToFirstEmittedBlockMilliseconds: NumericSummary | null
  readonly completeSelectedOperationMilliseconds: NumericSummary | null
  readonly closeAndCleanupMilliseconds: NumericSummary | null
  readonly totalWallMilliseconds: NumericSummary | null
  readonly cpuUserMilliseconds: NumericSummary | null
  readonly cpuSystemMilliseconds: NumericSummary | null
}

export interface MemorySummary {
  readonly baselineRssBytes: NumericSummary | null
  readonly absolutePeakRssBytes: NumericSummary | null
  readonly peakHeapUsedBytes: NumericSummary | null
  readonly peakExternalBytes: NumericSummary | null
  readonly peakArrayBufferBytes: NumericSummary | null
  readonly outputBytes: NumericSummary | null
  readonly maximumEmittedBlockBytes: NumericSummary | null
}

export interface ResourceSourceSummary {
  readonly resourceId: string
  readonly name: string | null
  readonly sizeBytes: number
  readonly readCalls: NumericSummary
  readonly requestedBytes: NumericSummary
  readonly returnedBytes: NumericSummary
  readonly uniqueSourceBytesTouched: NumericSummary
  readonly largestIndividualReadBytes: NumericSummary
  readonly overfetchRatio: NumericSummary | null
  readonly payloadBytesRead: NumericSummary
  readonly completeSourceRead: boolean
}

export interface SourceSummary {
  readonly readCalls: NumericSummary | null
  readonly requestedBytes: NumericSummary | null
  readonly returnedBytes: NumericSummary | null
  readonly uniqueSourceBytesTouched: NumericSummary | null
  readonly largestIndividualReadBytes: NumericSummary | null
  readonly overfetchRatio: NumericSummary | null
  readonly companionResolutionCount: NumericSummary | null
  readonly perResource: readonly ResourceSourceSummary[]
  readonly completePrimarySourceRead: boolean | null
  readonly payloadBytesReadDuringDetection: number | null
  readonly payloadBytesReadDuringMetadataOnlyOpen: number | null
}

export type RepresentativeValue = number | 'NaN' | 'Infinity' | '-Infinity'

export interface CorrectnessSummary {
  readonly normalizedDescriptorSha256: string | null
  readonly selectedSampleSha256: string | null
  readonly selectedSampleCount: number | null
  readonly outputSampleType: RasterSampleType | null
  readonly outputComponentCount: number | null
  readonly blockCount: number | null
  readonly firstRepresentativeValue: RepresentativeValue | null
  readonly lastRepresentativeValue: RepresentativeValue | null
  readonly relevantCalibrationAssertions: readonly string[]
  readonly exactErrorClassification: string | null
}

export interface ScientificReaderIdentity {
  readonly id: string
  readonly version: string
}

export interface ScientificEnvironmentIdentity {
  readonly operatingSystem: string
  readonly operatingSystemVersion: string
  readonly architecture: string
  readonly nodeVersion: string
  readonly v8Version: string
  readonly cpuModel: string | null
  readonly logicalCpuCount: number
}

export interface ScientificResultIdentity {
  readonly schemaVersion: typeof scientificReaderBenchmarkSchemaVersion
  readonly workloadId: string
  readonly fixtureId: string
  readonly fixtureSha256: string
  readonly reader: ScientificReaderIdentity
  readonly engine: ScientificReaderIdentity
  readonly gitCommit: string
  readonly gitDirty: boolean | null
  readonly environment: ScientificEnvironmentIdentity
  readonly profile: ScientificBenchmarkProfile
  readonly runs: number
  readonly warmups: number
  readonly sourceLatencyMilliseconds: number
  readonly operation: ScientificOperationKind
}

export interface ScientificBenchmarkResult {
  readonly identity: ScientificResultIdentity
  readonly measurementClass: ScientificMeasurementClass
  readonly fixture: {
    readonly provenance: string
    readonly supportBoundary: string
    readonly expectedOracle: string
    readonly representative: boolean
  }
  readonly status: ScientificBenchmarkStatus
  readonly statusReason: string | null
  readonly timing: TimingSummary
  readonly memory: MemorySummary
  readonly source: SourceSummary
  readonly correctness: CorrectnessSummary
  readonly stability: {
    readonly measuredRuns: number
    readonly correctnessStable: boolean
    readonly firstBlockCvPercent: number | null
    readonly selectedOperationCvPercent: number | null
    readonly absolutePeakRssCvPercent: number | null
    readonly sourceBytesCvPercent: number | null
    readonly lowNoise: boolean
    readonly eligibleForDocumentationHeadlines: boolean
  }
  readonly runs: readonly ScientificRunResult[]
}

export interface ScientificRunResult {
  readonly status: ScientificBenchmarkStatus
  readonly statusReason: string | null
  readonly processStartupMilliseconds: number
  readonly moduleImportMilliseconds: number
  readonly registryConstructionMilliseconds: number
  readonly timing: ScientificRunTiming
  readonly memory: {
    readonly baselineRssBytes: number
    readonly absolutePeakRssBytes: number
    readonly peakHeapUsedBytes: number
    readonly peakExternalBytes: number
    readonly peakArrayBufferBytes: number
    readonly outputBytes: number
    readonly maximumEmittedBlockBytes: number
  }
  readonly source: {
    readonly readCalls: number
    readonly requestedBytes: number
    readonly returnedBytes: number
    readonly uniqueSourceBytesTouched: number
    readonly largestIndividualReadBytes: number
    readonly overfetchRatio: number | null
    readonly companionResolutionCount: number
    readonly perResource: readonly ResourceSourceRunMetrics[]
    readonly completePrimarySourceRead: boolean
    readonly payloadBytesReadDuringDetection: number | null
    readonly payloadBytesReadDuringMetadataOnlyOpen: number | null
  }
  readonly correctness: CorrectnessRunSummary
}

export interface ScientificRunTiming {
  readonly detectionMilliseconds: number
  readonly documentOpenMilliseconds: number
  readonly datasetEnumerationMilliseconds: number
  readonly datasetOpenMilliseconds: number
  readonly timeToFirstEmittedBlockMilliseconds: number | null
  readonly completeSelectedOperationMilliseconds: number
  readonly closeAndCleanupMilliseconds: number
  readonly totalWallMilliseconds: number
  readonly cpuUserMilliseconds: number
  readonly cpuSystemMilliseconds: number
}

export interface ResourceSourceRunMetrics {
  readonly resourceId: string
  readonly name: string | null
  readonly sizeBytes: number
  readonly readCalls: number
  readonly requestedBytes: number
  readonly returnedBytes: number
  readonly uniqueSourceBytesTouched: number
  readonly largestIndividualReadBytes: number
  readonly overfetchRatio: number | null
  readonly completeSourceRead: boolean
  readonly payloadBytesRead: number
}

export interface CorrectnessRunSummary {
  readonly normalizedDescriptorSha256: string | null
  readonly selectedSampleSha256: string | null
  readonly selectedSampleCount: number | null
  readonly outputSampleType: RasterSampleType | null
  readonly outputComponentCount: number | null
  readonly blockCount: number | null
  readonly firstRepresentativeValue: RepresentativeValue | null
  readonly lastRepresentativeValue: RepresentativeValue | null
  readonly relevantCalibrationAssertions: readonly string[]
  readonly exactErrorClassification: string | null
}

export interface ScientificBenchmarkReport {
  readonly schemaVersion: typeof scientificReaderBenchmarkSchemaVersion
  readonly createdAt: string
  readonly profile: ScientificBenchmarkProfile
  readonly validation: {
    readonly passed: boolean
  }
  readonly eligibleForDocumentationHeadlines: boolean
  readonly configuration: {
    readonly engine: ScientificReaderIdentity
    readonly runs: number
    readonly warmups: number
    readonly isolatedProcessPerRun: true
    readonly fixturePreparationTimed: false
    readonly outputValidationTimed: false
    readonly directRangeReadersOnly: boolean
  }
  readonly environment: ScientificEnvironmentIdentity & {
    readonly platform: string
    readonly gitCommit: string
    readonly gitDirty: boolean | null
  }
  readonly fixturePreparation: {
    readonly fixtures: readonly PreparedFixtureSummary[]
  }
  readonly results: readonly ScientificBenchmarkResult[]
}

export interface PreparedFixtureSummary {
  readonly id: string
  readonly sha256: string
  readonly resources: readonly {
    readonly id: string
    readonly name: string | null
    readonly path: string
    readonly sha256: string
    readonly sizeBytes: number
    readonly representative: boolean
  }[]
  readonly provenance: string
  readonly supportBoundary: string
  readonly expectedOracle: string
  readonly representative: boolean
}

export interface RegionSelection {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface FixedIndex {
  readonly axisId: string
  readonly index: number
}

export interface PlaneSelection {
  readonly kind: 'plane'
  readonly datasetId?: string
  readonly displayAxes?: readonly [string, string]
  readonly fixedIndices?: readonly FixedIndex[]
  readonly region?: RegionSelection
  readonly randomRegions?: {
    readonly count: number
    readonly width: number
    readonly height: number
    readonly seed: number
  }
}

export interface SeriesSelection {
  readonly kind: 'series'
  readonly datasetId?: string
  readonly axisId?: string
  readonly fixedIndices?: readonly FixedIndex[]
  readonly start?: number
  readonly length?: number
}

export type ScientificSelection = PlaneSelection | SeriesSelection

export interface DescriptorAssertion {
  readonly axisId?: string
  readonly sampleType?: RasterSampleType
  readonly componentCount?: number
  readonly axisUnit?: string
  readonly axisKind?: string
}

export interface ScientificWorkload {
  readonly id: string
  readonly title: string
  readonly readerId: string
  readonly fixtureId: string
  readonly profiles: readonly ScientificBenchmarkProfile[]
  readonly measurementClass: ScientificMeasurementClass
  readonly selection: ScientificSelection
  readonly descriptorAssertion?: DescriptorAssertion
  readonly calibrationAxes?: readonly string[]
  readonly detectionMode?: 'registry' | 'explicit'
  readonly directRangeReader: boolean
  readonly operation?: ScientificOperationKind
}

export interface PreparedFixture {
  readonly id: string
  readonly sha256: string
  readonly resources: readonly PreparedResource[]
  readonly payloadRanges: Readonly<Record<string, readonly (readonly [number, number])[]>>
  readonly provenance: string
  readonly supportBoundary: string
  readonly expectedOracle: string
  readonly representative: boolean
}

export interface PreparedResource {
  readonly id: string
  readonly name: string | null
  readonly path: string
  readonly sha256: string
  readonly sizeBytes: number
}
