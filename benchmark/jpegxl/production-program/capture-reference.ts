import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const record = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

const array = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

const string = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

const number = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

const argument = (name: string): string => {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a path`)
  return value
}

const parseJson = async (path: string): Promise<Readonly<Record<string, unknown>>> =>
  record(JSON.parse(await readFile(path, 'utf8')), path)

const benchmark = await parseJson(argument('--benchmark'))
const compression = await parseJson(argument('--compression'))
const memory = await parseJson(argument('--memory'))
const varDctMemory = await parseJson(argument('--vardct-memory'))
const encoder = await parseJson(argument('--encoder'))
const reverse = await parseJson(argument('--reverse'))
const reports = [benchmark, compression, memory, varDctMemory, encoder, reverse]
const revision = string(benchmark.revision, 'benchmark.revision')
if (reports.some((report) => report.revision !== revision)) {
  throw new Error('Every reference report must use the same revision')
}

const reverseResults = array(reverse.results, 'reverse.results').map((value) => {
  const result = record(value, 'reverse result')
  const sourceBytes = number(result.sourceBytes, 'reverse sourceBytes')
  const jxlBytes = number(result.jxlBytes, 'reverse jxlBytes')
  return Object.freeze({
    id: string(result.id, 'reverse id'),
    sourceBytes,
    jxlBytes,
    ratio: jxlBytes / sourceBytes,
    sourceSha256: string(result.sourceSha256, 'reverse sourceSha256'),
    reconstructedSha256: string(result.reconstructedSha256, 'reverse reconstructedSha256'),
    exact: result.exact === true,
  })
})
const ratios = reverseResults.map(({ ratio }) => ratio).sort((left, right) => left - right)
const exactCases = reverseResults.filter(({ exact }) => exact).length

const encoderCases = array(encoder.cases, 'encoder.cases').map((value) => {
  const result = record(value, 'encoder case')
  return Object.freeze({
    id: string(result.id, 'encoder id'),
    format: string(result.format, 'encoder format'),
    inputBytes: number(result.inputBytes, 'encoder inputBytes'),
    outputBytes: number(result.outputBytes, 'encoder outputBytes'),
    outputSha256: string(result.outputSha256, 'encoder outputSha256'),
  })
})

const compressionSummaries = record(compression.summaries, 'compression.summaries')
const pureJsImageCompression = record(
  compressionSummaries.pureJsImage,
  'compression.summaries.pureJsImage',
)
const pureJsImageRatio = record(pureJsImageCompression.ratioToPng, 'pureJsImage.ratioToPng')
const output = Object.freeze({
  schemaVersion: 1,
  revision,
  benchmark: Object.freeze({
    validation: record(benchmark.validation, 'benchmark.validation'),
    runsPerWorkload: number(benchmark.runsPerWorkload, 'benchmark.runsPerWorkload'),
    workloads: array(benchmark.summaries, 'benchmark.summaries').length,
    summaries: array(benchmark.summaries, 'benchmark.summaries'),
  }),
  compression: Object.freeze({
    status: string(compression.status, 'compression.status'),
    revisions: record(compression.revisions, 'compression.revisions'),
    cases: array(compression.files, 'compression.files').length,
    pureJsImageMedianRatioToPng: number(pureJsImageRatio.median, 'compression median'),
    summaries: compressionSummaries,
  }),
  encoder: Object.freeze({
    validation: string(encoder.validation, 'encoder.validation'),
    cases: encoderCases.length,
    revisions: record(encoder.revisions, 'encoder.revisions'),
    results: encoderCases,
  }),
  exactJpeg: Object.freeze({
    oracle: string(reverse.oracle, 'reverse.oracle'),
    jpegOracle: string(reverse.jpegOracle, 'reverse.jpegOracle'),
    totalCases: reverseResults.length,
    exactCases,
    exactReconstructionRate: exactCases / reverseResults.length,
    medianJxlToSourceRatio: ratios[Math.floor(ratios.length / 2)] ?? null,
    results: reverseResults,
  }),
  memory: Object.freeze({
    modularValidation: record(memory.validation, 'memory.validation'),
    modular: array(memory.summaries, 'memory.summaries'),
    varDctValidation: record(varDctMemory.validation, 'vardct-memory.validation'),
    varDct: array(varDctMemory.summaries, 'vardct-memory.summaries'),
  }),
  pipelineWorkflows: Object.freeze([
    { workflow: 'structure inspection and bounded source decode', status: 'pass' },
    { workflow: 'lossless Modular encode for the six documented native formats', status: 'pass' },
    { workflow: 'exact JPEG transcode and reconstruction for eligible files', status: 'pass' },
    { workflow: 'ordinary transform and JPEG XL output pipeline', status: 'unsupported' },
    { workflow: 'progressive or reduced-resolution output', status: 'unsupported' },
  ]),
  browser: Object.freeze({
    chromium: 'pass with retries disabled',
    firefox: 'pass with retries disabled',
    webkit: 'pass with retries disabled',
    scope:
      'local worker protocol, preview, cancellation, stale response, transfer, and object URL checks',
  }),
  unavailableMeasurements: Object.freeze([
    'CPU time',
    'time to first output',
    'source read count and unique source bytes',
    'temporary storage bytes',
    'standalone cancellation latency',
  ]),
})

const outputPath = join('benchmark', 'jpegxl', 'production-program', 'reference-measurements.json')
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
