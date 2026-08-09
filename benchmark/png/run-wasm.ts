import { spawnSync } from 'node:child_process'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { cpus, release, tmpdir, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { pngCodec } from '../../src/codecs/png.ts'
import {
  createBenchmarkPixels,
  encodeBenchmarkPng,
  PNG_BENCHMARK_BLOCK_ROWS,
  PNG_BENCHMARK_COMPRESSION_LEVEL,
  PNG_BENCHMARK_SEED,
  sha256,
  type PngBenchmarkFormat,
  type PngBenchmarkPattern,
} from './wasm-fixtures.ts'

type Engine = 'javascript' | 'scalar' | 'simd'
type Operation = 'decode' | 'encode'
type Profile = 'cold' | 'warm'

interface BenchmarkCase {
  readonly format: PngBenchmarkFormat
  readonly height: number
  readonly pattern: PngBenchmarkPattern
  readonly width: number
}

interface Fixture extends BenchmarkCase {
  readonly id: string
  readonly pixelBytes: number
  readonly pixelSha256: string
  readonly pngBytes: number
  readonly pngPath: string
  readonly pngSha256: string
  readonly rawPath: string
}

interface WorkerMeasurement {
  readonly absoluteRssDeltaBytes: number
  readonly arrayBuffersBytes: number
  readonly baselineRssBytes: number
  readonly engine: Engine
  readonly externalBytes: number
  readonly finalRssBytes: number
  readonly initializationMilliseconds: number
  readonly loaderCalls: number
  readonly maximumRssBytes: number
  readonly operation: Operation
  readonly outputBytes: number
  readonly outputSha256: string
  readonly peakRssDeltaBytes: number
  readonly profile: Profile
  readonly samples: readonly number[]
  readonly wasmInitialMemoryBytes: number
  readonly wasmMemoryBytes: number
}

interface MatrixMeasurement {
  readonly caseId: string
  readonly engine: Engine
  readonly medianAbsoluteRssDeltaBytes: number
  readonly medianArrayBuffersBytes: number
  readonly medianBaselineRssBytes: number
  readonly medianExternalBytes: number
  readonly medianFinalRssBytes: number
  readonly medianInitializationMilliseconds: number
  readonly medianMaximumRssBytes: number
  readonly medianMilliseconds: number
  readonly medianPeakRssDeltaBytes: number
  readonly operation: Operation
  readonly outputBytes: number
  readonly outputSha256: string
  readonly processMeasurements: readonly WorkerMeasurement[]
  readonly profile: Profile
  readonly wallSamplesMilliseconds: readonly number[]
  readonly wasmInitialMemoryBytes: number
  readonly wasmMemoryHighWaterBytes: number
}

const MAXIMUM_ROW_BYTES = 16 * 1_048_576
const WARMUP_RUNS = 2
const WARM_SAMPLES = 5
const COLD_PROCESSES_PER_CELL = 3
const WARM_PROCESSES_PER_CELL = 1
const CHILD_TIMEOUT_MILLISECONDS = 180_000

const cases: readonly BenchmarkCase[] = [
  { format: 'rgb8', height: 256, pattern: 'smooth', width: 256 },
  { format: 'rgba8', height: 256, pattern: 'smooth', width: 256 },
  { format: 'rgb8', height: 256, pattern: 'high-entropy', width: 256 },
  { format: 'rgba8', height: 256, pattern: 'high-entropy', width: 256 },
  { format: 'rgb8', height: 1_080, pattern: 'smooth', width: 1_920 },
  { format: 'rgba8', height: 1_080, pattern: 'smooth', width: 1_920 },
  { format: 'rgb8', height: 1_080, pattern: 'high-entropy', width: 1_920 },
  { format: 'rgba8', height: 1_080, pattern: 'high-entropy', width: 1_920 },
]
const engines: readonly Engine[] = ['javascript', 'scalar', 'simd']
const operations: readonly Operation[] = ['decode', 'encode']
const profiles: readonly Profile[] = ['cold', 'warm']

const numberField = (value: object, field: string): number => {
  const result: unknown = Reflect.get(value, field)
  if (typeof result !== 'number' || !Number.isFinite(result) || result < 0) {
    throw new Error(`PNG WASM worker field ${field} is invalid`)
  }
  return result
}

const numericSamples = (value: unknown): readonly number[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const samples: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    const sample: unknown = Reflect.get(value, index)
    if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0) return undefined
    samples.push(sample)
  }
  return samples
}

const parseMeasurement = (text: string): WorkerMeasurement => {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null) {
    throw new Error('PNG WASM worker returned invalid JSON')
  }
  const engine: unknown = Reflect.get(value, 'engine')
  const operation: unknown = Reflect.get(value, 'operation')
  const outputSha256: unknown = Reflect.get(value, 'outputSha256')
  const profile: unknown = Reflect.get(value, 'profile')
  const samples = numericSamples(Reflect.get(value, 'samples'))
  if (
    (engine !== 'javascript' && engine !== 'scalar' && engine !== 'simd') ||
    (operation !== 'decode' && operation !== 'encode') ||
    (profile !== 'cold' && profile !== 'warm') ||
    typeof outputSha256 !== 'string' ||
    outputSha256.length !== 64 ||
    !samples
  ) {
    throw new Error('PNG WASM worker returned invalid categorical fields')
  }
  return {
    absoluteRssDeltaBytes: numberField(value, 'absoluteRssDeltaBytes'),
    arrayBuffersBytes: numberField(value, 'arrayBuffersBytes'),
    baselineRssBytes: numberField(value, 'baselineRssBytes'),
    engine,
    externalBytes: numberField(value, 'externalBytes'),
    finalRssBytes: numberField(value, 'finalRssBytes'),
    initializationMilliseconds: numberField(value, 'initializationMilliseconds'),
    loaderCalls: numberField(value, 'loaderCalls'),
    maximumRssBytes: numberField(value, 'maximumRssBytes'),
    operation,
    outputBytes: numberField(value, 'outputBytes'),
    outputSha256,
    peakRssDeltaBytes: numberField(value, 'peakRssDeltaBytes'),
    profile,
    samples,
    wasmInitialMemoryBytes: numberField(value, 'wasmInitialMemoryBytes'),
    wasmMemoryBytes: numberField(value, 'wasmMemoryBytes'),
  }
}

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((left, right) => left - right)
  if (sorted.length === 0) throw new Error('Cannot summarize empty PNG WASM measurements')
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  if (upper === undefined) throw new Error('PNG WASM median is unavailable')
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[middle - 1]
  if (lower === undefined) throw new Error('PNG WASM median is unavailable')
  return (lower + upper) / 2
}

const outputArgument = (): string | undefined => {
  let outputPath: string | undefined
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    if (argument !== '--output') throw new Error(`Unknown PNG WASM benchmark option: ${argument}`)
    const path = process.argv[index + 1]
    if (!path || path === '--output') throw new Error('--output requires a JSON file path')
    if (outputPath) throw new Error('--output may only be specified once')
    outputPath = path
    index += 1
  }
  return outputPath
}

const createFixture = async (directory: string, benchmarkCase: BenchmarkCase): Promise<Fixture> => {
  const id = `${benchmarkCase.width}x${benchmarkCase.height}-${benchmarkCase.format}-${benchmarkCase.pattern}`
  const pixels = createBenchmarkPixels(
    benchmarkCase.width,
    benchmarkCase.height,
    benchmarkCase.format,
    benchmarkCase.pattern,
  )
  const png = await encodeBenchmarkPng(
    pngCodec,
    pixels,
    benchmarkCase.width,
    benchmarkCase.height,
    benchmarkCase.format,
  )
  const rawPath = join(directory, `${id}.raw`)
  const pngPath = join(directory, `${id}.png`)
  await Promise.all([writeFile(rawPath, pixels), writeFile(pngPath, png)])
  return {
    ...benchmarkCase,
    id,
    pixelBytes: pixels.byteLength,
    pixelSha256: sha256(pixels),
    pngBytes: png.byteLength,
    pngPath,
    pngSha256: sha256(png),
    rawPath,
  }
}

const decodeWorker = fileURLToPath(new URL('./wasm-decode-worker.ts', import.meta.url))
const encodeWorker = fileURLToPath(new URL('./wasm-encode-worker.ts', import.meta.url))

const runWorker = (
  fixture: Fixture,
  operation: Operation,
  engine: Engine,
  profile: Profile,
): WorkerMeasurement => {
  const worker = operation === 'decode' ? decodeWorker : encodeWorker
  const argumentsForWorker =
    operation === 'decode'
      ? [engine, profile, fixture.pngPath, fixture.pixelSha256]
      : [
          engine,
          profile,
          fixture.rawPath,
          String(fixture.width),
          String(fixture.height),
          fixture.format,
          fixture.pngSha256,
        ]
  const child = spawnSync(process.execPath, ['--expose-gc', worker, ...argumentsForWorker], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: CHILD_TIMEOUT_MILLISECONDS,
  })
  if (child.error) throw child.error
  if (child.status !== 0) {
    const detail = child.stderr.trim() || `worker exited with status ${child.status ?? 'unknown'}`
    throw new Error(`PNG WASM ${operation} ${fixture.id} ${engine} ${profile}: ${detail}`)
  }
  const measurement = parseMeasurement(child.stdout.trim())
  if (
    measurement.engine !== engine ||
    measurement.operation !== operation ||
    measurement.profile !== profile
  ) {
    throw new Error('PNG WASM worker identity does not match its requested matrix cell')
  }
  const expectedHash = operation === 'decode' ? fixture.pixelSha256 : fixture.pngSha256
  const expectedBytes = operation === 'decode' ? fixture.pixelBytes : fixture.pngBytes
  if (measurement.outputSha256 !== expectedHash || measurement.outputBytes !== expectedBytes) {
    throw new Error(
      `PNG WASM ${operation} correctness gate failed for ${fixture.id} ${engine} ${profile}`,
    )
  }
  return measurement
}

const artifactMetadata = async (path: string) => {
  const bytes = await readFile(path)
  return {
    path,
    sha256: sha256(bytes),
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  }
}

const sourceMetadata = async (path: string) => {
  const bytes = await readFile(path)
  return { path, sha256: sha256(bytes) }
}

const outputPath = outputArgument()
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'purejsimage-png-wasm-'))
try {
  const fixtures: Fixture[] = []
  for (const benchmarkCase of cases) {
    fixtures.push(await createFixture(temporaryDirectory, benchmarkCase))
  }

  const matrix: MatrixMeasurement[] = []
  for (const fixture of fixtures) {
    for (const operation of operations) {
      for (const profile of profiles) {
        for (const engine of engines) {
          const processCount =
            profile === 'cold' ? COLD_PROCESSES_PER_CELL : WARM_PROCESSES_PER_CELL
          const processMeasurements: WorkerMeasurement[] = []
          for (let processRun = 0; processRun < processCount; processRun += 1) {
            processMeasurements.push(runWorker(fixture, operation, engine, profile))
          }
          const representative = processMeasurements[0]
          if (!representative) throw new Error('PNG WASM matrix cell has no process measurement')
          const wallSamples = processMeasurements.flatMap((measurement) => measurement.samples)
          matrix.push({
            caseId: fixture.id,
            operation,
            engine,
            profile,
            medianMilliseconds: median(wallSamples),
            medianInitializationMilliseconds: median(
              processMeasurements.map((measurement) => measurement.initializationMilliseconds),
            ),
            medianAbsoluteRssDeltaBytes: median(
              processMeasurements.map((measurement) => measurement.absoluteRssDeltaBytes),
            ),
            medianBaselineRssBytes: median(
              processMeasurements.map((measurement) => measurement.baselineRssBytes),
            ),
            medianFinalRssBytes: median(
              processMeasurements.map((measurement) => measurement.finalRssBytes),
            ),
            medianMaximumRssBytes: median(
              processMeasurements.map((measurement) => measurement.maximumRssBytes),
            ),
            medianPeakRssDeltaBytes: median(
              processMeasurements.map((measurement) => measurement.peakRssDeltaBytes),
            ),
            medianExternalBytes: median(
              processMeasurements.map((measurement) => measurement.externalBytes),
            ),
            medianArrayBuffersBytes: median(
              processMeasurements.map((measurement) => measurement.arrayBuffersBytes),
            ),
            wasmInitialMemoryBytes: median(
              processMeasurements.map((measurement) => measurement.wasmInitialMemoryBytes),
            ),
            wasmMemoryHighWaterBytes: median(
              processMeasurements.map((measurement) => measurement.wasmMemoryBytes),
            ),
            outputBytes: representative.outputBytes,
            outputSha256: representative.outputSha256,
            wallSamplesMilliseconds: wallSamples,
            processMeasurements,
          })
        }
      }
    }
  }

  const scalarArtifactPath = 'src/accelerator-entries/png-codec.wasm'
  const simdArtifactPath = 'src/accelerator-entries/png-codec-simd.wasm'
  const [scalarArtifact, simdArtifact, packageBytes, sources] = await Promise.all([
    artifactMetadata(scalarArtifactPath),
    artifactMetadata(simdArtifactPath),
    readFile('package.json', 'utf8'),
    Promise.all(
      [
        'benchmark/png/run-wasm.ts',
        'benchmark/png/wasm-decode-worker.ts',
        'benchmark/png/wasm-encode-worker.ts',
        'benchmark/png/wasm-fixtures.ts',
        'src/accelerators/wasm/png.ts',
        'src/codecs/png.ts',
        'src/node-runtime.ts',
        'scripts/build-wasm-png.ts',
        'wasm/png-codec/.cargo/config.toml',
        'wasm/png-codec/Cargo.lock',
        'wasm/png-codec/Cargo.toml',
        'wasm/png-codec/src/lib.rs',
      ].map(sourceMetadata),
    ),
  ])
  const packageValue: unknown = JSON.parse(packageBytes)
  const versionValue: unknown =
    typeof packageValue === 'object' && packageValue !== null
      ? Reflect.get(packageValue, 'version')
      : undefined
  const packageVersion = typeof versionValue === 'string' ? versionValue : 'unknown'
  const processors = cpus()
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    package: { name: 'purejsimage', version: packageVersion },
    correctness: {
      passed: true,
      decodeGate: 'Every measured decoded pixel SHA-256 equals its generated raw fixture SHA-256.',
      encodeGate:
        'Every measured PNG SHA-256 and byte count equals the JavaScript reference fixture exactly.',
    },
    benchmark: {
      command: 'npm run bench:png:wasm -- --output benchmark/results/png-wasm-YYYY-MM-DD.json',
      engines,
      operations,
      profiles,
      coldProcessesPerCell: COLD_PROCESSES_PER_CELL,
      warmProcessesPerCell: WARM_PROCESSES_PER_CELL,
      warmupRunsPerWarmProcess: WARMUP_RUNS,
      measuredRunsPerWarmProcess: WARM_SAMPLES,
      measuredRunsPerColdProcess: 1,
      processIsolation:
        'Each fixture, operation, engine, profile, and process repeat uses a new Node process.',
      decodeTimingScope:
        'Codec creation, PNG parsing/inflate/unfilter, bounded block iteration, and SHA-256.',
      encodeTimingScope:
        'Codec creation, bounded 32-row writes, adaptive filtering, native deflate, sink collection, and final assembly; SHA-256 is outside timing.',
      initializationScope:
        'WASM artifact read, compile, instantiate, ABI/SIMD identity validation, and memory export discovery.',
      memoryScope:
        'Maximum RSS is process.resourceUsage().maxRSS for the isolated worker. Baseline/final RSS come from process.memoryUsage(); absolute delta compares final to baseline, and peak delta compares maximum to baseline.',
      artifactCompression: { gzipLevel: 9, brotliQuality: 11 },
      childTimeoutMilliseconds: CHILD_TIMEOUT_MILLISECONDS,
    },
    inputGeneration: {
      seed: PNG_BENCHMARK_SEED,
      patterns: ['smooth deterministic gradients', 'seeded xorshift32 high entropy'],
      formats: ['rgb8', 'rgba8'],
      dimensions: ['256x256', '1920x1080'],
      blockRows: PNG_BENCHMARK_BLOCK_ROWS,
      compressionLevel: PNG_BENCHMARK_COMPRESSION_LEVEL,
      maximumRowBytes: MAXIMUM_ROW_BYTES,
    },
    environment: {
      node: process.version,
      v8: process.versions.v8,
      zlib: process.versions.zlib,
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      cpuModel: processors[0]?.model ?? 'unknown',
      logicalCpuCount: processors.length,
      totalMemoryBytes: totalmem(),
    },
    artifacts: { scalar: scalarArtifact, simd: simdArtifact },
    sources,
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      width: fixture.width,
      height: fixture.height,
      format: fixture.format,
      pattern: fixture.pattern,
      pixelBytes: fixture.pixelBytes,
      pixelSha256: fixture.pixelSha256,
      pngBytes: fixture.pngBytes,
      pngSha256: fixture.pngSha256,
    })),
    matrix,
  }
  const serialized = `${JSON.stringify(result, undefined, 2)}\n`
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, serialized)
  } else {
    console.log(serialized.trimEnd())
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
