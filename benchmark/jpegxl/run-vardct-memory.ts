import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const workloads = [
  'gaborish-epf',
  'noise',
  'progressive',
  'large-single-group',
  'large-preflight-rejection',
  'evidence-off',
  'evidence-summary',
  'evidence-trace',
] as const

interface WorkerResult {
  readonly workload: (typeof workloads)[number]
  readonly fixtureId: string
  readonly validation: 'tolerance-pixels' | 'preflight-rejection'
  readonly baseline: MemorySnapshot
  readonly peak: MemorySnapshot
  readonly maximumRssBytes: number
  readonly inputBytes: number
  readonly inputSha256: string
  readonly outputBytes: number
  readonly outputSha256: string
  readonly maximumError: number
  readonly rmse: number
  readonly managedPeakBytes: number
  readonly preflightBytes: number
  readonly evidenceMode: 'off' | 'summary' | 'trace'
  readonly evidencePeakBytes: number
  readonly evidenceCurrentBytes: number
  readonly rejectionCode?: string
  readonly wallMilliseconds: number
}

interface MemorySnapshot {
  readonly arrayBuffersBytes: number
  readonly externalBytes: number
  readonly heapUsedBytes: number
  readonly rssBytes: number
}

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const snapshot = (value: unknown): MemorySnapshot => {
  if (!record(value)) throw new Error('VarDCT memory worker snapshot is invalid')
  for (const key of ['arrayBuffersBytes', 'externalBytes', 'heapUsedBytes', 'rssBytes'] as const) {
    if (!number(value[key])) throw new Error(`VarDCT memory worker ${key} is invalid`)
  }
  return {
    arrayBuffersBytes: Number(value.arrayBuffersBytes),
    externalBytes: Number(value.externalBytes),
    heapUsedBytes: Number(value.heapUsedBytes),
    rssBytes: Number(value.rssBytes),
  }
}
const parse = (value: unknown): WorkerResult => {
  if (
    !record(value) ||
    typeof value.workload !== 'string' ||
    !workloads.includes(value.workload as WorkerResult['workload']) ||
    typeof value.fixtureId !== 'string' ||
    (value.validation !== 'tolerance-pixels' && value.validation !== 'preflight-rejection') ||
    !number(value.maximumRssBytes) ||
    !number(value.inputBytes) ||
    typeof value.inputSha256 !== 'string' ||
    !number(value.outputBytes) ||
    typeof value.outputSha256 !== 'string' ||
    !number(value.maximumError) ||
    !number(value.rmse) ||
    !number(value.managedPeakBytes) ||
    !number(value.preflightBytes) ||
    (value.evidenceMode !== 'off' &&
      value.evidenceMode !== 'summary' &&
      value.evidenceMode !== 'trace') ||
    !number(value.evidencePeakBytes) ||
    !number(value.evidenceCurrentBytes) ||
    !number(value.wallMilliseconds)
  ) {
    throw new Error('VarDCT memory worker result is invalid')
  }
  return {
    workload: value.workload as WorkerResult['workload'],
    fixtureId: value.fixtureId,
    validation: value.validation,
    baseline: snapshot(value.baseline),
    peak: snapshot(value.peak),
    maximumRssBytes: value.maximumRssBytes,
    inputBytes: value.inputBytes,
    inputSha256: value.inputSha256,
    outputBytes: value.outputBytes,
    outputSha256: value.outputSha256,
    maximumError: value.maximumError,
    rmse: value.rmse,
    managedPeakBytes: value.managedPeakBytes,
    preflightBytes: value.preflightBytes,
    evidenceMode: value.evidenceMode,
    evidencePeakBytes: value.evidencePeakBytes,
    evidenceCurrentBytes: value.evidenceCurrentBytes,
    ...(typeof value.rejectionCode === 'string' ? { rejectionCode: value.rejectionCode } : {}),
    wallMilliseconds: value.wallMilliseconds,
  }
}
const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

const worker = fileURLToPath(new URL('./vardct-memory-worker.ts', import.meta.url))
const runs: WorkerResult[] = []
for (const workload of workloads) {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const child = spawnSync(process.execPath, ['--expose-gc', worker, workload], {
      encoding: 'utf8',
      maxBuffer: 4 * 1_024 * 1_024,
    })
    if (child.error || child.status !== 0) {
      throw new Error(
        `VarDCT ${workload} memory worker failed: ${child.error?.message ?? child.stderr.trim()}`,
      )
    }
    runs.push(parse(JSON.parse(child.stdout.trim())))
  }
}
for (const workload of ['noise', 'evidence-off', 'evidence-summary', 'evidence-trace'] as const) {
  const hashes = new Set(
    runs.filter((run) => run.workload === workload).map(({ outputSha256 }) => outputSha256),
  )
  if (hashes.size !== 1) throw new Error(`VarDCT ${workload} output changed between runs`)
}
const evidenceHashes = new Set(
  runs
    .filter(({ workload }) => workload.startsWith('evidence-'))
    .map(({ outputSha256 }) => outputSha256),
)
if (evidenceHashes.size !== 1) throw new Error('VarDCT evidence modes changed output pixels')

const summaries = workloads.map((workload) => {
  const selected = runs.filter((run) => run.workload === workload)
  const first = selected[0]
  if (!first) throw new Error(`VarDCT ${workload} produced no results`)
  if (first.validation === 'preflight-rejection' && first.rejectionCode !== 'LIMIT_EXCEEDED') {
    throw new Error('VarDCT large rejection did not retain LIMIT_EXCEEDED')
  }
  return Object.freeze({
    workload,
    fixtureId: first.fixtureId,
    validation: first.validation,
    evidenceMode: first.evidenceMode,
    inputBytes: first.inputBytes,
    inputSha256: first.inputSha256,
    outputBytes: first.outputBytes,
    outputSha256: first.outputSha256,
    maximumError: first.maximumError,
    rmse: first.rmse,
    preflightBytes: first.preflightBytes,
    rejectionCode: first.rejectionCode,
    medianManagedPeakBytes: median(selected.map(({ managedPeakBytes }) => managedPeakBytes)),
    medianEvidencePeakBytes: median(selected.map(({ evidencePeakBytes }) => evidencePeakBytes)),
    medianMaximumRssBytes: median(selected.map(({ maximumRssBytes }) => maximumRssBytes)),
    medianPeakRssDeltaBytes: median(
      selected.map(({ baseline, maximumRssBytes }) =>
        Math.max(0, maximumRssBytes - baseline.rssBytes),
      ),
    ),
    medianPeakExternalDeltaBytes: median(
      selected.map(({ baseline, peak }) =>
        Math.max(0, peak.externalBytes - baseline.externalBytes),
      ),
    ),
    medianPeakArrayBuffersDeltaBytes: median(
      selected.map(({ baseline, peak }) =>
        Math.max(0, peak.arrayBuffersBytes - baseline.arrayBuffersBytes),
      ),
    ),
    medianWallMilliseconds: median(selected.map(({ wallMilliseconds }) => wallMilliseconds)),
  })
})
const result = Object.freeze({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  runsPerWorkload: 3,
  validation: Object.freeze({
    passed: true,
    policy:
      'Every accepted run stayed within max error 1 and RMSE below 0.5; the rejected large run failed preflight with LIMIT_EXCEEDED.',
  }),
  notes: Object.freeze({
    managedPeak: 'PureJsImage live managed allocation leases; separate from process RSS.',
    preflight: 'Conservative upper bound checked before large selected-VarDCT allocations.',
  }),
  summaries,
})
const outputFlag = process.argv.indexOf('--output')
const requestedOutput = outputFlag < 0 ? undefined : process.argv[outputFlag + 1]
if (outputFlag >= 0 && !requestedOutput) throw new Error('--output requires a path')
const output =
  requestedOutput ??
  `benchmark/results/jpegxl-vardct-memory-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.json`
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
await writeFile(
  output.replace(/\.json$/u, '.md'),
  `# JPEG XL selected VarDCT memory\n\n- Revision: ${result.revision}\n- Correctness: passed\n- Result: ${output}\n`,
)
console.log(`Wrote ${output}`)
console.log(JSON.stringify(result, null, 2))
