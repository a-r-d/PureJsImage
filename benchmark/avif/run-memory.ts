import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  avifMemoryEncoderVersion,
  avifMemoryFfmpegVersion,
  prepareAvifMemoryCases,
  type AvifMemoryScenario,
} from './memory-fixtures.ts'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

interface WorkerResult {
  readonly action: 'decode' | 'downscale'
  readonly baseline: MemorySnapshot
  readonly baselineMaximumRssBytes: number
  readonly dimensions: string
  readonly final: MemorySnapshot
  readonly inputBytes: number
  readonly maximumRssBytes: number
  readonly outputBytes: number
  readonly outputSha256: string
  readonly peakArrayBuffersDeltaBytes: number
  readonly peakExternalDeltaBytes: number
  readonly peakRssDeltaBytes: number
  readonly peakSampled: MemorySnapshot
  readonly scenario: AvifMemoryScenario
  readonly sourceRgbaReferenceBytes: number
  readonly wallMilliseconds: number
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const isSnapshot = (value: unknown): value is MemorySnapshot =>
  typeof value === 'object' &&
  value !== null &&
  'arrayBuffersBytes' in value &&
  isNumber(value.arrayBuffersBytes) &&
  'externalBytes' in value &&
  isNumber(value.externalBytes) &&
  'heapUsedBytes' in value &&
  isNumber(value.heapUsedBytes) &&
  'rssBytes' in value &&
  isNumber(value.rssBytes)

const isScenario = (value: unknown): value is AvifMemoryScenario =>
  value === 'alpha' ||
  value === 'cdef' ||
  value === 'deblock' ||
  value === 'filtered-4k-multitile' ||
  value === 'filtered-10bit' ||
  value === 'filtered-10bit-downscale' ||
  value === 'filtered-12bit' ||
  value === 'filtered-12bit-downscale' ||
  value === 'film-grain' ||
  value === 'gain-map-grid' ||
  value === 'downscale' ||
  value === 'grid' ||
  value === 'no-filters' ||
  value === 'restoration'

const parseWorkerResult = (value: unknown): WorkerResult => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('scenario' in value) ||
    !isScenario(value.scenario) ||
    !('action' in value) ||
    (value.action !== 'decode' && value.action !== 'downscale') ||
    !('dimensions' in value) ||
    typeof value.dimensions !== 'string' ||
    !('outputSha256' in value) ||
    typeof value.outputSha256 !== 'string' ||
    !('baseline' in value) ||
    !isSnapshot(value.baseline) ||
    !('baselineMaximumRssBytes' in value) ||
    !isNumber(value.baselineMaximumRssBytes) ||
    !('peakSampled' in value) ||
    !isSnapshot(value.peakSampled) ||
    !('final' in value) ||
    !isSnapshot(value.final) ||
    !('inputBytes' in value) ||
    !isNumber(value.inputBytes) ||
    !('maximumRssBytes' in value) ||
    !isNumber(value.maximumRssBytes) ||
    !('outputBytes' in value) ||
    !isNumber(value.outputBytes) ||
    !('peakArrayBuffersDeltaBytes' in value) ||
    !isNumber(value.peakArrayBuffersDeltaBytes) ||
    !('peakExternalDeltaBytes' in value) ||
    !isNumber(value.peakExternalDeltaBytes) ||
    !('peakRssDeltaBytes' in value) ||
    !isNumber(value.peakRssDeltaBytes) ||
    !('sourceRgbaReferenceBytes' in value) ||
    !isNumber(value.sourceRgbaReferenceBytes) ||
    !('wallMilliseconds' in value) ||
    !isNumber(value.wallMilliseconds)
  ) {
    throw new Error('AVIF memory worker returned an invalid result')
  }
  return {
    scenario: value.scenario,
    action: value.action,
    dimensions: value.dimensions,
    inputBytes: value.inputBytes,
    outputBytes: value.outputBytes,
    outputSha256: value.outputSha256,
    sourceRgbaReferenceBytes: value.sourceRgbaReferenceBytes,
    wallMilliseconds: value.wallMilliseconds,
    baseline: value.baseline,
    baselineMaximumRssBytes: value.baselineMaximumRssBytes,
    peakSampled: value.peakSampled,
    final: value.final,
    maximumRssBytes: value.maximumRssBytes,
    peakRssDeltaBytes: value.peakRssDeltaBytes,
    peakExternalDeltaBytes: value.peakExternalDeltaBytes,
    peakArrayBuffersDeltaBytes: value.peakArrayBuffersDeltaBytes,
  }
}

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

const outputFlag = process.argv.indexOf('--output')
const outputPath = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (outputFlag !== -1 && !outputPath) throw new Error('--output requires a path')
const defaultOutputPath = join(
  process.cwd(),
  'benchmark/results',
  `avif-memory-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.json`,
)
const labelFlag = process.argv.indexOf('--label')
const label = labelFlag === -1 ? 'AVIF memory measurement' : process.argv[labelFlag + 1]
if (!label) throw new Error('--label requires a value')
const worker = fileURLToPath(new URL('./memory-worker.ts', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'purejsimage-avif-memory-'))
try {
  const fixtures = await prepareAvifMemoryCases(directory)
  const runs: WorkerResult[] = []
  for (const fixture of fixtures) {
    for (let run = 0; run < 3; run += 1) {
      const child = spawnSync(process.execPath, ['--expose-gc', worker, JSON.stringify(fixture)], {
        encoding: 'utf8',
        maxBuffer: 1_024 * 1_024,
        timeout: 180_000,
      })
      if (child.error) throw child.error
      if (child.status !== 0) {
        throw new Error(
          `${fixture.scenario} memory worker failed with status ${child.status ?? 'unknown'}: ${child.stderr.trim()}`,
        )
      }
      const output = child.stdout.trim()
      if (!output) throw new Error(`${fixture.scenario} memory worker produced no output`)
      const parsedOutput: unknown = JSON.parse(output)
      runs.push(parseWorkerResult(parsedOutput))
    }
  }

  const summaries = fixtures.map((fixture) => {
    const matching = runs.filter((run) => run.scenario === fixture.scenario)
    return {
      scenario: fixture.scenario,
      action: fixture.action,
      dimensions: `${fixture.expectedWidth}x${fixture.expectedHeight}`,
      inputBytes: matching[0]?.inputBytes ?? 0,
      outputBytes: matching[0]?.outputBytes ?? 0,
      outputSha256: fixture.expectedOutputSha256,
      sourceRgbaReferenceBytes: matching[0]?.sourceRgbaReferenceBytes ?? 0,
      medianMaximumRssBytes: median(matching.map((run) => run.maximumRssBytes)),
      medianBaselineMaximumRssBytes: median(matching.map((run) => run.baselineMaximumRssBytes)),
      medianPeakRssDeltaBytes: median(matching.map((run) => run.peakRssDeltaBytes)),
      medianPeakExternalDeltaBytes: median(matching.map((run) => run.peakExternalDeltaBytes)),
      medianPeakArrayBuffersDeltaBytes: median(
        matching.map((run) => run.peakArrayBuffersDeltaBytes),
      ),
      medianWallMilliseconds: median(matching.map((run) => run.wallMilliseconds)),
    }
  })
  const report = {
    label,
    generatedAt: new Date().toISOString(),
    validation: {
      passed: true,
      policy: 'Every isolated worker output matched its pinned checksum and dimensions.',
    },
    isolatedColdProcessPerRun: true,
    runsPerScenario: 3,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    avifenc: avifMemoryEncoderVersion(),
    ffmpeg: avifMemoryFfmpegVersion(),
    notes: {
      purpose:
        'Evidence for bounded output and explicit full-frame filtered fallbacks; not a performance claim.',
      filteredHighDepth:
        'Filtered 10-bit and 12-bit decode reconstructs padded full-frame native-depth YUV before bounded RGBA row emission; downscale does not reduce that reconstruction working set.',
      maximumRss: 'Absolute process high-water mark from process.resourceUsage().',
      externalAndArrayBuffers: 'Sampled after decoder creation and every public output block.',
      baseline:
        'Captured after five explicit GC and event-loop turns with input retained; inherited high-water marks are rejected.',
      correctness: 'Every run must match a checksum-pinned encoded or RGBA output.',
    },
    summaries,
    runs,
  }
  const serialized = `${JSON.stringify(report, undefined, 2)}\n`
  const resultPath = outputPath ?? defaultOutputPath
  await writeFile(resultPath, serialized)
  await writeFile(
    resultPath.replace(/\.json$/u, '.md'),
    `# AVIF memory benchmark\n\n- Generated: ${report.generatedAt}\n- Validation: every isolated run was checksum validated\n- Result: ${resultPath}\n\n${report.notes.purpose}\n`,
  )
  console.log(`Wrote ${resultPath}`)
  console.log(serialized.trim())
} finally {
  await rm(directory, { recursive: true, force: true })
}
