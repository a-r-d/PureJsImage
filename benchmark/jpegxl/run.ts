import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import hillclimb from './encoder-hillclimb.json' with { type: 'json' }

type Workload =
  | 'encode-rgb8'
  | 'transcode-progressive-yuv420'
  | 'transcode-baseline-12mp'
  | 'transcode-progressive-12mp'

interface WorkerResult {
  readonly workload: Workload
  readonly validation: 'exact-pixels' | 'exact-jpeg-bytes'
  readonly baseline: Readonly<{
    readonly arrayBuffersBytes: number
    readonly externalBytes: number
    readonly heapUsedBytes: number
    readonly rssBytes: number
  }>
  readonly peak: WorkerResult['baseline']
  readonly maximumRssBytes: number
  readonly inputBytes: number
  readonly inputSha256: string
  readonly outputBytes: number
  readonly outputSha256: string
  readonly wallMilliseconds: number
  readonly managedPeakBytes: number | null
  readonly managedMemoryMeasurement: 'measured' | 'unavailable'
}

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const workerResult = (value: unknown): WorkerResult => {
  if (
    !record(value) ||
    (value.workload !== 'encode-rgb8' &&
      value.workload !== 'transcode-progressive-yuv420' &&
      value.workload !== 'transcode-baseline-12mp' &&
      value.workload !== 'transcode-progressive-12mp') ||
    (value.validation !== 'exact-pixels' && value.validation !== 'exact-jpeg-bytes') ||
    !record(value.baseline) ||
    !record(value.peak) ||
    typeof value.maximumRssBytes !== 'number' ||
    typeof value.inputBytes !== 'number' ||
    typeof value.inputSha256 !== 'string' ||
    typeof value.outputBytes !== 'number' ||
    typeof value.outputSha256 !== 'string' ||
    typeof value.wallMilliseconds !== 'number' ||
    (value.managedPeakBytes !== null && typeof value.managedPeakBytes !== 'number') ||
    (value.managedMemoryMeasurement !== 'measured' &&
      value.managedMemoryMeasurement !== 'unavailable')
  ) {
    throw new Error('JPEG XL benchmark worker returned invalid output')
  }
  const snapshot = (candidate: Readonly<Record<string, unknown>>): WorkerResult['baseline'] => {
    const values = ['arrayBuffersBytes', 'externalBytes', 'heapUsedBytes', 'rssBytes'] as const
    if (values.some((key) => typeof candidate[key] !== 'number')) {
      throw new Error('JPEG XL benchmark worker returned an invalid memory snapshot')
    }
    return {
      arrayBuffersBytes: Number(candidate.arrayBuffersBytes),
      externalBytes: Number(candidate.externalBytes),
      heapUsedBytes: Number(candidate.heapUsedBytes),
      rssBytes: Number(candidate.rssBytes),
    }
  }
  return {
    workload: value.workload,
    validation: value.validation,
    baseline: snapshot(value.baseline),
    peak: snapshot(value.peak),
    maximumRssBytes: value.maximumRssBytes,
    inputBytes: value.inputBytes,
    inputSha256: value.inputSha256,
    outputBytes: value.outputBytes,
    outputSha256: value.outputSha256,
    wallMilliseconds: value.wallMilliseconds,
    managedPeakBytes: value.managedPeakBytes,
    managedMemoryMeasurement: value.managedMemoryMeasurement,
  }
}

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.floor(ordered.length / 2)] ?? 0
}

const medianAvailable = (values: readonly (number | null)[]): number | null => {
  const available = values.filter((value): value is number => value !== null)
  return available.length === 0 ? null : median(available)
}

const ppmSamples = (ppm: Uint8Array): Uint8Array => {
  const marker = new TextEncoder().encode('255\n')
  for (let index = 0; index <= ppm.byteLength - marker.byteLength; index += 1) {
    if (marker.every((value, markerIndex) => ppm[index + markerIndex] === value)) {
      return ppm.subarray(index + marker.byteLength)
    }
  }
  throw new Error('JPEG XL benchmark PPM output has no sample payload')
}

const worker = fileURLToPath(new URL('./benchmark-worker.ts', import.meta.url))
const workloads = [
  'encode-rgb8',
  'transcode-progressive-yuv420',
  'transcode-baseline-12mp',
  'transcode-progressive-12mp',
] as const
const runs: WorkerResult[] = []
for (const workload of workloads) {
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const child = spawnSync(process.execPath, ['--expose-gc', worker, workload], {
      encoding: 'utf8',
      maxBuffer: 4 * 1_024 * 1_024,
    })
    if (child.error || child.status !== 0) {
      throw new Error(
        `JPEG XL ${workload} benchmark failed: ${child.error?.message ?? child.stderr.trim()}`,
      )
    }
    runs.push(workerResult(JSON.parse(child.stdout.trim())))
  }
}

const summaries = workloads.map((workload) => {
  const selected = runs.filter((run) => run.workload === workload)
  if (new Set(selected.map(({ outputSha256 }) => outputSha256)).size !== 1) {
    throw new Error(`JPEG XL ${workload} output changed between isolated runs`)
  }
  const first = selected[0]
  if (!first) throw new Error(`JPEG XL ${workload} produced no benchmark result`)
  return Object.freeze({
    workload,
    validation: first.validation,
    inputBytes: first.inputBytes,
    inputSha256: first.inputSha256,
    outputBytes: first.outputBytes,
    outputSha256: first.outputSha256,
    medianWallMilliseconds: median(selected.map(({ wallMilliseconds }) => wallMilliseconds)),
    medianMaximumRssBytes: median(selected.map(({ maximumRssBytes }) => maximumRssBytes)),
    medianPeakRssDeltaBytes: median(
      selected.map(({ baseline, maximumRssBytes }) =>
        Math.max(0, maximumRssBytes - baseline.rssBytes),
      ),
    ),
    medianExternalDeltaBytes: median(
      selected.map(({ baseline, peak }) =>
        Math.max(0, peak.externalBytes - baseline.externalBytes),
      ),
    ),
    medianArrayBufferDeltaBytes: median(
      selected.map(({ baseline, peak }) =>
        Math.max(0, peak.arrayBuffersBytes - baseline.arrayBuffersBytes),
      ),
    ),
    medianManagedPeakBytes: medianAvailable(
      selected.map(({ managedPeakBytes }) => managedPeakBytes),
    ),
    managedMemoryMeasurement: selected.every(
      ({ managedMemoryMeasurement }) => managedMemoryMeasurement === 'measured',
    )
      ? 'measured'
      : 'unavailable',
  })
})

const oracleDirectory =
  process.env.PUREJSIMAGE_JPEGXL_ORACLE_DIR ??
  '.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools'
const temporary = await mkdtemp(join(tmpdir(), 'purejsimage-jpegxl-benchmark-'))
let independentOracle: Readonly<{
  available: boolean
  decoder: string
  exactPixels?: boolean
  pureJsBytes?: number
  libjxlBytes?: number
  sizeGapBytes?: number
  sizeRatio?: number
}>
try {
  const encoded = join(temporary, 'encoder-rgb8.jxl')
  const sourcePpm = join(temporary, 'encoder-rgb8-source.ppm')
  const decoded = join(temporary, 'encoder-rgb8.ppm')
  const oracleEncoded = join(temporary, 'encoder-rgb8-libjxl.jxl')
  const oracleDecoded = join(temporary, 'encoder-rgb8-libjxl.ppm')
  const workerRun = spawnSync(
    process.execPath,
    ['--expose-gc', worker, 'encode-rgb8', encoded, sourcePpm],
    { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 },
  )
  if (workerRun.error || workerRun.status !== 0) {
    throw new Error(workerRun.error?.message ?? workerRun.stderr.trim())
  }
  const oracle = spawnSync(join(oracleDirectory, 'djxl'), [encoded, decoded], {
    encoding: 'utf8',
    maxBuffer: 4 * 1_024 * 1_024,
  })
  if (oracle.error && 'code' in oracle.error && oracle.error.code === 'ENOENT') {
    independentOracle = Object.freeze({ available: false, decoder: 'djxl not found' })
  } else {
    if (oracle.status !== 0) throw new Error(`djxl failed: ${oracle.stderr.trim()}`)
    const encoderOracle = spawnSync(
      join(oracleDirectory, 'cjxl'),
      [sourcePpm, oracleEncoded, '--distance=0', '--effort=1'],
      { encoding: 'utf8', maxBuffer: 4 * 1_024 * 1_024 },
    )
    if (encoderOracle.status !== 0) {
      throw new Error(`cjxl failed: ${encoderOracle.stderr.trim()}`)
    }
    const decoderOracle = spawnSync(join(oracleDirectory, 'djxl'), [oracleEncoded, oracleDecoded], {
      encoding: 'utf8',
      maxBuffer: 4 * 1_024 * 1_024,
    })
    if (decoderOracle.status !== 0) {
      throw new Error(`djxl failed for cjxl output: ${decoderOracle.stderr.trim()}`)
    }
    const ppm = new Uint8Array(await readFile(decoded))
    const oraclePpm = new Uint8Array(await readFile(oracleDecoded))
    const expected = workerResult(JSON.parse(workerRun.stdout.trim())).inputSha256
    const { createHash } = await import('node:crypto')
    const actual = createHash('sha256').update(ppmSamples(ppm)).digest('hex')
    if (actual !== expected) throw new Error('djxl output differs from the RGB8 source pixels')
    const oraclePixels = createHash('sha256').update(ppmSamples(oraclePpm)).digest('hex')
    if (oraclePixels !== expected)
      throw new Error('cjxl lossless output differs from source pixels')
    const pureJsBytes = (await readFile(encoded)).byteLength
    const libjxlBytes = (await readFile(oracleEncoded)).byteLength
    independentOracle = Object.freeze({
      available: true,
      decoder: `${join(oracleDirectory, 'cjxl and djxl')} 0.12.0`,
      exactPixels: true,
      pureJsBytes,
      libjxlBytes,
      sizeGapBytes: pureJsBytes - libjxlBytes,
      sizeRatio: pureJsBytes / libjxlBytes,
    })
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

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
      'Every encode run decoded to exact native pixels; every transcode run reconstructed the exact source JPEG bytes.',
    independentOracle,
  }),
  summaries,
  hillclimb,
})
const outputFlag = process.argv.indexOf('--output')
const requestedOutput = outputFlag < 0 ? undefined : process.argv[outputFlag + 1]
if (outputFlag >= 0 && !requestedOutput) throw new Error('--output requires a path')
const output =
  requestedOutput ??
  `benchmark/results/jpegxl-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.json`
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
await writeFile(
  output.replace(/\.json$/u, '.md'),
  `# JPEG XL benchmark\n\n- Revision: ${result.revision}\n- Correctness: passed\n- Independent djxl oracle: ${independentOracle.available ? 'exact RGB8 pixels' : 'unavailable'}\n- Result: ${output}\n`,
)
console.log(`Wrote ${output}`)
console.log(JSON.stringify(result, null, 2))
