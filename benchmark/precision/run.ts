import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const workloads = [
  'png16-roundtrip',
  'png16-crop-resize',
  'gray16-downscale',
  'rgb16-downscale',
  'rgba16-alpha-resize',
  'grayf32-resize',
  'rgbf32-resize',
] as const

type Workload = (typeof workloads)[number]

const isWorkload = (value: unknown): value is Workload =>
  typeof value === 'string' && workloads.some((candidate) => candidate === value)

interface Result {
  readonly workload: Workload
  readonly wallMilliseconds: number
  readonly cpuMilliseconds: number
  readonly maximumRssBytes: number
  readonly rssDeltaBytes: number
  readonly peakExternalDeltaBytes: number
  readonly peakArrayBuffersDeltaBytes: number
  readonly maximumManagedBlockBytes: number
  readonly outputWidth: number
  readonly outputHeight: number
  readonly outputFormat: string
  readonly correctness: string
  readonly maximumAbsoluteError: number | null
  readonly outputBytes: number
  readonly outputHash: string
}

const isResult = (value: unknown): value is Result =>
  typeof value === 'object' &&
  value !== null &&
  'workload' in value &&
  isWorkload(value.workload) &&
  'wallMilliseconds' in value &&
  typeof value.wallMilliseconds === 'number' &&
  'outputHash' in value &&
  typeof value.outputHash === 'string'

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

const worker = fileURLToPath(new URL('./worker.ts', import.meta.url))
const runs: Result[] = []
for (const workload of workloads) {
  for (let run = 0; run < 3; run += 1) {
    const child = spawnSync(process.execPath, ['--expose-gc', worker, workload], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    if (child.error) throw child.error
    if (child.status !== 0) {
      throw new Error(`Precision benchmark ${workload} failed: ${child.stderr.trim()}`)
    }
    const value: unknown = JSON.parse(child.stdout.trim())
    if (!isResult(value)) throw new Error(`Precision benchmark ${workload} returned invalid data`)
    runs.push(value)
  }
}

const summaries = workloads.map((workload) => {
  const selected = runs.filter((run) => run.workload === workload)
  const hashes = new Set(selected.map((run) => run.outputHash))
  if (hashes.size !== 1) throw new Error(`${workload} output changed between isolated runs`)
  const first = selected[0]
  if (!first) throw new Error(`${workload} produced no benchmark result`)
  return {
    workload,
    medianWallMilliseconds: median(selected.map((run) => run.wallMilliseconds)),
    medianCpuMilliseconds: median(selected.map((run) => run.cpuMilliseconds)),
    medianMaximumRssBytes: median(selected.map((run) => run.maximumRssBytes)),
    medianRssDeltaBytes: median(selected.map((run) => run.rssDeltaBytes)),
    medianExternalDeltaBytes: median(selected.map((run) => run.peakExternalDeltaBytes)),
    medianArrayBuffersDeltaBytes: median(selected.map((run) => run.peakArrayBuffersDeltaBytes)),
    maximumManagedBlockBytes: Math.max(...selected.map((run) => run.maximumManagedBlockBytes)),
    outputWidth: first.outputWidth,
    outputHeight: first.outputHeight,
    outputFormat: first.outputFormat,
    correctness: first.correctness,
    maximumAbsoluteError: selected.every((run) => run.maximumAbsoluteError !== null)
      ? Math.max(...selected.map((run) => run.maximumAbsoluteError ?? 0))
      : null,
    outputBytes: first.outputBytes,
    outputHash: first.outputHash,
  }
})

const report = {
  generatedAt: new Date().toISOString(),
  baseRevision: '51361e9c823934c22425121fb13db45461ebbd25',
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  runsPerWorkload: 3,
  validation:
    'Every workload passed its native format, dimensions, and pinned exact-output gate. The lossless round trip also matched its input samples exactly.',
  measurement:
    'Each run uses a fresh process. maxRSS is absolute process.resourceUsage().maxRSS. Other memory values are sampled after managed output blocks.',
  neighboringBaselineArtifacts: [
    'benchmark/results/native-precision-baseline-jpeg.json',
    'benchmark/results/native-precision-baseline-png.json',
    'benchmark/results/native-precision-baseline-alpha.json',
    'benchmark/results/native-precision-baseline-large.json',
  ],
  summaries,
}
const stamp = report.generatedAt.replaceAll(/[:.]/gu, '-')
const outputFlag = process.argv.indexOf('--output')
const requested = outputFlag === -1 ? undefined : process.argv[outputFlag + 1]
if (outputFlag !== -1 && requested === undefined) throw new Error('--output requires a path')
const output = requested ?? `benchmark/results/native-precision-${stamp}.json`
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
await writeFile(
  output.replace(/\.json$/u, '.md'),
  `# Native precision benchmark\n\n- Generated: ${report.generatedAt}\n- Runs: 3 isolated processes per workload\n- Correctness: every workload passed its explicit gate\n- JSON: ${output}\n`,
)
console.log(JSON.stringify(report, null, 2))
