import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allFixtures, inspectFixture, readManifest, verifyInspection } from './lib/corpus.ts'
import { measurePackageFootprint } from './lib/package-footprint.ts'
import { isSuccessfulSample, summarizeSamples } from './lib/results.ts'
import type {
  BenchmarkReport,
  BenchmarkResult,
  BenchmarkSample,
  EngineMetadata,
  StartupOperationResult,
  StartupResult,
  WorkerResult,
  Workflow,
} from './types.ts'
import { workflowsForProfile } from './workflows.ts'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = dirname(benchmarkDirectory)
const resultsDirectory = join(benchmarkDirectory, 'results')
const workerPath = join(benchmarkDirectory, 'worker.ts')
const startupWorkerPath = join(benchmarkDirectory, 'startup-worker.ts')
const engineIds = new Set([
  'image-js',
  'jimp',
  'jsquash',
  'purejsimage',
  'purejsimage-wasm',
  'purejsimage-experimental-heic',
  'sharp',
  'sharp-single-thread',
])

function argument(name: string): string | undefined
function argument(name: string, fallback: string): string
function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

const options = {
  profile: argument('profile', 'standard'),
  engines: argument('engines', 'jimp').split(','),
  runs: Number(argument('runs', '3')),
  warmups: Number(argument('warmups', '1')),
  workflow: argument('workflow'),
  output: argument('output'),
}

if (!Number.isInteger(options.runs) || options.runs < 1) {
  throw new Error('--runs must be a positive integer')
}
if (!Number.isInteger(options.warmups) || options.warmups < 0) {
  throw new Error('--warmups must be a non-negative integer')
}
if (new Set(options.engines).size !== options.engines.length) {
  throw new Error('--engines must not contain duplicates')
}
for (const engine of options.engines) {
  if (!engineIds.has(engine)) throw new Error(`Unknown benchmark engine: ${engine}`)
}

let selectedWorkflows = [...workflowsForProfile(options.profile)]
if (options.workflow) {
  selectedWorkflows = selectedWorkflows.filter((workflow) => workflow.id === options.workflow)
  if (selectedWorkflows.length === 0) {
    throw new Error(`Workflow ${options.workflow} is not in profile ${options.profile}`)
  }
}

const manifest = await readManifest()
const fixturesById = new Map(allFixtures(manifest).map((fixture) => [fixture.id, fixture]))
const requiredFixtureIds = new Set(
  selectedWorkflows.flatMap((workflow) => (workflow.batch ? workflow.inputs : [workflow.input])),
)

for (const id of requiredFixtureIds) {
  const fixture = fixturesById.get(id)
  if (!fixture) throw new Error(`Unknown fixture: ${id}`)
  const errors = verifyInspection(fixture, await inspectFixture(fixture))
  if (errors.length > 0) {
    throw new Error(`Fixture ${id} failed verification: ${errors.join('; ')}`)
  }
}

const readRss = (pid: number | undefined): number => {
  if (pid === undefined) return 0
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)
    return match ? Number(match[1]) * 1024 : 0
  } catch {
    return 0
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isMemoryUsage = (value: unknown): value is NodeJS.MemoryUsage => {
  return isRecord(value) && typeof value.rss === 'number'
}

const isEngineMetadata = (value: unknown): value is EngineMetadata => {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.version === 'string' &&
    (value.kind === 'native' ||
      value.kind === 'native-single-thread' ||
      value.kind === 'pure-javascript' ||
      value.kind === 'webassembly') &&
    typeof value.packageName === 'string' &&
    (value.packageNames === undefined ||
      (Array.isArray(value.packageNames) &&
        value.packageNames.every((name) => typeof name === 'string')))
  )
}

const hasErrors = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  errors: string[]
} => Array.isArray(value.errors) && value.errors.every((error) => typeof error === 'string')

const isWorkerResult = (value: unknown): value is WorkerResult => {
  if (!isRecord(value) || !hasErrors(value)) return false
  if (
    value.status === 'error' ||
    value.status === 'invalid-output' ||
    value.status === 'unsupported'
  ) {
    return true
  }
  return (
    value.status === 'pass' &&
    typeof value.outputBytes === 'number' &&
    typeof value.wallMilliseconds === 'number' &&
    typeof value.cpuMilliseconds === 'number' &&
    isMemoryUsage(value.finalMemory) &&
    typeof value.resourceMaxRssBytes === 'number' &&
    (value.qualityPsnrDb === undefined ||
      value.qualityPsnrDb === 'exact' ||
      (typeof value.qualityPsnrDb === 'number' && Number.isFinite(value.qualityPsnrDb)))
  )
}

const runSample = ({
  engine,
  workflow,
  quality,
  warmups,
}: {
  quality: boolean
  engine: string
  workflow: Workflow
  warmups: number
}): Promise<BenchmarkSample> => {
  return new Promise<BenchmarkSample>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--expose-gc',
        workerPath,
        '--engine',
        engine,
        '--workflow',
        workflow.id,
        '--warmups',
        String(warmups),
        '--quality',
        String(quality),
      ],
      { cwd: repositoryDirectory, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )

    let ready = false
    let peakRssBytes = 0
    let baselineMemory: NodeJS.MemoryUsage | undefined
    let engineMetadata: EngineMetadata | undefined
    let result: WorkerResult | undefined
    let stderr = ''
    let stdout = ''
    let settled = false

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    const sampler = setInterval(() => {
      if (ready) peakRssBytes = Math.max(peakRssBytes, readRss(child.pid))
    }, 2)

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, workflow.timeoutMs ?? 60000)

    child.on('message', (message: unknown) => {
      if (
        isRecord(message) &&
        message.type === 'ready' &&
        isMemoryUsage(message.baselineMemory) &&
        isEngineMetadata(message.engine)
      ) {
        ready = true
        baselineMemory = message.baselineMemory
        engineMetadata = message.engine
        peakRssBytes = readRss(child.pid)
        child.send({ type: 'run' })
      } else if (isRecord(message) && message.type === 'measurement-complete') {
        ready = false
        child.send({ type: 'measurement-acknowledged' })
      } else if (isRecord(message) && message.type === 'result' && isWorkerResult(message.result)) {
        result = message.result
      }
    })

    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearInterval(sampler)
      clearTimeout(timeout)

      if (!result || code !== 0) {
        resolve({
          status: 'error',
          errors: [
            `worker failed with code ${code}${signal ? ` signal ${signal}` : ''}`,
            stderr.trim(),
            stdout.trim(),
          ].filter(Boolean),
        })
        return
      }
      if (result.status !== 'pass') {
        resolve(result)
        return
      }

      const absolutePeak = Math.max(peakRssBytes, result.finalMemory.rss)
      resolve({
        ...result,
        ...(engineMetadata ? { engine: engineMetadata } : {}),
        peakRssBytes: absolutePeak,
        peakRssDeltaBytes: Math.max(0, absolutePeak - (baselineMemory?.rss ?? 0)),
        ...(baselineMemory ? { baselineMemory } : {}),
      })
    })
  })
}

interface StartupWorkerResult {
  engine: EngineMetadata
  importMilliseconds: number
  rssAfterImportBytes: number
  firstMetadata: StartupOperationResult
  firstResize: StartupOperationResult
}

const isStartupOperation = (value: unknown): value is StartupOperationResult => {
  return (
    isRecord(value) &&
    (value.status === 'error' ||
      value.status === 'invalid-output' ||
      value.status === 'pass' ||
      value.status === 'unsupported') &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === 'string') &&
    (value.wallMilliseconds === undefined || typeof value.wallMilliseconds === 'number')
  )
}

const isStartupWorkerResult = (value: unknown): value is StartupWorkerResult => {
  return (
    isRecord(value) &&
    isEngineMetadata(value.engine) &&
    typeof value.importMilliseconds === 'number' &&
    typeof value.rssAfterImportBytes === 'number' &&
    isStartupOperation(value.firstMetadata) &&
    isStartupOperation(value.firstResize)
  )
}

const runStartup = (engine: string): Promise<StartupWorkerResult> => {
  return new Promise<StartupWorkerResult>((resolve, reject) => {
    const child = spawn(process.execPath, [startupWorkerPath, '--engine', engine], {
      cwd: repositoryDirectory,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let result: StartupWorkerResult | undefined
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('message', (message: unknown) => {
      if (
        isRecord(message) &&
        message.type === 'startup-result' &&
        isStartupWorkerResult(message.result)
      ) {
        result = message.result
      }
    })
    const timeout = setTimeout(() => child.kill('SIGKILL'), 300000)
    child.on('exit', (code, signal) => {
      clearTimeout(timeout)
      if (!result || code !== 0) {
        reject(
          new Error(
            `startup worker ${engine} failed with code ${code}${signal ? ` signal ${signal}` : ''}: ${stderr.trim()}`,
          ),
        )
        return
      }
      resolve(result)
    })
  })
}

const results: BenchmarkResult[] = []
for (const engine of options.engines) {
  for (const workflow of selectedWorkflows) {
    const runs = workflow.defaultRuns ?? options.runs
    const warmups = workflow.defaultWarmups ?? options.warmups
    process.stdout.write(
      `[${engine}] ${workflow.id} (${runs} run${runs === 1 ? '' : 's'}, ${warmups} warmup${warmups === 1 ? '' : 's'})\n`,
    )
    const samples: BenchmarkSample[] = []
    for (let run = 0; run < runs; run += 1) {
      const sample = await runSample({ engine, workflow, warmups, quality: run === 0 })
      samples.push(sample)
      const quality =
        isSuccessfulSample(sample) && sample.qualityPsnrDb !== undefined
          ? `, quality ${sample.qualityPsnrDb === 'exact' ? 'exact' : `${sample.qualityPsnrDb.toFixed(2)} dB`}`
          : ''
      process.stdout.write(
        `  ${run + 1}/${runs} ${isSuccessfulSample(sample) ? `${sample.wallMilliseconds.toFixed(1)} ms${quality}` : `${sample.status.toUpperCase()} ${sample.errors.join(' | ')}`}\n`,
      )
      if (!isSuccessfulSample(sample)) break
    }
    results.push({
      engine,
      workflow: workflow.id,
      title: workflow.title,
      runs,
      warmups,
      summary: summarizeSamples(samples),
      samples,
    })
  }
}

const startup: StartupResult[] = []
for (const engine of options.engines) {
  process.stdout.write(`[${engine}] startup and package footprint\n`)
  const measured = await runStartup(engine)
  const footprint = await measurePackageFootprint({
    engine: measured.engine,
    repositoryDirectory,
  })
  startup.push({ ...measured, footprint })
}

let revision = 'unknown'
let dirty = null
try {
  revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
} catch {
  try {
    const head = readFileSync(join(repositoryDirectory, '.git', 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5)
      try {
        revision = readFileSync(join(repositoryDirectory, '.git', ref), 'utf8')
          .trim()
          .slice(0, 7)
      } catch {
        const packedRefs = readFileSync(join(repositoryDirectory, '.git', 'packed-refs'), 'utf8')
        const match = new RegExp(`^([0-9a-f]{40}) ${ref}$`, 'm').exec(packedRefs)
        const matchedRevision = match?.[1]
        if (matchedRevision) revision = matchedRevision.slice(0, 7)
      }
    } else {
      revision = head.slice(0, 7)
    }
  } catch {}
}

try {
  dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0
} catch {}

const createdAt = new Date().toISOString()
const cpu = os.cpus()[0]?.model
const report: BenchmarkReport = {
  schemaVersion: 2,
  createdAt,
  profile: options.profile,
  configuration: {
    engines: options.engines,
    defaultRuns: options.runs,
    defaultWarmups: options.warmups,
    isolatedProcessPerSample: true,
    isolatedStartupProcessPerEngine: true,
    inputFileReadTimed: false,
    outputValidationTimed: false,
    qualityMeasurementTimed: false,
    qualityMetric: 'premultiplied-rgba-psnr-vs-independent-exact-area-reference',
    resizeKernelPolicy: {
      mode: 'engine-defaults',
      purejsimage: 'lanczos3',
      sharp: 'lanczos3',
      jimp: 'bilinear',
    },
  },
  environment: {
    platform: process.platform,
    osName: os.type(),
    osRelease: os.release(),
    architecture: process.arch,
    node: process.version,
    ...(cpu ? { cpu } : {}),
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    gitRevision: revision,
    dirty,
  },
  fixtures: [...requiredFixtureIds],
  results,
  startup,
}

const formatMilliseconds = (value: number | undefined): string =>
  value === undefined ? '-' : value.toFixed(1)
const formatMegabytes = (value: number | undefined): string =>
  value === undefined ? '-' : (value / 1024 / 1024).toFixed(1)
const formatQuality = (value: BenchmarkResult['summary']['qualityPsnrDb']): string =>
  value === undefined ? '-' : value === 'exact' ? 'exact' : `${value.toFixed(2)} dB`
const displayStatus = (status: BenchmarkResult['summary']['status']): string =>
  status === 'invalid-output' ? 'invalid output' : status

const fullyComparableWorkflowIds = selectedWorkflows
  .filter((workflow) => {
    const workflowResults = results.filter((result) => result.workflow === workflow.id)
    return (
      workflowResults.length === options.engines.length &&
      workflowResults.every((result) => result.summary.status === 'pass')
    )
  })
  .map((workflow) => workflow.id)
const comparableResults = results.filter((result) =>
  fullyComparableWorkflowIds.includes(result.workflow),
)

const markdown = [
  '# Benchmark result',
  '',
  `Created: ${createdAt}`,
  '',
  `Profile: \`${options.profile}\``,
  '',
  `Environment: ${report.environment.osName} ${report.environment.osRelease}, ${report.environment.architecture}, Node ${report.environment.node}, ${report.environment.cpu}, ${report.environment.logicalCpus} logical CPUs`,
  '',
  '## Engine versions',
  '',
  '| Engine | Version | Implementation |',
  '| --- | --- | --- |',
  ...startup.map(({ engine }) => `| ${engine.id} | ${engine.version} | ${engine.kind} |`),
  '',
  'Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.',
  '',
  '## Compatibility',
  '',
  '| Engine | Workflow | Status | Detail |',
  '| --- | --- | --- | --- |',
  ...results.map(
    ({ engine, workflow, summary }) =>
      `| ${engine} | ${workflow} | ${displayStatus(summary.status)} | ${summary.errors.join('; ') || '-'} |`,
  ),
  '',
  '## Performance on workflows supported by every selected engine',
  '',
  '| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...(comparableResults.length > 0
    ? comparableResults.map(
        ({ engine, workflow, summary }) =>
          `| ${engine} | ${workflow} | ${formatMilliseconds(summary.wallMilliseconds?.median)} ms | ${formatMilliseconds(summary.wallMilliseconds?.p95)} ms | ${formatMilliseconds(summary.cpuMilliseconds?.median)} ms | ${formatMegabytes(summary.peakRssBytes?.median)} MiB | ${formatMegabytes(summary.peakRssDeltaBytes?.median)} MiB | ${formatMegabytes(summary.finalExternalBytes?.median)} MiB | ${formatMegabytes(summary.finalArrayBuffersBytes?.median)} MiB | ${formatMegabytes(summary.sourceBytesRead?.median)} MiB | ${formatMegabytes(summary.maximumDecodedBlockBytes?.median)} MiB | ${formatQuality(summary.qualityPsnrDb)} | ${formatMegabytes(summary.outputBytes?.median)} MiB |`,
      )
    : [
        '| - | No workflow passed for every selected engine | - | - | - | - | - | - | - | - | - | - | - |',
      ]),
  '',
  '## Startup and installed package footprint',
  '',
  '| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...startup.map(
    ({ engine, importMilliseconds, rssAfterImportBytes, firstMetadata, firstResize, footprint }) =>
      `| ${engine.id} | ${formatMilliseconds(importMilliseconds)} ms | ${formatMegabytes(rssAfterImportBytes)} MiB | ${formatMilliseconds(firstMetadata.wallMilliseconds)} ms (${firstMetadata.status}) | ${formatMilliseconds(firstResize.wallMilliseconds)} ms (${firstResize.status}) | ${formatMegabytes(footprint.bytes)} MiB | ${footprint.productionPackageCount} |`,
  ),
  '',
  'Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.',
  '',
  'A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.',
  '',
  'Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.',
  '',
]

await mkdir(resultsDirectory, { recursive: true })
const stem =
  options.output ??
  `${createdAt.replaceAll(':', '-').replaceAll('.', '-')}-${options.engines.join('-')}-${options.profile}`
const jsonPath = join(resultsDirectory, `${stem}.json`)
const markdownPath = join(resultsDirectory, `${stem}.md`)
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(markdownPath, markdown.join('\n'))

console.log(`JSON: ${jsonPath}`)
console.log(`Markdown: ${markdownPath}`)

if (
  results.some(({ summary }) => summary.status === 'error' || summary.status === 'invalid-output')
) {
  process.exitCode = 1
}
