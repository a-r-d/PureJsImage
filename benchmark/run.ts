import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allFixtures, inspectFixture, readManifest, verifyInspection } from './lib/corpus.ts'
import type {
  BenchmarkReport,
  BenchmarkResult,
  BenchmarkSample,
  BenchmarkSummary,
  EngineMetadata,
  TimedSample,
  WorkerResult,
  Workflow,
} from './types.ts'
import { workflowsForProfile } from './workflows.ts'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const resultsDirectory = join(benchmarkDirectory, 'results')
const workerPath = join(benchmarkDirectory, 'worker.ts')

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
  return isRecord(value) && typeof value.id === 'string' && typeof value.version === 'string'
}

const isWorkerResult = (value: unknown): value is WorkerResult => {
  return (
    isRecord(value) &&
    typeof value.valid === 'boolean' &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === 'string') &&
    typeof value.outputBytes === 'number' &&
    typeof value.wallMilliseconds === 'number' &&
    typeof value.cpuMilliseconds === 'number' &&
    isMemoryUsage(value.finalMemory) &&
    typeof value.resourceMaxRssBytes === 'number'
  )
}

const runSample = ({
  engine,
  workflow,
  warmups,
}: {
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
      ],
      { cwd: dirname(benchmarkDirectory), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
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
          valid: false,
          errors: [
            `worker failed with code ${code}${signal ? ` signal ${signal}` : ''}`,
            stderr.trim(),
            stdout.trim(),
          ].filter(Boolean),
        })
        return
      }

      resolve({
        ...result,
        ...(engineMetadata ? { engine: engineMetadata } : {}),
        peakRssBytes,
        peakRssDeltaBytes: Math.max(0, peakRssBytes - (baselineMemory?.rss ?? 0)),
        ...(baselineMemory ? { baselineMemory } : {}),
      })
    })
  })
}

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without values')
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  const value = sorted[index]
  if (value === undefined) throw new Error('Percentile index was outside the sample set')
  return value
}

const isSuccessful = (sample: BenchmarkSample): sample is TimedSample & { valid: true } => {
  return sample.valid && 'wallMilliseconds' in sample
}

const summarize = (samples: readonly BenchmarkSample[]): BenchmarkSummary => {
  const successful = samples.filter(isSuccessful)
  if (successful.length === 0) {
    return { status: 'failed', errors: samples.flatMap((sample) => sample.errors) }
  }

  const wall = successful.map((sample) => sample.wallMilliseconds)
  const cpu = successful.map((sample) => sample.cpuMilliseconds)
  const peakAbsolute = successful.map((sample) => sample.peakRssBytes)
  const peak = successful.map((sample) => sample.peakRssDeltaBytes)
  const outputBytes = successful.map((sample) => sample.outputBytes)

  const output = successful[0]?.output
  return {
    status: successful.length === samples.length ? 'passed' : 'partial',
    samples: samples.length,
    successfulSamples: successful.length,
    wallMilliseconds: {
      median: percentile(wall, 0.5),
      p95: percentile(wall, 0.95),
      minimum: Math.min(...wall),
      maximum: Math.max(...wall),
    },
    cpuMilliseconds: { median: percentile(cpu, 0.5) },
    peakRssBytes: {
      median: percentile(peakAbsolute, 0.5),
      maximum: Math.max(...peakAbsolute),
    },
    peakRssDeltaBytes: {
      median: percentile(peak, 0.5),
      maximum: Math.max(...peak),
    },
    outputBytes: { median: percentile(outputBytes, 0.5) },
    ...(output ? { output } : {}),
    errors: samples.flatMap((sample) => sample.errors ?? []),
  }
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
      const sample = await runSample({ engine, workflow, warmups })
      samples.push(sample)
      process.stdout.write(
        `  ${run + 1}/${runs} ${isSuccessful(sample) ? `${sample.wallMilliseconds.toFixed(1)} ms` : `FAIL ${sample.errors.join(' | ')}`}\n`,
      )
      if (!sample.valid) break
    }
    results.push({
      engine,
      workflow: workflow.id,
      title: workflow.title,
      runs,
      warmups,
      summary: summarize(samples),
      samples,
    })
  }
}

let revision = 'unknown'
let dirty = null
try {
  revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
} catch {
  try {
    const repositoryDirectory = dirname(benchmarkDirectory)
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
  schemaVersion: 1,
  createdAt,
  profile: options.profile,
  configuration: {
    engines: options.engines,
    defaultRuns: options.runs,
    defaultWarmups: options.warmups,
    isolatedProcessPerSample: true,
    inputFileReadTimed: false,
    outputValidationTimed: false,
  },
  environment: {
    platform: process.platform,
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
}

const formatMilliseconds = (value: number | undefined): string =>
  value === undefined ? '-' : value.toFixed(1)
const formatMegabytes = (value: number | undefined): string =>
  value === undefined ? '-' : (value / 1024 / 1024).toFixed(1)

const markdown = [
  '# Benchmark result',
  '',
  `Created: ${createdAt}`,
  '',
  `Profile: \`${options.profile}\``,
  '',
  `Environment: ${report.environment.cpu}, ${report.environment.logicalCpus} logical CPUs, Node ${report.environment.node}, ${report.environment.platform}/${report.environment.architecture}`,
  '',
  '| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: |',
  ...results.map(
    ({ engine, workflow, summary }) =>
      `| ${engine} | ${workflow} | ${summary.status} | ${formatMilliseconds(summary.wallMilliseconds?.median)} ms | ${formatMilliseconds(summary.wallMilliseconds?.p95)} ms | ${formatMegabytes(summary.peakRssBytes?.median)} MiB | ${formatMegabytes(summary.outputBytes?.median)} MiB |`,
  ),
  '',
  'A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.',
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

if (results.some(({ summary }) => summary.status !== 'passed')) {
  process.exitCode = 1
}
