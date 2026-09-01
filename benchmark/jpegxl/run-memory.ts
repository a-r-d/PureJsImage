import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

interface WorkerResult {
  readonly baseline: MemorySnapshot
  readonly inputBytes: number
  readonly maximumRssBytes: number
  readonly mode: 'crop' | 'full'
  readonly outputBytes: number
  readonly outputSha256: string
  readonly peak: MemorySnapshot
  readonly peakRssDeltaBytes: number
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

const parseResult = (value: unknown): WorkerResult => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('mode' in value) ||
    (value.mode !== 'crop' && value.mode !== 'full') ||
    !('baseline' in value) ||
    !isSnapshot(value.baseline) ||
    !('peak' in value) ||
    !isSnapshot(value.peak) ||
    !('inputBytes' in value) ||
    !isNumber(value.inputBytes) ||
    !('maximumRssBytes' in value) ||
    !isNumber(value.maximumRssBytes) ||
    !('outputBytes' in value) ||
    !isNumber(value.outputBytes) ||
    !('outputSha256' in value) ||
    typeof value.outputSha256 !== 'string' ||
    !('peakRssDeltaBytes' in value) ||
    !isNumber(value.peakRssDeltaBytes) ||
    !('wallMilliseconds' in value) ||
    !isNumber(value.wallMilliseconds)
  ) {
    throw new Error('JPEG XL memory worker returned an invalid result')
  }
  return {
    baseline: value.baseline,
    inputBytes: value.inputBytes,
    maximumRssBytes: value.maximumRssBytes,
    mode: value.mode,
    outputBytes: value.outputBytes,
    outputSha256: value.outputSha256,
    peak: value.peak,
    peakRssDeltaBytes: value.peakRssDeltaBytes,
    wallMilliseconds: value.wallMilliseconds,
  }
}

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}
const worker = fileURLToPath(new URL('./memory-worker.ts', import.meta.url))
const runs: WorkerResult[] = []
for (const mode of ['crop', 'full'] as const) {
  for (let run = 0; run < 3; run += 1) {
    const child = spawnSync(process.execPath, ['--expose-gc', worker, mode], {
      encoding: 'utf8',
      maxBuffer: 1_024 * 1_024,
    })
    if (child.status !== 0) {
      throw new Error(`JPEG XL ${mode} memory worker failed: ${child.stderr.trim()}`)
    }
    runs.push(parseResult(JSON.parse(child.stdout.trim())))
  }
}
const summaries = (['crop', 'full'] as const).map((mode) => {
  const selected = runs.filter((run) => run.mode === mode)
  const hashes = new Set(selected.map((run) => run.outputSha256))
  if (hashes.size !== 1) throw new Error(`JPEG XL ${mode} output hashes changed between runs`)
  return {
    mode,
    dimensions: mode === 'crop' ? '64x64 crop from 4096x4096' : '4096x4096 full decode',
    inputBytes: selected[0]?.inputBytes ?? 0,
    outputBytes: selected[0]?.outputBytes ?? 0,
    outputSha256: selected[0]?.outputSha256 ?? '',
    medianMaximumRssBytes: median(selected.map((run) => run.maximumRssBytes)),
    medianPeakRssDeltaBytes: median(selected.map((run) => run.peakRssDeltaBytes)),
    medianPeakExternalDeltaBytes: median(
      selected.map((run) => Math.max(0, run.peak.externalBytes - run.baseline.externalBytes)),
    ),
    medianPeakArrayBuffersDeltaBytes: median(
      selected.map((run) =>
        Math.max(0, run.peak.arrayBuffersBytes - run.baseline.arrayBuffersBytes),
      ),
    ),
    medianWallMilliseconds: median(selected.map((run) => run.wallMilliseconds)),
  }
})
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  validation: {
    passed: true,
    policy: 'Every isolated run matched the checksum-pinned native gray8 output.',
  },
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  encoder: 'cjxl 0.11.1, lossless Modular effort 2',
  runsPerConfiguration: 3,
  notes: {
    fixture:
      'Checksum-pinned 4096x4096 gray8 scientific pattern with a permuted TOC and per-group local MA trees.',
    baseline: 'Captured after input load and five explicit GC/event-loop turns in a fresh process.',
    correctness: 'Every run hashes all native gray8 output rows.',
  },
  summaries,
}
const outputFlag = process.argv.indexOf('--output')
const outputPath = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (outputFlag !== -1 && !outputPath) throw new Error('--output requires a path')
const resultPath =
  outputPath ??
  `benchmark/results/jpegxl-memory-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.json`
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
await writeFile(
  resultPath.replace(/\.json$/u, '.md'),
  `# JPEG XL memory benchmark\n\n- Generated: ${result.generatedAt}\n- Validation: every run hashes all native gray8 output rows\n- Result: ${resultPath}\n`,
)
console.log(`Wrote ${resultPath}`)
console.log(JSON.stringify(result, null, 2))
