import { brotliCompressSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

interface Measurement {
  readonly arrayBuffersBytes: number
  readonly baselineRssBytes: number
  readonly engine: 'javascript' | 'scalar' | 'simd'
  readonly externalBytes: number
  readonly hash: string
  readonly initializationMilliseconds: number
  readonly maximumRssBytes: number
  readonly milliseconds: number
  readonly profile: 'cold' | 'warm'
  readonly rssBytes: number
  readonly wasmMemoryBytes: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const numberField = (value: Record<string, unknown>, field: string): number => {
  const result = value[field]
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`JPEG WASM worker field ${field} is invalid`)
  }
  return result
}

const parseMeasurement = (text: string): Measurement => {
  const value: unknown = JSON.parse(text)
  if (
    !isRecord(value) ||
    (value.engine !== 'javascript' && value.engine !== 'scalar' && value.engine !== 'simd') ||
    (value.profile !== 'cold' && value.profile !== 'warm') ||
    typeof value.hash !== 'string'
  ) {
    throw new Error('JPEG WASM worker returned invalid output')
  }
  return {
    engine: value.engine,
    profile: value.profile,
    hash: value.hash,
    arrayBuffersBytes: numberField(value, 'arrayBuffersBytes'),
    baselineRssBytes: numberField(value, 'baselineRssBytes'),
    externalBytes: numberField(value, 'externalBytes'),
    initializationMilliseconds: numberField(value, 'initializationMilliseconds'),
    maximumRssBytes: numberField(value, 'maximumRssBytes'),
    milliseconds: numberField(value, 'milliseconds'),
    rssBytes: numberField(value, 'rssBytes'),
    wasmMemoryBytes: numberField(value, 'wasmMemoryBytes'),
  }
}

const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((left, right) => left - right)
  const value = sorted[Math.floor(sorted.length / 2)]
  if (value === undefined) throw new Error('Cannot summarize empty JPEG WASM measurements')
  return value
}

const measuredMilliseconds = (operation: () => void): number => {
  operation()
  const samples: number[] = []
  for (let run = 0; run < 7; run += 1) {
    const start = performance.now()
    operation()
    samples.push(performance.now() - start)
  }
  return median(samples)
}

const worker = fileURLToPath(new URL('./wasm-decoder-worker.ts', import.meta.url))
const inputPath = 'benchmark/corpus/files/tundra-4000x3000.jpg'
const measurements: Measurement[] = []
for (const profile of ['cold', 'warm'] as const) {
  for (const engine of ['javascript', 'scalar', 'simd'] as const) {
    for (let run = 0; run < 3; run += 1) {
      const child = spawnSync(
        process.execPath,
        ['--expose-gc', worker, engine, profile, inputPath],
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 120_000,
        },
      )
      if (child.error) throw child.error
      if (child.status !== 0) throw new Error(child.stderr.trim())
      measurements.push(parseMeasurement(child.stdout.trim()))
    }
  }
}

const hashes = new Set(measurements.map(({ hash }) => hash))
if (hashes.size !== 1) throw new Error('JPEG WASM output differs from the TypeScript reference')
const scalarArtifact = await readFile('src/accelerator-entries/jpeg-decoder.wasm')
const simdArtifact = await readFile('src/accelerator-entries/jpeg-decoder-simd.wasm')
const input = await readFile(inputPath)
const outputRowBytes = 4_000 * 8 * 3
const outputRows = 3_000 / 8
const copyMemory = new WebAssembly.Memory({
  initial: Math.ceil(Math.max(input.byteLength, outputRowBytes) / 65_536),
})
const inputDestination = new Uint8Array(copyMemory.buffer, 0, input.byteLength)
const outputSource = new Uint8Array(copyMemory.buffer, 0, outputRowBytes)
const outputDestination = new Uint8Array(outputRowBytes)
const inputCopyMilliseconds = measuredMilliseconds(() => inputDestination.set(input))
const outputCopyMilliseconds = measuredMilliseconds(() => {
  for (let row = 0; row < outputRows; row += 1) outputDestination.set(outputSource)
})
const summary = (engine: Measurement['engine'], profile: Measurement['profile']) => {
  const samples = measurements.filter(
    (measurement) => measurement.engine === engine && measurement.profile === profile,
  )
  return {
    milliseconds: median(samples.map(({ milliseconds }) => milliseconds)),
    maximumRssBytes: median(samples.map(({ maximumRssBytes }) => maximumRssBytes)),
    initializationMilliseconds: median(
      samples.map(({ initializationMilliseconds }) => initializationMilliseconds),
    ),
  }
}
const result = {
  fixture: {
    path: inputPath,
    bytes: input.byteLength,
    sha256: createHash('sha256').update(input).digest('hex'),
    dimensions: '4000x3000',
  },
  artifact: {
    scalarBytes: scalarArtifact.byteLength,
    scalarGzipBytes: gzipSync(scalarArtifact, { level: 9 }).byteLength,
    scalarBrotliBytes: brotliCompressSync(scalarArtifact).byteLength,
    simdBytes: simdArtifact.byteLength,
    simdGzipBytes: gzipSync(simdArtifact, { level: 9 }).byteLength,
    simdBrotliBytes: brotliCompressSync(simdArtifact).byteLength,
    wasmMemoryBytes: median(
      measurements
        .filter(({ engine }) => engine !== 'javascript')
        .map(({ wasmMemoryBytes }) => wasmMemoryBytes),
    ),
  },
  outputSha256: [...hashes][0],
  copy: {
    inputMilliseconds: inputCopyMilliseconds,
    outputMilliseconds: outputCopyMilliseconds,
    totalMilliseconds: inputCopyMilliseconds + outputCopyMilliseconds,
  },
  cold: {
    javascript: summary('javascript', 'cold'),
    scalar: summary('scalar', 'cold'),
    simd: summary('simd', 'cold'),
  },
  warm: {
    javascript: summary('javascript', 'warm'),
    scalar: summary('scalar', 'warm'),
    simd: summary('simd', 'warm'),
  },
}
const serialized = `${JSON.stringify(result, undefined, 2)}\n`
const outputIndex = process.argv.indexOf('--output')
const outputPath = outputIndex < 0 ? undefined : process.argv[outputIndex + 1]
if (outputPath) await writeFile(outputPath, serialized)
else console.log(serialized.trimEnd())
