export const scientificCompetitorBenchmarkSchemaVersion = 1 as const

export type ScientificCompetitorFamily =
  | 'tiff-whole-slide'
  | 'hdf5-emd'
  | 'medical-volumetric'
  | 'array-interchange'

export type ScientificCompetitorOperation =
  | 'metadata'
  | 'hierarchy'
  | 'full'
  | 'selected'
  | 'random-windows'

export type ScientificCompetitorStatus = 'supported' | 'unsupported' | 'invalid-output' | 'error'
export type ScientificCompetitorImplementation = 'pure-javascript' | 'webassembly'
export type ScientificCompetitorEnvironment = 'Node' | 'browser' | 'both'
export type ScientificCompetitorInputModel =
  | 'ImageSource'
  | 'file path'
  | 'ArrayBuffer'
  | 'complete Uint8Array'
  | 'virtual filesystem'

export interface ScientificCompetitorEngine {
  readonly id: string
  readonly packageName: string
  readonly packageNames?: readonly string[]
  readonly packageVersion: string
  readonly implementationClass: ScientificCompetitorImplementation
  readonly environment: ScientificCompetitorEnvironment
  readonly inputModel: ScientificCompetitorInputModel
  readonly lazyOrSelectedReads: boolean
  readonly copiesCompleteInputBeforeOpen: boolean
  readonly supportedWorkloadIds: readonly string[]
  readonly unsupportedReasons: Readonly<Record<string, string>>
}

export interface ScientificCompetitorWorkload {
  readonly id: string
  readonly title: string
  readonly family: ScientificCompetitorFamily
  readonly fixtureId: string
  readonly operation: ScientificCompetitorOperation
  readonly datasetPath?: string
  readonly representative: boolean
  readonly expectedShape?: readonly number[]
  readonly expectedNativeSampleType?: string
}

export interface ScientificCompetitorStageTiming {
  readonly moduleImportMilliseconds: number
  readonly wasmInitializationMilliseconds: number
  readonly inputCopyMilliseconds: number
  readonly inputBridgeMilliseconds: number
  readonly openMilliseconds: number
  readonly hierarchyMilliseconds: number
  readonly readMilliseconds: number
  readonly outputTransferMilliseconds: number
  readonly closeAndCleanupMilliseconds: number
  readonly firstUsableDataMilliseconds: number | null
  readonly totalWallMilliseconds: number
}

export interface ScientificCompetitorSourceMetrics {
  readonly requestCount: number
  readonly requestedBytes: number
  readonly returnedBytes: number
  readonly uniqueBytesTouched: number
  readonly completeInputRead: boolean
  readonly requiredInputCopyBytes: number
  readonly sourceInstrumentation: 'custom-range-source' | 'filesystem' | 'complete-buffer'
}

export interface ScientificCompetitorCorrectness {
  readonly shape: readonly number[] | null
  readonly nativeSampleType: string | null
  readonly sampleSha256: string | null
  readonly sampleCount: number | null
  readonly outputBytes: number
  readonly details: readonly string[]
}

export interface ScientificCompetitorRun {
  readonly status: ScientificCompetitorStatus
  readonly statusReason: string | null
  readonly stages: ScientificCompetitorStageTiming
  readonly peakRssBytes: number
  readonly baselineRssBytes: number
  readonly peakHeapUsedBytes: number
  readonly peakExternalBytes: number
  readonly peakArrayBufferBytes: number
  readonly source: ScientificCompetitorSourceMetrics
  readonly correctness: ScientificCompetitorCorrectness
}

export interface ScientificCompetitorResult {
  readonly engine: ScientificCompetitorEngine
  readonly workload: ScientificCompetitorWorkload
  readonly fixture: {
    readonly id: string
    readonly sha256: string
    readonly sizeBytes: number
    readonly provenance: string
    readonly supportBoundary: string
    readonly representative: boolean
  }
  readonly profile: 'smoke' | 'baseline' | 'browser'
  readonly runs: number
  readonly warmups: number
  readonly status: ScientificCompetitorStatus
  readonly statusReason: string | null
  readonly summary: {
    readonly totalWallMilliseconds: number | null
    readonly firstUsableDataMilliseconds: number | null
    readonly peakRssBytes: number | null
    readonly sourceBytes: number | null
    readonly outputBytes: number | null
  }
  readonly runsDetail: readonly ScientificCompetitorRun[]
}

export interface ScientificCompetitorBundleMetrics {
  readonly importedJavaScriptBytes: number | null
  readonly importedJavaScriptGzipBytes: number | null
  readonly importedJavaScriptBrotliBytes: number | null
  readonly wasmAssets: readonly {
    readonly name: string
    readonly rawBytes: number
    readonly gzipBytes: number
    readonly brotliBytes: number
    readonly embeddedInJavaScript: boolean
  }[]
  readonly installedBytes: number | null
  readonly installedPackageCount: number | null
  readonly installedPackages: readonly string[]
}

export interface ScientificCompetitorReport {
  readonly schemaVersion: typeof scientificCompetitorBenchmarkSchemaVersion
  readonly createdAt: string
  readonly profile: 'smoke' | 'baseline' | 'browser'
  readonly environment: {
    readonly runtime: 'Node' | 'Chromium'
    readonly nodeVersion?: string
    readonly platform?: string
    readonly architecture?: string
  }
  readonly configuration: {
    readonly runs: number
    readonly warmups: number
    readonly isolatedProcessPerRun: boolean
    readonly outputValidationTimed: false
    readonly exactFixtureBytes: true
  }
  readonly engines: readonly ScientificCompetitorEngine[]
  readonly workloads: readonly ScientificCompetitorWorkload[]
  readonly bundle: Readonly<Record<string, ScientificCompetitorBundleMetrics>>
  readonly results: readonly ScientificCompetitorResult[]
}
