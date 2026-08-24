import { brotliCompressSync, gzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

interface Measurement {
  readonly arrayBuffersBytes: number
  readonly baselineRssBytes: number
  readonly dimensions: string
  readonly engine: 'javascript' | 'scalar' | 'aan' | 'simd'
  readonly entropy: 'low' | 'high'
  readonly externalBytes: number
  readonly hash: string
  readonly initializationMilliseconds: number
  readonly maximumRssBytes: number
  readonly medianMilliseconds: number
  readonly mode: 'gray' | '420' | '422' | '444'
  readonly outputBytes: number
  readonly psnr: number
  readonly profile: 'cold' | 'warm'
  readonly samples: readonly number[]
  readonly throughputMegapixelsPerSecond: number
  readonly wasmMemoryBytes: number
}

interface BenchmarkCase {
  readonly entropy: Measurement['entropy']
  readonly height: number
  readonly mode: Measurement['mode']
  readonly profile: Measurement['profile']
  readonly width: number
}

const numberField = (value: object, field: string): number => {
  const result: unknown = Reflect.get(value, field)
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`JPEG WASM encoder worker field ${field} is invalid`)
  }
  return result
}

const parseMeasurement = (text: string): Measurement => {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null) {
    throw new Error('JPEG WASM encoder worker returned invalid output')
  }
  const engine: unknown = Reflect.get(value, 'engine')
  const entropy: unknown = Reflect.get(value, 'entropy')
  const mode: unknown = Reflect.get(value, 'mode')
  const profile: unknown = Reflect.get(value, 'profile')
  const dimensions: unknown = Reflect.get(value, 'dimensions')
  const hash: unknown = Reflect.get(value, 'hash')
  const samples: unknown = Reflect.get(value, 'samples')
  if (
    (engine !== 'javascript' && engine !== 'scalar' && engine !== 'aan' && engine !== 'simd') ||
    (entropy !== 'low' && entropy !== 'high') ||
    (mode !== 'gray' && mode !== '420' && mode !== '422' && mode !== '444') ||
    (profile !== 'cold' && profile !== 'warm') ||
    typeof dimensions !== 'string' ||
    typeof hash !== 'string' ||
    !Array.isArray(samples) ||
    !samples.every((sample) => typeof sample === 'number' && Number.isFinite(sample))
  ) {
    throw new Error('JPEG WASM encoder worker returned invalid categorical fields')
  }
  return {
    arrayBuffersBytes: numberField(value, 'arrayBuffersBytes'),
    baselineRssBytes: numberField(value, 'baselineRssBytes'),
    dimensions,
    engine,
    entropy,
    externalBytes: numberField(value, 'externalBytes'),
    hash,
    initializationMilliseconds: numberField(value, 'initializationMilliseconds'),
    maximumRssBytes: numberField(value, 'maximumRssBytes'),
    medianMilliseconds: numberField(value, 'medianMilliseconds'),
    mode,
    outputBytes: numberField(value, 'outputBytes'),
    psnr: numberField(value, 'psnr'),
    profile,
    samples,
    throughputMegapixelsPerSecond: numberField(value, 'throughputMegapixelsPerSecond'),
    wasmMemoryBytes: numberField(value, 'wasmMemoryBytes'),
  }
}

const cases: BenchmarkCase[] = []
for (const mode of ['gray', '420', '422', '444'] as const) {
  cases.push({ entropy: 'high', height: 768, mode, profile: 'warm', width: 1_024 })
}
for (const entropy of ['low', 'high'] as const) {
  cases.push({ entropy, height: 1_536, mode: '420', profile: 'warm', width: 2_048 })
}
for (const size of [64, 128, 256, 512, 1_024]) {
  for (const profile of ['cold', 'warm'] as const) {
    cases.push({ entropy: 'high', height: size, mode: '420', profile, width: size })
  }
}

const worker = fileURLToPath(new URL('./wasm-encoder-worker.ts', import.meta.url))
const measurements: Measurement[] = []
for (const benchmarkCase of cases) {
  for (const engine of ['javascript', 'scalar', 'aan', 'simd'] as const) {
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        worker,
        engine,
        benchmarkCase.mode,
        String(benchmarkCase.width),
        String(benchmarkCase.height),
        benchmarkCase.profile,
        benchmarkCase.entropy,
      ],
      { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 180_000 },
    )
    if (child.error) throw child.error
    if (child.status !== 0) throw new Error(child.stderr.trim())
    measurements.push(parseMeasurement(child.stdout.trim()))
  }
}

const qualityGroups = new Map<string, Measurement[]>()
for (const measurement of measurements) {
  const key = `${measurement.dimensions}:${measurement.mode}:${measurement.entropy}:${measurement.profile}`
  const group = qualityGroups.get(key) ?? []
  group.push(measurement)
  qualityGroups.set(key, group)
}
for (const [key, group] of qualityGroups) {
  const javascript = group.find(({ engine }) => engine === 'javascript')
  const scalar = group.find(({ engine }) => engine === 'scalar')
  const aan = group.find(({ engine }) => engine === 'aan')
  const simd = group.find(({ engine }) => engine === 'simd')
  if (!javascript || !scalar || !aan || !simd) {
    throw new Error(`JPEG WASM encoder benchmark group is incomplete for ${key}`)
  }
  if (javascript.hash !== scalar.hash) {
    throw new Error(`Scalar JPEG WASM output parity failed for ${key}`)
  }
  if (aan.hash !== simd.hash) {
    throw new Error(`Scalar and SIMD AAN JPEG output parity failed for ${key}`)
  }
  const psnrDifference = Math.abs(javascript.psnr - simd.psnr)
  const sizeDifference =
    Math.abs(javascript.outputBytes - simd.outputBytes) / javascript.outputBytes
  if (psnrDifference > 0.05 || sizeDifference > 0.01) {
    throw new Error(
      `SIMD JPEG quality contract failed for ${key}: ${psnrDifference} dB, ${(sizeDifference * 100).toFixed(2)}% bytes`,
    )
  }
}

const scalarArtifact = await readFile('src/accelerator-entries/jpeg-encoder.wasm')
const aanArtifact = await readFile('benchmark/.tmp/wasm/jpeg-encoder-aan.wasm')
const simdArtifact = await readFile('src/accelerator-entries/jpeg-encoder-simd.wasm')
const artifacts = {
  scalar: {
    brotliBytes: brotliCompressSync(scalarArtifact).byteLength,
    bytes: scalarArtifact.byteLength,
    gzipBytes: gzipSync(scalarArtifact, { level: 9 }).byteLength,
  },
  aan: {
    brotliBytes: brotliCompressSync(aanArtifact).byteLength,
    bytes: aanArtifact.byteLength,
    gzipBytes: gzipSync(aanArtifact, { level: 9 }).byteLength,
  },
  simd: {
    brotliBytes: brotliCompressSync(simdArtifact).byteLength,
    bytes: simdArtifact.byteLength,
    gzipBytes: gzipSync(simdArtifact, { level: 9 }).byteLength,
  },
}
const gitRevision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
const workingTreeDirty =
  spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim().length > 0
const result = {
  generatedAt: new Date().toISOString(),
  revision: { gitRevision, workingTreeDirty },
  artifacts,
  measurements,
}
const json = `${JSON.stringify(result, undefined, 2)}\n`
const outputIndex = process.argv.indexOf('--output')
const markdownIndex = process.argv.indexOf('--markdown')
const outputPath =
  outputIndex < 0
    ? 'benchmark/results/jpeg-wasm-encoder-2026-08-24.json'
    : process.argv[outputIndex + 1]
const markdownPath =
  markdownIndex < 0
    ? 'benchmark/results/jpeg-wasm-encoder-2026-08-24.md'
    : process.argv[markdownIndex + 1]
if (!outputPath || !markdownPath) throw new Error('JPEG WASM encoder output path is missing')
await writeFile(outputPath, json)

const rows = measurements.map((measurement) => {
  const peakDelta = Math.max(0, measurement.maximumRssBytes - measurement.baselineRssBytes)
  return `| ${measurement.dimensions} | ${measurement.mode} | ${measurement.entropy} | ${measurement.profile} | ${measurement.engine} | ${measurement.medianMilliseconds.toFixed(2)} | ${measurement.throughputMegapixelsPerSecond.toFixed(2)} | ${(peakDelta / 1_048_576).toFixed(1)} | ${(measurement.wasmMemoryBytes / 1_048_576).toFixed(1)} | ${measurement.outputBytes} | ${measurement.psnr.toFixed(3)} |`
})
const measurementTime = (
  dimensions: string,
  mode: Measurement['mode'],
  entropy: Measurement['entropy'],
  profile: Measurement['profile'],
  engine: Measurement['engine'],
): number => {
  const measurement = measurements.find(
    (candidate) =>
      candidate.dimensions === dimensions &&
      candidate.mode === mode &&
      candidate.entropy === entropy &&
      candidate.profile === profile &&
      candidate.engine === engine,
  )
  if (!measurement) throw new Error(`Missing JPEG WASM measurement for ${dimensions} ${mode}`)
  return measurement.medianMilliseconds
}
const percentageReduction = (baseline: number, optimized: number): number =>
  ((baseline - optimized) / baseline) * 100
const coverageModes = ['gray', '420', '422', '444'] as const
const scalarCoverageGains = coverageModes.map((mode) =>
  percentageReduction(
    measurementTime('1024x768', mode, 'high', 'warm', 'javascript'),
    measurementTime('1024x768', mode, 'high', 'warm', 'scalar'),
  ),
)
const simdCoverageGains = coverageModes.map((mode) =>
  percentageReduction(
    measurementTime('1024x768', mode, 'high', 'warm', 'aan'),
    measurementTime('1024x768', mode, 'high', 'warm', 'simd'),
  ),
)
const aanCoverageGains = coverageModes.map((mode) =>
  percentageReduction(
    measurementTime('1024x768', mode, 'high', 'warm', 'scalar'),
    measurementTime('1024x768', mode, 'high', 'warm', 'aan'),
  ),
)
const largeLowGain = percentageReduction(
  measurementTime('2048x1536', '420', 'low', 'warm', 'aan'),
  measurementTime('2048x1536', '420', 'low', 'warm', 'simd'),
)
const largeHighGain = percentageReduction(
  measurementTime('2048x1536', '420', 'high', 'warm', 'aan'),
  measurementTime('2048x1536', '420', 'high', 'warm', 'simd'),
)
const coldDimensions = ['64x64', '128x128', '256x256', '512x512', '1024x1024']
const simdWonEveryColdSize = coldDimensions.every(
  (dimensions) =>
    measurementTime(dimensions, '420', 'high', 'cold', 'simd') <
    measurementTime(dimensions, '420', 'high', 'cold', 'javascript'),
)
const coldSummary = simdWonEveryColdSize
  ? 'Cold SIMD remained faster than TypeScript at every measured size.'
  : 'Cold SIMD did not beat TypeScript at every measured size.'
const thresholdSimd = measurementTime('256x256', '420', 'high', 'cold', 'simd')
const thresholdJavaScript = measurementTime('256x256', '420', 'high', 'cold', 'javascript')
const markdown = `# JPEG WASM encoder benchmark — 2026-08-24

Correctness gate: scalar WASM output is byte-identical to the TypeScript reference. Scalar and SIMD AAN outputs are byte-identical to each other. The alternative AAN FDCT must remain within 0.05 dB decoded PSNR and 1% output size for every matching workload before timings are accepted.

- Source revision: ${gitRevision} (${workingTreeDirty ? 'dirty working tree with the reviewed WASM changes' : 'clean'}).
- Scalar artifact: ${artifacts.scalar.bytes} bytes (${artifacts.scalar.gzipBytes} gzip, ${artifacts.scalar.brotliBytes} brotli).
- Scalar AAN control artifact: ${artifacts.aan.bytes} bytes (${artifacts.aan.gzipBytes} gzip, ${artifacts.aan.brotliBytes} brotli).
- SIMD artifact: ${artifacts.simd.bytes} bytes (${artifacts.simd.gzipBytes} gzip, ${artifacts.simd.brotliBytes} brotli).
- On 1024x768 high-entropy mode coverage, scalar WASM reduced warm time by ${Math.min(...scalarCoverageGains).toFixed(1)}%-${Math.max(...scalarCoverageGains).toFixed(1)}% versus TypeScript. Scalar AAN then changed matrix-DCT time by ${Math.min(...aanCoverageGains).toFixed(1)}%-${Math.max(...aanCoverageGains).toFixed(1)}%. SIMD changed the same AAN algorithm by ${Math.min(...simdCoverageGains).toFixed(1)}%-${Math.max(...simdCoverageGains).toFixed(1)}%.
- On 2048x1536 4:2:0, SIMD reduced scalar AAN warm time by ${largeLowGain.toFixed(1)}% for low entropy and ${largeHighGain.toFixed(1)}% for high entropy.
- ${coldSummary} The production selector uses a conservative 65,536-pixel minimum based on the 256x256 result (${thresholdSimd.toFixed(2)} ms versus ${thresholdJavaScript.toFixed(2)} ms).
- The SIMD artifact adds ${artifacts.simd.bytes - artifacts.scalar.bytes} raw bytes and ${artifacts.simd.gzipBytes - artifacts.scalar.gzipBytes} gzip bytes over scalar.
- Warm rows report the median of five measured encodes after two warmups. Cold rows include lazy module read, compile, instantiate, and the first encode.
- Peak RSS is the absolute process high-water mark minus the pre-measurement baseline. WASM memory is the linear-memory high-water mark.

| Dimensions | Mode | Entropy | Profile | Engine | ms | MP/s | peak RSS Δ MiB | WASM MiB | output bytes | PSNR dB |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}
`
await writeFile(markdownPath, markdown)
console.log(json.trimEnd())
