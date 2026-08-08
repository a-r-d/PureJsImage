export type ImageFormat = 'bmp' | 'gif' | 'heic' | 'heif' | 'ico' | 'jpeg' | 'png' | 'tiff' | 'webp'
export type OutputFormat = 'bmp' | 'jpeg' | 'png' | 'tiff' | 'webp'
export type BenchmarkColor = '#ffffff' | 'transparent'
export type BenchmarkProfile =
  | 'bmp'
  | 'competitors'
  | 'full'
  | 'heif'
  | 'ico'
  | 'smoke'
  | 'standard'
  | 'tiff'
  | 'transforms'
  | 'webp'

export interface FixtureExpectation {
  format: ImageFormat
  width: number
  height: number
  sha256: string
  frames?: number
  orientation?: number
}

interface FixtureBase {
  id: string
  file: string
  expected: FixtureExpectation
}

export interface SourceFixture extends FixtureBase {
  url: string
  sourcePage: string
  author: string
  license: string
}

export type FixtureGenerator =
  | 'bmp-gradient'
  | 'ico-dib24'
  | 'ico-dib32'
  | 'ico-mixed'
  | 'odd-rgba'
  | 'rgba-gradient'
  | 'seeded-noise'
  | 'static-transparent-gif'
  | 'streaming-stress-gradient'
  | 'tiff-gradient'
  | 'tiny-transparent'
  | 'transparent-logo'

export interface GeneratedFixture extends FixtureBase {
  generator: FixtureGenerator
  profile?: 'stress'
}

export interface CorpusManifest {
  version: number
  sources: SourceFixture[]
  generated: GeneratedFixture[]
}

export type Fixture =
  | (SourceFixture & { origin: 'download' })
  | (GeneratedFixture & { origin: 'generated' })

export interface FixtureInspection {
  bytes: number
  format: string
  width: number
  height: number
  sha256: string
  frames?: number
  orientation?: number
}

export type Operation =
  | { type: 'metadata' }
  | { type: 'autoOrient' }
  | { type: 'rotate'; degrees: number }
  | { type: 'flip' }
  | { type: 'flop' }
  | { type: 'crop'; x: number; y: number; width: number; height: number }
  | {
      type: 'resize'
      width?: number
      height?: number
      withoutEnlargement?: boolean
    }
  | {
      type: 'contain'
      width: number
      height: number
      position?: 'center'
      background: BenchmarkColor
    }
  | {
      type: 'encode'
      format: OutputFormat
      quality?: number
      compressionLevel?: number
      lossless?: boolean
      background?: BenchmarkColor
    }

export interface PixelSampleExpectation {
  x: number
  y: number
  red?: number
  green?: number
  blue?: number
  alpha?: number
  tolerance?: number
}

export interface WorkflowExpectation {
  format: ImageFormat
  width?: number
  height?: number
  outputs?: number
  cornerAlpha?: number
  cornerRgbMinimum?: number
  pixelSamples?: readonly PixelSampleExpectation[]
}

interface WorkflowBase {
  id: string
  title: string
  tier: BenchmarkProfile
  expected: WorkflowExpectation
  defaultRuns?: number
  defaultWarmups?: number
  timeoutMs?: number
}

export interface PipelineWorkflow extends WorkflowBase {
  input: string
  operations: readonly Operation[]
  inputs?: never
  batch?: never
}

export interface BatchWorkflow extends WorkflowBase {
  inputs: readonly string[]
  batch: { count: number; width: number; quality: number }
  input?: never
  operations?: never
}

export type Workflow = PipelineWorkflow | BatchWorkflow

export interface ImageMetadata {
  format: string
  width: number
  height: number
}

export interface EngineExecution {
  output?: Uint8Array
  metadata?: ImageMetadata
  outputBytes?: number
  outputCount?: number
  batchSha256?: string
}

export type EngineKind = 'native' | 'native-single-thread' | 'pure-javascript'

export interface Engine {
  id: string
  version: string
  kind: EngineKind
  packageName: string
  unsupportedReason(
    workflow: Workflow,
    inputs: readonly Buffer[],
  ): Promise<string | undefined> | string | undefined
  execute(input: { workflow: Workflow; inputs: readonly Buffer[] }): Promise<EngineExecution>
}

export interface PixelCorner {
  red: number
  green: number
  blue: number
  alpha: number
}

export interface ValidatedOutput {
  format: string
  width: number
  height: number
  bytes: number
  sha256: string
  count?: number
  corner?: PixelCorner
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  outputBytes: number
  output?: ValidatedOutput
  metadata?: ImageMetadata
}

export interface EngineMetadata {
  id: string
  version: string
  kind: EngineKind
  packageName: string
}

interface WorkerFailure {
  status: 'error' | 'invalid-output' | 'unsupported'
  errors: string[]
}

export interface UnsupportedWorkerResult extends WorkerFailure {
  status: 'unsupported'
}

export interface ErrorWorkerResult extends WorkerFailure {
  status: 'error'
}

export interface InvalidOutputWorkerResult extends WorkerFailure {
  status: 'invalid-output'
}

export interface MeasuredWorkerResult {
  status: 'pass'
  errors: string[]
  output?: ValidatedOutput | ImageMetadata
  outputBytes: number
  wallMilliseconds: number
  cpuMilliseconds: number
  finalMemory: NodeJS.MemoryUsage
  resourceMaxRssBytes: number
}

export type WorkerResult =
  | ErrorWorkerResult
  | InvalidOutputWorkerResult
  | MeasuredWorkerResult
  | UnsupportedWorkerResult

export interface TimedSample extends MeasuredWorkerResult {
  engine?: EngineMetadata
  peakRssBytes: number
  peakRssDeltaBytes: number
  baselineMemory?: NodeJS.MemoryUsage
}

export interface FailedSample {
  status: 'error' | 'invalid-output' | 'unsupported'
  errors: string[]
}

export type BenchmarkSample = TimedSample | FailedSample

export interface BenchmarkSummary {
  status: 'error' | 'invalid-output' | 'pass' | 'unsupported'
  errors: string[]
  samples?: number
  successfulSamples?: number
  wallMilliseconds?: { median: number; p95: number; minimum: number; maximum: number }
  cpuMilliseconds?: { median: number }
  peakRssBytes?: { median: number; maximum: number }
  peakRssDeltaBytes?: { median: number; maximum: number }
  outputBytes?: { median: number }
  output?: ValidatedOutput | ImageMetadata
}

export interface StartupOperationResult {
  status: 'error' | 'invalid-output' | 'pass' | 'unsupported'
  wallMilliseconds?: number
  errors: string[]
}

export interface PackageFootprint {
  bytes: number
  packages: string[]
  productionPackageCount: number
}

export interface StartupResult {
  engine: EngineMetadata
  importMilliseconds: number
  rssAfterImportBytes: number
  firstMetadata: StartupOperationResult
  firstResize: StartupOperationResult
  footprint: PackageFootprint
}

export interface BenchmarkResult {
  engine: string
  workflow: string
  title: string
  runs: number
  warmups: number
  summary: BenchmarkSummary
  samples: BenchmarkSample[]
}

export interface BenchmarkEnvironment {
  platform: string
  osName: string
  osRelease: string
  architecture: string
  node: string
  cpu?: string
  logicalCpus: number
  totalMemoryBytes: number
  gitRevision: string
  dirty: boolean | null
}

export interface BenchmarkReport {
  schemaVersion: number
  createdAt: string
  profile: string
  sourceReports?: string[]
  configuration: Record<string, unknown>
  environment: BenchmarkEnvironment
  fixtures: string[]
  results: BenchmarkResult[]
  startup: StartupResult[]
}
