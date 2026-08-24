import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { prepareScientificFixture, scientificFixtureDefinitions } from './catalog.ts'
import { allScientificReaders, scientificEngine } from './registry.ts'
import type {
  CorrectnessSummary,
  MemorySummary,
  NumericSummary,
  PreparedFixture,
  PreparedFixtureSummary,
  ResourceSourceSummary,
  ScientificBenchmarkProfile,
  ScientificBenchmarkReport,
  ScientificBenchmarkResult,
  ScientificBenchmarkStatus,
  ScientificEnvironmentIdentity,
  ScientificRunResult,
  SourceSummary,
  TimingSummary,
} from './types.ts'
import { workloadsForScientificProfile } from './workloads.ts'
import {
  aggregateScientificStatus,
  scientificEnvironmentFingerprint,
  scientificFixtureFingerprint,
} from './integrity.ts'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = dirname(dirname(benchmarkDirectory))
const workerPath = join(benchmarkDirectory, 'worker.ts')
const artifactsDirectory =
  process.env.PUREJSIMAGE_BENCHMARK_OUTPUT_DIRECTORY ??
  join(benchmarkDirectory, 'results', 'artifacts', 'scientific-readers')

const argument = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const isScientificBenchmarkProfile = (value: string): value is ScientificBenchmarkProfile =>
  value === 'smoke' ||
  value === 'baseline' ||
  value === 'range' ||
  value === 'scaling' ||
  value === 'full'

const profileArgument = argument('profile', 'smoke') ?? 'smoke'
if (!isScientificBenchmarkProfile(profileArgument))
  throw new Error(`Unknown scientific profile ${profileArgument}`)
const profile = profileArgument
const selectedWorkloadId = argument('workload')
const runs = Number(argument('runs', profile === 'smoke' ? '1' : '3'))
const warmups = Number(argument('warmups', profile === 'smoke' ? '0' : '1'))
const fragmentBytes = Number(argument('fragment-bytes', '0'))
const timeoutMilliseconds = Number(argument('timeout-ms', '120000'))

if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
if (!Number.isSafeInteger(warmups) || warmups < 0)
  throw new Error('--warmups must be a non-negative integer')
if (!Number.isSafeInteger(fragmentBytes) || fragmentBytes < 0)
  throw new Error('--fragment-bytes must be a non-negative integer')
if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1)
  throw new Error('--timeout-ms must be a positive integer')

const workloads = workloadsForScientificProfile(profile).filter(
  (workload) => selectedWorkloadId === undefined || workload.id === selectedWorkloadId,
)
if (workloads.length === 0)
  throw new Error(`No scientific reader workload matches ${selectedWorkloadId ?? profile}`)

const sourceLatencies = profile === 'range' ? [0, 5, 25, 100] : [0]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readRss = (pid: number | undefined): number => {
  if (pid === undefined) return 0
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB$/mu.exec(status)
    return match === null ? 0 : Number(match[1]) * 1_024
  } catch {
    return 0
  }
}

const emptyCorrectness = (): ScientificRunResult['correctness'] => ({
  normalizedDescriptorSha256: null,
  selectedSampleSha256: null,
  selectedSampleCount: null,
  outputSampleType: null,
  outputComponentCount: null,
  blockCount: null,
  firstRepresentativeValue: null,
  lastRepresentativeValue: null,
  relevantCalibrationAssertions: Object.freeze([]),
  exactErrorClassification: null,
})

const failedRun = (status: ScientificBenchmarkStatus, reason: string): ScientificRunResult => ({
  status,
  statusReason: reason,
  processStartupMilliseconds: 0,
  workerLifetimeMilliseconds: 0,
  moduleImportMilliseconds: 0,
  registryConstructionMilliseconds: 0,
  timing: {
    detectionMilliseconds: 0,
    documentOpenMilliseconds: 0,
    datasetEnumerationMilliseconds: 0,
    datasetOpenMilliseconds: 0,
    timeToFirstEmittedBlockMilliseconds: null,
    completeSelectedOperationMilliseconds: 0,
    closeAndCleanupMilliseconds: 0,
    totalWallMilliseconds: 0,
    cpuUserMilliseconds: 0,
    cpuSystemMilliseconds: 0,
  },
  memory: {
    baselineRssBytes: 0,
    absolutePeakRssBytes: 0,
    peakHeapUsedBytes: 0,
    peakExternalBytes: 0,
    peakArrayBufferBytes: 0,
    outputBytes: 0,
    maximumEmittedBlockBytes: 0,
  },
  source: {
    readCalls: 0,
    requestedBytes: 0,
    returnedBytes: 0,
    uniqueSourceBytesTouched: 0,
    largestIndividualReadBytes: 0,
    overfetchRatio: null,
    companionResolutionCount: 0,
    perResource: Object.freeze([]),
    completePrimarySourceRead: false,
    payloadBytesReadDuringDetection: null,
    payloadBytesReadDuringMetadataOnlyOpen: null,
  },
  correctness: emptyCorrectness(),
})

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isRunTiming = (value: unknown): boolean =>
  isRecord(value) &&
  isFiniteNumber(value.detectionMilliseconds) &&
  isFiniteNumber(value.documentOpenMilliseconds) &&
  isFiniteNumber(value.datasetEnumerationMilliseconds) &&
  isFiniteNumber(value.datasetOpenMilliseconds) &&
  (value.timeToFirstEmittedBlockMilliseconds === null ||
    isFiniteNumber(value.timeToFirstEmittedBlockMilliseconds)) &&
  isFiniteNumber(value.completeSelectedOperationMilliseconds) &&
  isFiniteNumber(value.closeAndCleanupMilliseconds) &&
  isFiniteNumber(value.totalWallMilliseconds) &&
  isFiniteNumber(value.cpuUserMilliseconds) &&
  isFiniteNumber(value.cpuSystemMilliseconds)

const isRunMemory = (value: unknown): boolean =>
  isRecord(value) &&
  isFiniteNumber(value.baselineRssBytes) &&
  isFiniteNumber(value.absolutePeakRssBytes) &&
  isFiniteNumber(value.peakHeapUsedBytes) &&
  isFiniteNumber(value.peakExternalBytes) &&
  isFiniteNumber(value.peakArrayBufferBytes) &&
  isFiniteNumber(value.outputBytes) &&
  isFiniteNumber(value.maximumEmittedBlockBytes)

const isScientificRunResult = (value: unknown): value is ScientificRunResult =>
  isRecord(value) &&
  (value.status === 'supported' ||
    value.status === 'unsupported' ||
    value.status === 'invalid-output' ||
    value.status === 'error') &&
  (value.statusReason === null || typeof value.statusReason === 'string') &&
  isFiniteNumber(value.processStartupMilliseconds) &&
  isFiniteNumber(value.workerLifetimeMilliseconds) &&
  isFiniteNumber(value.moduleImportMilliseconds) &&
  isFiniteNumber(value.registryConstructionMilliseconds) &&
  isRunTiming(value.timing) &&
  isRunMemory(value.memory) &&
  isRecord(value.source) &&
  isFiniteNumber(value.source.readCalls) &&
  isFiniteNumber(value.source.requestedBytes) &&
  isFiniteNumber(value.source.returnedBytes) &&
  isFiniteNumber(value.source.uniqueSourceBytesTouched) &&
  isFiniteNumber(value.source.largestIndividualReadBytes) &&
  (value.source.overfetchRatio === null || isFiniteNumber(value.source.overfetchRatio)) &&
  isFiniteNumber(value.source.companionResolutionCount) &&
  Array.isArray(value.source.perResource) &&
  typeof value.source.completePrimarySourceRead === 'boolean' &&
  (value.source.payloadBytesReadDuringDetection === null ||
    isFiniteNumber(value.source.payloadBytesReadDuringDetection)) &&
  (value.source.payloadBytesReadDuringMetadataOnlyOpen === null ||
    isFiniteNumber(value.source.payloadBytesReadDuringMetadataOnlyOpen)) &&
  isRecord(value.correctness)

const numericSummary = (values: readonly number[]): NumericSummary | null => {
  const finite = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
  if (finite.length === 0) return null
  const percentile = (fraction: number): number =>
    finite[Math.min(finite.length - 1, Math.ceil(fraction * finite.length) - 1)] ?? 0
  return Object.freeze({
    median: percentile(0.5),
    p95: percentile(0.95),
    minimum: finite[0] ?? 0,
    maximum: finite[finite.length - 1] ?? 0,
  })
}

const coefficientOfVariationPercent = (values: readonly number[]): number | null => {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (mean === 0) return null
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return (Math.sqrt(variance) / Math.abs(mean)) * 100
}

const booleanAll = (values: readonly boolean[]): boolean | null =>
  values.length === 0 ? null : values.every(Boolean)

const sumSummary = (
  results: readonly ScientificRunResult[],
  selector: (result: ScientificRunResult) => number,
): NumericSummary | null => numericSummary(results.map(selector))

const supportedRuns = (
  runsToSummarize: readonly ScientificRunResult[],
): readonly ScientificRunResult[] =>
  Object.freeze(runsToSummarize.filter((result) => result.status === 'supported'))

const aggregateTiming = (runsToSummarize: readonly ScientificRunResult[]): TimingSummary => {
  const supported = supportedRuns(runsToSummarize)
  return Object.freeze({
    processStartupMilliseconds: numericSummary(
      runsToSummarize.map((result) => result.processStartupMilliseconds),
    ),
    workerLifetimeMilliseconds: numericSummary(
      runsToSummarize.map((result) => result.workerLifetimeMilliseconds),
    ),
    moduleImportMilliseconds: numericSummary(
      runsToSummarize.map((result) => result.moduleImportMilliseconds),
    ),
    registryConstructionMilliseconds: numericSummary(
      runsToSummarize.map((result) => result.registryConstructionMilliseconds),
    ),
    detectionMilliseconds: sumSummary(supported, (result) => result.timing.detectionMilliseconds),
    documentOpenMilliseconds: sumSummary(
      supported,
      (result) => result.timing.documentOpenMilliseconds,
    ),
    datasetEnumerationMilliseconds: sumSummary(
      supported,
      (result) => result.timing.datasetEnumerationMilliseconds,
    ),
    datasetOpenMilliseconds: sumSummary(
      supported,
      (result) => result.timing.datasetOpenMilliseconds,
    ),
    timeToFirstEmittedBlockMilliseconds: numericSummary(
      supported
        .map((result) => result.timing.timeToFirstEmittedBlockMilliseconds)
        .filter((value): value is number => value !== null),
    ),
    completeSelectedOperationMilliseconds: sumSummary(
      supported,
      (result) => result.timing.completeSelectedOperationMilliseconds,
    ),
    closeAndCleanupMilliseconds: sumSummary(
      supported,
      (result) => result.timing.closeAndCleanupMilliseconds,
    ),
    totalWallMilliseconds: sumSummary(supported, (result) => result.timing.totalWallMilliseconds),
    cpuUserMilliseconds: sumSummary(supported, (result) => result.timing.cpuUserMilliseconds),
    cpuSystemMilliseconds: sumSummary(supported, (result) => result.timing.cpuSystemMilliseconds),
  })
}

const aggregateMemory = (runsToSummarize: readonly ScientificRunResult[]): MemorySummary => {
  const supported = supportedRuns(runsToSummarize)
  return Object.freeze({
    baselineRssBytes: sumSummary(supported, (result) => result.memory.baselineRssBytes),
    absolutePeakRssBytes: sumSummary(supported, (result) => result.memory.absolutePeakRssBytes),
    peakHeapUsedBytes: sumSummary(supported, (result) => result.memory.peakHeapUsedBytes),
    peakExternalBytes: sumSummary(supported, (result) => result.memory.peakExternalBytes),
    peakArrayBufferBytes: sumSummary(supported, (result) => result.memory.peakArrayBufferBytes),
    outputBytes: sumSummary(supported, (result) => result.memory.outputBytes),
    maximumEmittedBlockBytes: sumSummary(
      supported,
      (result) => result.memory.maximumEmittedBlockBytes,
    ),
  })
}

const aggregateResource = (
  resourceId: string,
  entries: readonly NonNullable<ScientificRunResult['source']['perResource'][number]>[],
): ResourceSourceSummary => {
  const first = entries[0]
  if (first === undefined) throw new Error(`Resource ${resourceId} has no measured entries`)
  return Object.freeze({
    resourceId,
    name: first.name,
    sizeBytes: first.sizeBytes,
    readCalls: numericSummary(entries.map((entry) => entry.readCalls)) ?? {
      median: 0,
      p95: 0,
      minimum: 0,
      maximum: 0,
    },
    requestedBytes: numericSummary(entries.map((entry) => entry.requestedBytes)) ?? {
      median: 0,
      p95: 0,
      minimum: 0,
      maximum: 0,
    },
    returnedBytes: numericSummary(entries.map((entry) => entry.returnedBytes)) ?? {
      median: 0,
      p95: 0,
      minimum: 0,
      maximum: 0,
    },
    uniqueSourceBytesTouched: numericSummary(
      entries.map((entry) => entry.uniqueSourceBytesTouched),
    ) ?? { median: 0, p95: 0, minimum: 0, maximum: 0 },
    largestIndividualReadBytes: numericSummary(
      entries.map((entry) => entry.largestIndividualReadBytes),
    ) ?? { median: 0, p95: 0, minimum: 0, maximum: 0 },
    overfetchRatio: numericSummary(
      entries
        .map((entry) => entry.overfetchRatio)
        .filter((value): value is number => value !== null),
    ),
    payloadBytesRead: numericSummary(entries.map((entry) => entry.payloadBytesRead)) ?? {
      median: 0,
      p95: 0,
      minimum: 0,
      maximum: 0,
    },
    completeSourceRead: entries.every((entry) => entry.completeSourceRead),
  })
}

const aggregateSource = (runsToSummarize: readonly ScientificRunResult[]): SourceSummary => {
  const supported = supportedRuns(runsToSummarize)
  const resourceEntries = new Map<
    string,
    NonNullable<ScientificRunResult['source']['perResource'][number]>[]
  >()
  for (const result of supported) {
    for (const entry of result.source.perResource) {
      const values = resourceEntries.get(entry.resourceId) ?? []
      values.push(entry)
      resourceEntries.set(entry.resourceId, values)
    }
  }
  const resources = [...resourceEntries.entries()].map(([id, entries]) =>
    aggregateResource(id, entries),
  )
  return Object.freeze({
    readCalls: sumSummary(supported, (result) => result.source.readCalls),
    requestedBytes: sumSummary(supported, (result) => result.source.requestedBytes),
    returnedBytes: sumSummary(supported, (result) => result.source.returnedBytes),
    uniqueSourceBytesTouched: sumSummary(
      supported,
      (result) => result.source.uniqueSourceBytesTouched,
    ),
    largestIndividualReadBytes: sumSummary(
      supported,
      (result) => result.source.largestIndividualReadBytes,
    ),
    overfetchRatio: numericSummary(
      supported
        .map((result) => result.source.overfetchRatio)
        .filter((value): value is number => value !== null),
    ),
    companionResolutionCount: sumSummary(
      supported,
      (result) => result.source.companionResolutionCount,
    ),
    perResource: Object.freeze(resources),
    completePrimarySourceRead: booleanAll(
      supported.map((result) => result.source.completePrimarySourceRead),
    ),
    payloadBytesReadDuringDetection:
      numericSummary(
        supported
          .map((result) => result.source.payloadBytesReadDuringDetection)
          .filter((value): value is number => value !== null),
      )?.median ?? null,
    payloadBytesReadDuringMetadataOnlyOpen:
      numericSummary(
        supported
          .map((result) => result.source.payloadBytesReadDuringMetadataOnlyOpen)
          .filter((value): value is number => value !== null),
      )?.median ?? null,
  })
}

const aggregateCorrectness = (
  runsToSummarize: readonly ScientificRunResult[],
): CorrectnessSummary => {
  const result = supportedRuns(runsToSummarize)[0] ?? runsToSummarize[0]
  if (result === undefined) {
    return {
      normalizedDescriptorSha256: null,
      selectedSampleSha256: null,
      selectedSampleCount: null,
      outputSampleType: null,
      outputComponentCount: null,
      blockCount: null,
      firstRepresentativeValue: null,
      lastRepresentativeValue: null,
      relevantCalibrationAssertions: Object.freeze([]),
      exactErrorClassification: null,
    }
  }
  return Object.freeze(result.correctness)
}

const gitCommit = (): string | null => {
  const override = process.env.PUREJSIMAGE_BENCHMARK_GIT_COMMIT
  if (override !== undefined && /^[0-9a-f]{40}$/u.test(override)) return override
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryDirectory,
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

const gitDirty = (): boolean | null => {
  const override = process.env.PUREJSIMAGE_BENCHMARK_GIT_DIRTY
  if (override === 'true') return true
  if (override === 'false') return false
  try {
    return (
      execFileSync('git', ['status', '--porcelain'], {
        cwd: repositoryDirectory,
        encoding: 'utf8',
      }).trim().length > 0
    )
  } catch {
    return null
  }
}

const environment = (): ScientificEnvironmentIdentity & {
  readonly platform: string
  readonly runnerClass: 'github-hosted' | 'local' | 'self-hosted'
} => {
  return Object.freeze({
    operatingSystem: os.type(),
    operatingSystemVersion: os.release(),
    architecture: process.arch,
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    cpuModel: os.cpus()[0]?.model ?? null,
    logicalCpuCount: os.cpus().length,
    platform: process.platform,
    runnerClass:
      process.env.GITHUB_ACTIONS !== 'true'
        ? 'local'
        : process.env.RUNNER_ENVIRONMENT === 'self-hosted'
          ? 'self-hosted'
          : 'github-hosted',
  })
}

const parseManifestReaderIds = (): readonly string[] => {
  const value: unknown = JSON.parse(
    readFileSync(join(repositoryDirectory, 'capabilities', 'manifest.json'), 'utf8'),
  )
  if (!isRecord(value) || !Array.isArray(value.scientificReaders))
    throw new Error('Capability manifest scientificReaders inventory is invalid')
  const ids: string[] = []
  for (const entry of value.scientificReaders) {
    if (!isRecord(entry) || typeof entry.id !== 'string')
      throw new Error('Capability manifest reader id is invalid')
    ids.push(entry.id)
  }
  return Object.freeze(ids)
}

const verifyInventory = (): void => {
  const manifestIds = new Set(parseManifestReaderIds())
  const registryIds = new Set(allScientificReaders.map((reader) => reader.descriptor.id))
  if (
    manifestIds.size !== registryIds.size ||
    [...manifestIds].some((id) => !registryIds.has(id))
  ) {
    throw new Error('Scientific benchmark registry does not match capabilities/manifest.json')
  }
  const workloadIds = new Set(scientificFixtureDefinitions.map((fixture) => fixture.id))
  for (const workload of workloads) {
    if (!workloadIds.has(workload.fixtureId))
      throw new Error(`Workload ${workload.id} references unknown fixture ${workload.fixtureId}`)
    if (!manifestIds.has(workload.readerId))
      throw new Error(`Workload ${workload.id} references unknown reader ${workload.readerId}`)
  }
}

const runProcess = async (
  fixture: PreparedFixture,
  workload: (typeof workloads)[number],
  latency: number,
): Promise<ScientificRunResult> =>
  new Promise((resolve) => {
    const processStartedAt = performance.now()
    const child = spawn(process.execPath, ['--expose-gc', workerPath], {
      cwd: repositoryDirectory,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let peakRss = 0
    let moduleImportMilliseconds = 0
    let registryConstructionMilliseconds = 0
    let processStartupMilliseconds = 0
    let ready = false
    let result: ScientificRunResult | undefined
    let stderr = ''
    let settled = false
    const finish = (value: ScientificRunResult): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    const sampler = setInterval(() => {
      if (ready) peakRss = Math.max(peakRss, readRss(child.pid))
    }, 2)
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(failedRun('error', `Scientific worker timed out after ${timeoutMilliseconds}ms`))
    }, timeoutMilliseconds)
    child.on('message', (message: unknown) => {
      if (!isRecord(message) || typeof message.type !== 'string') return
      if (
        message.type === 'initialized' &&
        typeof message.moduleImportMilliseconds === 'number' &&
        typeof message.registryConstructionMilliseconds === 'number'
      ) {
        processStartupMilliseconds = performance.now() - processStartedAt
        moduleImportMilliseconds = message.moduleImportMilliseconds
        registryConstructionMilliseconds = message.registryConstructionMilliseconds
        child.send({
          type: 'prepare',
          configuration: {
            workload,
            fixture,
            sourceLatencyMilliseconds: latency,
            fragmentBytes,
            warmups,
          },
        })
      } else if (
        message.type === 'ready' &&
        isRecord(message.baselineMemory) &&
        typeof message.baselineMemory.rss === 'number'
      ) {
        ready = true
        peakRss = Math.max(peakRss, readRss(child.pid), message.baselineMemory.rss)
        child.send({ type: 'run' })
      } else if (message.type === 'measurement-complete' && isScientificRunResult(message.result)) {
        result = message.result
        ready = false
        child.send({ type: 'measurement-acknowledged' })
      }
    })
    child.on('error', (error: Error) => finish(failedRun('error', error.message)))
    child.on('exit', () => {
      clearInterval(sampler)
      clearTimeout(timeout)
      if (result !== undefined) {
        finish({
          ...result,
          processStartupMilliseconds,
          workerLifetimeMilliseconds: performance.now() - processStartedAt,
          moduleImportMilliseconds,
          registryConstructionMilliseconds,
          memory: {
            ...result.memory,
            absolutePeakRssBytes: Math.max(result.memory.absolutePeakRssBytes, peakRss),
          },
        })
      } else {
        finish(failedRun('error', stderr.trim() || 'Scientific worker exited without a result'))
      }
    })
  })

const fixtureSummary = (fixture: PreparedFixture): PreparedFixtureSummary =>
  Object.freeze({
    id: fixture.id,
    sha256: fixture.sha256,
    resources: Object.freeze(
      fixture.resources.map((resource) =>
        Object.freeze({
          id: resource.id,
          name: resource.name,
          sha256: resource.sha256,
          sizeBytes: resource.sizeBytes,
          payloadRanges: fixture.payloadRanges[resource.id] ?? Object.freeze([]),
          representative: fixture.representative,
        }),
      ),
    ),
    provenance: fixture.provenance,
    supportBoundary: fixture.supportBoundary,
    expectedOracle: fixture.expectedOracle,
    representative: fixture.representative,
  })

const resultFor = (
  fixture: PreparedFixture,
  workload: (typeof workloads)[number],
  latency: number,
  runResults: readonly ScientificRunResult[],
  environmentIdentity: ReturnType<typeof environment>,
): ScientificBenchmarkResult => {
  const status = aggregateScientificStatus(runResults)
  const measurementClass =
    fixture.representative && workload.measurementClass === 'representative'
      ? 'representative'
      : 'correctness-only'
  const supported = supportedRuns(runResults)
  const correctnessKeys = supported.map((result) => JSON.stringify(result.correctness))
  const correctnessStable =
    supported.length === runResults.length && new Set(correctnessKeys).size === 1
  const firstBlockCvPercent = coefficientOfVariationPercent(
    supported
      .map((result) => result.timing.timeToFirstEmittedBlockMilliseconds)
      .filter((value): value is number => value !== null),
  )
  const selectedOperationCvPercent = coefficientOfVariationPercent(
    supported.map((result) => result.timing.completeSelectedOperationMilliseconds),
  )
  const absolutePeakRssCvPercent = coefficientOfVariationPercent(
    supported.map((result) => result.memory.absolutePeakRssBytes),
  )
  const sourceBytesCvPercent = coefficientOfVariationPercent(
    supported.map((result) => result.source.returnedBytes),
  )
  const variations = [
    firstBlockCvPercent,
    selectedOperationCvPercent,
    absolutePeakRssCvPercent,
    sourceBytesCvPercent,
  ].filter((value): value is number => value !== null)
  const lowNoise = runResults.length >= 3 && variations.every((value) => value < 10)
  const eligibleForDocumentationHeadlines =
    profile === 'scaling' &&
    measurementClass === 'representative' &&
    status.status === 'supported' &&
    correctnessStable &&
    lowNoise
  return Object.freeze({
    identity: Object.freeze({
      schemaVersion: 2,
      workloadId: workload.id,
      fixtureId: fixture.id,
      fixtureSha256: fixture.sha256,
      reader: Object.freeze({ id: workload.readerId, version: '1.0.0' }),
      engine: scientificEngine,
      gitCommit: gitCommit() ?? 'unknown',
      gitDirty: gitDirty(),
      environment: environmentIdentity,
      profile,
      runs: runResults.length,
      warmups,
      sourceLatencyMilliseconds: latency,
      operation: workload.operation ?? 'selected',
    }),
    measurementClass,
    fixture: Object.freeze({
      provenance: fixture.provenance,
      supportBoundary: fixture.supportBoundary,
      expectedOracle: fixture.expectedOracle,
      representative: fixture.representative,
    }),
    status: status.status,
    statusReason: status.reason,
    timing: aggregateTiming(runResults),
    memory: aggregateMemory(runResults),
    source: aggregateSource(runResults),
    correctness: aggregateCorrectness(runResults),
    stability: Object.freeze({
      measuredRuns: runResults.length,
      correctnessStable,
      firstBlockCvPercent,
      selectedOperationCvPercent,
      absolutePeakRssCvPercent,
      sourceBytesCvPercent,
      lowNoise,
      eligibleForDocumentationHeadlines,
    }),
    runs: Object.freeze(runResults),
  })
}

const bytes = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value.toLocaleString('en-US')
const milliseconds = (value: NumericSummary | null): string =>
  value === null ? '—' : value.median.toFixed(2)
const ratio = (value: NumericSummary | null): string =>
  value === null ? '—' : value.median.toFixed(2)

const renderMarkdown = (report: ScientificBenchmarkReport): string => {
  const supported = report.results.filter((result) => result.status === 'supported')
  const rows = report.results
    .map(
      (result) =>
        `| ${result.identity.workloadId} | ${result.identity.reader.id} | ${result.status} | ${result.measurementClass} | ${result.stability.lowNoise ? 'yes' : 'no'} | ${milliseconds(result.timing.totalWallMilliseconds)} | ${milliseconds(result.timing.timeToFirstEmittedBlockMilliseconds)} | ${bytes(result.memory.absolutePeakRssBytes?.median)} | ${bytes(result.source.readCalls?.median)} | ${ratio(result.source.overfetchRatio)} |`,
    )
    .join('\n')
  const largestRead = supported
    .flatMap((result) =>
      result.source.perResource.map((resource) => ({
        workload: result.identity.workloadId,
        name: resource.name,
        bytes: resource.largestIndividualReadBytes.median,
      })),
    )
    .sort((left, right) => right.bytes - left.bytes)[0]
  const largestBlock = supported
    .map((result) => ({
      workload: result.identity.workloadId,
      bytes: result.memory.maximumEmittedBlockBytes?.median ?? 0,
    }))
    .sort((left, right) => right.bytes - left.bytes)[0]
  return `# Scientific reader benchmark (${report.profile})\n\nCreated ${report.createdAt}. Fixture preparation and output validation were excluded from timed operations. Only representative rows with at least three measured runs, stable correctness, and less than 10% coefficient of variation are eligible for publication.\n\n## Status\n\n| Workload | Reader | Status | Measurement class | Low noise | Total wall ms | First block ms | Peak RSS bytes | Read calls | Overfetch |\n| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n## Coverage\n\n- Workloads: ${report.results.length}\n- Supported results: ${supported.length}\n- Representative results: ${report.results.filter((result) => result.measurementClass === 'representative').length}\n- Headline-eligible results: ${report.results.filter((result) => result.stability.eligibleForDocumentationHeadlines).length}\n- Correctness-only results: ${report.results.filter((result) => result.measurementClass === 'correctness-only').length}\n- Direct-range workload results: ${report.results.filter((result) => result.identity.sourceLatencyMilliseconds > 0 || result.identity.reader.id === 'purejsimage/aperio-svs').length}\n- Corpus resources were not copied into the repository; generated fallbacks are written under the ignored benchmark artifact directory.\n\n## Handoff highlights\n\n- Highest median individual source read: ${largestRead === undefined ? 'none' : `${largestRead.workload} ${largestRead.bytes} bytes`}\n- Largest median emitted block: ${largestBlock === undefined ? 'none' : `${largestBlock.workload} ${largestBlock.bytes} bytes`}\n- The source table in JSON contains per-resource requested, returned, unique-touched, and completeness evidence.\n\n## Fixture boundaries\n\n${report.fixturePreparation.fixtures.map((fixture) => `- **${fixture.id}** (${fixture.representative ? 'representative' : 'correctness-only'}): ${fixture.supportBoundary} Provenance: ${fixture.provenance} Oracle: ${fixture.expectedOracle}`).join('\n')}\n`
}

verifyInventory()
const environmentIdentity = environment()
const preparedFixtures = new Map<string, PreparedFixture>()
for (const workload of workloads) {
  if (!preparedFixtures.has(workload.fixtureId))
    preparedFixtures.set(workload.fixtureId, await prepareScientificFixture(workload.fixtureId))
}

const results: ScientificBenchmarkResult[] = []
for (const workload of workloads) {
  const fixture = preparedFixtures.get(workload.fixtureId)
  if (fixture === undefined)
    throw new Error(`Prepared fixture ${workload.fixtureId} is unavailable`)
  for (const latency of sourceLatencies) {
    const runResults: ScientificRunResult[] = []
    for (let run = 0; run < runs; run += 1) {
      const result = await runProcess(fixture, workload, latency)
      runResults.push(result)
    }
    results.push(
      resultFor(fixture, workload, latency, Object.freeze(runResults), environmentIdentity),
    )
  }
}

const fixturePreparation = Object.freeze({
  fixtures: Object.freeze([...preparedFixtures.values()].map(fixtureSummary)),
})
const fingerprintConfiguration = Object.freeze({
  profile,
  runs,
  warmups,
  fragmentBytes,
  sourceLatencies: Object.freeze(sourceLatencies),
  isolatedProcessPerRun: true,
})
const environmentWithFingerprint = Object.freeze({
  ...environmentIdentity,
  environmentFingerprint: scientificEnvironmentFingerprint(
    environmentIdentity,
    fingerprintConfiguration,
  ),
})
const validationPassed = results.every(
  (result) => result.status === 'supported' || result.status === 'unsupported',
)
const performanceHeadlineEligible = results.some(
  (result) => result.stability.eligibleForDocumentationHeadlines,
)
const report: ScientificBenchmarkReport = Object.freeze({
  schemaVersion: 2,
  createdAt: new Date().toISOString(),
  profile,
  validation: Object.freeze({
    passed: validationPassed,
  }),
  eligibleForDocumentation: validationPassed,
  eligibleForPerformanceHeadline: performanceHeadlineEligible,
  eligibleForDocumentationHeadlines: validationPassed,
  configuration: Object.freeze({
    engine: scientificEngine,
    runs,
    warmups,
    fragmentBytes,
    sourceLatencies: Object.freeze(sourceLatencies),
    isolatedProcessPerRun: true,
    fixturePreparationTimed: false,
    outputValidationTimed: false,
    directRangeReadersOnly: profile === 'range',
  }),
  environment: environmentWithFingerprint,
  revision: Object.freeze({
    gitCommit: gitCommit() ?? 'unknown',
    gitDirty: gitDirty(),
  }),
  fixtureManifestHash: scientificFixtureFingerprint(fixturePreparation.fixtures),
  fixturePreparation,
  results: Object.freeze(results),
})

await mkdir(artifactsDirectory, { recursive: true })
const stamp = report.createdAt.replaceAll(':', '').replaceAll('.', '')
const jsonPath = join(artifactsDirectory, `${stamp}-${profile}.json`)
const markdownPath = join(artifactsDirectory, `${stamp}-${profile}.md`)
const latestPath = join(artifactsDirectory, 'latest.json')
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(markdownPath, renderMarkdown(report))
await writeFile(
  latestPath,
  `${JSON.stringify(
    {
      schemaVersion: 2,
      profile,
      createdAt: report.createdAt,
      json: jsonPath,
      markdown: markdownPath,
    },
    null,
    2,
  )}\n`,
)

const supportedCount = results.filter((result) => result.status === 'supported').length
const failedCount = results.length - supportedCount
console.log(
  `Scientific readers ${profile}: ${results.length} workload results; ${supportedCount} supported; ${failedCount} unsupported/invalid/error.`,
)
console.log(`JSON: ${jsonPath}`)
console.log(`Markdown: ${markdownPath}`)
console.log(`Latest index: ${latestPath}`)
