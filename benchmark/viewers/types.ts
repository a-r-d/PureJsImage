export const viewerBenchmarkSchemaVersion = 1 as const

export type ViewerFamily =
  | 'ome-tiff-loaders'
  | 'ome-tiff-viewers'
  | 'volume-viewers'
  | 'cog-viewers'
export type ViewerPhase = 'cold' | 'warm'
export type ViewerStatus = 'supported' | 'unsupported' | 'invalid-output' | 'error'
export type ViewerImplementation = 'pure-javascript' | 'webassembly' | 'browser-native'
export type ViewerBrowser = 'chromium' | 'firefox' | 'webkit'
export type ViewerLatencyProfile = 0 | 5 | 25 | 100
export type ViewerCacheMode = 'no-store' | 'revalidate' | 'immutable'
export type ViewerBenchmarkProfile = 'smoke' | 'ome-tiff' | 'volumes' | 'cog'
export type ViewerReportScope = ViewerFamily | 'all'

export type ViewerEngineId =
  | 'geotiff-direct'
  | 'viv-loaders-ome-tiff'
  | 'viv-loaders-indexed-ome-tiff'
  | 'viv-full'
  | 'purejsimage-volume'
  | 'niivue'
  | 'cornerstone3d'
  | 'itk-wasm-volume'
  | 'purejsimage-cog'
  | 'geotiff-cog'
  | 'cogeotiff'
  | 'openseadragon'

export type ViewerWorkloadId =
  | 'metadata-ready'
  | 'first-native-tile'
  | 'selected-zct-plane'
  | 'random-tile-sequence'
  | 'fixed-multichannel-viewport'
  | 'channel-toggle'
  | 'z-change'
  | 't-change'
  | 'zoom-level-transition'
  | 'cold-viewport-render'
  | 'warm-viewport-render'
  | 'open-volume'
  | 'first-axial-slice'
  | 'first-sagittal-slice'
  | 'first-coronal-slice'
  | 'scroll-100-slices'
  | 'window-level-change'
  | 'overlay-switch'
  | 'metadata-ready-cog'
  | 'first-tile-cog'
  | 'viewport-1024-cog'
  | 'adjacent-pan-cog'
  | 'random-pan-cog'
  | 'overview-transition-cog'
  | 'cold-cache-cog'
  | 'warm-cache-cog'

export interface ViewerEngineMetadata {
  readonly id: ViewerEngineId
  readonly family: ViewerFamily
  readonly packageName: string
  readonly packageVersion: string
  readonly implementation: ViewerImplementation
  readonly gpuRendering: boolean
  readonly wasmRequired: boolean
  readonly nativeBrowserPrimitives: readonly string[]
  readonly inputModel: 'HTTP Range URL' | 'ArrayBuffer' | 'File'
  readonly preparedSidecar: boolean
  readonly sidecarNote?: string
}

export interface ViewerWorkloadMetadata {
  readonly id: ViewerWorkloadId
  readonly family: ViewerFamily
  readonly title: string
  readonly layer: 'loader-only' | 'minimal-viewer' | 'complete-interaction'
  readonly fixtureId: string
  readonly logicalSelection: string
  readonly representative: boolean
}

export interface ViewerStartupMetrics {
  readonly downloadedJavaScriptBytes: number
  readonly downloadedWasmBytes: number
  readonly importAndParseMilliseconds: number
  readonly initializationMilliseconds: number
  readonly workerCreationMilliseconds: number
  readonly webglInitializationMilliseconds: number
  readonly webgpuInitializationMilliseconds: number
}

export interface ViewerDataMetrics {
  readonly requests: number
  readonly returnedBytes: number
  readonly uniqueBytes: number
  readonly largestRequest: number
  readonly overfetchBytes: number
  readonly abortedRequests: number
  readonly cacheHitsObservable: number | null
}

export interface ViewerLatencyMetrics {
  readonly metadataReadyMilliseconds: number | null
  readonly firstDecodedTileMilliseconds: number | null
  readonly firstVisiblePixelsMilliseconds: number | null
  readonly stableCompletedViewportMilliseconds: number | null
  readonly completeInteractionMilliseconds: number | null
}

export interface ViewerRenderingMetrics {
  readonly frameTimesMilliseconds: readonly number[]
  readonly longTasks: number
  readonly droppedOrLateFrames: number
  readonly textureBytesAllocatedOrUploaded: number | null
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly framebufferHash: string | null
}

export interface ViewerMemoryMetrics {
  readonly jsHeapUsedBytes: number | null
  readonly workerHeapUsedBytes: number | null
  readonly domBytes: number | null
  readonly arrayBufferBytes: number | null
  readonly gpuBytesClaimed: number | null
  readonly note: string
}

export interface ViewerCorrectnessMetrics {
  readonly outputCanvasDimensions: readonly [number, number]
  readonly screenshotOrFramebufferHash: string | null
  readonly referenceHash: string | null
  readonly mismatchFraction: number | null
  readonly tolerance: number
  readonly logicalChannel: string
  readonly logicalZ: number
  readonly logicalT: number
  readonly logicalLevel: number
  readonly logicalRegion: readonly [number, number, number, number]
  readonly transferFunction: string
  readonly implicitChannelSumming: boolean
  readonly implicitFrameSumming: boolean
  readonly hiddenDtypeConversion: boolean
  readonly unsupportedCaseVisible: boolean
  readonly passed: boolean
}

export interface ViewerSidecarMetrics {
  readonly bytes: number
  readonly indexGenerationMilliseconds: number
  readonly indexGenerationOccurred: boolean
  readonly source: 'generated-before-timing' | 'precomputed' | 'not-applicable'
}

export interface ViewerBenchmarkSample {
  readonly browser: ViewerBrowser
  readonly phase: ViewerPhase
  readonly latencyProfileMilliseconds: ViewerLatencyProfile
  readonly engine: ViewerEngineMetadata
  readonly workload: ViewerWorkloadMetadata
  readonly status: ViewerStatus
  readonly statusReason: string | null
  readonly startup: ViewerStartupMetrics
  readonly data: ViewerDataMetrics
  readonly latency: ViewerLatencyMetrics
  readonly rendering: ViewerRenderingMetrics
  readonly memory: ViewerMemoryMetrics
  readonly correctness: ViewerCorrectnessMetrics | null
  readonly sidecar: ViewerSidecarMetrics
}

export interface ViewerBenchmarkReport {
  readonly schemaVersion: typeof viewerBenchmarkSchemaVersion
  readonly generatedAt: string
  readonly scope: ViewerReportScope
  readonly browser: ViewerBrowser
  readonly userAgent: string
  readonly phase: ViewerPhase
  readonly latencyProfileMilliseconds: ViewerLatencyProfile
  readonly cacheMode: ViewerCacheMode
  readonly throughputBytesPerSecond: number | null
  readonly coldDefinition: string
  readonly warmDefinition: string
  readonly notes: readonly string[]
  readonly engines: readonly ViewerEngineMetadata[]
  readonly workloads: readonly ViewerWorkloadMetadata[]
  readonly samples: readonly ViewerBenchmarkSample[]
}

export interface ViewerBenchmarkRunOptions {
  readonly phase: ViewerPhase
  readonly profile?: ViewerBenchmarkProfile
  readonly latencyProfileMilliseconds?: ViewerLatencyProfile
  readonly cacheMode?: ViewerCacheMode
  readonly throughputBytesPerSecond?: number | null
  readonly browser?: ViewerBrowser
}

export interface ViewerBenchmarkHarness {
  run(options: ViewerBenchmarkRunOptions): Promise<ViewerBenchmarkReport>
}

export interface ViewerServerRequestLog {
  readonly id: number
  readonly method: string
  readonly pathname: string
  readonly fixtureId: string | null
  readonly rangeStart: number | null
  readonly rangeEnd: number | null
  readonly requestedBytes: number
  readonly returnedBytes: number
  readonly cacheMode: ViewerCacheMode
  readonly latencyMilliseconds: number
  readonly throughputBytesPerSecond: number | null
  readonly aborted: boolean
}
