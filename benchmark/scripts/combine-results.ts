import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  BenchmarkEnvironment,
  BenchmarkReport,
  BenchmarkResult,
  BenchmarkSample,
  BenchmarkSummary,
  TimedSample,
} from '../types.ts'

const benchmarkDirectory = dirname(dirname(fileURLToPath(import.meta.url)))
const resultsDirectory = join(benchmarkDirectory, 'results')
const args = process.argv.slice(2)
const outputIndex = args.indexOf('--output')
const output = outputIndex === -1 ? 'combined-result' : args[outputIndex + 1]
const inputs = args.filter(
  (argument, index) =>
    index !== outputIndex && index !== outputIndex + 1 && argument !== '--output',
)

if (inputs.length === 0) {
  throw new Error('Provide one or more result JSON files')
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const isBenchmarkSample = (value: unknown): value is BenchmarkSample => {
  if (!isRecord(value) || typeof value.valid !== 'boolean' || !isStringArray(value.errors)) {
    return false
  }
  if (!('wallMilliseconds' in value)) return value.valid === false
  return (
    typeof value.wallMilliseconds === 'number' &&
    typeof value.cpuMilliseconds === 'number' &&
    typeof value.outputBytes === 'number' &&
    typeof value.peakRssBytes === 'number' &&
    typeof value.peakRssDeltaBytes === 'number'
  )
}

const isBenchmarkSummary = (value: unknown): value is BenchmarkSummary => {
  return (
    isRecord(value) &&
    (value.status === 'failed' || value.status === 'partial' || value.status === 'passed') &&
    isStringArray(value.errors)
  )
}

const isBenchmarkResult = (value: unknown): value is BenchmarkResult => {
  return (
    isRecord(value) &&
    typeof value.engine === 'string' &&
    typeof value.workflow === 'string' &&
    typeof value.title === 'string' &&
    typeof value.runs === 'number' &&
    typeof value.warmups === 'number' &&
    isBenchmarkSummary(value.summary) &&
    Array.isArray(value.samples) &&
    value.samples.every(isBenchmarkSample)
  )
}

const isBenchmarkEnvironment = (value: unknown): value is BenchmarkEnvironment => {
  return (
    isRecord(value) &&
    typeof value.platform === 'string' &&
    typeof value.architecture === 'string' &&
    typeof value.node === 'string' &&
    typeof value.logicalCpus === 'number' &&
    typeof value.totalMemoryBytes === 'number' &&
    typeof value.gitRevision === 'string' &&
    (typeof value.dirty === 'boolean' || value.dirty === null)
  )
}

const isBenchmarkReport = (value: unknown): value is BenchmarkReport => {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.profile === 'string' &&
    isRecord(value.configuration) &&
    isBenchmarkEnvironment(value.environment) &&
    isStringArray(value.fixtures) &&
    Array.isArray(value.results) &&
    value.results.every(isBenchmarkResult)
  )
}

const parseBenchmarkReport = (source: string, path: string): BenchmarkReport => {
  const report: unknown = JSON.parse(source)
  if (!isBenchmarkReport(report)) throw new Error(`Invalid benchmark report: ${path}`)
  return report
}

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) throw new Error('Cannot calculate a percentile without values')
  const sorted = [...values].sort((left, right) => left - right)
  const value = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
  if (value === undefined) throw new Error('Percentile index was outside the sample set')
  return value
}

const isSuccessfulSample = (sample: BenchmarkSample): sample is TimedSample & { valid: true } => {
  return sample.valid && 'peakRssBytes' in sample
}

const refreshSummary = (result: BenchmarkResult): BenchmarkResult => {
  const successful = result.samples.filter(isSuccessfulSample)
  if (successful.length === 0) return result

  const peakRss = successful.map((sample) => sample.peakRssBytes)
  const peakRssDelta = successful.map((sample) => sample.peakRssDeltaBytes)
  return {
    ...result,
    summary: {
      ...result.summary,
      peakRssBytes: {
        median: percentile(peakRss, 0.5),
        maximum: Math.max(...peakRss),
      },
      peakRssDeltaBytes: {
        median: percentile(peakRssDelta, 0.5),
        maximum: Math.max(...peakRssDelta),
      },
    },
  }
}

const sourceReports = await Promise.all(
  inputs.map(async (input) => {
    const path = input.startsWith('/') ? input : join(resultsDirectory, input)
    return {
      name: basename(path),
      report: parseBenchmarkReport(await readFile(path, 'utf8'), path),
    }
  }),
)

const results = sourceReports.flatMap(({ report }) => report.results).map(refreshSummary)
const firstSource = sourceReports[0]
if (!firstSource) throw new Error('No benchmark reports were loaded')
const first = firstSource.report
const createdAt = new Date().toISOString()
const report: BenchmarkReport = {
  schemaVersion: 1,
  createdAt,
  profile: 'combined',
  sourceReports: sourceReports.map(({ name }) => name),
  configuration: first.configuration,
  environment: first.environment,
  fixtures: [...new Set(sourceReports.flatMap(({ report }) => report.fixtures))],
  results,
}

if (report.environment.gitRevision === 'unknown') {
  try {
    const repositoryDirectory = dirname(benchmarkDirectory)
    const head = await readFile(join(repositoryDirectory, '.git', 'HEAD'), 'utf8')
    if (head.trim().startsWith('ref: ')) {
      const ref = head.trim().slice(5)
      report.environment.gitRevision = (
        await readFile(join(repositoryDirectory, '.git', ref), 'utf8')
      )
        .trim()
        .slice(0, 7)
    } else {
      report.environment.gitRevision = head.trim().slice(0, 7)
    }
  } catch {}
}

const milliseconds = (value: number | undefined): string =>
  value === undefined ? '-' : value.toFixed(1)
const mebibytes = (value: number | undefined): string =>
  value === undefined ? '-' : (value / 1024 / 1024).toFixed(1)
const passed = results.filter(({ summary }) => summary.status === 'passed').length

const markdown = [
  '# Jimp 1.6.0 baseline',
  '',
  `Recorded: ${createdAt}`,
  '',
  `Environment: ${report.environment.cpu}, ${report.environment.logicalCpus} logical CPUs, Node ${report.environment.node}, ${report.environment.platform}/${report.environment.architecture}`,
  '',
  `Workflow success: ${passed}/${results.length}`,
  '',
  '| Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...results.map(
    ({ workflow, summary }) =>
      `| ${workflow} | ${summary.status} | ${milliseconds(summary.wallMilliseconds?.median)} ms | ${milliseconds(summary.wallMilliseconds?.p95)} ms | ${mebibytes(summary.peakRssBytes?.median)} MiB | ${mebibytes(summary.outputBytes?.median)} MiB |`,
  ),
  '',
  '## Win condition',
  '',
  'PureJsImage wins a workflow only when its output passes the same validation and its median wall time is lower than this Jimp baseline. Peak RSS is the primary memory comparison. Unsupported or invalid output is a failed workflow regardless of timing.',
  '',
  'Input file reads, process startup, warmups, and output validation are outside the timed region. Each sample runs in an isolated process. Standard cases use one untimed warmup and three measured samples; batch and stress cases use two measured samples without a warmup.',
  '',
]

await writeFile(join(resultsDirectory, `${output}.json`), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(join(resultsDirectory, `${output}.md`), markdown.join('\n'))

console.log(`Combined ${inputs.length} reports into ${output}.json and ${output}.md`)
