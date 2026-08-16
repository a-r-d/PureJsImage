import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

import { prepareScientificFixture } from './catalog.ts'
import { scientificCompetitorEngines, scientificCompetitorWorkloads } from './competitors.ts'
import type {
  ScientificCompetitorEngine,
  ScientificCompetitorReport,
  ScientificCompetitorResult,
  ScientificCompetitorRun,
  ScientificCompetitorStatus,
  ScientificCompetitorWorkload,
} from './competitor-types.ts'
import { measureScientificCompetitorFootprints } from '../competitors-js/footprint.ts'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = dirname(dirname(benchmarkDirectory))
const workerPath = join(repositoryDirectory, 'benchmark/competitors-js/worker.ts')
const artifactsDirectory = join(
  benchmarkDirectory,
  'results',
  'artifacts',
  'scientific-competitors',
)

const argument = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const profileArgument = argument('profile', 'smoke') ?? 'smoke'
if (profileArgument !== 'smoke' && profileArgument !== 'baseline') {
  throw new Error(`Unknown competitor profile ${profileArgument}`)
}
const profile = profileArgument
const runs = Number(argument('runs', profile === 'smoke' ? '1' : '3'))
const warmups = Number(argument('warmups', profile === 'smoke' ? '0' : '1'))
const timeoutMilliseconds = Number(argument('timeout-ms', '120000'))
const selectedEngineId = argument('engine')
const selectedWorkloadId = argument('workload')
const selectedFamily = argument('family')

if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')
if (!Number.isSafeInteger(warmups) || warmups < 0) throw new Error('--warmups must be non-negative')
if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
  throw new Error('--timeout-ms must be positive')
}

const engines = scientificCompetitorEngines.filter(
  (engine) => selectedEngineId === undefined || engine.id === selectedEngineId,
)
const workloads = scientificCompetitorWorkloads.filter(
  (workload) =>
    (selectedWorkloadId === undefined || workload.id === selectedWorkloadId) &&
    (selectedFamily === undefined || workload.family === selectedFamily) &&
    (profile === 'smoke' || workload.representative),
)
if (engines.length === 0)
  throw new Error(`No competitor engine matches ${selectedEngineId ?? 'the selection'}`)
if (workloads.length === 0)
  throw new Error(`No competitor workload matches ${selectedWorkloadId ?? 'the selection'}`)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isStatus = (value: unknown): value is ScientificCompetitorStatus =>
  value === 'supported' ||
  value === 'unsupported' ||
  value === 'invalid-output' ||
  value === 'error'

interface WorkerOutput {
  readonly status: ScientificCompetitorStatus
  readonly statusReason: string | null
  readonly fixtureId: string
  readonly fixtureSha256: string
  readonly fixtureSizeBytes: number
  readonly run: ScientificCompetitorRun
}

const isWorkerRun = (value: unknown): value is ScientificCompetitorRun => {
  if (!isRecord(value) || !isStatus(value.status)) return false
  if (!(value.statusReason === null || typeof value.statusReason === 'string')) return false
  if (!isRecord(value.stages) || !isRecord(value.source) || !isRecord(value.correctness))
    return false
  const stages = value.stages
  const source = value.source
  const correctness = value.correctness
  const numericStageFields = [
    'moduleImportMilliseconds',
    'wasmInitializationMilliseconds',
    'inputCopyMilliseconds',
    'inputBridgeMilliseconds',
    'openMilliseconds',
    'hierarchyMilliseconds',
    'readMilliseconds',
    'outputTransferMilliseconds',
    'closeAndCleanupMilliseconds',
    'totalWallMilliseconds',
  ]
  if (!numericStageFields.every((field) => isNumber(stages[field]))) return false
  if (stages.firstUsableDataMilliseconds !== null && !isNumber(stages.firstUsableDataMilliseconds))
    return false
  const numericMemoryFields = [
    'peakRssBytes',
    'baselineRssBytes',
    'peakHeapUsedBytes',
    'peakExternalBytes',
    'peakArrayBufferBytes',
  ]
  if (!numericMemoryFields.every((field) => isNumber(value[field]))) return false
  const numericSourceFields = [
    'requestCount',
    'requestedBytes',
    'returnedBytes',
    'uniqueBytesTouched',
    'requiredInputCopyBytes',
  ]
  if (!numericSourceFields.every((field) => isNumber(source[field]))) return false
  if (typeof source.completeInputRead !== 'boolean') return false
  if (
    source.sourceInstrumentation !== 'custom-range-source' &&
    source.sourceInstrumentation !== 'filesystem' &&
    source.sourceInstrumentation !== 'complete-buffer'
  )
    return false
  if (
    correctness.shape !== null &&
    (!Array.isArray(correctness.shape) || !correctness.shape.every(isNumber))
  )
    return false
  if (correctness.nativeSampleType !== null && typeof correctness.nativeSampleType !== 'string')
    return false
  if (correctness.sampleSha256 !== null && typeof correctness.sampleSha256 !== 'string')
    return false
  if (correctness.sampleCount !== null && !isNumber(correctness.sampleCount)) return false
  if (!isNumber(correctness.outputBytes) || !Array.isArray(correctness.details)) return false
  return true
}

const parseWorkerOutput = (value: unknown): WorkerOutput | null => {
  if (!isRecord(value) || !isStatus(value.status) || !isWorkerRun(value.run)) return null
  if (!(value.statusReason === null || typeof value.statusReason === 'string')) return null
  if (
    typeof value.fixtureId !== 'string' ||
    typeof value.fixtureSha256 !== 'string' ||
    !isNumber(value.fixtureSizeBytes)
  )
    return null
  return {
    status: value.status,
    statusReason: value.statusReason,
    fixtureId: value.fixtureId,
    fixtureSha256: value.fixtureSha256,
    fixtureSizeBytes: value.fixtureSizeBytes,
    run: value.run,
  }
}

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

const failedRun = (
  status: ScientificCompetitorStatus,
  reason: string,
): ScientificCompetitorRun => ({
  status,
  statusReason: reason,
  stages: {
    moduleImportMilliseconds: 0,
    wasmInitializationMilliseconds: 0,
    inputCopyMilliseconds: 0,
    inputBridgeMilliseconds: 0,
    openMilliseconds: 0,
    hierarchyMilliseconds: 0,
    readMilliseconds: 0,
    outputTransferMilliseconds: 0,
    closeAndCleanupMilliseconds: 0,
    firstUsableDataMilliseconds: null,
    totalWallMilliseconds: 0,
  },
  peakRssBytes: 0,
  baselineRssBytes: 0,
  peakHeapUsedBytes: 0,
  peakExternalBytes: 0,
  peakArrayBufferBytes: 0,
  source: {
    requestCount: 0,
    requestedBytes: 0,
    returnedBytes: 0,
    uniqueBytesTouched: 0,
    completeInputRead: false,
    requiredInputCopyBytes: 0,
    sourceInstrumentation: 'complete-buffer',
  },
  correctness: {
    shape: null,
    nativeSampleType: null,
    sampleSha256: null,
    sampleCount: null,
    outputBytes: 0,
    details: [],
  },
})

interface SpawnedWorker {
  readonly output: WorkerOutput | null
  readonly error: string | null
  readonly peakRssBytes: number
}

const runWorker = async (
  engine: ScientificCompetitorEngine,
  workload: ScientificCompetitorWorkload,
): Promise<SpawnedWorker> =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--expose-gc', workerPath, '--engine', engine.id, '--workload', workload.id],
      { cwd: repositoryDirectory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    )
    let stderr = ''
    let message: unknown = null
    let peakRssBytes = readRss(child.pid)
    let settled = false
    const poll = setInterval(() => {
      peakRssBytes = Math.max(peakRssBytes, readRss(child.pid))
    }, 10)
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      clearInterval(poll)
      resolve({
        output: null,
        error: `worker timed out after ${timeoutMilliseconds} ms`,
        peakRssBytes,
      })
    }, timeoutMilliseconds)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-4_000)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      resolve({ output: null, error: error.message, peakRssBytes })
    })
    child.on('message', (value: unknown) => {
      message = value
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(poll)
      const output =
        isRecord(message) && message.type === 'result' ? parseWorkerOutput(message.result) : null
      if (output !== null) {
        resolve({ output, error: null, peakRssBytes })
        return
      }
      resolve({
        output: null,
        error: `worker exited ${code ?? 'without a code'}${stderr.length > 0 ? `: ${stderr.trim()}` : ''}`,
        peakRssBytes,
      })
    })
  })

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

const fixtureSize = (fixture: Awaited<ReturnType<typeof prepareScientificFixture>>): number =>
  fixture.resources.reduce((total, resource) => total + resource.sizeBytes, 0)

const unsupportedResult = async (
  engine: ScientificCompetitorEngine,
  workload: ScientificCompetitorWorkload,
): Promise<ScientificCompetitorResult> => {
  const fixture = await prepareScientificFixture(workload.fixtureId)
  const reason =
    engine.unsupportedReasons[workload.id] ?? 'The engine does not claim this workload.'
  return {
    engine,
    workload,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      sizeBytes: fixtureSize(fixture),
      provenance: fixture.provenance,
      supportBoundary: fixture.supportBoundary,
      representative: fixture.representative,
    },
    profile,
    runs: 0,
    warmups: 0,
    status: 'unsupported',
    statusReason: reason,
    summary: {
      totalWallMilliseconds: null,
      firstUsableDataMilliseconds: null,
      peakRssBytes: null,
      sourceBytes: null,
      outputBytes: null,
    },
    runsDetail: [],
  }
}

const supportedResult = async (
  engine: ScientificCompetitorEngine,
  workload: ScientificCompetitorWorkload,
): Promise<ScientificCompetitorResult> => {
  const fixture = await prepareScientificFixture(workload.fixtureId)
  const measuredRuns: ScientificCompetitorRun[] = []
  for (let warmup = 0; warmup < warmups; warmup += 1) {
    const result = await runWorker(engine, workload)
    if (result.error !== null) console.warn(`Warmup ${engine.id}/${workload.id}: ${result.error}`)
  }
  for (let run = 0; run < runs; run += 1) {
    const result = await runWorker(engine, workload)
    if (result.output === null) {
      measuredRuns.push(failedRun('error', result.error ?? 'Worker returned no result'))
      continue
    }
    measuredRuns.push({
      ...result.output.run,
      peakRssBytes: Math.max(result.output.run.peakRssBytes, result.peakRssBytes),
    })
  }
  const status = measuredRuns.some(({ status }) => status === 'invalid-output')
    ? 'invalid-output'
    : measuredRuns.some(({ status }) => status === 'error')
      ? 'error'
      : measuredRuns.every(({ status }) => status === 'supported')
        ? 'supported'
        : 'unsupported'
  const successful = measuredRuns.filter(({ status }) => status === 'supported')
  return {
    engine,
    workload,
    fixture: {
      id: fixture.id,
      sha256: fixture.sha256,
      sizeBytes: fixtureSize(fixture),
      provenance: fixture.provenance,
      supportBoundary: fixture.supportBoundary,
      representative: fixture.representative,
    },
    profile,
    runs,
    warmups,
    status,
    statusReason:
      measuredRuns.find(({ statusReason }) => statusReason !== null)?.statusReason ?? null,
    summary: {
      totalWallMilliseconds: median(successful.map(({ stages }) => stages.totalWallMilliseconds)),
      firstUsableDataMilliseconds: median(
        successful
          .map(({ stages }) => stages.firstUsableDataMilliseconds)
          .filter((value): value is number => value !== null),
      ),
      peakRssBytes: median(successful.map(({ peakRssBytes }) => peakRssBytes)),
      sourceBytes: median(successful.map(({ source }) => source.returnedBytes)),
      outputBytes: median(successful.map(({ correctness }) => correctness.outputBytes)),
    },
    runsDetail: measuredRuns,
  }
}

const kilobytes = (bytes: number | null): string =>
  bytes === null ? '—' : `${(bytes / 1_024).toFixed(1)} KiB`
const milliseconds = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(2)} ms`

const renderTable = (results: readonly ScientificCompetitorResult[]): string => {
  const lines = [
    '| Family | Engine | Workload | Status | Wall | First data | Peak RSS | Source returned | Input copy | Output | Sample SHA-256 |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const result of results) {
    const successful = result.runsDetail.filter(({ status }) => status === 'supported')
    lines.push(
      `| ${result.workload.family} | ${result.engine.id} | ${result.workload.id} | ${result.status} | ${milliseconds(result.summary.totalWallMilliseconds)} | ${milliseconds(result.summary.firstUsableDataMilliseconds)} | ${kilobytes(result.summary.peakRssBytes)} | ${kilobytes(result.summary.sourceBytes)} | ${kilobytes(median(successful.map(({ source }) => source.requiredInputCopyBytes)))} | ${kilobytes(result.summary.outputBytes)} | ${successful[0]?.correctness.sampleSha256 ?? '—'} |`,
    )
  }
  return lines.join('\n')
}

const renderMarkdown = (report: ScientificCompetitorReport): string => {
  const lines = [
    '# Scientific JavaScript/WebAssembly competitor benchmark',
    '',
    `- Runtime: ${report.environment.runtime}`,
    `- Profile: ${report.profile}; runs=${report.configuration.runs}; warmups=${report.configuration.warmups}`,
    '- Fixture bytes and logical datasets are kept identical to the PureJsImage scientific-reader harness.',
    '- Validation is mandatory but outside the timed operation. Invalid output is a failed result; unsupported is a declared boundary.',
    '',
    '## Engine contracts',
    '',
    '| Engine | Version | Class | Environment | Input model | Lazy/selected | Complete input copy |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const engine of report.engines) {
    lines.push(
      `| ${engine.id} | ${engine.packageVersion} | ${engine.implementationClass} | ${engine.environment} | ${engine.inputModel} | ${engine.lazyOrSelectedReads ? 'yes' : 'no'} | ${engine.copiesCompleteInputBeforeOpen ? 'yes' : 'no'} |`,
    )
  }
  lines.push(
    '',
    '## Imported JavaScript, WASM, and installed footprint',
    '',
    '| Engine | Minified JS | gzip | Brotli | Installed | Production packages | WASM assets |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
  )
  for (const engine of report.engines) {
    const metric = report.bundle[engine.id]
    if (metric === undefined) continue
    lines.push(
      `| ${engine.id} | ${kilobytes(metric.importedJavaScriptBytes)} | ${kilobytes(metric.importedJavaScriptGzipBytes)} | ${kilobytes(metric.importedJavaScriptBrotliBytes)} | ${metric.installedBytes === null ? '—' : `${(metric.installedBytes / 1_048_576).toFixed(2)} MiB`} | ${metric.installedPackageCount ?? '—'} | ${metric.wasmAssets.map((asset) => `${asset.name} ${kilobytes(asset.rawBytes)}`).join('<br>') || 'none'} |`,
    )
  }
  lines.push('', '## Results', '', renderTable(report.results), '')
  return lines.join('\n')
}

const familyReports = (report: ScientificCompetitorReport): readonly [string, string][] => {
  const families = new Set(report.results.map(({ workload }) => workload.family))
  return [...families].map(
    (family) =>
      [
        family,
        `# ${family}\n\n${renderTable(report.results.filter(({ workload }) => workload.family === family))}\n`,
      ] as const,
  )
}

const main = async (): Promise<void> => {
  const results: ScientificCompetitorResult[] = []
  for (const engine of engines) {
    for (const workload of workloads) {
      if (!engine.supportedWorkloadIds.includes(workload.id)) {
        results.push(await unsupportedResult(engine, workload))
        continue
      }
      console.log(`Running ${engine.id}/${workload.id}`)
      results.push(await supportedResult(engine, workload))
    }
  }
  const bundle = await measureScientificCompetitorFootprints(engines, repositoryDirectory)
  const report: ScientificCompetitorReport = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    profile,
    environment: {
      runtime: 'Node',
      nodeVersion: process.version,
      platform: os.platform(),
      architecture: os.arch(),
    },
    configuration: {
      runs,
      warmups,
      isolatedProcessPerRun: true,
      outputValidationTimed: false,
      exactFixtureBytes: true,
    },
    engines,
    workloads,
    bundle,
    results,
  }
  await mkdir(artifactsDirectory, { recursive: true })
  await writeFile(
    join(artifactsDirectory, 'competitors-node.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await writeFile(join(artifactsDirectory, 'competitors-node.md'), `${renderMarkdown(report)}\n`)
  for (const [family, markdown] of familyReports(report)) {
    await writeFile(join(artifactsDirectory, `${family}.md`), markdown)
  }
  console.log(
    `Wrote ${results.length} competitor results to ${join(artifactsDirectory, 'competitors-node.md')}`,
  )
}

await main()
